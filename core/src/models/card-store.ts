import type { Account } from '../types/account';
import type { CardSettings } from '../types/config';
export {};

/**
 * 卡密系统（移植自时间卡/额度卡模型，绑定对象为游戏账号）。
 * - 时间卡：为指定游戏账号续期；永久卡解除到期时间。
 * - 额度卡：提升实例级游戏账号数量上限。
 */

const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../services/json-db');
const sharedState = require('./store/shared-state');

const CARDS_FILE: string = getDataFile('cards.json');

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;

const CARD_CODE_LENGTH: number = 16;
// 去除易混淆字符（0/O、1/I/L），降低人工抄写错误。
const CARD_CODE_CHARS: string = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

interface CardRecord {
    code: string;
    description: string;
    type: 'time' | 'quota';
    /** 时间卡：折算天数；额度卡：等于 value。 */
    days: number;
    durationValue: number;
    durationUnit: 'day' | 'hour';
    durationMs: number | null;
    isPermanent: boolean;
    value: number | null;
    enabled: boolean;
    createdAt: number;
    usedBy: string;
    usedByName: string;
    usedAt: number | null;
}

interface CardsData {
    cards: CardRecord[];
}

interface DurationLike {
    days?: unknown;
    durationValue?: unknown;
    durationUnit?: unknown;
    durationMs?: unknown;
    isPermanent?: unknown;
    allowZero?: boolean;
}

interface NormalizedDuration {
    days: number;
    durationValue: number;
    durationUnit: 'day' | 'hour';
    durationMs: number | null;
    isPermanent: boolean;
}

function generateCardCode(): string {
    let code = '';
    for (let i = 0; i < CARD_CODE_LENGTH; i++) {
        code += CARD_CODE_CHARS.charAt(Math.floor(Math.random() * CARD_CODE_CHARS.length));
    }
    return code;
}

function normalizeDurationUnit(unit: unknown): 'day' | 'hour' {
    return unit === 'hour' ? 'hour' : 'day';
}

function toPositiveNumber(value: unknown, fallback: number = 1): number {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : fallback;
}

/**
 * 归一化时间卡时长：支持永久（-1 / isPermanent）、durationMs 或 数值+单位 三种输入。
 */
function normalizeTimeDuration(input: DurationLike = {}): NormalizedDuration {
    const isPermanent = input.isPermanent === true
        || Number(input.durationValue) === -1
        || Number(input.days) === -1;

    if (isPermanent) {
        return { days: -1, durationValue: -1, durationUnit: 'day', durationMs: null, isPermanent: true };
    }

    if (Number.isFinite(Number(input.durationMs)) && Number(input.durationMs) > 0) {
        const durationMs = Number(input.durationMs);
        const durationUnit = normalizeDurationUnit(input.durationUnit);
        const durationValue = Number.isFinite(Number(input.durationValue)) && Number(input.durationValue) > 0
            ? Number(input.durationValue)
            : durationMs / (durationUnit === 'hour' ? HOUR_MS : DAY_MS);
        return { days: durationMs / DAY_MS, durationValue, durationUnit, durationMs, isPermanent: false };
    }

    const durationUnit = input.durationUnit !== undefined ? normalizeDurationUnit(input.durationUnit) : 'day';
    const rawValue = input.durationValue !== undefined ? input.durationValue : input.days;
    const rawNumber = Number(rawValue);
    const durationValue = input.allowZero === true && Number.isFinite(rawNumber) && rawNumber >= 0
        ? rawNumber
        : toPositiveNumber(rawValue, 1);
    const durationMs = durationUnit === 'hour' ? durationValue * HOUR_MS : durationValue * DAY_MS;
    return { days: durationMs / DAY_MS, durationValue, durationUnit, durationMs, isPermanent: false };
}

/**
 * 计算账号续期后的到期时间（纯函数）。
 * - 卡密永久或账号已永久 → null（永不过期）
 * - 其余情况从 max(当前到期, 现在) 起叠加
 */
function computeNextExpiresAt(currentExpiresAt: unknown, duration: NormalizedDuration, now: number): number | null {
    if (duration.isPermanent) return null;
    if (currentExpiresAt === null) return null;
    const base = Number.isFinite(Number(currentExpiresAt)) && Number(currentExpiresAt) > now
        ? Number(currentExpiresAt)
        : now;
    return base + Number(duration.durationMs || 0);
}

function getQuotaValue(card: CardRecord): number {
    return Math.max(Number.parseInt(String(card?.value ?? card?.days), 10) || 1, 1);
}

function normalizeCard(raw: any): CardRecord {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type: CardRecord['type'] = source.type === 'quota' ? 'quota' : 'time';
    const duration = type === 'time' ? normalizeTimeDuration(source) : null;
    const value = type === 'quota' ? Math.max(Number.parseInt(String(source.value ?? source.days), 10) || 1, 1) : null;
    const code = String(source.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return {
        code: code || generateCardCode(),
        description: String(source.description || '').trim(),
        type,
        days: type === 'quota' ? (value as number) : Number(duration?.days ?? 0),
        durationValue: duration?.durationValue ?? 0,
        durationUnit: duration?.durationUnit ?? 'day',
        durationMs: duration?.durationMs ?? null,
        isPermanent: duration?.isPermanent ?? false,
        value,
        enabled: source.enabled !== false,
        createdAt: Number(source.createdAt) || Date.now(),
        usedBy: String(source.usedBy || ''),
        usedByName: String(source.usedByName || ''),
        usedAt: Number(source.usedAt) || null,
    };
}

function normalizeCardsData(raw: unknown): CardsData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const seen: Set<string> = new Set();
    const cards: CardRecord[] = (Array.isArray(data.cards) ? data.cards : [])
        .map(normalizeCard)
        .filter((card: CardRecord) => {
            if (!card.code || seen.has(card.code)) return false;
            seen.add(card.code);
            return true;
        });
    return { cards };
}

function loadCards(): CardsData {
    ensureDataDir();
    return normalizeCardsData(readJsonFile(CARDS_FILE, () => ({ cards: [] })));
}

function saveCards(data: CardsData): void {
    ensureDataDir();
    writeJsonFileAtomic(CARDS_FILE, normalizeCardsData(data));
}

function getAllCards(): CardRecord[] {
    return loadCards().cards;
}

function getAvailableTimeCardCount(): number {
    return loadCards().cards.filter(card => card.type === 'time' && card.enabled && !card.usedBy).length;
}

function getCardByCode(code: unknown): CardRecord | null {
    const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalized) return null;
    return loadCards().cards.find(card => card.code === normalized) || null;
}

function createCard(description: unknown, options: Record<string, unknown> = {}): CardRecord {
    const type: CardRecord['type'] = options.type === 'quota' ? 'quota' : 'time';
    const isPermanent = type === 'time' && (options.isPermanent === true || Number(options.durationValue) === -1);
    const data = loadCards();

    let card: CardRecord;
    if (type === 'quota') {
        const value = Math.max(Number.parseInt(String(options.value), 10) || 0, 1);
        card = normalizeCard({
            code: generateCardCode(),
            description,
            type,
            value,
            enabled: true,
            createdAt: Date.now(),
        });
    } else if (isPermanent) {
        card = normalizeCard({
            code: generateCardCode(),
            description,
            type,
            durationValue: -1,
            enabled: true,
            createdAt: Date.now(),
        });
    } else {
        card = normalizeCard({
            code: generateCardCode(),
            description,
            type,
            durationValue: options.durationValue,
            durationUnit: options.durationUnit,
            enabled: true,
            createdAt: Date.now(),
        });
        if (!(card.durationMs && card.durationMs > 0)) {
            throw new Error('时间卡时长必须大于 0，永久卡请使用 -1');
        }
    }

    data.cards.push(card);
    saveCards(data);
    return card;
}

function createCardsBatch(description: unknown, count: unknown, options: Record<string, unknown> = {}): CardRecord[] {
    const total = Math.min(Math.max(Number.parseInt(String(count), 10) || 1, 1), 100);
    const cards: CardRecord[] = [];
    for (let i = 0; i < total; i++) {
        cards.push(createCard(description, options));
    }
    return cards;
}

function updateCard(code: unknown, updates: Record<string, unknown> = {}): CardRecord | null {
    const data = loadCards();
    const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const card = data.cards.find(item => item.code === normalized);
    if (!card) return null;
    if (updates.enabled !== undefined) card.enabled = updates.enabled === true;
    if (updates.description !== undefined) card.description = String(updates.description || '').trim();
    saveCards(data);
    return card;
}

function deleteCard(code: unknown): boolean {
    const data = loadCards();
    const normalized = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const next = data.cards.filter(card => card.code !== normalized);
    if (next.length === data.cards.length) return false;
    saveCards({ cards: next });
    return true;
}

