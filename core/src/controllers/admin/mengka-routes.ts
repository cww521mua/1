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
 * - GET  /api/mengka/protocols            可选登录协议列表（Android Phone）
 * - POST /api/mengka/verify/methods       查询安全验证方式（短信/扫码）
 * - POST /api/mengka/verify/sms           请求短信验证（4=接收验证码 / 3=发送短信）
 * - POST /api/mengka/verify/check-sms     提交短信验证（通过后自动完成登录）
 * - POST /api/mengka/verify/slider        提交滑块验证结果
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
const VERIFY_TIMEOUT_MS = 20000;

/** 萌卡登录验证返回码（文档：login_account / Bot 登录流程） */
const LOGIN_CODE_VERIFY = 140022010;
const LOGIN_CODE_SLIDER = 140022008;
const LOGIN_CODE_IDENTITY = 140022007;
const LOGIN_CODE_WRONG_PASSWORD = 140022013;

/**
 * 查询安全验证方式（verify_list：4=接收短信、3=发送短信、10=扫码）。
 * 查询失败时返回 null（调用方降级出二维码）。
 */
async function queryVerifyMethods(selfId: string): Promise<{ reasonPrompt: string, verifyList: number[], smsPhoneSign: string, securityUrl: string } | null> {
    try {
        const data = await mengka.callAction('get_security_verify_methods', { self_id: Number(selfId) }, VERIFY_TIMEOUT_MS);
        const methods = data?.methods || {};
        const list = Array.isArray(methods.verify_list) ? methods.verify_list.map((item: any) => Number(item)).filter(Number.isFinite) : [];
        return {
            reasonPrompt: String(data?.reason?.prompt || methods.prompt || '当前账号需要安全验证'),
            verifyList: list,
            smsPhoneSign: String(methods.sms_phone?.sign || ''),
            securityUrl: '',
        };
    } catch (e: any) {
        mengkaLogger.warn('查询萌卡安全验证方式失败', { selfId, error: e?.message });
        return null;
    }
}

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

/**
 * 依据登录返回 code 构造前端验证状态机所需的响应数据：
 * 140022010 → verify（短信/扫码选择）；140022008 → slider；140022007 → identity（V1 引导 WebUI）。
 * 安全验证方式查询失败时降级出二维码。无法识别的 code 返回 null。
 */
async function buildVerifyResponse(selfId: string, code: number, raw: any): Promise<any | null> {
    if (code === LOGIN_CODE_VERIFY) {
        const methods = await queryVerifyMethods(selfId);
        if (methods) {
            return {
                mode: 'verify',
                qq: selfId,
                reasonPrompt: methods.reasonPrompt,
                verifyList: methods.verifyList,
                smsPhoneSign: methods.smsPhoneSign,
                securityUrl: methods.securityUrl,
            };
        }
        const qr = await issueLoginQr(selfId);
        return { mode: 'qr', qq: selfId, qrUrl: qr.qrUrl, guaranteeToken: qr.guaranteeToken, expiresIn: qr.expiresIn };
    }
    if (code === LOGIN_CODE_SLIDER) {
        return { mode: 'slider', qq: selfId, sliderUrl: String(raw?.slider_url || '') };
    }
    if (code === LOGIN_CODE_IDENTITY) {
        return { mode: 'identity', qq: selfId, identityUrl: String(raw?.identity_url || '') };
    }
    return null;
}

/**
 * 登录/验证提交结果的统一响应：
 * code 0 → 写绑定（已绑定保持原归属仅同步昵称）并返回 bound；
 * 其余转前端状态机数据（verify/slider/identity）或提示文案。
 */
async function respondLoginResult(res: Response, selfId: string, raw: any, owner: string): Promise<void> {
    const code = Number(raw?.code);
    if (code === 0) {
        const nickname = await getBotNickname(selfId);
        const existing = store.findMengkaBinding(selfId);
        if (existing) {
            if (existing.nickname !== nickname)
                store.upsertMengkaBinding(selfId, existing.owner, nickname);
        }
        else {
            await bindAccountToOwner(selfId, owner, nickname);
        }
        mengkaLogger.info('萌卡 QQ 登录成功', { selfId, owner });
        res.json({ ok: true, data: { mode: 'bound', qq: selfId, nickname } });
        return;
    }
    const verifyData = await buildVerifyResponse(selfId, code, raw);
    if (verifyData) {
        res.json({ ok: true, data: verifyData });
        return;
    }
    if (code === LOGIN_CODE_WRONG_PASSWORD) {
        res.status(400).json({ ok: false, error: 'QQ 密码错误，请检查后重试', code });
        return;
    }
    res.status(502).json({ ok: false, error: String(raw?.message || raw?.result?.prompt || `登录未完成（code ${code}）`), code });
}

async function pickNodeId(): Promise<number> {
    const nodes = await mengka.getNodes();
    const node = (Array.isArray(nodes) ? nodes : []).find(item => item && item.enabled !== false) || nodes?.[0];
    const id = Number(node?.id);
    if (!Number.isFinite(id)) throw new Error('萌卡暂无可用登录节点');
    return id;
}

/** 确保框架中存在该 QQ 的安卓账号，返回是否为本次新建。 */
async function ensureAccount(selfId: string, password: string, protocolId: number = ANDROID_PROTOCOL_ID): Promise<boolean> {
    const bots = await mengka.getBots();
    if (bots.some(item => item.selfId === selfId)) return false;
    const nodeId = await pickNodeId();
    await mengka.callAction('add_account', {
        self_id: Number(selfId),
        password,
        protocol_id: Number.isInteger(protocolId) ? protocolId : ANDROID_PROTOCOL_ID,
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
                const protocolId = Number.isInteger(Number(body.protocol_id)) ? Number(body.protocol_id) : ANDROID_PROTOCOL_ID;
                await ensureAccount(qq, password || `mk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, protocolId);
                if (password)
                    await syncAccountPassword(qq, password);

                mengkaLogger.info('发起萌卡 QQ 登录', { qq, owner, hasPassword: !!password, protocolId });
                const loginResult = await mengka.callAction('login_account', { self_id: Number(qq) }, LOGIN_TIMEOUT_MS);
                await respondLoginResult(res, qq, loginResult, owner);
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
                const owner = resolveBindingOwner(ctx, req, res);
                if (!owner) return;
                await respondLoginResult(res, selfId, loginResult, owner);
            } catch (e: any) {
                mengkaLogger.warn('萌卡 QQ 重新登录失败', { selfId, error: e?.message });
                return handleApiError(res, e);
            }
        })();
    });

    // 协议列表（添加账号时选择登录协议；农场取码仅 Android 协议支持）
    app.get('/api/mengka/protocols', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            try {
                const protocols = await mengka.callAction('get_protocol_list', {}, VERIFY_TIMEOUT_MS);
                const list = (Array.isArray(protocols) ? protocols : []).filter(item => item && item.type === 'Phone');
                res.json({ ok: true, data: { protocols: list } });
            } catch (e: any) {
                handleApiError(res, e);
            }
        })();
    });

    /**
     * 校验 verify 操作的目标账号归属：有绑定时须属于本人（管理员放行）；
     * 无绑定放行——新 QQ 首次登录时尚未建立绑定。
     */
    function ensureVerifyAccessible(ctx: AdminContext, req: Request, res: Response, selfId: string): boolean {
        const identity = getIdentity(ctx, req);
        if (isAdminIdentity(identity)) return true;
        const binding = store.findMengkaBinding(selfId);
        if (binding && binding.owner !== identity.username) {
            res.status(403).json({ ok: false, error: '无权操作该萌卡账号' });
            return false;
        }
        return true;
    }

    // 查询安全验证方式（短信/扫码等；登录 140022010 后由前端调用）
    app.post('/api/mengka/verify/methods', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const qq = String((req.body || {}).qq || '').trim();
            if (!/^\d{5,12}$/.test(qq)) {
                return res.status(400).json({ ok: false, error: '缺少有效的萌卡账号' });
            }
            if (!ensureVerifyAccessible(ctx, req, res, qq)) return;
            try {
                const methods = await queryVerifyMethods(qq);
                if (!methods) {
                    return res.status(502).json({ ok: false, error: '查询安全验证方式失败，请稍后重试或改用扫码' });
                }
                res.json({ ok: true, data: methods });
            } catch (e: any) {
                handleApiError(res, e);
            }
        })();
    });

    // 安全验证选择扫码方式时创建登录二维码（配合 login-qr/poll 轮询）
    app.post('/api/mengka/verify/qr', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const body = req.body || {};
            const qq = String(body.self_id || body.qq || '').trim();
            if (!/^\d{5,12}$/.test(qq)) {
                return res.status(400).json({ ok: false, error: '缺少有效的萌卡账号' });
            }
            if (!ensureVerifyAccessible(ctx, req, res, qq)) return;
            try {
                const qr = await issueLoginQr(qq);
                res.json({ ok: true, data: { qrUrl: qr.qrUrl, guaranteeToken: qr.guaranteeToken, expiresIn: qr.expiresIn } });
            } catch (e: any) {
                handleApiError(res, e);
            }
        })();
    });

    // 请求短信验证（verify_type 4=接收短信验证码，3=发送短信）
    app.post('/api/mengka/verify/sms', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const body = req.body || {};
            const qq = String(body.qq || '').trim();
            const verifyType = Number(body.verifyType);
            const sign = String(body.sign || '').trim();
            if (!/^\d{5,12}$/.test(qq) || ![3, 4].includes(verifyType) || !sign) {
                return res.status(400).json({ ok: false, error: '缺少有效的短信验证参数' });
            }
            if (!ensureVerifyAccessible(ctx, req, res, qq)) return;
            try {
                const sms = await mengka.callAction('get_sms', {
                    self_id: Number(qq),
                    verify_type: verifyType,
                    sign,
                }, VERIFY_TIMEOUT_MS);
                if (Number(sms?.result?.state) !== 1) {
                    return res.json({ ok: true, data: { failed: true, prompt: String(sms?.result?.prompt || '短信验证请求失败') } });
                }
                res.json({
                    ok: true,
                    data: {
                        sign: String(sms?.sign || ''),
                        maskedPhone: String(sms?.masked_phone || ''),
                        smsContent: sms?.sms === undefined ? '' : String(sms.sms),
                        sendTo: sms?.send_to === undefined ? '' : String(sms.send_to),
                    },
                });
            } catch (e: any) {
                handleApiError(res, e);
            }
        })();
    });

    // 提交短信验证（type 4 提交验证码；type 3 回查是否已收到短信），通过后自动完成登录
    app.post('/api/mengka/verify/check-sms', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const body = req.body || {};
            const qq = String(body.qq || '').trim();
            const verifyType = Number(body.verifyType);
            const sign = String(body.sign || '').trim();
            const code = String(body.code || '').trim();
            if (!/^\d{5,12}$/.test(qq) || ![3, 4].includes(verifyType) || !sign || (verifyType === 4 && !code)) {
                return res.status(400).json({ ok: false, error: '缺少有效的短信验证提交参数' });
            }
            if (!ensureVerifyAccessible(ctx, req, res, qq)) return;
            const owner = resolveBindingOwner(ctx, req, res);
            if (!owner) return;
            try {
                const params: Record<string, unknown> = {
                    self_id: Number(qq),
                    verify_type: verifyType,
                    sign,
                };
                if (verifyType === 4) params.code = code;
                const result = await mengka.callAction('check_sms', params, LOGIN_TIMEOUT_MS);
                if (result && result.result !== undefined) {
                    // 校验未通过：返回原始 prompt，登录会话保留，可用同一 sign 重试
                    return res.json({ ok: true, data: { passed: false, prompt: String(result.result?.prompt || '验证未通过，请重试') } });
                }
                await respondLoginResult(res, qq, result, owner);
            } catch (e: any) {
                handleApiError(res, e);
            }
        })();
    });

    // 提交滑块验证结果（ticket/randstr 来自滑块完成后跳转的 URL）
    app.post('/api/mengka/verify/slider', (req: Request, res: Response) => {
        (async () => {
            if (!ensureMengkaEnabled(res)) return;
            const body = req.body || {};
            const qq = String(body.qq || '').trim();
            const ticket = String(body.ticket || '').trim();
            const randstr = String(body.randstr || '').trim();
            if (!/^\d{5,12}$/.test(qq) || !ticket || !randstr) {
                return res.status(400).json({ ok: false, error: '缺少有效的滑块验证参数' });
            }
            if (!ensureVerifyAccessible(ctx, req, res, qq)) return;
            const owner = resolveBindingOwner(ctx, req, res);
            if (!owner) return;
            try {
                const result = await mengka.callAction('submit_slider', {
                    self_id: Number(qq),
                    ticket,
                    randstr,
                }, LOGIN_TIMEOUT_MS);
                await respondLoginResult(res, qq, result, owner);
            } catch (e: any) {
                handleApiError(res, e);
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
