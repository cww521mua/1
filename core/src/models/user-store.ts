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
const REFERRAL_IPS_FILE: string = getDataFile('referral-ips.json');

const DAY_MS: number = 24 * 60 * 60 * 1000;
const HOUR_MS: number = 60 * 60 * 1000;
const DEFAULT_USER_ACCOUNT_LIMIT: number = 2;

// 推广体系：体验时长、代理门槛、推荐奖励
const REFERRAL_TRIAL_MS: number = HOUR_MS;
const REFERRAL_AGENT_TARGET: number = 10;
const REFERRAL_QUALIFY_CARD_MS: number = 30 * DAY_MS;
const REFERRAL_REWARD_MS: number = 5 * DAY_MS;
// 被推广人奖励：使用 ≥30 天时间卡注册/续费时，本人额外获得的时长
const REFERRAL_REFEREE_BONUS_MS: number = 2 * DAY_MS;
const REFERRAL_CODE_LENGTH: number = 8;

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
    /** 推广码（懒生成，全局唯一） */
    referralCode?: string;
    /** 注册时所用的推广码归属人 */
    referredBy?: string;
    /** 首次有效购买（核销 ≥30 天时间卡）时间 */
    validPurchaseAt?: number | null;
    /** 代理身份：有效推广满 REFERRAL_AGENT_TARGET 人自动获得，或管理员手动授予 */
    isAgent?: boolean;
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
    const user: UserRecord = {
        username,
        password: String(source.password),
        role: 'user',
        enabled: source.enabled !== false,
        card: normalizeUserCard(source.card),
        accountLimit: Math.max(1, Number.parseInt(source.accountLimit, 10) || DEFAULT_USER_ACCOUNT_LIMIT),
        createdAt: Number(source.createdAt) || Date.now(),
        updatedAt: Number(source.updatedAt) || Date.now(),
    };
    const referralCode = String(source.referralCode || '').trim();
    if (referralCode) user.referralCode = referralCode;
    const referredBy = String(source.referredBy || '').trim();
    if (referredBy) user.referredBy = referredBy;
    if (source.validPurchaseAt !== undefined && source.validPurchaseAt !== null && Number(source.validPurchaseAt) > 0) {
        user.validPurchaseAt = Number(source.validPurchaseAt);
    }
    if (source.isAgent === true) user.isAgent = true;
    return user;
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
function registerUser(username: unknown, password: unknown, cardCode: unknown, refCode?: unknown): any {
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
    let expiresAt = cardStore.computeNextExpiresAt(undefined, duration, now);

    // 可选推广码：填写即绑定邀请关系；30 天及以上卡密注册直接计为有效购买
    let referrer: UserRecord | null = null;
    const ref = String(refCode || '').trim().toUpperCase();
    if (ref) {
        referrer = findByReferralCode(ref);
        if (!referrer) return { ok: false, error: '推广码无效' };
        if (referrer.username === name) return { ok: false, error: '不能使用自己的推广码' };
    }

    const qualifies = duration.isPermanent || Number(duration.durationMs || 0) >= REFERRAL_QUALIFY_CARD_MS;
    // 被推广人奖励：使用 ≥30 天时间卡注册 → 本人在卡密时长之外额外 +2 天（永久卡无需加）
    if (referrer && qualifies && expiresAt !== null) {
        expiresAt += REFERRAL_REFEREE_BONUS_MS;
    }

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
        referredBy: referrer ? referrer.username : undefined,
        createdAt: now,
        updatedAt: now,
    };

    if (referrer && qualifies) {
        user.validPurchaseAt = now;
    }

    data.users.push(user);
    if (referrer && qualifies) {
        rewardReferrer(data, user, now);
    }
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
        referredBy: user.referredBy || '',
        validPurchase: !!user.validPurchaseAt,
        isAgent: user.isAgent === true,
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
    let qualifyingDurationMs = 0;
    if (card.type === 'quota') {
        user.accountLimit = user.accountLimit + cardStore.getQuotaValue(card);
    } else {
        const duration = cardStore.normalizeTimeDuration(card);
        qualifyingDurationMs = duration.isPermanent ? Number.MAX_SAFE_INTEGER : Number(duration.durationMs || 0);
        let expiresAt = cardStore.computeNextExpiresAt(user.card.expiresAt, duration, now);
        // 被推广人奖励：使用 ≥30 天时间卡续费 → 本人在叠加时长之外额外 +2 天（永久卡无需加）
        if (qualifyingDurationMs >= REFERRAL_QUALIFY_CARD_MS && user.referredBy && expiresAt !== null) {
            expiresAt += REFERRAL_REFEREE_BONUS_MS;
        }
        user.card = {
            code: card.code,
            description: card.description,
            expiresAt,
            isPermanent: expiresAt === null,
        };
    }
    user.updatedAt = now;

    // 推广奖励：被推广人核销 ≥30 天（或永久）时间卡 → 推广人账号 +5 天
    let referrerRewarded = false;
    if (card.type === 'time' && qualifyingDurationMs >= REFERRAL_QUALIFY_CARD_MS && user.referredBy) {
        const result = rewardReferrer(data, user, now);
        referrerRewarded = result;
    }

    saveUsers(data);
    cardStore.markCardUsed(card, name, name, now);

    return { ok: true, user: toPublicUser(user), cardType: card.type, referrerRewarded };
}

// ==================== 推广体系 ====================

