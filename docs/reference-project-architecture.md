# 项目架构与目录边界

本页说明产品仓当前模块职责、运行时边界和文件归属。它描述当前代码，不等于生产架构已经完成；仓库身份和产品化生命周期见 [`PROJECT_CHARTER.md`](../PROJECT_CHARTER.md)，正式衔接见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。DEV-M0 的 W1～W6 已建立桌面、合同、API host、migration、runtime readiness 与非部署候选产物边界；DEV-M1 W0～W5 已前滚到 `schema.v1.14` 和十一段 migration，并完成 mock auth、策略读写、独立 runtime/admin 数据库能力、受控 SearchBackend、Search + Events 事务与 50 条纯合成 runner。当前负责人承接消费切片追加 `schema.v1.15` / 第十二段原子 migration，来源与验证见本文 B1/B2 记录。已合并 G1A-E0 T1～T3 的测试专用离线评测链；桌面 adapter、正式飞书鉴权、真实数据与部署仍未接入。

## 1. 先看整体

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main                                                  │
│  apps/desktop/src/main/main.ts                                  │
│   ├─ overlay-controller       三个 BrowserWindow 的生命周期     │
│   ├─ desktop-shell             Tray / 菜单 / Dock 入口           │
│   ├─ desktop-lifecycle         activate / shutdown fence        │
│   └─ window factories           安全偏好与 renderer loader       │
└───────────────┬───────────────────────────────┬───────────────┘
                │ 白名单 IPC                     │ 原生能力
┌───────────────▼───────────────┐   ┌───────────▼────────────────┐
│ preload                         │   │ Electron / OS               │
│ apps/desktop/src/preload/index.ts │   │ clipboard, bounds, shortcut │
│  CustomerAgentApi               │   │ tray, menu, display          │
└───────────────┬───────────────┘   └─────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│ renderer                                                       │
│  App.tsx 按 WindowRole 分发                                     │
│   ├─ FoxApp       浮窗、拖拽、贴边、睡眠与交接                   │
│   ├─ QueryApp     查询胶囊、本地合成检索、Top 3、复制            │
│   └─ DashboardApp 静态合成工作台、主题与导航                      │
└────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│ shared                                                         │
│ contracts / overlay-events / query-layout / geometry / security │
│ 只放跨 main、preload、renderer 必须一致的类型与纯函数              │
└────────────────────────────────────────────────────────────────┘

contracts/upstream（不可变输入；同一受锁 snapshot）
  ├─ packages/contracts（bundle / generated TS / runtime validator）
  │    └─ apps/api → health / ready / mock auth / policy（loopback only）
  └─ packages/database（0001..0012 / catalogue / ledger / verify）
       └─ migration owner 控制面（只 apply/verify，不进入 API 请求路径）

apps/api（DEV-M1 COMPLETE）
  ├─ runtime pg.Pool → readiness + policy read + SearchBackend + Events
  ├─ isolated admin pg.Pool → PolicyAdminRepository → set_policy_flag only
  └─ legacy synthetic G1a runner → isolated PG15 → same SearchBackend（NOT_EVALUATED）

apps/api/tests/support/g1a-e0（test-only；不进入 dist）
  └─ off-repo closed package → verifier → isolated PG15 → same SearchBackend
                                      └─ scrubbed aggregate report + mandatory cleanup
```

桌面主链仍是：狐狸浮窗打开查询 → Query 在本地合成 fixture 中检索 → 人工选择 Top 3 → 通过白名单 IPC 写入剪贴板。Dashboard 读取编译期的 `DASHBOARD_MANIFEST`，不读取 Query、不写数据库，也不调用 Application API。并行 API 已接通本机 mock 身份、策略、受控 SearchBackend 与 Search + Events 事务，但当前只放行 synthetic；桌面 adapter、真实内容和正式飞书身份仍未接通。

## 2. 目录归属

| 目录 | 只负责什么 | 不应该放什么 |
| --- | --- | --- |
| `apps/desktop/src/main/` | BrowserWindow 生命周期、原生能力、IPC handler、关闭与失败安全 | React 视图、业务 fixture、通用 HTTP 客户端 |
| `apps/desktop/src/preload/` | 把 `CustomerAgentApi` 的白名单能力暴露给 renderer | `ipcRenderer` 通用转发、Node 文件系统、token |
| `apps/desktop/src/renderer/` | 狐狸、查询胶囊、Dashboard 和其 CSS | Electron 主进程对象、数据库连接、真实客户数据 |
| `apps/desktop/src/shared/` | 跨边界协议、类型、校验器、几何和状态纯函数 | 依赖 DOM、Electron、React 的实现 |
| `apps/desktop/` | 当前唯一 Electron workspace package；拥有源码、测试、配置、桌面资产、打包输入和产品版本 | Application API、DB、真实数据，或第二套 Electron 入口 |
| `apps/desktop/assets/`、`apps/desktop/fox-head.png` | 品牌主资产与可确定性派生的 app icon 输入 | 截图、构建包、临时导出 |
| `apps/desktop/scripts/` | 图标生成、桌面打包与包后验 | 运行时业务逻辑、workspace 合同接收 |
| `apps/api/` | 命名 profile、公开/私有配置分离、Fastify 生命周期、runtime/admin 双 pool、mock auth、service readiness、策略读写、受控搜索与事件事务边界 | 桌面 fixture、renderer、migration owner、正式 Feishu auth、真实数据、桌面 adapter 或外部 bind |
| `apps/api/tests/support/g1a-e0/` | 测试专用仓外输入校验、一次性 PG15 装载、同一 SearchBackend 评测、聚合报告与清理 | HTTP route、事件写入、桌面依赖、长期数据库、真实内容或正式构建产物 |
| 根 `scripts/` | 合同快照接收、workspace 卫生门、W6 正式服务候选产物组装与隔离后验 | Electron 运行时、UI、真实凭证或部署动作 |
| `contracts/upstream/` | 来自项目记录仓、带来源 SHA 与双哈希的不可变机器合同快照及消费锁 | 手改合同、运行时跨仓读取、凭证、生成类型或 Ddev 状态真源 |
| `packages/contracts/` | 在共享快照锁内确定性生成 OpenAPI bundle、TS 类型和 component runtime validator；构建 Node 可执行 `dist`，拥有生成物指纹、验证扩展与有上限的脱敏错误形状 | HTTP host、路由策略、DB migration、renderer、凭证或真实数据 |
| `packages/database/` | 在同一已验证快照内确定性生成十二段 migration；拥有 catalogue、私有账本、合法前缀/N-1 升级规划、同会话锁/事务、稳定错误与 PG15 后验核验 | 创建连接、读取环境变量、API repository、desktop adapter、凭证、真实数据、部署或备份恢复 |
| `apps/desktop/tests/unit/` | 纯函数、协议、脚本和安全合同 | 真实 OS 交互断言 |
| `apps/desktop/tests/component/` | React 状态、焦点、拖拽和视图行为 | 打包产物验证 |
| `apps/desktop/tests/e2e/` | Electron 窗口、renderer→preload→main 的集成链 | 把合成输入写成真实 macOS/Windows 证明 |
| `docs/`、`evidence/qa/` | 可读合同、教程、验证方法和冻结证据 | 可执行源码、运行时缓存 |

`DEV-M0-W1` 只把现有桌面包原样移入 `apps/desktop`，并同步 package、路径、测试和打包配置；根 `pnpm` 命令继续作为唯一公开入口。该切片不得混入 IPC 改造、API、DB 或 UI 行为，迁移后的模块边界和依赖方向保持不变。

`DEV-M0-W2` 把“合同接收”与“合同编译”分为两个写入所有者：根 intake 脚本验证、保存不可变输入并拥有 rollover/read snapshot 互斥；`packages/contracts/scripts/generate-contracts.mjs` 只从锁内一致快照生成产品资产。生成器拒绝外部 `$ref`、来源版本/双哈希漂移和手改生成物，并保留已登记的 `x-unique-by` 验证扩展；运行时 validator 按 schema 延迟编译，只返回数量有上限的 schema 路径与关键字，不回显请求正文。

`DEV-M0-W3` 由 `apps/api/src/runtime-config.ts` 单独拥有 profile、auth、bind、port、build version 与错误脱敏；配置必须先于 Fastify 构造通过。当前只有 `formal-dev|test + AUTH_MODE=mock + 127.0.0.1` 可启动；公共 package 入口只提供 `startApi()` 和窄 `close()` 生命周期，不暴露 Fastify 实例或替换路由 owner 的 factory。自动 HEAD 派生继续关闭。

`DEV-M0-W4` 由 `packages/database` 单独拥有 DDL source split、不可变 SHA catalogue、`customer_agent_meta.schema_migrations` 账本、固定 advisory-lock key、逐 migration 事务与后验验证。生成器机械证明上游可执行区间完整且只归属一次；runner 要求调用方传入同一个已连接 `pg.Client`，并把 migration 与账本行放在同一事务。API startup 不调用这一控制面，runtime pool 不获得 migration-owner 能力。

`DEV-M0-W5` 在 `apps/api/src/runtime-config.ts` 增加只在进程内传递、仅允许本机 PostgreSQL 的 DB bootstrap config，并由 `apps/api/src/service-repository.ts` 单独拥有一个 `pg.Pool`、schema 指纹、single-flight deadline、错误归一化与幂等关闭；`runtime-diagnostics.ts` 只输出稳定、脱敏的运行诊断词表。`GET /health` 不触碰依赖；`GET /ready` 通过一次只读查询核对 database、PostgreSQL 15、`schema.v1.12`、8 个函数 + 2 个视图的完整可信 search 依赖摘要、`pgcrypto.digest` extension 所有权、runtime/login/definer 双向角色边界、parameter ACL，以及当前数据库和全部用户 schema 的精确表/列/函数有效 ACL。任意非 owner 的 `public CREATE` 与 deadline 后才完成的成功探针也失败关闭；auth/storage/content 明确保持为 `not_ready`。因此 W5 的服务可以监听并证明基础设施状态，但仍不会获得业务就绪或 runtime activation。

`DEV-M1 W0/W1` 在不改写上述历史切片的前提下前滚到 `schema.v1.13`：第十段 migration 只替换受控 search projection 与 schema comment，精确的 v1.12 ledger 只计划 `0010`。API 新增进程内 opaque mock session、成对 mock header、策略只读路由和 Owner-only 管理写入口。私有 bootstrap 在任何 pool/Fastify 构造前验证两条不同登录 DSN 指向同一数据库目标、总连接预算和互不复用的 HMAC 域；管理 SQL 每次写入前同时证明登录、`app_content_admin`、`cs_ai_definer`、`set_policy_flag` 定义和 ACL，任一角色或函数漂移均失败关闭。未捕获请求异常只返回稳定 500 合同，不回显原始错误；空 JSON、坏 JSON、超大正文和不支持的媒体类型统一返回稳定 400。

`DEV-M1 W2` 继续以追加方式接收 `schema.v1.14`：第十一段 migration 只增加 ready-no-hit 上下文，精确 v1.12/v1.13 ledger 分别只规划缺失后缀。API 的 `SearchRepository` 在一条参数化 SQL 内完成 scope-only 快照读取、bigram primary、字面转义 fallback、确定性排序与数据库侧 Top 3；`SearchService` 只映射公开候选字段。W2 结束时 `/v1/search` 已有鉴权、输入门禁、脱敏/HMAC 与稳定错误壳，但 operation 暂时固定 503；该临时边界已由下述 W3/W4 事务接线取代。

`DEV-M1 W3/W4` 由 `EventRepository` 拥有 runtime `PoolClient` 事务、版本化 HMAC 幂等、fencing 和事件状态机。搜索在同一事务内完成受控检索、`query_events`、精确候选四元组和 `idempotency_complete`；当前只放行 synthetic，查询文本固定 suppressed。来源拒绝先回滚业务事务，再用新连接写不含原文/定位符的审计。Adoption 由数据库唯一键保证 first-wins，`adopted` 只代表成功复制；Escalation 保持非终态并按 query/action 返回稳定事实。只有搜索成功而 telemetry INSERT 单独不可用时返回零事件的 `collection_disabled`。

`G1A-E0 T1～T3` 只存在于 API 测试支持目录：读取器要求仓外绝对规范路径、0700 根目录、0600 当前用户普通文件、固定四成员、无软/硬链、大小/LF/canonical JSON、仓外 manifest SHA-256 锚点、与实际 ID 清单绑定的 comparison manifest hash、DLP/独立性 EVD 和 20+12+18 冻结分母；装载器在一次性 PostgreSQL 15 中用正式 question/governance hash 与四域 source gate 做事务内后验，任一失败整批回滚。runner 以 `REPEATABLE READ READ ONLY` 事务调用同一 `SearchBackend/SearchRepository`，保持 HTTP、事件和桌面不参与。Node 网络守卫的观察面显式为 `NODE_TCP_FETCH_GUARD_ONLY`，`process_guard_attempts=0` 不能冒充宿主级零出站或 OS 沙箱；成功或失败都必须关闭 client、停止集群并删除临时目录，报告只保留白名单聚合字段。T3 仅自动评估 `expected_search_action`，其候选结论写入 `search_action_result`；`downstream_action` 在 T5 前保持 `NOT_EVALUATED`，因此整体 `decision` 不得提前通过，硬失败还会使受控包命令非零退出。该实现不进入 `apps/api/dist`，纯合成结果固定为 `NOT_SIGNED / NOT_EVALUATED`。

`负责人承接 B1/B2` 接收固定 source Git 的 OpenAPI 1.12.0 / schema.v1.15，根接收器校验版本和双路径的封闭配对。生成器保持 0001–0011 不变，把六段 owner 增量提取为一个原子 0012；数据库后验涵盖新增两表、NOLOGIN 登记角色及函数/触发器/ACL，API readiness 把四个新增搜索依赖加入受信摘要。登记能力不授予 runtime；输入与 loader 由下述 B3 接续，真实准入仍由后续独立切片负责。实施证据见 [B1/B2 记录](plans/2026-09-06-owner-contract-consumption.md)。

`负责人承接 B3` 仅扩展测试支持链：闭合 v3 第五文件和独立外部记录/主体锚点；内容身份模块统一 canonical JSON、审核前投影与最终摘要。loader 使用实际来源确定 tenant，在同一事务以登记角色写入，再由数据库独立校验实际内容和完整 scope，失败整批回滚。owner 评测采用 `READ COMMITTED READ ONLY` 保持来源/撤销 fence，v2 行为不变；未新增生产 API、runtime 权限或桌面接入。验证见 [B3 记录](plans/2026-09-06-owner-acceptance-loader.md)。

## 3. 三个窗口和安全边界

| WindowRole | Renderer | preload | 主要能力 |
| --- | --- | --- | --- |
| `fox` | `FoxApp` | 有 | 浮窗拖拽、贴边、快捷键唤起、打开 Query |
| `query` | `QueryApp` | 有 | 本地检索、复制、布局高度、打开 Dashboard |
| `dashboard` | `DashboardApp` | 无 | 静态合成 Dashboard、主题和导航 |

所有受信 renderer 都通过 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 的窗口偏好运行。`apps/desktop/src/shared/overlay-events.ts` 和 `apps/desktop/src/shared/contracts.ts` 是 main 与 preload/renderer 共同遵守的协议边界。任何新能力都应先增加窄类型的 channel、validator 和失败返回，再接到 UI。

Dashboard 没有 preload 是有意的限制，不是遗漏。正式 Dashboard 未来若需要 API，也应新增受信的只读 adapter，而不是把通用 IPC 或 Node 权限塞进当前窗口。

## 4. 数据边界

```text
SYNTHETIC_SCRIPTS ──local searchScripts──> Query view model
                                      └──copyText──> system clipboard

DASHBOARD_MANIFEST ──read-only──> Dashboard modules

contracts/upstream/customer-agent/<contract_set_id>
  ──VERIFIED_NOT_ACTIVATED──> packages/contracts codegen
                                ├─ bundle.generated.yaml
                                ├─ openapi.generated.ts
                                └─ 132 component runtime schemas
                                          ├─ HealthResponse ──> apps/api GET /health
                                          └─ Ready/NotReady ──> apps/api GET /ready

v1.14 migrated PG15
  ├─ app_runtime pool ──> readiness + policy read + controlled SearchRepository
  └─ isolated app_content_admin pool ──> set_policy_flag（唯一受控写入口）

/v1 search + events ──synthetic transaction 可用──> renderer 仍不允许直连
/v1 desktop adapter ──尚未实现──> renderer 仍不允许直连

仓外 G1A-E0 package ──test-only verifier──> ephemeral PG15
  └─ same SearchBackend + zero events ──> scrubbed aggregate report（NOT_SIGNED）
```

`apps/desktop/src/renderer/features/search/search-service.ts` 是当前原型模式的本地 n-gram 检索器；它返回展示用 `RankedScript`，不等同正式 API 的 candidate。正式衔接必须在 `DEV-M0～M3` 的对应切片由本仓 main-process adapter 和正式服务模块完成，不能把 fixture 直接插入正式表，具体字段缺口见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。

合同快照只由 `scripts/customer-agent-contract-set.mjs` 接收和复核：目录成员、来源 commit、字节数与 OpenAPI / DDL SHA-256 任一不符即失败。`packages/contracts` 在该验证之后生成并校验组件合同；它不修改消费锁，`runtime_activated=false` 继续成立。`apps/api` 读取 provenance 和 HTTP component validators；renderer、main、preload 和现有桌面合成搜索均未导入该包。当前 `/v1` 已实现 mock auth、policy、synthetic-only Search + Events 主链；桌面 adapter 仍不存在，真实 `approved_redacted/pilot_recorded`、飞书身份和运行激活均保持关闭。

## 5. 测试和验证层级

```text
unit          纯函数、协议、脚本和安全门
  ↓
