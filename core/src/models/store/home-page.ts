export {};
/**
 * 官网主页配置存储（core/data/home-page.json）。
 * 主页（/ 路由）的全部文字与功能图标均由该配置驱动，管理员在设置页「主页设置」编辑。
 */
interface HomeFeature { icon: string, title: string, desc: string }
interface HomeStep { title: string, desc: string }
interface HomePageConfig {
    brandName: string;
    hero: {
        kicker: string;
        title1: string;
        title2: string;
        highlight: string;
        description: string;
        primaryText: string;
        secondaryText: string;
        chips: string[];
    };
    featuresTitle: string;
    featuresSubtitle: string;
    features: HomeFeature[];
    stepsTitle: string;
    stepsSubtitle: string;
    steps: HomeStep[];
    cta: { title: string, subtitle: string, primaryText: string, secondaryText: string };
    footerNote: string;
}
const { getDataFile, ensureDataDir } = require('../../config/runtime-paths');
const { readJsonFile, writeJsonFileAtomic } = require('../../services/json-db');

const HOME_FILE: string = getDataFile('home-page.json');

const MAX_FEATURES = 12;
const MAX_STEPS = 4;
const MAX_CHIPS = 8;
const TEXT_MAX = 500;

const DEFAULT_HOME_PAGE: HomePageConfig = {
    brandName: 'QQ 农场挂机面板',
    hero: {
        kicker: '多账号 · 全自动 · 液态玻璃面板',
        title1: '多账号挂机，',
        title2: '把农场交给全自动',
        highlight: '交给全自动',
        description: '基于 Web 面板的 QQ 农场自动化工具：每账号独立种植与好友策略，自动收获、种植、施肥、偷菜、除虫，支持一键等级加速，图鉴、活动中心、商城与收益分析一站管理，手机电脑随时掌控。',
        primaryText: '立即注册',
        secondaryText: '视频教程',
        chips: ['全天候自动化', '账号数据独立', '移动端适配', '离线提醒推送'],
    },
    featuresTitle: '从种植到收益，一站托管',
    featuresSubtitle: '覆盖 QQ 农场日常与活动的完整自动化链路，全部操作在 Web 面板完成，无需客户端常驻。',
    features: [
        { icon: 'account', title: '多账号独立挂机', desc: '游戏账号无限添加、独立运行，每个账号单独配置种植策略、好友策略、自动化开关与执行间隔，互不干扰。' },
        { icon: 'login', title: '四种登录方式', desc: '抓包 Code、微信扫码、QQ 扫码与萌卡 NT 一键登录；抓包获取的好友 GID 存入本地档案，换登录方式也能直接复用。' },
        { icon: 'plant', title: '农场全自动', desc: '收获、种植、浇水、除草、除虫、铲除、土地升级与智能施肥全自动执行，支持一键务农、一键全收等面板快捷操作。' },
        { icon: 'friends', title: '好友互动', desc: '自动巡查好友农场：帮忙除草除虫浇水、偷菜、放草放虫一次进园全部完成，支持黑名单、安静时段与经验上限。' },
        { icon: 'album', title: '图鉴与活动中心', desc: '作物图鉴与超变图鉴进度、属性加成一目了然；千星游记、观星礼录、星砂商店、鹊桥寄情等活动统一领取与兑换。' },
        { icon: 'shop', title: '背包 · 商城 · 收益分析', desc: '背包使用与批量出售、神秘商人、游戏商城折扣限购、种子果实收益对比，种植策略按最大经验或净利润自动选择。' },
        { icon: 'bolt', title: '等级加速', desc: '一键执行 QQ 等级任务，多项任务自由选择，支持每日定时自动执行，挂机的同时快速提升账号等级。' },
        { icon: 'monitor', title: '实时监控与推送', desc: '实时状态与日志、账号启停监控、离线自动提醒，事件推送对接通知渠道，异常第一时间知晓。' },
    ],
    stepsTitle: '三步开始挂机',
    stepsSubtitle: '注册后添加游戏账号并配置策略，剩下的交给面板自动完成。',
    steps: [
        { title: '注册账号', desc: '创建面板账号并登录，即可添加游戏账号开始使用，数据独立、互不干扰。' },
        { title: '添加游戏账号', desc: '支持抓包 Code、微信扫码、QQ 扫码与萌卡 NT 登录，为账号选择种植策略并开启自动化。' },
        { title: '自动挂机', desc: '面板全天候托管农场与好友互动，实时查看状态与日志，离线自动推送提醒，手机电脑随时管理。' },
    ],
    cta: {
        title: '现在注册，让农场自己运转',
        subtitle: '注册即开即用，多账号全自动托管，手机电脑随时随地掌控你的农场。',
        primaryText: '立即注册',
        secondaryText: '登录面板',
    },
    footerNote: '本工具仅供学习与技术交流，请合理使用并遵守游戏服务协议，因使用本项目产生的任何问题由使用者自行承担。',
};

function cleanText(value: unknown, fallback: string, maxLen: number = TEXT_MAX): string {
    const text = String(value ?? '').trim();
    return (text || fallback).slice(0, maxLen);
}