function generateReferralCode(users: UserRecord[]): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    for (let attempt = 0; attempt < 50; attempt++) {
        let code = '';
        for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        if (!users.some(user => user.referralCode === code)) return code;
    }
    throw new Error('推广码生成失败，请重试');
}

function ensureReferralCode(user: UserRecord, users: UserRecord[]): string {
    if (user.referralCode) return user.referralCode;
    user.referralCode = generateReferralCode(users);
    user.updatedAt = Date.now();
    saveUsers({ users });
    return user.referralCode;
}

function findByReferralCode(code: unknown): UserRecord | null {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized) return null;
    return loadUsers().users.find(user => user.referralCode === normalized) || null;
}

interface ReferralIpRecord {
    username: string;
    at: number;
}

function loadReferralIps(): Record<string, ReferralIpRecord> {
    const raw = readJsonFile(REFERRAL_IPS_FILE, () => ({}));
    return raw && typeof raw === 'object' ? raw as Record<string, ReferralIpRecord> : {};
}

function saveReferralIps(ips: Record<string, ReferralIpRecord>): void {
    ensureDataDir();
    writeJsonFileAtomic(REFERRAL_IPS_FILE, ips);
}

/**
 * 使用推广码注册：免卡密，赠送体验时长；每个 IP 仅允许注册一个推广账号。
 */
function registerUserByReferral(username: unknown, password: unknown, refCode: unknown, ip: string = 'unknown'): any {
    const name = String(username || '').trim();
    const data = loadUsers();

    const usernameError = validateNewUsername(name, data.users);
    if (usernameError) return { ok: false, error: usernameError };

    const strength = security.validatePasswordStrength(String(password || ''));
    if (!strength.valid) return { ok: false, error: strength.errors.join('；') };

    const referrer = findByReferralCode(refCode);
    if (!referrer) return { ok: false, error: '推广码无效' };

    const ips = loadReferralIps();
    const ipKey = String(ip || 'unknown').trim();
    if (ips[ipKey]) {
        return { ok: false, error: '该网络已使用推广链接注册过账号' };
    }

    const now = Date.now();
    const expiresAt = now + REFERRAL_TRIAL_MS;
    const user: UserRecord = {
        username: name,
        password: security.hashPassword(String(password)),
        role: 'user',
        enabled: true,
        card: {
            code: 'REFERRAL',
            description: `推广注册体验（邀请人 ${referrer.username}）`,
            expiresAt,
            isPermanent: false,
        },
        accountLimit: DEFAULT_USER_ACCOUNT_LIMIT,
        referredBy: referrer.username,
        createdAt: now,
        updatedAt: now,
    };

    data.users.push(user);
    saveUsers(data);
    ips[ipKey] = { username: name, at: now };
    saveReferralIps(ips);
    clearUserFailedAttempts(name);

    return { ok: true, user: toPublicUser(user) };
}

/**
 * 被推广人核销 ≥30 天时间卡后，给推广人账号续 5 天，并记录有效购买。
 */
function rewardReferrer(data: UsersData, referredUser: UserRecord, now: number): boolean {
    const referrer = data.users.find(item => item.username === referredUser.referredBy);
    if (!referrer) return false;

    if (referrer.card.expiresAt !== null) {
        const base = referrer.card.expiresAt > now ? referrer.card.expiresAt : now;
        referrer.card.expiresAt = base + REFERRAL_REWARD_MS;
        referrer.card.isPermanent = false;
        referrer.updatedAt = now;
    }

    if (!referredUser.validPurchaseAt) {
        referredUser.validPurchaseAt = now;
    }

    // 有效推广满目标人数自动升级代理
    const validCount = data.users.filter(item => item.referredBy === referrer.username && item.validPurchaseAt).length;
    if (validCount >= REFERRAL_AGENT_TARGET) {
        referrer.isAgent = true;
    }
    return true;
}

/**
 * 推广概览：推广码、绑定的被推广人列表、有效推广数与代理状态。
 */
function getReferralOverview(username: unknown): any {
    const data = loadUsers();
    const user = data.users.find(item => item.username === String(username || '').trim());
    if (!user) return null;
    const referralCode = ensureReferralCode(user, data.users);

    const referred = data.users
        .filter(item => item.referredBy === user.username)
        .map(item => ({
            username: item.username,
            createdAt: item.createdAt,
            validPurchase: !!item.validPurchaseAt,
            validPurchaseAt: item.validPurchaseAt || null,
            expired: isUserExpired(item),
            enabled: item.enabled,
        }))
        .sort((a: any, b: any) => b.createdAt - a.createdAt);

    const validCount = referred.filter((item: any) => item.validPurchase).length;
    return {
        referralCode,
        referred,
        validCount,
        agentRequired: REFERRAL_AGENT_TARGET,
        isAgent: user.isAgent === true,
        qualifyCardDays: REFERRAL_QUALIFY_CARD_MS / DAY_MS,
        rewardDays: REFERRAL_REWARD_MS / DAY_MS,
    };
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
    if (updates.isAgent !== undefined) {
        user.isAgent = updates.isAgent === true;
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
    registerUserByReferral,
    validateUser,
    renewUser,
    getAllUsers,
    findUser,
    getUserInfo,
    findByReferralCode,
    getReferralOverview,
    editUser,
    changeUserPassword,
    deleteUser,
    getExpiredUsernames,
    isUserExpired,
    getOwnedAccountCount,
};
