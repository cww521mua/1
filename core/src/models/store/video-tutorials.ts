export {};
/**
 * 视频教程存储（core/data/video-tutorials.json）。
 * 管理员在设置页「视频教程」维护视频名称与播放链接（视频文件托管在外部，如 .224 视频服务）；
 * 主页「视频教程」入口进入公开教程页播放。
 */
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const VIDEOS_FILE: string = getDataFile('video-tutorials.json');

const MAX_VIDEOS = 50;
const TITLE_MAX = 60;
const URL_MAX = 500;

export interface VideoTutorial {
    id: string;
    title: string;
    url: string;
    createdAt: number;
}

function normalizeVideo(raw: any): VideoTutorial | null {
    const id = String(raw?.id ?? '').trim();
    const title = String(raw?.title ?? '').trim();
    const url = String(raw?.url ?? '').trim();
    if (!id || !title || !/^https?:\/\//i.test(url)) return null;
    const createdAt = Number(raw?.createdAt);
    return {
        id,
        title: title.slice(0, TITLE_MAX),
        url: url.slice(0, URL_MAX),
        createdAt: Number.isFinite(createdAt) && createdAt > 0 ? Math.floor(createdAt) : Date.now(),
    };
}

function loadVideos(): VideoTutorial[] {
    ensureDataDir();
    const raw = readJsonFile(VIDEOS_FILE, () => []);
    const list = Array.isArray(raw) ? raw : [];
    return list
        .map(normalizeVideo)
        .filter((item): item is VideoTutorial => item !== null)
        .sort((a, b) => a.createdAt - b.createdAt);
}

function saveVideos(list: VideoTutorial[]): void {
    writeJsonFileAtomic(VIDEOS_FILE, list);
}

function getVideoTutorials(): VideoTutorial[] {
    return loadVideos();
}

function validateVideoInput(input: { title?: unknown, url?: unknown }): { title: string, url: string } | { error: string } {
    const title = String(input?.title ?? '').trim();
    const url = String(input?.url ?? '').trim();
    if (!title) return { error: '请输入视频名称' };
    if (!url) return { error: '请输入视频链接' };
    if (!/^https?:\/\/.+/i.test(url)) return { error: '视频链接需以 http:// 或 https:// 开头' };
    return { title: title.slice(0, TITLE_MAX), url: url.slice(0, URL_MAX) };
}

function addVideoTutorial(input: { title?: unknown, url?: unknown }): { ok: boolean, error?: string, videos?: VideoTutorial[] } {
    const parsed = validateVideoInput(input || {});
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const list = loadVideos();
    list.push({
        id: crypto.randomBytes(8).toString('hex'),
        title: parsed.title,
        url: parsed.url,
        createdAt: Date.now(),
    });
    const saved = list.slice(-MAX_VIDEOS);
    saveVideos(saved);
    return { ok: true, videos: saved };
}

function updateVideoTutorial(id: unknown, input: { title?: unknown, url?: unknown }): { ok: boolean, error?: string, videos?: VideoTutorial[] } {
    const targetId = String(id ?? '').trim();
    const parsed = validateVideoInput(input || {});
    if ('error' in parsed) return { ok: false, error: parsed.error };
    const list = loadVideos();
    const target = list.find(item => item.id === targetId);
    if (!target) return { ok: false, error: '视频不存在' };
    target.title = parsed.title;
    target.url = parsed.url;
    saveVideos(list);
    return { ok: true, videos: list };
}

function deleteVideoTutorial(id: unknown): { ok: boolean, error?: string, videos?: VideoTutorial[] } {
    const targetId = String(id ?? '').trim();
    if (!targetId) return { ok: false, error: '缺少视频 ID' };
    const list = loadVideos();
    const next = list.filter(item => item.id !== targetId);
    if (next.length === list.length) return { ok: false, error: '视频不存在' };
    saveVideos(next);
    return { ok: true, videos: next };
}

module.exports = {
    getVideoTutorials,
    addVideoTutorial,
    updateVideoTutorial,
    deleteVideoTutorial,
};
