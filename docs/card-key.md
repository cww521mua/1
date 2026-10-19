# 卡密系统与多用户

本文档说明面板的卡密系统与多用户机制：卡密类型与用途、注册与续费规则、账号归属与数据隔离、到期处理，以及相关的数据文件与接口清单。

## 概述

卡密系统提供两类卡密：

| 类型 | 用途 | 使用者 |
| --- | --- | --- |
| 时间卡 | 注册普通用户、为用户或游戏账号续期、解除到期（永久卡） | 注册页 / 账户中心 / 卡密管理 |
| 额度卡 | 提升账号数量上限（普通用户提升个人上限，超管模式提升实例上限） | 账户中心 / 卡密管理 / 添加账号附卡 |

卡密面向两种身份生效：

- **超级管理员**：卡密管理页生成、启停、删除、导出卡密；开启「卡密管控」后，自己新增游戏账号受实例账号上限约束，可给账号核销时间卡（到期时间）或额度卡（提升实例上限）。
- **普通用户**：在登录页使用时间卡注册账号，注册即开通对应有效期；登录后添加游戏账号受个人账号上限约束，在「设置 → 账户中心」续费。

卡密管控开关（设置 → 卡密 → 卡密管控）只影响超级管理员的实例额度；普通用户注册后始终受个人上限约束。开关默认关闭，行为与无卡密系统时完全一致。

## 卡密数据模型

卡密持久化在 `core/data/cards.json`：

```json
{
  "cards": [
    {
      "code": "4C8896UMPETUT846",
      "description": "渠道 A 月卡",
      "type": "time",
      "days": 30,
      "durationValue": 30,
      "durationUnit": "day",
      "durationMs": 2592000000,
      "isPermanent": false,
      "value": null,
      "enabled": true,
      "createdAt": 1792400000000,
      "usedBy": "",
      "usedByName": "",
      "usedAt": null
    }
  ]
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `code` | 16 位大写卡密码，字符集去除 `0/O/1/I/L` 等易混字符 |
| `type` | `time` 时间卡 / `quota` 额度卡 |
| `durationValue` / `durationUnit` | 时间卡时长数值与单位（`day` / `hour`） |
| `durationMs` | 时间卡折算毫秒数；永久卡为 `null` |
| `isPermanent` | 永久卡标记（时长 `-1` 或显式开启） |
| `value` | 额度卡提升的账号数量 |
| `enabled` | 禁用后的卡密不可核销 |
| `usedBy` / `usedByName` / `usedAt` | 核销后记录使用者（用户名、账号 ID 或 `instance`）、名称与时间 |

一张卡密只能核销一次；核销不可撤销。

## 普通用户

用户数据持久化在 `core/data/users.json`，与超管凭据（`admin.json`）相互独立：

```json
{
  "users": [
    {
      "username": "buyer01",
      "password": "<scrypt 摘要>",
      "role": "user",
      "enabled": true,
      "card": {
        "code": "4C8896UMPETUT846",
        "description": "渠道 A 月卡",
        "expiresAt": 1794992000000,
        "isPermanent": false
      },
      "accountLimit": 2,
      "createdAt": 1792400000000,
      "updatedAt": 1792400000000
    }
  ]
}
```

规则：

- 用户名 3-32 位，仅限字母、数字、下划线，且不可与管理员用户名冲突。
- 密码强度要求与超管一致：至少 6 位，包含大小写字母、数字、特殊符号中的至少两种。
- 注册只能使用**未使用、已启用**的时间卡密；额度卡密请登录后在账户中心使用。
- 个人账号上限默认 `2`，额度卡核销后累加。
- 登录失败 5 次锁定 15 分钟；全站共享按 IP 的频率限制。
- 到期后登录被拒（提示续费），名下账号由到期巡检自动停用；续费后可重新登录并启动账号。
- 用户由管理员停用（`enabled=false`）后无法登录。

## 账号归属与数据隔离

游戏账号（`core/data/accounts.json`）新增 `owner` 字段：

- 空值：超级管理员直接管理的账号，仅超管可见。
- 用户名：该普通用户名下的账号，仅本人与超管可见。

隔离范围：

| 范围 | 行为 |
| --- | --- |
| 账号列表 / 日志 / 设置 / 农场 / 好友 / 活动 / 商城 | 普通用户按 `owner` 过滤，仅能访问自己的账号 |
| Socket 实时推送 | 用户只能订阅自己名下账号的房间；聚合快照按归属过滤 |
| 全局账号操作日志 | 仅超管可见 |
| 下线提醒配置 | 实例级配置，含推送凭据，仅超管可读写 |
| 系统设置 / 卡密管理 / 用户管理 | 仅超管 |
| 添加账号 | 普通用户的账号强制归属本人，受个人上限约束；超管账号受实例管控开关约束 |

## 到期处理

管理面板内置巡检（启动时立即执行一次，之后每分钟一次）：

- 实例「卡密管控」开启时，`expiresAt` 已过期的游戏账号自动停止运行。
- 普通用户到期后，其名下全部游戏账号自动停止运行。
- 自动停止会写入账号日志（“账号卡密授权已到期，自动停止”）。

到期不会删除任何数据；续费后账号可再次启动。

## 管理操作

设置 → 卡密：

- 生成卡密：选择类型、描述、时长（天/小时）或永久、额度数量、生成数量（1-100）；批量生成自动导出文本文件。
- 列表管理：按关键词、类型、状态筛选；单条复制 / 启停 / 删除；批量选择、复制、删除、导出。
- 核销卡密：时间卡需选择目标游戏账号（叠加剩余有效期），额度卡直接提升实例上限。

设置 → 用户（仅超管）：

- 查看所有普通用户的到期时间、上限、名下账号数与注册卡。
- 编辑到期时间（支持永久）、账号上限、启用状态、重置密码。
- 删除用户；名下仍有游戏账号时需显式选择连同账号一起删除。

## 接口清单

公开接口（无需登录）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/register` | 卡密注册普通用户（`username` / `password` / `cardCode`） |

