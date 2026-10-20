# 萌卡 NT 对接

本文档说明面板与萌卡 NT 框架的两种对接方式：桥接插件自动推码与面板直连取码，多用户隔离机制，以及对应的配置方法、接口清单与注意事项。

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

### 多用户隔离（默认开启）

面板直连内置多用户隔离，用户无需接触萌卡 WebUI：

- **面板内扫码接入**：添加账号弹窗独立「萌卡登录」页签（所有登录用户可见）→ 点「扫码登录新 QQ」，填 QQ 号（可选填密码）发起，面板展示二维码，手机 QQ 扫码确认后自动登录进萌卡框架，并**绑定到当前面板用户**；
- **萌卡管理页**：侧边栏「萌卡管理」（所有登录用户）——替代萌卡 WebUI 的自助管理入口：查看我的 QQ（在线状态/最后活跃）、扫码添加新 QQ、掉线「重新登录」（缓存登录或扫码确认）、解绑；管理员可见全部账号（带归属标注）并可解绑任意；
- **严格隔离**：普通用户只能看到/取码绑定自己的萌卡 QQ；管理员可见全部（附归属标注），并可在添加账号时通过「账号归属」下拉代用户扫码接入；
- **绑定存储**：`core/data/mengka-bindings.json`（面板侧权威来源），同时在萌卡侧写入授权租约（`set_account_access`，`owner_id` 为面板用户名）作备份；
- **绑定管理**：设置 → 萌卡对接 → 绑定管理（管理员）：查看 QQ/昵称/归属/绑定时间，支持解绑（解绑后可被其他用户重新绑定）；
- **注册即开通**：面板注册用户自动具备萌卡接入资格，注册流程无需任何萌卡侧操作；萌卡 WebUI 不对面板用户开放。

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
- 萌卡 QQ 与面板用户的绑定关系保存在 `core/data/mengka-bindings.json`，随数据目录一同备份；
- 令牌通过管理接口保存后不回显；
- 面板 core 与萌卡的连接为常驻 WebSocket，断线每 15 秒自动重连；配置变更即时生效，无需重启。

## 接口清单

登录用户接口：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/mengka/status` | 连接状态与节点信息 |
| GET | `/api/mengka/bots` | 萌卡账号列表（按绑定归属过滤；管理员附 `owner`） |
| POST | `/api/mengka/farm-code` | 为指定 `self_id` 获取农场授权 Code（校验归属） |
| POST | `/api/mengka/login-qr/start` | 发起 QQ 扫码登录进萌卡（`{qq, password?, owner?}`） |
| POST | `/api/mengka/login-qr/poll` | 轮询扫码状态，确认后自动写绑定与租约 |
| POST | `/api/mengka/relogin` | 重新登录掉线的萌卡账号（校验归属；需验证时返回二维码） |

管理接口（仅超管）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/settings/mengka-config` | 读取对接配置（令牌只返回是否已设置） |
| POST | `/api/settings/mengka-config` | 保存对接配置并即时重连 |
| GET | `/api/mengka/bindings` | 全部绑定列表 |
| DELETE | `/api/mengka/bindings/:selfId` | 解绑指定 QQ（绑定本人或超管；同时停用萌卡侧租约） |

## 关键实现

| 文件 | 职责 |
| --- | --- |
| `core/src/services/mengka-connector.ts` | 萌卡正向 WebSocket 客户端：认证握手、action 调用、自动重连 |
| `core/src/controllers/admin/mengka-routes.ts` | 状态 / 在线账号 / 取码 / 扫码登录 / 绑定管理 / 配置接口 |
| `core/src/models/store/mengka-bindings.ts` | QQ ↔ 面板用户绑定存储与归属查询 |
| `core/src/models/store/global-config.ts` | `mengka` 配置归一化与读写 |
| `core/src/controllers/admin/account-routes.ts` | 管理员添加账号可指定归属用户（`owner`） |
| `web/src/components/AccountModal.vue` | QQ 扫码页签的萌卡授权流程与「扫码登录新 QQ」子流程 |
| `web/src/composables/useMengkaLogin.ts` | 扫码登录流程复用逻辑（弹窗与管理页共用） |
| `web/src/views/MengkaManage.vue` | 萌卡管理页（列表/扫码添加/重新登录/解绑） |
| `web/src/views/Settings.vue` | 萌卡对接配置卡片与绑定管理 |

## 注意事项

- `get_qq_farm_code` 仅萌卡 **Android 协议** QQ 支持；Linux 协议账号取码会失败；
- 扫码登录依赖萌卡 `add_account` / `login_account` / `create_login_qr` 链路：密码验证通过后，QQ 风控可能要求二次验证，面板已支持完整验证状态机——**接收短信验证码**（verify_type 4）、**发送短信**（verify_type 3）、**扫码验证**（verify_type 10）与**滑块验证**（打开滑块页完成后粘贴地址栏链接自动解析提交）；身份验证（140022007）面板暂不代理，请到萌卡 WebUI 完成；
- 添加 QQ 时可选**登录协议**（Android 手机协议列表，默认 Android 9.2.70）；农场授权仅支持 Android 协议；
- 滑块验证交互：点击「打开滑块验证页面」完成拖块后，复制浏览器地址栏完整链接粘贴回来，面板自动解析 ticket/randstr 提交；
- 面板不会保存 QQ 密码（仅转发给萌卡，不落盘、不进日志）；
- 萌卡 WebUI 建议用防火墙限制为仅面板服务器与管理员 IP 可访问（面板用户无需接触 WebUI）；
- 萌卡核心为闭源二进制，会保管 QQ 登录凭据，部署前请自行评估信任成本；
- 桥接插件与面板直连可并存：建议桥接负责存量账号自动续码，面板直连负责新号添加；
- 面板与萌卡跨机部署时，务必用防火墙把正向 WS 端口限制为仅面板 IP 可访问。
