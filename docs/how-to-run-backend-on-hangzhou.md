# How to 在杭州跑这条后端

`agent-auth.jianghua.site` 与 `agent-pass.jianghua.site` 这两个公网入口，从 2026-09-29 起由杭州那台机器的 WSL 提供。Mac 从那天起只做开发。

这份文档是操作手册：东西放在哪、怎么更新、怎么迁数据、怎么切回、哪些坑已经踩过。

## 拓扑

```
办公机 Windows 客户端
   │
   ├─ https://agent-auth.jianghua.site ─┐
   └─ https://agent-pass.jianghua.site ─┤  Cloudflare（zone jianghua.site）
                                        ▼
                         隧道 customer-agent-hangzhou
                         4a7be6eb-e48e-47a7-a1fe-879c80729474
                         （远端配置模式：ingress 存在 Cloudflare 账号里，
                           这台机器上没有任何凭据文件或 config.yml）
                                        ▼
        ┌───────────────────────────────────────────────┐
        │ 杭州 desktop-faejk8s / 100.93.46.46           │
        │ WSL Ubuntu-24.04（systemd）                    │
        │  customer-agent-tunnel.service → cloudflared   │
        │  customer-agent-stack.service                  │
        │    ├─► 127.0.0.1:43115  API                    │
        │    ├─► 127.0.0.1:43116  口令身份                │
        │    └─► 127.0.0.1:43199  PG15（Unix socket）    │
        └───────────────────────────────────────────────┘

        Mac（只做开发，不再对外）
```

同一台机器上还跑着 fuqing-crm-analytics、WeKnora、tyuan-chat，以及宿主的 nginx / PG17 / Redis / Tailscale。**PG15 是独立集群**，只在 stack root 里的 Unix socket 上监听，和 PG17 的 5432 完全隔离。

## 东西放在哪

| 东西 | 路径 |
| --- | --- |
| 代码 | `/srv/customer-agent/releases/<git-sha>/`，`current` 是软链 |
| stack root | `/srv/customer-agent/stack/` |
| PG15 二进制 | `/opt/pg15/usr/lib/postgresql/15/bin/`（PGDG jammy 的 .deb 解出来的） |
| PG 数据 | `/srv/customer-agent/stack/data/pg15/` |
| PG socket | `/srv/customer-agent/stack/data/pg15-socket/` |
| 对象存储 | `/srv/customer-agent/stack/objects/` |
| 桌面 profile | `/srv/customer-agent/desktop-profile/`（栈启动时写入 loopback origin） |
| 日志 | `/srv/customer-agent/stack/logs/`，以及 `journalctl -u customer-agent-stack` |
| 库备份 | `/srv/customer-agent/backups/` |
| 隧道 token | `/etc/cloudflared/customer-agent-hangzhou.token`（root 0600） |
| 运行身份 | 非 root 用户 `customer-agent` |

**栈不能以 root 跑**：`initdb` 拒绝 root。所以单元里必须是 `User=customer-agent`，`/srv/customer-agent` 也归它。

## 三个 env 文件

都在 stack root，权限 0600，都可选。各有各的职责，不要互相串。

| 文件 | 管什么 |
| --- | --- |
| `feishu.env` | 飞书 OAuth 客户端与角色绑定；**有它 `AUTH_MODE` 才变成 `feishu`** |
| `content.env` | 内容侧常量，以及生产库名 `DATABASE_NAME` |
| `api.env` | 可搬运的生产密钥（profile 名、HMAC 材料），**只放这一个** |

### `api.env` 只收「搬得走」的东西

`stack.ts` 是生产入口。凡是由 stack root 推导出来的值——5 条 DSN、`CONTENT_OBJECT_STORE_DIR`、`CUSTOMER_AGENT_API_HOST/PORT`、`SYNTHETIC_IDENTITY_PROVIDER_ORIGIN`、`PATH`、`NODE_EXTRA_CA_CERTS`，以及飞书那几项（它们有自己的通道）——**写进 `api.env` 会让 `start` 直接报错并点名这个键**，不会被合并。

这不是洁癖。把另一台机器的 `api.env` 原样拷过来，是最容易发生的一步，而后果不均匀：socket 目录写错会**响亮地**连不上；但对象存储目录写旧了、或者 DSN 里的 socket 目录在两边恰好都存在，就会**安静地**把东西写到没人看的地方。拒绝推导键，把这一整类变成开机即报的错。

当前 `api.env` 里的 9 个键：

```
AUTH_SESSION_MODE  CUSTOMER_AGENT_BUILD_VERSION  CUSTOMER_AGENT_PROFILE
DB_CONNECTION_TIMEOUT_MS  DB_READINESS_TIMEOUT_MS
IDEMPOTENCY_HMAC_CURRENT_VERSION  IDEMPOTENCY_HMAC_KEYS
LOG_HASH_KEY  LOG_HASH_KEY_VERSION
```

`IDEMPOTENCY_HMAC_KEYS` 与 `LOG_HASH_KEY` **必须和源机器一致**：库里已有的幂等键与日志哈希链是用它们算的，换一套就等于对不上账。

## 更新代码

```bash
SHA=<要部署的 git sha>
ssh -i ~/.ssh/id_ed25519_pc2 root@100.93.46.46 bash -s <<EOF
set -e
DEST=/srv/customer-agent/releases/$SHA
git clone https://github.com/tyuanww/customer-agent-prototype.git "\$DEST"
cd "\$DEST" && git checkout $SHA
pnpm install --frozen-lockfile
pnpm build:services
chown -R customer-agent:customer-agent "\$DEST"
ln -sfn "\$DEST" /srv/customer-agent/current
systemctl restart customer-agent-stack
EOF
```

保留 `releases/<sha>` 而不是原地 `git pull`，是为了「上一版还在，能立刻切回去」。回滚就是 `ln -sfn` 到旧 sha 再 `systemctl restart`。

`systemctl restart` 会重跑迁移与角色授权（两者都是幂等的），**不动数据**。

这条栈**不会被播种**，这是从 `content.env` 推出来的，不靠命令行旗标。理由：`stack.ts start` 在不带 `--no-seed` 时会把演示话术当作线上目录发布，而 `--no-seed` 是逐次传的——单元文件里有，但人 ssh 进来修栈时打的是 `restart`，不会带。所以现在只要 `content.env` 声明了自己的 `DATABASE_NAME`，就一律跳过播种，日志会写明原因：

```
[stack] seed: skipped (content.env names its own database); this stack serves a real catalog
```

要一套**会**播种的栈，就别在它的 `content.env` 里写 `DATABASE_NAME`。

## 迁数据

源：Mac 的 `~/.customer-agent-formal/pg15`，库 `customer_agent_formal`，socket 端口 43299。

**先冻结写入**（停 Mac 的 API 与 worker），再导出。Mac 侧入口是 `scripts/formal-dev-up.mjs`：

```bash
# Mac 上
pkill -f "apps/api/dist/main.js"; pkill -f "content-worker-main.js"
pg_dump --data-only --format=custom --no-owner --no-privileges \
  "postgresql://stack_owner@localhost/customer_agent_formal?host=$HOME/.customer-agent-formal/socket&port=43299" \
  -f /tmp/mac-final.dump
```

**它现在比从前严。** `formal-dev-up.mjs` 共用 `profile.ts` 的 `parseEnvFile`，与 `feishu.env` / `content.env` 同一套规矩：没有 `=` 的行、键为空的行都抛 `invalid line`（以前静默跳过），**重复键抛错**（以前取最后一个）。这是有意的——「悄悄从两个审核负责人里挑一个」以后没人解释得清——但代价是一份它以前能接受的 `api.env` 现在可能拒绝启动。写注释请用 `#` 开头；从 Windows 拷来的 CRLF 文件反而没问题（`parseEnvFile` 按 `\r?\n` 切）。

**必须带 `--disable-triggers` 还原**：`query_events` 与 `content_releases`↔`import_batches` 有循环外键，pg_dump 会明确警告；不带这个选项还原一定失败。它需要超级用户，`stack_owner` 是。

```bash
# 杭州上
sudo -u customer-agent env PATH=/opt/pg15/usr/lib/postgresql/15/bin:/usr/bin:/bin \
  pg_restore --data-only --disable-triggers --no-owner --no-privileges --exit-on-error \
  -h /srv/customer-agent/stack/data/pg15-socket -p 43199 \
  -d customer_agent_formal -U stack_owner /tmp/mac-final.dump
```

### 目标库不是空的

`stack.ts start` 每次都会播合成身份（`backend_identity.subject_bindings`、`capability_bindings`）与基线行（`policy_flags`、`intent_taxonomy_*`、`authoritative_source_versions`）。所以直接还原会撞主键。

清空要绕过 `owner_acceptance_*` 上的 `OWNER_ACCEPTANCE_IMMUTABLE` 触发器：

```sql
SET session_replication_role = replica;   -- 超级用户
TRUNCATE TABLE <全部基表> RESTART IDENTITY CASCADE;
```

**清空面要覆盖到全部 57 张基表，不是只清「看起来非空」的那几张。** 第一次迁移时我只清了 7 张，以为够了——结果第一次还原已经把 55 张填满，第二次只清了 7 张就重放，`pg_restore` 卡在 `import_batches` 主键冲突上，留下 13 张表是空的、42 张是对的中间状态。当时靠 `pg_restore -L`（按 dumpId 精确选取）只补那 13 张空表修好——纯追加，没有删除。以后再迁，直接全表清空再整体还原。

`pg_restore -t schema.table` **在 data-only 归档上不生效**（TOC 条目名是 `TABLE DATA <schema> <table>` 两段，`-t` 匹配不上），会报成功但什么都不做。要选表就用 `-L` 列表文件。

### 校验

逐表行数比对，**排除视图**（`v_release_source_gate`、`v_scripts_recommendable` 会随基表自动重算）：

```sql
SELECT * FROM (VALUES ('public.scripts',(SELECT count(*) FROM public.scripts)), ...) v(t,n) ORDER BY t;
```

2026-09-29 那次的结果：55 张基表逐表一致，`scripts=491`、`release_items=2873`、`content_current→rel_27 published`、序列 `content_release_seq.last_value=27`、视图 9 / 408。

对象存储也要一起搬（内容里的附件）：

```bash
rsync -a --checksum -e "ssh -i ~/.ssh/id_ed25519_pc2" \
  ~/.customer-agent-formal/objects/ root@100.93.46.46:/srv/customer-agent/stack/objects/
```

搬完比一下内容指纹（对所有文件取 sha256 再排序再哈希），比文件数可靠。

## 切隧道与回滚

隧道是**远端配置模式**：杭州只放一个 token 文件，ingress 存在 Cloudflare 账号里。这样这台机器上不需要出现源机器的任何凭据，也不存在「同一个隧道挂两个连接器」那种随机命中两套库的状态。

DNS 是两条 CNAME，改 `content` 即可：

| hostname | record id |
| --- | --- |
| `agent-auth.jianghua.site` | `2dc23c3e8b5675c3306dbeac2d921053` |
| `agent-pass.jianghua.site` | `9ff0bf065f811e8ea0a06b07d9b3cfd6` |

- 杭州（当前）：`4a7be6eb-e48e-47a7-a1fe-879c80729474.cfargotunnel.com`
- Mac（旧，**保留着以便回滚**）：`487afb14-5c03-468a-ba37-9f98bd4c401c.cfargotunnel.com`

改 DNS 的凭据是 `~/.cloudflared/cert.pem`（Argo Tunnel token，含 zone `jianghua.site` 的 DNS 编辑权）。

### 切换前先开探针域名

不要直接改生产记录。先建两个临时 hostname（例如 `agent-auth-probe.jianghua.site`）指向新隧道，加进远端 ingress，从外面把 `/health`、`/ready`、以及身份那一跳（`POST /password` → `POST /exchange`）都验一遍，确认无误再动生产记录，最后把探针记录和 ingress 条目删掉。

### 回滚演练（2026-09-29 已做，闭环）

判别器用「源站死活」，因为两边 API 的 `/health` 长得一样：

1. 记录改回旧隧道（Mac）→ 200
2. **停 Mac 的 API** → 变 **502** ← 证明旧隧道确实指向 Mac
3. 拉起 Mac 的 API → 恢复 200
4. 记录改回新隧道（杭州）→ 200
5. **再停 Mac 的 API** → **仍然 200** ← 证明已经在杭州

## 这条链的自启

```
Windows 开机/登录
  → 计划任务拉起 WSL（目前靠 WSL-Start-Dockerd 的 logon trigger）
    → systemd 起 customer-agent-stack（前台 supervisor + PG15 + API + worker + 口令身份）
    → systemd 起 customer-agent-tunnel（cloudflared）
```

两个单元都是 `enabled`。2026-09-29 真重启验证过：栈在开机后 9 秒自恢复。

**已知缺口**：`WSL-Start-CustomerAgent` 那个 `<BootTrigger>` 计划任务**不会触发**（`InteractiveToken` 的无人登录任务不跑），实测 `LastRunTime` 停在手工那次；真正把 WSL 拉起来的是 `WSL-Start-Dockerd` 的 `<LogonTrigger>`，而那次是有人登录的。要真无人值守得配 Windows 自动登录（Sysinternals Autologon，或写 Winlogon 注册表四条键），代价是「开机即得 Administrator 桌面」。**这一步需要本人在机器上做，密码不能走对话。**

## 已知缺口（都在 `TODOS.md`）

- **依赖异常仍需 watchdog / 告警**：`customer-agent-stack.service` 已使用 `Type=simple` 前台模式，identity、API 或 worker 退出会触发 `Restart=on-failure` 重启整组；但进程都还活着而数据库、存储或内容就绪失败时，仍由 watchdog 和健康告警处理。
- **单点**：整套在单台 WSL 桌面机上，而那台机器同时在日常使用。
- **没有告警**：上面每一条失效，办公机那边都只表现为「登录不了」，没有别人会知道。
  探针与 systemd timer 已写在 `docs/how-to-health-probe-hangzhou.md`（探 `/ready`，非 `/health`），**但尚未装到机器上**。
