import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 萌卡 NT 对接接口：
 * - GET  /api/mengka/status               连接状态与节点信息（登录用户）
 * - GET  /api/mengka/bots                 萌卡账号列表（登录用户，按绑定归属过滤；管理员附 owner）
 * - POST /api/mengka/farm-code            取农场授权 Code（登录用户，校验归属）
 * - POST /api/mengka/login-qr/start       发起 QQ 扫码登录进萌卡（登录用户）
 * - POST /api/mengka/login-qr/poll        轮询扫码状态，确认后写绑定与租约（登录用户）
 * - POST /api/mengka/relogin              重新登录掉线的萌卡账号（登录用户，校验归属）
 * - GET  /api/mengka/bindings             绑定列表（仅超管）
 * - DELETE /api/mengka/bindings/:selfId   解绑（绑定本人或超管）
 * - GET  /api/settings/mengka-config      读取对接配置（仅超管，不回显令牌）
 * - POST /api/settings/mengka-config      保存对接配置（仅超管）
 */

const store = require('../../models/store');
const userStore = require('../../models/user-store');
const mengka = require('../../services/mengka-connector');
const { getIdentity, isAdminIdentity, handleApiError } = require('./middleware');

const mengkaLogger = require('../../services/logger').createModuleLogger('mengka');

const ANDROID_PROTOCOL_ID = 0;
const ADD_ACCOUNT_TIMEOUT_MS = 30000;
const LOGIN_TIMEOUT_MS = 60000;
const QR_CREATE_TIMEOUT_MS = 30000;
const POLL_TIMEOUT_MS = 20000;
const LEASE_TIMEOUT_MS = 15000;

/** 萌卡登录需要额外验证的返回码（文档：login_account） */
const LOGIN_CODE_NEEDS_QR = new Set([140022007, 140022008, 140022010]);
const LOGIN_CODE_WRONG_PASSWORD = 140022013;

function requireAdmin(ctx: AdminContext, req: Request, res: Response): boolean {
    if (!isAdminIdentity(getIdentity(ctx, req))) {
        res.status(403).json({ ok: false, error: '该操作仅超级管理员可用' });
        return false;
    }
    return true;
}

function ensureMengkaEnabled(res: Response): boolean {
    const state = mengka.status();
    if (!state.enabled) {
        res.status(400).json({ ok: false, error: '萌卡对接未启用' });
        return false;
    }
    return true;
}

/**
 * 解析本次操作的绑定归属：普通用户固定为自己；管理员可指定 owner（缺省为自己）。
 * 校验失败时已写响应并返回 null。
 */
function resolveBindingOwner(ctx: AdminContext, req: Request, res: Response): string | null {
    const identity = getIdentity(ctx, req);
    if (!isAdminIdentity(identity)) return identity.username;
    const ownerName = String((req.body || {}).owner || '').trim();
    if (!ownerName) return identity.username;
    if (!userStore.getUserInfo(ownerName)) {
        res.status(400).json({ ok: false, error: '归属用户不存在' });
        return null;
    }
    return ownerName;
}

/** 写绑定与萌卡侧授权租约；已被他人绑定时抛错。 */
async function bindAccountToOwner(selfId: string, owner: string, nickname: string): Promise<void> {
    const existing = store.findMengkaBinding(selfId);
    if (existing && existing.owner && existing.owner !== owner) {
        throw new Error('该 QQ 已绑定其他用户');
    }
    store.upsertMengkaBinding(selfId, owner, nickname);
    try {
        await mengka.callAction('set_account_access', {
            self_id: Number(selfId),
            client_type: 'android',
            owner_id: owner,
            enabled: true,
        }, LEASE_TIMEOUT_MS);
    } catch (e: any) {
        mengkaLogger.warn('写入萌卡授权租约失败（绑定仍有效）', { selfId, error: e?.message });
    }
}

