# 项目架构与目录边界

本页说明产品仓当前模块职责、运行时边界和文件归属。它描述当前代码，不等于生产架构已经完成；仓库身份和产品化生命周期见 [`PROJECT_CHARTER.md`](../PROJECT_CHARTER.md)，正式衔接见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。本期资料接入保持 `v0.3.26`，P2 合同消费锁已推进到 OpenAPI `1.22.0` / `schema.v1.25`；`packages/database` 当前为三十五段，前34段 SQL 与来源保持不变，`0031` 接收冻结发布政策 DDL，`0032` 接入确认直发事务，`0033` 原子安装已批准的组织、会话、目录及用途权限伴随合同，`0034` 追加冻结CSV输入格式守卫，`0035` 仅补齐旧目录校验的八个函数执行权限。API 已按服务端固定的 `direct-v1` 创建新候选，保留来源确认和质量检查；发布／回退不再创建人工审批，通过 Main 原生二次确认表达操作意图，最终权限、范围、版本和原子提交由 API / SQL 复核。旧 `approval-v1` 候选必须显式修订后才能首次直发；已发布历史与混合目录继续保留旧审批谱系和失效规则，旧未知操作只查原回执。显式 FAQ 合成 profile 已接线规范 CSV/XLSX 上传、候选修订／取消、质量检查、来源确认、确认发布及坐席查询复制；未装配审批 provider，不开放生产路由或新应用 ACL。实现、验证与剩余接入条件见 [P2 交接](reference-content-intake-p2-contract-handoff.md)。`packages/retrieval-core` 已把 BM25、RRF、余弦相似度、分数门槛和字符分词下沉为纯算法包，产品字段权重、数据读取和 Electron 接线仍留在桌面 adapter。DEV-M0 / DEV-M1、G1A-E0、D1～D5 的历史切片和批准边界继续保留在本页与对应计划中；S0 桌面默认仍走合成 fixture，显式 loopback 接入 profile 已接线合成 adapter。合成登录后的查询主链见 [桌面语义检索](reference-desktop-retrieval.md)。真实业务数据、正式 runtime activation 和生产数据接入仍未放行。

## 1. 先看整体

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main                                                  │
│  apps/desktop/src/main/main.ts                                  │
│   ├─ overlay-controller       Fox / Query overlay 生命周期      │
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
│   ├─ QueryApp     查询胶囊、BM25/embedding/hydrate Top 3、复制   │
│   ├─ DashboardApp 五项工作台（概览 / 话术库 / SOP / 内容 / 同步） │
│   ├─ LoginApp     飞书 / 账号 chooser（独立原生窗，非 overlay）   │
│   └─ SopApp       过敏售后流程切片 1（独立 SOP 窗，非 overlay）   │
└────────────────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────────────────────────┐
│ shared                                                         │
│ contracts / overlay-events / query-layout / geometry / security │
│ 只放跨 main、preload、renderer 必须一致的类型与纯函数              │
└────────────────────────────────────────────────────────────────┘

contracts/upstream（不可变输入；同一受锁 snapshot）
  ├─ packages/contracts（bundle / generated TS / runtime validator）
  │    └─ apps/api → 合成身份 / 内容闭环 / search / announce（loopback only）
  ├─ packages/retrieval-core（BM25 / RRF / similarity / threshold；纯算法）
  │    └─ apps/desktop → shared adapter 注入字段权重、分词和检索策略
  └─ packages/database（0001..0035 / catalogue / ledger / verify）
       └─ migration owner 控制面（只 apply/verify，不进入 API 请求路径）

apps/api（DEV-M1 COMPLETE）
  ├─ runtime pg.Pool → readiness + policy read + SearchBackend + Events
  ├─ isolated admin pg.Pool → PolicyAdminRepository → set_policy_flag only
  ├─ product-auth-service → isolated auth pool → frozen identity SQL
  │    └─ synthetic / Feishu identity providers → PKCE login-requests + loopback password or Feishu OAuth
  ├─ content-object-store + content-import-service → CSV/XLSX persist then runtime enqueue
  └─ legacy synthetic G1a runner → isolated PG15 → same SearchBackend（NOT_EVALUATED）

apps/api/tests/support/g1a-e0（test-only；不进入 dist）
  └─ off-repo closed package → verifier → isolated PG15 → same SearchBackend
                                      └─ scrubbed aggregate report + mandatory cleanup
```

桌面主链：狐狸浮窗打开查询 → 每次产品检索先 `refreshAnnounce` → main 在仓外索引上 BM25 + 可选 MiniMax → hydrate 当前发布原文 Top 3 → 人工选择 → 白名单 IPC 写入剪贴板。有 hydrate 时不把问句交给 leftover `/v1/search`。Live UUID 查询的「话术不准」走 `product:inaccuracy-report` → `POST /v1/inaccuracy-reports`。细节见 [桌面语义检索](reference-desktop-retrieval.md)。Dashboard 一期五项：管理概览、话术库、SOP、内容管理、系统同步。没有产品会话或没有冻结合同的数字写「未接入」，不读 VOC / 工单合成 manifest 冒充生产。话术库走独立 `dashboard.ts` preload 的 `dashboard:wording-list`，优先 announce 内存 snapshot（`matchesLease`），没有 snapshot 才回退磁盘 hydrate / 本机检索索引。待办走 `dashboard:iteration-*` → 冻结 iteration-tasks。ops-loop 走 `dashboardOps`：检索账、SOP 树、话术下架 `pending_review`、软件目录。管理员发布在 Main 里 `publishDraft`：内部 `POST /v1/content/import` 等到 staged，再 `POST /v1/content/publish`；不 park `/v1/admin/content/reviews*`。renderer 仍不直连 API。并行 API 只放行 synthetic；真实业务内容仍未接通。正式飞书身份可在本机 `feishu.env` 下接通，不等于生产部署。

## 2. 目录归属

| 目录 | 只负责什么 | 不应该放什么 |
| --- | --- | --- |
| `apps/desktop/src/main/` | BrowserWindow 生命周期、原生能力、IPC handler、关闭与失败安全；D1 会话、D2 搜索复制、D3 `product-announce.ts` 拥有租约/ACK/快照分页/`content-updated`、D4 无命中求助入口、D5 经 API 消费发布链；仓外 BM25 / hydrate / MiniMax 规划与重排；Query `product:inaccuracy-report`；Dashboard 话术库只读 `dashboard:wording-list`、内容 `dashboard:content-*`、话术优化待办 `dashboard:iteration-*`、ops-loop `dashboard:ops-*`、系统同步 `dashboard:announce-*` 与 origin-keyed `product-last-seen` | React 视图、业务 fixture、通用 HTTP 客户端 |
| `apps/desktop/src/preload/` | overlay `index.ts` 把 `CustomerAgentApi` 白名单暴露给 Fox/Query；`login.ts` / `sop.ts` 是独立入口，通道字符串必须内联 | `ipcRenderer` 通用转发、Node 文件系统、token、独立 preload 去 import `ipc-channels.ts` |
| `apps/desktop/src/renderer/` | 狐狸、查询胶囊、Dashboard、登录 chooser、SOP 投影和其 CSS | Electron 主进程对象、数据库连接、真实客户数据 |
| `apps/desktop/src/shared/` | 跨边界协议、类型、校验器、几何、状态纯函数，以及把产品字段权重、分词和弃权策略接到 `@customer-agent/retrieval-core` 的检索适配器 | 依赖 DOM、Electron、React 的实现，或把产品策略硬编码进通用检索包 |
| `apps/desktop/` | 当前唯一 Electron workspace package；拥有源码、测试、配置、桌面资产、打包输入和产品版本 | Application API、DB、真实数据，或第二套 Electron 入口 |
| `apps/desktop/assets/`、`apps/desktop/fox-head.png` | 品牌主资产与可确定性派生的 app icon 输入 | 截图、构建包、临时导出 |
| `apps/desktop/scripts/` | 图标生成、桌面打包与包后验 | 运行时业务逻辑、workspace 合同接收 |
| `apps/api/` | 命名 profile、公开/私有配置分离、Fastify 生命周期、runtime/admin 双 pool、mock/Feishu 登录 provider（配置边界见 API 运行配置）、service readiness、策略读写、受控搜索与事件事务边界、合成 CSV/XLSX 持久接收、冻结 iteration-task 列表/开始/关闭、OpenAPI 1.14.0 ops-loop HTTP（不准、SOP、话术草稿、检索账、软件目录） | 桌面 fixture、renderer、migration owner、未获准的真实组织/审批输入、真实业务数据、桌面 adapter、worker 解析或外部 bind |
| `apps/api/tests/support/g1a-e0/` | 测试专用仓外输入校验、一次性 PG15 装载、同一 SearchBackend 评测、聚合报告与清理 | HTTP route、事件写入、桌面依赖、长期数据库、真实内容或正式构建产物 |
| `apps/api/tests/support/intake-synthetic-*.ts` | 全新临时 PG15、合成 FAQ/SOP 来源、实际身份／资料 HTTP 模块及直发状态统计；只提供受控合成宿主与清理 | 桌面 adapter、业务配置、已有数据库、真实身份／飞书、正式 factory／ACL、审批 provider 或自动续期 |
| `scripts/intake-synthetic/` | 跨应用合成验收与前台 CLI；SOP 测试组合上述 HTTP 宿主及真实 Main `ContentIntakeUsage`，验证第二坐席复制文字、系统图片预览及资源清理，归入 `pnpm test:intake:synthetic` | API 反向导入桌面、生产运行装配、真实数据；内存剪贴板回调不替代 OS／Electron 人工验收 |
| `apps/api/src/search-decision.ts`、`search-relations.ts` | 产品搜索判定、内部诊断，以及有界正文关系/否定/论元语义；实验复用同一规则 | 人工来源注解、实验 fixture、HTTP 诊断字段或绕过来源门禁 |
| `apps/api/experiments/search-decision/` | 合成搜索判定实验与验收工具：固定产品源码哈希 + 仅重定位 import 的诊断副本、合成夹具、需求判定和事实/行为/失败门禁 | 产品 `src` 行为、SearchBackend、真实来源、runtime 依赖、正式构建产物 |
| 根 `scripts/` | 合同快照接收、workspace 卫生门、架构依赖门（`pnpm check:architecture`）、W6 正式服务候选产物组装与隔离后验 | Electron 运行时、UI、真实凭证或部署动作 |
| `contracts/upstream/` | 来自项目记录仓、带来源 SHA 与双哈希的不可变机器合同快照及消费锁 | 手改合同、运行时跨仓读取、凭证、生成类型或 Ddev 状态真源 |
| `packages/contracts/` | 在共享快照锁内确定性生成 OpenAPI bundle、TS 类型和 component runtime validator；构建 Node 可执行 `dist`，拥有生成物指纹、验证扩展与有上限的脱敏错误形状 | HTTP host、路由策略、DB migration、renderer、凭证或真实数据 |
| `packages/retrieval-core/` | 纯 TypeScript 检索算法：BM25、RRF、余弦相似度、分数门槛和字符分词；通过显式输入隐藏算法细节，不拥有产品字段、HTTP、Electron、数据库或 UI 策略 | `apps/*` 依赖、产品字段权重、合成/真实数据读取、运行时 I/O |
| `packages/content-intake/` | 标准 FAQ 的 XLSX / CSV 解析、预算前检、错误/模板实物及可取消子进程；`faq-rules.ts` 独占格式无关业务校验，`csv.ts` 拥有原字节 CSV 格式边界；同一 runner 按服务端来源上下文选择解析器，P2 API 消费正式编译产物 | 不拥有授权/审批/正式候选、renderer IPC、真实来源或自行发布；experiments/csv 只保存合成原字节夹具 |
| `packages/job-roster/` | 稳定职务目录、有限别名窗口，以及 `GET /v1/auth/job` 响应解析。登录登记和桌面按钮都读 `JOB_ROSTER`。登录仍只自动签发 `query` | 不连接数据库，不签发授权。Electron 预加载不能引用这个包，权利表在预加载里手写同一份句子 |
| `apps/api/src/content-intake/` | 产品会话主体到组织／岗位／业务授权交集；原子授权、接收／解析、服务端 direct-v1 材料冻结、修订／取消与来源确认；候选质量计划及逐条人工检查复用封闭 DB 存储；publication 拥有确认意图、精确原操作恢复与内部 SQL 原子发布；仅在事务确认成功或已提交回执恢复后登记图片预览，回滚和未知提交不提前投影；rollback 拥有上一版完整影响预检、全部影响范围复核及新发布回执；evidence 保留来源确认与只读旧审批历史，四个审批写口拒绝 MODE_CONFLICT；usage 统一拥有会话／店铺／选择绑定、来源材料一致性、混合政策谱系、最早截止、逐页重验和坐席投影；discovery 投影来源资格及绑定会话／完整权限版本的分页 | 仅隔离 PG 合成消费者，无生产 HTTP factory／新 ACL；不安装新审批 provider，不制造审批通过，不创建第二 current，不隐式 bootstrap／认领旧同域内容 |
| `apps/api/src/content-intake/usage-http.ts` | 六条发现/词表/店铺目录/资格/快照 HTTP 路由的认证、查询解码、正式错误与响应校验；保留认证私有引用，复用既有 usage 事务 | 仅隔离合成宿主显式注册；不导入桌面，不注册生产工厂，不授予新应用 ACL |
| `apps/api/src/content-intake/grants-http.ts` / `authority.ts` / `discovery.ts` grants | 冻结授权合同的列表、只读预览、创建与撤销/接管 HTTP；预览与创建共用批次校验，列表在 SQL 扫描前按当前可管理范围收窄，最终仍复核母授权；管理插件借出同一个 requireProductSession service | 仅合成宿主注册；不建立第二权限规则、不创建 root allocation；游标不携带无权范围的扫描行，预览没有持久写或回执 |
| `apps/api/src/content-intake/management-http.ts` / `files.ts` | 管理端上传、接收与有界串行解析；服务端摘要、永久回执、容量门、会话锁、材料分页与 Excel 错误报告；来源确认、只读旧审批、确认发布／取消／回退及主体+action+operationId 回执查询；共享 http-boundary.ts 拥有认证引用、错误封口及分页解码，候选地址与正文键必须一致 | 仅隔离合成宿主显式注册；新审批请求／刷新返回 MODE_CONFLICT；不接受客户端角色、材料摘要／正文行或审批结论；质量 HTTP 保留摘要／样本／提交／回执；上传消费管理上下文及参与人目录；回退仅支持上一版，越范围须新纠正候选 |
| `apps/desktop/src/main/content-intake-usage.ts` | Main 当前店/选择、代际与取消；复用 ProductSession 最小能力，原子组装分页目录和原文复制；每个目录句柄核验会话/上下文/原截止，正常发布不撤销旧句柄，已知撤权/退出/换店使全部失效 | 仅封闭探针及显式 FAQ 合成 Query 调用；不注册生产 factory 或第二 current，不持久化正文，不替代 ProductAnnounce，SOP/media 非空拒绝 |
| `apps/desktop/src/main/content-intake-access.ts` | 同一 ProductSession 的权限/来源完整分页、可见权限一致性复读、取消/会话代际与 query 店铺筛选；返回限时选择提示，真实使用仍重签资格 | 不缓存权利、不构成跨 HTTP 原子快照、不发明店铺名称；供封闭探针及显式 FAQ 合成 Query 组合；未注册生产 factory |
| `apps/desktop/src/main/content-intake-query.ts` / `content-intake-query-ipc.ts` | 单个可信 Query 的独立发现/查询任务、登记词项选择及截止、BM25 Top 3、当前展示句柄及窗口销毁；查询取消不取消店铺发现，使用资格仍由 usage 拥有；IPC 验证 main-frame/role/exact payload | 仅显式 loopback FAQ profile；不接旧 announce/hydrate、模型、管理写口；不扩大正式 ACL，索引超预算整次失败 |
| `apps/desktop/src/main/content-intake-upload.ts` / `content-intake-native-files.ts` | FAQ 原生 CSV/XLSX 上传生命周期、精确旧键修订、贡献人声明、原操作恢复、解析任务与完整 XLSX 错误报告；文件模块独占原生选择、有限读取和原子保存 | 仅合成 profile；路径/文件字节/actor/原键留 Main；停止等待不撤销服务端任务；报告复用 ProductSession 的认证、epoch 与有限 XLSX 响应 |
| `apps/desktop/src/main/content-intake-management.ts` / `content-intake-management-ipc.ts` | Dashboard 候选／材料选择、来源权限提示、限时投影与关闭提醒；Main 保管来源确认、发布、取消的精确原操作正文；direct-v1 发布冻结请求后调用默认取消的原生确认，迟到确认受会话／取消代际及当前权限约束；人工质量检查复用 ContentIntakeQuality；新审批命令拒绝，旧审批只读；未知直发查原回执或重试原请求，旧审批发布仅查原回执，成功后另读当前状态 | 仅 FAQ loopback 合成 profile；窄命令不接受 actor/key/操作 ID/URL；来源失权和会话变化清空材料；确认不等于权限或审批通过，旧未知请求不得改写 confirmed 后重发 |
| `apps/desktop/src/main/content-intake-rollback.ts` | 独占上一版回退计划、影响摘要和精确未知操作恢复；执行前复用 Main 原生确认展示目标与范围；管理模块拥有会话、取消和有效期，renderer 只传版本选择与操作意图；旧审批历史可读但不续期 | 仅 FAQ 合成 profile；回退是新的确认发布，不直接还原 current；旧未知审批请求只查原回执；权限不足只展示有权范围和纠正上传入口 |
| `apps/desktop/src/main/content-intake-permissions.ts` / `content-intake-permissions-ipc.ts` | 内容管理内的业务权限配置；复用完整授权/来源发现与已登记人员目录，持有限时选择句柄、只读预览、精确保存/撤销请求、未知结果恢复及窗口关闭提醒；人员自己的较早截止独立失效 | 仅 FAQ 合成 profile；renderer 不构造主体/范围/操作键；当前姓名不可用的历史授权按记录编号、范围和原原因核对，不猜名字；本片 UI 不新增 delegation/root allocation/接管操作 |
| `apps/desktop/src/main/seat-account-ipc.ts` | `faq-v2` 的 `dashboard:seats-command`：把 list/create/reset/disable 意图交给合成栈运行脚本；人员进 `customer_agent_synthetic`，口令只写 salt/哈希 | 仅 `contentIntake === "faq-v2"`；renderer 不持主体 ID；43101 每次重读口令文件，读失败 503，仍不交换新建坐席；`preview=intake` 不走这条 IPC |
| `apps/desktop/src/shared/seat-account-intent.ts` | `isSeatAccountIntent`、`seatAccountReply`、`SeatAccountApi`、`SeatAccountRecord`（`displayName`、`username`、`post`、`enabled`） | 只校验四种意图的字段形状；登录名正则在合成栈 `seatUsername` |
| `apps/api/src/content-intake/discovery.ts` managementContext | 在原内容事务和发布锁内投影当前来源版本、本人 principal、事实版本、发布基线及最早有效期；只允许当前来源 import，receive 重新验权并比较版本 | 只读输入提示，不是资格、租约或提交票据；仅隔离宿主注册，不从 userId 推断主体或把未知基线当空值 |
| `apps/api/src/content-intake/discovery.ts` candidates | 会话及完整权限绑定的候选游标；每页最多扫描 limit 个版本，readiness 复用 readCandidate | 可因动态状态过滤返回带 nextCursor 的空页；非同一时刻快照；不推断当前发布基线 |
| `apps/api/src/content-intake/discovery.ts` principals / `transaction.ts` 身份投影 | 冻结参与人目录的来源/用途授权、会话及权限绑定游标；transaction 统一拥有主体事实/岗位投影，一次批量读取最多 limit+1 条身份；合成宿主显式注入登记标签 | 贡献人可禁用或无业务 grant，授权接收人复用原岗位/同人规则并须事实新鲜；标签不由账号推导，缺失整页失败；目录不是授权或同一时刻快照，不新增姓名表或真实员工读取 |
| `apps/api/experiments/content-intake-p1/` | P1 权限/委派、材料/人工审批证据与提交点合成模型；复用 test-support 身份摘要工具 | API dist、正式 HTTP/DB 权限、真实飞书请求或第二发布指针 |
| `packages/database/` | 在同一已验证快照内确定性生成三十五段 migration：0031/0032 为直发增量，0033 原子安装冻结运行伴随合同，0034 追加CSV格式守卫，0035追加旧CHECK执行闭包；前34段保持原字节；拥有 catalogue、私有账本、合法前缀／N-1 升级规划、同会话锁／事务、稳定错误及 PG15 精确后验 | 创建连接、读取环境变量、API repository、desktop adapter、凭证、真实数据、部署或备份恢复 |
| `apps/desktop/tests/unit/` | 纯函数、协议、脚本和安全合同 | 真实 OS 交互断言 |
| `apps/desktop/tests/component/` | React 状态、焦点、拖拽和视图行为 | 打包产物验证 |
| `apps/desktop/tests/e2e/` | Electron 窗口、renderer→preload→main 的集成链 | 把合成输入写成真实 macOS/Windows 证明 |
| `docs/`、`evidence/qa/` | 可读合同、教程、验证方法和冻结证据 | 可执行源码、运行时缓存 |

历史 OpenAPI1.19 管理上下文未新增 DDL，当时26段 SQL 的来源和校验和保持不变。当前1.21/schema1.23消费保留前32段，已有三十二行账本只追加0033。迁移规划器仍允许同 DDL、不同合同身份的已审前序，但逐行来源和校验和不得改写；旧1.17与1.18的同目录兼容证据保留。证据见[管理上下文验收](../evidence/qa/content-intake-p2-management-context/README.md)。

产品迁移 `0026_intake_discovery_index` 只增加非撤销授权按主体/范围/来源/动作/截止检索的物理索引；`authorization_deadline` 仍是业务判定所有者，原 ACL 与旧迁移不变。容量消费及边界见[授权发现验收](../evidence/qa/content-intake-p2-discovery/README.md)。

`apps/api/src/content-intake/organization/` 单一拥有事实 writer、原生字段/分页观察和版本化登记刷新，复用 content lock、事实历史/版本指针及 revocation generation；0033 已接收冻结组织存储与 provenance 同事务义务。只接受可信服务注入的组织 transport 和受限组织池，不创建主体或业务 grant。`experiments/intake-organization/http-transport.ts` 仍拥有固定回环 HTTP、响应预算和取消释放；应用级 session owner 按租户/app 共享令牌代次、失效、关闭及配额，借用 transport 不得重置配额。正式飞书 transport 仍未装配，双扫描不证明上游原子性。实际合成受限池结果见[本轮接入](../evidence/qa/intake-parallel-recovery/runtime-formal/README.md)，[旧组织刷新](../evidence/qa/intake-organization/README.md)和[旧原生观察](../evidence/qa/intake-organization/native-observer/README.md)仅保留对应历史输入的证据。

`apps/api/experiments/intake-runtime/runtime-candidate.ts` 是合成装配候选的单一生命周期所有者：只接受显式本机Unix socket、五个不同登录角色、受控对象目录和同tenant/app的合成身份/组织输入，拥有启动校验、回环HTTP、共享组织令牌/配额和关闭顺序。既有auth拥有会话，组织模块拥有登记观察/事实写入，business/usage/worker service继续拥有业务，候选不重新实现授权或发布。它保留私有actor且额外要求当前scope的有效组织登记；这不替代真实OAuth租户证明或可信registrar的一致绑定。候选不进入API dist、不被生产app/server导入，实际23项PG15和关闭异常边界见[装配证据](../evidence/qa/intake-runtime-closeout/README.md)。

`apps/api/src/content-intake/capacity.ts` 是 P2 磁盘容量生命周期的唯一 API 所有者，复用对象存储分配 ID、落盘前准入、持久删除。0029 私有账本在既有内容锁下统一计入输入、报告、普通/回滚审核包；所有调用方在同一业务事务采用。释放先写 tombstone 阻止迟到采用，再在锁外删除文件并同步目录，最后释放额度。未知提交、已登记引用、未知磁盘文件和历史资料不得因超时推断可删除。报告预留被明确拒绝时仍将任务终结，避免占满候选配额。没有新 renderer/HTTP 能力或生产 ACL；规则与实际证据见[容量验收](../evidence/qa/content-intake-p2-capacity/README.md)。

产品迁移 `0028_intake_family` 拥有完整原生目录的显式家族关系与冲突证明，正常发布/回退通过同一 publications 触发器执行；usage在签资格和每页读取时复用私有校验。解析包只解释K列显式编号，API材料保存合同字段；usage按授权、时间、商品/场景先筛选，再以选中组合的完整覆盖选择店铺稿/通用回落，最后分页。没有renderer规则副本、标题推断或第二current；旧发布遇family明确拒绝，应用ACL仍关闭。

产品迁移 `0031_intake_direct_v1_22` 接收不可变发布政策、确认时间及跨政策复合外键；`0032_intake_direct_publication` 接替0024／0027中的私有发布与回退运行函数，复用同一 release/catalog/lineage/current/公告原子事务。新操作要求 confirmed，票据不伪造审核人；混合目录按原政策继承真实旧审批及来源／内容失效门。服务器记录确认受理时间，当前操作人权限和最早截止仍在最终事务复核。0032当时保留security-invoker；0033后按冻结用途ACL交NOLOGIN属主以SECURITY DEFINER执行，旧app_*没有新增EXECUTE；API 同时写永久回执并在 COMMIT 前重验截止，旧未知操作不得改写成新直发。字段/证据映射见[P2 交接](reference-content-intake-p2-contract-handoff.md#候选到发布底座的映射差集)。

产品迁移 `0023_intake_quality` 拥有不可变候选质量计划/逐条检查及质量状态投影，不签发发布资格，应用 ACL 不变。

`apps/api/src/content-intake/quality-access.ts` 拥有质量 HTTP 的有界摘要、完整样本分页、进程/会话/事实/授权/候选/阶段绑定游标及精简历史回执；`quality.ts` 继续拥有内部计划与阶段提交，复用合同 validator，写前用 PostgreSQL 实际 jsonb 文本检查字节预算。两者均复用同一事务与永久回执，不新增质量引擎。OpenAPI1.18 仅改 HTTP，生成器固定全部 26 条旧迁移的来源与校验和；规划器只在相同 DDL 哈希时允许完整旧目录作为已审前序。

`apps/desktop/src/main/content-intake-quality.ts` 拥有 Main 内存中的候选键、完整质量样本、人工检查草稿和未知写入恢复。复用 ProductSession 的身份与传输，由隔离合成根探针及显式 FAQ profile 的 Management 消费；renderer 仅传人工判断，生产入口仍未放行。每页 8 MiB、最多 500 页且合计 32 MiB，不交部分数据；历史回执只解决原操作结果，当前状态须重新读取。

产品迁移 `0022_intake_legacy_fence` 在既有数据库发布入口内拥有旧整域写影响集、统一首锁及目录/谱系继承；API 不自行复制该判断。内部 helper 只供现有 definer，应用 schema 继续封闭。边界与验证见[资料导入开发说明](how-to-develop-content-intake.md#p2-旧发布入口共存门)。


### 依赖方向门

显式 FAQ profile 不创建 `ProductAnnounce`；Main 仍为共享 Fox 注册既有公告 IPC 的 null 服务分支，返回不可用投影并保留 sender/role/main-frame 门。该分支没有旧公告、hydrate 或网络副作用，不代表 FAQ 已提供未读公告能力。

`pnpm check:architecture` 读取源码和 workspace 的 package 依赖，不启动应用，也不改运行时行为。失败时退出码非零，并打印文件、规则和修复方向。别名只认 `apps/desktop/tsconfig.json` 的 `paths`（与桌面 bundler 使用的是同一张表）。

| 规则 | 禁止 | 当前允许 |
| --- | --- | --- |
| `renderer-no-privileged-import` | renderer 导入 main、preload、`electron` 或数据库（`@customer-agent/database`、`pg`、sqlite） | `@shared/*` 纯类型与纯函数、renderer 自己的 React 视图、`@customer-agent/contracts` 类型 |
| `preload-no-generic-ipc` | 把 `send` / `on` / `invoke`，或调用方传入的 channel，暴露给 renderer | 对 preload 内部写死的 channel 调用 `ipcRenderer`；私有 helper 可以收口多个固定 channel |
| `packages-no-app-dependency` | `packages/*` 的源码或 package 依赖指向 `apps/*` | 依赖其他 package、Node 内置模块和根 `scripts/` |
| `api-no-desktop-dependency` | `apps/api` 的源码或 package 依赖指向 `apps/desktop` | `@customer-agent/contracts` 与 `@customer-agent/database`。D5 合成整链只允许 `apps/api/tests/backend-runtime.e2e.test.ts` 动态装载 main 的 `product-http`、`product-session`、`product-announce`、`product-search` |
| `shared-no-ui-runtime` | `apps/desktop/src/shared` 依赖 React、DOM 或 Electron，包括再导入 renderer、preload、main | `import type` 自 `@customer-agent/contracts`，以及 `node:crypto` 这类纯计算 |

`document` / `window` 作为普通参数名或协议字段（例如检索文档、`RetrievalWindow`）不是 DOM 依赖。共享包不得因此改读浏览器全局对象。

`DEV-M0-W1` 只把现有桌面包原样移入 `apps/desktop`，并同步 package、路径、测试和打包配置；根 `pnpm` 命令继续作为唯一公开入口。该切片不得混入 IPC 改造、API、DB 或 UI 行为，迁移后的模块边界和依赖方向保持不变。

`DEV-M0-W2` 把“合同接收”与“合同编译”分为两个写入所有者：根 intake 脚本验证、保存不可变输入并拥有 rollover/read snapshot 互斥；`packages/contracts/scripts/generate-contracts.mjs` 只从锁内一致快照生成产品资产。生成器拒绝外部 `$ref`、来源版本/双哈希漂移和手改生成物，并保留已登记的 `x-unique-by` 验证扩展；运行时 validator 按 schema 延迟编译，只返回数量有上限的 schema 路径与关键字，不回显请求正文。

`DEV-M0-W3` 由 `apps/api/src/runtime-config.ts` 单独拥有 profile、auth、bind、port、build version 与错误脱敏；配置必须先于 Fastify 构造通过。该历史切片当时只有 `formal-dev|test + AUTH_MODE=mock + 127.0.0.1` 可启动；当前 Feishu 配置条件见 [API 运行配置](reference-api-runtime-config.md#1-单一-profile)；公共 package 入口只提供 `startApi()` 和窄 `close()` 生命周期，不暴露 Fastify 实例或替换路由 owner 的 factory。自动 HEAD 派生继续关闭。

`DEV-M0-W4` 由 `packages/database` 单独拥有 DDL source split、不可变 SHA catalogue、`customer_agent_meta.schema_migrations` 账本、固定 advisory-lock key、逐 migration 事务与后验验证。生成器机械证明上游可执行区间完整且只归属一次；runner 要求调用方传入同一个已连接 `pg.Client`，并把 migration 与账本行放在同一事务。API startup 不调用这一控制面，runtime pool 不获得 migration-owner 能力。

`DEV-M0-W5` 在 `apps/api/src/runtime-config.ts` 增加只在进程内传递、仅允许本机 PostgreSQL 的 DB bootstrap config，并由 `apps/api/src/service-repository.ts` 单独拥有一个 `pg.Pool`、schema 指纹、single-flight deadline、错误归一化与幂等关闭；`runtime-diagnostics.ts` 只输出稳定、脱敏的运行诊断词表。`GET /health` 不触碰依赖；`GET /ready` 通过一次只读查询核对 database、PostgreSQL 15、`schema.v1.12`、8 个函数 + 2 个视图的完整可信 search 依赖摘要、`pgcrypto.digest` extension 所有权、runtime/login/definer 双向角色边界、parameter ACL，以及当前数据库和全部用户 schema 的精确表/列/函数有效 ACL。任意非 owner 的 `public CREATE` 与 deadline 后才完成的成功探针也失败关闭；auth/storage/content 明确保持为 `not_ready`。因此 W5 的服务可以监听并证明基础设施状态，但仍不会获得业务就绪或 runtime activation。

`DEV-M1 W0/W1` 在不改写上述历史切片的前提下前滚到 `schema.v1.13`：第十段 migration 只替换受控 search projection 与 schema comment，精确的 v1.12 ledger 只计划 `0010`。API 新增进程内 opaque mock session、成对 mock header、策略只读路由和 Owner-only 管理写入口。私有 bootstrap 在任何 pool/Fastify 构造前验证两条不同登录 DSN 指向同一数据库目标、总连接预算和互不复用的 HMAC 域；管理 SQL 每次写入前同时证明登录、`app_content_admin`、`cs_ai_definer`、`set_policy_flag` 定义和 ACL，任一角色或函数漂移均失败关闭。未捕获请求异常只返回稳定 500 合同，不回显原始错误；空 JSON、坏 JSON、超大正文和不支持的媒体类型统一返回稳定 400。

`DEV-M1 W2` 继续以追加方式接收 `schema.v1.14`：第十一段 migration 只增加 ready-no-hit 上下文，精确 v1.12/v1.13 ledger 分别只规划缺失后缀。API 的 `SearchRepository` 在一条参数化 SQL 内完成 scope-only 快照读取并返回已门禁候选池；`search-decision` 拥有相关性、确认/断言冲突与 Top 3；`SearchService` 映射公开候选字段。历史 bigram AND + ILIKE 主召回已由该判定层取代，来源/平台/商品/有效期门禁仍只在数据库。W2 结束时 `/v1/search` 已有鉴权、输入门禁、脱敏/HMAC 与稳定错误壳，但 operation 暂时固定 503；该临时边界已由下述 W3/W4 事务接线取代。

`DEV-M1 W3/W4` 由 `EventRepository` 拥有 runtime `PoolClient` 事务、版本化 HMAC 幂等、fencing 和事件状态机。搜索在同一事务内完成受控检索、`query_events`、精确候选四元组和 `idempotency_complete`；当前只放行 synthetic，查询文本固定 suppressed。来源拒绝先回滚业务事务，再用新连接写不含原文/定位符的审计。Adoption 由数据库唯一键保证 first-wins，`adopted` 只代表成功复制；Escalation 保持非终态并按 query/action 返回稳定事实。只有搜索成功而 telemetry INSERT 单独不可用时返回零事件的 `collection_disabled`。

`G1A-E0 T1～T3` 只存在于 API 测试支持目录：读取器要求仓外绝对规范路径、0700 根目录、0600 当前用户普通文件、固定四成员、无软/硬链、大小/LF/canonical JSON、仓外 manifest SHA-256 锚点、与实际 ID 清单绑定的 comparison manifest hash、DLP/独立性 EVD 和 20+12+18 冻结分母；装载器在一次性 PostgreSQL 15 中用正式 question/governance hash 与四域 source gate 做事务内后验，任一失败整批回滚。runner 以 `REPEATABLE READ READ ONLY` 事务调用同一 `SearchBackend/SearchRepository`，保持 HTTP、事件和桌面不参与。Node 网络守卫的观察面显式为 `NODE_TCP_FETCH_GUARD_ONLY`，`process_guard_attempts=0` 不能冒充宿主级零出站或 OS 沙箱；成功或失败都必须关闭 client、停止集群并删除临时目录，内部报告保留聚合及逐题候选观测；输出通过版本化安全交付合同。T3 仅自动评估 `expected_search_action`，其候选结论写入 `search_action_result`；`downstream_action` 在 T5 前保持 `NOT_EVALUATED`，因此整体 `decision` 不得提前通过，硬失败还会使受控包命令非零退出。该实现不进入 `apps/api/dist`，纯合成结果固定为 `NOT_SIGNED / NOT_EVALUATED`。

`负责人承接 B1/B2` 接收固定 source Git 的 OpenAPI 1.12.0 / schema.v1.15，根接收器校验版本和双路径的封闭配对。生成器保持 0001–0011 不变，把六段 owner 增量提取为一个原子 0012；数据库后验涵盖新增两表、NOLOGIN 登记角色及函数/触发器/ACL，API readiness 把四个新增搜索依赖加入受信摘要。登记能力不授予 runtime；输入与 loader 由下述 B3 接续，真实准入仍由后续独立切片负责。实施证据见 [B1/B2 记录](plans/2026-09-06-owner-contract-consumption.md)。

`负责人承接 B3` 仅扩展测试支持链：闭合 v3 第五文件和独立外部记录/主体锚点；内容身份模块统一 canonical JSON、审核前投影与最终摘要。loader 使用实际来源确定 tenant，在同一事务以登记角色写入，再由数据库独立校验实际内容和完整 scope，失败整批回滚。owner 评测采用 `READ COMMITTED READ ONLY` 保持来源/撤销 fence，v2 行为不变；未新增生产 API、runtime 权限或桌面接入。验证见 [B3 记录](plans/2026-09-06-owner-acceptance-loader.md)。

## 3. 窗口和安全边界

`OverlayRole` 只有 `fox | query`。`RendererRole` 是 `fox | query | dashboard | login | sop`（`apps/desktop/src/shared/overlay-events.ts`，由 `window-role.ts` 从 `?role=` 读取）。

| RendererRole | Renderer | preload | 主要能力 |
| --- | --- | --- | --- |
| `fox` | `FoxApp` | overlay `index.cjs` | 浮窗拖拽、贴边、快捷键唤起、打开 Query |
| `query` | `QueryApp` | overlay `index.cjs` | 查询胶囊、BM25/hydrate 或未登录 S0 fixture 检索、复制、布局高度、打开 Dashboard / SOP |
| `dashboard` | `DashboardApp` | 独立 `dashboard.cjs`（`dashboardWording` / `dashboardContent` / `dashboardIteration` / `dashboardOps` / `dashboardAnnounce`） | 五项工作台；话术库只读当前发布 hydrate（`list().matchesLease`）；管理员下架 DELETE → pending_review；SOP 读/导入/更新当前会话树（删除仅管理员）；待办 live list/start/close；KPI 走 retrieval metrics；CSV/xlsx 经 `dashboard:content-parse`；管理员发布走 import-then-publish（无独立 import IPC）；软件目录禁止 latest.yml；打开下载页走 `ops-software-open` |
| `login` | `LoginApp` | 独立 `login.cjs` | 飞书 / 账号 chooser；isolated session；不进 `trustedContents()` |
| `sop` | `SopApp` | 独立 `sop.cjs` | 过敏售后流程树投影；Query 可同时开；Dashboard 打开时 SOP `hideRememberingProgress()`；不进 `trustedContents()` |

所有受信 renderer 都通过 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 的窗口偏好运行。`apps/desktop/src/shared/overlay-events.ts` 和 `apps/desktop/src/shared/contracts.ts` 是 main 与 preload/renderer 共同遵守的协议边界。任何新能力都应先增加窄类型的 channel、validator 和失败返回，再接到 UI。

Dashboard 没有 overlay 的 `customerAgent`（search / login / copy / inaccuracy）。独立 `dashboard.cjs` 只暴露话术库只读、内容会话/解析/发布、话术优化待办 list/start/close、系统同步投影，以及 `dashboardOps`（检索账 / SOP / 话术下架 / 软件目录 / 打开下载页）。这是有意收窄，不是「完全无 preload」。ops-loop HTTP 已由 Main `dashboard-ops-loop.ts` 消费冻结合同；不要把通用 IPC 或 Node 权限塞进当前窗口。

## 4. 数据边界

下图合同组件数与数据库版本保留旧切片示意（165 / v1.17），不是当前 P2 版本；当前消费范围以页首和 [P2 交接](reference-content-intake-p2-contract-handoff.md)为准。图形版本标注尚待专门同步，本次未重绘。

```text
SYNTHETIC_SCRIPTS ──local searchScripts──> Query view model
                                      └──copyText──> system clipboard

dashboardWording.list ──snapshotCatalog (matchesLease) / 磁盘 hydrate 回退──> 话术库
dashboardOps           ──scriptDelete pending_review──> 话术库下架
dashboardIteration     ──iteration-tasks──> 管理概览待办
dashboardContent       ──parse / publishDraft (import-then-publish)──> 内容管理
dashboardOps           ──sop catalog/import/patch/delete──> SOP
dashboardOps           ──metrics/retrieval──> 管理概览 KPI
dashboardOps           ──software/releases──> 系统同步软件目录
productSearch.reportInaccuracy ──POST /v1/inaccuracy-reports──> 话术不准

contracts/upstream/customer-agent/<contract_set_id>
  ──VERIFIED_NOT_ACTIVATED──> packages/contracts codegen
                                ├─ bundle.generated.yaml
                                ├─ openapi.generated.ts
                                └─ 165 component runtime schemas
                                          ├─ HealthResponse ──> apps/api GET /health
                                          └─ Ready/NotReady ──> apps/api GET /ready

v1.17 migrated PG15
  ├─ app_runtime pool ──> readiness / search / events / import / announce / iteration-tasks / ops-loop
  ├─ isolated app_content_admin pool ──> policy / publish / rollback
  └─ 独立 auth / worker / review 能力池 ──> 产品会话 / 导入处理 / 审核质量门

/v1 search + events ──synthetic transaction 可用──> renderer 仍不允许直连
/v1 auth adapter ──D1 会话与 D2 search/copy 已接线──> renderer 仍不允许直连

仓外 G1A-E0 package ──test-only verifier──> ephemeral PG15
  └─ same SearchBackend + zero events ──> scrubbed aggregate report（NOT_SIGNED）
```

上图 Dashboard 数据面不再走 `DASHBOARD_MANIFEST` 冒充生产数字。话术库、待办、内容发布、ops-loop（SOP / 检索账 / 话术下架 / 软件目录）和 Query 不准落库画在该 ASCII。没有产品会话时这些写口仍 fail-closed 为「未接入」。

未登录的 S0 仍由 `apps/desktop/src/renderer/features/search/search-service.ts` 做本地 n-gram，返回展示用 `RankedScript`。合成登录后由 main `ProductSearch` 走仓外 BM25 + RRF 与可选 MiniMax；有 hydrate 快照时不打 leftover `/v1/search`。见 [桌面语义检索](reference-desktop-retrieval.md)。正式衔接必须在对应切片由本仓 main-process adapter 和正式服务模块完成，不能把 fixture 直接插入正式表，具体字段缺口见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。

`customer-agent-contract-set/v2` 工具仅为 1.21.0/schema.v1.23 组合候选增补九件封闭运行伴随输入（共十二件包），逐件绑定源 Git、安装清单、外层 SHA 和消费锁；暂存副本必须与已核验源 manifest 完全一致。受锁消费者提供只读 `runtime_sources`，静态接收不执行 SQL 或代替运行安装器校验迁移账本。治理 `e35c0c0` 已冻结并导出完整包，产品已实际 intake；生成器验证前32段安装依赖后追加0033，消费锁仍 VERIFIED_NOT_ACTIVATED。 CSV v3 已按治理 `adbc7b1` 实际接收14件封闭包，核对来源SHA独立冻结/批准并拒绝浅克隆；0034只追加已冻结CSV增量，前33段不变。现行 v4 从治理 `db6ba13` 实际接收16件包，保留旧CSV installation与十项依赖，外加新安装清单和ACL；0035事务先核验旧34段的完整物理状态，再授权、写账本并核验新状态，任一步失败整体回滚。其完整性与历史兼容规则见 [P2 合同交接](reference-content-intake-p2-contract-handoff.md)。

合同快照只由 `scripts/customer-agent-contract-set.mjs` 接收和复核：目录成员、来源 commit、字节数与 OpenAPI / DDL SHA-256 任一不符即失败。`packages/contracts` 在该验证之后生成并校验组件合同；它不修改消费锁，`runtime_activated=false` 继续成立。`apps/api` 读取 provenance 和 HTTP component validators；D2 main 使用该包的运行时 validator；shared 仅导入合同类型，renderer/preload 不加载合同运行时。当前 `/v1` 已实现合成产品身份、内容导入与审核发布、公告、synthetic-only Search + Events 主链、coach/owner 的冻结 iteration-task 列表/开始/关闭，以及 OpenAPI 1.14.0 ops-loop；桌面 D1 会话/HTTP adapter 已实现，D2 搜索与复制已接线，不准落库与 `dashboardOps` 已接到同一产品会话，方案为 APPROVED。真实 `approved_redacted/pilot_recorded` 与正式运行激活仍受各自批准门约束；飞书登录 provider 已存在，P2 原生组织观察/登记刷新/writer 已进入 src 单一所有者并仅由合成 host 装配；本期确认直发不装配审批 transport，旧审批只保留历史读取和失效约束。

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
pnpm test:contract    # 生成物、165 个 component schema 与正反边界
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
pnpm check:architecture # 模块依赖方向；不启动应用
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

`pnpm workspace:check` 对所有保留输入实行三个独立 allocated-byte 预算：源码/测试/文档/资产/迁移/生成源码与配置 19.25 MiB、冻结合同 `contracts/upstream/` 16 MiB、冻结证据 `evidence/` 10.5 MiB，总量 45 MiB；任一分组或总量超限均失败。依赖、各已知包构建输出和精确派生图标单独统计，不误算成源码增长，也不借此排除未知文件或冻结历史。分组共享 inode 计数以避免重复统计硬链接，实际字节构成与批准依据见[预算收尾证据](../evidence/qa/intake-size-closeout/README.md#批准后的正式预算检查)。它还验证根 workspace 门面不声明版本，并要求 `.gstack/package-json-path` 唯一指向 `apps/desktop/package.json`，避免发布版本与安装包版本分叉。清理器是精确 allowlist，遇到未知路径或符号链接会停止。

## 7. 当前架构评价

当前目录结构已经把合同接收/校验、migration 控制面、API host、runtime/admin 双 pool、SearchBackend、事件事务、内容导入/发布、桌面产品 adapter、测试专用 E0 runner 和生产栈 supervisor 分到各自 owner；两个 API pool 不共享登录，renderer 权限未放宽。2026-10-14 在 `4a22c6b` 上运行 `pnpm check:architecture`，438 个源码/配置文件、0 个依赖方向违规。更早的记录仍有效：`main@4739c39` 的 CI run `37024571842` 是 303 个文件、0 违规；统一工作台当时是 389 个文件、0 违规。`runtime_activated=false` 和 synthetic-only 边界仍保留。

FAQ 合成 profile 与旧工作台复用 `DashboardApp.tsx` 内的 `DashboardWorkspace`：外壳独占侧栏、键盘导航、标题栏与主题；profile 只选择可用模块。faq-v2 是六个页签：管理概览、话术库、SOP、知识库、权限、系统同步。导航 id `content` 的文案是「知识库」，挂载 `DeskKnowledge`，本机文件是 `userData/desk-knowledge.json`。`IntakeManagement` 仍在仓库中供组件测试使用，这个 profile 不挂载它。同一常驻 `IntakeLibrary` 投影话术库；它的 SOP 页签没有目录时写「未接入」。SOP 页没有打开本机六表时写「未接入」；运营打开 xlsx 后只读展示未发布原文，不调用 `POST /v1/sop/import`，图片不入库。使用情况没有来源时，列表和导出都写「未接入」，不写文件。权限不进入 `DASHBOARD_MODULE_IDS`。上文 ASCII 仍画一期五项，那是旧工作台。知识库主按钮用紫色。字段见 [DESIGN.md](../DESIGN.md) 的「当前工作台（faq-v2）」、[人设知识库](reference-desk-knowledge.md) 和[资料页与权限页](reference-intake-pages.md)。

四个结构性改造已落地：ARCH-01 的依赖方向门、ARCH-02 的 `@customer-agent/retrieval-core`、ARCH-03 的 API runtime/config/features 拆分，以及 ARCH-04 的桌面平台/查询 view-model/展示组件拆分。它们降低了跨层变更放大，但没有为了行数强行拆散状态机：`overlay-controller.ts`、`QueryApp.tsx` 和 `DashboardApp.tsx` 仍分别拥有窗口 handoff、查询焦点和工作台导航状态。

剩余耦合是有意保留的产品语义：检索 adapter 仍绑定桌面字段与发布租约，API `server.ts` 仍组合本项目的路由和合同，主状态机仍集中在上述入口。三份可复用能力 RFC（合同运行时、Migration 控制面、安全边界）均为 `DRAFT · 等待第二个真实消费者`；当前项目单独通过不能证明跨项目复用，出现第二个真实消费者前不继续抽公共包。

CodeGraph 已就绪：仓根有 `.codegraph/`，本机 CLI 与 MCP 服务均可用（当前服务版本 1.6.0），本轮已用它读取跨模块调用路径。索引属于本机工具状态，不提交到业务仓；改代码前优先用 CodeGraph，索引过期或不可用时按 `AGENTS.md` 的规则降级到定向源码检查。


三个高耦合入口仍保留主状态机：`overlay-controller.ts` 负责窗口生命周期 / handoff / bounds，`QueryApp.tsx` 负责查询命令与焦点，`DashboardApp.tsx` 负责侧栏四阶段与拖宽。本轮只抽出可独立证明的叶子：overlay 命令工厂、`reportableOverlayPhase` / layout ACK 映射、Query 壳层 class / CSS vars / 数字键排名、Dashboard tooltip 几何，以及 renderer-only 的 Fox 睡眠计时与 CSS 变量写入。不移动 setBounds、焦点、handoff ACK 或导航状态机。

Query 的模式确认可晚于原生窗口展开。overlay preload 在首次 `onOverlayCommand` 注册之后发出窄 `overlay:query-subscribed` 握手；Main 仅接受可信 Query 主帧，按当前开关意图重新建立交接，不在 preload 排队历史命令，不让迟到订阅撤销已完成的关闭。

Fox presence 的纯姿态解析、deadline 计算与数值几何保留在 `apps/desktop/src/shared/fox-presence.ts`；依赖 DOM、`setTimeout` 与 `Date.now` 的运行时所有权集中在 `apps/desktop/src/renderer/lib/fox-presence-runtime.ts`。Main 与 preload 不得导入后者。

叶子模块的输入、输出、协议边界和对应测试见 [抽取叶子模块合同](reference-extracted-module-contracts.md)。该页是维护参考，不把这些 helper 提升成跨窗口公共 API。

## 相关文档

- [第一次运行客服话术浮窗 Demo](tutorial-first-run.md)
- [如何验证桌面 Demo](how-to-verify-desktop.md)
- [桌面合同](reference-desktop-contracts.md)
- [桌面语义检索与检索内核](reference-desktop-retrieval.md)
- [抽取叶子模块合同](reference-extracted-module-contracts.md)
- [失败安全说明](explanation-failure-safe-lifecycle.md)
- [API adapter 衔接](reference-api-adapter-handoff.md)
- [Application API 启动配置与拒启矩阵](reference-api-runtime-config.md)
- [`@customer-agent/contracts` 使用与边界](../packages/contracts/README.md)
- [`@customer-agent/api` 使用与边界](../apps/api/README.md)
- [`@customer-agent/database` 使用与边界](../packages/database/README.md)
- [可复用能力 RFC：合同运行时、Migration 控制面与安全边界](rfcs/README.md)

B4 的 `apps/api/tests/support/g1a-e0/assemble-package.ts` 拥有仓外规范化输入到唯一新 v3 包的派生、完整读取校验与失败清理；复用 content-identity 和输入读取器，不拥有批准签发、真实资料抽取或评测运行。操作入口只在显式环境开关下执行，留在 test-support 边界内，不进入 API 产物。详见 [B4 实施记录](plans/2026-09-06-owner-package-assembler.md)。


### 离线报告交付的唯一所有者

`apps/api/tests/support/g1a-e0/report-contract.ts` 拥有失败码、冻结阈值、搜索结果状态映射、报告类型、输出字段校验、标识哈希化与逐题/分层/聚合一致性；评测器拥有搜索执行和实际观测，runner 拥有 PG 生命周期与清理。合同只在 test-support 使用，不进入 API dist，也不新增 HTTP 或 renderer 能力。

链路为 `verified package → actual PG runner → serializeG1aDelivery → G1A_E0_DELIVERY line → read-g1a-delivery.mjs → host exclusive save/readback`。正文和包内原始标识不会进入新 stdout；完整报告仍保持 NOT_SIGNED，下游动作只是期望且未执行。失败报告在正常清理后可以导出；清理失败则不输出可消费报告。

交付格式、读取方式及兼容边界见 [API 说明](../apps/api/README.md#安全报告交付)。外层操作器只拥有批准、宿主沙箱、进程、0600 排他保存与恢复；不读取 TS 源码推导 enum，也不重算业务结论。旧操作器与旧证据冻结，新候选必须使用匹配的新消费者，不把旧真实运行配置自动切换到未合并代码。


### T1 身份所有权

`runtime-config.ts` 唯一解析显式产品会话配置和三池总预算；`server.ts` 组合受控提供方与身份服务，失败时不建 mock。`AUTH_MODE=feishu` 且配了 loopback 口令 origin 时，`workforce-identity-provider.ts` 组合飞书 OAuth 与口令一次性 code；`feishu-identity-provider.ts` 只拥有飞书 authorize/token/user_info：`user_info` GET 跟随 HTTPS 跳转到 `open.feishu.cn` / `accounts.feishu.cn`（空或非 HTTPS 失败关闭），token POST 保持 `redirect: error`，写仓外显示名失败不得让登录失败。`product-auth-service.ts` 封装持久登录、会话、最小数据库角色和关闭；`synthetic-identity-provider.ts` 仅拥有 mock 合成 wire。口令 HTTP 在 `scripts/synthetic-stack/password-identity-server.ts`。`product-auth-routes.ts` 拥有封闭 HTTP 输入、静态完成页、错误响应和固定限流窗口。现有 auth/search/event/policy 路由统一等待异步认证；renderer 不直连；D1 Query 已通过窄 IPC 使用产品会话。

### D1 桌面产品会话所有权

`main/product-session.ts` 拥有 token、epoch、PKCE 与退出/过期；`product-http.ts` 拥有有界 HTTP（loopback 或 https 公网主机名）；`product-session-store.ts` 拥有按 `apiOrigin` 分文件的 safeStorage 密文；`product-login-window.ts` 拥有独立登录选择器、`allowedLoginUrl` 外开白名单与账号 callback GET；`product-ipc.ts` 绑定 sender/main-frame 与能力。shared 只提供脱敏状态/失败合同，preload 校验投影，Query 不获得 token。无环境变量的 S0 搜索保持本地；显式接入 profile 经 D2 的受控 adapter 搜索，绝不因 API 失败回退 fixture。

### D2 桌面候选与复制所有权

`main/product-search.ts` 持有按 sender、sessionEpoch、generation 绑定的后端候选，验证平台、商品范围、有效期与占位符后写剪贴板，再调用 adoption。取消、身份变化或窗口销毁使旧候选失效；复制与事件结果分开。`product-search-ipc.ts` 只允许 Query 主 frame 调用查询、取消、复制、escalate 和 terminal；接入 profile 禁止旧 `copyText` 任意正文入口。Query 只展示原文和类别，不展示数值分数。

### D3 桌面公告租约所有权

`main/product-announce.ts` 持有 current/snapshot/ACK 与离线租约；renderer 只看到脱敏发布视图。ACK 不续租，也不表示已读。租约绑定 sessionEpoch；失效后清候选。`QueryApp` 对 `source_gate` / `unavailable`：查询中或已有结果时走 ERROR，文案分别是「内容暂不可用，请联系话术师核实」/「服务暂不可用，请重试」，空闲输入态静默回 SEARCH_INPUT；只有 `expired` 才显示「当前版本已失效，请重新核验」。

### D4 桌面合成求助入口

无匹配时 Query 展示「没找到可用话术」，可复制联系方式或打开隔离求助窗。`opened` 只表示入口动作；状态限于「已打开入口 / 已复制联系方式 / 待核实」。`POST /v1/events/escalate` 是辅助动作，不冒充 terminal；用户明确离开无匹配结果时才记 `no_hit_exit`。

### D5 合成整链

`apps/api/tests/backend-runtime.e2e.test.ts` 在同一 PG15 进程链上跑导入、worker、审核、发布、回退，并用桌面 `ProductSession` / `ProductAnnounce` / `ProductSearch` 经 loopback 查询与复制。回退后旧候选 STALE；退出后本地会话清空。不经 Dashboard，不启动跨仓 runner。


`content-intake/transaction.ts` 是唯一内容事务 owner，直接调用冻结 `intake_runtime.lock_product_session`；ZA003/SESSION_UNAVAILABLE 映射为未授权。各业务 owner 可注册事务内最终不变量检查，但不得自行 COMMIT；最终事实/最早截止仍由事务 owner 复核。

SOP 单行删除合同已随批准的 schema1.28/0040 版本化接收，应用消费者仍留显式合成实验：`packages/content-intake/src/sop.ts` 唯一产生 `rowBindings`；治理候选拥有持久行映射与新版本删除 SQL；`apps/api/experiments/sop-row-deletion/consumer.ts` 只在显式合成测试装配中复用事务、资格、回执和提交后预览变更。`linked-preview.ts` 拥有预览数组别名与候选版本，解析成功登记版本、删除回执按版本及剩余行集合投影，空态也保留版本屏障，晚解析和旧回执不得改新版本。实验私有回执还绑定冻结材料的输入对象，删除只从该对象暂存字节生成独立候选预览，保留未删除图片且不修改既有发布别名。`trusted-stage.ts` 是同一实验的可信解析入口：从已采用对象读真实字节并校验摘要，复用唯一 SOP parser/material 构造，经已接收后继窄函数在同事务写候选、词项、job、完整行和媒体。新解析行显式列入 `freshRowIds`；继承只接受精确发布谱系与完整行／媒体映射；本轮持久候选逐张验证系统附件，不再因缓存为空拒绝继承。缺文件或错误摘要仍明确拒绝。图片字节读取在内容锁外完成，最终事务重新核对同一份行／媒体快照与资格；validated 恢复只取该 job 自己未采用的预约描述符，经已有带锁释放能力清理冗余副本，未知提交继续保留。预览在 COMMIT 前暂存输入、确认成功后采用，明确回滚只清本次暂存，未知提交保留。旧冻结 DELETE/204 未改；正式 HTTP/Main 与运行装配未接线，不从实验导入生产；持久字节读取仅在本轮候选实验显式装配。删除后重用由同一候选维护不可变删除事件：parser透传声明版本优先/无列hash的内容版本，新job不算新版本；旧版删除屏障不因新版本恢复当前媒体状态而消失。本轮后继候选将候选／发布媒体关系键补入 row_id，发布谱系的语句级触发器同事务写完整图片关系，图片原物理对象继续去重。正式0040已完成容量、并发和相关合成回归；HTTP/Main接线、生产装配及当前增量审查仍须各自完成，不由合同接收替代。

`content-intake/runtime-pool.ts` 唯一拥有四用途连接的显式 SET ROLE/assert_purpose、借出失败销毁及关停；连接配置由调用者显式提供，不创建角色或读取环境凭据。业务/usage 分别创建原 service，worker 只服务既有失败收尾和报告容量。组织 `organization/{facts-writer,feishu-observer,registered-refresh}.ts` 隐藏可信绑定、观察及写入/恢复，在受限组织连接内消费冻结 schema/mapping；HTTP transport 仍留实验目录，无生产飞书接线。

`shop-directory.ts` 借用原内容事务及真实 ProductSession，会话锁后 prepare 有界目录，最终 finish 和 deadline 通过才返回。Main `content-intake-access.ts` 完整消费分页并要求名称 shopId 集合与已授权 shops 相等，名称失败保留编号与可见提示；Query 只投影显示名，同名附 ID，不改变授权或新建 IPC。

独立合成 host 的 `purpose-runtime` 使用当前完整35段迁移及四个低权 LOGIN，实际组织登记/观察/写入后启动业务、usage、worker 消费者；没有 SQL 改写桥或候选重复安装。旧 experiments SQL/probe 测试显式固定旧32段基线，仅保留历史实验边界。当前实现/证据见[正式合同合成接入](../evidence/qa/intake-parallel-recovery/runtime-formal/README.md)。生产 app/server 注册、真实配置和真实数据仍未完成。FAQ 工作台接线见下一段，不把合成桌面验收等同生产激活。

`main/content-intake-catalog.ts` 独占 Dashboard 的店铺/商品/场景选择、完整分页读取和失效；复用独立的 `ContentIntakeUsage` 实例，与 Query 的资格、选择和复制句柄隔离。每条所属域只取本次签发资格的唯一 source→domain 映射，重复/缺失映射拒绝，整组超限不截断显示。窄 `content-intake-catalog-ipc.ts` 仅接受 Dashboard 主 frame 的 current/command，窗口销毁释放实例；preload 不暴露 URL、身份、资格或复制能力。`IntakeLibrary` 保持一份视图供话术库/系统同步使用，正文失效即清空，名称失效只回退编号。它表达当前条件下可用内容，不是全库清单、公告已读或同步完成证明。上传来源的域由既有 discovery 权限投影透传，显示在原上传选择器。验证见[统一工作台合成证据](../evidence/qa/intake-unified-workspace/README.md)。


`packages/content-intake/src/csv.ts` 隐藏UTF-8/CSV语法、固定23列、来源逐记录绑定与预算；`faq-rules.ts` 单一拥有FAQ/问法业务约束，runner在隔离子进程按受信模板选择CSV/XLSX并核对返回policy。`apps/api/src/content-intake/input-format.ts` 单一拥有登记template/rule/mapping/structure到MIME、context和逻辑selectedSheets的映射，由files/service/material消费。Main只拥有原生有界读、原字节及未知请求重放；renderer不提供路径、MIME或解析结果。CSV采用运行依赖csv-parse7.0.3，不新增服务或生产注册。实验目录仅保留合成模板与历史说明；实际验证见[CSV接入](../evidence/qa/intake-csv-runtime/README.md)。

SOP 持久图片候选由原 `content-object-store.ts` 拥有私有 obj 文件与独占文件锁，`experiments/sop-row-deletion/media-lifecycle.ts` 拥有同任务稳定预约、持锁重核、写入登记及失败清理，治理候选窄函数复用原 objects/object_reservations 容量账本。文件锁不随 DB 断连释放；所有附件写入及通用回收共用它，锁作用域结束前等待真实 I/O 完成。未知提交、锁竞争及崩溃残锁保守保留计费，不做自动 TTL 清理。`persistent-media.ts` 只读取绑定会话／租约的行级图片元数据及单张已授权文件；`usage.ts` 继续唯一拥有会话、当前权限、租约、适用性与最终截止核验，先过滤行再对可见图片去重。图片读取分为授权选取、锁外读文件、返回前重新选取三步，第二个短事务核对同一图片及最早授权截止，避免持有全局内容锁等待磁盘。内部 payload ID 不进 HTTP，列表不携带字节，文件坏损不能回退内存缓存。生产 factory 不注入这个实验 reader；旧调用默认内存 reader。

预览暂存的回滚恢复由 `linked-preview.ts` 拥有：`stagePreviews` 返回绑定本次快照的 `commit/rollback` 句柄；明确回滚跳过已回滚前驱，成功提交只结算本次快照并截断其前驱链，不影响后继暂存。两个解析调用方各持有自己的句柄；普通发布别名采用不结算待定暂存。service 对未知冻结保存原句柄和完整候选键，同一存活实例重试经当前授权及数据库结果确认后才恢复，不借用可变输入槽，也不承诺重启恢复。同候选版本的删除回执只从当前预览集合收缩，末行取消的空态屏障不能被旧回执扩大。完整取消由 owner 按候选版本清理同数组别名并保留版本屏障；迟到解析不能复活已取消版本，迟到旧取消不能清除更新投影。更高版本才可按准确输入对象重建。

### 精确修复后继的版本接收（2026-10-12）

治理 `export_customer_agent_repair_successor.mjs` 拥有批准记录、六件不可变冻结字节及 v6 八件导出包；累计 schema 只作参考，实际安装消费 upgrade。产品 `customer-agent-contract-set.mjs` 验证同一 Git 来源的批准/全部成员、39段前序及独立 `repair-contract-set.lock.json`，原主锁不变。合同生成器选择已验证 repair 快照；数据库生成器先重建并逐件比较原39段，再追加0040。runner 在0040事务内做前后物理校验及回执记账，COMMIT_UNKNOWN保留待恢复语义。治理来源提交379b793已正式导出，产品已接收独立repair锁与0040，生成合同的内容、ID、来源SHA及摘要统一取同一后继快照。接收状态VERIFIED_NOT_ACTIVATED；正式 HTTP/Main 和持久图片生产装配仍未开放。
