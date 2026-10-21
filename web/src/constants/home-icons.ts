export interface HomeIconDef {
  /** 图标 key，存于主页配置 features[].icon */
  key: string
  /** 管理设置下拉显示名 */
  label: string
  /** 16x16 viewBox 的 fill path */
  path: string
}

/** 主页功能卡可选图标集（管理员设置下拉与主页渲染共用） */
export const HOME_ICONS: HomeIconDef[] = [
  { key: 'account', label: '多账号', path: 'M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 2a5 5 0 1 0 0 10A5 5 0 0 0 8 3Zm0 1.6A3.4 3.4 0 1 1 4.6 8 3.4 3.4 0 0 1 8 4.6Zm0 1.7A1.7 1.7 0 1 0 9.7 8 1.7 1.7 0 0 0 8 6.3Z' },
  { key: 'login', label: '登录方式', path: 'M10.5 1A4.5 4.5 0 0 1 15 5.5c0 1.2-.5 2.3-1.3 3.1l.3.3a1 1 0 0 1 0 1.4l-.7.7.7.7a1 1 0 0 1-1.4 1.4l-.7-.7-.7.7a1 1 0 0 1-1.4 0l-3.2-3.2A4.5 4.5 0 1 1 10.5 1ZM5.5 3A2.5 2.5 0 1 0 8 5.5 2.5 2.5 0 0 0 5.5 3Zm0 1.5a1 1 0 1 1-1 1 1 1 0 0 1 1-1Z' },
  { key: 'plant', label: '农场种植', path: 'M8 1c1.2 2 .8 3.6-.5 4.8C6.2 7 6 8.3 6.6 10 4.9 9.6 4 8.2 4.3 6.4 4.6 4.6 6 3 8 1Zm.6 8.7c2.9-.7 4.9-2.7 5.4-6.3 1.7 2.8 1.4 5.5-.6 7.2-1.3 1.1-2.9 1.4-4.8.9ZM7 11.6V15h2v-3.4a5.6 5.6 0 0 1-2 0Z' },
  { key: 'friends', label: '好友互动', path: 'M8 1a4 4 0 0 1 4 4c0 2.9-2.4 6.2-4 10-1.6-3.8-4-7.1-4-10a4 4 0 0 1 4-4Zm0 2.2A1.8 1.8 0 1 0 8 6.8 1.8 1.8 0 0 0 8 3.2Z' },
  { key: 'album', label: '图鉴活动', path: 'M2 2h5.5v5.5H2V2Zm6.5 0H14v5.5H8.5V2ZM2 8.5h5.5V14H2V8.5Zm6.5 0H14V14H8.5V8.5Z' },
  { key: 'shop', label: '商城背包', path: 'M1.5 3A.5.5 0 0 1 2 2.5h1.9a.5.5 0 0 1 .48.36L4.9 4.5H14a.5.5 0 0 1 .48.65l-1.5 5A.5.5 0 0 1 12.5 10.5H6L5.6 12H13v1.5H4.75a.75.75 0 0 1-.72-.96L4.6 10.4 3 4.5H1.5V3Zm4.25 9a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm6 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z' },
  { key: 'bolt', label: '等级加速', path: 'M9.3 1 3.6 9h3.6l-1.2 6L11.8 7H8.1l1.2-6Z' },
  { key: 'monitor', label: '监控推送', path: 'M8 1.5a2 2 0 0 1 2 2v.3A4.5 4.5 0 0 1 12.5 8v3.5l1.5 1.5v.5h-12V13l1.5-1.5V8A4.5 4.5 0 0 1 6 3.8v-.3a2 2 0 0 1 2-2Zm0 13a1.8 1.8 0 0 1-1.8-1.5h3.6A1.8 1.8 0 0 1 8 14.5Z' },
  { key: 'shield', label: '安全防护', path: 'M8 1.2 14 4v4.2c0 3.4-2.4 5.9-6 6.6-3.6-.7-6-3.2-6-6.6V4l6-2.8Zm0 2.2L4 5.2v3c0 2.4 1.6 4.2 4 4.8 2.4-.6 4-2.4 4-4.8v-3L8 3.4Z' },
  { key: 'star', label: '亮点推荐', path: 'M8 1.5 9.9 5l3.9.6-2.8 2.8.7 3.9L8 10.4l-3.7 1.9.7-3.9L2.2 5.6 6.1 5 8 1.5Z' },
  { key: 'heart', label: '贴心服务', path: 'M8 14S2 10.2 2 5.8A3.3 3.3 0 0 1 8 4a3.3 3.3 0 0 1 6 1.8C14 10.2 8 14 8 14Z' },
  { key: 'chart', label: '数据分析', path: 'M2 13.5V9h3v4.5Zm4.5 0V5.5h3v8Zm4.5 0V2.5h3v11Z' },
]

const ICON_MAP = new Map(HOME_ICONS.map(item => [item.key, item]))

export function getHomeIcon(key: string): HomeIconDef {
  return ICON_MAP.get(String(key || '').trim()) || ICON_MAP.get('bolt')!
}
