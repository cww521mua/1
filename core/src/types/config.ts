export {};
export type PlantingStrategy =
  | 'preferred'
  | 'level'
  | 'max_exp'
  | 'max_fert_exp'
  | 'max_profit'
  | 'max_fert_profit'
  | 'bag_priority';

export type BagSeedFallbackStrategy = Exclude<PlantingStrategy, 'bag_priority'>;

export type FertilizerMode = 'both' | 'normal' | 'organic' | 'smart' | 'none';

export type FertilizerLandType = 'purple-gold' | 'gold' | 'black' | 'red' | 'normal';

export interface AutomationConfig {
  farm: boolean;
  farm_push: boolean;
  land_upgrade: boolean;
  friend: boolean;
  friend_auto_accept: boolean;
  friend_help_exp_limit: boolean;
  friend_steal: boolean;
  friend_help: boolean;
  friend_bad: boolean;
  friend_help_protect_dog_ignore_exp_limit: boolean;
  task: boolean;
  fertilizer_gift: boolean;
  fertilizer_buy_organic: boolean;
  fertilizer_buy_normal: boolean;
  mystery_shop_auto_buy: boolean;
  mystery_shop_allow_gold: boolean;
  mystery_shop_allow_coupon: boolean;
  mystery_shop_allow_gold_bean: boolean;
  mystery_shop_allow_diamond: boolean;
  mystery_shop_arrival_notify: boolean;
  mystery_shop_purchase_notify: boolean;
  sell: boolean;
  fertilizer: FertilizerMode;
  fertilizer_multi_season: boolean;
  fertilizer_land_types: FertilizerLandType[];
  fertilizer_smart_seconds: number;
  skip_own_weed_bug: boolean;
  show_manual_fertilizer: boolean;
}

export interface IntervalConfig {
  farm: number;
  farmMin: number;
  farmMax: number;
  friendMin: number;
  friendMax: number;
  helpMin: number;
  helpMax: number;
  stealMin: number;
  stealMax: number;
  [key: string]: number;
}

export interface QuietHoursConfig {
  enabled: boolean;
  start: string;
  end: string;
  continueFarm: boolean;
}

export interface AccountConfig {
  automation: AutomationConfig;
  plantingStrategy: PlantingStrategy;
  preferredSeedId: number;
  intervals: IntervalConfig;
  friendQuietHours: QuietHoursConfig;
  knownFriendGids: number[];
  knownFriendGidSyncCooldownSec: number;
  friendsListCacheTtlSec: number;
  friendBlacklist: number[];
  plantBlacklist: number[];
  stealDelaySeconds: number;
  plantOrderRandom: boolean;
  plantDelaySeconds: number;
  fertilizerBuyOrganicCount: number;
  fertilizerBuyOrganicThresholdHours: number;
  fertilizerBuyNormalCount: number;
  fertilizerBuyNormalThresholdHours: number;
  fertilizerBuyCheckIntervalMinutes: number;
  bagSeedPriority: number[];
  /** 是否为明确排在前面的多格背包种子保留尚未连成布局的空地。 */
  bagSeedMultiLandReservationEnabled: boolean;
  /** seedId -> 允许种植的土地类型。缺 key 视为不限制。 */
  bagSeedLandTypes: Record<string, FertilizerLandType[]>;
  bagSeedFallbackStrategy: BagSeedFallbackStrategy;
  autoAcceptFriendMinLevel: number;
  autoAcceptRequireOwnLevel: boolean;
  autoAcceptHarvestStealEnabled: boolean;
  autoAcceptHarvestStealHarvest: number;
  autoAcceptHarvestStealSteal: number;
}

export interface OfflineReminder {
  channel: string;
  endpoint: string;
  token: string;
  secret: string;
  title: string;
  msg: string;
  offlineDeleteSec: number;
}

export interface CardSettings {
  /** 是否启用卡密管控：开启后新增账号受账号上限约束，到期账号自动停用。 */
  enabled: boolean;
  /** 实例级游戏账号数量上限；额度卡密核销后自动累加。 */
  accountLimit: number;
  /** 注册页试用领取开关：开启后注册页可一键领取 1 小时试用。 */
  trialEnabled: boolean;
}

