# 客服 Agent 产品 · Menokin 试点当前实现基线

本仓是客服 Agent 的**产品实施仓**，目标是在这里完成正式开发、测试、打包与上线。当前提交基线仍是本地合成原型，用来验证输入法式桌面浮窗，并用一个演示级 Dashboard 展示正式架构故事：

`狐狸头 / 快捷键 → 玻璃查询胶囊 → 本地合成 fixture → Top 3 原文 → 人工选择 → 安全复制`

`查询胶囊 Dashboard 图标 / 狐狸右键 / 系统菜单栏 → 客服经理决策 Dashboard（交互式合成 BI 镜像，非生产系统）`

**仓库身份与生命周期以 [PROJECT_CHARTER.md](PROJECT_CHARTER.md) 为准。Menokin 是当前唯一客服试点；`DEV-M0-W1～W6` 产品实施已完成：workspace、合同 codegen/runtime validation、loopback API/config、PostgreSQL 15 migration 控制面、runtime pool/`/ready`、统一 CI、Windows 可行性 smoke 与非部署型候选产物边界均已落入 `main@44b863d`。数据库仍未接入桌面端，业务端口与正式 runtime 也未激活。可运行的 v3 桌面应用仍是 `DEMO · 合成数据 · 无后端`，复制只表示「已复制」，不代发。**

下文出现的 “Demo” 均指当前 v3 原型模式，不再代表整个仓库永远只做 Demo。项目进度、G0 / Ddev 和批准范围记录在独立的 `ai-赋能立项` 仓；产品源码、运行时和发布实现只在本仓演进。

## 文档

| 你现在要做什么 | 打开 |
| --- | --- |
| 第一次把 Demo 跑起来，并走完狐狸头 → 查询 → Top 3 → 复制 → Dashboard | [docs/tutorial-first-run.md](docs/tutorial-first-run.md) |
| 按目标选择 lint / 测试 / E2E / 打包命令，并分清能证明什么 | [docs/how-to-verify-desktop.md](docs/how-to-verify-desktop.md) |
| 查阅三窗安全、IPC、layout ACK、handoff、图标与脚本合同 | [docs/reference-desktop-contracts.md](docs/reference-desktop-contracts.md) |
| 了解 main / preload / renderer / shared 的职责和清理边界 | [docs/reference-project-architecture.md](docs/reference-project-architecture.md) |
| 查阅本轮抽出的 Query / overlay / Dashboard 叶子模块合同 | [docs/reference-extracted-module-contracts.md](docs/reference-extracted-module-contracts.md) |
| 核对 Demo 与正式九端口 / Postgres 为何不能直插、adapter 要补什么 | [docs/reference-api-adapter-handoff.md](docs/reference-api-adapter-handoff.md) |
| 核对已接收的正式机器合同、双哈希和未激活边界 | [contracts/upstream/customer-agent/README.md](contracts/upstream/customer-agent/README.md) |
| 生成并验证正式 OpenAPI 类型与 component runtime schema | [packages/contracts/README.md](packages/contracts/README.md) |
| 启动并验证 W3～W5 的本机 `/health`、runtime pool 与 `/ready` | [apps/api/README.md](apps/api/README.md) |
| 生成、核验并在隔离 PostgreSQL 15 中测试 W4 migration | [packages/database/README.md](packages/database/README.md) |
| 核对 API 命名 profile、变量与失败关闭矩阵 | [docs/reference-api-runtime-config.md](docs/reference-api-runtime-config.md) |
| 当前上线主线：真实话术搜索准入；通过后按授权推进桌面接线与上线验收 | [docs/plans/2026-09-04-g1a-search-admission.md](docs/plans/2026-09-04-g1a-search-admission.md) |
| 已暂停的探索备忘：教师辅助选句与合成材料（不是上线前置条件） | [docs/plans/2026-09-05-script-selection-preparation.md](docs/plans/2026-09-05-script-selection-preparation.md) |
| 查看当前 DEV-M0 切片、基线证据与下一步 | [docs/plans/2026-08-31-dev-m0-execution.md](docs/plans/2026-08-31-dev-m0-execution.md) |
| 查看 W2 合同 codegen / runtime validation 的本地实施边界与证据 | [docs/plans/2026-09-02-dev-m0-w2-contract-codegen.md](docs/plans/2026-09-02-dev-m0-w2-contract-codegen.md) |
| 查看 W3 API/config bootstrap 的本地实施边界与证据 | [docs/plans/2026-09-02-dev-m0-w3-api-config-bootstrap.md](docs/plans/2026-09-02-dev-m0-w3-api-config-bootstrap.md) |
| 查看 W4 PostgreSQL migration 控制面的实施边界与证据 | [docs/plans/2026-09-02-dev-m0-w4-postgres-migrations.md](docs/plans/2026-09-02-dev-m0-w4-postgres-migrations.md) |
| 查看 W5 runtime pool / service readiness 的实施边界与证据 | [docs/plans/2026-09-03-dev-m0-w5-runtime-readiness.md](docs/plans/2026-09-03-dev-m0-w5-runtime-readiness.md) |
| 查看 W6 CI、Windows smoke 与正式服务候选产物的退出收口 | [docs/plans/2026-09-03-dev-m0-w6-exit-closure.md](docs/plans/2026-09-03-dev-m0-w6-exit-closure.md) |
| 推进 Menokin 试点的 S0 合成验证阶段，并核对红线和最小验收 | [docs/plans/2026-08-31-menokin-pilot-synthetic-stage.md](docs/plans/2026-08-31-menokin-pilot-synthetic-stage.md) |
| 了解产品文档生命周期，以及与项目状态仓的动态/历史边界 | [docs/reference-document-lifecycle.md](docs/reference-document-lifecycle.md) |
| 理解为何采纳 actual bounds、为何 Dashboard 失败要留下查询 | [docs/explanation-failure-safe-lifecycle.md](docs/explanation-failure-safe-lifecycle.md) |
| 查看版本变化与本次验证摘要 | [CHANGELOG.md](CHANGELOG.md) |
| 查看已明确延后的验证债务 | [TODOS.md](TODOS.md) |
| 查阅打包携带的第三方软件许可声明 | [apps/desktop/THIRD_PARTY_NOTICES.md](apps/desktop/THIRD_PARTY_NOTICES.md) |

项目本体并不大。用 `pnpm workspace:size` 可把源码与依赖、打包产物、工具索引分开统计；`pnpm clean:preview` 默认只预览可再生成项，确认清单后才运行 `pnpm clean:generated`。`pnpm clean:deep` 还会删除根、API、database 与桌面包依赖，适合归档或从 `pnpm install --frozen-lockfile` 重建。清理脚本不会触碰 `.git`、`.codegraph`、各包源码/测试、`apps/desktop/assets`、`evidence`、`docs` 或用户提供的 ZIP。完整边界见 [空间占用与清理](docs/how-to-verify-desktop.md#5-空间占用与清理)。

## 仓库与工作台

- 本目录应作为独立产品 Git 仓打开，不与项目进度记录仓混成同一工作树或 Git 历史。
- 不从本仓自动修改 `ai-赋能立项`；需要变更批准范围或阶段门时，单独进入项目记录仓处理。
- `apps/desktop` 是当前唯一可运行 Electron package；`apps/api` 是独立 Node 服务，当前只允许 loopback、mock auth 与合成 `search/adoption/escalate` 事务，不与桌面接线；`packages/database` 是 W4 的离线 migration 控制面，不创建连接、不读取环境变量，只有其显式 testkit 作为 API 集成测试的 devDependency，生产 API 不导入 migration 控制面。根 `package.json` 只保留稳定的 workspace 命令和仓级工具入口。产品版本只写入 `apps/desktop/package.json`，`.gstack/package-json-path` 固定后续发布工具也使用这一清单。
- `packages/contracts` 是正式 OpenAPI 的唯一产品仓编译边界；它只从已验证快照生成 bundle、TypeScript 类型与 component runtime validator，不拥有 HTTP、DB、桌面接线或运行时激活状态。
- `packages/database` 是正式 DDL 的唯一产品仓 migration 边界；它从同一受锁快照确定性生成 `0001..0009`、内嵌 catalogue 与私有账本，并封装 `status → plan → apply → verify`。当前只在一次性本机 PG15 cluster 中使用合成数据验证，不等于已有业务数据库或生产连接。
- 根目录 `logo-wordmark.png` 是用户提供的透明字标，请保留原文件。本仓原创 raster canonical 是 `apps/desktop/assets/fox-head-master.png`（1254 RGBA，由用户批准的透明构图确定性 scale/pad + 高置信内部 recolor 生产化，禁止 Bézier 临摹）。`pnpm generate:fox-head` 从该 master 字节一致派生透明 `apps/desktop/fox-head.png`：有机非对称旧帽子、宽紫帽檐、下半脸严格 `#F9D6C5`、唯一中央椭圆眼 `#A45C4A` 加短竖线、客服耳麦，无白点眼、无对称头盔。该 PNG 用于浮窗 / Query / Tray，并作为 Dashboard 浅色 Logo。Dashboard 深色模式使用独立的 `apps/desktop/src/renderer/assets/dashboard-fox-headset-dark.png`，只把耳麦换成白 / 浅灰，狐狸本体不反色。**默认情况下** `generate:fox-head` 还会继续调用 `generateAppIcons`，从共享透明狐狸派生 `apps/desktop/assets/app-icon.png`（近白 squircle）、`apps/desktop/build/icon.png` 与 `apps/desktop/build/icon.ico`；在 macOS 上还会生成 `apps/desktop/build/icon.icns`。只有显式 `--skip-icons` 才跳过 App / Dock 图标。不要把透明狐狸直接设为 Dock 图标，Tray 也不得使用白底 Dock 图。`evidence/qa/2026-08-17-approved-fox/` 里的五张小图只是批准构图的派生 QA，不替代 canonical。默认主题取消闭合蓝圆；键盘焦点是双耳外侧的紫色短弧，鼠标按下会立刻消失。
- Menokin 四域材料已存在于企业受控空间，但尚未授权进入本 Git 合成运行时；仓内话术与看板继续全部使用虚构合成内容。

## 环境

需要 **Node.js 24.x** 与 **pnpm 11.19.0**（见 `packageManager` 与 `.nvmrc`）。

```bash
cd ~/Desktop/customer-agent-prototype
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
hash -r
node -v    # 应为 v24.x
pnpm -v    # 项目锁定 11.19.0
export NODE_OPTIONS=--use-system-ca
export NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem
pnpm install --frozen-lockfile
pnpm electron:install
pnpm dev
```

W5 API 运行时骨架与桌面 Demo 分开启动；它开放本机 liveness 与真实基础设施 readiness，不提供业务数据：

```bash
CUSTOMER_AGENT_PROFILE=formal-dev \
AUTH_MODE=mock \
DATABASE_URL='postgresql://<runtime-user>@localhost/<database>' \
pnpm dev:api
curl --fail --silent http://127.0.0.1:3100/health
curl --silent --include http://127.0.0.1:3100/ready
```

`/health` 不访问 DB；`/ready` 只核对 database/schema，auth/storage/content 在 M1/M2 前固定 `not_ready`，因此 W5 返回 503 是预期的真实未就绪。部署型 profile、Feishu auth 与 `/v1/*` 仍会在监听前拒启或保持未注册，详见 [API 启动配置](docs/reference-api-runtime-config.md)。

W4 数据库包只接受调用方提供的已连接 migration-owner `pg.Client`；下面的命令只生成/核验不可变 catalogue，并在隔离临时 PostgreSQL 15 cluster 中测试，不会访问共享本机或生产数据库：

```bash
pnpm db:migrations:check
pnpm test:db              # unit + package smoke + 隔离 PG15 集成门禁
pnpm test:db:integration  # 只重跑隔离 PG15 集成门禁
```

`pnpm test` 只跑 database 的 unit/package smoke，不要求每位普通前端开发者安装 PostgreSQL；改动 migration、runner、verifier 或 PG harness 时必须另跑 `pnpm test:db`。其他电脑可通过 `CUSTOMER_AGENT_PG15_BIN` 指向自己的 PostgreSQL 15 `bin` 目录；Homebrew 安装可使用 `$(brew --prefix postgresql@15)/bin`。

上面的 PATH 是这台开发机已核实的 Node 24 安装位置；若迁移到别的电脑，请改用该电脑的 Node 24 路径。`NODE_OPTIONS=--use-system-ca` 与 `NODE_EXTRA_CA_CERTS` 只用于**当前这台机器**的企业证书环境，不是每台电脑的通用要求；没有企业拦截 TLS 时不要照抄。禁止关闭 TLS 验证。本项目用 `pnpm electron:install` 在唯一桌面包内显式准备锁定版本的 Electron 运行时；后续启动会复用本机缓存。应用不访问外部业务网络；`pnpm dev` 仅连接本机 Vite/HMR。逐步操作见 [第一次运行](docs/tutorial-first-run.md)。

## 交互

状态机：

```text
FOX_IDLE → SEARCH_INPUT → RESULTS | EMPTY | ERROR → COPIED → FOX_IDLE
```

| 操作 | 方式 |
| --- | --- |
| 打开查询 | 点击狐狸头，或 `⌘⇧空格` / `Ctrl+Shift+Space` |
| 查询 | `Enter`（中文输入法组合期不会误提交） |
| 收起 | 点击查询胶囊里的狐狸头、`Esc`、再次快捷键、或点击外部窗口 |
| 复制 | 卡片上的「复制话术」，或结果态按 `1 / 2 / 3`（含小键盘） |
| 打开工作台 | 查询胶囊上的 Dashboard 图标，或右键狐狸 / 查询窗后选「打开运营工作台」，也可从系统 Tray / 应用菜单进入；macOS 点击程序坞图标同样打开 / 恢复 Dashboard；打开后浮窗收起为狐狸 |
| 深度思考预留 | 点击「深度思考 · 预留 · OFF」查看 DeepSeek 辅助重排边界；当前不调用模型，也不改变 Top 3 |

建议演示顺序：

| 问法 | 预期演示点 |
| --- | --- |
| `澄芽氨基酸洁面怎么用` | 完整问法精确命中，稳定展示 3 条互补合成话术 |
| `澄芽洗面奶咋使` | fixture 内合成别名 + 使用意图命中，卡片显示「同义表达」 |
| `面膜过敏怎么办` | 品类 + 风险主题 + 售后意图的自然问法，召回合成售后话术 |
| `洁面拆封后能不能退` | 品类 + 退换主题的自然问法，召回合成退换规则 |
| `用了露芷面膜过敏了怎么办` | 高风险售后话术，明确人工复核 / 就医边界 |
| `青禾会员日积分怎么兑` | 已过期活动即使精确问法也 no-hit |
| `怎么用` | 无实体锚点的泛化意图 no-hit，避免为了演示硬凑候选 |
| `今天中午虚构星球食堂有没有排骨汤` | 业务无关问题 no-hit |

闲置时显示约 88px 的透明狐狸窗（狐狸视觉约 64px），待机动效约 3 秒一轮：4px 浮动、2° 摆动、轮廓呼吸。指针只在这只 88px 窗内时，整只狐狸会做非常克制的局部跟随，这不是全局眼球追踪。片刻无操作后会打盹、再睡着；窗口隐藏时睡眠钟暂停，重新可见后从头计时。任何局部活动或打开查询都会唤醒。点按有短促的戳感，拖过 4px 后会顺着方向被提起，拖太久会有一次很克制的烦躁反应。拖到当前屏左/右边缘 18px 内会自动吸附：原生窗口始终完整留在工作区，由 renderer 平移裁出等效 44px 窗区，对应 64px 狐狸视觉各露一半（32px），并重播一次方向性吸附。稳定半露时会做左右镜像的 inward-ready 动效：峰值向屏内探 3px、上抬 2px、内倾 5°并轻微放大，呈现“跃跃欲试”，但仍保持半露裁切和共享元素姿态连续。悬停或键盘聚焦时，狐狸用 420ms 镜像探头动效过渡到等效 80px 裁切；移开后用 300ms 反向动效缩回。这套贴边半露就是本项目的 mini mode，不是桌宠自由漫游。这样不会让 macOS WindowServer 与屏外透明窗反复争抢位置。打开采用两阶段共享元素交接：隐藏查询窗先按点击瞬间狐狸的真实位置、同尺寸 64px 和当前 2D 位移 / 旋转 / 缩放矩阵准备首帧，renderer 回执后才交换窗口并用约 260ms 的 `clip-path` 展开；贴边查询窗从物理屏幕边缘起步，保持 32px 半露轮廓连续。关闭约 200ms，抵达末帧后再反向换窗。玻璃只淡入淡出，不缩放模糊层；正常完成由动画回执驱动，定时器仅兜底。每个状态只一次性提交最终窗口 bounds，不逐帧 resize、不先弹出整颗贴边狐狸，也不让狐狸和查询同时消失。正常结果路径的高度是 Query 对 DOM 的实测 hug（capsule + banner + `result-content` + chrome + 容差），经 typed query-only layout / 纵向 resize IPC 上报后，Main 钳制到 `240..min(620, availableHeight)`（`availableHeight` 为当前 workArea 高减去 16px 边距），一次 `setBounds` 并 ACK，然后才展示内容。旧分档 `600×240 / 340 / 430 / 620` **只属于**测量缺失、过期或被拒绝时的异常 fallback，不是正常 Top 3 的固定窗高。查询中的狐狸会来回寻找，命中会弹跳，空态会歪头，复制后会点头；业务状态优先于待机动效。首击立即打开查询，不为识别双击增加延迟。

Dashboard 是第三个标准系统窗口（约 1180×760，最小 980×680），可缩放、非置顶、出现在任务栏。顶栏只保留一个「演示数据」标识，并持续写明「无后端 · 不保存 · 话术正文与 VOC 明细均为合成镜像」；完整 `MOCK AUTH / SYNTHETIC DATA / NO BACKEND` 边界可在侧栏「演示环境」中查看。左上使用项目狐狸头 Logo；浅色模式白色为主、紫色只做品牌 / 选中 / 关键动作，深色模式使用独立的炭灰层级。界面采用成熟运营工具的紧凑可折叠导航、1px 分隔线、统一 8px 的矩形圆角和无悬浮阴影数据面板，不把玻璃与桌宠动效铺进管理端。侧栏展开宽度可在 `216–360px` 内鼠标拖动或键盘调整，默认 `248px`；折叠后 macOS 保留固定 `120px` 控制岛 / 图标轨，Windows 与 Linux 保留固定 `72px` 图标轨，并维持原分组占位，图标位置不变、只隐藏文字，hover / focus 会在右侧显示模块名称。macOS 的同一个 PanelLeft 按钮始终固定在红绿灯右侧的侧栏控制岛内，展开 / 折叠只切换图标，不覆盖狐狸 Logo，也不与原生拖动区域重叠；Windows / Linux 则保留原生标题栏与稳定侧栏控制槽。外观可切换「浅色 / 深色 / 跟随系统」，默认跟随系统且只在当前 Dashboard 会话有效。管理概览使用语义化决策表和连续 KPI 条，显示影响、Owner、下一步、状态、处理窗口、固定统计范围与指标定义。九个一期模块使用滚轮 / 触控 / 原生滚动条；鼠标按住拖动不再滚页。导航另有禁用的「工单垃圾桶 · 二期待实施」占位，不算已实现模块。VOC 可切换预编译合成年 / 月 / 日切片并联动 KPI、Pareto、热力图和详情；「公告与同步」可演练本地成功 / 失败推送回执，但不会联网、发送、保存或改变四分面。数字全部是编译期合成样本；adopted 只等于复制成功。

Dashboard 左上品牌狐狸固定为 40px；浅色显示紫色耳麦，深色切换为白 / 浅灰耳麦以提高对比，狐狸本体保持原紫色。侧栏业务导航图标为 20px，文字比图标再靠近约 4px；折叠时图标中心仍固定在 macOS `nav.left+60` / Windows·Linux `nav.left+36`。

离线三维抽样复核将“是否修改 / 是否发送 / 是否适用”分别显示，维度 tab、合成结论与分层样本可交互；每项都报告有效分母、不可核验与证据等级。该页不读取最终发送正文，也不会从复制动作推断发送、采纳、未修改或回答正确。

VOC 页面基于用户提供的工作簿做过一次只读结构与聚合校准，仓内仅保留去标识合成镜像：不包含客户原文、订单号、图片、批次、员工、快递或竞品原始评价。话术库将产品 / 活动 / 售前 / 售后分域；当前屏幕中的规模与状态都是冻结的合成演示场景，不是 Menokin 企业工作簿的实时镜像。Menokin 四域材料是否存在以项目记录仓的受控证据为准，Demo 中的 `NOT_CREATED / UPSTREAM_AUTHORING` 等标签不得反向解释为当前上游事实。

检索按钮至少显示 280ms 的本地反馈；无命中有独立空态动效。检索使用完整问法与字符 n-gram 主路，并用当前合成 fixture 自带的实体锚点、别名和规则意图补足口语化问法；强品类文本 + 匹配问题主题 / 意图可受控召回自然问法，但纯泛化意图仍不能单独制造命中。未带合成品牌的宽品类别名在去掉别名与已识别意图后若还剩未知文本，会整体 fail-closed，避免陌生品牌串到合成话术。卡片只显示「精确问法 / 同义表达 / 主题与意图 / 相似问法」等非数字原因。答案正文不参与召回，有效期与去重均在截取稳定 Top 3 之前完成。检索期间若继续改问题，会取消旧检索。复制成功只反馈「已复制」约 900ms，随后自动收起回狐狸头；复制失败则保留候选供重试。

## 当前原型模式边界

- 只使用仓内标记为 `DEMO · 合成数据` 的虚构护肤客服话术与静态 Dashboard manifest。
- 运行时不读取飞书、Excel、客户数据、凭证、URL 或 token。用户提供的 VOC Excel 仅在设计阶段做过只读聚合校准，原文件与明细不随 Demo 分发。
- 不使用 Menokin 名义、真实产品事实或真实客户原文；正式 Menokin 数据只可在 G0 / Ddev 与数据门通过后由受控 adapter 接入。
- 不复制或迁移旧 `dafuyan-wording` 项目的代码、词典、权重、数据或配置；查询能力是在本仓按合成合同独立实现。
- 过期与未生效话术永不返回；卡片不展示匹配分。
- Overlay renderer 无 Node 权限；复制只能走 preload 白名单 IPC。Dashboard 无 preload，也没有 `customerAgent`。
- 复制成功只显示「已复制」，不表示已发送、已采纳或回答正确。
- Dashboard 不接 PostgreSQL、九端口、对象存储、Import Worker 或 LLM。状态标签不是生产可用声明。API host 已有合成范围的 `search/adoption/escalate` 事务端口，但桌面仍不连接它；合成 fixture / Dashboard manifest **不能**直接插入正式 `scripts` / `query_events` / `work_order_*`。字段、鉴权、版本、生效期、租户与复制语义的缺口见 [API adapter 衔接](docs/reference-api-adapter-handoff.md)。
- 「深度思考」只是默认 OFF 的 DeepSeek 辅助重排预留说明；它不生成答案、不改写话术、不发送消息，当前也不调用任何模型。
- 客户问题最多 2000 字。

### 附件借鉴矩阵（clean-room）

本地的 `clawd-on-desk-0.15.0.zip` 只作为只读参考附件，不进入 Git 或安装包。它的根源码是 AGPL-3.0，资源许可是 All Rights Reserved。本 Demo **不是** Clawd 的复制、改色或兼容层，也不使用其中任何 SVG / PNG / GIF / 代码。唯一视觉角色来源仍是本仓 `apps/desktop/fox-head.png`。

| 类别 | 内容 |
| --- | --- |
| 落地 | 窗内整头局部 follow、可中断睡眠 / 唤醒、点按与拖拽反应、现有贴边 mini mode |
| 仅理念 | 动作优先级、左右镜像、抓住时暂停待机、睡眠可被局部活动打断、free-roam 的可中断性 |
| 明确不做 | ZIP 资产 / 源码、全局鼠标追踪、真实桌面漫游、双击 / 多击累加、逐帧移动原生窗 |

## 快捷键冲突降级

默认注册 `CommandOrControl+Shift+Space`。若被系统或其他软件占用，Demo **不会静默失败**：狐狸头出现警示点，查询窗给出「请点击狐狸头打开」的说明。退出时注销快捷键。

桌面入口采用原生菜单：右键 Fox / Query 时由 Electron Main 生成固定菜单，系统 Tray / macOS 菜单栏与应用菜单也可打开查询或 Dashboard；macOS 程序坞激活专门打开 / 恢复 Dashboard，不展开查询。菜单不会接收 renderer 自定义结构；原有 `dashboard:open` 仍只接受受信 Query renderer。Linux 的 Tray 单击行为取决于桌面环境，因此快捷键和狐狸右键始终保留为兜底。

自动化环境往往无法稳定注入全局快捷键。`pnpm test:e2e` 会点击狐狸头，并在 `DEMO_E2E=1` 下走同一套 main 状态机 harness（`globalThis.__demoTest`）验证展开/收起。

## 透明效果的平台差异

- **macOS**：透明无边框窗 + CSS `backdrop-filter` 通常能看到克制的浅白玻璃。
- **macOS Space / 全屏**：为保住 regular Dock / Cmd+Tab，Query 不再加入所有 Space，也不覆盖全屏应用。当前 Space 内仍可正常唤起；跨 Space / 全屏覆盖需人工确认已降级。
- **macOS 折叠侧栏按钮**：自动化的 CDP click 不能冒充 OS 命中。折叠态展开按钮必须用真实鼠标点 island 内按钮中心验收；几何 / `elementFromPoint` 测试只能证明 renderer 合同。
- **Windows**：同样使用半透明底 `rgba(250,252,255,.88)`。部分 GPU / 系统组合下 `backdrop-filter` **不会模糊桌面**，只会看到半透明实色；这是平台限制，不是功能缺失。阴影与发丝边仍应可见。
- 系统开启“减少动态效果”时，循环位移、吸附变形与展开动效会降到近乎瞬时，保留可读静态状态。

## 测试命令

```bash
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm contracts:verify
pnpm contracts:codegen:check
pnpm db:migrations:check
pnpm test:db
pnpm test:contract
pnpm test:float
pnpm test:assets
pnpm test:e2e:float
pnpm test:e2e
```

| 命令 | 实际覆盖 | 不要误读成 |
| --- | --- | --- |
| `pnpm contracts:codegen:check` / `pnpm test:contract` | 双哈希输入对应的五类生成物零漂移；132 个 component schema 可编译、验证扩展生效，且编译后的公开包入口可由 Node 24 加载 | 正式 API 已启动、migration 已执行或 runtime 已激活 |
| `pnpm db:migrations:check` / `pnpm test:db` | 已验证 DDL 被确定性分成十一段且来源完整覆盖；PG15 临时 cluster 中的 v1.14 clean install、精确 v1.12→v1.14 与 v1.13→v1.14 后缀升级、双客户端串行化、账本/DDL 原子回滚、精确 ACL/函数/触发器/seed 漂移拒绝与 SQLSTATE 后验通过 | 已连接真实业务库、备份恢复或生产就绪 |
| `pnpm test:float` | overlay 几何 / 姿态 / 探头权限 / FoxApp 组件 | **不含**完整 Main drag-settle（那是 `apps/desktop/tests/unit/overlay-controller-fox-settle.test.ts`，在 `pnpm test` 里） |
| `pnpm test:assets` | 核对仓内现有狐狸与 App 图标合同 | **不等于生成**图标；要派生请显式 `pnpm generate:fox-head` |
| `pnpm test:e2e:float` | 先 `pnpm build`，再跑 `smoke.spec.ts` 里 `@float` | 不是全量 E2E，也不是真实台前调度验收 |
| `pnpm test` | contracts 合同测试 + database unit/package smoke + API 配置/loopback 测试 + desktop 全量 unit/component（含 drag-settle 与 Dashboard 授权） | 不含 W4 PG15 集成门禁、Electron E2E、真实窗口、共享/生产数据库或生产依赖；数据库改动另跑 `pnpm test:db` |
| `pnpm test:e2e` | 先 build，再跑全部 Playwright | 不是正式发包，也不是真实 OS 焦点 |

`pnpm test:e2e` 会先 build，再启动 Electron：验证左右停靠与 drag-settle、台前调度边界采纳、反复双窗交接、共享狐狸首帧中心 / 尺寸 / 姿态矩阵、关闭后无需点击页面即可直接键入、点击查询狐狸收起、内容贴合高度、数字键复制、自动收起，以及 Dashboard 的可信入口、单例、安全隔离与程序坞恢复，并核对系统剪贴板。探头 / 缩回、查询纵向拖拽、Dashboard 导航 / 模块 / 主题 / 筛选的状态机由更稳定的 unit/component 测试覆盖；默认 Playwright 门禁不再执行依赖 CDP 鼠标命中的长交互链。截图写到本机忽略的 `.gstack/qa-reports/screenshots/`。自动化的 renderer 点击与 `activate` 事件不能等同真实 macOS 应用激活；从 Finder / 其他应用实测程序坞、BrowserWindow / WebContents 物理键盘投递、侧栏与 Query 纵向拖拽、贴边 hover / retract，以及真实 OS 全局快捷键仍需人工确认。

当前 macOS 开发机可自动验证单屏左右贴边、窗口内动效和 Dashboard 浏览；跨实体多显示器拖拽、Windows 合成器观感及真实 OS 全局快捷键投递仍需对应设备手工验收。命令对照与打包门禁见 [如何验证桌面 Demo](docs/how-to-verify-desktop.md)。

## Windows 打包现状

`pnpm package:win` 会用纯 Node 确定性生成多尺寸 ICO，再构建未签名证明包：Windows 产物单独写入 `release/local-unsigned/windows/`，文件名强制带 `UNSIGNED`，关闭 `CSC_IDENTITY_AUTO_DISCOVERY` 与 NSIS differential package，并在 builder 完成后运行 fail-closed 后验。后验要求存在 `UNSIGNED.exe`、`win-unpacked/resources/icon.ico` 与 `apps/desktop/build/icon.ico` 字节一致、Electron / Chromium / 项目第三方许可非空，同时拒绝 `.blockmap`、`latest*.yml` 与 `app-update.yml`。该检查只证明离线包的文件结构和资源副本，不验证 PE 可执行文件内部的图标资源，也不验证 Authenticode 状态；对应的真实 Windows 安装、任务栏图标和系统签名仍需 Windows 设备验收。它**不是**正式外发包，也没有 Authenticode / EV 签名；仓库不提供 Windows `distribution` 路径，禁止把未签名产物写成已签名。未来若要正式分发，必须另走独立的 `release/distribution/` 与公司证书门禁，不能复用本机 UNSIGNED 产物。

## macOS 打包与发布

本机验证包与外部发布包严格分开：

```bash
# 本机验证：生成 Universal DMG + ZIP，显式关闭签名与公证，禁止外发
pnpm package:mac:local

# 正式外发：先 fail-closed 检查 Bundle ID、完整 Xcode、Developer ID 与公证凭证
pnpm package:mac
```

两个命令都会先从透明狐狸确定性合成 `apps/desktop/assets/app-icon.png` master，再生成 `apps/desktop/build/icon.icns` / `apps/desktop/build/icon.ico`，并构建同时包含 `x86_64 + arm64` 的 Universal 应用。本地证明包写入 `release/local-unsigned/`，文件名强制带 `UNSIGNED`；正式包只写入 `release/distribution/`，两者不会同名覆盖。两类目录都被 Git 忽略。调用方未显式提供 `NODE_EXTRA_CA_CERTS` 时，打包器仅在进程内临时桥接 macOS 系统根证书给 Node，保持 TLS 校验开启并在结束后删除临时文件。包内不生成自动更新元数据，不记录私有 GitHub 仓库坐标，并携带 Electron / Chromium / React 的第三方许可说明。

`package:mac` 默认要求 Hardened Runtime、代码签名和 Apple 公证，并在构建后再次执行 `codesign`、Gatekeeper 和 stapler 校验；缺少任一前置时直接失败，不会静默产出可误外发的未签名包。证书、`.p8` / `.p12`、Apple ID 密码和 Keychain profile 均不得提交仓库或打印到日志。

当前仓库仍使用 `local.demo.customer-agent`，适合本地 Demo；正式首次外发前必须由公司确定长期 Bundle ID，并在 Apple Developer Team 下安装 `Developer ID Application` 证书、配置公证凭证。未签名本地包经外部渠道下载后通常会触发 Gatekeeper 警告或拦截，不能发送给外包或客户。项目 Owner 还需明确软件使用条款与收件人范围；第三方许可声明不等于本 Demo 自身的分发授权。

## 产品化路线（不在当前 v3 原型基线）

正式 OAuth / RBAC、完整九端口 Application API、正式话术快照、真实飞书源和自动更新不在**当前 v3 原型运行基线**，但属于本仓后续产品化范围，必须按 G0 / Ddev、数据和发布门分阶段实现。正式 OpenAPI / DDL 合同集继续以 `VERIFIED_NOT_ACTIVATED` 状态锁定；DEV-M0 已建立合同 codegen、API host、migration 基础、runtime readiness 与不可部署候选包。DEV-M1 已加入 development/test mock auth、runtime/admin 双池隔离、受控 policy 读写、合成范围 search、query/impression/adoption/escalate 的事务与幂等，以及通过正式 PostgreSQL 搜索主链执行的 50 条纯合成 runner；runner 只报告 `NOT_SIGNED` 原始分母，不证明真实业务准确率。查询文本仍不落库，桌面也未接线。真实飞书鉴权、storage/content readiness、桌面 adapter 与 runtime activation 仍不存在。向量检索、LLM、自动学习与自动发送仍需专项批准。把现有原型「换成 adapter 就能接库」仍不成立：后续还需 M2 桌面 adapter、飞书会话、正式内容/数据门与独立真实 G1a。详见 [原型基线 → 正式九端口](docs/reference-api-adapter-handoff.md)。

macOS 正式签名 / 公证的工程门禁已提供，但 Apple 账号、公司 Bundle ID 与发布审批仍属于外部发布条件。正式一期客户端边界是 Windows Electron；本 Demo 的 macOS 浮窗不能当成一期交付面。
