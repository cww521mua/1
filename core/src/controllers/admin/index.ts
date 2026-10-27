import type { AdminContext } from './context';
export {};

/**
 * Admin panel HTTP server orchestrator.
 * Thin wrapper that wires up Express, routes, Socket.IO, and shared context.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const { CONFIG } = require('../../config/config');
const { getResourcePath } = require('../../config/runtime-paths');
const { createModuleLogger } = require('../../services/logger');
const store = require('../../models/store');
const cardStore = require('../../models/card-store');
const userStore = require('../../models/user-store');

const { createAdminContext } = require('./context');
const { mountAuthRoutes } = require('./auth-routes');
const { mountAnnouncementRoutes } = require('./announcement-routes');
const { mountVideoTutorialRoutes } = require('./video-tutorial-routes');
const { mountCardRoutes } = require('./card-routes');
const { mountServerStatusRoutes } = require('./server-status-routes');
const { mountAdminUserRoutes } = require('./user-routes');
const { mountAccountRoutes } = require('./account-routes');
const { mountMengkaRoutes } = require('./mengka-routes');
const { mountFarmRoutes } = require('./farm-routes');
const { mountFriendRoutes } = require('./friend-routes');
const { mountActivityCenterRoutes } = require('./activity-center-routes');
const { mountCommerceRoutes } = require('./commerce-routes');
const { mountWxLoginRoutes } = require('./wx-login-routes');
const { mountQqLoginRoutes } = require('./qq-login-routes');
const { mountCaptureRoutes, setEmbeddedCapture } = require('./capture-routes');
const { createCaptureCore } = require('../../capture/index');
const {
    setupSocketIO,
    emitRealtimeStatus: _emitStatus,
    emitRealtimeLog: _emitLog,
    emitRealtimeAccountLog: _emitAccountLog,
} = require('./socket');

const adminLogger = createModuleLogger('admin');

const EXPIRED_ACCOUNT_SWEEP_INTERVAL_MS = 60 * 1000;
let expiredAccountSweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 卡密管控开启时，定期停用已到期的游戏账号；普通用户到期时停用其名下全部账号。
 */
function sweepExpiredAccounts(context: AdminContext): void {
    try {
        const expiredIds = new Set<string>();

        const settings = store.getCardSettings();
        if (settings?.enabled) {
            for (const accountId of cardStore.getExpiredAccountIds()) {
                expiredIds.add(accountId);
            }
        }

        const expiredUsers: string[] = userStore.getExpiredUsernames();
        if (expiredUsers.length) {
            const data = store.getAccounts();
            for (const account of (data?.accounts || [])) {
                if (expiredUsers.includes(String(account.owner || ''))) {
                    expiredIds.add(String(account.id));
                }
            }
        }

        if (!expiredIds.size) return;
        for (const accountId of expiredIds) {
            try {
                if (typeof context.provider.isAccountRunning === 'function' && context.provider.isAccountRunning(accountId)) {
                    context.provider.stopAccount(accountId);
                }
                if (context.provider.addAccountLog) {
                    context.provider.addAccountLog('update', '账号卡密授权已到期，自动停止', accountId, '');
                }
                adminLogger.warn('账号授权到期自动停止', { accountId });
            } catch (error: any) {
                adminLogger.warn('停止到期账号失败', { accountId, error: error.message });
            }
        }
    } catch (error: any) {
        adminLogger.warn('到期账号巡检失败', { error: error.message });
    }
}

let ctx: AdminContext | null = null;
let embeddedCaptureCore: any = null;

function startEmbeddedCaptureService(): any {
    try {
        const captureConfig = store.getCaptureConfig();
        if (captureConfig.enabled !== true) {
            adminLogger.info('capture service disabled (enabled=false)');
            return null;
        }
        if (captureConfig.embedded === false) {
            adminLogger.info('capture service not embedded (embedded=false)');
            return null;
        }
        if (embeddedCaptureCore) return embeddedCaptureCore;
        const captureLog = (level: string, message: string, extra?: any) => {
            const fn = (adminLogger as any)[level] || adminLogger.info;
            fn.call(adminLogger, message, extra);
        };
        const core = createCaptureCore({ log: captureLog });
        embeddedCaptureCore = core;
        setEmbeddedCapture(core);
        core.ready.catch((error: any) => {
            adminLogger.warn('capture service embedded init failed', { error: error.message });
        });
        adminLogger.info('capture service embedded, proxy port 18000');
        return core;
    } catch (error: any) {
        adminLogger.warn('capture service embedded start failed', { error: error.message });
        return null;
    }
}