async function getBotNickname(selfId: string): Promise<string> {
    try {
        const bots = await mengka.getBots();
        const bot = bots.find(item => item.selfId === selfId);
        return bot?.nickname || '';
    } catch {
        return '';
    }
}

/** 为等待安全验证的账号创建登录二维码（start 与 relogin 共用）。 */
async function issueLoginQr(selfId: string): Promise<{ qrUrl: string, guaranteeToken: string, expiresIn: number }> {
    const qr = await mengka.callAction('create_login_qr', { self_id: Number(selfId) }, QR_CREATE_TIMEOUT_MS);
    const qrUrl = String(qr?.qr_url || '').trim();
    const guaranteeToken = String(qr?.guarantee_token || '').trim();
    if (!qrUrl || !guaranteeToken) {
        throw new Error('萌卡未返回有效的登录二维码');
    }
    return { qrUrl, guaranteeToken, expiresIn: Number(qr?.expires_in) || 180 };
}

async function pickNodeId(): Promise<number> {
    const nodes = await mengka.getNodes();
    const node = (Array.isArray(nodes) ? nodes : []).find(item => item && item.enabled !== false) || nodes?.[0];
    const id = Number(node?.id);
    if (!Number.isFinite(id)) throw new Error('萌卡暂无可用登录节点');
    return id;
}

/** 确保框架中存在该 QQ 的安卓账号，返回是否为本次新建。 */
async function ensureAccount(selfId: string, password: string): Promise<boolean> {
    const bots = await mengka.getBots();
    if (bots.some(item => item.selfId === selfId)) return false;
    const nodeId = await pickNodeId();
    await mengka.callAction('add_account', {
        self_id: Number(selfId),
        password,
        protocol_id: ANDROID_PROTOCOL_ID,
        node_id: nodeId,
        client_type: 'android',
    }, ADD_ACCOUNT_TIMEOUT_MS);
    return true;
}

/**
 * 账号离线且提供了新密码时，更新框架中保存的密码。
 * 用于修复历史扫码建号时写入的占位密码（掉线后密码登录会报 140022013）。
 */
