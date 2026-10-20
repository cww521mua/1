# QQ 好友 GID 本地档案（抓包存档 + 跨登录复用）

## 功能定位

抓包登录时获取的 QQ 好友 GID 持久化到本地档案，同一 QQ 之后无论以哪种方式登录（填写 Code、QQ 扫码、萌卡取码），都直接复用档案中的 GID 组建好友列表，无需重新抓包。

- 档案文件：`core/data/qq-friend-gids.json`
- **唯一写入来源：抓包登录**的后台好友同步完成时（`collectQqFriendGids`）
- 其他登录方式**只读取注入**，不更新档案
- **微信账号不存不读**（存档与注入链路均仅 QQ）

## 识别方式：账号自身游戏 gid

抓包流量与游戏协议中都拿不到 QQ 号（只有 code/openid/gid），而游戏 gid 与 QQ 一一对应、且对同一 QQ 跨登录方式保持稳定，因此档案以**账号自身的游戏 gid** 作为 key，作用等同 QQ 号识别：

- 抓包侧：优先 `flow.accountGid`（抓包会话快照从网关地址提取的自身 gid，**实测常为空**）；为空时由 worker 首次登录上报的自身 gid 补齐
- 其他登录侧：worker 登录游戏成功后 `getUserState().gid`

## 链路

```
抓包登录（QQ）完成
  └─ collectQqFriendGids 后台同步完成（capture-routes.ts）
       ├─ store.setKnownFriendGids(accountId, gids)        # 账号自身好友数据（原有逻辑）
       ├─ store.savePendingCaptureGids(accountId, gids)    # 无条件内存暂存（30 分钟 TTL），
       │                                                   # 因会话快照通常拿不到档案 key（自身 gid）
       └─ flow.accountGid 已知时 saveQqFriendGidArchive    # 快照带自身 gid 时直接写档案

任意方式登录成功（填 Code / QQ 扫码 / 萌卡）
  └─ worker onLoginSuccess（worker.ts）
       └─ sendToMaster({ type: 'friend_gid_seed_check', selfGid, platform: 'qq' })
            └─ master（worker-manager.ts）
                 ├─ 仅 platform=qq 且 selfGid>0
                 ├─ 消费暂存 takePendingCaptureGids(accountId)
                 │    └─ 有暂存 → saveQqFriendGidArchive(selfGid, 暂存GID)  # 抓包数据落档（唯一写入点）
                 ├─ 账号当前 knownFriendGids 为空时才注入：
                 │    ├─ 优先用本次抓包暂存注入
                 │    └─ 否则 findQqFriendGidArchive(selfGid) 命中 → 注入档案 GID
                 └─ config_sync 回 worker → 好友任务按注入的 GID 拉取好友列表
```

## 关键实现

| 位置 | 说明 |
| --- | --- |
| `core/src/models/store/qq-friend-gids.ts` | 档案存储：normalize（gid key 校验、GID 去重过滤、按更新时间排序、上限 500 条）、`findQqFriendGidArchive` / `saveQqFriendGidArchive`（合并写入）；内存暂存 `savePendingCaptureGids` / `takePendingCaptureGids`（消费即删、30 分钟 TTL，桥接「抓包完成」与「登录上报自身 gid」两个时机） |
| `core/src/controllers/admin/capture-routes.ts` | 抓包后台同步完成后无条件暂存本次 GID；快照已带自身 gid 时直写档案 |
| `core/src/core/worker.ts` | `onLoginSuccess` 中 QQ 平台一次性上报 `friend_gid_seed_check`（带自身 gid） |
| `core/src/runtime/worker-manager.ts` | `friend_gid_seed_check` 分支：消费暂存落档；空好友数据时优先暂存注入、其次查档案注入并 config_sync |

## 行为细节

- **注入条件**：账号 `knownFriendGids` 为空才注入，已有好友数据的账号（含重新登录）不会被覆盖；注入后 worker 的常规好友同步（好友列表返回、最近访客）继续在账号维度合并更新，但不回写档案。
- **档案更新**：每次抓包登录完成都会把「账号已有 + 本次抓包」合并后的 GID 写回档案（去重），档案保持最新完整快照。
- **失效 GID**：worker 检测到失效好友 GID 时仅从账号数据移除，档案不删；下次若以该账号为空档重新注入，失效 GID 会被再次标记冷却并移除，不影响运行。
- **容量**：档案上限 500 个账号，超出时按 `updatedAt` 保留最近更新的条目。

## 测试

`core/tests/qq-friend-gids.test.js`：key 归一化、条目过滤排序与容量上限、合并写入与按 key 读取（读写真实文件，测试前后备份还原）。
