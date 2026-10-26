export {};

/**
 * 萌卡账号管理视图：把框架 bot 列表与面板侧绑定关系合并为管理视图。
 * 纯函数，供 /api/mengka/bots 与单元测试使用。
 */

export interface MengkaBotView {
    selfId: string;
    nickname: string;
    /** status: 0 离线 / 1 在线 / 2 登录中 */
    status: number;
    online: boolean;
    /** 框架给出的状态描述（如「登录成功」「服务端通知账号离线」） */
    statusText: string;
    lastActiveMs: number;
    loginTimeMs: number;
    protocolId: number;
    platform: string;
    clientType: string;
    /** 面板侧绑定的归属用户，未绑定为 null */
    ownerId: string | null;
    bound: boolean;
    /** 当前查看者是否可管理（删除/重登等） */
    canManage: boolean;
}

interface Viewer {
    isAdmin: boolean;
    username: string;
}

function toMs(value: unknown): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return 0;
    // 秒级时间戳转毫秒；毫秒级直接使用
    return num < 1e12 ? num * 1000 : num;
}

/** 合并 bot 列表与绑定关系：管理员可见全部，普通用户仅可见自己绑定的账号 */
function buildBotViews(
    bots: Array<Record<string, any>>,
    bindings: Array<Record<string, any>>,
    viewer: Viewer,
): MengkaBotView[] {
    const ownerMap = new Map<string, string>();
    for (const item of Array.isArray(bindings) ? bindings : []) {
        const selfId = String(item?.selfId ?? '').trim();
        const owner = String(item?.owner ?? '').trim();
        if (selfId && owner) ownerMap.set(selfId, owner);
    }

    const views: MengkaBotView[] = [];
    for (const bot of Array.isArray(bots) ? bots : []) {
        const selfId = String(bot?.selfId ?? '').trim();
        if (!selfId) continue;
        const ownerId = ownerMap.get(selfId) ?? null;
        const bound = ownerId !== null;
        // 普通用户只能看到自己名下绑定的账号；未绑定账号仅管理员可见
        if (!viewer.isAdmin && (!bound || ownerId !== viewer.username)) continue;
        const status = Number(bot?.status) || 0;
        views.push({
            selfId,
            nickname: String(bot?.nickname || ''),
            status,
            online: typeof bot?.online === 'boolean' ? bot.online : status === 1,
            statusText: String(bot?.statusText || bot?.extra_info || ''),
            lastActiveMs: toMs(bot?.lastActiveMs ?? bot?.last_active),
            loginTimeMs: toMs(bot?.loginTimeMs ?? bot?.login_time),
            protocolId: Number(bot?.protocol_id) || 0,
            platform: String(bot?.platform || ''),
            clientType: String(bot?.client_type || bot?.clientType || ''),
            ownerId,
            bound,
            canManage: viewer.isAdmin || (bound && ownerId === viewer.username),
        });
    }

    // 在线优先，其后按最后活跃时间倒序
    views.sort((a, b) => {
        if (a.online !== b.online) return a.online ? -1 : 1;
        return b.lastActiveMs - a.lastActiveMs;
    });
    return views;
}

module.exports = { buildBotViews };