function deleteCardsBatch(codes: unknown): { deletedCount: number; notFoundCount: number } {
    if (!Array.isArray(codes) || codes.length === 0) {
        throw new Error('请提供要删除的卡密列表');
    }
    const wanted = new Set(codes.map(code => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')).filter(Boolean));
    const data = loadCards();
    const next = data.cards.filter(card => !wanted.has(card.code));
    const deletedCount = data.cards.length - next.length;
    saveCards({ cards: next });
    return { deletedCount, notFoundCount: wanted.size - deletedCount };
}

function markCardUsed(card: CardRecord, accountId: string, accountName: string, now: number): void {
    const data = loadCards();
    const target = data.cards.find(item => item.code === card.code);
    if (!target) return;
    target.usedBy = accountId;
    target.usedByName = accountName;
    target.usedAt = now;
    saveCards(data);
}

/**
 * 校验卡密可用于核销；返回错误文案或 null。
 */
function validateCardForUse(card: CardRecord | null): string | null {
    if (!card) return '卡密不存在';
    if (!card.enabled) return '卡密已被禁用';
    if (card.usedBy) return '卡密已被使用';
    return null;
}

/**
 * 核销额度卡：提升实例账号上限并标记卡密已用。
 */
function consumeQuotaCard(card: CardRecord, now: number = Date.now()): { accountLimit: number } {
    const settings: CardSettings = sharedState.globalConfig.cardSettings;
    const nextLimit = Math.max(0, Number.parseInt(String(settings.accountLimit), 10) || 0) + getQuotaValue(card);
    markCardUsed(card, 'instance', '实例额度', now);
    return { accountLimit: nextLimit };
}

/**
 * 计算时间卡作用到账号后的到期时间（不落盘）。
 */
function previewTimeCardExpiresAt(card: CardRecord, account: Account | null | undefined, now: number = Date.now()): number | null {
    const duration = normalizeTimeDuration(card);
    return computeNextExpiresAt(account ? account.expiresAt : undefined, duration, now);
}

/**
 * 核销卡密（统一入口）：
 * - 额度卡：不需要账号，直接提升实例上限。
 * - 时间卡：需要 accountId，叠加到该账号到期时间并落盘。
 */
function useCard(code: unknown, accountId: unknown, getAccountById?: (id: string) => Account | null): any {
    const card = getCardByCode(code);
    const invalid = validateCardForUse(card);
    if (invalid || !card) return { ok: false, error: invalid || '卡密不存在' };

    const now = Date.now();
    if (card.type === 'quota') {
        const result = consumeQuotaCard(card, now);
        return { ok: true, cardType: 'quota', card, accountLimit: result.accountLimit };
    }

    const id = String(accountId || '').trim();
    if (!id) return { ok: false, error: '时间卡密需要指定绑定的账号' };
    const account = typeof getAccountById === 'function' ? getAccountById(id) : null;
    if (!account) return { ok: false, error: '绑定的账号不存在' };

    const expiresAt = previewTimeCardExpiresAt(card, account, now);
    const duration = normalizeTimeDuration(card);
    const updated = applyAccountExpiresAt(id, expiresAt);
    if (!updated) return { ok: false, error: '账号不存在，续期失败' };

    markCardUsed(card, String(account.id), String(account.name || account.id), now);
    return { ok: true, cardType: 'time', card, account: updated, isPermanent: duration.isPermanent, expiresAt };
}

function applyAccountExpiresAt(accountId: string, expiresAt: number | null): Account | null {
    const { loadAccounts, saveAccounts, normalizeAccountsData } = require('./store/accounts');
    const data = normalizeAccountsData(loadAccounts());
    const account = data.accounts.find((item: Account) => item.id === String(accountId));
    if (!account) return null;
    if (expiresAt === null) {
        account.expiresAt = null;
    } else if (Number.isFinite(Number(expiresAt)) && Number(expiresAt) > 0) {
        account.expiresAt = Number(expiresAt);
    } else {
        delete account.expiresAt;
    }
    saveAccounts(data);
    return account;
}

/**
 * 新建账号后直接激活时间卡：从当前时间起算到期时间并标记卡密已用。
 */
function activateTimeCardForAccount(card: CardRecord, accountId: string, accountName: string, now: number = Date.now()): Account | null {
    const expiresAt = computeNextExpiresAt(undefined, normalizeTimeDuration(card), now);
    const updated = applyAccountExpiresAt(String(accountId), expiresAt);
    if (updated) markCardUsed(card, String(accountId), String(accountName || accountId), now);
    return updated;
}

function getExpiredAccountIds(now: number = Date.now()): string[] {
    const { loadAccounts, normalizeAccountsData } = require('./store/accounts');
    const data = normalizeAccountsData(loadAccounts());
    return data.accounts
        .filter((account: Account) => typeof account.expiresAt === 'number' && account.expiresAt > 0 && account.expiresAt < now)
        .map((account: Account) => account.id);
}

module.exports = {
    DAY_MS,
    HOUR_MS,
    CARDS_FILE,
    generateCardCode,
    normalizeTimeDuration,
    normalizeCard,
    computeNextExpiresAt,
    getQuotaValue,
    loadCards,
    saveCards,
    getAllCards,
    getAvailableTimeCardCount,
    getCardByCode,
    createCard,
    createCardsBatch,
    updateCard,
    deleteCard,
    deleteCardsBatch,
    validateCardForUse,
    consumeQuotaCard,
    previewTimeCardExpiresAt,
    useCard,
    applyAccountExpiresAt,
    activateTimeCardForAccount,
    markCardUsed,
    getExpiredAccountIds,
};
