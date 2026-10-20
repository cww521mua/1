# 萌卡 NT 对接

本文档说明面板与萌卡 NT 框架的两种对接方式：桥接插件自动推码与面板直连取码，以及对应的配置方法、接口清单与注意事项。

## 概述

[萌卡 NT](https://github.com/Carlor-Official/Mengka-NT) 是面向 QQ 手机协议的机器人框架（闭源，仅发布二进制），可将 QQ 常驻在线，并提供 `get_qq_farm_code` action 为在线 Android QQ 直接签发 32 位农场登录 Code。面板支持两种对接方式，可同时使用：

| 方式 | 方向 | 用途 |
| --- | --- | --- |
| 桥接插件（mengkaNT-qq-farm-bridge） | 萌卡 → 面板 | 定时把在线 QQ 的新 Code 推送到面板，自动续登已添加账号 |
| 面板直连（本功能） | 面板 → 萌卡 | 添加账号时选择萌卡在线 QQ，一键「获取农场授权 Code」完成建号登录 |

两种方式都要求：**面板账号备注与 QQ 号对应**（桥接推送按备注匹配重登；直连方式备注可留空使用 QQ 昵称）。

## 方式一：桥接插件（推码）

1. 部署萌卡 NT 并在 WebUI 中登录 QQ（Android 协议）；
2. 萌卡 WebUI →「插件导入」→ 上传对应平台 zip → 勾选「来源可信」；
3. 插件「配置」中填写面板地址、面板账号与密码（填普通用户账密则推送的账号归属该用户）；启动插件；
4. 插件按「自动推送间隔」分钟为在线 QQ 取码并 `POST /api/accounts`（按备注匹配续登）。

## 方式二：面板直连（取码）

### 萌卡侧准备

1. 萌卡 WebUI →「插件服务」→ 新建服务，连接模式选择**正向 WebSocket**，设置监听端口（如 `3001`）并生成**服务令牌**；
2. 萌卡与面板不在同一台机器时，在萌卡服务器防火墙放行该端口并限制来源为面板 IP（firewalld rich rule 示例：`firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<面板IP> port port=3001 protocol=tcp accept' && firewall-cmd --reload`）。

### 面板侧配置

设置 → 系统设置 → **萌卡对接**：

| 配置项 | 说明 |
| --- | --- |
| 启用萌卡对接 | 开关；关闭后 QQ 扫码页签回落到原有扫码流程 |
| 萌卡服务地址 | 萌卡服务器 IP，不含 `ws://` |
| WebSocket 端口 | 正向 WS 服务端口 |
| 插件服务令牌 | 萌卡生成的服务令牌（保存后不回显，留空保持原值） |

保存后可用「测试连接」验证；连接成功后，添加账号弹窗的「QQ 扫码」页签会显示：账号归属（管理员可选归属用户）、账号备注、当前机器人节点、萌卡在线账号下拉与「获取农场授权 Code」按钮。点击后自动取码、建号（或按备注重登）并启动账号。

## 数据与配置存储

- 面板侧配置保存在 `core/data/store.json` 的 `mengka` 字段（`enabled` / `wsHost` / `wsPort` / `token`），随数据目录一同备份；
- 令牌通过管理接口保存后不回显；
- 面板 core 与萌卡的连接为常驻 WebSocket，断线每 15 秒自动重连；配置变更即时生效，无需重启。

## 接口清单

登录用户接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/mengka/status` | 连接状态与节点信息 |
| GET | `/api/mengka/bots` | 萌卡账号列表（含在线状态与协议） |
| POST | `/api/mengka/farm-code` | 为指定 `self_id` 获取农场授权 Code |

管理接口（仅超管）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings/mengka-config` | 读取对接配置（令牌只返回是否已设置） |
| POST | `/api/settings/mengka-config` | 保存对接配置并即时重连 |

## 关键实现

| 文件 | 职责 |
| --- | --- |
| `core/src/services/mengka-connector.ts` | 萌卡正向 WebSocket 客户端：认证握手、action 调用、自动重连 |
| `core/src/controllers/admin/mengka-routes.ts` | 状态 / 在线账号 / 取码 / 配置接口 |
| `core/src/models/store/global-config.ts` | `mengka` 配置归一化与读写 |
| `core/src/controllers/admin/account-routes.ts` | 管理员添加账号可指定归属用户（`owner`） |
| `web/src/components/AccountModal.vue` | QQ 扫码页签的萌卡授权流程 |
| `web/src/views/Settings.vue` | 萌卡对接配置卡片 |

## 注意事项

- `get_qq_farm_code` 仅萌卡 **Android 协议** QQ 支持；Linux 协议账号取码会失败；
- 萌卡核心为闭源二进制，会保管 QQ 登录凭据，部署前请自行评估信任成本；
- 桥接插件与面板直连可并存：建议桥接负责存量账号自动续码，面板直连负责新号添加；
- 面板与萌卡跨机部署时，务必用防火墙把正向 WS 端口限制为仅面板 IP 可访问。
