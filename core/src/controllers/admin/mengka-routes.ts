import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 萌卡 NT 对接接口：
 * - GET  /api/mengka/status            连接状态与节点信息（登录用户）
 * - GET  /api/mengka/bots              萌卡在线账号列表（登录用户）
 * - POST /api/mengka/farm-code         取农场授权 Code（登录用户）
 * - GET  /api/settings/mengka-config   读取对接配置（仅超管，不回显令牌）
 * - POST /api/settings/mengka-config   保存对接配置（仅超管）
 */

const store = require('../../models/store');
const mengka = require('../../services/mengka-connector');
const { getIdentity, isAdminIdentity, handleApiError } = require('./middleware');

const mengkaLogger = require('../../services/logger').createModuleLogger('mengka');

function requireAdmin(ctx: AdminContext, req: Request, res: Response): boolean {
    if (!isAdminIdentity(getIdentity(ctx, req))) {
        res.status(403).json({ ok: false, error: '该操作仅超级管理员可用' });
        return false;
    }
    return true;
}

function mountMengkaRoutes(app: Application, ctx: AdminContext): void {

    app.get('/api/settings/mengka-config', (req: Request, res: Response) => {
        if (!requireAdmin(ctx, req, res)) return;
        try {
            const saved = store.getMengkaConfig();
            res.json({
                ok: true,
                data: {
                    enabled: saved.enabled,
                    wsHost: saved.wsHost,
                    wsPort: saved.wsPort,
                    tokenSet: !!saved.token,
                },
            });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/settings/mengka-config', (req: Request, res: Response) => {
        if (!requireAdmin(ctx, req, res)) return;
        try {
            const saved = store.setMengkaConfig(req.body || {});
            mengka.notifyConfigChanged();
            mengkaLogger.info('萌卡对接配置已更新', { enabled: saved.enabled, wsHost: saved.wsHost, wsPort: saved.wsPort });
            res.json({
                ok: true,
                data: {
                    enabled: saved.enabled,
                    wsHost: saved.wsHost,
                    wsPort: saved.wsPort,
                    tokenSet: !!saved.token,
                },
            });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/mengka/status', (req: Request, res: Response) => {
        try {
            const state = mengka.status();
            if (!state.enabled) {
                res.json({ ok: true, data: { enabled: false, connected: false, nodes: [] } });
                return;
            }
            mengka.getNodes()
                .then(nodes => res.json({ ok: true, data: { ...state, nodes } }))
                .catch(() => res.json({ ok: true, data: { ...state, nodes: [] } }));
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/mengka/bots', (req: Request, res: Response) => {
        try {
            const state = mengka.status();
            if (!state.enabled) {
                res.json({ ok: true, data: { enabled: false, connected: false, bots: [] } });
                return;
            }
            mengka.getBots()
                .then(bots => res.json({ ok: true, data: { enabled: true, connected: state.connected, bots } }))
                .catch((e: any) => res.status(502).json({ ok: false, error: e?.message || '获取萌卡账号列表失败' }));
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/mengka/farm-code', (req: Request, res: Response) => {
        try {
            const selfId = String((req.body || {}).self_id || '').trim();
            if (!/^\d{5,12}$/.test(selfId)) {
                return res.status(400).json({ ok: false, error: '缺少有效的萌卡账号' });
            }
            mengka.getFarmCode(selfId)
                .then(code => res.json({ ok: true, data: { code } }))
                .catch((e: any) => res.status(502).json({ ok: false, error: e?.message || '获取农场授权 Code 失败' }));
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountMengkaRoutes };
