export interface QqFriendGidArchiveEntry { gid: string, gids: number[], updatedAt: number }
interface QqFriendGidArchiveData { entries: QqFriendGidArchiveEntry[] }
export {};

/**
 * QQ 好友 GID 本地档案（core/data/qq-friend-gids.json）。
 *
 * - 唯一写入来源是抓包登录完成时的后台好友同步（capture collectQqFriendGids）；
 *   其他登录方式（填 code、QQ 扫码、萌卡取码）只读取，不更新。
 * - 档案 key 为账号自身的游戏 gid：抓包链路与游戏协议均拿不到 QQ 号，
 *   而 gid 与 QQ 一一对应且跨登录方式稳定，作用等同 QQ 身份识别。
 * - 微信账号不进入存档与读取链路。
 */
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const ARCHIVE_FILE: string = getDataFile('qq-friend-gids.json');
const MAX_ENTRIES: number = 500;

/** 校验并归一化档案 key（账号自身游戏 gid，十进制数字串） */
export function normalizeQqFriendGidKey(value: unknown): string {
    const key = String(value ?? '').trim();
    return /^\d{1,19}$/.test(key) ? key : '';
}

export function normalizeQqFriendGidArchiveData(raw: unknown): QqFriendGidArchiveData {
    const data: any = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set<string>();
    const entries: QqFriendGidArchiveEntry[] = [];
    for (const item of (Array.isArray(data.entries) ? data.entries : [])) {
        const gid = normalizeQqFriendGidKey(item?.gid);
        if (!gid || seen.has(gid)) continue;
        const gids: number[] = [];
        for (const value of (Array.isArray(item?.gids) ? item.gids : [])) {
            const num = Number(value);
            if (Number.isSafeInteger(num) && num > 0 && !gids.includes(num)) gids.push(num);
        }
        if (!gids.length) continue;
        seen.add(gid);
        entries.push({ gid, gids, updatedAt: Number(item?.updatedAt) || Date.now() });
    }
    // 超出容量时保留最近更新的档案
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    return { entries: entries.slice(0, MAX_ENTRIES) };
}

function loadArchive(): QqFriendGidArchiveData {
    ensureDataDir();
    return normalizeQqFriendGidArchiveData(readJsonFile(ARCHIVE_FILE, () => ({ entries: [] })));
}

function saveArchive(data: QqFriendGidArchiveData): void {
    ensureDataDir();
    writeJsonFileAtomic(ARCHIVE_FILE, normalizeQqFriendGidArchiveData(data));
}

function findQqFriendGidArchive(key: unknown): QqFriendGidArchiveEntry | null {
    const target = normalizeQqFriendGidKey(key);
    if (!target) return null;
    return loadArchive().entries.find(item => item.gid === target) || null;
}

/** 合并写入一个账号的好友 GID 档案，返回合并后的 GID 列表 */
function saveQqFriendGidArchive(key: unknown, gids: unknown): number[] {
    const target = normalizeQqFriendGidKey(key);
    const incoming: number[] = (Array.isArray(gids) ? gids : [])
        .map((item: any) => Number(item))
        .filter((num: number) => Number.isSafeInteger(num) && num > 0);
    if (!target || !incoming.length) return [];
    const data = loadArchive();
    const existing = data.entries.find(item => item.gid === target);
    const merged = Array.from(new Set([...(existing?.gids || []), ...incoming]));
    const entry: QqFriendGidArchiveEntry = { gid: target, gids: merged, updatedAt: Date.now() };
    const next = data.entries.filter(item => item.gid !== target);
    next.unshift(entry);
    saveArchive({ entries: next });
    return merged;
}

module.exports = {
    normalizeQqFriendGidKey,
    normalizeQqFriendGidArchiveData,
    findQqFriendGidArchive,
    saveQqFriendGidArchive,
};
