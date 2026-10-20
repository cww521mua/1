/**
 * 萌卡等级任务（QQ 等级加速）纯逻辑助手：
 * 账号归一化、归属过滤与加速值换算，供路由层与单元测试共用。
 * 接口契约见萌卡文档 level-task-management（需要框架 v2.0.9+）。
 */

const SELF_ID_RE = /^\d{5,12}$/;

export interface MengkaLevelAccount {
    selfId: string;
    nickname: string;
    /** 0 离线 1 在线 2 登录中 */
    status: number;
    level: number;
    levelTaskSupported: boolean;
}

/**
 * 归一化 get_level_task_accounts 返回：仅保留 android 平台且 selfId 合法的账号。
 * 兼容数组或 { accounts: [...] } 两种返回包装。
 */
export function normalizeLevelAccounts(raw: unknown): MengkaLevelAccount[] {
    const list = Array.isArray(raw)
        ? raw
        : Array.isArray((raw as any)?.accounts) ? (raw as any).accounts : [];
    const result: MengkaLevelAccount[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        if (String(item.platform || '') !== 'android') continue;
        const selfId = String(item.selfId ?? item.self_id ?? '').trim();
        if (!SELF_ID_RE.test(selfId)) continue;
        const level = Number(item.level);
        result.push({
            selfId,
            nickname: String(item.nickname || ''),
            status: Number(item.status) || 0,
            level: Number.isFinite(level) ? level : 0,
            levelTaskSupported: item.levelTaskSupported !== false,
        });
    }
    return result;
}

/**
 * 按绑定归属过滤可见账号：管理员全量可见，普通用户仅限本人绑定的账号。
 * ownerMap 取自面板侧绑定存储（萌卡侧返回不区分归属）。
 */
export function filterLevelAccountsForOwner<T extends { selfId: string }>(
    accounts: T[],
    ownerMap: Map<string, string | null>,
    isAdmin: boolean,
    username: string,
): T[] {
    if (isAdmin) return accounts;
    return accounts.filter(item => ownerMap.get(item.selfId) === username);
}

/**
 * speed_days / vip_speed 等字段以十分之一天（倍数为十倍值）为单位，
 * 换算为常规值；非法输入返回 null（调用方展示为"未知"，不可按 0 处理）。
 */
export function tenthsToDays(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.round(num) / 10;
}
