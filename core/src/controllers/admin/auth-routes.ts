import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const userStore = require('../../models/user-store');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    getIdentity,
    isAdminIdentity,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

// 公开接口（无需登录）
const PUBLIC_API_PATHS = new Set(['/login', '/register', '/game-version']);

function issueIdentityToken(ctx: AdminContext, username: string, role: 'admin' | 'user'): string {
    const token = issueToken();
    ctx.tokens.add(token);
    ctx.tokenMeta?.set(token, { username, role });
    return token;
}

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);
        const name = String(username);

        // 已注册的普通用户优先走用户登录，避免失败计数误伤管理员锁定
        if (userStore.findUser(name)) {
            const userResult = userStore.validateUser(name, String(password), clientIp);
            if (userResult?.error) {
                const statusCode = userResult.error === 'rate_limit' ? 429 : userResult.error === 'locked' ? 423 : 401;
                adminLogger.warn('用户登录失败', { username: name, error: userResult.error, ip: clientIp });
                return res.status(statusCode).json({
                    ok: false,
                    error: userResult.message,
                    errorType: userResult.error,
                    remainingMs: userResult.remainingMs,
                });
            }
            const token = issueIdentityToken(ctx, userResult.user.username, 'user');
            adminLogger.info('用户登录成功', { username: userResult.user.username, ip: clientIp });
            return res.json({
                ok: true,
                data: {
                    token,
                    role: 'user',
                    user: { username: userResult.user.username },
                    card: userResult.user.card,
                    accountLimit: userResult.user.accountLimit,
                },
            });
        }

        // 超级管理员登录
        const adminResult = adminStore.validateAdmin(name, String(password), clientIp);
        if (adminResult?.error) {
            const statusCode = adminResult.error === 'rate_limit' ? 429 : adminResult.error === 'locked' ? 423 : 401;
            adminLogger.warn('登录失败', { username: name, error: adminResult.error, ip: clientIp });
            return res.status(statusCode).json({
                ok: false,
                error: adminResult.message,
                errorType: adminResult.error,
                remainingMs: adminResult.remainingMs,
            });
        }
        const token = issueIdentityToken(ctx, adminResult.username, 'admin');
        adminLogger.info('超级管理员登录成功', { username: adminResult.username, ip: clientIp });
        return res.json({
            ok: true,
            data: {
                token,
                role: 'admin',
                user: { username: adminResult.username },
                mustChangePassword: adminResult.mustChangePassword === true,
            },
        });
    });

    // 卡密注册（公开接口）：仅允许时间卡密注册普通用户
    app.post('/api/register', (req: Request, res: Response) => {
        const { username, password, cardCode } = req.body || {};
        if (!username || !password || !cardCode) {
            return res.status(400).json({ ok: false, error: '请填写用户名、密码和卡密' });
        }
        const clientIp = getClientIp(req);
        const result = userStore.registerUser(String(username), String(password), String(cardCode));
        if (!result.ok) {
            adminLogger.warn('卡密注册失败', { username: String(username), error: result.error, ip: clientIp });
            return res.status(400).json({ ok: false, error: result.error });
        }
        adminLogger.info('卡密注册成功', { username: result.user.username, ip: clientIp });
        return res.json({ ok: true, data: { username: result.user.username } });
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (PUBLIC_API_PATHS.has(req.path)) return next();
        if (req.path.startsWith('/public/capture-certificate/')) return next();
        return authRequired(req, res, next);
    });

    // 管理与抓包接口仅限超级管理员
    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path.startsWith('/admin') || req.path.startsWith('/capture')) {
            const identity = getIdentity(ctx, req);
            if (identity.role !== 'admin') {
                return res.status(403).json({ ok: false, error: '该操作仅超级管理员可用' });
            }
        }
        next();
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        res.json({ ok: true, clientVersion: getRuntimeConfig().clientVersion, botVersion: version });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) {
            ctx.tokens.delete(token);
            ctx.tokenMeta?.delete(token);
        }
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', (req: Request, res: Response) => {
        const identity = getIdentity(ctx, req);
        if (identity.role === 'user') {
            const info = userStore.getUserInfo(identity.username);
            if (!info) return res.status(401).json({ ok: false, error: '用户不存在' });
            return res.json({ ok: true, data: info });
        }
        return res.json({ ok: true, data: adminStore.getAdminInfo() });
    });

    app.post('/api/user/change-password', (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const identity = getIdentity(ctx, req);
        if (identity.role === 'user') {
            const result = userStore.changeUserPassword(identity.username, String(oldPassword), String(newPassword));
            return res.json(result);
        }
        const result = adminStore.changePassword(String(oldPassword), String(newPassword));
        if (result.ok) {
            ctx.tokens.clear();
            ctx.tokenMeta?.clear();
        }
        return res.json(result);
    });

    // 普通用户使用卡密续费（时间卡续期 / 额度卡提升账号上限）
    app.post('/api/user/renew', (req: Request, res: Response) => {
        const identity = getIdentity(ctx, req);
        if (!isAdminIdentity(identity)) {
            const cardCode = String((req.body || {}).cardCode || '').trim();
            if (!cardCode) return res.status(400).json({ ok: false, error: '请输入卡密' });
            const result = userStore.renewUser(identity.username, cardCode);
            if (!result.ok) return res.status(400).json(result);
            adminLogger.info('用户卡密续费', { username: identity.username, cardType: result.cardType });
            return res.json({ ok: true, data: result.user });
        }
        return res.status(400).json({ ok: false, error: '超级管理员无需续费' });
    });
}

module.exports = { mountAuthRoutes, PUBLIC_API_PATHS };
