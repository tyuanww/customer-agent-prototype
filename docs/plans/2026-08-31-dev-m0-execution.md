# DEV-M0 产品仓执行记录

> **文档状态：** `APPROVED · EXECUTION RECORD`（记录已授权切片事实，不新增范围授权）
> **状态：** `IN_PROGRESS · DEV-M0`
> **开始日期：** 2026-08-31
> **组织门输入：** `DEC-DDEV-01=PASS`，证据索引 `EVD-DDEV-AUTH-20260831`
> **产品仓开工输入：** 用户已明确授权“开工授权 / DEV-M0 产品仓开工授权”
> **当前切片：** `DEV-M0-W5 · runtime adapter / service readiness · REVIEW FIX CANDIDATE · AWAITING REVIEW FIX COMMIT AUTHORIZATION（PR #14，本地基线 981ab403）`
> **W2 开工输入：** 用户于 2026-09-02 明确给出“DEV-M0 合同开发与 codegen/runtime validation 开工授权”；提交、推送、PR、Review、合并与候选分支清理均已按独立授权完成，PR #10 squash 合并头为 `1a77297d51ce3cf3a0a551290675c60c941be4b6`
> **W3 开工输入：** 用户于 2026-09-02 在 W2 有序落地后授权创建下一切片并本地实现/验证；后续提交、推送、PR、Review、合并与候选分支清理又按明确授权完成，PR #11 合并头为 `2758dba5bebefc3fce87fdc73cffb6a7122bbea7`
> **W4 开工输入：** 用户于 2026-09-02 明确要求“开始启动下一个板块，我给你授权，全部一个个开始做”；本记录将该授权限制为 W4 的实现、验证与独立 Git 生命周期，不扩张到 W5、DEV-M1、真实数据、飞书运行接入、Pilot、部署或生产
> **W5 开工输入：** 用户于 2026-09-03 明确给出“`DEV-M0-W5` 开工”；本记录将该授权限制为 W5 本地分支、实现与验证，不包含提交、推送、PR、合并、真实数据、飞书运行接入、部署或生产
> **下一阶段：** W5 完成并形成 `DEV-M0` 退出证据后再单独评审 `DEV-M1`；当前不得跨入业务九端口、真实 adapter 或 Pilot
> **W1 开工输入：** 用户于 2026-08-31 明确给出“产品仓 W1 分支创建与开工授权（基于 6111272）”；该授权不包含 W1 提交、推送、PR、合并、部署或后续正式能力切片
> **W0 历史输入：** 用户曾明确给出“产品仓 W0 提交授权”；W0 已通过独立 Git 门完成，不自动扩张到 W1
> **不代表：** 真实数据、飞书运行接入、Pilot、付费调用、自动发送、部署或发布授权；本记录的状态本身不扩张任何 Git 权限

## 1. W0 目标与边界（历史基线）

目标是在不改变现有 Electron 行为的前提下，固定机械迁移前的可重放基线，并建立唯一 Monorepo 的根策略与 `apps/desktop` 目标位。

明确不做：本切片不搬动 `src/`、测试或构建配置，不创建 API / worker / DB 空包，不生成正式 DTO / migration，不激活合同运行时，也不读取另一仓或飞书的运行时状态。

写入所有者是根 workspace 策略、`scripts/workspace-hygiene.mjs` 与迁移前 E2E 证据；现有 Electron main / preload / renderer 的所有权和信任边界不变。

## 2. W0 边界方案

| 方案 | 结果 | 原因 |
| --- | --- | --- |
| A：保留根应用，只声明 workspace globs、固定工具链并创建 `apps/desktop` 目标位 | **采用** | scaffold 与 mechanical move 分离；没有行为变化，也不会出现双入口 |
| B：同时创建 desktop/API/DB package manifest，并让根脚本转发 | 不采用 | 会提前制造空包和 pass-through 层，并把目录迁移、配置改写与正式能力混入同一变更 |

## 3. W0 修改前基线

运行环境：Node.js `v24.19.0`、pnpm `11.19.0`。

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS；首次与 build 并行时碰到 Electron Vite 瞬时配置文件，构建结束后串行复跑通过，该并发结果不作为代码失败 |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，50 files / 493 tests |
| `pnpm build` | PASS |
| `pnpm workspace:check` | PASS，修改前 source budget 6.04 MiB / 32.0 MiB |
| `pnpm test:e2e` | PASS，14 tests |

修改前基线未重新生成安装包；修改后补跑了本地未签名 macOS 包，见第 5 节。签名、公证、Windows 真机和生产验证均未运行，且不能由 macOS 本地构建代替。

## 4. W0 实现事实

- `pnpm-workspace.yaml` 声明 `apps/*` 与 `packages/*`，但当前可运行应用仍在根目录；不存在第二套运行入口。
- 根 `packageManager` 与 `engines.pnpm` 统一固定为 `pnpm@11.19.0`；Node 继续限定为 24.x。
- `apps/desktop/` 只记录未来桌面包边界，尚无运行代码或 package manifest。
- `workspace:check` 同时验证源码预算、当前 Node 运行时、根工具链、精确 workspace glob 集合、必需目标目录的每一级真实目录，以及所有 glob 根、直接成员和成员 manifest；版本漂移、抵消 glob、重复声明和软链接逃逸均失败关闭。
- 已接收合同仍固定为 `cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c`；本切片保持 `ddev_authorized=false`、`runtime_activated=false`，不把组织开工授权误写成运行时激活。
- 迁移前 E2E 会先确认 Dashboard / Query 的 Electron 原生窗口和 WebContents 均已获得焦点，再验证“关闭当前表面”；空闲 Fox 按产品行为继续由 `showInactive()` 恢复，不伪造焦点。测试快照容忍且仅容忍已确认销毁的并发关窗对象，不修改窗口运行逻辑。

## 5. W0 修改后验证

| 命令 | 结果 |
| --- | --- |
| `pnpm lint` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，51 files / 504 tests |
| `pnpm build` | PASS |
| `pnpm workspace:check` | Node 24 下 PASS，root policy PASS；source budget 7.17 MiB / 32.0 MiB，`release/` 单独分账；Node 25.8.2 诊断按预期以 `NODE_RUNTIME_MISMATCH` 失败 |
| `pnpm contracts:verify` | PASS；精确合同集、来源 SHA、双哈希通过，`ddev_authorized=false`、`runtime_activated=false` |
| 焦点 / 关闭竞态 E2E 回归 | PASS，最终目标用例 repeat-each 20/20 |
| `pnpm test:e2e` | PASS，14/14 |
| 提交前 E2E 追加复跑 | `INVALID_ENVIRONMENT`；原生 Query 抢焦点后捕获到测试预设外的本机中文 IME 输入，造成焦点与自动收起断言漂移；为避免继续截获用户键盘已停止，不用该受污染结果覆盖此前 14/14 PASS |
| `pnpm package:mac:local` | 本 W0 前序 PASS；生成 universal 未签名 DMG / ZIP 并通过脚本后验；最终审查修正后未重复打包，且始终未签名、未公证、未发布 |

修改后的 E2E 回归依次捕获并修正了三处测试前置问题：`Page.bringToFront()` 与原生焦点不同步；窗口可能在 `BrowserWindow.getAllWindows()` 枚举后、属性读取前被原生关闭；以及空闲 Fox 的 `showInactive()` 行为不应被强行断言为已聚焦。最终只对 Dashboard / Query 等可关闭表面等待原生焦点，空闲 Fox 按真实非激活状态验证 no-op；快照读取仅在窗口或 WebContents 已确认销毁时跳过对象，其他异常继续抛出。期间另有一次无 trace 的测试进程 90 秒 teardown 超时，后续定向与全量复跑未复现；最终可重放结果为目标用例 20/20、全量 14/14。提交前的追加复跑在活动桌面上捕获到测试预设外的本机 IME 输入，因此按环境污染留档，不作为回归失败，也不继续运行会抢占真实键盘的原生焦点测试。

## 6. W1 目标与边界

W1 从已合并的 W0 基线 `6111272faf1adf9b2e457f9d6458c884480d06f6` 开始，只做一次可审查的机械迁移：把现有 Electron 源码、测试、资产、构建配置和打包脚本原样移入 `apps/desktop`，同时保持根命令稳定，并以 W0 同级质量门证明行为等价。

写入所有者分成两层：`apps/desktop` 唯一拥有桌面运行时、测试、资产、构建和打包知识；根 workspace 只拥有稳定命令门面、合同接收与 workspace 卫生策略。W1 不新增 API、worker、DB、OAuth、遥测、真实数据、UI 行为或 IPC 能力，也不激活正式合同运行时。

## 7. W1 实现事实

- `src/`、`tests/`、`assets/`、`build/`、Electron/Vite/Vitest/Playwright/TypeScript 配置、品牌文件、许可声明与平台打包脚本已迁入 `apps/desktop/`；测试和源码保持同包相对依赖。
- `apps/desktop/package.json` 是唯一桌面产品 manifest 与产品版本写入点，包名为 `@customer-agent/desktop`；根 `package.json` 不再声明版本，只转发稳定开发 / 验证 / 打包命令，并直接拥有仓级 lint、合同与 workspace 工具；`.gstack/package-json-path` 把后续 `/ship` 版本操作固定到桌面产品 manifest。
- Node / pnpm 工具链只由根 manifest 与仓级卫生门拥有，桌面产品 manifest 不复制工具链约束，避免双写漂移。
- Electron 构建输出迁为 `apps/desktop/out/`；本地或正式安装包仍按既有外部产物合同写入根 `release/`，不产生第二套发布目录。
- workspace 卫生门现在验证 `apps/desktop` 的真实目录、manifest、名称、私有属性与无工具链覆盖，以及产品版本清单固定点和根门面无版本约束；同时分别识别当前 app 产物与 W0 根目录遗留可再生成项（含旧 `build/icon.*`）。
- main / preload / renderer / shared 的代码内容、IPC 白名单、sender / role 门禁、sandbox 配置、合成 fixture 和复制语义均未扩张。
- 正式合同仍是 `VERIFIED_NOT_ACTIVATED`，`ddev_authorized=false`、`runtime_activated=false`。

## 8. W1 验证

运行环境：Node.js `v24.19.0`、pnpm `11.19.0`。

| 命令 | 结果 |
| --- | --- |
| `pnpm install --offline` | PASS；2 个 workspace project，0 下载，锁文件与本地依赖图一致 |
| `pnpm lint` | PASS；根级仓库扫描，零 warning |
| `pnpm typecheck` | PASS |
| `pnpm test` | PASS，51 files / 506 tests；包含 macOS / Windows 打包路径合同 |
| `pnpm build` | PASS；输出 `apps/desktop/out/main`、`preload`、`renderer` |
| `pnpm workspace:check` | PASS；root policy PASS，source budget 7.20 MiB / 32.0 MiB |
| `pnpm contracts:verify` | PASS；合同集、来源 SHA 与双哈希通过，仍未激活 |
| `pnpm test:e2e` | PASS，14/14；真实 Electron 窗口、IPC、复制与 Dashboard 路径在迁移后保持等价 |

W1 未生成 DMG、ZIP 或 Windows 安装包；打包路径和资源合同已由全量测试覆盖，但这不等于实际产包、签名、公证、Windows 真机、部署或发布证据。

## 9. W2 / W3 落地与下一切片

W1 已通过独立 Git 门合并为 `6c759c6b317d9382787dcec200f3e828b7a5007d`。W2 已通过 PR #10 squash 合并为 `1a77297d51ce3cf3a0a551290675c60c941be4b6`，候选 worktree 与本地/远端分支均已清理；合同包保持 `runtime_activated=false`。

W3 已从该合并头建立隔离分支并完成实现与验证：只实现 loopback Fastify `/health`、命名 profile 与监听前配置拒启；不注册 `/ready` 或九业务端口，不创建 migration/PostgreSQL、真实数据、Feishu auth、桌面接线或运行时激活。W3 已通过 PR #11 合并为 `2758dba5bebefc3fce87fdc73cffb6a7122bbea7`，候选 worktree 与本地/远端分支均已清理；执行快照见 [`2026-09-02-dev-m0-w3-api-config-bootstrap.md`](2026-09-02-dev-m0-w3-api-config-bootstrap.md)。

W4 已在该基线上实现并验证不可变 migration / PostgreSQL 深模块，覆盖 DDL 来源锁、`status → plan → apply → verify`、PG15 clean install、ACL / SQLSTATE、N-only、未知提交回执恢复与失败回滚；执行快照见 [`2026-09-02-dev-m0-w4-postgres-migrations.md`](2026-09-02-dev-m0-w4-postgres-migrations.md)。当前没有前一份签名数据库基线，因此真实 N-1 仍为 `N/A`。W4 不放行 W5、DEV-M1、真实数据、部署或 Pilot。

本记录只保存产品仓实施事实；项目总进度与授权状态继续由 `ai-赋能立项` 当前真源拥有。

## 10. W4 工程评审输入与边界

W4 的唯一目标是把已接收且已验证的 `schema-v1.12.sql` 转换为可确定性重放、可核验、失败关闭的 PostgreSQL 15 migration 模块。它不改变合同的业务语义，不把数据库能力接入 API 或桌面端，也不激活正式运行时。

写入所有者如下：

- 根合同接收器继续唯一拥有合同集、来源提交、文件哈希与 `VERIFIED_NOT_ACTIVATED` 校验；database 模块只能在该锁内读取已验证 snapshot，不复制第二套合同验签。
- `packages/database` 唯一拥有 migration codegen、不可变 catalogue、应用账本、顺序规划、事务执行与数据库后验核验。
- PostgreSQL 自身拥有 DDL 原子性、角色和 ACL 的实际状态；调用方只能通过 database 模块的窄接口观察，不直接拼 SQL 或解释内部账本。
- API、desktop 与治理仓均不成为 database 的运行时依赖；治理仓只记录阶段门和最终合并证据。

### What already exists

| 既有能力 | W4 处理 |
| --- | --- |
| 根合同接收器已验证精确合同集、来源 Git SHA 与双哈希，并持有 intake lock | 复用；只扩展一个受锁保护的已验证 database source 回调，不重写验证器 |
| `schema-v1.12.sql` 已冻结 PG15 DDL、角色、函数、触发器、ACL、SQLSTATE 与 Phase-1 policy seed | 作为唯一生成输入；不手工维护第二份语义 DDL |
| 根 workspace 已有 contracts → api → desktop 的分层质量门 | 在 contracts 后加入 database；W4 不让 API 依赖 database |
| 本机已有 PostgreSQL 15 工具链 | 只用于隔离临时 cluster 集成测试；不触碰共享本机数据库 |

## 11. W4 Architecture

采用单个深模块隐藏 source split、账本一致性、锁、事务和验证知识：

```text
verified contract snapshot (under intake lock)
                    |
                    v
 deterministic generator -- exact source SHA + fixed statement coverage
                    |
          +---------+----------+
          |                    |
          v                    v
  0001..0009 SQL       generated manifest/catalogue
  review artifacts      (embedded SQL + hashes + provenance)
          |                    |
          +---------+----------+
                    v
          status -> plan -> apply -> verify
                    |
       one pg.Client + session advisory lock
                    |
       transaction(migration + ledger row)
                    |
                    v
 PostgreSQL schema + private customer_agent_meta ledger
```

### 11.1 不可变生成物

生成器必须先通过根合同接收器取得已验证 snapshot，再校验固定 source DDL SHA。它去除上游文件最外层 `BEGIN/COMMIT`，由 runner 为每个 migration 独立建立事务，并在每段补入事务内 `search_path`。九段顺序固定为：

1. `0001_extensions`
2. `0002_identity_and_content`
3. `0003_events_and_metrics`
4. `0004_import_release_announce`
5. `0005_idempotency_rate_limit_outbox`
6. `0006_definer_functions_and_triggers`
7. `0007_search_bigram`
8. `0008_runtime_acl`
9. `0009_phase1_policy_seed`

生成器必须证明源语句被完整且仅一次归属；允许排除的内容只有文件头、外层事务、空白和由 generator 重建的 `SET LOCAL`。每个 migration 的 id、位置、字节数、SHA-256、源范围及合同 provenance 写入 generated manifest；运行时使用内嵌 catalogue，不从工作区路径读取 SQL。migration/manifest 与内嵌 catalogue 必须先完整写入同文件系统 staging，再以目录级交换发布；普通 I/O 失败时两组一起回滚，不能通过逐文件覆盖留下已知的新旧混合状态。

### 11.2 规划、执行与核验

- `status` 读取私有账本并归一化当前状态；发现未知 migration、顺序缺口、重复位置、checksum 或 provenance 漂移时失败关闭。
- `plan` 只允许合法前缀向前推进；已完整应用时返回空计划，绝不重跑 DDL，公共结果不携带可执行 SQL。
- `apply` 只接受真实单会话 `pg.Client` / checked-out `PoolClient` 并取得 session advisory lock；裸 `Pool` 与同 client 重入在查询前拒绝。每个 migration 及其账本写入在同一事务中提交，失败时回滚该 migration，最后可靠释放锁。
- `verify` 同时核对 catalogue/账本一致性与完整 ACL/default ACL、1,399 条对象/owner/列/约束/索引/视图指纹、函数定义与安全属性、trigger event/enabled 和 policy key；它不把“有表”或“数量相同”误当成数据库状态正确。
- 所有外部错误统一为稳定 database error code，保留可诊断 cause，但公开消息不得回显连接串、凭证或原始敏感参数。

### 11.3 账本边界

账本位于私有 `customer_agent_meta` schema，记录 position、migration id、migration SHA、contract set id、source Git SHA、source schema SHA、应用时间与耗时。对 `PUBLIC` 撤销 schema/table 权限；只有 migration owner 可写。未知或被篡改的账本不是可自动修复状态，必须停止并由人工处置。

### 11.4 方案比较

| 方案 | 结果 | 理由 |
| --- | --- | --- |
| A：确定性 codegen + 内嵌 catalogue + 深 runner | **采用** | 一个接口隐藏九段来源、hash、账本、锁和事务；发布包无需猜工作区文件路径 |
| B：运行时读取一份大 SQL 并整包执行 | 不采用 | 无逐步状态、失败恢复、不可变账本和合法前缀规划，无法满足 W4 验收 |
| C：手工维护九份 SQL 与一份上游 DDL | 不采用 | 形成双真源且无法机械证明语句完整覆盖，漂移风险高 |

## 12. W4 Code Quality

- 公共面只导出 `status/plan/apply/verify`、不含 SQL 的状态类型与稳定错误，不导出 executable catalogue、任意 SQL 执行器、账本写口或 test seam。
- generator、planner、runner、verifier 各承担不同职责；不增加只转发同名参数的 wrapper。
- catalogue 由生成器写入，禁止手工修改；`db:migrations:check` 必须在任何漂移时失败。
- 事务与 advisory lock 的时序留在 runner 内；“必须是同一真实 session”由静态类型和运行时门禁共同表达，不靠调用方记住隐含规则。
- 测试注入只在内部模块使用，不进入 package public entrypoint。
- migration runner 中应放一段简短 ASCII 注释说明 lock/transaction/ledger 时序；普通模型和纯映射函数不重复文档。

## 13. W4 Tests

测试先窄后宽，且把静态审查、临时 PG15 集成与仓级回归分开：

| 验证面 | 必须证明 |
| --- | --- |
| generator unit | 固定 source SHA、九段顺序、语句完整且仅一次覆盖、manifest/hash 确定性、篡改失败、整组发布移除旧成员、第二组交换失败时双组回滚 |
| planner unit | fresh、合法 partial、complete、unknown id、gap、重复位置、checksum/provenance drift |
| runner unit | 同 client 事务、失败 rollback、ledger 与 migration 原子提交、锁最终释放、错误脱敏 |
| isolated PG15 clean install | 九段按序完成；二次 apply 为 no-op；账本、schema inventory、角色、视图、函数、触发器和 seed 后验匹配 |
| concurrency/session | 两个独立 client 只应用一次；裸 Pool 与同 client 重入在查询前拒绝 |
| security/contract negatives | runtime role 无越权；稳定 SQLSTATE `ZA001`–`ZA006` 可触发且不被 runner 吞掉 |
| exact-manifest mutations | 任意新增 PUBLIC/default grant、owner/函数体/config 漂移、replica-only trigger、RLS、列默认值、enum/schema 或 policy key 置换均失败关闭 |
| synthetic retry | 人工注入的 backfill 在中途失败后无半成品；修正后以同 id 重试，count/hash 与预期一致 |
| ledger failure | DDL 成功但 ledger insert 失败时同事务回滚，故障解除后同 id 可安全重试 |
| compatibility | 当前首个签名基线只证明 `N-only=PASS`；真实 `N-1=N/A · no prior signed baseline`，不得伪造升级证据 |
| package smoke | 构建后的 JS 可从 package entrypoint 加载，且不依赖仓库 SQL 路径 |
| repository gates | `lint`、`typecheck`、`test`、`build`、`workspace:check`、`contracts:verify` 全部通过 |

PG15 集成测试必须创建独立临时 data directory、私有 Unix socket 和临时数据库，测试后停止 cluster 并清除临时资源；二进制发现失败不得先留下临时目录；不得使用或删除共享本机 cluster 中的对象。普通 `pnpm test` 不强制安装 PG15，database 变更的完整门禁为 `pnpm test:db`。

## 14. W4 Failure Modes

| 路径 | 真实失败 | 测试 | 处理 | 用户可见性 |
| --- | --- | --- | --- | --- |
| source → generator | 上游 DDL 漂移、切分 anchor 重复/缺失或目录交换失败 | generator negative + publish rollback | 生成前失败不覆盖；发布失败逆序恢复两个旧目录 | 明确错误与文件组，不留下已知混合集合 |
| catalogue → plan | 账本有未知 id、gap 或 hash 漂移 | planner negative + PG tamper | 禁止 apply，不尝试猜测修复 | 明确 drift 错误，不泄露连接信息 |
| advisory lock | 两个进程同时迁移 | PG concurrency | 后者等待同一 session lock，完成后重算 plan | 等待或明确超时，不静默并发 |
| transaction | DDL/backfill 中途报错 | injected failure | 当前 migration 与 ledger row 同时 rollback | 稳定 apply failure，保留安全 cause |
| ledger write | DDL 成功但 ledger insert 失败 | injected ledger failure | 同事务 rollback DDL | 明确失败，无“已完成”误报 |
| verify | 数量不变但 ACL/owner/函数定义/列/约束/索引/trigger/seed key 漂移 | PG mutation negative | 精确 manifest 指纹不匹配即失败 | 指向不变量，不输出敏感行数据 |
| cleanup | 二进制发现或 cluster 启停异常 | harness unit + integration teardown | 发现二进制后才建目录；finally 只清理已解析的 temp path，并保留 stop/cleanup 组合错误 | 测试失败中给出安全诊断 |

没有“无测试、无错误处理且静默”的已知路径。

## 15. W4 Performance

九个 migration 为一次性顺序控制面，不进入 API 请求路径；清晰的事务与恢复边界优先于并行 DDL。集成验证记录每段执行时间及总耗时用于后续基线，但本切片不凭空设置生产 SLA。catalogue 在构建时内嵌，正常执行不重复扫描或哈希工作区文件。

## 16. W4 Implementation Tasks

- [x] **T1（P1）** — 扩展合同接收器的受锁 verified database-source 回调，并实现确定性九段 codegen、manifest 与漂移检查。
- [x] **T2（P1）** — 建立 `@customer-agent/database` 公共合同、私有账本、planner 与稳定错误模型。
- [x] **T3（P1）** — 实现单 client advisory-lock runner、逐段事务、status/plan/apply/verify 与 package smoke。
- [x] **T4（P1）** — 建立隔离 PG15 harness，覆盖 clean install、幂等、并发、回滚、ACL/SQLSTATE、synthetic retry 与首版 N-only 报告。
- [x] **T5（P1）** — 接入仓级 scripts/质量门，跑完窄测试与全量回归，并记录真实证据。

Sequential implementation, no parallelization opportunity. T1–T5 都触及同一 database catalogue/runner 合同，拆成并行 worktree 会提高生成物和锁语义冲突风险。

### Outside voice 与实现收口

开工设计与实现专项复核累计提出 16 项有效改进，全部进入 W4：逐字节来源覆盖、`0001` 同事务账本与固定锁、同字节 retry、双目录原子发布、真实 Client/Pool 边界、公开 SQL 隐藏、完整安全 manifest、脏库对象覆盖、未知 `BEGIN` 回执回滚、同 client 重入、PG harness 生命周期，以及并发/账本失败/安全变异/测试分层/文档同步回归。没有延后项。

## 17. NOT in scope

- API `/ready`、九业务路由与 service repository：留给 W5，避免把迁移控制面和请求路径混成一个切片。
- desktop 接线、renderer 数据、UI 或 IPC：W4 不改变现有产品行为和信任边界。
- 真实客户/飞书数据、凭证、URL、token 与现有业务库迁移：Ddev 当前只放行合成开发；集成验证只用合成数据和临时 cluster。
- 真实 N-1 升级签发：当前没有前一份签名数据库基线，只能记录 `N/A`，不能用合成 rehearsal 冒充。
- PostgreSQL 托管、备份恢复、生产容量、部署、Pilot 与发布：均需后续独立授权与环境证据。
- 自动修复被篡改账本或数据库：不可靠且可能掩盖入侵/人工漂移，W4 必须失败关闭。

## 18. W5 目标与边界

W5 只补齐正式 Application API 的运行时基础设施：私有数据库连接配置、一个受控 `pg.Pool`、service repository 生命周期，以及合同一致的 `GET /ready`。它不实现 auth/search/events/content 等业务端口，不把桌面 renderer 接到 API，也不读取真实客户或飞书数据。

W5 完成后的真实口径是：

- `/health` 继续只证明 event loop 存活，不访问 DB；
- `/ready` 对 database/schema 做真实查询，对尚未实现的 auth/storage/content 明确返回 `not_ready`；
- 因 M1/M2 能力尚未交付，W5 期间 `/ready` 必须返回 503，不能制造业务“全绿”；
- API 仍只允许 `formal-dev|test + AUTH_MODE=mock + 127.0.0.1`，合同锁继续是 `runtime_activated=false`。

## 19. What already exists

| 现有能力 | W5 处理 |
| --- | --- |
| W2 `@customer-agent/contracts` 的 `ReadyResponse` / `NotReadyResponse` runtime validator | 直接复用；不手写第二套 DTO |
| W3 配置先行拒启、Fastify `/health`、精确方法面与关闭生命周期 | 扩展同一 owner；不新建第二宿主 |
| W4 `@customer-agent/database` migration 控制面与 `pg.Client` 单会话边界 | 保持隔离；请求池不得调用或弱化 migration runner |
| W4 隔离 PostgreSQL 15 harness | 只在显式 API integration 门复用；普通 `pnpm test` 不强制 PG15 |
| 冻结 schema v1.12 的 public schema comment、受控 search 函数与 `app_runtime` ACL | 用作 runtime-safe schema 指纹；不读取私有 migration ledger |

## 20. W5 Architecture

### 20.1 单一运行路径

```text
environment
  ├─ public runtime config ───────────────┐
  └─ private DB bootstrap config          │
           │                              │
           ▼                              ▼
      one pg.Pool ──> ServiceRepository ──> Fastify
           │              │                  ├─ GET /health  (no dependencies)
           │              └─ readiness() ────└─ GET /ready
           │                    ├─ one bounded SQL → database/schema
           │                    └─ hard-off gates → auth/storage/content
           └─ end() <──────── Fastify onClose + startup-failure cleanup
```

私有 DB bootstrap 配置可在进程内构造连接池，但不得进入 `StartedApi.config`、日志、HTTP 响应或错误 cause 文本。`ServiceRepository` 是本切片唯一新增深模块：它拥有 pool、schema 指纹、single-flight deadline、错误归一化与幂等 close；route 只消费五项稳定状态。idle client error 由 pool 淘汰后只记录脱敏诊断，下一次请求必须执行真实探针，不额外制造一次假故障。

### 20.2 readiness 语义

| check | W5 实现 | 结果规则 |
| --- | --- | --- |
| database | 连接池执行一条最小查询 | 查询成功=`ok`；获取连接、查询或 readiness deadline 超时=`not_ready`；已淘汰的 idle client error 只记诊断 |
| schema | 同一查询核对 PostgreSQL 15、`schema.v1.12` comment、完整 search 依赖定义摘要，以及 runtime login、`app_runtime`、`cs_ai_definer` 的无特权/双向成员边界、parameter ACL 和跨当前数据库/全部用户 schema 的精确 ACL | 全部满足=`ok`；依赖定义替换、trigger-disable 参数、额外/缺失/可转授权权限、数据库或对象归属、第三 schema、危险 default ACL、额外角色或特权身份均=`not_ready` |
| auth | M1 前没有可用 auth provider | 固定 `not_ready`，即使配置允许 mock 也不冒充 handler 已实现 |
| storage | M2 前没有 import storage adapter | 固定 `not_ready`，不以目录或变量存在冒充 key/hash/size 重读通过 |
| content | M2 前没有受控 current-release readiness 边界 | 固定 `not_ready`，不直读 `content_current`，不调用有副作用的 lease 函数 |

全部五项为 `ok` 才以合同 `ReadyResponse` 返回 200；否则以 `NotReadyResponse` 返回 503、`Retry-After: 1` 与 `Cache-Control: no-store`。响应只含五个枚举，不含 DSN、SQL、路径、异常文本或内部版本细节。

### 20.3 配置与生命周期

- 新增 `DATABASE_URL`（仅允许 loopback/本机 Unix socket 的 PostgreSQL URL、必填且禁止驱动控制 query 参数）、`DB_POOL_MAX`（默认/上限 20）、`DB_CONNECTION_TIMEOUT_MS` 与 `DB_READINESS_TIMEOUT_MS`（均默认 2000ms）的监听前校验。远程/托管 DSN 在 W5 失败关闭；前者只约束连接获取，后者同时约束 readiness 响应/query/statement；只有隔离 PG15 harness 可使用唯一 Unix-socket `host` 与可选 `port` 参数。
- public config 继续保持冻结且无 secret；私有 bootstrap config 只传给 repository factory。
- DB 不可达不会让 `/health` 消失；进程可监听并由 `/ready=503` 阻止业务流量。
- Fastify `onClose` 释放 pool；构造或监听失败路径再执行幂等 fallback close，原始启动错误仍优先。

## 21. W5 Code Quality

- 只新增一个 service module，不建立 `pool → adapter → repository → service` 的浅转发链。
- route 不知道 SQL、pool 或 secret；repository 不知道 Fastify/reply。
- 五项状态使用 OpenAPI 生成 validator 作为最后输出边界；所有异常统一降为稳定 `not_ready`。
- runtime diagnostics 只允许固定 code 与合法 SQLSTATE；raw error、DSN 与 SQL 不进入日志或 HTTP。
- migration owner 与 runtime pool 严格分离；W5 不导入 migration runner 到生产请求路径。
- schema readiness 同时证明登录账号的单一 workload 身份与 search 函数的 owner / SECURITY DEFINER / search_path / ACL，不能只凭“有 EXECUTE”形成假绿。
- 不修改 desktop、preload、renderer、fixture 或 Dashboard。

## 22. W5 Test Review

框架：Node.js 24 + Vitest；真实依赖边界追加显式 PostgreSQL 15 integration，普通单元门继续无 PG 前置。

```text
CODE PATHS                                             USER / OPERATOR FLOWS
[+] runtime config                                    [+] API bootstrap
  ├─ valid local DB URL/default pool/split timeouts      ├─ valid config → listen → /health 200
  ├─ missing/remote/driver-override URL → CONFIG_INVALID └─ invalid DB config → no Fastify construction
  └─ secret absent from public config/errors
[+] ServiceRepository                                [+] readiness polling
  ├─ SQL success + exact schema/identity → db/schema ok  ├─ all injected checks ok → 200 exact contract
  ├─ SQL success + schema drift → db ok/schema not_ready ├─ any check down → 503 + Retry-After: 1
  ├─ query/deadline error → both not_ready                └─ response never leaks error/DSN/path
  ├─ concurrent polling → one in-flight query only
  ├─ late connection at/after deadline → verify rejects client
  ├─ idle-client error → diagnostic + fresh probe
  └─ close twice → one pool shutdown
[+] Fastify routes
  ├─ /health remains dependency-free
  ├─ /ready exact GET only; HEAD/POST remain 404
  └─ /v1/* remains 404
[→INTEGRATION] temporary PG15
  ├─ apply locked W4 migrations with owner client
  ├─ runtime login only member of app_runtime
  ├─ db/schema become ok through real pool
  ├─ role/parameter/DB/schema/ACL/search-dependency drift → schema not_ready
  └─ auth/storage/content stay not_ready; direct SoR read remains denied
```

所有计划分支都必须在同一 changeset 获得正反测试；没有 LLM/prompt 变化，因此无 eval。integration 使用独立临时 cluster、Unix socket 与合成空库，不接共享数据库或真实数据。

## 23. W5 Failure Modes

| 路径 | 真实失败 | 测试 | 处理 | 可见性 |
| --- | --- | --- | --- | --- |
| config | DB URL 缺失、远程 host、scheme/数值非法或 DSN 参数试图覆盖 driver timeout/name | config negative | Fastify 构造前 `CONFIG_INVALID` | 只报字段+稳定 reason，不回显值 |
| pool | DB 不可达、连接耗尽、deadline 或 idle client 异常 | fake pool + timeout/error | deadline 失败关闭；并发/超时后不放大在途查询；idle error 后真实复探 | `/ready` 503；`/health` 仍 200；内部仅稳定诊断 |
| schema | PG major/comment、search 依赖摘要、runtime/definer 角色属性与双向成员、parameter ACL/replication role、当前 DB/第三 schema/对象归属、表/列/函数或 default ACL 漂移 | fake rows + PG15 权限变异 | schema=`not_ready` | 不返回内部差异 |
| later capabilities | auth/storage/content 尚未实现 | exact response tests | 三项 fail-closed | 明确 503，不产生假绿 |
| contract mapper | check 缺失或非法枚举 | contract validator tests | 响应构造失败，不发送宽松对象 | 测试门阻断 |
| shutdown | listen 失败或重复 close | lifecycle tests | pool 幂等释放，保留首个 root cause | 稳定启动失败，不泄露 secret |

没有“无测试、无错误处理且静默”的计划路径。

## 24. W5 Performance

- 每个 readiness 周期最多一条数据库查询，不做逐表/N+1 扫描，不调用 search、lease 或 migration verify；并发请求共享同一在途 Promise。
- pool 上限 20、连接等待默认 2s；独立 readiness deadline/query/statement timeout 默认 2s。在途操作真正结束前不会启动第二条探针；若底层连接在 connection deadline 当时或之后迟到成功，pool verify 会在交给查询前拒绝并销毁该 client。
- W5 不使用 TTL readiness 缓存，避免把依赖恢复/失效延迟成陈旧绿灯；后续真实流量下若探针频率造成负担，再由部署层降低频率或在独立变更中加短 TTL。
- 本切片不宣称 300 QPS、托管 PostgreSQL、备份恢复或生产容量已认证。

Sequential implementation, no parallelization opportunity. 配置、repository、route 与生命周期共同定义一个启动/关闭链，拆成并行 worktree 会增加 secret 与 resource ownership 漂移。

## 25. W5 Implementation Tasks

- [x] **T1（P1）** — runtime config — 加入私有 DB bootstrap 配置、数值边界、仅本机 DSN 与脱敏拒启。
- [x] **T2（P1）** — service repository — 建立单一 pool owner、runtime-safe schema/有效 ACL 指纹、稳定 readiness 与幂等关闭。
- [x] **T3（P1）** — platform routes — 注册合同校验后的 `/ready`，保持 `/health` 和 `/v1` 边界不变。
- [x] **T4（P1）** — tests — 覆盖配置、五项状态、错误/关闭路径，并用隔离 PG15 证明真实 pool + runtime ACL。
- [x] **T5（P1）** — repository gates — API 窄测、PG15 integration、lint/typecheck/test/build/workspace/contracts 全门均已实际通过。

## 26. NOT in scope

- auth mock-login、Feishu OAuth、session/RBAC：属于 DEV-M1 与 Pilot 前后置门；W5 只保留 auth=`not_ready`。
- storage 上传/读取、content import/publish/current：属于 DEV-M2；W5 不创建空 release、假对象或直读 SoR。
- search/events/policy/redaction 等九业务端口：属于 DEV-M1+，本切片保持 404。
- desktop API client、main adapter、renderer 数据切换：属于 DEV-M3；当前桌面继续 `PILOT-S0 · SYNTHETIC`。
- 真实数据、飞书运行接入、RAGFlow、托管 PG、备份恢复、部署、Pilot、付费、自动发送与遥测：均未由 W5 授权。
- migration apply/verify 自动挂到 API startup：部署 migration job 尚未设计完成，且 runtime pool 不得持有 migration owner 能力。

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | 本切片不改变产品方向 |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | SKIPPED | 当前运行于 Codex 宿主，按防嵌套规则跳过重复调用 |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | 0 unresolved；测试图、失败模式与硬关已写入 |
| Implementation Review | `/review` + 专项 agents | Security / PostgreSQL / performance / tests / docs | 多轮 | CLEAN | 所有可复现 finding 已在同一候选修复；最终安全与文档复核均为 `clean` |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | N/A | 后端基础设施切片，无 UI 变化 |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | 不影响当前桌面启动路径 |

**VERDICT:** W5 REVIEW FIX CANDIDATE — PR #14 review findings are fixed and fully validated within the frozen scope; awaiting review-fix commit authorization.

NO UNRESOLVED DECISIONS
