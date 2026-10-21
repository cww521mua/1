# 官网主页（`/`）与主页设置

## 功能定位

访问面板根路径 `/` 直接展示官网主页（面向客户的介绍页），登录/注册入口固定在主页右上角；主页的全部文字与功能卡片图标由管理员在「设置 → 主页设置」中自定义。

- 已登录用户访问 `/` 仍可查看主页，右上角按钮变为「进入面板」
- 面板功能页整体迁移到 `/dashboard` 起始（概览 = `/dashboard`）
- 登录页不变：`/login`（注册通过 `/register` 重定向到登录页注册模式）

## 配置存储

- 配置文件：`core/data/home-page.json`（独立于 store.json）
- 类型：`HomePageConfig`（见 `core/src/types/config.ts`）
- 存储/校验：`core/src/models/store/home-page.ts`
  - `getHomePage()` / `setHomePage(patch)`，`normalizeHomePage` 做字段级兜底：
    - 文字字段为空时回退内置默认文案
    - `features` 上限 12 张、`steps` 上限 4 步、`chips` 上限 8 个，空标题/描述的条目被过滤，全部为空时回退默认
    - `brandName` 留空表示跟随「品牌设置」主标题（前端回退）

## 接口

| 接口 | 权限 | 说明 |
| --- | --- | --- |
| `GET /api/home-page` | 公开 | 主页渲染读取配置（登录前可用） |
| `POST /api/settings/home-page` | 管理员 | 保存主页配置（合并更新） |

## 前端

| 位置 | 说明 |
| --- | --- |
| `web/src/views/Home.vue` | 主页组件（公开路由 `/`）：从公开接口拉配置渲染，接口异常时用内置兜底文案；未登录显示「登录 / 立即注册」，已登录显示「进入面板」 |
| `web/src/constants/home-icons.ts` | 功能卡图标集（12 个 key），设置页下拉与主页渲染共用，未知 key 回退闪电图标 |
| `web/src/components/settings/HomePageSettings.vue` | 「设置 → 主页设置」标签页：品牌与首屏、功能卡（增删/图标选择）、使用步骤、底部横幅与页脚 |
| `web/src/router/index.ts` | `/` = 主页（守卫放行）；`menu.ts` 中概览路由 path 由 `''` 改为 `dashboard` |

## 行为细节

- 主页品牌图标复用「品牌设置」上传的图标（`/api/branding/icon`），与登录页/侧边栏同步
- 主页固定浅色主题、100dvh 高度内部滚动（与登录页同模式）
- 主页按钮指向：未登录 → `/login`、`/register`；已登录 → `/dashboard`

## 测试

`core/tests/home-page.test.js`：默认配置结构、字段级兜底回退、合并保存、features/steps/chips 容量与非法条目过滤（读写真实文件，测试前后备份还原，每个用例前重置文件）。
