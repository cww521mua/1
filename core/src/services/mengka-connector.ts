export {};

/**
 * 萌卡 NT 对接连接器：通过萌卡「正向 WebSocket 插件服务」常驻连接框架，
 * 为面板提供在线账号列表（get_bot_list）与农场登录 Code（get_qq_farm_code）。
 *
 * 协议约定（与萌卡 Node.js SDK 一致）：
 *   连接后发送 {type:'auth', token, plugin_id, name, version, author, permissions}
 *   收到 {type:'auth_ok'} 表示认证成功；{type:'action', id, action, params}
 *   对应 {type:'action_result', id, ok, data, error, error_code}。
 */

const WebSocket = require('ws');
const { createModuleLogger } = require('./logger');
const store = require('../models/store');

const logger = createModuleLogger('mengka');

const RECONNECT_DELAY_MS = 15000;
const AUTH_TIMEOUT_MS = 10000;
const CALL_TIMEOUT_MS = 45000;
const FARM_CODE_TIMEOUT_MS = 60000;
const CONNECT_WAIT_MS = 8000;

let ws: any = null;
let connected = false;
let connecting = false;
let currentKey = '';
let lastError = '';
let reconnectTimer: any = null;
let nextId = 0;
const pending = new Map();
const connectWaiters: Array<() => void> = [];

function getConfig() {
    return store.getMengkaConfig();
}

function configKey(c: { wsHost: string, wsPort: number, token: string }): string {
    return `${c.wsHost}:${c.wsPort}:${c.token}`;
}

function failPending(message: string): void {
    for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error(message));
    }
    pending.clear();
}

function notifyConnectWaiters(): void {
    while (connectWaiters.length) {
        const wake = connectWaiters.shift();
        try { wake(); } catch { /* ignore */ }
    }
}

function scheduleReconnect(): void {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, RECONNECT_DELAY_MS);
}

function connect(): void {
    const c = getConfig();
    if (!c.enabled || !c.wsHost || !c.token) return;
    const key = configKey(c);
    if ((connected || connecting) && key === currentKey) return;

    if (ws) {
        try { ws.terminate(); } catch { /* ignore */ }
        ws = null;
    }
    connected = false;
    connecting = true;
    currentKey = key;
    lastError = '';

    logger.info(`正在连接萌卡框架 ws://${c.wsHost}:${c.wsPort} ...`);
    const socket = new WebSocket(`ws://${c.wsHost}:${c.wsPort}/`, { handshakeTimeout: AUTH_TIMEOUT_MS });
    ws = socket;
    const authTimer = setTimeout(() => {
        lastError = '萌卡认证超时';
        try { socket.terminate(); } catch { /* ignore */ }
    }, AUTH_TIMEOUT_MS);

    socket.on('open', () => {
        socket.send(JSON.stringify({
            type: 'auth',
            token: c.token,
            plugin_id: 'qq-farm-panel',
            name: 'QQ农场智能助手',
            version: '1.0.0',
            author: 'qq-farm-bot',
            permissions: {
                group_message: false,
                friend_message: false,
                request: false,
                group_event: false,
                friend_event: false,
                system_event: false,
                bot_offline: false,
            },
        }));
    });

    socket.on('message', (data: any) => {
        let msg: any;
        try { msg = JSON.parse(data.toString()); } catch { return; }
        switch (msg.type) {
            case 'auth_ok':
                clearTimeout(authTimer);
                connecting = false;
                connected = true;
                lastError = '';
                logger.info('萌卡框架认证成功');
                notifyConnectWaiters();
                break;
            case 'auth_failed':
                clearTimeout(authTimer);
                connecting = false;
                connected = false;
                lastError = String(msg.message || '萌卡认证失败');
                logger.warn(`萌卡认证失败: ${lastError}`);
                notifyConnectWaiters();
                try { socket.close(); } catch { /* ignore */ }
                break;
            case 'action_result':
                if (msg.id && pending.has(msg.id)) {
                    const p = pending.get(msg.id);
                    clearTimeout(p.timer);
                    pending.delete(msg.id);
                    if (msg.ok) p.resolve(msg.data);
                    else {
                        const err: any = new Error(String(msg.error || '萌卡 action 失败'));
                        if (typeof msg.error_code === 'string') err.code = msg.error_code;
                        p.reject(err);
                    }
                }
                break;
            default:
                // event / pong 等消息当前不使用
                break;
        }
    });

    socket.on('close', () => {
        clearTimeout(authTimer);
        const wasConnected = connected;
        connected = false;
        connecting = false;
        ws = null;
        failPending('萌卡连接已断开');
        notifyConnectWaiters();
        if (wasConnected) logger.warn('萌卡连接断开，将自动重连');
        scheduleReconnect();
    });

    socket.on('error', (err: any) => {
        lastError = String(err?.message || '萌卡连接异常');
        // close 事件会跟随触发，这里只记录
    });
}

