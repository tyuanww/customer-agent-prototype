# Application API 启动配置与拒启矩阵

本页是 `DEV-M0-W3～W5` 基线与 `DEV-M1-W0～W5` 当前可执行 API 配置的 SSOT。产品化总路线继续由获批计划拥有；本页记录本机 mock-auth / T1 合成产品会话、runtime/admin/auth capability pool、Search + Events 与密钥启动边界，不授权真实身份、真实数据、桌面接线、部署或 runtime activation。

`G1A-E0` 位于 `apps/api/tests/support/g1a-e0/`，只在显式测试进程中使用一次性 PostgreSQL 15；它不注册 API 路由、不读取本页的运行配置，也不进入 `apps/api/dist`。

## 1. 单一 profile

唯一 profile 键是 `CUSTOMER_AGENT_PROFILE`。允许值固定为：

`demo | formal-dev | test | single-host | multi-instance | production`

当前可启动集合只有 `formal-dev | test`。不得用 `NODE_ENV` 或多个布尔 flag 拼出未命名环境。

| Profile | 当前结果 | 原因 |
| --- | --- | --- |
| `demo` | 拒启 | Demo 由 `apps/desktop` 独立运行，禁止因为新增 API 骨架而暗接后端 |
| `formal-dev` | 允许 | 仅 `AUTH_MODE=mock`、loopback、`/health`、`/ready`、mock auth/policy 与 synthetic-only Search + Events；使用私有 runtime/admin pool |
| `test` | 允许 | 同上；允许端口 `0` 做 ephemeral 测试 |
| `single-host` | 拒启 | DB、storage、auth、readiness 与部署门尚未闭合 |
| `multi-instance` | 拒启 | 共享存储、并发、worker 与 readiness 尚未闭合 |
| `production` | 拒启 | Feishu auth、DB、storage、runtime activation 与部署均未放行 |

`AUTH_MODE=feishu` 当前同样拒启。服务不通过“接受配置但不注册鉴权”的方式伪造正式能力。

## 2. 当前变量

| 变量 | 规则 | 是否进入公开响应/错误 |
| --- | --- | --- |
| `CUSTOMER_AGENT_PROFILE` | 必填；必须是上表精确值 | 只输出字段名和稳定拒绝原因 |
| `AUTH_MODE` | 必填；当前只接受 `mock`，表示合成身份来源 | 只输出字段名和稳定拒绝原因 |
| `AUTH_SESSION_MODE` | 可省略或 `mock` 保留进程内合成登录；`product` 显式启用持久产品会话。其它值、未选择 product 却提供产品身份配置均拒启 | 合法 product 模式可进入公开 config |
| `AUTH_DATABASE_URL` | product 必填；独立无特权登录账号仅属于 app_backend_auth，与 runtime/admin 同库且登录名不同 | 仅私有 bootstrap |
| `AUTH_DB_POOL_MAX` | product 默认 2；runtime 此时默认 16，admin 默认 2；三个池合计最多 20 | 不进入公开 config |
| `SYNTHETIC_IDENTITY_PROVIDER_ORIGIN` | product 必填；精确 http://127.0.0.1:port，无凭据、路径、query 或 fragment；只允许本机合成提供方 | 不回显原值 |
| `CUSTOMER_AGENT_API_HOST` | 可省略，固定默认 `127.0.0.1`；其它值拒启 | 不回显原值 |
| `CUSTOMER_AGENT_API_PORT` | formal-dev 默认 `3100`；两者范围均为 `1024..65535`，test 另可用 `0` 做 ephemeral 监听 | 不回显非法原值 |
| `CUSTOMER_AGENT_BUILD_VERSION` | 可省略，默认 `dev-m0`；1–64 位安全版本字符 | 仅合法值进入 `/health.version` |
| `DATABASE_URL` | 必填；runtime 登录 DSN，只接受 loopback PostgreSQL URL、非空登录名与数据库路径；不得带 fragment 或驱动控制参数 | 只保留在私有 bootstrap config，不回显原值 |
| `CONTENT_ADMIN_DATABASE_URL` | 必填；独立 `app_content_admin` 登录 DSN，格式同上；DSN/登录名必须与 runtime 不同，但解析后的精确 host/port/database 目标必须相同（不把 `localhost` 与 `127.0.0.1` 猜成同一实例） | 同上 |
| `DB_POOL_MAX` | 可省略，runtime 默认 `18`（product 会话模式为 `16`）；只接受 `1..20` 正整数 | 不进入公开 config 或响应 |
| `CONTENT_ADMIN_DB_POOL_MAX` | 可省略，admin 默认 `2`；只接受 `1..20`，且所有启用的 pool 合计不得超过 `20` | 同上 |
| `DB_CONNECTION_TIMEOUT_MS` | 可省略，默认 `2000`，范围 `1..10000`；只约束连接获取 | 不进入公开 config 或响应 |
| `DB_READINESS_TIMEOUT_MS` | 可省略，默认 `2000`，范围 `1..10000`；约束 readiness 响应、query timeout 与 statement timeout | 不进入公开 config 或响应 |
| `IDEMPOTENCY_HMAC_KEYS` | 必填；JSON object，1–4 个 `hmac-*` 版本映射到 32–128 UTF-8 byte 的私有密钥材料 | 不回显、不记录 |
| `IDEMPOTENCY_HMAC_CURRENT_VERSION` | 必填；必须命中上述 key ring；历史版本仅为 TTL 内重放保留 | 只存在于私有 bootstrap config |
| `LOG_HASH_KEY` | 必填；32–128 UTF-8 byte，只用于脱敏 query 指纹；不得复用任何幂等密钥 | 不回显、不记录 |
| `LOG_HASH_KEY_VERSION` | 必填；独立 `hmac-*` 版本 | 只存在于私有 bootstrap config |

公开解析结果不保留环境对象，也不包含 Feishu secret、DSN、HMAC 或 storage 凭证。私有 bootstrap config 只在 composition root 中分别进入 repository/后续 service factory，不进入 `StartedApi.config`、日志或 HTTP。合同来源由 `@customer-agent/contracts` provenance 注入；当前 `runtime_activated=false`。

## 3. 启动顺序

```text
process environment
  → parseApiRuntimeConfig（精确 profile / auth / bind / version）
  → parseApiPrivateBootstrapConfig（两套私有 DSN / 双池总预算 / 两类 HMAC key domain）
  → 任一失败：CONFIG_INVALID，pool 与 Fastify 尚未构造、零路由、零监听
  → 成功：分别创建 runtime pg.Pool 与 policy-admin pg.Pool
  → ServiceRepository + PolicyAdminRepository → createApiApp
  → 注册 health/ready、mock auth、policy、synthetic-only search 与 events
  → listen(127.0.0.1)
  → close / startup failure → 幂等 pool.end()
```

`GET /health` 是 event-loop liveness，不访问 DB 或外部依赖，也不返回 profile、auth、合同 ID 或依赖细节。响应在发送前通过冻结的 `HealthResponse` component validator。Fastify 的自动 HEAD 派生已关闭，`HEAD /health` 与其它未声明 method 均返回 404。

`GET /ready` 每次最多执行一条只读 SQL：database 表示连接与查询是否成功；schema 核对 PostgreSQL 15、冻结 `schema.v1.15` comment，以及 search、十二个传递函数和两个可信视图组成的 15 项确定性定义清单 SHA-256；其中包含公开 Question mapper 与 ready-no-hit 上下文，因此其实现漂移也会失败关闭。`digest(bytea,text)` 还必须保持 `pgcrypto` extension 成员且 owner 等于 extension owner。runtime 登录账号必须无特权、仅属于 `app_runtime` 且没有 `ADMIN OPTION`，也不得被其它角色继承；`app_runtime` 与 `cs_ai_definer` 本身必须保持 NOLOGIN、无 superuser / create / replication / bypass-RLS 特权，definer 既不得继承其它角色，也不得被其它角色继承。探针对当前数据库 owner/危险 ACL、全部非系统 schema、表、列、类型、函数、default ACL 与 parameter ACL 做运行时投影：`app_runtime` 的授权必须与冻结清单精确一致，`session_replication_role` 必须为 `origin`，登录账号或 PUBLIC 的额外直接权限、对象归属、缺失/额外/可转授权权限均失败关闭。并发请求共享同一个在途探针，不使用 TTL 绿灯缓存。`GET /v1/policy` 在读取 flag 的同一条 SQL 内重复这套证明，因此 readiness 变红时不会继续放行业务读。auth 当前由 mock service 真实返回 `ok`；storage、content 在后续里程碑前仍固定为 `not_ready`，所以当前正常连库仍返回 503。

`POST /v1/policy/flags` 只有服务端已验证的 Owner 可进入管理 repository；`rewrite=true` 与 `auto_send=true` 在选择管理 pool 前即返回 403。管理 pool 每次写入在同一 SQL 内证明登录账号无特权且是 `app_content_admin` 的唯一直接非管理成员、不继承 `app_runtime`、不被其它角色继承；能力角色和 `cs_ai_definer` 必须保持 NOLOGIN、无特权和封闭成员关系。随后还会核对 `set_policy_flag` 的 owner、SECURITY DEFINER、search_path、volatility、精确 ACL 和确定性定义指纹，全部成立才调用该唯一写入口。runtime 登录直接调用函数得到 42501；混合角色、额外管理成员、反向继承或函数漂移均失败关闭。连接失败、资源不足、锁不可用、查询取消/超时和数据库关闭归一为带 `Retry-After` 的 503，其它未知数据库失败保持稳定、无敏感信息的 500。两个 pool 都在 Fastify close 或启动失败时幂等关闭。Search 与 Events 已在 DEV-M1 W3/W4 接入数据库 replay/fencing、候选四元组和 first-wins 终态语义；当前只接受 synthetic，真实 collection mode 与桌面调用仍关闭。

API startup 不运行 migration，也不读取私有 migration ledger。schema 安装与完整数据库后验仍由 `@customer-agent/database` 的 migration-owner 控制面负责；API 只重复请求路径必须实时证明的 runtime/admin capability 投影。

## 4. 失败输出

配置失败统一为五段式 `CONFIG_INVALID`：Problem、Cause、Fix、Docs、Diagnostic。Cause 只能由字段名和稳定 reason 构成，禁止拼入输入值或原始异常消息。配置通过后若监听阶段失败，则改用 `STARTUP_FAILED`；已知本机资源错误归一为 `listen_address_in_use`、`listen_permission_denied`、`listen_address_unavailable`、`process_file_limit_reached` 或 `system_file_limit_reached`，其它错误为 `unclassified_startup_failure`。运行中 DB/query/idle-client/超时异常只降级 database/schema readiness，不进入 HTTP 正文；未捕获的请求异常统一返回合同化 `INTERNAL` 500。内部仅记录固定 runtime diagnostic code 与合法五位 PostgreSQL SQLSTATE，不记录 DSN、SQL、请求正文或异常 message。idle client 已由 pool 淘汰时只记诊断，下一次请求执行真实新探针，不额外制造一次假故障。SIGINT/SIGTERM 后若关闭失败则输出 `SHUTDOWN_FAILED` 与受控 signal reason，不静默吞错。所有路径都不回显原始异常正文或环境值，Diagnostic 只关联单次失败，不暗示已有外部日志系统。

当前稳定 reason：

- `missing`
- `invalid`
- `profile_not_service`
- `profile_not_available`
- `auth_mode_not_available`
- `external_bind_not_allowed`

后续配置项必须继续由同一解析边界拥有；M1/M2 增加真实 capability 时应扩展同一 repository 语义，不能在 route 中复制 pool、SQL、secret 或 readiness 规则。若 worker/DB 出现第二个真实消费者，再评估是否抽为共享包，不为目录整齐预建转发层。


## 5. T1 合成产品会话边界

仍只允许 formal-dev/test 与 loopback，不激活 single-host/production profile。product 会话的实际启动需要非零 API 端口，提供方 callback 固定为该端口的 `/v1/auth/callback`。启动组合必须显式提供产品身份服务；默认 mock 服务不能满足此条件。数据库身份查询和所有现有业务路由统一异步认证；数据库失败为 503，不转成 mock 成功或“密码错误”。

产品身份模块拥有独立 auth pool，连接等待沿用共享配置，SQL statement/query 上限 3s/3.5s；每次事务先核对无特权登录和唯一能力角色，再 SET LOCAL ROLE app_backend_auth。它不向客户端暴露数据库角色，不直接读取身份私表。提供方只允许本机合成 wire，单次交换 5s 可取消、响应最多 4096 bytes、拒绝重定向和非 synthetic 收据。关闭时取消提供方请求并关闭所有能力池。

登录请求最长 5 分钟，会话绝对有效期 15 分钟，不自动续期。callback 先消费 state 再交换提供方 code，不把数据库事务跨越网络 I/O；中断时请求等待到期并重新登录。兑换、会话创建与消费由冻结 SQL 原子完成，响应丢失不重放 bearer。每次鉴权检查当前绑定、角色、禁用和过期；重复 logout 无副作用。新身份路由统一 no-store、封闭 CandidateError；HTML 完成页不回显任何提供方输入。

本轮单主机合成限流为每进程每分钟 create/callback/exchange/logout 分别 20/40/120/120 次，采用四个固定窗口，不创建客户端可控的无限键表。该预算不声称跨进程或重启持久化限流；运行部署前需专项政策。审核/worker/发布仍待后续切片，storage/content 不据 T1 成功变绿。