function normalizeFeatures(raw: unknown): HomeFeature[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: HomeFeature[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const src: Record<string, any> = item as Record<string, any>;
        const title = String(src.title ?? '').trim();
        const desc = String(src.desc ?? '').trim();
        if (!title || !desc) continue;
        out.push({
            icon: String(src.icon ?? '').trim() || 'bolt',
            title: title.slice(0, 60),
            desc: desc.slice(0, 300),
        });
        if (out.length >= MAX_FEATURES) break;
    }
    return out;
}

function normalizeSteps(raw: unknown): HomeStep[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: HomeStep[] = [];
    for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const src: Record<string, any> = item as Record<string, any>;
        const title = String(src.title ?? '').trim();
        const desc = String(src.desc ?? '').trim();
        if (!title || !desc) continue;
        out.push({ title: title.slice(0, 60), desc: desc.slice(0, 300) });
        if (out.length >= MAX_STEPS) break;
    }
    return out;
}

function normalizeChips(raw: unknown): string[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: string[] = [];
    for (const item of list) {
        const text = String(item ?? '').trim();
        if (!text) continue;
        out.push(text.slice(0, 30));
        if (out.length >= MAX_CHIPS) break;
    }
    return out;
}

function normalizeHomePage(input: unknown): HomePageConfig {
    const src: Record<string, any> = (input && typeof input === 'object') ? input as Record<string, any> : {};
    const def = DEFAULT_HOME_PAGE;
    const heroSrc: Record<string, any> = (src.hero && typeof src.hero === 'object') ? src.hero : {};
    const ctaSrc: Record<string, any> = (src.cta && typeof src.cta === 'object') ? src.cta : {};
    const features = normalizeFeatures(src.features);
    const steps = normalizeSteps(src.steps);
    const chips = normalizeChips(heroSrc.chips);
    return {
        brandName: String(src.brandName ?? '').trim().slice(0, 40),
        hero: {
            kicker: cleanText(heroSrc.kicker, def.hero.kicker, 60),
            title1: cleanText(heroSrc.title1, def.hero.title1, 60),
            title2: cleanText(heroSrc.title2, def.hero.title2, 60),
            highlight: String(heroSrc.highlight ?? def.hero.highlight).trim().slice(0, 60),
            description: cleanText(heroSrc.description, def.hero.description),
            primaryText: cleanText(heroSrc.primaryText, def.hero.primaryText, 20),
            secondaryText: cleanText(heroSrc.secondaryText, def.hero.secondaryText, 20),
            chips: chips.length ? chips : def.hero.chips,
        },
        featuresTitle: cleanText(src.featuresTitle, def.featuresTitle, 60),
        featuresSubtitle: cleanText(src.featuresSubtitle, def.featuresSubtitle),
        features: features.length ? features : def.features,
        stepsTitle: cleanText(src.stepsTitle, def.stepsTitle, 60),
        stepsSubtitle: cleanText(src.stepsSubtitle, def.stepsSubtitle),
        steps: steps.length ? steps : def.steps,
        cta: {
            title: cleanText(ctaSrc.title, def.cta.title, 60),
            subtitle: cleanText(ctaSrc.subtitle, def.cta.subtitle),
            primaryText: cleanText(ctaSrc.primaryText, def.cta.primaryText, 20),
            secondaryText: cleanText(ctaSrc.secondaryText, def.cta.secondaryText, 20),
        },
        footerNote: cleanText(src.footerNote, def.footerNote),
    };
}

function loadHomePage(): HomePageConfig {
    ensureDataDir();
    return normalizeHomePage(readJsonFile(HOME_FILE, () => ({})));
}

function getHomePage(): HomePageConfig {
    return loadHomePage();
}

function setHomePage(patch: unknown): HomePageConfig {
    const src: Record<string, any> = (patch && typeof patch === 'object') ? patch as Record<string, any> : {};
    const current = loadHomePage();
    const merged: Record<string, any> = {
        brandName: src.brandName !== undefined ? src.brandName : current.brandName,
        hero: src.hero !== undefined ? src.hero : current.hero,
        featuresTitle: src.featuresTitle !== undefined ? src.featuresTitle : current.featuresTitle,
        featuresSubtitle: src.featuresSubtitle !== undefined ? src.featuresSubtitle : current.featuresSubtitle,
        features: src.features !== undefined ? src.features : current.features,
        stepsTitle: src.stepsTitle !== undefined ? src.stepsTitle : current.stepsTitle,
        stepsSubtitle: src.stepsSubtitle !== undefined ? src.stepsSubtitle : current.stepsSubtitle,
        steps: src.steps !== undefined ? src.steps : current.steps,
        cta: src.cta !== undefined ? src.cta : current.cta,
        footerNote: src.footerNote !== undefined ? src.footerNote : current.footerNote,
    };
    const saved = normalizeHomePage(merged);
    writeJsonFileAtomic(HOME_FILE, saved);
    return saved;
}

module.exports = {
    getHomePage,
    setHomePage,
    DEFAULT_HOME_PAGE,
};
