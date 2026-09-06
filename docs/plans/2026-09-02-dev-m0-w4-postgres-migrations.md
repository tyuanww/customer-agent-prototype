# DEV-M0-W4 PostgreSQL migration 控制面执行记录

> **当前进度入口：** 本页保存形成时的计划、批准范围或证据，不维护最新进度；当前动作统一见[执行清单](2026-09-06-execution-goal.md)。已批准范围继续有效，历史状态不覆盖新的具体授权与实测。

> **文档状态：** `EXECUTION RECORD`
> **切片状态：** `RELEASE CANDIDATE · VALIDATED`
> **开工与 Git 输入：** 用户于 2026-09-02 明确要求“开始启动下一个板块，我给你授权，全部一个个开始做”；该授权仅覆盖 W4 实现、验证、Review、提交、推送、PR、合并与候选分支清理
> **基线：** `origin/main` / `61d194747b75afdca752daa295b98cce4b24019c`
> **分支：** `codex/dev-m0-postgres-migrations`
> **边界：** 不启动 W5，不接 API / desktop，不读取真实客户或飞书数据，不部署、不发布、不激活 runtime

## 1. 交付结果

W4 新增 `@customer-agent/database` 深模块，把冻结 DDL 的来源切分、不可变 catalogue、合法前缀规划、私有账本、session advisory lock、逐 migration 事务、稳定错误与后验核验收进一个边界。包本身不读环境变量、不创建连接；调用方只能传入一个已连接且具备 migration-owner 权限的 `pg.Client`。

公共入口只提供：

- `inspectDatabaseMigrations()`：读取并验证 `FRESH / PARTIAL / COMPLETE`；未知 id、gap、checksum 或 provenance 漂移失败关闭。
- `planDatabaseMigrations()`：只返回合法前缀之后的缺失后缀元数据，不公开内嵌 SQL。
- `applyDatabaseMigrations()`：固定 advisory-lock key、同一 client、每段 migration 与账本行同事务，提交后在释放锁前执行完整后验。
- `verifyDatabaseMigrations()`：核对 catalogue/账本、40 表、2 视图、143 public functions、163 条 ACL 与 1,399 条 schema/表/列/约束/索引/视图/类型/扩展/owner 清单，并校验函数定义和安全属性、触发器 table/function/event/enabled、schema comment 与 5 条 hard-off policy 的精确指纹。

API、desktop、renderer 和 preload 都没有新增 database 依赖，现有 `GET /health` 也没有变成 `/ready`。
公共操作只接受真实单会话 `pg.Client`（含已 checkout 的 `PoolClient`）；裸 `Pool` 与同一 client 上的重入在任何 SQL 前失败关闭。

## 2. 不可变来源与九段 catalogue

| 项目 | 冻结值 |
| --- | --- |
| `contract_set_id` | `cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c` |
| source Git SHA | `1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38` |
| source schema SHA-256 | `47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801` |
| executable source SHA-256 | `0f4f271aa1f84a2bf59e5279c650b3b216cb11df03be2aa536293547f33baaa3` |
| source coverage | 上游 7,661 行；排除外层 `BEGIN / SET LOCAL / COMMIT` 后，第 17–7,660 行共 7,644 行完整且仅归属一次，并可逐字节重建 |
| compatibility | `N-only=PASS`；`N-1=N/A · no prior signed baseline` |

| 位置 | migration | SHA-256 |
| ---: | --- | --- |
| 1 | `0001_extensions` | `4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62` |
| 2 | `0002_identity_and_content` | `62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64` |
| 3 | `0003_events_and_metrics` | `c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4` |
| 4 | `0004_import_release_announce` | `ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a` |
| 5 | `0005_idempotency_rate_limit_outbox` | `715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02` |
| 6 | `0006_definer_functions_and_triggers` | `f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca` |
| 7 | `0007_search_bigram` | `7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189` |
| 8 | `0008_runtime_acl` | `f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2` |
| 9 | `0009_phase1_policy_seed` | `a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e` |

`customer_agent_meta.schema_migrations` 随 `0001` 在同一事务创建，不存在隐藏的 `0000` setup。它记录 migration/source 双 provenance 和执行耗时，对 `PUBLIC` 撤销 schema/table 权限；被篡改的账本不会自动修复。

生成器先把 migration/manifest 与内嵌 catalogue 两个完整目录写入同文件系统的 staging root，核对成员集合后才做目录级替换；成功发布会移除旧生成目录中的额外成员，普通 I/O 失败则逆序恢复两个旧目录。生成物不会在逐文件写入中留下已知的新旧混合状态。

## 3. PostgreSQL 15 验证矩阵

集成测试每次创建独立临时 data directory、Unix socket 和数据库，测试完成后停止 cluster 并清理；不连接或删除共享本机数据库。覆盖：

- 从空库顺序应用九段、完整后验、二次 apply no-op。
- 在读取/接管账本前拒绝非 PostgreSQL 15 server。
- 八条角色/ACL 越权负例、`ZA001`–`ZA006`、两条 `23514` 约束负例。
- 固定锁竞争和有界 timeout；锁内重新计算 plan。
- 两个独立 fresh client 竞争时只应用一次九段；同一 client 的重入直接拒绝。
- 账本 checksum 篡改，以及 table、enum、额外 schema 等无账本非空数据库拒绝接管。
- 同一 migration 字节通过瞬态 failpoint 失败、事务回滚、原 id 安全重试和 count/hash 对账。
- DDL 已执行但账本插入被故障触发器拒绝时，两者同事务回滚；移除故障后同 id 安全重试。
- `COMMIT` 已落库但客户端未收到回执：返回 `MIGRATION_COMMIT_UNKNOWN`，新会话从账本识别合法 partial 并续跑剩余八段。
- `BEGIN` 回执未知时先显式 `ROLLBACK`；若回滚也无法确认则返回 `MIGRATION_ROLLBACK_FAILED`。status、lock、rollback、verify 等驱动失败统一成稳定错误，不回显连接串或凭证。
- 在事务内逐项注入额外 PUBLIC/default grant、对象/函数 owner 漂移、函数体或 config 修改、replica-only trigger、RLS、列默认值、额外 enum/schema 和 policy key 替换，完整指纹后验全部拒绝。
- 生成物整组 staging 后发布；第二个目录交换失败时，migration 与 catalogue 两组旧内容均恢复，且不残留 staging/backup。
- PG15 二进制发现失败不会先创建临时目录；启动/停止异常仍尝试安全清理并保留组合错误。

## 4. 最终验证

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS；contracts、database、API、desktop 四包 |
| `pnpm test` | PASS；contracts 16 + database unit 18 + API 13 + desktop 508，共 555 个 Vitest tests；另有 contracts/database/API 3 个 compiled-package Node smoke；普通 lane 不强制 PG15 |
| `pnpm test:db` | PASS；database unit 18 + 隔离 PG15 integration 10 + compiled-package smoke；数据库完整门禁 |
| `pnpm build` | PASS；合同和 migration 生成物零漂移，四包均构建成功 |
| `pnpm workspace:check` | PASS；root policy PASS，source budget remainder 9.01 MiB / 32.0 MiB |
| `pnpm contracts:verify` | PASS；`VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`、`runtime_activated=false` |
| `pnpm db:migrations:check` | PASS；九段 catalogue 与冻结来源一致 |
| `pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org` | PASS；审计发现的既有 AJV 链 `fast-uri 3.1.5` 已通过 workspace 精确 override 升到官方修复版 3.1.6；0 known vulnerabilities |
| `git diff --check` | PASS |

未运行 Electron E2E、桌面打包、真实 N-1、共享/托管 PG、备份恢复、部署或设备验证：W4 不改变桌面行为，也没有这些运行面或授权。

## 5. Review 收口

独立工程与专项复核共收敛 16 项有效问题，全部在 W4 内修复：生成物双目录原子发布；真实单会话门禁与公开 SQL 隐藏；完整 ACL、函数安全、触发器、policy seed 和脏库指纹；未知 `BEGIN` 回执回滚；同 client 重入；临时 PG 生命周期；双 client、账本插入失败和安全变异回归；普通/PG15 测试分层；清理与 changelog 文档同步。随后通过最终门禁，没有延后到 `TODOS.md` 的 W4 finding。

## 6. 后续边界

W4 候选包按本轮授权继续完成提交、推送、PR、Review、合并与候选分支清理。Git 最终结果由远端 PR 与项目记录仓动态状态记录，不在本静态执行记录中反复改写。

下一切片是 `DEV-M0-W5 · runtime adapter / service readiness`，至少涉及连接配置、`/ready` 和 service repository。它尚未启动，不能由 W4 的测试或 Git 合并自动放行。
