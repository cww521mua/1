import type { AccountConfig, BrandConfig, CardSettings, LoginSettings, MengkaConfig, OfflineReminder, SystemConfig, UIConfig } from '../../types/config';
export {};

const { readTextFile, writeJsonFileAtomic } = require('../../services/json-db');
const { DEFAULT_CLIENT_VERSION, DEFAULT_TIME_ZONE, normalizeTimeZone, resolveClientVersionUpdatedAt } = require('../../config/config');

const sharedState = require('./shared-state');

const {
    STORE_FILE,
    PUSHOO_CHANNELS,
    DEFAULT_OFFLINE_REMINDER,
    DEFAULT_LOGIN_SETTINGS,
    DEFAULT_CAPTURE_CONFIG,
    DEFAULT_CARD_SETTINGS,
    DEFAULT_BRAND,
    DEFAULT_MENGKA_CONFIG,
    globalConfig,
    normalizeAccountConfig,
    cloneAccountConfig,
    DEFAULT_ACCOUNT_CONFIG,
} = sharedState;

function normalizeBrand(input: unknown): BrandConfig {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const title = String(src.title ?? DEFAULT_BRAND.title).trim() || DEFAULT_BRAND.title;
    return {
        icon: String(src.icon ?? DEFAULT_BRAND.icon).trim(),
        kicker: String(src.kicker ?? DEFAULT_BRAND.kicker).trim(),
        title,
        // 网页标题留空时回退为主标题
        pageTitle: String(src.pageTitle ?? '').trim() || title,
        purchaseText: String(src.purchaseText ?? DEFAULT_BRAND.purchaseText).trim(),
        purchaseUrl: String(src.purchaseUrl ?? DEFAULT_BRAND.purchaseUrl).trim(),
    };
}

function normalizeCardSettings(input: unknown): CardSettings {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const accountLimitRaw = Number.parseInt(src.accountLimit, 10);
    return {
        enabled: src.enabled === true,
        accountLimit: Number.isFinite(accountLimitRaw) && accountLimitRaw > 0 ? accountLimitRaw : DEFAULT_CARD_SETTINGS.accountLimit,
        trialEnabled: src.trialEnabled === true,
    };
}

function normalizeOfflineReminder(input: unknown): OfflineReminder {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    let offlineDeleteSec = Number.parseInt(src.offlineDeleteSec, 10);
    if (!Number.isFinite(offlineDeleteSec) || offlineDeleteSec < 0) {
        offlineDeleteSec = DEFAULT_OFFLINE_REMINDER.offlineDeleteSec;
    }
    const rawChannel = (src.channel !== undefined && src.channel !== null)
        ? String(src.channel).trim().toLowerCase()
        : '';
    const endpoint = (src.endpoint !== undefined && src.endpoint !== null)
        ? String(src.endpoint).trim()
        : DEFAULT_OFFLINE_REMINDER.endpoint;
    const migratedChannel = rawChannel
        || (PUSHOO_CHANNELS.has(String(endpoint || '').trim().toLowerCase())
            ? String(endpoint || '').trim().toLowerCase()
            : DEFAULT_OFFLINE_REMINDER.channel);
    const channel = PUSHOO_CHANNELS.has(migratedChannel)
        ? migratedChannel
        : DEFAULT_OFFLINE_REMINDER.channel;
    const token = (src.token !== undefined && src.token !== null)
        ? String(src.token).trim()
        : DEFAULT_OFFLINE_REMINDER.token;
    const secret = (src.secret !== undefined && src.secret !== null)
        ? String(src.secret).trim()
        : DEFAULT_OFFLINE_REMINDER.secret;
    const title = (src.title !== undefined && src.title !== null)
        ? String(src.title).trim()
        : DEFAULT_OFFLINE_REMINDER.title;
    const msg = (src.msg !== undefined && src.msg !== null)
        ? String(src.msg).trim()
        : DEFAULT_OFFLINE_REMINDER.msg;
    return {
        channel,
        endpoint,
        token,
        secret,
        title,
        msg,
        offlineDeleteSec,
    };
}

function sanitizeGlobalConfigBeforeSave(): void {
    sharedState.accountFallbackConfig = normalizeAccountConfig(globalConfig.defaultAccountConfig, DEFAULT_ACCOUNT_CONFIG);
    globalConfig.defaultAccountConfig = cloneAccountConfig(sharedState.accountFallbackConfig);

    const map = (globalConfig.accountConfigs && typeof globalConfig.accountConfigs === 'object')
        ? globalConfig.accountConfigs
        : {};
    const nextMap: Record<string, AccountConfig> = {};
    for (const [id, cfg] of Object.entries(map)) {
        const sid = String(id || '').trim();
        if (!sid) continue;
        nextMap[sid] = normalizeAccountConfig(cfg, DEFAULT_ACCOUNT_CONFIG);
    }
    globalConfig.accountConfigs = nextMap;

}

function saveGlobalConfig(): void {
    const { ensureDataDir } = require('../../config/runtime-paths');
    ensureDataDir();
    try {
        const oldJson: string = readTextFile(STORE_FILE, '');

        sanitizeGlobalConfigBeforeSave();
        const newJson = JSON.stringify(globalConfig, null, 2);

        if (oldJson !== newJson) {
            console.warn('[系统] 正在保存配置到:', STORE_FILE);
            writeJsonFileAtomic(STORE_FILE, globalConfig);
        }
    } catch (e: any) {
        console.error('保存配置失败:', e.message);
    }
}

function getUI(): UIConfig {
    return { ...globalConfig.ui };
}

function setUITheme(theme: unknown): UIConfig {
    const t = String(theme || '').toLowerCase();
    const next: UIConfig['theme'] = (t === 'light') ? 'light' : 'dark';
    // Import here to avoid circular - use direct globalConfig mutation
    if (globalConfig.ui) {
        globalConfig.ui.theme = next;
    }
    saveGlobalConfig();
    return getUI();
}

function getOfflineReminder(): OfflineReminder {
    return normalizeOfflineReminder(globalConfig.offlineReminder);
}

function getCaptureConfig(): any {
    return globalConfig.captureConfig
        ? { ...DEFAULT_CAPTURE_CONFIG, ...globalConfig.captureConfig }
        : { ...DEFAULT_CAPTURE_CONFIG };
}

function setCaptureConfig(config: any): any {
    if (!config || typeof config !== 'object') return null;
    const current = getCaptureConfig();
    globalConfig.captureConfig = {
        defaultsVersion: DEFAULT_CAPTURE_CONFIG.defaultsVersion,
        enabled: config.enabled === true,
        embedded: config.embedded !== false,
        apiBase: String(config.apiBase || current.apiBase || DEFAULT_CAPTURE_CONFIG.apiBase).trim(),
        apiToken: config.apiToken === undefined || config.apiToken === null || config.apiToken === ''
            ? current.apiToken
            : String(config.apiToken).trim(),
        autoImportQqGids: config.autoImportQqGids !== false,
    };
    saveGlobalConfig();
    return { ...globalConfig.captureConfig };
}

const LOGIN_TAB_DEFAULTS: { key: string; label: string }[] = [
    { key: 'code', label: '输入 Code 登录' },
    { key: 'wx_qr', label: '微信扫码登录' },
    { key: 'qq_qr', label: 'QQ扫码登录' },
    { key: 'mengka', label: '萌卡登录' },
    { key: 'capture', label: '抓包登录' },
];

const LOGIN_TAB_KEY_SET = new Set(LOGIN_TAB_DEFAULTS.map(item => item.key));

/** 登录方式标签：仅接受已知 key、去重、空标题回退默认、缺失的 key 按默认顺序补齐在末尾 */
function normalizeLoginTabs(raw: unknown) {
    const list = Array.isArray(raw) ? raw : [];
    const seen = new Set<string>();
    const out: { key: string; label: string; enabled: boolean }[] = [];
    for (const item of list) {
        const src: Record<string, any> = (item && typeof item === 'object') ? item as Record<string, any> : {};
        const key = String(src.key ?? '').trim();
        if (!LOGIN_TAB_KEY_SET.has(key) || seen.has(key)) continue;
        seen.add(key);
        const fallbackLabel = LOGIN_TAB_DEFAULTS.find(item => item.key === key)!.label;
        out.push({
            key,
            label: (String(src.label ?? '').trim() || fallbackLabel).slice(0, 30),
            enabled: src.enabled !== false,
        });
    }
    for (const item of LOGIN_TAB_DEFAULTS) {
        if (!seen.has(item.key)) out.push({ key: item.key, label: item.label, enabled: true });
    }
    return out;
}

