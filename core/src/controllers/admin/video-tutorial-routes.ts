import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 视频教程路由：
 * - GET    /api/video-tutorials            教程视频列表（公开：主页视频教程入口未登录也可看）
 * - GET    /api/admin/video-tutorials      管理列表（仅超管）
 * - POST   /api/admin/video-tutorials      新增视频（仅超管）
 * - PUT    /api/admin/video-tutorials/:id  编辑视频（仅超管）
 * - DELETE /api/admin/video-tutorials/:id  删除视频（仅超管）
 */

const { handleApiError } = require('./middleware');
const videoStore = require('../../models/store/video-tutorials');

function mountVideoTutorialRoutes(app: Application, _ctx: AdminContext): void {
    app.get('/api/video-tutorials', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: { videos: videoStore.getVideoTutorials() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/admin/video-tutorials', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: { videos: videoStore.getVideoTutorials() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/video-tutorials', (req: Request, res: Response) => {
        try {
            const result = videoStore.addVideoTutorial(req.body || {});
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { videos: result.videos } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.put('/api/admin/video-tutorials/:id', (req: Request, res: Response) => {
        try {
            const result = videoStore.updateVideoTutorial(req.params.id, req.body || {});
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { videos: result.videos } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/admin/video-tutorials/:id', (req: Request, res: Response) => {
        try {
            const result = videoStore.deleteVideoTutorial(req.params.id);
            if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
            res.json({ ok: true, data: { videos: result.videos } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountVideoTutorialRoutes };
