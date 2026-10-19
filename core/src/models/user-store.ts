import type { Account } from '../types/account';
export {};

/**
 * 普通用户存储（配合卡密系统）：
 * - 用户使用时间卡密注册，有效期即时卡时长；
 * - 时间卡续费、额度卡提升账号上限；
 * - 普通用户只能访问自己名下（owner）的游戏账号。
 */

const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const security = require('./auth-security');
const cardStore = require('./card-store');

const USERS_FILE: string = getDataFile('users.json');

const DAY_MS: number = 24 * 60 * 60 * 1000;
const DEFAULT_USER_ACCOUNT_LIMIT: number = 2;

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000;

interface UserCard {
    code: string;
    description: string;
    expiresAt: number | null;
    isPermanent: boolean;
}

interface UserRecord {
    username: string;
    password: string;
    role: 'user';
    enabled: boolean;
    card: UserCard;
    accountLimit: number;
    createdAt: number;
    updatedAt: number;
}

interface UsersData {
    users: UserRecord[];
}

// 每用户登录失败锁定（内存态，重启即清零）
const userLockouts: Map<string, { count: number; lockedUntil: number }> = new Map();

function normalizeUserCard(raw: any): UserCard {
    const source = raw && typeof raw === 'object' ? raw : {};
    const expiresAt = source.expiresAt === null ? null : (Number(source.expiresAt) || null);
    return {
        code: String(source.code || ''),
        description: String(source.description || ''),
        expiresAt,
        isPermanent: source.isPermanent === true || expiresAt === null,
    };
}

function normalizeUser(raw: any): UserRecord | null {
    const source = raw && typeof raw === 'object' ? raw : {};
    const username = String(source.username || '').trim();
    if (!username || !String(source.password || '').trim()) return null;
    return {
        username,
        password: String(source.password),
        role: 'user',
        enabled: source.enabled !== false,
        card: normalizeUserCard(source.card),
        accountLimit: Math.max(1, Number.parseInt(source.accountLimit, 10) || DEFAULT_USER_ACCOUNT_LIMIT),
        createdAt: Number(source.createdAt) || Date.now(),
        updatedAt: Number(source.updatedAt) || Date.now(),
    };
}

function normalizeUsersData(raw: unknown): UsersData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const seen: Set<string> = new Set();
    const users: UserRecord[] = [];
    for (const item of (Array.isArray(data.users) ? data.users : [])) {
        const user = normalizeUser(item);
        if (!user || seen.has(user.username)) continue;
        seen.add(user.username);
        users.push(user);
    }
    return { users };
}

function loadUsers(): UsersData {
    ensureDataDir();
    return normalizeUsersData(readJsonFile(USERS_FILE, () => ({ users: [] })));
}

function saveUsers(data: UsersData): void {
    ensureDataDir();
    writeJsonFileAtomic(USERS_FILE, normalizeUsersData(data));
}

function getOwnedAccountCount(username: string): number {
    const { loadAccounts, normalizeAccountsData } = require('./store/accounts');
    const data = normalizeAccountsData(loadAccounts());
    return data.accounts.filter((account: Account) => account.owner === username).length;
}

function isUsernameReserved(username: string): boolean {
    const adminStore = require('./admin-store');
    return username.toLowerCase() === 'admin' || username === adminStore.getAdminInfo().username;
}

function validateNewUsername(username: string, users: UserRecord[]): string | null {
    if (!username || username.length < 3 || username.length > 32) return '用户名长度需在3-32位之间';
    if (!/^\w+$/.test(username)) return '用户名只能包含字母、数字和下划线';
    if (isUsernameReserved(username)) return '该用户名不可用';
    if (users.some(user => user.username === username)) return '用户名已存在';
    return null;
}

function checkUserLockout(username: string): { locked: boolean; remainingMs?: number; message?: string } {
    const record = userLockouts.get(username);
    const now = Date.now();
    if (record?.lockedUntil && record.lockedUntil > now) {
        const remainingMs = record.lockedUntil - now;
        return { locked: true, remainingMs, message: `账户已被锁定，请 ${Math.ceil(remainingMs / 60000)} 分钟后重试` };
    }
    if (record && record.lockedUntil && record.lockedUntil <= now) {
        userLockouts.delete(username);
    }
    return { locked: false };
}

function recordUserFailedAttempt(username: string): { locked: boolean; message?: string; remainingAttempts?: number } {
    const now = Date.now();
    const record = userLockouts.get(username) || { count: 0, lockedUntil: 0 };
    record.count++;
    if (record.count >= MAX_LOGIN_ATTEMPTS) {
        record.lockedUntil = now + LOCKOUT_DURATION;
        record.count = 0;
        userLockouts.set(username, record);
        return { locked: true, message: `登录失败次数过多，账户已被锁定 ${LOCKOUT_DURATION / 60000} 分钟` };
    }
    userLockouts.set(username, record);
    return { locked: false, remainingAttempts: MAX_LOGIN_ATTEMPTS - record.count };
}

function clearUserFailedAttempts(username: string): void {
    userLockouts.delete(username);
}

function isUserExpired(user: UserRecord, now: number = Date.now()): boolean {
    return typeof user.card.expiresAt === 'number' && user.card.expiresAt > 0 && user.card.expiresAt < now;
}

/**
 * 使用时间卡密注册普通用户。
 */
function registerUser(username: unknown, password: unknown, cardCode: unknown): any {
    const name = String(username || '').trim();
    const data = loadUsers();

    const usernameError = validateNewUsername(name, data.users);
    if (usernameError) return { ok: false, error: usernameError };

    const strength = security.validatePasswordStrength(String(password || ''));
    if (!strength.valid) return { ok: false, error: strength.errors.join('；') };

    const card = cardStore.getCardByCode(cardCode);
    const invalid = cardStore.validateCardForUse(card);
    if (invalid || !card) return { ok: false, error: invalid || '卡密不存在' };
    if (card.type === 'quota') {
        return { ok: false, error: '注册只能使用时间卡密，额度卡密请登录后在续费中使用' };
    }

    const now = Date.now();
    const duration = cardStore.normalizeTimeDuration(card);
    const expiresAt = cardStore.computeNextExpiresAt(undefined, duration, now);
    const user: UserRecord = {
        username: name,
        password: security.hashPassword(String(password)),
        role: 'user',
        enabled: true,
        card: {
            code: card.code,
            description: card.description,
            expiresAt,
            isPermanent: expiresAt === null,
        },
        accountLimit: DEFAULT_USER_ACCOUNT_LIMIT,
        createdAt: now,
        updatedAt: now,
    };

    data.users.push(user);
    saveUsers(data);
    cardStore.markCardUsed(card, name, name, now);
    clearUserFailedAttempts(name);

    return {
        ok: true,
        user: toPublicUser(user),
    };
}

function toPublicUser(user: UserRecord) {
    return {
        username: user.username,
        role: user.role,
        enabled: user.enabled,
        card: { ...user.card },
        accountLimit: user.accountLimit,
        gameAccountCount: getOwnedAccountCount(user.username),
        createdAt: user.createdAt,
        expired: isUserExpired(user),
    };
}

/**
 * 普通用户登录验证。
 */
function validateUser(username: unknown, password: unknown, ip: string = 'unknown'): any {
    security.loadLoginAttempts();
    const rateLimit = security.checkRateLimit(ip);
    if (!rateLimit.allowed) return { error: 'rate_limit', ...rateLimit };

    const name = String(username || '').trim();
    const lockout = checkUserLockout(name);
    if (lockout.locked) return { error: 'locked', ...lockout };

    const user = loadUsers().users.find(item => item.username === name);
    if (!user || !security.verifyPassword(String(password || ''), user.password)) {
        const attempt = recordUserFailedAttempt(name);
        return attempt.locked
            ? { error: 'locked', message: attempt.message }
            : { error: 'invalid_credentials', message: `用户名或密码错误，剩余尝试次数: ${attempt.remainingAttempts}` };
    }
    if (!user.enabled) {
        return { error: 'disabled', message: '账号已被管理员停用，请联系管理员' };
    }
    if (isUserExpired(user)) {
        return { error: 'expired', message: '账号已到期，请使用时间卡密续费后登录' };
    }

    clearUserFailedAttempts(name);
    if (security.needsRehash(user.password)) {
        user.password = security.hashPassword(String(password));
        const data = loadUsers();
        const target = data.users.find(item => item.username === name);
        if (target) {
            target.password = user.password;
            saveUsers(data);
        }
    }
    return { ok: true, user: toPublicUser(user) };
}

/**
 * 使用卡密续费：时间卡叠加有效期，额度卡提升账号上限。
 */
function renewUser(username: unknown, cardCode: unknown): any {
    const name = String(username || '').trim();
    const data = loadUsers();
    const user = data.users.find(item => item.username === name);
    if (!user) return { ok: false, error: '用户不存在' };

    const card = cardStore.getCardByCode(cardCode);
    const invalid = cardStore.validateCardForUse(card);
    if (invalid || !card) return { ok: false, error: invalid || '卡密不存在' };

    const now = Date.now();
    if (card.type === 'quota') {
        user.accountLimit = user.accountLimit + cardStore.getQuotaValue(card);
    } else {
        const duration = cardStore.normalizeTimeDuration(card);
        const expiresAt = cardStore.computeNextExpiresAt(user.card.expiresAt, duration, now);
        user.card = {
            code: card.code,
            description: card.description,
            expiresAt,
            isPermanent: expiresAt === null,
        };
    }
    user.updatedAt = now;
    saveUsers(data);
    cardStore.markCardUsed(card, name, name, now);

    return { ok: true, user: toPublicUser(user), cardType: card.type };
}

