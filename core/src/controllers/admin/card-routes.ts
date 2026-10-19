import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 卡密管理路由：时间卡/额度卡的生成、启停、核销与实例账号额度设置。
 */

const store = require('../../models/store');
const cardStore = require('../../models/card-store');
const { createModuleLogger } = require('../../services/logger');
const { handleApiError } = require('./middleware');

const adminLogger = createModuleLogger('admin');

function normalizeCardInput(body: Record<string, any>): { description: string; options: Record<string, unknown> } {
    const description = String(body.description || '').trim();
    if (!description) throw new Error('请输入卡密描述');

    const type = body.type === 'quota' ? 'quota' : 'time';
    if (type === 'quota') {
        const value = Number(body.value ?? body.durationValue ?? body.days);
        if (!Number.isFinite(value) || value <= 0) throw new Error('额度卡数量必须大于 0');
        return { description, options: { type, value } };
    }

    const durationValue = body.durationValue !== undefined ? body.durationValue : body.days;
    const options: Record<string, unknown> = {
        type,
        durationValue,
        durationUnit: body.durationUnit,
        isPermanent: body.isPermanent === true || Number(durationValue) === -1,
    };
    if (!options.isPermanent && (!Number.isFinite(Number(durationValue)) || Number(durationValue) <= 0)) {
        throw new Error('时间卡时长必须大于 0，永久卡请使用 -1');
    }
    return { description, options };
}

function getAccountCount(): number {
    const data = store.getAccounts();
    return Array.isArray(data?.accounts) ? data.accounts.length : 0;
}

function buildOverview() {
    const settings = store.getCardSettings();
    return {
        settings,
        accountCount: getAccountCount(),
        availableTimeCards: cardStore.getAvailableTimeCardCount(),
    };
}

function findAccountById(id: unknown) {
    const target = String(id || '').trim();
    if (!target) return null;
    const data = store.getAccounts();
    return (data.accounts || []).find((account: any) => String(account.id) === target) || null;
}

function mountCardRoutes(app: Application, _ctx: AdminContext): void {
    app.get('/api/admin/cards', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: cardStore.getAllCards() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.get('/api/admin/cards/overview', (_req: Request, res: Response) => {
        try {
            res.json({ ok: true, data: buildOverview() });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cards/settings', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const current = store.getCardSettings();
            const enabled = body.enabled !== undefined ? body.enabled === true : current.enabled;

            // 开启管控时把上限抬到不低于存量账号数，保证已有账号不受影响。
            let accountLimit = body.accountLimit !== undefined && body.accountLimit !== null
                ? Math.max(0, Number.parseInt(body.accountLimit, 10) || 0)
                : current.accountLimit;
            if (enabled && accountLimit < getAccountCount()) {
                accountLimit = getAccountCount();
            }

            const saved = store.setCardSettings({ enabled, accountLimit });
            adminLogger.info('更新卡密设置', { enabled: saved.enabled, accountLimit: saved.accountLimit });
            res.json({ ok: true, data: saved });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cards', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const { description, options } = normalizeCardInput(body);
            const count = Math.min(Math.max(Number.parseInt(String(body.count), 10) || 1, 1), 100);

            if (count > 1) {
                const cards = cardStore.createCardsBatch(description, count, options);
                adminLogger.warn('批量创建卡密', { count: cards.length, type: options.type, description });
                return res.json({ ok: true, data: cards, batch: true, count: cards.length });
            }

            const card = cardStore.createCard(description, options);
            adminLogger.info('创建卡密', { code: card.code, type: card.type, description });
            res.json({ ok: true, data: card });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cards/batch-delete', (req: Request, res: Response) => {
        try {
            const { codes } = req.body || {};
            const result = cardStore.deleteCardsBatch(codes);
            adminLogger.warn('批量删除卡密', { deleteCount: result.deletedCount, notFoundCount: result.notFoundCount });
            res.json({ ok: true, ...result });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cards/use', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const result = cardStore.useCard(body.code, body.accountId, findAccountById);
            if (!result.ok) {
                return res.status(400).json({ ok: false, error: result.error });
            }
            if (result.cardType === 'quota') {
                store.setCardSettings({ accountLimit: result.accountLimit });
                adminLogger.info('核销额度卡密', { code: result.card.code, accountLimit: result.accountLimit });
            } else {
                adminLogger.info('核销时间卡密', { code: result.card.code, accountId: result.account?.id || '' });
            }
            res.json({ ok: true, data: result });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.post('/api/admin/cards/:code', (req: Request, res: Response) => {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const card = cardStore.updateCard(req.params.code, body);
            if (!card) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            adminLogger.warn('更新卡密状态', { code: card.code, enabled: card.enabled });
            res.json({ ok: true, data: card });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/admin/cards/:code', (req: Request, res: Response) => {
        try {
            const deleted = cardStore.deleteCard(req.params.code);
            if (!deleted) {
                return res.status(404).json({ ok: false, error: '卡密不存在' });
            }
            adminLogger.warn('删除卡密', { code: String(req.params.code || '').toUpperCase() });
            res.json({ ok: true });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountCardRoutes };
