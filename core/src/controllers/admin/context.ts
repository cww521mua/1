import type { Application } from 'express';
import type { Server } from 'node:http';
import type { Server as SocketIOServer } from 'socket.io';
export {};

/**
 * AdminContext factory
 * Creates and holds all shared state for the admin server.
 */

export interface TokenIdentity {
    username: string;
    role: 'admin' | 'user';
}

export interface AdminContext {
    tokens: Set<string>;
    /** token -> 登录身份（admin 或普通用户）。旧会话缺失时按 admin 处理。 */
    tokenMeta: Map<string, TokenIdentity>;
    app: Application | null;
    server: Server | null;
    io: SocketIOServer | null;
    provider: any;
}

function createAdminContext(dataProvider: any): AdminContext {
    const tokens = new Set<string>();
    const tokenMeta = new Map<string, TokenIdentity>();
    return {
        tokens,
        tokenMeta,
        app: null,
        server: null,
        io: null,
        provider: dataProvider,
    };
}

module.exports = { createAdminContext };
