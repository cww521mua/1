# 品牌自定义

本文档说明面板的品牌自定义能力：登录页与侧边栏的图标、标题配置，品牌图标的上传与存储，浏览器标签页标题，以及注册页的购买链接。

## 概述

品牌配置由超级管理员在「设置 → 系统设置 → 品牌设置」中维护，对登录页、侧边栏和浏览器标签页全局生效：

| 配置项 | 作用位置 | 留空行为 |
| --- | --- | --- |
| 主标题 | 登录页、侧边栏 | 回退默认值「QQ农场智能助手」 |
| 网页标题 | 浏览器标签页（`document.title`） | 回退为主标题 |
| 顶部小字 | 登录页图标右侧的小字 | 隐藏 |
| 品牌图标 | 登录页、侧边栏 | 使用内置默认图标 |
| 购买链接文字 / 地址 | 注册页卡密输入框下方 | 两项同时非空才显示，新窗口打开 |

品牌配置为公开数据：登录页在未登录状态下也需要读取，因此 `GET /api/branding` 与 `GET /api/branding/icon` 无需鉴权；修改接口仅超级管理员可用。

## 数据模型

品牌配置持久化在 `core/data/store.json` 的 `branding` 字段：

```json
{
  "branding": {
    "icon": "/api/branding/icon?v=1792500000000",
    "kicker": "QQ FARM",
    "title": "智慧农业管理系统",
    "pageTitle": "智慧农业管理系统",
    "purchaseText": "没有卡密？点击去购买",
    "purchaseUrl": "https://example.com/buy"
  }
}
```

- `icon` 可以是上传后生成的服务路径（`/api/branding/icon?v=<时间戳>`），旧版也兼容外部 URL；`?v=` 用于上传新图后刷新缓存。
- `pageTitle` 在保存时归一化：留空自动回退为主标题。
- `title` 归一化后不允许为空，始终有值。

## 品牌图标上传

- 设置页通过文件选择器选取图片，前端读取为 dataURL 后以 JSON 提交到后端。
- 支持 PNG / JPG / GIF / WebP，大小不超过 2MB；SVG 因存在脚本风险不接受。
- 文件保存在运行数据目录（源码模式为 `core/data/`），命名为 `brand-icon.<扩展名>`；上传新图会先清理旧文件，保证目录内始终只有一个图标文件。
- 图标文件随数据目录一同备份与迁移。

归一化与校验逻辑位于 `core/src/models/store/brand-icon.ts`，覆盖 dataURL 解析、类型白名单、2MB 上限、覆盖上传与清除。

## 全局同步机制

前端使用全局 Pinia store（`web/src/stores/brand.ts`）共享一份品牌状态：

- `App.vue` 挂载时调用一次 `GET /api/branding`，登录页与面板共用，同时驱动 `document.title`。
- 登录页根据 `icon` 是否有值切换 `<img>` 与默认图标组件，`kicker` 为空时隐藏小字。
- 侧边栏品牌区与登录页共用同一份数据，管理员保存后立即生效（无需刷新）。
- 设置页保存或上传成功后，会同步更新全局 store，侧边栏与标签页标题即时刷新。

## 接口清单

公开接口（无需登录）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/branding` | 读取品牌配置 |
| GET | `/api/branding/icon` | 输出品牌图标文件（带 `Content-Type` 与长期缓存头），未上传时 404 |

管理接口（仅超管）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/settings/branding` | 保存品牌配置（归一化后返回） |
| POST | `/api/settings/branding/icon` | 上传图标，JSON body 为 `{ "data": "data:image/png;base64,..." }` |
| POST | `/api/settings/branding/icon/reset` | 删除图标文件并恢复默认图标 |

服务端 JSON body 上限为 4MB（`core/src/controllers/admin/index.ts`），用于容纳 base64 编码后的 2MB 图片。

## 关键实现

| 文件 | 职责 |
| --- | --- |
| `core/src/types/config.ts` | `BrandConfig` 类型定义 |
| `core/src/models/store/shared-state.ts` | `DEFAULT_BRAND` 与 `store.json` 加载 |
| `core/src/models/store/global-config.ts` | `normalizeBrand` / `getBrand` / `setBrand` |
| `core/src/models/store/brand-icon.ts` | 图标文件的保存、查找与清除 |
| `core/src/controllers/admin/auth-routes.ts` | 公开读取接口与路径白名单 |
| `core/src/controllers/admin/account-routes.ts` | 保存 / 上传 / 重置接口 |
| `web/src/stores/brand.ts` | 全局品牌状态与标签页标题 |
| `web/src/views/Settings.vue` | 品牌设置表单与图标上传 |
| `web/src/views/Login.vue` | 登录页品牌渲染与购买链接 |
| `web/src/components/Sidebar.vue` | 侧边栏品牌区渲染 |
