# DEV-M0-W5 runtime adapter / service readiness 执行记录

> **文档状态：** `APPROVED · EXECUTION RECORD`
> **切片状态：** `REVIEW FIX CANDIDATE · IMPLEMENTED · VALIDATED · AWAITING REVIEW FIX COMMIT AUTHORIZATION`
> **开工输入：** 用户于 2026-09-03 明确给出“`DEV-M0-W5` 开工”；该授权覆盖 W5 本地分支、实现与验证，不包含提交、推送、PR、合并、真实数据、飞书运行接入、部署或生产
> **基线：** `origin/main` / `33c40b86504e205e37d92d915405ae55be34c361`
> **分支：** `codex/dev-m0-w5-runtime-readiness`
> **PR：** `#14`；Review 修复基线 `981ab403`
> **边界：** 不注册 `/v1/*`，不接 desktop，不运行 migration，不读取真实客户或飞书数据，不部署、不发布、不激活 runtime

## 1. 交付结果

W5 在既有 Application API 内新增一个深的 `ServiceRepository`：它独占一个 `pg.Pool`、runtime-safe schema 指纹、single-flight deadline、错误归一化与幂等关闭。Fastify route 只消费五项 readiness 状态，不知道 SQL、DSN 或 pool。

- `GET /health` 继续只证明 event loop 存活，不访问数据库。
- `GET /ready` 每次最多执行一条只读 SQL，并以冻结 OpenAPI 的 `ReadyResponse` / `NotReadyResponse` validator 约束输出。
- database/schema 根据真实连接与 schema/ACL 探针返回；auth/storage/content 在 M1/M2 前固定 `not_ready`。
- 并发 readiness 共享同一在途查询；超时后在底层查询真正结束前不创建下一条探针。响应 timer 与单调时钟成功路径共同守住 deadline，event loop 阻塞后才返回的“成功”也会失败关闭且只记一次诊断；连接若在 connection deadline 当时或之后迟到成功会由 production pool verify 拒绝，idle client 被 pool 淘汰后只记脱敏诊断并真实复探。
- 因三项后续能力尚未实现，W5 正常状态仍返回 503、`Retry-After: 1` 与 `Cache-Control: no-store`，不会制造“业务全绿”。
- `HEAD` / `POST` 不自动获得路由，`/v1/*` 继续 404。

## 2. 运行时信任边界

```text
process environment
  ├─ public config ───────────────────────────┐
  └─ private DB bootstrap config              │
            │                                 │
            ▼                                 ▼
       one pg.Pool ──> ServiceRepository ──> Fastify
            │              │                  ├─ /health（零依赖）
            │              └─ readiness() ────└─ /ready（合同响应）
            └─ pool.end() <──── onClose / startup-failure fallback
```

私有配置只包含 `connectionString`、pool 上限与两个分离 timeout，不进入 `StartedApi.config`、日志、HTTP 或稳定错误文本。API startup 不导入或调用 W4 migration runner；migration-owner 与 runtime pool 仍是两个能力边界。测试通过显式 `@customer-agent/database/testkit` 子入口复用临时 PG15 harness，生产 API 不导入该入口。

探针核对：

1. 数据库查询成功；
2. PostgreSQL major 为 15；
3. `public` schema comment 以当前 `schema.v1.12` 指纹开头；
4. `search_recommendable_scripts(text,text,text)` 存在；
5. 真实登录账号可登录但无 superuser / create / replication / bypass-RLS 特权，只继承 `app_runtime` 且没有 `ADMIN OPTION`；禁止同时属于任何额外角色，也禁止其它角色继承该登录账号；`app_runtime` 与 `cs_ai_definer` 本身必须保持 NOLOGIN 与同一组无特权属性，definer 不得继承其它角色，也不得有任何入向成员；
6. 当前数据库不得由 runtime/login/definer 持有或向其授予危险 CREATE/TEMP 权限；`app_runtime` 在全部非系统 schema 的表、列和函数 ACL 必须与 W4 冻结投影精确一致，且不能成为 schema/object/type 的 owner。登录账号或 PUBLIC 不得获得额外直接 ACL/owner；`public` schema 也不得向任何非 owner 角色授予 CREATE。危险 default ACL 与 parameter ACL 均失败关闭，当前 `session_replication_role` 必须为 `origin`；
7. 受控 search 函数保持 SECURITY DEFINER、固定 search_path、STABLE 与仅向 `app_runtime` 授予的非转授权 EXECUTE；search 与七个传递函数依赖，加上 `v_release_source_gate`、`v_scripts_recommendable`，共同形成 8 个函数 + 2 个视图的 10 项确定性定义摘要。`digest(bytea,text)` 还必须继续是 `pgcrypto` extension 成员且 owner 与 extension owner 相同；任一依赖替换或所有权脱离均失败关闭。

它不读取私有 migration ledger、`content_current` 或其它 SoR 表，也不调用 search、lease、publish 等业务函数。

## 3. 配置与生命周期

| 变量 | 规则 |
| --- | --- |
| `DATABASE_URL` | 必填且仅允许 `127.0.0.1`、`localhost` 或本机 Unix socket 的 PostgreSQL URL；远程、括号 IPv6 与驱动控制 query 参数拒启，只存于私有 bootstrap config；Unix-socket `host`/`port` 仅供隔离测试 |
| `DB_POOL_MAX` | 默认/上限 `20`，正整数 |
| `DB_CONNECTION_TIMEOUT_MS` | 默认 `2000`，范围 `1..10000` ms；只约束连接获取 |
| `DB_READINESS_TIMEOUT_MS` | 默认 `2000`，范围 `1..10000` ms；约束 readiness 响应/query/statement |

公开 profile 仍只允许 `formal-dev|test + AUTH_MODE=mock + 127.0.0.1`。公开配置和私有 DB 配置都在 repository / Fastify 构造前完成；任一非法值都以 `CONFIG_INVALID` 失败关闭。成功启动后 Fastify `onClose` 释放 pool；构造或监听失败还会执行幂等 fallback close，并保留最初的启动错误。

## 4. 验证结果

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @customer-agent/api test` | PASS；25 passed + 1 个显式 PG15 scenario skipped；另有 package/main 两个 compiled Node smoke，覆盖 `/health`、失败关闭的 `/ready` 与 SIGINT |
| `pnpm --filter @customer-agent/api test:integration` | PASS；`tests/app.test.ts` 18/18，其中 1 个真实 PG15 scenario 连续变异并复原 runtime/schema/ACL 边界；额外/反向角色成员、`ADMIN OPTION`、definer 入向成员、login/runtime/definer superuser、parameter SET + `session_replication_role=replica`、缺失或额外表/列/管理函数授权、登录账号列级直授、当前 DB/runtime object/第三 schema 归属或授权、PUBLIC 或任意非 owner 角色的 schema CREATE、默认函数 EXECUTE，以及 search/全部传递函数体、owner/search_path/volatility/SECURITY DEFINER/extension membership 漂移均失败关闭；runtime 在无误授时直读 `content_current` 仍以 SQLSTATE `42501` 拒绝 |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS；contracts、database、API、desktop 四包 |
| `pnpm test` | PASS；567 passed + 1 个显式 PG15 scenario skipped，另有 contracts/database/API 4 个 compiled-package Node smoke；普通 lane 不强制 PG15 |
| `pnpm build` | PASS；合同 132 schemas、数据库 9 migrations 与四包构建 |
| `pnpm workspace:check` | PASS；source budget 与 root policy 均通过 |
| `pnpm contracts:verify` | PASS；`VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`、`runtime_activated=false` |
| `codegraph status --json` + 定向语义查询 | PASS；`pendingChanges=0`、`worktreeMismatch=null`、`reindexRecommended=false`，W5 config → pool → repository → `/ready` 链路可追踪 |
| `git diff --check` | PASS |

显式 PG15 integration 每次创建独立临时 data directory、Unix socket、数据库与无密码测试角色，完成后停止 cluster 并清理；不连接共享本机或生产数据库。普通 API 测试使用 fake pool、Fastify `inject()` 与一次 ephemeral loopback 监听。

## 5. 未运行与未放行

未运行 Electron E2E、桌面打包、真实数据、飞书 OAuth、共享/托管 PostgreSQL、备份恢复、部署或设备验证。W5 不改变桌面代码或 UI，也没有这些运行面和授权。

W5 不表示 auth/storage/content、九业务端口、真实 adapter 或 Pilot 已可用；`runtime_activated=false` 保持不变。下一步是在 W5 Git 生命周期完成后形成 DEV-M0 退出复核，再单独评审 DEV-M1，不能由本执行记录自动放行。

## 6. Review 收口

`/plan-eng-review` 已在实现前完成，结论为 CLEAR、0 unresolved。实现后 `/review` 对 PR #14 执行核心、测试、可维护性、安全、性能与 PostgreSQL/API 合同专项复核。Review 修复进一步关闭了 event-loop stall 后的 deadline 假绿、漏列传递函数、runtime login 反向成员、任意非 owner 的 `public CREATE`、`digest` 脱离 extension owner，以及未穿透 package/main 入口的 smoke 缺口；对应确定性单测、compiled smoke 与临时 PG15 负例均已补齐。最终本地复核为 `clean`，无延后 finding；提交、推送、PR 更新与合并仍分别等待授权。