登录接口（`POST /api/login`）同时支持超管与普通用户，响应中通过 `data.role` 区分。

普通用户接口（需登录）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/user/renew` | 使用卡密续费（时间卡续期 / 额度卡提升上限） |
| GET | `/api/user/me` | 当前用户信息（含有效期与上限） |
| POST | `/api/user/change-password` | 修改自己的密码 |

管理接口（仅超管）：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/cards` | 卡密列表 |
| GET | `/api/admin/cards/overview` | 卡密设置、账号数、可用时间卡数 |
| POST | `/api/admin/cards` | 生成卡密（`count` 大于 1 时批量） |
| POST | `/api/admin/cards/settings` | 更新卡密管控开关与实例账号上限 |
| POST | `/api/admin/cards/use` | 核销卡密（时间卡需 `accountId`） |
| POST | `/api/admin/cards/batch-delete` | 批量删除卡密 |
| POST | `/api/admin/cards/:code` | 更新卡密（启用 / 禁用 / 描述） |
| DELETE | `/api/admin/cards/:code` | 删除卡密 |
| GET | `/api/admin/users` | 用户列表 |
| POST | `/api/admin/users/:username` | 编辑用户（到期 / 上限 / 启停 / 重置密码） |
| DELETE | `/api/admin/users/:username?force=1` | 删除用户（`force=1` 连同名下账号） |

## 关键实现

| 文件 | 职责 |
| --- | --- |
| `core/src/models/card-store.ts` | 卡密存储、码生成、时长归一化、到期计算、核销 |
| `core/src/models/user-store.ts` | 用户存储、注册、登录验证、续费、管理 |
| `core/src/controllers/admin/card-routes.ts` | 卡密管理接口 |
| `core/src/controllers/admin/user-routes.ts` | 用户管理接口 |
| `core/src/controllers/admin/auth-routes.ts` | 登录（双身份）、注册、续费、角色门禁 |
| `core/src/controllers/admin/middleware.ts` | token 身份、账号归属校验、账号列表过滤 |
| `core/src/controllers/admin/socket.ts` | Socket 房间隔离 |
| `core/src/controllers/admin/index.ts` | 路由挂载与到期巡检 |
| `web/src/stores/card.ts` / `web/src/stores/user.ts` | 前端卡密与用户状态 |
| `web/src/components/settings/CardKeyPanel.vue` | 卡密管理面板 |
| `web/src/components/settings/UsersPanel.vue` | 用户管理面板 |
| `web/src/components/settings/UserAccountPanel.vue` | 账户中心（续费 / 改密码） |
| `web/src/views/Login.vue` | 登录 / 卡密注册 |
| `core/tests/card-store.test.js` | 卡密核心逻辑单元测试 |

## 与上游实现的差异

卡密系统参考自 `ashu1800/qq-farm-bot` 删除前的实现，按本项目「单超级管理员 + 游戏账号」的形态做了适配：

- 参考项目面向多租户售卖，卡密绑定「面板用户」的注册与续费；本项目在此基础上保留该模型，并额外支持超管模式（时间卡直接绑定游戏账号、额度卡提升实例上限）。
- 参考项目的公开领取（按 User-Agent 限流领卡）依赖访客页面，本项目面板仅保留一个管理入口，未移植。
- 参考项目的机器码许可证（`license.json`）与卡密体系无关，未移植。
