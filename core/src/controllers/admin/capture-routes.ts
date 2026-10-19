import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * Code/GID 抓包登录路由（嵌入模式）
 *
 * 移植自 qq-farm-bot 抓包登录实现：MITM 代理抓取网关 WebSocket 登录 code，
 * 同时解析好友 GID；账号添加后自动启动并后台同步好友列表。
 */

const crypto = require('node:crypto');
const store = require('../../models/store');
const cardStore = require('../../models/card-store');
const userStore = require('../../models/user-store');
const { findAccountByRef } = require('../../services/account-resolver');
const {
    createAuthRequired,
    handleApiError,
    getIdentity,
    isAdminIdentity,
    isAccountAccessible,
} = require('./middleware');
const { createModuleLogger } = require('../../services/logger');

const logger = createModuleLogger('capture');

const CAPTURE_FLOW_TTL_MS = 15 * 60 * 1000;
const QQ_FRIEND_COLLECTION_MAX_MS = 15_000;
const QQ_FRIEND_COLLECTION_POLL_MS = 1500;
const CAPTURE_ACCOUNT_START_DELAY_MS = 1500;
const COMPLETE_QQ_FRIEND_SOURCES = new Set([
    'gamepb.friendpb.FriendService.GetAll',
    'gamepb.friendpb.FriendService.SyncAll',
]);

const captureFlows = new Map<string, any>();

let embeddedCaptureCore: any = null;

function setEmbeddedCapture(core: any): void {
    embeddedCaptureCore = core || null;
}

function isEmbeddedMode(): boolean {
    return !!embeddedCaptureCore;
}

async function captureRequest(path: string, options: any = {}): Promise<any> {
    if (!embeddedCaptureCore) throw new Error('抓包服务未启用');
    const result = await embeddedCaptureCore.handleApiRequest(
        options.method || 'GET',
        path,
        options.body,
        { sessionId: options.sessionId },
    );
    const data = result?.body || {};
    if (result?.status >= 400 || data?.ok === false) {
        const error: any = new Error(data?.error || `抓包服务请求失败（${result?.status || 500}）`);
        error.captureStatus = result?.status;
        throw error;
    }
    return data;
}

function getCaptureBypassHosts(req: Request): string[] {
    const values: any[] = [
        req?.hostname,
        req?.headers?.['x-forwarded-host'],
        req?.headers?.host,
        req?.headers?.origin,
        req?.headers?.referer,
    ];
    const hosts: string[] = [];
    for (const value of values) {
        const raw = String(value || '').split(',')[0].trim();
        if (!raw) continue;
        try {
            const host = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname
                .replace(/^\[|\]$/g, '')
                .toLowerCase();
            if (host && !hosts.includes(host)) hosts.push(host);
        } catch { /* ignore */ }
    }
    return hosts.slice(0, 8);
}

/** 嵌入 Docker 时网卡自动探测只能看到容器 IP；此时使用浏览器访问面板的地址。 */
function getCaptureAdvertiseHost(req: Request): string {
    const values: any[] = [
        req?.headers?.['x-forwarded-host'],
        req?.headers?.host,
        req?.headers?.origin,
        req?.headers?.referer,
        req?.hostname,
    ];
    for (const value of values) {
        const raw = String(value || '').split(',')[0].trim();
        if (!raw) continue;
        try {
            const host = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`).hostname
                .replace(/^\[|\]$/g, '')
                .toLowerCase();
            if (host && host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') return host;
        } catch { /* ignore */ }
    }
    return '';
}

function isCompleteQqFriendSource(source: unknown): boolean {
    return COMPLETE_QQ_FRIEND_SOURCES.has(String(source || '').trim());
}

function addCapturedValues(flow: any, snapshot: any): void {
    const data = snapshot?.data || snapshot?.state || snapshot;
    if (!data || typeof data !== 'object') return;
    const channel = data.channels?.[flow.platform];
    const entries = Array.isArray(channel?.codes) ? channel.codes : [];
    const codeEntry = entries.find((item: any) => String(item?.code || '').trim());
    const gidEntry = entries.find((item: any) => String(item?.gid || '').trim());
    const openIdEntry = entries.find((item: any) => String(item?.openid || item?.open_id || '').trim());
    if (!flow.code && codeEntry) flow.code = String(codeEntry.code).trim();
    const versionEntry = entries.find((item: any) => String(item?.code || '').trim() === flow.code
        && /^\d+(?:\.\d+){2,4}_\d{8}$/.test(String(item?.clientVersion || '')));
    if (versionEntry) flow.clientVersion = versionEntry.clientVersion;
    if (!flow.accountGid && gidEntry) flow.accountGid = String(gidEntry.gid).trim();
    if (!flow.openId && openIdEntry) {
        flow.openId = String(openIdEntry.openid || openIdEntry.open_id).trim();
    }

    const friends = Array.isArray(data.friends?.items) ? data.friends.items : [];
    for (const friend of friends) {
        const gid = Number(friend?.gid);
        if (Number.isSafeInteger(gid) && gid > 0) flow.friendGids.add(gid);
    }
    const friendSource = String(data.friends?.source || '').trim();
    if (friendSource) flow.friendSource = friendSource;
    if (isCompleteQqFriendSource(friendSource)) flow.friendListComplete = true;

    flow.publicInfo = data.publicInfo || flow.publicInfo;
    flow.proxy = data.proxy || flow.proxy;
    flow.captureStatus = channel?.status || flow.captureStatus;
    flow.updatedAt = Date.now();
}

async function refreshFlow(flow: any): Promise<any> {
    const snapshot = await captureRequest(
        `/api/sessions/${encodeURIComponent(flow.remoteSessionId)}/state`,
        { sessionId: flow.remoteSessionId },
    );
    addCapturedValues(flow, snapshot);
    return flow;
}

function serializeFlow(flow: any): any {
    const autoStopSec = Number(flow.publicInfo?.mitmProxyAutoStopSec) || 0;
    const startedAt = Date.parse(flow.proxy?.startedAt || '');
    const elapsedSec = Number.isFinite(startedAt) ? Math.floor((Date.now() - startedAt) / 1000) : 0;
    return {
        id: flow.id,
        platform: flow.platform,
        codeCaptured: !!flow.code,
        accountGid: flow.accountGid,
        friendCount: flow.friendGids.size,
        captureStatus: flow.captureStatus,
        proxy: {
            running: flow.proxy?.running === true,
            status: String(flow.proxy?.status || ''),
            error: String(flow.proxy?.error || ''),
        },
        publicInfo: {
            host: String(flow.publicInfo?.host || ''),
            addresses: Array.isArray(flow.publicInfo?.addresses) ? flow.publicInfo.addresses : [],
            mitmPort: Number(flow.publicInfo?.mitmPort) || 0,
            mitmProxyAutoStopSec: autoStopSec,
            remainingSec: autoStopSec ? Math.max(0, autoStopSec - elapsedSec) : 0,
            certificateUrl: `/api/public/capture-certificate/${encodeURIComponent(flow.id)}/${encodeURIComponent(flow.certificateToken)}`,
        },
        completed: flow.completed === true,
        result: flow.result || null,
    };
}

async function stopRemoteFlow(flow: any): Promise<void> {
    let lastError: any = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
            await captureRequest(
                `/api/sessions/${encodeURIComponent(flow.remoteSessionId)}`,
                { method: 'DELETE', sessionId: flow.remoteSessionId },
            );
            return;
        } catch (error) {
            lastError = error;
        }

        try {
            await captureRequest('/api/capture/stop', {
                method: 'POST',
                sessionId: flow.remoteSessionId,
                body: {},
            });
            return;
        } catch (error) {
            lastError = error;
        }

        if (attempt < 3) await waitForNextCollectionPoll(attempt * 500);
    }
    throw lastError || new Error('抓包服务代理释放失败');
}

function scheduleRemoteStop(flow: any, delayMs = 5000): void {
    const timer = setTimeout(() => {
        void stopRemoteFlow(flow).catch((error: any) => {
            logger.warn('抓包服务代理释放失败', {
                remoteSessionId: flow.remoteSessionId,
                error: error.message,
            });
        });
    }, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
}

function waitForNextCollectionPoll(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, delayMs);
        if (typeof timer.unref === 'function') timer.unref();
    });
}

function isSameAccountInstance(accountId: string, accountCreatedAt: any): boolean {
    const account = (store.getAccounts().accounts || []).find(
        (item: any) => String(item.id) === String(accountId),
    );
    return !!account && String(account.createdAt || '') === String(accountCreatedAt || '');
}

function mergeKnownFriendGids(existingGids: number[], capturedGids: Iterable<number>, accountGid: any): number[] {
    const ownGid = Number(accountGid);
    return [...new Set([
        ...(Array.isArray(existingGids) ? existingGids : []).map(Number),
        ...capturedGids,
    ])].filter(
        (gid) => Number.isSafeInteger(gid) && gid > 0 && gid !== ownGid,
    );
}

function findDuplicateCapturedAccount(accounts: any[], flow: any, excludedAccountId = ''): any {
    const code = String(flow?.code || '').trim();
    const platform = flow?.platform === 'wx' ? 'wx' : 'qq';
    return (Array.isArray(accounts) ? accounts : []).find((account: any) => {
        if (String(account?.id || '') === String(excludedAccountId || '')) return false;
        if ((account?.platform === 'wx' ? 'wx' : 'qq') !== platform) return false;
        return !!code && String(account?.code || '').trim() === code;
    }) || null;
}

async function collectQqFriendGids(options: any): Promise<number> {
    const {
        provider,
        flow,
        accountId,
        accountCreatedAt,
        afterStop,
        maxWaitMs = QQ_FRIEND_COLLECTION_MAX_MS,
        pollMs = QQ_FRIEND_COLLECTION_POLL_MS,
    } = options;
    const deadline = Date.now() + maxWaitMs;
    let lastRefreshError: any = null;

    try {
        while (!flow.cancelled && Date.now() < deadline) {
            if (!isSameAccountInstance(accountId, accountCreatedAt)) {
                flow.cancelled = true;
                logger.info('账号已删除或替换，停止旧的好友 GID 后台同步', { accountId });
                return 0;
            }
            if (flow.friendListComplete) break;

            try {
                await refreshFlow(flow);
                lastRefreshError = null;
            } catch (error: any) {
                lastRefreshError = error;
            }
            if (flow.friendListComplete) break;

            const remainingMs = deadline - Date.now();
            if (remainingMs > 0) await waitForNextCollectionPoll(Math.min(pollMs, remainingMs));
        }

        if (flow.cancelled || !isSameAccountInstance(accountId, accountCreatedAt)) return 0;
        const knownGids = store.getKnownFriendGids(accountId) || [];
        const gids = mergeKnownFriendGids(knownGids, flow.friendGids, flow.accountGid);
        const previousGids = new Set(knownGids.map(Number));
        const importedFriendCount = gids.filter((gid: number) => !previousGids.has(gid)).length;
        if (importedFriendCount > 0) {
            store.setKnownFriendGids(accountId, gids);
            if (provider && typeof provider.broadcastConfig === 'function') {
                provider.broadcastConfig(accountId);
            }
        }
        if (flow.result) flow.result.importedFriendCount = importedFriendCount;
        logger.info('抓包登录好友 GID 后台同步完成', {
            accountId,
            capturedFriendCount: flow.friendGids.size,
            importedFriendCount,
            friendSource: flow.friendSource || '',
            completeFriendList: flow.friendListComplete === true,
            refreshError: lastRefreshError?.message || '',
        });
        return importedFriendCount;
    } finally {
        await stopRemoteFlow(flow);
        if (captureFlows.get(flow.id) === flow) captureFlows.delete(flow.id);
        if (
            typeof afterStop === 'function'
            && !flow.cancelled
            && isSameAccountInstance(accountId, accountCreatedAt)
        ) {
            await afterStop();
        }
    }
}

function scheduleQqFriendCollection(options: any): void {
    const { flow } = options;
    if (flow.friendCollectionScheduled) return;
    flow.friendCollectionScheduled = true;
    void collectQqFriendGids(options).catch((error: any) => {
        logger.warn('抓包登录账号已添加，但好友 GID 后台同步失败', {
            accountId: options.accountId,
            error: error.message,
        });
    });
}

function scheduleCapturedAccountStart(options: any): void {
    const { provider, flow, account, isUpdate, wasRunning, delayMs = CAPTURE_ACCOUNT_START_DELAY_MS } = options;
    const timer = setTimeout(() => {
        try {
            if (isUpdate) {
                if (wasRunning) provider.restartAccount(account.id);
            } else {
                provider.startAccount(account.id);
            }
        } catch (error: any) {
            const startError = error.message || '账号启动失败';
            if (flow.result) flow.result.startError = startError;
            logger.warn('抓包登录账号已添加，但延迟启动失败', {
                accountId: account.id,
                error: startError,
            });
        }
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
}

async function stopCaptureBeforeAccountStart(flow: any, start: () => void): Promise<void> {
    await stopRemoteFlow(flow);
    if (captureFlows.get(flow.id) === flow) captureFlows.delete(flow.id);
    start();
}

async function removeExistingFlows(): Promise<void> {
    const existing = [...captureFlows.values()].filter((flow) => !flow.completed);
    for (const flow of existing) {
        await stopRemoteFlow(flow);
        captureFlows.delete(flow.id);
    }
}

async function cleanupExpiredFlows(): Promise<void> {
    const cutoff = Date.now() - CAPTURE_FLOW_TTL_MS;
    const expired = [...captureFlows.values()].filter((flow) => flow.updatedAt < cutoff);
    for (const flow of expired) {
        if (!flow.completed) await stopRemoteFlow(flow);
        captureFlows.delete(flow.id);
    }
}

function isCertificateTokenValid(flow: any, token: unknown): boolean {
    const expected = Buffer.from(String(flow?.certificateToken || ''), 'utf8');
    const supplied = Buffer.from(String(token || ''), 'utf8');
    return expected.length > 0
        && expected.length === supplied.length
        && crypto.timingSafeEqual(expected, supplied);
}

function syncCapturedClientVersion(clientVersion: string): void {
    if (!/^\d+(?:\.\d+){2,4}_\d{8}$/.test(String(clientVersion || ''))) return;
    try {
        const saved = store.getSystemConfig();
        if (saved && saved.clientVersion === clientVersion) return;
        const base = saved || {};
        const next = store.setSystemConfig({ ...base, clientVersion });
        if (next) {
            const { updateRuntimeConfig } = require('../../config/config');
            updateRuntimeConfig(next);
        }
        logger.info('已同步抓包客户端版本', { clientVersion });
    } catch (error: any) {
        logger.warn('同步抓包客户端版本失败', { clientVersion, error: error.message });
    }
}

function mountCaptureRoutes(app: Application, ctx: AdminContext): void {
    const cleanupTimer = setInterval(() => {
        void cleanupExpiredFlows().catch((error: any) => {
            logger.warn('过期抓包任务清理失败', { error: error.message });
        });
    }, 60_000);
    if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

    app.use('/api/capture', createAuthRequired(ctx));

    app.get('/api/capture/config', (req: Request, res: Response) => {
        const identity = getIdentity(ctx, req);
        const config = store.getCaptureConfig();
        const embedded = config.embedded !== false;
        // 普通用户只需要开关状态，内部代理地址与令牌配置不下发
        if (!isAdminIdentity(identity)) {
            return res.json({
                ok: true,
                data: {
                    enabled: config.enabled === true && embedded && isEmbeddedMode(),
                },
            });
        }
        res.json({
            ok: true,
            data: {
                enabled: config.enabled === true && embedded && isEmbeddedMode(),
                embedded,
                running: isEmbeddedMode(),
                apiBase: config.apiBase,
                apiToken: '',
                tokenConfigured: !!config.apiToken,
                autoImportQqGids: config.autoImportQqGids !== false,
            },
        });
    });

    app.post('/api/capture/sessions', async (req: Request, res: Response) => {
        const platform = req.body?.platform === 'wx' ? 'wx' : 'qq';
        try {
            const accountRef = String(req.body?.accountId || '').trim();
            const accountId = accountRef
                ? String(findAccountByRef(store.getAccounts().accounts || [], accountRef)?.id || accountRef)
                : '';
            if (accountId) {
                const existing = (store.getAccounts().accounts || []).find(
                    (account: any) => String(account.id) === accountId,
                );
                if (!existing) {
                    return res.status(404).json({ ok: false, error: '目标账号不存在' });
                }
                if (!isAccountAccessible(ctx, req, accountId)) {
                    return res.status(403).json({ ok: false, error: '无权访问此账号' });
                }
            }
            const config = store.getCaptureConfig();
            if (!config.enabled || config.embedded === false || !isEmbeddedMode()) {
                return res.status(403).json({ ok: false, error: '抓包登录添加账号未启用' });
            }
            await removeExistingFlows();

            const flowId = crypto.randomBytes(18).toString('base64url');
            const remoteSessionId = crypto.randomBytes(18).toString('base64url');
            const session = await captureRequest('/api/sessions', {
                method: 'POST',
                sessionId: remoteSessionId,
                body: { sessionId: remoteSessionId },
            });
            const flow: any = {
                id: flowId,
                remoteSessionId,
                certificateToken: crypto.randomBytes(24).toString('base64url'),
                accountId,
                platform,
                code: '',
                accountGid: '',
                openId: '',
                clientVersion: '',
                friendGids: new Set<number>(),
                friendSource: '',
                friendListComplete: false,
                publicInfo: {},
                proxy: {},
                captureStatus: 'idle',
                completed: false,
                result: null,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            addCapturedValues(flow, session);
            captureFlows.set(flowId, flow);
            try {
                const started = await captureRequest('/api/capture/start', {
                    method: 'POST',
                    sessionId: remoteSessionId,
                    body: {
                        mode: platform,
                        bypassHosts: getCaptureBypassHosts(req),
                        advertiseHost: isEmbeddedMode() ? getCaptureAdvertiseHost(req) : '',
                    },
                });
                addCapturedValues(flow, started);
            } catch (error) {
                captureFlows.delete(flowId);
                await stopRemoteFlow(flow);
                throw error;
            }
            res.json({ ok: true, data: serializeFlow(flow) });
        } catch (error: any) {
            logger.warn('启动抓包登录失败', { platform, error: error.message });
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.get('/api/capture/sessions/:flowId', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.status(404).json({ ok: false, error: '抓取任务不存在或已过期' });
        try {
            if (!flow.completed) await refreshFlow(flow);
            res.json({ ok: true, data: serializeFlow(flow) });
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message, data: serializeFlow(flow) });
        }
    });

    app.get('/api/public/capture-certificate/:flowId/:token', (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow || !isCertificateTokenValid(flow, req.params.token)) {
            return res.status(404).json({ ok: false, error: '证书链接不存在或已过期' });
        }
        try {
            const der = embeddedCaptureCore.getCaCertDer();
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('Content-Type', 'application/x-x509-ca-cert');
            res.setHeader('Content-Disposition', 'inline; filename="mitmproxy-ca-cert.cer"');
            res.send(der);
        } catch (error: any) {
            res.status(502).json({ ok: false, error: error.message });
        }
    });

    app.post('/api/capture/sessions/:flowId/complete', async (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.status(404).json({ ok: false, error: '抓取任务不存在或已过期' });
        if (flow.completed) return res.json({ ok: true, data: flow.result });
        if (flow.completing) return res.status(409).json({ ok: false, error: '账号正在添加中' });
        flow.completing = true;
        try {
            if (!flow.code) await refreshFlow(flow);
            if (!flow.code) return res.status(400).json({ ok: false, error: '尚未获取到 Code' });

            const isUpdate = !!flow.accountId;
            const allAccounts = store.getAccounts().accounts || [];

            // 普通用户只能更新自己的账号；新增受个人/实例账号上限约束
            const identity = getIdentity(ctx, req);
            const isUser = !isAdminIdentity(identity);
            if (isUpdate && !isAccountAccessible(ctx, req, flow.accountId)) {
                return res.status(403).json({ ok: false, error: '无权访问此账号' });
            }
            if (!isUpdate) {
                if (isUser) {
                    const userInfo = userStore.getUserInfo(identity.username);
                    if (!userInfo) {
                        return res.status(403).json({ ok: false, error: '用户不存在或已被删除' });
                    }
                    const ownedCount = allAccounts.filter((account: any) => String(account.owner || '') === identity.username).length;
                    if (ownedCount >= userInfo.accountLimit) {
                        flow.cancelled = true;
                        captureFlows.delete(flow.id);
                        scheduleRemoteStop(flow, 0);
                        return res.status(403).json({
                            ok: false,
                            error: `账号数量已达上限（${userInfo.accountLimit}个），请使用额度卡密增加额度`,
                        });
                    }
                } else {
                    const cardSettings = store.getCardSettings();
                    if (cardSettings.enabled && allAccounts.length >= cardSettings.accountLimit) {
                        flow.cancelled = true;
                        captureFlows.delete(flow.id);
                        scheduleRemoteStop(flow, 0);
                        return res.status(403).json({
                            ok: false,
                            error: `账号数量已达上限（${cardSettings.accountLimit}个），请使用卡密增加额度`,
                        });
                    }
                }
            }

            const duplicate = findDuplicateCapturedAccount(allAccounts, flow, flow.accountId);
            if (duplicate) {
                flow.cancelled = true;
                captureFlows.delete(flow.id);
                logger.warn('抓包登录检测到重复账号，已停止本次添加', {
                    platform: flow.platform,
                    duplicateAccountId: duplicate.id,
                });
                res.status(409).json({
                    ok: false,
                    code: 'DUPLICATE_CAPTURE_ACCOUNT',
                    error: '检测到当前仍是已添加的账号，请先切换到目标 QQ，再重新开始抓取',
                });
                scheduleRemoteStop(flow, 0);
                return;
            }

            const name = String(req.body?.name || '').trim();
            const existing = isUpdate
                ? allAccounts.find((account: any) => String(account.id) === flow.accountId)
                : null;
            if (isUpdate && !existing) throw new Error('目标账号不存在');

            const wasRunning = isUpdate && typeof ctx.provider.isAccountRunning === 'function'
                ? ctx.provider.isAccountRunning(flow.accountId)
                : false;

            store.addOrUpdateAccount({
                ...(isUpdate ? { id: flow.accountId } : {}),
                ...(isUser ? { owner: identity.username } : {}),
                name: name || (existing && existing.name) || '',
                code: flow.code,
                platform: flow.platform,
            });
            const created = isUpdate
                ? (store.getAccounts().accounts || []).find((account: any) => String(account.id) === flow.accountId)
                : (store.getAccounts().accounts || []).at(-1);
            if (!created) throw new Error('账号保存失败');

            if (flow.clientVersion) syncCapturedClientVersion(flow.clientVersion);

            flow.completed = true;
            flow.result = {
                accountId: created.id,
                name: created.name,
                platform: flow.platform,
                importedFriendCount: 0,
                startError: '',
                updated: isUpdate,
            };

            try {
                if (ctx.provider.addAccountLog) {
                    ctx.provider.addAccountLog(
                        isUpdate ? 'update' : 'add',
                        `抓包登录${isUpdate ? '更新' : '添加'}账号: ${created.name || created.id}`,
                        created.id,
                        created.name || '',
                        { platform: flow.platform },
                    );
                }
            } catch { /* ignore */ }

            flow.updatedAt = Date.now();
            res.json({ ok: true, data: flow.result });

            const startAccount = () => scheduleCapturedAccountStart({
                provider: ctx.provider,
                flow,
                account: created,
                isUpdate,
                wasRunning,
            });
            const config = store.getCaptureConfig();
            if (flow.platform === 'qq' && config.autoImportQqGids !== false) {
                scheduleQqFriendCollection({
                    provider: ctx.provider,
                    flow,
                    accountId: created.id,
                    accountCreatedAt: created.createdAt,
                    afterStop: startAccount,
                });
            } else {
                void stopCaptureBeforeAccountStart(flow, startAccount).catch((error: any) => {
                    logger.warn('抓包服务代理释放失败，账号未启动', {
                        accountId: created.id,
                        remoteSessionId: flow.remoteSessionId,
                        error: error.message,
                    });
                });
            }
        } catch (error: any) {
            logger.warn('抓包登录添加账号失败', {
                platform: flow.platform,
                error: error.message,
            });
            handleApiError(res, error);
        } finally {
            flow.completing = false;
        }
    });

    app.delete('/api/capture/sessions/:flowId', (req: Request, res: Response) => {
        const flow = captureFlows.get(String(req.params.flowId || ''));
        if (!flow) return res.json({ ok: true });
        flow.cancelled = true;
        captureFlows.delete(flow.id);
        res.json({ ok: true });
        scheduleRemoteStop(flow, 0);
    });
}

module.exports = {
    mountCaptureRoutes,
    setEmbeddedCapture,
    isEmbeddedMode,
    getCaptureBypassHosts,
    getCaptureAdvertiseHost,
    addCapturedValues,
    findDuplicateCapturedAccount,
    collectQqFriendGids,
    mergeKnownFriendGids,
    isCertificateTokenValid,
};
