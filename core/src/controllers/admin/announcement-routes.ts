import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 系统公告路由：
 * - GET    /api/announcements            公告列表 + 当前用户已读时间（登录用户）
 * - POST   /api/announcements/read       标记公告已读（红点消失）
 * - GET    /api/admin/announcements      公告管理列表（仅超管）
 * - POST   /api/admin/announcements      发布公告（仅超管）
 * - PUT    /api/admin/announcements/:id  编辑公告（仅超管）
 * - DELETE /api/admin/announcements/:id  删除公告（仅超管）
 */

const { handleApiError, getIdentity } = require('./middleware');
const announcements = require('../../models/store/announcements');

function mountAnnouncementRoutes(app: Application, _ctx: AdminContext): void {
    // 公告列表（面板顶栏红点与列表数据源）
    app.get('/api/announcements', (req: Request, res: Response) => {
        try {
            const identity = getIdentity(_ctx, req);
            const list = announcements.getAnnouncements();
            const readAt = announcements.getAnnouncementsReadAt(identity.username);
            const unreadCount = list.filter(item => item.createdAt > readAt).length;
            res.json({ ok: true, data: { announcements: list, readAt, unreadCount } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 标记已读：打开公告列表后调用，红点消失
    app.post('/api/announcements/read', (req: Request, res: Response) => {
        try {
            const identity = getIdentity(_ctx, req);
            const readAt = announcements.markAnnouncementsRead(identity.username);
            res.json({ ok: true, data: { readAt } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 以下为管理员公告管理接口（/api/admin 前缀自动受超管约束）
    app.get('/api/admin/announcements', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: { announcements: announcements.getAnnouncements() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/announcements', (req: Request, res: Response) => {
        try {
            const result = announcements.addAnnouncement(req.body || {});
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { announcements: result.announcements } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.put('/api/admin/announcements/:id', (req: Request, res: Response) => {
        try {
            const result = announcements.updateAnnouncement(req.params.id, req.body || {});
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { announcements: result.announcements } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/admin/announcements/:id', (req: Request, res: Response) => {
        try {
            const result = announcements.deleteAnnouncement(req.params.id);
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { announcements: result.announcements } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountAnnouncementRoutes };
