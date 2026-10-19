/**
 * Socket.IO setup and realtime emit functions.
 */
import type { AdminContext } from './context';
export {};

const { Server } = require('socket.io');
const SocketIOServer = Server;

const {
    resolveAccId,
    getIdentity,
} = require('./middleware');
const store = require('../../models/store');

function getSocketIdentity(ctx: AdminContext, socket: any) {
    try {
        return getIdentity(ctx, { adminToken: socket.data.adminToken } as any);
    } catch {
        return { username: 'admin', role: 'admin' as const };
    }
}

function getOwnedAccountIds(ctx: AdminContext, socket: any): string[] {
    const identity = getSocketIdentity(ctx, socket);
    if (identity.role !== 'user') return [];
    try {
        const data = store.getAccounts();
        return (Array.isArray(data?.accounts) ? data.accounts : [])
            .filter((account: any) => String(account.owner || '') === identity.username)
            .map((account: any) => String(account.id));
    } catch {
        return [];
    }
}

function applySocketSubscription(ctx: AdminContext, socket: any, accountRef: string = ''): void {
    const incoming = String(accountRef || '').trim();
    let resolved = incoming && incoming !== 'all' ? resolveAccId(ctx, incoming) : '';

    const ownedIds = getOwnedAccountIds(ctx, socket);
    const isUser = ownedIds.length > 0 || getSocketIdentity(ctx, socket).role === 'user';
    if (isUser) {
        // 普通用户只能订阅自己名下的账号
        if (resolved && !ownedIds.includes(resolved)) resolved = '';
    }

    for (const room of socket.rooms) {
        if (room.startsWith('account:')) socket.leave(room);
    }
    if (resolved) {
        socket.join(`account:${resolved}`);
        socket.data.accountId = resolved;
    } else {
        socket.join('account:all');
        socket.data.accountId = '';
    }
    socket.emit('subscribed', { accountId: socket.data.accountId || 'all' });

    try {
        const targetId = socket.data.accountId || '';
        if (targetId && ctx.provider && typeof ctx.provider.getStatus === 'function') {
            const currentStatus = ctx.provider.getStatus(targetId);
            socket.emit('status:update', { accountId: targetId, status: currentStatus });
        }
        if (ctx.provider && typeof ctx.provider.getLogs === 'function') {
            let currentLogs: any[] = ctx.provider.getLogs(targetId, { limit: 100 });
            if (!Array.isArray(currentLogs)) currentLogs = [];
            if (isUser && !targetId) {
                // 聚合日志按归属过滤
                currentLogs = currentLogs.filter((log: any) => ownedIds.includes(String(log.accountId || '')));
            }

            socket.emit('logs:snapshot', {
                accountId: targetId || 'all',
                logs: currentLogs,
            });
        }
        if (ctx.provider && typeof ctx.provider.getAccountLogs === 'function') {
            let currentAccountLogs: any[] = isUser ? [] : ctx.provider.getAccountLogs(100);
            if (!Array.isArray(currentAccountLogs)) currentAccountLogs = [];

            socket.emit('account-logs:snapshot', {
                logs: currentAccountLogs,
            });
        }
    } catch {
        // ignore snapshot push errors
    }
}

function setupSocketIO(ctx: AdminContext): void {
    ctx.io = new SocketIOServer(ctx.server as any, {
        path: '/socket.io',
        cors: {
            origin: '*',
            methods: ['GET', 'POST'],
            allowedHeaders: ['x-admin-token', 'x-account-id'],
        },
    });

    ctx.io.use((socket: any, next: (err?: Error) => void) => {
        const authToken = socket.handshake.auth && socket.handshake.auth.token
            ? String(socket.handshake.auth.token)
            : '';
        const headerToken = socket.handshake.headers && socket.handshake.headers['x-admin-token']
            ? String(socket.handshake.headers['x-admin-token'])
            : '';
        const token = authToken || headerToken;
        if (!token || !ctx.tokens.has(token)) {
            return next(new Error('Unauthorized'));
        }
        socket.data.adminToken = token;
        return next();
    });

    ctx.io.on('connection', (socket: any) => {
        const initialAccountRef = (socket.handshake.auth && socket.handshake.auth.accountId)
            || (socket.handshake.query && socket.handshake.query.accountId)
            || '';
        applySocketSubscription(ctx, socket, initialAccountRef);
        socket.emit('ready', { ok: true, ts: Date.now() });

        socket.on('subscribe', (payload: any) => {
            const body = (payload && typeof payload === 'object') ? payload : {};
            applySocketSubscription(ctx, socket, body.accountId || '');
        });
    });
}

function emitRealtimeStatus(ctx: AdminContext, accountId: string, status: any): void {
    if (!ctx.io) return;
    const id = String(accountId || '').trim();
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    ctx.io.to(`account:${id}`).emit('status:update', { accountId: id, status });
}

function emitRealtimeLog(ctx: AdminContext, entry: any): void {
    if (!ctx.io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    ctx.io.to(`account:${id}`).emit('log:new', payload);
}

function emitRealtimeAccountLog(ctx: AdminContext, entry: any): void {
    if (!ctx.io) return;
    const payload = (entry && typeof entry === 'object') ? entry : {};
    const id = String(payload.accountId || '').trim();

    // 如果没有指定账号ID，不推送给任何人（防止数据泄露）
    if (!id) return;

    // 推送到特定账号房间（只有订阅了该账号的用户能收到）
    ctx.io.to(`account:${id}`).emit('account-log:new', payload);
}

module.exports = {
    setupSocketIO,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
