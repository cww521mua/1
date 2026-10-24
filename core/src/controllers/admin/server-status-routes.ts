import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 服务器状态路由：管理员设置页「服务器状态」数据源。
 * 挂载在 /api/admin 前缀下，自动受登录 + 超管权限约束。
 */

const { handleApiError } = require('./middleware');
const { collectServerStatus } = require('../../services/server-status');

function mountServerStatusRoutes(app: Application, ctx: AdminContext): void {
    app.get('/api/admin/server-status', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: collectServerStatus(ctx.provider) });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountServerStatusRoutes };
