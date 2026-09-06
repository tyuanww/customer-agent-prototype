# `@customer-agent/api`

本包是 Application API 运行时。受控配置通过后，Node 24 会在本机 loopback 启动 Fastify；`GET /health` 证明进程存活，`GET /ready` 通过私有 runtime `pg.Pool` 核对 PostgreSQL 15、冻结 `schema.v1.15` 指纹、受控检索依赖清单与 runtime/definer/parameter 有效权限边界。DEV-M1 W3/W4 已把合成范围的 `/v1/search`、`/v1/events/adoption` 与 `/v1/events/escalate` 接入同一 runtime pool：查询幂等、候选曝光和终态/辅助事件由事务仓储统一控制；W5 又以同一 SearchBackend/SQL 主链建立 50 条纯合成运行器。mock auth、策略只读路由与独立 admin pool 的 Owner-only 策略写入口继续保持。G1A-E0 的仓外输入验证和离线评测只位于 `tests/support/g1a-e0/`，不会进入本包正式构建。

当前不是业务 API：

- 只允许 `CUSTOMER_AGENT_PROFILE=formal-dev|test`、`AUTH_MODE=mock` 和 `127.0.0.1`。
- `demo` 属于桌面合成运行链，不允许启动本服务。
- `single-host`、`multi-instance`、`production` 与 `AUTH_MODE=feishu` 尚未具备后续依赖，监听前失败关闭。
- `/health` 不访问数据库；`/ready` 只把 database/schema/auth 的真实结果写入合同响应。
- auth 已由当前 mock service 返回 `ok`；storage/content 尚未实现，因此 `/ready` 正常结果仍是 503，而不是业务已可用。
- `/v1/search` 仅接受 `collection_mode=synthetic`，原始输入只在 HTTP 边界内参与版本化 HMAC，`query_events` 固定以 `text_storage_status=suppressed` 记录，不持久化查询原文或其可关联文本 hash。搜索、query、impression 与幂等完成同事务提交；来源门失败先回滚，再由独立短事务写安全拒绝审计。
- `/v1/events/adoption` 的 `adopted` 只表示候选成功复制，且每个 query 仅允许一个 terminal；`/v1/events/escalate` 是非终态辅助动作，同一 `(query_id, action)` 返回同一事实。无状态 `collection_disabled` 搜索不会留下 query/idempotency，后续事件返回 404。
- migration 自动执行、storage、OAuth、真实数据、桌面 adapter 和 runtime activation 都未实现。
- 启动与 readiness 失败只输出稳定字段，不回显环境变量值、token、DSN、SQL 或异常正文。
- 同一时刻只运行一个 readiness 探针；连接等待与 readiness 响应分别由 `DB_CONNECTION_TIMEOUT_MS`、`DB_READINESS_TIMEOUT_MS` 控制，timer 与单调时钟都会拒绝 deadline 后才完成的成功结果。
- schema 探针锁定 13 个 search/传递函数、2 个视图、`pgcrypto.digest` extension owner、双向角色成员与当前数据库/全部用户 schema 的精确有效 ACL；任意非 owner 的 `public CREATE` 失败关闭。
- W5 只接受 `127.0.0.1`、`localhost` 或本机 Unix socket PostgreSQL；任意远程或括号 IPv6 DSN 均在建池前拒绝，托管数据库/TLS 属于后续部署设计。

配置合同与拒启矩阵见 [`docs/reference-api-runtime-config.md`](../../docs/reference-api-runtime-config.md)。

## 本地运行

先准备一个已应用十二段 migration 的本机隔离 PostgreSQL 15 数据库，并分别提供属于 `app_runtime` 与 `app_content_admin` 的两个登录角色。连接串和 HMAC key 只通过本机环境注入，不写入仓库：

```bash
CUSTOMER_AGENT_PROFILE=formal-dev \
AUTH_MODE=mock \
CUSTOMER_AGENT_BUILD_VERSION=dev-m1-slice1 \
DATABASE_URL='postgresql://<runtime-user>@localhost/<database>' \
CONTENT_ADMIN_DATABASE_URL='postgresql://<admin-user>@localhost/<database>' \
IDEMPOTENCY_HMAC_CURRENT_VERSION='hmac-idempotency-v1' \
IDEMPOTENCY_HMAC_KEYS='{"hmac-idempotency-v1":"<local-secret-material>"}' \
LOG_HASH_KEY_VERSION='hmac-log-v1' \
LOG_HASH_KEY='<different-local-secret-material>' \
DB_CONNECTION_TIMEOUT_MS=2000 \
DB_READINESS_TIMEOUT_MS=2000 \
pnpm dev:api
```

默认只监听 `127.0.0.1:3100`。验证：

```bash
curl --fail --silent http://127.0.0.1:3100/health
curl --silent --include http://127.0.0.1:3100/ready
```

`/health` 预期只包含：

```json
{"status":"ok","service":"cs-ai-api","version":"dev-m1-slice1"}
```

当前 `/ready` 会显示 database/schema/auth 的真实状态，但 storage/content 仍为 `not_ready`，所以返回 503。

## 验证

```bash
pnpm test:api
pnpm --filter @customer-agent/api test:integration
pnpm test:g1a:synthetic
pnpm test:g1a:e0
pnpm typecheck
pnpm build
pnpm workspace:check
```

普通 API 测试使用 Fastify `inject()`、fake pool 与一次真实 ephemeral loopback 监听，不要求 PostgreSQL。显式 integration 会通过 `@customer-agent/database/testkit` 创建并清理隔离的临时 PostgreSQL 15 cluster，只使用合成空库；不会连接共享数据库或真实数据。`test:g1a:synthetic` 先逐行校验旧版冻结 JSONL，再在同类隔离 PG15 中执行 `20 + 12 + 18 = 50` 条合成用例。

`test:g1a:e0` 使用真实包同形、但内容完全合成的仓外临时包，验证外部 manifest hash 锚点、comparison 清单内容哈希、文件/权限/软硬链/大小/canonical JSON、DLP leak canary、独立盲审主体、数据集零交叉、正式 question/governance hash、四域 source gate、事务内后验与整批回滚、只读事务（v2 repeatable-read；v3 owner 路径 read-committed 来源/撤销 fence）、同一 SearchBackend、零事件、Node TCP/fetch 守卫、聚合报告与成功/失败清理。报告中的 `process_guard_attempts` 只覆盖声明的 `NODE_TCP_FETCH_GUARD_ONLY` 观察面，不等于宿主级零出站或 OS 沙箱证明；真实运行前仍须完成 T5 宿主级网络与残留检查。纯合成结果固定为 `NOT_SIGNED / NOT_EVALUATED`；受控包硬失败会让 `test:g1a:e0:package` 非零退出，搜索动作候选结果单独记录，在 `downstream_action` 尚未完成 T5 盲审时整体结论保持 `NOT_SIGNED / REVIEW_REQUIRED`。只有仓外真实包及其 manifest SHA-256 已另行获批时，才可显式提供 `CUSTOMER_AGENT_G1A_INPUT_ROOT` 与 `CUSTOMER_AGENT_G1A_MANIFEST_SHA256` 运行该命令。所有 testkit 均不进入 API 生产请求路径。

负责人承接 v3 包在原四成员外固定增加 `owner-acceptance.json`。受控入口还要求独立提供 `CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256` 与 `CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH`；二者不是包内自报批准。读取器校验完整 scope、四域绑定、审核前摘要、有效期限及逐条记录锚点；loader 在同一事务按实际来源确定 tenant，以独立登记角色登记，再由 PG 对实际持久化字段核验完整集合与最终摘要。runtime 不获得登记权限；撤销和来源停用均拒绝搜索。v2 保留原规则。合成验证与批准边界见 [B3 实施记录](../../docs/plans/2026-09-06-owner-acceptance-loader.md)。

版本化装包入口 `pnpm --filter @customer-agent/api assemble:g1a:owner` 仅生成并校验仓外包，不启动 PG 或运行评测。调用前必须明确提供以下环境变量；该入口默认不参与 CI，只有独立获准的受控输入才可用于真实装包：

| 环境变量 | 输入 |
| --- | --- |
| `CUSTOMER_AGENT_G1A_ASSEMBLY_INPUT` | 本人所有、0700、无符号链接的仓外目录，恰好含两个 0600 单硬链接文件 |
| `CUSTOMER_AGENT_G1A_ASSEMBLY_OUTPUT_PARENT` | 同样受控的仓外输出父目录；每次创建唯一 `g1a-owner-v3-*` 新目录 |
| `CUSTOMER_AGENT_G1A_ASSEMBLY_SHA256` | 从受控输入交接独立取得的 `assembly.json` 原始文件 SHA-256 |
| `CUSTOMER_AGENT_G1A_OWNER_ACCEPTANCE_SHA256` | 独立批准记录原始文件 SHA-256 |
| `CUSTOMER_AGENT_G1A_OWNER_SUBJECT_HASH` | 独立确认的负责人主体摘要 |

两个输入文件均采用 JCS 单行 JSON 加一个 LF。`owner-acceptance.json` 必须为既有 `OwnerAcceptanceRecord`，不会由装包器生成。`assembly.json` 的闭合根键为 `schema`（`customer-agent/g1a-owner-assembly/v1`）、`manifest`、`content`、`cases`、`expectations`。后三者使用 v3 同名内容数组；`manifest` 使用 v3 元数据，但禁止传入派生键 `schema/files/content_snapshot_sha256/source_binding_hash`。每条 content 禁止传入 `content_hash`、`review_mode`、全部 primary/secondary reviewer 字段以及 `owner_acceptance_record_sha256`；question 禁止传入 `question_hash`。装包器从规范化字段与批准记录派生这些值，不修改业务文本、风险、来源、版本或期限。

输出通过现有 v3 读取器的完整 scope、有效期、独立性与文件校验后，才打印 `ASSEMBLED_NOT_EVALUATED`、新目录和 manifest 摘要。失败清理本次新目录；旧脚本、旧包和批准记录不覆盖。收据摘要是新包完整性锚点，不是 T5 运行批准；后续运行仍需核对对应批准和清理条件。入口与验证证据见 [B4 实施记录](../../docs/plans/2026-09-06-owner-package-assembler.md)。
