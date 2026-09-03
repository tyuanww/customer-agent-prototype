# Application API 启动配置与拒启矩阵

本页是 `DEV-M0-W3～W5` 当前可执行 API 配置的 SSOT。产品化总路线继续由获批计划拥有；本页只记录 W5 已实现的本机运行时数据库探针，不授权真实身份、真实数据、部署或 runtime activation。

## 1. 单一 profile

唯一 profile 键是 `CUSTOMER_AGENT_PROFILE`。允许值固定为：

`demo | formal-dev | test | single-host | multi-instance | production`

当前 W5 可启动集合只有 `formal-dev | test`。不得用 `NODE_ENV` 或多个布尔 flag 拼出未命名环境。

| Profile | W5 结果 | 原因 |
| --- | --- | --- |
| `demo` | 拒启 | Demo 由 `apps/desktop` 独立运行，禁止因为新增 API 骨架而暗接后端 |
| `formal-dev` | 允许 | 仅 `AUTH_MODE=mock`、loopback、`/health`、`/ready` 与私有 runtime pool |
| `test` | 允许 | 同上；允许端口 `0` 做 ephemeral 测试 |
| `single-host` | 拒启 | DB、storage、auth、readiness 与部署门尚未闭合 |
| `multi-instance` | 拒启 | 共享存储、并发、worker 与 readiness 尚未闭合 |
| `production` | 拒启 | Feishu auth、DB、storage、runtime activation 与部署均未放行 |

`AUTH_MODE=feishu` 当前同样拒启。W5 不通过“接受配置但不注册鉴权”的方式伪造正式能力。

## 2. 当前变量

| 变量 | 规则 | 是否进入公开响应/错误 |
| --- | --- | --- |
| `CUSTOMER_AGENT_PROFILE` | 必填；必须是上表精确值 | 只输出字段名和稳定拒绝原因 |
| `AUTH_MODE` | 必填；W5 只接受 `mock` | 只输出字段名和稳定拒绝原因 |
| `CUSTOMER_AGENT_API_HOST` | 可省略，固定默认 `127.0.0.1`；其它值拒启 | 不回显原值 |
| `CUSTOMER_AGENT_API_PORT` | formal-dev 默认 `3100`；两者范围均为 `1024..65535`，test 另可用 `0` 做 ephemeral 监听 | 不回显非法原值 |
| `CUSTOMER_AGENT_BUILD_VERSION` | 可省略，默认 `dev-m0`；1–64 位安全版本字符 | 仅合法值进入 `/health.version` |
| `DATABASE_URL` | 必填；只接受指向 `127.0.0.1` / `localhost` / `::1` 的 `postgres:` / `postgresql:` URL，必须包含数据库路径且不得带 fragment；禁止驱动控制类 query 参数，隔离 PG15 harness 仅可使用唯一绝对 Unix-socket `host` 与可选 `port`；任意远程 DSN 拒启 | 只保留在私有 bootstrap config，不回显原值 |
| `DB_POOL_MAX` | 可省略，默认且上限为 `20`；只接受正整数 | 不进入公开 config 或响应 |
| `DB_CONNECTION_TIMEOUT_MS` | 可省略，默认 `2000`，范围 `1..10000`；只约束连接获取 | 不进入公开 config 或响应 |
| `DB_READINESS_TIMEOUT_MS` | 可省略，默认 `2000`，范围 `1..10000`；约束 readiness 响应、query timeout 与 statement timeout | 不进入公开 config 或响应 |

公开解析结果不保留环境对象，也不包含 Feishu secret、DSN 或 storage 凭证。私有 DB bootstrap config 只进入 repository factory，不进入 `StartedApi.config`、日志或 HTTP。合同来源由 `@customer-agent/contracts` provenance 注入；当前 `runtime_activated=false`。

## 3. 启动顺序

```text
process environment
  → parseApiRuntimeConfig（精确 profile / auth / bind / version）
  → parseApiDatabaseBootstrapConfig（私有 DSN / pool / connection/readiness timeout）
  → 任一失败：CONFIG_INVALID，pool 与 Fastify 尚未构造、零路由、零监听
  → 成功：创建一个 pg.Pool → ServiceRepository → createApiApp
  → 注册 GET /health 与 GET /ready
  → listen(127.0.0.1)
  → close / startup failure → 幂等 pool.end()
```