function normalizeLoginSettings(input: unknown): LoginSettings {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    return {
        wechatQrLogin: typeof src.wechatQrLogin === 'boolean' ? src.wechatQrLogin : DEFAULT_LOGIN_SETTINGS.wechatQrLogin,
        qqQrLogin: typeof src.qqQrLogin === 'boolean' ? src.qqQrLogin : DEFAULT_LOGIN_SETTINGS.qqQrLogin,
        napCatEndpoint: typeof src.napCatEndpoint === 'string' ? src.napCatEndpoint.trim() : DEFAULT_LOGIN_SETTINGS.napCatEndpoint,
        napCatSignature: typeof src.napCatSignature === 'string' ? src.napCatSignature.trim() : DEFAULT_LOGIN_SETTINGS.napCatSignature,
        tabs: normalizeLoginTabs(src.tabs),
        mengkaDefaultProtocol: src.mengkaDefaultProtocol === 'phone' ? 'phone' : 'tablet',
        mengkaAddButtonLabel: (String(src.mengkaAddButtonLabel ?? '').trim() || '添加QQ号').slice(0, 30),
        mengkaProtocolNote: (String(src.mengkaProtocolNote ?? '').trim() || '默认平板，平板不会顶手机QQ号，安卓会顶号，请知悉').slice(0, 300),
        mengkaEntryHint: (String(src.mengkaEntryHint ?? '').trim() || '列表里没有你的 QQ？发起后按提示完成验证（短信验证码 / 扫码）即可自动登录萌卡并绑定').slice(0, 300),
    };
}

function getLoginSettings(): LoginSettings {
    return normalizeLoginSettings(globalConfig.loginSettings);
}

function setLoginSettings(cfg: Partial<LoginSettings> | undefined): LoginSettings {
    const next = normalizeLoginSettings({ ...getLoginSettings(), ...(cfg || {}) });
    if (next.qqQrLogin && (!next.napCatEndpoint || !next.napCatSignature)) {
        throw new Error('开启 QQ 扫码登录前，请配置 NapCat 接口地址和接口签名');
    }
    globalConfig.loginSettings = next;
    saveGlobalConfig();
    return getLoginSettings();
}

function setOfflineReminder(cfg: Partial<OfflineReminder> | undefined): OfflineReminder {
    const current = normalizeOfflineReminder(globalConfig.offlineReminder);
    globalConfig.offlineReminder = normalizeOfflineReminder({ ...current, ...(cfg || {}) });
    saveGlobalConfig();
    return getOfflineReminder();
}

function getCardSettings(): CardSettings {
    return normalizeCardSettings(globalConfig.cardSettings);
}

function getBrand(): BrandConfig {
    return normalizeBrand(globalConfig.branding);
}

function setBrand(cfg: Partial<BrandConfig> | undefined): BrandConfig {
    const current = getBrand();
    const src: Record<string, any> = (cfg && typeof cfg === 'object') ? cfg as Record<string, any> : {};
    globalConfig.branding = normalizeBrand({
        icon: src.icon !== undefined ? src.icon : current.icon,
        kicker: src.kicker !== undefined ? src.kicker : current.kicker,
        title: src.title !== undefined ? src.title : current.title,
        purchaseText: src.purchaseText !== undefined ? src.purchaseText : current.purchaseText,
        purchaseUrl: src.purchaseUrl !== undefined ? src.purchaseUrl : current.purchaseUrl,
    });
    saveGlobalConfig();
    return getBrand();
}

function normalizeMengkaConfig(input: unknown): MengkaConfig {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const portRaw = Number.parseInt(src.wsPort, 10);
    return {
        enabled: src.enabled === true,
        wsHost: String(src.wsHost ?? DEFAULT_MENGKA_CONFIG.wsHost).trim(),
        wsPort: Number.isFinite(portRaw) && portRaw > 0 && portRaw <= 65535 ? portRaw : DEFAULT_MENGKA_CONFIG.wsPort,
        token: String(src.token ?? DEFAULT_MENGKA_CONFIG.token).trim(),
    };
}

function getMengkaConfig(): MengkaConfig {
    return normalizeMengkaConfig(globalConfig.mengka);
}

function setMengkaConfig(cfg: Partial<MengkaConfig> | undefined): MengkaConfig {
    const current = getMengkaConfig();
    const src: Record<string, any> = (cfg && typeof cfg === 'object') ? cfg as Record<string, any> : {};
    globalConfig.mengka = normalizeMengkaConfig({
        enabled: src.enabled !== undefined ? src.enabled : current.enabled,
        wsHost: src.wsHost !== undefined ? src.wsHost : current.wsHost,
        wsPort: src.wsPort !== undefined ? src.wsPort : current.wsPort,
        // 令牌留空表示保持原值不变（管理接口不回显令牌）
        token: src.token !== undefined && String(src.token).trim() !== '' ? src.token : current.token,
    });
    saveGlobalConfig();
    return getMengkaConfig();
}

function setCardSettings(cfg: Partial<CardSettings> | undefined): CardSettings {
    const current = normalizeCardSettings(globalConfig.cardSettings);
    const src: Record<string, any> = (cfg && typeof cfg === 'object') ? cfg as Record<string, any> : {};
    const next: CardSettings = {
        enabled: src.enabled !== undefined ? src.enabled === true : current.enabled,
        accountLimit: src.accountLimit !== undefined && src.accountLimit !== null
            ? Math.max(0, Number.parseInt(src.accountLimit, 10) || 0)
            : current.accountLimit,
        trialEnabled: src.trialEnabled !== undefined ? src.trialEnabled === true : current.trialEnabled,
    };
    globalConfig.cardSettings = next;
    saveGlobalConfig();
    return getCardSettings();
}

function getSystemConfig(): SystemConfig | null {
    return globalConfig.systemConfig ? { ...globalConfig.systemConfig } : null;
}

function setSystemConfig(config: Partial<SystemConfig> | undefined): SystemConfig | null {
    if (!config || typeof config !== 'object') return null;
    const DEFAULT_DEVICE_INFO = {
        os: 'Windows',
        clientVersion: DEFAULT_CLIENT_VERSION,
        sysSoftware: 'Windows',
        network: 'wifi',
        memory: '16384',
        deviceId: 'DESKTOP-PC<WPC>',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36 MicroMessenger/7.0.20.1781(0x6700143B) NetType/WIFI MiniProgramEnv/Windows WindowsWechat/WMPF WindowsWechat(0x63090a13)',
    };
    const srcDevice = (config.deviceInfo && typeof config.deviceInfo === 'object') ? config.deviceInfo : {};
    const topVersion = String(config.clientVersion || '').trim();
    const deviceVersion = String((srcDevice as any).clientVersion || '').trim();
    const requestedVersion = deviceVersion || topVersion;
    const clientVersion = requestedVersion || DEFAULT_DEVICE_INFO.clientVersion;
    const currentVersion = String(globalConfig.systemConfig?.clientVersion || DEFAULT_DEVICE_INFO.clientVersion).trim();
    const currentUpdatedAt = Number(globalConfig.systemConfig?.clientVersionUpdatedAt);
    const clientVersionUpdatedAt = resolveClientVersionUpdatedAt(
        clientVersion,
        currentVersion,
        currentUpdatedAt,
        config.clientVersionUpdatedAt,
    );
    const deviceInfo = {
        os: String((srcDevice as any).os || DEFAULT_DEVICE_INFO.os).trim(),
        clientVersion,
        sysSoftware: String((srcDevice as any).sysSoftware || DEFAULT_DEVICE_INFO.sysSoftware).trim(),
        network: String((srcDevice as any).network || DEFAULT_DEVICE_INFO.network).trim(),
        memory: String((srcDevice as any).memory || DEFAULT_DEVICE_INFO.memory).trim(),
        deviceId: String((srcDevice as any).deviceId || DEFAULT_DEVICE_INFO.deviceId).trim(),
        userAgent: String((srcDevice as any).userAgent || DEFAULT_DEVICE_INFO.userAgent).trim(),
    };
    globalConfig.systemConfig = {
        serverUrl: String(config.serverUrl || '').trim(),
        clientVersion: deviceInfo.clientVersion,
        clientVersionUpdatedAt,
        platform: String(config.platform || 'qq').trim(),
        os: deviceInfo.os,
        timeZone: normalizeTimeZone(config.timeZone || DEFAULT_TIME_ZONE),
        deviceInfo,
    };
    saveGlobalConfig();
    return { ...globalConfig.systemConfig };
}

// Initialize on load
const { loadGlobalConfig } = sharedState;
loadGlobalConfig();
// Apply offlineReminder normalization after load
globalConfig.offlineReminder = normalizeOfflineReminder(globalConfig.offlineReminder);
globalConfig.loginSettings = normalizeLoginSettings(globalConfig.loginSettings);
globalConfig.branding = normalizeBrand(globalConfig.branding);
globalConfig.mengka = normalizeMengkaConfig(globalConfig.mengka);
if (sharedState.systemConfigMigrated) {
    saveGlobalConfig();
    sharedState.systemConfigMigrated = false;
}

module.exports = {
    saveGlobalConfig,
    getUI,
    setUITheme,
    getLoginSettings,
    setLoginSettings,
    getOfflineReminder,
    setOfflineReminder,
    getCardSettings,
    setCardSettings,
    getBrand,
    setBrand,
    getMengkaConfig,
    setMengkaConfig,
    getCaptureConfig,
    setCaptureConfig,
    getSystemConfig,
    setSystemConfig,
};