function getAllUsers(): any[] {
    return loadUsers().users.map(toPublicUser);
}

function findUser(username: unknown): UserRecord | null {
    const name = String(username || '').trim();
    return loadUsers().users.find(item => item.username === name) || null;
}

function getUserInfo(username: unknown): any | null {
    const user = findUser(username);
    return user ? toPublicUser(user) : null;
}

/**
 * 管理员编辑用户：到期时间、启用状态、账号上限、重置密码。
 */
function editUser(username: unknown, updates: Record<string, unknown> = {}): any | null {
    const name = String(username || '').trim();
    const data = loadUsers();
    const user = data.users.find(item => item.username === name);
    if (!user) return null;

    const now = Date.now();
    if (updates.expiresAt !== undefined) {
        if (updates.expiresAt === null || updates.expiresAt === '') {
            user.card.expiresAt = null;
            user.card.isPermanent = true;
        } else {
            const value = Number(updates.expiresAt);
            if (!Number.isFinite(value) || value <= 0) {
                throw new Error('到期时间无效，请使用时间戳或选择永久');
            }
            user.card.expiresAt = Math.floor(value);
            user.card.isPermanent = false;
        }
        user.updatedAt = now;
    }
    if (updates.enabled !== undefined) {
        user.enabled = updates.enabled === true;
        user.updatedAt = now;
    }
    if (updates.accountLimit !== undefined) {
        user.accountLimit = Math.max(1, Number.parseInt(String(updates.accountLimit), 10) || DEFAULT_USER_ACCOUNT_LIMIT);
        user.updatedAt = now;
    }
    if (updates.newPassword !== undefined && String(updates.newPassword || '').trim()) {
        const strength = security.validatePasswordStrength(String(updates.newPassword));
        if (!strength.valid) throw new Error(strength.errors.join('；'));
        user.password = security.hashPassword(String(updates.newPassword));
        user.updatedAt = now;
        clearUserFailedAttempts(name);
    }
    saveUsers(data);
    return toPublicUser(user);
}

function changeUserPassword(username: unknown, currentPassword: unknown, newPassword: unknown): { ok: boolean; error?: string; message?: string } {
    const user = findUser(username);
    if (!user) return { ok: false, error: '用户不存在' };
    if (!security.verifyPassword(String(currentPassword || ''), user.password)) {
        return { ok: false, error: '当前密码错误' };
    }
    const strength = security.validatePasswordStrength(String(newPassword || ''));
    if (!strength.valid) return { ok: false, error: strength.errors.join('；') };
    const data = loadUsers();
    const target = data.users.find(item => item.username === user.username);
    if (!target) return { ok: false, error: '用户不存在' };
    target.password = security.hashPassword(String(newPassword));
    target.updatedAt = Date.now();
    saveUsers(data);
    return { ok: true, message: '密码修改成功' };
}

/**
 * 删除用户；名下仍有游戏账号时需显式 force 连同账号一起删除。
 */
function deleteUser(username: unknown, force: boolean = false): { ok: boolean; error?: string; removedAccounts?: number } {
    const name = String(username || '').trim();
    const data = loadUsers();
    const exists = data.users.some(item => item.username === name);
    if (!exists) return { ok: false, error: '用户不存在' };

    const { loadAccounts, normalizeAccountsData, saveAccounts, deleteAccount } = require('./store/accounts');
    const accountsData = normalizeAccountsData(loadAccounts());
    const owned = accountsData.accounts.filter((account: Account) => account.owner === name);
    if (owned.length > 0 && !force) {
        return { ok: false, error: `该用户名下还有 ${owned.length} 个游戏账号，请先删除或选择连同账号一起删除` };
    }
    for (const account of owned) {
        deleteAccount(account.id);
    }
    saveUsers({ users: data.users.filter(item => item.username !== name) });
    return { ok: true, removedAccounts: owned.length };
}

function getExpiredUsernames(now: number = Date.now()): string[] {
    return loadUsers().users
        .filter(user => user.enabled && isUserExpired(user, now))
        .map(user => user.username);
}

module.exports = {
    DAY_MS,
    DEFAULT_USER_ACCOUNT_LIMIT,
    USERS_FILE,
    registerUser,
    validateUser,
    renewUser,
    getAllUsers,
    findUser,
    getUserInfo,
    editUser,
    changeUserPassword,
    deleteUser,
    getExpiredUsernames,
    isUserExpired,
    getOwnedAccountCount,
};