component     React 状态、焦点、拖拽、可见反馈
  ↓
e2e           Electron 窗口与多进程链路
  ↓
manual        真 macOS / Windows、Stage Manager、Dock、签名与合成器
```

常用入口：

```bash
pnpm test             # contracts + API + desktop unit/component；不含 Electron E2E
pnpm test:contract    # 生成物、132 个 component schema 与正反边界
pnpm test:api         # 配置拒启、未注册路由、合同 health 与真实 loopback
pnpm --filter @customer-agent/api test:integration # 隔离 PG15 runtime pool/schema/ACL
pnpm test:g1a:e0    # 真实包同形的纯合成 E0：输入边界、PG15、同一 SearchBackend、清理
pnpm test:g1a:e0:package # 仅在仓外真实包及 manifest SHA 已获授权时运行
pnpm contracts:codegen:check # 重新生成到内存并做字节级零漂移检查
pnpm test:float       # 浮窗相关快速回归
pnpm test:e2e:float   # build 后只跑浮窗 E2E
pnpm check            # Linux/本机统一非设备总门；含候选产物生成与扫描
pnpm artifact:m0:verify # 只复核非部署型 contracts/database/API 候选产物
pnpm lint
pnpm typecheck
pnpm build
```

自动化 renderer 点击不能冒充真实 WindowServer、Dock、Stage Manager 或 Windows 合成器证明。真实设备门禁继续列在 [如何验证桌面 Demo](how-to-verify-desktop.md)。

## 6. 生成物与清理边界

源码仓只保留可复现输入和冻结证据。以下内容可以重新生成或重新安装：

| 类型 | 路径 | 处理方式 |
| --- | --- | --- |
| Electron/Vite 输出 | `apps/desktop/out/` | `pnpm clean:generated` |
| 本地未签名包 | `release/local-unsigned/` | `pnpm clean:generated` |
| W6 非部署型正式服务候选 | `release/m0-formal-runtime-candidate/` | `pnpm artifact:m0:build` 重建；`pnpm clean:generated` 清除 |
| 派生打包图标 | `apps/desktop/build/icon.png`、`icon.ico`、`icon.icns` | `pnpm clean:generated`；按需重新运行图标生成或打包脚本 |
| 测试报告 | `apps/desktop/test-results/`、`apps/desktop/playwright-report/` | `pnpm clean:generated` |
| Vite 临时缓存 | `apps/desktop/node_modules/.vite*` | `pnpm clean:generated` |
| API TypeScript 输出 | `apps/api/dist/` | `pnpm clean:generated` |
| 依赖 | 根、`apps/api/node_modules/`、`packages/database/node_modules/` 与 `apps/desktop/node_modules/` | 只有归档时才用 `pnpm clean:deep` |
| CodeGraph 索引 | `.codegraph/` | 本地工具状态，不进业务提交 |
| 用户参考 ZIP | `clawd-on-desk-0.15.0.zip` | 只读、忽略、不得复制资源进仓 |

`pnpm workspace:check` 只给源码、测试、文档和已纳入资产设置预算，不把依赖和本地工具缓存误算成代码膨胀。它还验证根 workspace 门面不声明版本，并要求 `.gstack/package-json-path` 唯一指向 `apps/desktop/package.json`，避免发布版本与安装包版本分叉。清理器是精确 allowlist，遇到未知路径或符号链接会停止。

## 7. 当前架构评价

当前目录结构已在 DEV-M0 基线上完成 DEV-M1 W0～W5，并已合并 G1A-E0 T1～T3：合同接收、组件校验、migration 控制面、API host、runtime 读写能力、policy-admin 写能力、SearchBackend、event transaction、legacy synthetic runner 与 test-only E0 runner 各有单一 owner，两个 API pool 不共享登录，桌面运行时权限未放宽。v1.12→v1.14 与 v1.13→v1.14 都有精确后缀规划和 PG15 证明；DEV-M1 最终 `main@5cf650c`、CI run `33785779859` 三路全绿，候选产物仍明确不可部署且 `runtime_activated=false`。E0 的成功/失败清理和 50 条同形合成闭环已本地通过，但仍为 `NOT_SIGNED / NOT_EVALUATED`；真实数据、正式飞书鉴权、桌面接线、生产部署和真实 Windows 门均未放行。

三个高耦合入口仍保留主状态机：`overlay-controller.ts` 负责窗口生命周期 / handoff / bounds，`QueryApp.tsx` 负责查询命令与焦点，`DashboardApp.tsx` 负责侧栏四阶段与拖宽。本轮只抽出可独立证明的叶子：overlay 命令工厂、`reportableOverlayPhase` / layout ACK 映射、Query 壳层 class / CSS vars / 数字键排名、Dashboard tooltip 几何，以及 renderer-only 的 Fox 睡眠计时与 CSS 变量写入。不移动 setBounds、焦点、handoff ACK 或导航状态机。

Fox presence 的纯姿态解析、deadline 计算与数值几何保留在 `apps/desktop/src/shared/fox-presence.ts`；依赖 DOM、`setTimeout` 与 `Date.now` 的运行时所有权集中在 `apps/desktop/src/renderer/lib/fox-presence-runtime.ts`。Main 与 preload 不得导入后者。

叶子模块的输入、输出、协议边界和对应测试见 [抽取叶子模块合同](reference-extracted-module-contracts.md)。该页是维护参考，不把这些 helper 提升成跨窗口公共 API。

## 相关文档

- [第一次运行客服话术浮窗 Demo](tutorial-first-run.md)
- [如何验证桌面 Demo](how-to-verify-desktop.md)
- [桌面合同](reference-desktop-contracts.md)
- [抽取叶子模块合同](reference-extracted-module-contracts.md)
- [失败安全说明](explanation-failure-safe-lifecycle.md)
- [API adapter 衔接](reference-api-adapter-handoff.md)
- [Application API 启动配置与拒启矩阵](reference-api-runtime-config.md)
- [`@customer-agent/contracts` 使用与边界](../packages/contracts/README.md)
- [`@customer-agent/api` 使用与边界](../apps/api/README.md)
- [`@customer-agent/database` 使用与边界](../packages/database/README.md)

B4 的 `apps/api/tests/support/g1a-e0/assemble-package.ts` 拥有仓外规范化输入到唯一新 v3 包的派生、完整读取校验与失败清理；复用 content-identity 和输入读取器，不拥有批准签发、真实资料抽取或评测运行。操作入口只在显式环境开关下执行，留在 test-support 边界内，不进入 API 产物。详见 [B4 实施记录](plans/2026-09-06-owner-package-assembler.md)。