`GET /health` 是 event-loop liveness，不访问 DB 或外部依赖，也不返回 profile、auth、合同 ID 或依赖细节。响应在发送前通过冻结的 `HealthResponse` component validator。Fastify 的自动 HEAD 派生已关闭，`HEAD /health` 与其它未声明 method 均返回 404。

`GET /ready` 每次最多执行一条只读 SQL：database 表示连接与查询是否成功；schema 核对 PostgreSQL 15、冻结 `schema.v1.12` comment，以及 search 与七个传递函数、两个可信视图组成的 10 项确定性定义清单 SHA-256。`digest(bytea,text)` 还必须保持 `pgcrypto` extension 成员且 owner 等于 extension owner。真实登录账号必须无特权、仅属于 `app_runtime` 且没有 `ADMIN OPTION`，也不得被其它角色继承；`app_runtime` 与 `cs_ai_definer` 本身必须保持 NOLOGIN、无 superuser / create / replication / bypass-RLS 特权，definer 既不得继承其它角色，也不得被其它角色继承。探针对当前数据库 owner/危险 ACL、全部非系统 schema、表、列、类型、函数、default ACL 与 parameter ACL 做运行时投影：`app_runtime` 的授权必须与冻结清单精确一致，`session_replication_role` 必须为 `origin`，登录账号或 PUBLIC 的额外直接权限、对象归属、缺失/额外/可转授权权限均失败关闭，包括 PUBLIC 或任意非 owner 角色的 schema CREATE 与 `proacl=NULL` 隐含的默认函数 EXECUTE。并发请求共享同一个在途探针，达到独立 readiness deadline 后统一失败关闭；timer 与单调时钟成功路径共同阻止 event-loop stall 后的迟到假绿，且只产生一次 deadline 诊断。底层查询真正结束前不会继续放大连接，结束后立即允许新探针，不使用 TTL 绿灯缓存。针对 `pg-pool` 的连接超时竞争，production pool verify 会把在 connection deadline 当时或之后才完成的连接拒绝并销毁。auth、storage、content 在 M1/M2 前固定为 `not_ready`。五项全为 `ok` 才返回合同 `ReadyResponse` / 200；否则返回 `NotReadyResponse` / 503、`Retry-After: 1` 与 `Cache-Control: no-store`。因此 W5 正常连库时仍是 503，这是真实未就绪，不是故障误报。

API startup 不运行 migration，也不读取私有 migration ledger。schema 安装与 1,399 项完整数据库后验仍由 W4 `@customer-agent/database` 的 migration-owner 控制面负责；W5 只重复请求路径必须实时证明的 runtime ACL 投影，pool 仅持有 runtime login。

## 4. 失败输出

配置失败统一为五段式 `CONFIG_INVALID`：Problem、Cause、Fix、Docs、Diagnostic。Cause 只能由字段名和稳定 reason 构成，禁止拼入输入值或原始异常消息。配置通过后若监听阶段失败，则改用 `STARTUP_FAILED`；已知本机资源错误归一为 `listen_address_in_use`、`listen_permission_denied`、`listen_address_unavailable`、`process_file_limit_reached` 或 `system_file_limit_reached`，其它错误为 `unclassified_startup_failure`。运行中 DB/query/idle-client/超时异常只降级 database/schema readiness，不进入 HTTP 正文；内部仅记录固定 runtime diagnostic code 与合法五位 PostgreSQL SQLSTATE，不记录 DSN、SQL 或异常 message。idle client 已由 pool 淘汰时只记诊断，下一次请求执行真实新探针，不额外制造一次假故障。SIGINT/SIGTERM 后若关闭失败则输出 `SHUTDOWN_FAILED` 与受控 signal reason，不静默吞错。所有路径都不回显原始异常正文或环境值，Diagnostic 只关联单次失败，不暗示已有外部日志系统。

当前稳定 reason：

- `missing`
- `invalid`
- `profile_not_service`
- `profile_not_available`
- `auth_mode_not_available`
- `external_bind_not_allowed`

后续配置项必须继续由同一解析边界拥有；M1/M2 增加真实 capability 时应扩展同一 repository 语义，不能在 route 中复制 pool、SQL、secret 或 readiness 规则。若 worker/DB 出现第二个真实消费者，再评估是否抽为共享包，不为目录整齐预建转发层。
