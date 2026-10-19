import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 超级管理员用户管理：查看、编辑（到期/启用/上限/重置密码）与删除普通用户。
 */

const userStore = require('../../models/user-store');
const { createModuleLogger } = require('../../services/logger');
const { handleApiError } = require('./middleware');

const adminLogger = createModuleLogger('admin');

function parseExpiresAt(input: unknown): number | null {
    if (input === null || input === '' || input === 'permanent') return null;
    if (typeof input === 'number' && Number.isFinite(input)) return Math.floor(input);
    const raw = String(input || '').trim();
    if (!raw) return null;
    // 支持 YYYY-MM-DD HH:mm（按本地时区）
    const normalized = raw.replace('T', ' ');
    const ts = Date.parse(normalized.includes(':') ? normalized : `${normalized} 00:00`);
    if (!Number.isFinite(ts)) throw new Error('到期时间格式无效，请使用 YYYY-MM-DD HH:mm');
    return ts;
}

function mountAdminUserRoutes(app: Application, _ctx: AdminContext): void {
    app.get('/api/admin/users', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: userStore.getAllUsers() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/users/:username', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const updates: Record<string, unknown> = {};
            if (body.expiresAt !== undefined) updates.expiresAt = parseExpiresAt(body.expiresAt);
            if (body.enabled !== undefined) updates.enabled = body.enabled === true;
            if (body.accountLimit !== undefined) updates.accountLimit = body.accountLimit;
            if (body.newPassword !== undefined) updates.newPassword = body.newPassword;

            const user = userStore.editUser(req.params.username, updates);
            if (!user) {
                return res.status(404).json({ ok: false, error: '用户不存在' });
            }
            adminLogger.warn('管理员更新用户', {
                username: req.params.username,
                enabled: user.enabled,
                accountLimit: user.accountLimit,
                expiresAt: user.card.expiresAt,
                passwordReset: body.newPassword !== undefined,
            });
            res.json({ ok: true, data: user });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/admin/users/:username', (req: Request, res: Response) => {
        try {
            const force = req.query.force === '1' || req.query.force === 'true';
            const result = userStore.deleteUser(req.params.username, force);
            if (!result.ok) {
                return res.status(400).json(result);
            }
            adminLogger.warn('管理员删除用户', { username: req.params.username, removedAccounts: result.removedAccounts || 0 });
            res.json({ ok: true, ...result });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountAdminUserRoutes };
