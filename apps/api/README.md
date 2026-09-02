# `@customer-agent/api`

本包是 `DEV-M0-W3` 的正式 Application API 启动骨架。它当前只证明一件事：受控配置通过后，Node 24 可以在本机 loopback 上启动 Fastify，并按冻结 OpenAPI 返回合同有效的 `GET /health`。

当前不是业务 API：

- 只允许 `CUSTOMER_AGENT_PROFILE=formal-dev|test`、`AUTH_MODE=mock` 和 `127.0.0.1`。
- `demo` 属于桌面合成运行链，不允许启动本服务。
- `single-host`、`multi-instance`、`production` 与 `AUTH_MODE=feishu` 尚未具备依赖，监听前失败关闭。
- `/ready`、`/v1/*`、PostgreSQL、migration、storage、OAuth、真实数据、桌面 adapter 和 runtime activation 都未实现。
- 启动失败只输出稳定字段与原因，不回显环境变量值、token、DSN 或异常正文。

配置合同与拒启矩阵见 [`docs/reference-api-runtime-config.md`](../../docs/reference-api-runtime-config.md)。

## 本地运行

```bash
CUSTOMER_AGENT_PROFILE=formal-dev \
AUTH_MODE=mock \
CUSTOMER_AGENT_BUILD_VERSION=dev-m0-w3 \
pnpm dev:api
```

默认只监听 `127.0.0.1:3100`。验证：

```bash
curl --fail --silent http://127.0.0.1:3100/health
```

预期响应只包含：

```json
{"status":"ok","service":"cs-ai-api","version":"dev-m0-w3"}
```

## 验证

```bash
pnpm test:api
pnpm typecheck
pnpm build
pnpm workspace:check
```

测试使用 Fastify `inject()` 与一次真实 ephemeral loopback 监听；不访问网络服务、数据库或真实数据。