function waitForConnected(timeoutMs: number): Promise<void> {
    if (connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            const idx = connectWaiters.indexOf(wake);
            if (idx >= 0) connectWaiters.splice(idx, 1);
            reject(new Error(lastError || '萌卡框架未连接'));
        }, timeoutMs);
        const wake = () => {
            clearTimeout(timer);
            if (connected) resolve();
            else reject(new Error(lastError || '萌卡框架未连接'));
        };
        connectWaiters.push(wake);
    });
}

async function callAction(action: string, params: Record<string, unknown> = {}, timeoutMs: number = CALL_TIMEOUT_MS): Promise<any> {
    const c = getConfig();
    if (!c.enabled || !c.wsHost || !c.token) {
        throw new Error('萌卡对接未启用');
    }
    connect();
    await waitForConnected(CONNECT_WAIT_MS);
    if (!ws || ws.readyState !== 1) throw new Error('萌卡框架未连接');

    return new Promise((resolve, reject) => {
        const id = String(++nextId);
        const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error(`萌卡 action ${action} 超时`));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
            ws.send(JSON.stringify({ type: 'action', id, action, params }));
        } catch (e: any) {
            clearTimeout(timer);
            pending.delete(id);
            reject(new Error(`萌卡请求发送失败: ${e?.message || e}`));
        }
    });
}

function status(): { enabled: boolean, configured: boolean, connected: boolean, lastError: string } {
    const c = getConfig();
    return {
        enabled: c.enabled === true,
        configured: !!(c.wsHost && c.token),
        connected,
        lastError,
    };
}

async function getBots(): Promise<any[]> {
    const data = await callAction('get_bot_list', {}, 20000);
    const list = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.items || data.accounts || data.bots)) ? (data.items || data.accounts || data.bots) : [];
    return list
        .filter((b: any) => b && (b.self_id != null || b.selfId != null))
        .map((b: any) => {
            const platform = String(b.platform || '');
            const clientType = String(b.client_type || b.clientType || '');
            const isLinux = platform === 'linux' || clientType === 'linuxqq';
            const online = typeof b.online === 'boolean' ? b.online : Number(b.status) === 1;
            return {
                selfId: String(b.self_id ?? b.selfId ?? ''),
                nickname: String(b.nickname || ''),
                clientType: isLinux ? 'linuxqq' : 'android',
                online,
            };
        });
}

async function getFarmCode(selfId: unknown): Promise<string> {
    const data = await callAction(
        'get_qq_farm_code',
        { self_id: Number(selfId), client_type: 'android' },
        FARM_CODE_TIMEOUT_MS,
    );
    const code = String(data?.code || '').trim();
    if (!/^[0-9a-fA-F]{32}$/.test(code)) throw new Error('萌卡未返回有效的农场 Code');
    return code;
}

async function getNodes(): Promise<any[]> {
    const data = await callAction('get_node_list', {}, 20000);
    return Array.isArray(data) ? data : (Array.isArray(data?.nodes) ? data.nodes : []);
}

function notifyConfigChanged(): void {
    currentKey = '';
    if (ws) {
        try { ws.close(); } catch { /* ignore */ }
    }
    connect();
}

// 模块加载后延迟一次连接尝试（配置完整时自动上线）
setTimeout(() => connect(), 2000).unref?.();

module.exports = {
    callAction,
    status,
    getBots,
    getFarmCode,
    getNodes,
    notifyConfigChanged,
};
