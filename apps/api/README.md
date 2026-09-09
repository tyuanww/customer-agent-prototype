# `@customer-agent/api`

本包是 Application API 运行时。受控配置通过后，Node 24 会在本机 loopback 启动 Fastify；`GET /health` 证明进程存活，`GET /ready` 通过私有 runtime `pg.Pool` 核对 PostgreSQL 15、冻结 `schema.v1.16` 指纹、受控检索依赖清单与 runtime/definer/parameter 有效权限边界。DEV-M1 W3/W4 已把合成范围的 `/v1/search`、`/v1/events/adoption` 与 `/v1/events/escalate` 接入同一 runtime pool：查询幂等、候选曝光和终态/辅助事件由事务仓储统一控制；W5 又以同一 SearchBackend/SQL 主链建立 50 条纯合成运行器。mock auth、策略只读路由与独立 admin pool 的 Owner-only 策略写入口继续保持。G1A-E0 的仓外输入验证和离线评测只位于 `tests/support/g1a-e0/`，不会进入本包正式构建。合成搜索判定实验位于 `experiments/search-decision/`，同样不进入 `dist` 或正式候选包；它复用 `src/search-decision.ts` 与 `src/search-relations.ts` 的判定诊断，不再改写产品规则；来源注解与需求判定只在实验内使用。

当前开发边界：

- 只允许 `CUSTOMER_AGENT_PROFILE=formal-dev|test`、`AUTH_MODE=mock` 和 `127.0.0.1`。
- `demo` 属于桌面合成运行链，不允许启动本服务。
- `single-host`、`multi-instance`、`production` 与 `AUTH_MODE=feishu` 尚未具备后续依赖，监听前失败关闭。
- `/health` 不访问数据库；`/ready` 只把 database/schema/auth 的真实结果写入合同响应。
- auth 由所选身份服务返回实际状态；T2 已接通合成 CSV/XLSX 持久接收与 batch 状态/取消，但 `/ready` 的 storage/content 仍固定 `not_ready`，因此正常连库仍是 503。真实飞书导入、worker 解析和发布仍未实现。
- `/v1/search` 仅接受 `collection_mode=synthetic`，原始输入只在 HTTP 边界内参与版本化 HMAC，`query_events` 固定以 `text_storage_status=suppressed` 记录，不持久化查询原文或其可关联文本 hash。搜索、query、impression 与幂等完成同事务提交；来源门失败先回滚，再由独立短事务写安全拒绝审计。
- `/v1/events/adoption` 的 `adopted` 只表示候选成功复制，且每个 query 仅允许一个 terminal；`/v1/events/escalate` 是非终态辅助动作，同一 `(query_id, action)` 返回同一事实。无状态 `collection_disabled` 搜索不会留下 query/idempotency，后续事件返回 404。
- migration 自动执行、storage、OAuth、真实数据、桌面 adapter 和 runtime activation 都未实现。
- 启动与 readiness 失败只输出稳定字段，不回显环境变量值、token、DSN、SQL 或异常正文。
- 同一时刻只运行一个 readiness 探针；连接等待与 readiness 响应分别由 `DB_CONNECTION_TIMEOUT_MS`、`DB_READINESS_TIMEOUT_MS` 控制，timer 与单调时钟都会拒绝 deadline 后才完成的成功结果。
- schema 探针锁定 13 个 search/传递函数、2 个视图、`pgcrypto.digest` extension owner、双向角色成员与当前数据库/全部用户 schema 的精确有效 ACL；任意非 owner 的 `public CREATE` 失败关闭。
- W5 只接受 `127.0.0.1`、`localhost` 或本机 Unix socket PostgreSQL；任意远程或括号 IPv6 DSN 均在建池前拒绝，托管数据库/TLS 属于后续部署设计。

配置合同与拒启矩阵见 [`docs/reference-api-runtime-config.md`](../../docs/reference-api-runtime-config.md)。

## 本地运行

先准备一个已应用十三段 migration 的本机隔离 PostgreSQL 15 数据库，并分别提供属于 `app_runtime` 与 `app_content_admin` 的两个登录角色。连接串和 HMAC key 只通过本机环境注入，不写入仓库：

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

## 合成产品会话（T1）

在上述本机开发配置上显式设置 `AUTH_SESSION_MODE=product`，并提供独立 `AUTH_DATABASE_URL`（仅属于 `app_backend_auth` 的无特权登录角色）及 `SYNTHETIC_IDENTITY_PROVIDER_ORIGIN=http://127.0.0.1:<port>`。完整变量约束见配置 SSOT。没有提供这两项时拒启，不能退回 mock-login。`AUTH_MODE` 仍为 `mock`，如实说明身份来源是合成提供方；产品会话模式不接受 X-Mock-User/Role，也不注册 `/v1/auth/mock-login`。

T1 路径为 login-requests → 固定 callback → PKCE S256 exchange → `/v1/auth/me` → logout。会话落在 PostgreSQL，数据库仅存 token 摘要；兑换成功响应丢失后重新登录，不能重放获取 bearer。提供方是本机合成测试服务，其 `/exchange` 只返回 `{provider: "synthetic", binding_id: "synthetic_..."}`，不存在真实飞书适配。实际启动入口及此 wire 已在隔离 PG15 合成集成测试贯通；本节不提供真实凭据或运行激活。

## 合成内容导入（T2）

在已有 runtime pool 上接收 `POST /v1/content/import` 的 CSV/XLSX multipart（字段 `file`、`source_bindings`）。文件先写入 `CONTENT_OBJECT_STORE_DIR` 的不可变对象并校验摘要，随后才调用 `enqueue_content_import` 原子创建 batch、source bindings 与 outbox；事务提交成功后才返回 202。状态查询与取消走既有 SQL 投影；coach/owner 以外角色拒绝。单文件 10 MiB、上传 30 秒。飞书 JSON 导入保持关闭。提交结果不确定时不得回收已接收对象。连接池预算：enqueue/status/cancel 复用 `app_runtime`。

## 合成 worker 与受限审核（T3）

独立 worker 进程使用 `CONTENT_WORKER_DATABASE_URL`（`app_backend_worker`）claim/heartbeat/`lease_version` fencing、冻结质量计划，并调用 `backend_review.park` / `finish`。解析 CSV 或带 csv 成员的有界 XLSX zip（解压累计 50 MiB、最多 128 个 ZIP 条目、解析 60 秒），不在长事务中做文件 I/O。审核 HTTP 在 `/v1/admin/content/reviews*`，使用 `CONTENT_REVIEW_DATABASE_URL`（`app_backend_review`）记录决定与质量证据、resume/cancel。高风险/冲突必须两个不同 `subject_hash`；取消后不得留下 staging。product+review 时 API 默认 runtime 12 + admin 2 + auth 2 + review 2 = 18，给 worker 进程预留 2。

## 合成发布与回退（T4）

Owner 通过 `POST /v1/content/publish` 与 `POST /v1/content/rollback` 调用冻结 `publish_content_release` / `rollback_content_release`。复用已有 `CONTENT_ADMIN_DATABASE_URL` 连接池，不新增池。CAS 校验 `base_release_id`，并发发布 409；回退创建新的 `release_seq` 并记录 `rollback_of_release_id`。来源拒绝写入独立 `record_admin_source_denial_audit` 事务，审计失败不得返回成功。一期仅 owner。读取/ready 不在本切片。content_releases 的延迟约束触发器在 COMMIT 时以当前角色执行，合成测试为 `app_content_admin` 补了触发器只读所需的表/digest 授权；冻结合同 EXECUTE-only ACL 本身不够。

## 验证

```bash
pnpm test:api
pnpm --filter @customer-agent/api test:integration
pnpm test:g1a:synthetic
pnpm test:g1a:e0
pnpm test:search-decision
pnpm test:search-decision:round1
pnpm test:search-decision:acceptance
pnpm test:search-decision:proof
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


## 安全报告交付

`report-contract.ts` 是测试专用报告合同的唯一所有者，冻结阈值和结果映射由评测器复用。受控 runner 在完成 PG 清理后只输出一条 `G1A_E0_DELIVERY ` 前缀的 `customer-agent/g1a-safe-delivery/v1` JSON。它包含报告和 runtime；标识值按 manifest 锚点哈希化，保留50题、分层、计数、候选排序与失败码，拒绝正文、未知字段和不一致状态。`case_id`、`script_id`、`release_id`、`stratum_id` 等字段在交付格式中均为 SHA-256 引用，不能作为原始 ID 使用。

宿主通过 `node scripts/read-g1a-delivery.mjs <manifest-sha256>` 从 stdin 读取进程输出或回读内容；输出为校验后的 JSON。落盘 JSON 回读时先加同一前缀。缺失、重复、未知版本、锚点不符、坏字段或清理失败返回1，仅输出固定错误码；合法业务 FAIL 是可保存报告，不等于进程或合同故障。该入口只读 stdin，不读真实输入包、不连接 PG、不签发批准。

此格式取代旧 `G1A_E0_REPORT` 输出。仓外旧 v4 消费者冻结，不能解析此新版本；配套 v5 调用产品读取器，保留原授权、沙箱及排他保存边界。历史真实配置和报告不自动迁移；新候选合并后按具体批准绑定匹配版本。`pnpm test:g1a:e0:ci` 会在纯合成包上实跑 PG、导出、独立 CLI 消费、落盘回读及失败清理，并拒绝真实输入环境变量、零用例或跳过。