async function syncAccountPassword(selfId: string, password: string): Promise<void> {
    const bots = await mengka.getBots();
    const bot = bots.find(item => item.selfId === selfId);
    if (!bot || bot.online) return;
    await mengka.callAction('update_account', {
        self_id: Number(selfId),
        password,
        protocol_id: Number(bot.protocolId) || 0,
        client_type: 'android',
    }, ADD_ACCOUNT_TIMEOUT_MS);
    mengkaLogger.info('萌卡账号密码已更新', { selfId });
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
            const identity = getIdentity(ctx, req);
            const isAdmin = isAdminIdentity(identity);
            mengka.getBots()
                .then((bots) => {
                    let list: any[];
                    if (isAdmin) {
                        const ownerMap = new Map(store.getMengkaBindings().map(item => [item.selfId, item.owner]));
                        list = bots.map(bot => ({ ...bot, owner: ownerMap.get(bot.selfId) || null }));
                    } else {
                        const owned = new Set(store.findMengkaBindingsByOwner(identity.username).map(item => item.selfId));
                        list = bots.filter(bot => owned.has(bot.selfId));
                    }
                    res.json({ ok: true, data: { enabled: true, connected: state.connected, bots: list } });
                })
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
            const identity = getIdentity(ctx, req);
            if (!isAdminIdentity(identity)) {
                const binding = store.findMengkaBinding(selfId);
                if (!binding || binding.owner !== identity.username) {
                    return res.status(403).json({ ok: false, error: '无权使用该萌卡账号' });
                }
            }
            mengka.getFarmCode(selfId)
                .then(code => res.json({ ok: true, data: { code } }))
                .catch((e: any) => res.status(502).json({ ok: false, error: e?.message || '获取农场授权 Code 失败' }));
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    // 发起 QQ 扫码登录：建号（幂等）→ 密码登录；需安全验证时出二维码
    app.post('/api/mengka/login-qr/start', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const owner = resolveBindingOwner(ctx, req, res);
            if (!owner) return;

            const body = req.body || {};
            const qq = String(body.qq || '').trim();
            const password = String(body.password || '');
            if (!/^\d{5,12}$/.test(qq)) {
                return res.status(400).json({ ok: false, error: '请输入有效的 QQ 号（5-12 位数字）' });
            }

            const existingBinding = store.findMengkaBinding(qq);
            if (existingBinding && existingBinding.owner !== owner) {
                return res.status(403).json({ ok: false, error: '该 QQ 已绑定其他用户' });
            }

            try {
                await ensureAccount(qq, password || `mk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
                if (password)
                    await syncAccountPassword(qq, password);

                mengkaLogger.info('发起萌卡 QQ 登录', { qq, owner, hasPassword: !!password });
                const loginResult = await mengka.callAction('login_account', { self_id: Number(qq) }, LOGIN_TIMEOUT_MS);
                const code = Number(loginResult?.code);

                if (code === 0) {
                    const nickname = await getBotNickname(qq);
                    await bindAccountToOwner(qq, owner, nickname);
                    mengkaLogger.info('萌卡 QQ 登录成功（缓存登录）', { qq, owner });
                    return res.json({ ok: true, data: { mode: 'bound', qq, nickname } });
                }

                if (LOGIN_CODE_NEEDS_QR.has(code)) {
                    const qr = await issueLoginQr(qq);
                    return res.json({
                        ok: true,
                        data: {
                            mode: 'qr',
                            qq,
                            qrUrl: qr.qrUrl,
                            guaranteeToken: qr.guaranteeToken,
                            expiresIn: qr.expiresIn,
                        },
                    });
                }

                if (code === LOGIN_CODE_WRONG_PASSWORD) {
                    const message = password
                        ? 'QQ 密码错误，请检查后重试'
                        : '该 QQ 需要密码登录，请填写 QQ 密码后重试';
                    return res.status(400).json({ ok: false, error: message, code });
                }

                return res.status(502).json({ ok: false, error: String(loginResult?.message || `登录失败（code ${code}）`), code });
            } catch (e: any) {
                mengkaLogger.warn('萌卡 QQ 登录发起失败', { qq, error: e?.message });
                return handleApiError(res, e);
            }
        })();
    });

    // 轮询扫码状态；confirmed 时写绑定与租约
    app.post('/api/mengka/login-qr/poll', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const owner = resolveBindingOwner(ctx, req, res);
            if (!owner) return;

            const body = req.body || {};
            const qq = String(body.qq || '').trim();
            const guaranteeToken = String(body.guaranteeToken || '').trim();
            if (!/^\d{5,12}$/.test(qq) || !guaranteeToken) {
                return res.status(400).json({ ok: false, error: '缺少有效的轮询参数' });
            }

            try {
                const status = await mengka.callAction('query_login_qr_status', {
                    self_id: Number(qq),
                    guarantee_token: guaranteeToken,
                }, POLL_TIMEOUT_MS);
                const state = String(status?.status || '');

                if (state === 'confirmed') {
                    const nickname = await getBotNickname(qq);
                    // 已绑定（如掉线后重新登录确认）保持原归属，仅同步昵称；新 QQ 才写绑定与租约
                    const existing = store.findMengkaBinding(qq);
                    if (existing) {
                        if (existing.nickname !== nickname)
                            store.upsertMengkaBinding(qq, existing.owner, nickname);
                    }
                    else {
                        await bindAccountToOwner(qq, owner, nickname);
                    }
                    mengkaLogger.info('萌卡 QQ 扫码登录成功', { qq, owner });
                    return res.json({ ok: true, data: { state: 'confirmed', qq, nickname } });
                }

                if (!['waiting', 'scanned', 'expired'].includes(state)) {
                    return res.status(502).json({ ok: false, error: String(status?.message || `未知扫码状态: ${state || status?.status_code}`) });
                }
                return res.json({ ok: true, data: { state, qq } });
            } catch (e: any) {
                return handleApiError(res, e);
            }
        })();
    });

    // 重新登录掉线的萌卡账号（缓存登录或扫码确认）
    app.post('/api/mengka/relogin', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const body = req.body || {};
            const selfId = String(body.self_id || '').trim();
            const password = String(body.password || '');
            if (!/^\d{5,12}$/.test(selfId)) {
                return res.status(400).json({ ok: false, error: '缺少有效的萌卡账号' });
            }
            const identity = getIdentity(ctx, req);
            if (!isAdminIdentity(identity)) {
                const binding = store.findMengkaBinding(selfId);
                if (!binding || binding.owner !== identity.username) {
                    return res.status(403).json({ ok: false, error: '无权操作该萌卡账号' });
                }
            }
            try {
                const bots = await mengka.getBots();
                if (!bots.some(item => item.selfId === selfId)) {
                    return res.status(404).json({ ok: false, error: '萌卡框架中不存在该账号' });
                }
                if (password)
                    await syncAccountPassword(selfId, password);
                mengkaLogger.info('发起萌卡 QQ 重新登录', { selfId, hasPassword: !!password });
                const loginResult = await mengka.callAction('login_account', { self_id: Number(selfId) }, LOGIN_TIMEOUT_MS);
                const code = Number(loginResult?.code);

                if (code === 0) {
                    const nickname = await getBotNickname(selfId);
                    return res.json({ ok: true, data: { mode: 'bound', qq: selfId, nickname } });
                }

                if (LOGIN_CODE_NEEDS_QR.has(code)) {
                    const qr = await issueLoginQr(selfId);
                    return res.json({
                        ok: true,
                        data: {
                            mode: 'qr',
                            qq: selfId,
                            qrUrl: qr.qrUrl,
                            guaranteeToken: qr.guaranteeToken,
                            expiresIn: qr.expiresIn,
                        },
                    });
                }

                if (code === LOGIN_CODE_WRONG_PASSWORD) {
                    return res.status(400).json({
                        ok: false,
                        error: 'QQ 密码错误，请检查后重试；也可解绑后用「扫码登录新 QQ」重新添加',
                        code,
                    });
                }

                return res.status(502).json({ ok: false, error: String(loginResult?.message || `登录失败（code ${code}）`), code });
            } catch (e: any) {
                mengkaLogger.warn('萌卡 QQ 重新登录失败', { selfId, error: e?.message });
                return handleApiError(res, e);
            }
        })();
    });

    // 绑定管理（列表仅超管）
    app.get('/api/mengka/bindings', (req: Request, res: Response) => {
        if (!requireAdmin(ctx, req, res)) return;
        try {
            res.json({ ok: true, data: { bindings: store.getMengkaBindings() } });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });

    app.delete('/api/mengka/bindings/:selfId', (req: Request, res: Response) => {
        try {
            const selfId = String(req.params.selfId || '').trim();
            if (!/^\d{5,12}$/.test(selfId)) {
                return res.status(400).json({ ok: false, error: '无效的 QQ 号' });
            }
            const identity = getIdentity(ctx, req);
            if (!isAdminIdentity(identity)) {
                const binding = store.findMengkaBinding(selfId);
                if (!binding || binding.owner !== identity.username) {
                    return res.status(403).json({ ok: false, error: '无权解绑该萌卡账号' });
                }
            }
            store.deleteMengkaBinding(selfId);
            try {
                mengka.callAction('set_account_access', {
                    self_id: Number(selfId),
                    client_type: 'android',
                    enabled: false,
                }, LEASE_TIMEOUT_MS).catch(() => { /* 撤租约失败不阻塞解绑 */ });
            } catch { /* ignore */ }
            mengkaLogger.info('萌卡 QQ 绑定已解除', { selfId });
            res.json({ ok: true });
        } catch (e: any) {
            handleApiError(res, e);
        }
    });
}

module.exports = { mountMengkaRoutes };
