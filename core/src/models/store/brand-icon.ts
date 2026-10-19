export {};

/**
 * 品牌图标上传文件的存储：保存在 core/data/brand-icon.<ext>，
 * 通过公开接口 /api/branding/icon 提供访问。
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDataDir, ensureDataDir } = require('../../config/runtime-paths');

const ALLOWED_MIME: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
};
const ICON_BASE_NAME = 'brand-icon';
const MAX_ICON_BYTES = 2 * 1024 * 1024;

function findIconFile(): { path: string, mime: string } | null {
    const dir = getDataDir();
    let entries: string[] = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return null;
    }
    for (const entry of entries) {
        if (!entry.startsWith(`${ICON_BASE_NAME}.`)) continue;
        const ext = path.extname(entry).toLowerCase();
        const mime = Object.entries(ALLOWED_MIME).find(([, value]) => value === ext);
        if (!mime) continue;
        const fullPath = path.join(dir, entry);
        try {
            const stat = fs.statSync(fullPath);
            if (stat.isFile() && stat.size > 0) {
                return { path: fullPath, mime: mime[0] };
            }
        } catch {
            // File may have been removed concurrently; keep scanning.
        }
    }
    return null;
}

function removeIconFiles(): void {
    const dir = getDataDir();
    let entries: string[] = [];
    try {
        entries = fs.readdirSync(dir);
    } catch {
        return;
    }
    for (const entry of entries) {
        if (!entry.startsWith(`${ICON_BASE_NAME}.`)) continue;
        try {
            fs.unlinkSync(path.join(dir, entry));
        } catch {
            // Best effort cleanup.
        }
    }
}

/**
 * 保存 dataURL 格式的图标（如 data:image/png;base64,...），返回服务路径。
 */
function saveBrandIcon(dataUrl: unknown): string {
    const raw = String(dataUrl || '').trim();
    const match = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(raw);
    if (!match) throw new Error('图片数据无效');
    const mime = match[1].toLowerCase();
    const ext = ALLOWED_MIME[mime];
    if (!ext) throw new Error('仅支持 PNG / JPG / GIF / WebP 图片');
    let buffer: Buffer;
    try {
        buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    } catch {
        throw new Error('图片数据无效');
    }
    if (!buffer || buffer.length === 0) throw new Error('图片数据无效');
    if (buffer.length > MAX_ICON_BYTES) throw new Error('图片不能超过 2MB');

    ensureDataDir();
    removeIconFiles();
    const target = path.join(getDataDir(), `${ICON_BASE_NAME}${ext}`);
    fs.writeFileSync(target, buffer);
    return `/api/branding/icon?v=${Date.now()}`;
}

function clearBrandIcon(): void {
    removeIconFiles();
}

module.exports = {
    findIconFile,
    saveBrandIcon,
    clearBrandIcon,
};
