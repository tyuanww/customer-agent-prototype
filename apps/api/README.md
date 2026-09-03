# `@customer-agent/api`

本包是 Application API 运行时。受控配置通过后，Node 24 会在本机 loopback 启动 Fastify；`GET /health` 证明进程存活，`GET /ready` 通过私有 runtime `pg.Pool` 核对 PostgreSQL 15、冻结 `schema.v1.13` 指纹、受控检索依赖清单与 runtime/definer/parameter 有效权限边界。DEV-M1 Slice 1 另提供仅限 development/test 的 mock auth、策略只读路由，以及通过独立 admin pool 执行的 Owner-only 策略写入口。

当前不是业务 API：

- 只允许 `CUSTOMER_AGENT_PROFILE=formal-dev|test`、`AUTH_MODE=mock` 和 `127.0.0.1`。
- `demo` 属于桌面合成运行链，不允许启动本服务。
- `single-host`、`multi-instance`、`production` 与 `AUTH_MODE=feishu` 尚未具备后续依赖，监听前失败关闭。
- `/health` 不访问数据库；`/ready` 只把 database/schema/auth 的真实结果写入合同响应。
- auth 已由当前 mock service 返回 `ok`；storage/content 尚未实现，因此 `/ready` 正常结果仍是 503，而不是业务已可用。
- 当前仅注册 `/v1/auth/mock-login`、`/v1/auth/me`、`/v1/policy` 与 `/v1/policy/flags`；search/events、migration 自动执行、storage、OAuth、真实数据、桌面 adapter 和 runtime activation 都未实现。
- 启动与 readiness 失败只输出稳定字段，不回显环境变量值、token、DSN、SQL 或异常正文。
- 同一时刻只运行一个 readiness 探针；连接等待与 readiness 响应分别由 `DB_CONNECTION_TIMEOUT_MS`、`DB_READINESS_TIMEOUT_MS` 控制，timer 与单调时钟都会拒绝 deadline 后才完成的成功结果。
- schema 探针锁定 9 个 search/传递函数、2 个视图、`pgcrypto.digest` extension owner、双向角色成员与当前数据库/全部用户 schema 的精确有效 ACL；任意非 owner 的 `public CREATE` 失败关闭。
- W5 只接受 `127.0.0.1`、`localhost` 或本机 Unix socket PostgreSQL；任意远程或括号 IPv6 DSN 均在建池前拒绝，托管数据库/TLS 属于后续部署设计。

配置合同与拒启矩阵见 [`docs/reference-api-runtime-config.md`](../../docs/reference-api-runtime-config.md)。

## 本地运行

先准备一个已应用十段 migration 的本机隔离 PostgreSQL 15 数据库，并分别提供属于 `app_runtime` 与 `app_content_admin` 的两个登录角色。连接串和 HMAC key 只通过本机环境注入，不写入仓库：

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
pnpm typecheck
pnpm build
pnpm workspace:check
```

普通 API 测试使用 Fastify `inject()`、fake pool 与一次真实 ephemeral loopback 监听，不要求 PostgreSQL。显式 integration 会通过 `@customer-agent/database/testkit` 创建并清理隔离的临时 PostgreSQL 15 cluster，只使用合成空库；不会连接共享数据库或真实数据。该 testkit 只供仓内测试，不进入 API 生产请求路径。
