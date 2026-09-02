# Application API 启动配置与拒启矩阵

本页是 `DEV-M0-W3` 当前可执行 API 配置的 SSOT。产品化总路线继续由获批计划拥有；本页不授权数据库、真实身份、真实数据、部署或 runtime activation。

## 1. 单一 profile

唯一 profile 键是 `CUSTOMER_AGENT_PROFILE`。允许值固定为：

`demo | formal-dev | test | single-host | multi-instance | production`

当前 W3 可启动集合只有 `formal-dev | test`。不得用 `NODE_ENV` 或多个布尔 flag 拼出未命名环境。

| Profile | W3 结果 | 原因 |
| --- | --- | --- |
| `demo` | 拒启 | Demo 由 `apps/desktop` 独立运行，禁止因为新增 API 骨架而暗接后端 |
| `formal-dev` | 允许 | 仅 `AUTH_MODE=mock`、loopback、`/health` |
| `test` | 允许 | 仅 `AUTH_MODE=mock`、loopback；允许端口 `0` 做 ephemeral 测试 |
| `single-host` | 拒启 | DB、storage、auth、readiness 与部署门尚未闭合 |
| `multi-instance` | 拒启 | 共享存储、并发、worker 与 readiness 尚未闭合 |
| `production` | 拒启 | Feishu auth、DB、storage、runtime activation 与部署均未放行 |

`AUTH_MODE=feishu` 当前同样拒启。W3 不通过“接受配置但不注册鉴权”的方式伪造正式能力。

## 2. 当前变量

| 变量 | 规则 | 是否进入公开响应/错误 |
| --- | --- | --- |
| `CUSTOMER_AGENT_PROFILE` | 必填；必须是上表精确值 | 只输出字段名和稳定拒绝原因 |
| `AUTH_MODE` | 必填；W3 只接受 `mock` | 只输出字段名和稳定拒绝原因 |
| `CUSTOMER_AGENT_API_HOST` | 可省略，固定默认 `127.0.0.1`；其它值拒启 | 不回显原值 |
| `CUSTOMER_AGENT_API_PORT` | formal-dev 默认 `3100`；两者范围均为 `1024..65535`，test 另可用 `0` 做 ephemeral 监听 | 不回显非法原值 |
| `CUSTOMER_AGENT_BUILD_VERSION` | 可省略，默认 `dev-m0`；1–64 位安全版本字符 | 仅合法值进入 `/health.version` |

解析结果不保留环境对象，也不包含 Feishu secret、DSN 或 storage 凭证。合同来源由 `@customer-agent/contracts` provenance 注入；当前 `runtime_activated=false`。

## 3. 启动顺序

```text
process environment
  → parseApiRuntimeConfig（精确 profile / auth / bind / version）
  → 失败：CONFIG_INVALID，Fastify 尚未构造、零路由、零监听
  → 成功：createApiApp
  → 只注册 GET /health
  → listen(127.0.0.1)
```

`GET /health` 是 event-loop liveness，不访问 DB 或外部依赖，也不返回 profile、auth、合同 ID 或依赖细节。响应在发送前通过冻结的 `HealthResponse` component validator。Fastify 的自动 HEAD 派生已关闭，`HEAD /health` 与其它未声明 method 均返回 404。

`/ready` 必须在 DB/schema/auth/storage/content 五项检查都有真实实现后再注册；当前返回 404 不是 readiness PASS。

## 4. 失败输出

配置失败统一为五段式 `CONFIG_INVALID`：Problem、Cause、Fix、Docs、Diagnostic。Cause 只能由字段名和稳定 reason 构成，禁止拼入输入值或原始异常消息。配置通过后若监听阶段失败，则改用 `STARTUP_FAILED`；已知本机资源错误归一为 `listen_address_in_use`、`listen_permission_denied`、`listen_address_unavailable`、`process_file_limit_reached` 或 `system_file_limit_reached`，其它错误为 `unclassified_startup_failure`。SIGINT/SIGTERM 后若关闭失败则输出 `SHUTDOWN_FAILED` 与受控 signal reason，不静默吞错。所有路径都不回显原始异常正文或环境值，Diagnostic 只关联单次失败，不暗示已有外部日志系统。

当前稳定 reason：

- `missing`
- `invalid`
- `profile_not_service`
- `profile_not_available`
- `auth_mode_not_available`
- `external_bind_not_allowed`

后续配置项必须继续由同一解析边界拥有；若 worker/DB 出现第二个真实消费者，再评估是否抽为共享包，不为目录整齐预建转发层。
