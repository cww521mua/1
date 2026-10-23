# 萌卡 NT 对接部署指南

本文描述 QQ 农场面板与「萌卡 NT」QQ 协议框架的完整对接部署流程：在独立服务器上部署萌卡 NT 与桥接插件，面板通过正向 WebSocket 常驻连接，实现 QQ 扫码/密码登录、农场取码、等级加速等能力。

- 桥接插件源码：仓库 [mengka-bridge/](../mengka-bridge/)（含插件包内说明 [mengka-bridge/README.md](../mengka-bridge/README.md)）
- 面板侧对接代码：`core/src/services/mengka-connector.ts`、`core/src/controllers/admin/mengka-routes.ts`
- 等级加速：`core/src/services/mengka-level-tasks.ts`（要求萌卡框架 **v2.0.9+**，当前部署 2.7.5）

## 一、架构

| 节点 | 角色 | 关键端口 |
| --- | --- | --- |
| 面板服务器（如 140.210.9.211） | QQ 农场面板（pm2，80 端口） | 80 |
| 协议服务器（如 140.210.9.224） | 萌卡 NT 框架 + 桥接插件 | WebUI 7878、插件服务正向 WS 3001 |

```
面板(80) --正向 WS 常驻连接(3001, 15s 自动重连)--> 萌卡 NT 插件服务 mk-farm-bridge
萌卡 NT --MSF 连接--> 腾讯 QQ 服务器
桥接插件 --定时取码推送--> 面板 HTTP API
```

- 面板是 WS 客户端，连接后发送 `{type:'auth', token, ...}` 认证
- QQ 与面板用户的绑定关系存于面板 `core/data/mengka-bindings.json`（面板侧权威）；萌卡侧授权租约仅作备份

## 二、安装萌卡 NT（协议服务器）

1. 获取萌卡 NT Linux x64 发行包（**v2.0.9 及以上**，等级加速依赖其共享等级任务 API；建议 2.7.5+），解压出 `mengka-nt` 可执行文件：

   ```bash
   mkdir -p /opt/mengka-nt
   cp mengka-nt /opt/mengka-nt/mengka-nt
   chmod +x /opt/mengka-nt/mengka-nt
   ```

2. 创建 systemd 单元 `/etc/systemd/system/mengka-nt.service`：

   ```ini
   [Unit]
   Description=Mengka NT framework
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/mengka-nt
   ExecStart=/opt/mengka-nt/mengka-nt
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

3. 启动并设置开机自启：

   ```bash
   systemctl daemon-reload
   systemctl enable --now mengka-nt
   systemctl status mengka-nt
   ```

4. 首次启动在 `/opt/mengka-nt/data/` 生成 `config.db`、`config.yaml` 等数据；浏览器打开 `http://<协议服务器>:7878` 完成管理员初始化。

## 三、防火墙（协议服务器）

萌卡 WebUI（7878）与插件服务 WS（3001）**只允许面板服务器访问**，避免框架直接暴露公网：

```bash
firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<面板IP> port port=7878 protocol=tcp accept'
firewall-cmd --permanent --add-rich-rule='rule family=ipv4 source address=<面板IP> port port=3001 protocol=tcp accept'
firewall-cmd --reload
```

## 四、打包并导入桥接插件

桥接插件（`mengka-bridge/`）把萌卡在线 QQ 的农场登录 code 自动推送到面板。

1. **准备 Node 运行时**（插件自带，不依赖系统 Node；运行时二进制不入 git）：

   ```bash
   # 在仓库 mengka-bridge/ 目录下
   mkdir -p bin
   # 下载 Node.js v20 Linux x64 官方二进制，取出可执行文件
   tar -xzf node-v20*-linux-x64.tar.xz --strip-components=2 -C bin/ --wildcards '*/bin/node'
   mv bin/node bin/node-linux-amd64 && chmod +x bin/node-linux-amd64
   ```

2. **打包**（压缩包内直接包含 `mengka-plugin.json` 等文件，与仓库 `mengka-bridge/` 目录一致）：

   ```bash
   zip -r ../mengkaNT-qq-farm-bridge-<版本>-linux-amd64.zip . -x 'bin/*' -x '.gitignore'
   # 把 bin/node-linux-amd64 单独加入包内
   zip ../mengkaNT-qq-farm-bridge-<版本>-linux-amd64.zip bin/node-linux-amd64
   ```

3. **导入**：萌卡 WebUI →「插件服务 / 插件导入」→ 上传 zip → 勾选「来源可信」→ 启动插件卡片。

4. **配置插件**（卡片「配置」）：主服务器地址 `http://<面板IP>`、管理员用户名/密码（或访问 Code）、自动推送间隔（默认 5 分钟）、可选 QQ 过滤列表。

5. **版本注意**：萌卡不支持同版本重装与降级，重新上传前必须提高 `mengka-plugin.json` 的 `version`。

## 五、面板侧对接配置（面板服务器）

1. 「设置 → 系统设置 → 萌卡对接」开启，并填写：

   | 配置项 | 值 |
   | --- | --- |
   | 服务地址 | 协议服务器 IP（如 `140.210.9.224`） |
   | 端口 | `3001`（插件服务正向 WS） |
   | 令牌 | 萌卡数据库中插件服务的接入令牌（见下） |

2. **获取令牌**（在协议服务器上执行）：

   ```bash
   sqlite3 /opt/mengka-nt/data/config.db "SELECT token FROM plugins WHERE name='mk-farm-bridge';"
   ```

   令牌只在保存时写入面板加密存储，读取接口不回显。

3. 保存后面板自动连接，日志出现「萌卡框架认证成功」即对接完成：

   ```bash
   pm2 logs qq-farm --lines 20 --nostream | grep mengka
   ```

## 六、添加 QQ 与日常使用

- 面板「添加账号 → 萌卡登录」页签：**密码登录**（支持手机/平板 Android 协议）、扫码、短信验证码等二次验证链路
- 登录发起前面板会**自动预写插件授权**（`set_account_access enabled=true`），无需再到萌卡 WebUI 手工授权；QQ 掉线后点「重新登录」即可
- **多用户隔离**：萌卡侧返回全部在线 QQ，面板按 `mengka-bindings.json` 的归属过滤；普通用户只能操作自己名下账号
- **等级加速**：面板「等级加速」页直接执行萌卡共享等级任务（框架 ≥2.0.9）
- **微信账号不走萌卡**（微信仍用扫码登录，不参与萌卡档案）

## 七、运维排查

```bash
# 框架状态与日志
systemctl status mengka-nt
journalctl -u mengka-nt -n 100 --no-pager

# QQ 掉线（operation_logs 记录 MSF 断开/重连）
sqlite3 /opt/mengka-nt/data/config.db "SELECT entity_id, substr(data,1,110), created_at FROM operation_logs ORDER BY id DESC LIMIT 20;"

# 插件授权状态（enabled=0 时面板登录会被拒「插件授权已到期或被停用」；新版面板已自动预授权）
sqlite3 /opt/mengka-nt/data/config.db "SELECT self_id, enabled FROM plugin_account_access WHERE service_id=(SELECT id FROM plugins WHERE name='mk-farm-bridge');"
```

- 萌卡框架的 MSF 连接被断开后**不会自动重连**，需在面板「萌卡登录页签 → 重新登录」手动恢复
- journald 默认滚动清理，关键时段日志可用上述 SQLite 记录回溯
- 框架版本升级：WebUI 在线更新会重启框架并临时下线在线 QQ（缓存登录自动恢复）

## 八、升级与回退

- 面板升级照常执行 `.211` 部署流程（备份 dist、重启 pm2），不影响萌卡侧
- 桥接插件升级：提高 `mengka-plugin.json` 版本 → 重新打包导入 → 插件数据目录（`servers.json` 等）升级不丢
- 框架重置/迁移：备份整个 `/opt/mengka-nt/data/`（含 config.db 与插件目录）
