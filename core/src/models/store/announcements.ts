export {};
/**
 * 系统公告存储（core/data/announcements.json）。
 * 管理员在设置页「公告管理」发布/编辑/删除；所有登录用户在顶栏公告图标处查看，
 * 新公告以红点提醒，用户打开公告列表即标记已读。
 */
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const ANNOUNCEMENTS_FILE: string = getDataFile('announcements.json');
const READS_FILE: string = getDataFile('announcement-reads.json');

const MAX_ANNOUNCEMENTS = 50;
const TITLE_MAX = 60;
const CONTENT_MAX = 2000;

export interface Announcement {
    id: string;
    title: string;
    content: string;
    createdAt: number;
    updatedAt: number;
}

function normalizeAnnouncement(raw: any): Announcement | null {
    const title = String(raw?.title ?? '').trim();
    const content = String(raw?.content ?? '').trim();
    const id = String(raw?.id ?? '').trim();
    if (!id || !title) return null;
    const createdAt = Number(raw?.createdAt);
    const updatedAt = Number(raw?.updatedAt);
    return {
        id,
        title: title.slice(0, TITLE_MAX),
        content: content.slice(0, CONTENT_MAX),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
        updatedAt: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.floor(updatedAt) : Date.now(),
    };
}

function loadAnnouncements(): Announcement[] {
    ensureDataDir();
    const raw = readJsonFile(ANNOUNCEMENTS_FILE, () => []);
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map(normalizeAnnouncement)
        .filter((item): item is Announcement => item !== null)
        .sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt)
        .slice(0, MAX_ANNOUNCEMENTS);
}

function saveAnnouncements(list: Announcement[]): void {
    writeJsonFileAtomic(ANNOUNCEMENTS_FILE, list);
}

function getAnnouncements(): Announcement[] {
    return loadAnnouncements();
}

function newId(): string {
    return crypto.randomBytes(8).toString('hex');
}

function addAnnouncement(input: { title?: unknown, content?: unknown }): { ok: boolean, error?: string, announcements?: Announcement[] } {
    const title = String(input?.title ?? '').trim();
    const content = String(input?.content ?? '').trim();
    if (!title) return { ok: false, error: '请输入公告标题' };
    if (!content) return { ok: false, error: '请输入公告内容' };
    const list = loadAnnouncements();
    const now = Date.now();
    list.unshift({
        id: newId(),
        title: title.slice(0, TITLE_MAX),
        content: content.slice(0, CONTENT_MAX),
        createdAt: now,
        updatedAt: now,
    });
    const saved = list.slice(0, MAX_ANNOUNCEMENTS);
    saveAnnouncements(saved);
    return { ok: true, announcements: saved };
}

function updateAnnouncement(id: unknown, input: { title?: unknown, content?: unknown }): { ok: boolean, error?: string, announcements?: Announcement[] } {
    const targetId = String(id ?? '').trim();
    const title = String(input?.title ?? '').trim();
    const content = String(input?.content ?? '').trim();
    if (!targetId) return { ok: false, error: '缺少公告 ID' };
    if (!title) return { ok: false, error: '请输入公告标题' };
    if (!content) return { ok: false, error: '请输入公告内容' };
    const list = loadAnnouncements();
    const target = list.find(item => item.id === targetId);
    if (!target) return { ok: false, error: '公告不存在' };
    target.title = title.slice(0, TITLE_MAX);
    target.content = content.slice(0, CONTENT_MAX);
    target.updatedAt = Date.now();
    saveAnnouncements(list);
    return { ok: true, announcements: list };
}

function deleteAnnouncement(id: unknown): { ok: boolean, error?: string, announcements?: Announcement[] } {
    const targetId = String(id ?? '').trim();
    if (!targetId) return { ok: false, error: '缺少公告 ID' };
    const list = loadAnnouncements();
    const next = list.filter(item => item.id !== targetId);
    if (next.length === list.length) return { ok: false, error: '公告不存在' };
    saveAnnouncements(next);
    return { ok: true, announcements: next };
}

// ==================== 已读状态（按用户名，含管理员） ====================

function cleanUsername(username: unknown): string {
    return String(username ?? '').trim().slice(0, 40);
}

function loadReads(): Record<string, number> {
    ensureDataDir();
    const raw = readJsonFile(READS_FILE, () => ({}));
    const out: Record<string, number> = {};
    if (raw && typeof raw === 'object') {
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            const num = Number(value);
            if (key && Number.isFinite(num) && num > 0) out[key] = Math.floor(num);
        }
    }
    return out;
}

/** 用户公告已读时间（未读过返回 0）。 */
function getAnnouncementsReadAt(username: unknown): number {
    const key = cleanUsername(username);
    if (!key) return 0;
    return loadReads()[key] || 0;
}

/** 标记公告已读：记录当前时间，红点随之消失。 */
function markAnnouncementsRead(username: unknown): number {
    const key = cleanUsername(username);
    const reads = loadReads();
    const readAt = Date.now();
    reads[key] = readAt;
    writeJsonFileAtomic(READS_FILE, reads);
    return readAt;
}

module.exports = {
    getAnnouncements,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    getAnnouncementsReadAt,
    markAnnouncementsRead,
};