export interface BrandConfig {
  /** 品牌图标；上传后为服务路径 /api/branding/icon?v=...，留空使用默认图标 */
  icon: string;
  /** 登录页顶部小字；留空隐藏 */
  kicker: string;
  /** 登录页/侧边栏主标题 */
  title: string;
  /** 浏览器标签页标题；留空使用主标题 */
  pageTitle: string;
  /** 注册页卡密下方购买链接文字；与 purchaseUrl 同时非空才显示 */
  purchaseText: string;
  /** 购买链接地址 */
  purchaseUrl: string;
}

export interface MengkaConfig {
  /** 是否启用萌卡 NT 对接 */
  enabled: boolean;
  /** 萌卡正向 WebSocket 服务地址（不含 ws://） */
  wsHost: string;
  /** 萌卡正向 WebSocket 服务端口 */
  wsPort: number;
  /** 插件服务令牌；只在保存时写入，读取接口不回显 */
  token: string;
}

export interface HomeFeature {
  /** 功能图标 key；前端按 home-icons 常量映射，未知 key 回退默认图标 */
  icon: string;
  title: string;
  desc: string;
}

export interface HomeStep {
  title: string;
  desc: string;
}

export interface HomePageConfig {
  /** 顶部导航品牌名；留空回退品牌设置主标题 */
  brandName: string;
  hero: {
    /** 首屏顶部小标签 */
    kicker: string;
    /** 主标题第一行 */
    title1: string;
    /** 主标题第二行 */
    title2: string;
    /** 第二行中绿色高亮的词；留空不高亮 */
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
  cta: { title: string; subtitle: string; primaryText: string; secondaryText: string };
  footerNote: string;
}

export interface UIConfig {
  theme: 'light' | 'dark';
}

export interface LoginTabConfig {
  /** 标签 key：code | wx_qr | qq_qr | mengka | capture */
  key: string;
  /** 显示标题 */
  label: string;
  /** 是否显示该登录方式 */
  enabled: boolean;
}

export interface LoginSettings {
  wechatQrLogin: boolean;
  qqQrLogin: boolean;
  napCatEndpoint: string;
  napCatSignature: string;
  /** 添加账号弹窗登录方式标签（数组顺序即显示顺序，enabled 控制显隐） */
  tabs: LoginTabConfig[];
  /** 萌卡登录默认协议：tablet=平板（默认，不顶手机在线）、phone=手机 */
  mengkaDefaultProtocol: 'tablet' | 'phone';
  /** 萌卡页签「添加QQ号」入口按钮文字 */
  mengkaAddButtonLabel: string;
  /** 萌卡登录协议说明 */
  mengkaProtocolNote: string;
  /** 萌卡登录入口提示（列表里没有你的 QQ…） */
  mengkaEntryHint: string;
}

export interface DeviceInfo {
  os: string;
  clientVersion: string;
  sysSoftware: string;
  network: string;
  memory: string;
  deviceId: string;
  userAgent: string;
}

export interface SystemConfig {
  serverUrl: string;
  clientVersion: string;
  clientVersionUpdatedAt?: number;
  platform: string;
  os: string;
  timeZone: string;
  deviceInfo: DeviceInfo;
}

export interface CaptureConfig {
  defaultsVersion: number;
  enabled: boolean;
  embedded: boolean;
  apiBase: string;
  apiToken: string;
  autoImportQqGids: boolean;
}

export interface GlobalConfig {
  accountConfigs: Record<string, AccountConfig>;
  defaultAccountConfig: AccountConfig;
  ui: UIConfig;
  loginSettings: LoginSettings;
  offlineReminder: OfflineReminder;
  cardSettings: CardSettings;
  branding: BrandConfig;
  mengka: MengkaConfig;
  systemConfig: SystemConfig | null;
  captureConfig: CaptureConfig;
}