function startAdminServer(dataProvider: any): void {
    if (ctx) return;

    ctx = createAdminContext(dataProvider);
    startEmbeddedCaptureService();

    const app = express();
    app.set('trust proxy', true);
    // 上限放宽到 4MB：品牌图标以 base64 JSON 上传（原图 ≤2MB）
    app.use(express.json({ limit: '4mb' }));

    ctx.app = app;

    app.use((req: any, res: any, next: any) => {
        const allowedOrigins: string[] = CONFIG.ALLOWED_ORIGINS || ['http://localhost:5173', 'http://localhost:3000', 'http://127.0.0.1:5173'];
        const origin = req.headers.origin;

        if (origin && allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        } else if (!origin) {
            res.header('Access-Control-Allow-Origin', '*');
        }

        res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS, PUT');
        res.header('Access-Control-Allow-Headers', 'Content-Type, x-account-id, x-admin-token, x-proxy-api-key, x-proxy-api-url, x-proxy-app-id');
        res.header('Access-Control-Allow-Credentials', 'true');
        res.header('Access-Control-Max-Age', '86400');

        if (req.method === 'OPTIONS') return res.sendStatus(200);
        next();
    });

    const webDist = path.join(__dirname, '../../../../web/dist');
    if (fs.existsSync(webDist)) {
        // 入口 HTML 始终回源校验，避免发版后浏览器继续运行旧前端；带哈希的 assets 长缓存
        app.use(express.static(webDist, {
            setHeaders: (res, filePath) => {
                if (filePath.endsWith('.html')) {
                    res.setHeader('Cache-Control', 'no-cache');
                } else if (/[/\\]assets[/\\]/.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                }
            },
        }));
    } else {
        adminLogger.warn('web build not found', { webDist });
        app.get('/', (_req: any, res: any) => res.send('web build not found. Please build the web project.'));
    }
    app.use('/game-config', express.static(getResourcePath('gameConfig')));

    // Mount route modules
    mountAuthRoutes(app, ctx);
    mountAnnouncementRoutes(app, ctx);
    mountVideoTutorialRoutes(app, ctx);
    mountCardRoutes(app, ctx);
    mountServerStatusRoutes(app, ctx);
    mountAdminUserRoutes(app, ctx);
    mountWxLoginRoutes(app, ctx);
    mountQqLoginRoutes(app, ctx);
    mountCaptureRoutes(app, ctx);
    mountFarmRoutes(app, ctx);
    mountFriendRoutes(app, ctx);
    mountAccountRoutes(app, ctx);
    mountMengkaRoutes(app, ctx);
    mountActivityCenterRoutes(app, ctx);
    mountCommerceRoutes(app, ctx);

    // SPA fallback
    app.get('*', (req: any, res: any) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/game-config')) {
             return res.status(404).json({ ok: false, error: 'Not Found' });
        }
        if (fs.existsSync(webDist)) {
            // 入口 HTML 一律禁止缓存，避免浏览器驻留旧前端
            res.setHeader('Cache-Control', 'no-cache');
            res.sendFile(path.join(webDist, 'index.html'));
        } else {
            res.status(404).send('web build not found. Please build the web project.');
        }
    });

    const port: number = CONFIG.adminPort || 3007;
    ctx.server = app.listen(port, '0.0.0.0', () => {
        adminLogger.info('admin panel started', { url: `http://localhost:${port}`, port });
    });

    // Setup Socket.IO
    setupSocketIO(ctx);

    // 卡密到期巡检：启动即扫一次，之后每分钟一次
    sweepExpiredAccounts(ctx);
    if (!expiredAccountSweepTimer) {
        expiredAccountSweepTimer = setInterval(() => {
            if (ctx) sweepExpiredAccounts(ctx);
        }, EXPIRED_ACCOUNT_SWEEP_INTERVAL_MS);
        (expiredAccountSweepTimer as any).unref?.();
    }

}

function emitRealtimeStatus(accountId: string, status: any): void {
    if (!ctx) return;
    _emitStatus(ctx, accountId, status);
}

function emitRealtimeLog(entry: any): void {
    if (!ctx) return;
    _emitLog(ctx, entry);
}

function emitRealtimeAccountLog(entry: any): void {
    if (!ctx) return;
    _emitAccountLog(ctx, entry);
}

module.exports = {
    startAdminServer,
    emitRealtimeStatus,
    emitRealtimeLog,
    emitRealtimeAccountLog,
};
