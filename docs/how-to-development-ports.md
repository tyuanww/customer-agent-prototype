# How to 选择开发端口并运行本地服务

本页把 Mac 开发、合成产品会话和 Windows WSL 验收的端口分开。先选一种模式，再只启动这套模式的服务；不要让桌面端在同一次验证中混用不同端口。

## Prerequisites

- Node.js 24.x 与 pnpm 11.19.0。
- 仓库根目录是当前 checkout 或独立 worktree，不是 WSL 的 `/srv/customer-agent/current` 生产软链。
- 本机命令使用 Node 24：

  ```bash
  export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
  hash -r
  node -v
  pnpm -v
  ```

## 选择模式

| 模式 | 运行位置 | 端口 | 适合证明什么 | 入口 |
| --- | --- | --- | --- | --- |
| S0 桌面 fixture | Mac | 无 API 端口 | 狐狸头、Query、Dashboard 和本地合成 fixture 的 UI 行为 | `pnpm dev` |
| Mac 合成产品栈 | Mac | API `43100`、身份 `43101`、PG Unix socket 参数 `43199` | 登录、真实隔离 PG15、导入/发布、公告、检索和桌面 adapter | `scripts/synthetic-stack/stack.ts` |
| 直接 `formal-dev` API | Mac | 默认 `3100`，可由 `CUSTOMER_AGENT_API_PORT` 覆盖 | API 配置、health/ready 和路由开发；桌面不会自动接入 | `pnpm dev:api` |
| WSL 临时测试栈 | Windows 的 WSL | API `43180`、身份 `43181` | Windows 客户端验收；使用独立测试 stack root、数据库、对象目录和 systemd unit | 远端测试部署流程 |
| WSL 生产栈 | Windows 的 WSL | API `43115`、身份 `43116` | 受控试点运行 | 生产 release unit |

`43115/43116` 永远不是开发端口。WSL 测试完成后，测试服务必须停止，并确认 `43180/43181` 没有监听。`43199` 是 PostgreSQL Unix socket 的连接参数，不是对外开放的 TCP listener；不同 stack 通过不同 socket 目录隔离。

`scripts/formal-dev-up.mjs` 是带 worker 的本机专用 helper，默认 API 端口为 `43110`。它不替代 `stack.ts` 的合成 profile，也不改变 WSL 测试或生产端口；只有按照对应的数据迁移或本机 formal-dev 操作手册使用它。标准桌面开发请选择上表的 S0 或 Mac 合成产品栈。

## Steps

### 1. 运行 S0 桌面 fixture

S0 不启动 API，适合先做 UI、窗口、快捷键、复制和 Dashboard 交互：

```bash
pnpm dev
```

查询结果来自桌面内的合成 fixture。这个模式不会证明 API、PostgreSQL、身份服务或内容发布链。

### 2. 运行 Mac 合成产品栈

先看已有栈的状态：

```bash
node scripts/synthetic-stack/stack.ts status
```

没有 profile 时才启动：

```bash
node scripts/synthetic-stack/stack.ts start
```

`start` 会初始化隔离的 PostgreSQL 15、身份服务、API、worker，并在需要时播种合成目录。已有冻结发布（例如 `rel_6`）时不要再次 `start`，它可能产生新的合成 release；使用 `status`，并按 [macOS 语义检索 How-to](how-to-run-macos-semantic-query.md) 处理 hydrate。

把当前 profile 的两个 origin 交给开发态桌面：

```bash
CUSTOMER_AGENT_DESKTOP_API_ORIGIN=http://127.0.0.1:43100 \
CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN=http://127.0.0.1:43101 \
pnpm dev
```

如果使用自定义 `CUSTOMER_AGENT_STACK_ROOT`，端口可能按 stack root 偏移。以 `stack.ts status` 输出的 origin 为准，不要手写默认端口覆盖它。

### 3. 只开发 API 配置或路由

直接启动 API 时，使用 `formal-dev` profile 和本机隔离 PostgreSQL 的两套登录与私有 key：

```bash
CUSTOMER_AGENT_PROFILE=formal-dev \
AUTH_MODE=mock \
DATABASE_URL="${DATABASE_URL:?set runtime DSN}" \
CONTENT_ADMIN_DATABASE_URL="${CONTENT_ADMIN_DATABASE_URL:?set admin DSN}" \
IDEMPOTENCY_HMAC_KEYS="${IDEMPOTENCY_HMAC_KEYS:?set private key ring}" \
IDEMPOTENCY_HMAC_CURRENT_VERSION="${IDEMPOTENCY_HMAC_CURRENT_VERSION:?set key version}" \
LOG_HASH_KEY="${LOG_HASH_KEY:?set separate private log key}" \
LOG_HASH_KEY_VERSION="${LOG_HASH_KEY_VERSION:?set log key version}" \
pnpm dev:api
```

默认检查地址是 `http://127.0.0.1:3100`：

```bash
curl --fail --silent http://127.0.0.1:3100/health
curl --silent --include http://127.0.0.1:3100/ready
```

需要换端口时，同时设置 `CUSTOMER_AGENT_API_PORT`，并把 curl 地址改成同一个端口。完整变量、拒启原因和数据库边界见 [API 启动配置](reference-api-runtime-config.md)。

### 4. 在 WSL 做临时验收

从远端开发与交付流程创建独立的测试栈，让 Windows 客户端只指向 `43180/43181`。检查必须在 WSL 内执行：

```bash
ss -ltnp | rg ':43180|:43181'
curl --fail --show-error --max-time 5 http://127.0.0.1:43180/ready
```

验收结束后停止测试 unit，再确认端口已释放：

```bash
ss -ltnp | rg ':43180|:43181' || true
```

不要把 Mac 的 `127.0.0.1` 当成 WSL 远端地址，也不要把测试客户端改成生产 `43115/43116`。systemd、stack root、数据库和回滚边界见 [远端开发与交付](how-to-remote-development-and-deployment.md) 和 [运行环境与发布目录参考](reference-runtime-ports-and-release-layout.md)。

## Verification

按目标检查，不要用一个模式的通过结果代替另一个模式：

| 目标 | 检查 |
| --- | --- |
| S0 UI | `pnpm dev` 后按 [第一次运行](tutorial-first-run.md) 走狐狸头 → 查询 → 复制 |
| Mac 合成链 | `stack.ts status` 显示 API / identity / PostgreSQL 就绪；再运行桌面合成栈 E2E |
| 直接 API | 对同一端口请求 `/health` 和 `/ready`；`health` 只证明进程存活，`ready` 才检查依赖 |
| WSL 测试 | `43180/43181` 只在验收期间监听，测试结束后无监听；生产 `43115/43116` 仍 ready |

文档或命令有变时运行：

```bash
pnpm docs:check
git diff --check
```

## Troubleshooting

| 现象 | 处理 |
| --- | --- |
| `ERR_PNPM_NO_SCRIPT` 或 `Missing script` | 运行 `pnpm help:dev`，不要猜 `serve` 或 `desktop` |
| `43100` 或 `43101` 被占用 | 先运行 `stack.ts status`；停止属于当前 stack 的进程，或为另一套合成栈设置新的 `CUSTOMER_AGENT_STACK_ROOT` |
| 查询提示「内容已变化，请重新查询」 | 先确认仍在使用 `43100/43101` 对应的 profile，再点胶囊「登录」回写 hydrate；不要为解决它重新 `stack start` |
| 桌面登录不了 | 检查 API origin 和 identity origin 是否来自同一个 profile，且各自是 loopback origin；不要把 `3100`、`43100`、`43110` 混在一套桌面环境里 |
| WSL 验收结束后仍有测试端口 | 停止测试 unit，重新检查 `ss -ltnp`；生产端口不受测试停止影响 |

## Related

- [运行环境、端口与发布目录参考](reference-runtime-ports-and-release-layout.md)
- [为什么开发、测试和生产要分开](explanation-environment-boundaries.md)
- [How to 启动 macOS 语义检索开发浮窗](how-to-run-macos-semantic-query.md)
- [How to 从远端仓库开发、测试并交付](how-to-remote-development-and-deployment.md)
