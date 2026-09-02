# 项目架构与目录边界

本页说明产品仓当前模块职责、运行时边界和文件归属。它描述当前代码，不等于生产架构已经完成；仓库身份和产品化生命周期见 [`PROJECT_CHARTER.md`](../PROJECT_CHARTER.md)，正式衔接见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。`DEV-M0-W1` 已把既有 Electron 应用机械迁入 `apps/desktop`；`DEV-M0-W2` 新增独立 `packages/contracts` 编译边界；`DEV-M0-W3` 已合并只允许 loopback `/health` 的 `apps/api` 启动骨架，但没有桌面接线、DB、鉴权或业务端口。

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

contracts/upstream（不可变输入）
  └─ packages/contracts（bundle / generated TS / runtime validator）
       ├─ apps/api（只消费 HealthResponse validator 与 provenance）
       │    └─ GET /health（loopback；formal-dev/test + mock）
       └─ 当前未被 desktop 或 DB runtime 消费
```

桌面主链是：狐狸浮窗打开查询 → Query 在本地合成 fixture 中检索 → 人工选择 Top 3 → 通过白名单 IPC 写入剪贴板。Dashboard 读取编译期的 `DASHBOARD_MANIFEST`，不读取 Query、不写数据库，也不调用正式九端口。W3 API 是并行、未接线的本机进程，只证明受控配置拒启和合同有效 liveness。

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
| `apps/api/` | 命名 profile、失败关闭配置、Fastify 生命周期和当前唯一 `/health` 路由 | 桌面 fixture、renderer、DB、Feishu auth、业务端口、真实数据或外部 bind |
| 根 `scripts/` | 合同快照接收与 workspace 卫生门 | Electron 运行时、UI 或打包资产 |
| `contracts/upstream/` | 来自项目记录仓、带来源 SHA 与双哈希的不可变机器合同快照及消费锁 | 手改合同、运行时跨仓读取、凭证、生成类型或 Ddev 状态真源 |
| `packages/contracts/` | 在共享快照锁内确定性生成 OpenAPI bundle、TS 类型和 component runtime validator；构建 Node 可执行 `dist`，拥有生成物指纹、验证扩展与有上限的脱敏错误形状 | HTTP host、路由策略、DB migration、renderer、凭证或真实数据 |
| `apps/desktop/tests/unit/` | 纯函数、协议、脚本和安全合同 | 真实 OS 交互断言 |
| `apps/desktop/tests/component/` | React 状态、焦点、拖拽和视图行为 | 打包产物验证 |
| `apps/desktop/tests/e2e/` | Electron 窗口、renderer→preload→main 的集成链 | 把合成输入写成真实 macOS/Windows 证明 |
| `docs/`、`evidence/qa/` | 可读合同、教程、验证方法和冻结证据 | 可执行源码、运行时缓存 |

`DEV-M0-W1` 只把现有桌面包原样移入 `apps/desktop`，并同步 package、路径、测试和打包配置；根 `pnpm` 命令继续作为唯一公开入口。该切片不得混入 IPC 改造、API、DB 或 UI 行为，迁移后的模块边界和依赖方向保持不变。

`DEV-M0-W2` 把“合同接收”与“合同编译”分为两个写入所有者：根 intake 脚本验证、保存不可变输入并拥有 rollover/read snapshot 互斥；`packages/contracts/scripts/generate-contracts.mjs` 只从锁内一致快照生成产品资产。生成器拒绝外部 `$ref`、来源版本/双哈希漂移和手改生成物，并保留已登记的 `x-unique-by` 验证扩展；运行时 validator 按 schema 延迟编译，只返回数量有上限的 schema 路径与关键字，不回显请求正文。

`DEV-M0-W3` 由 `apps/api/src/runtime-config.ts` 单独拥有 profile、auth、bind、port、build version 与错误脱敏；配置必须先于 Fastify 构造通过。当前只有 `formal-dev|test + AUTH_MODE=mock + 127.0.0.1` 可启动，且只注册合同校验后的 `GET /health`；自动 HEAD 派生也被关闭。公共 package 入口只提供 `startApi()` 和窄 `close()` 生命周期，不暴露 Fastify 实例或替换路由 owner 的 factory。部署 profile、Feishu auth、`/ready`、`/v1/*`、DB 与桌面 adapter 均未实现或明确拒启。

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
                                          └─ HealthResponse ──> apps/api GET /health

正式 PostgreSQL / /v1 API ──当前原型基线尚未实现──> 不允许从 renderer 直连
```

`apps/desktop/src/renderer/features/search/search-service.ts` 是当前原型模式的本地 n-gram 检索器；它返回展示用 `RankedScript`，不等同正式 API 的 candidate。正式衔接必须在 `DEV-M0～M3` 的对应切片由本仓 main-process adapter 和正式服务模块完成，不能把 fixture 直接插入正式表，具体字段缺口见 [原型基线 → 正式九端口](reference-api-adapter-handoff.md)。

合同快照只由 `scripts/customer-agent-contract-set.mjs` 接收和复核：目录成员、来源 commit、字节数与 OpenAPI / DDL SHA-256 任一不符即失败。`packages/contracts` 在该验证之后生成并校验组件合同；它不修改消费锁，`runtime_activated=false` 继续成立。`apps/api` 只读取 provenance 和 `HealthResponse` validator；renderer、main、preload 和现有合成搜索均未导入该包，正式 `/v1` 与 DB 也尚不存在。

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
pnpm contracts:codegen:check # 重新生成到内存并做字节级零漂移检查
pnpm test:float       # 浮窗相关快速回归
pnpm test:e2e:float   # build 后只跑浮窗 E2E
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
| 派生打包图标 | `apps/desktop/build/icon.png`、`icon.ico`、`icon.icns` | `pnpm clean:generated`；按需重新运行图标生成或打包脚本 |
| 测试报告 | `apps/desktop/test-results/`、`apps/desktop/playwright-report/` | `pnpm clean:generated` |
| Vite 临时缓存 | `apps/desktop/node_modules/.vite*` | `pnpm clean:generated` |
| API TypeScript 输出 | `apps/api/dist/` | `pnpm clean:generated` |
| 依赖 | 根、`apps/api/node_modules/` 与 `apps/desktop/node_modules/` | 只有归档时才用 `pnpm clean:deep` |
| CodeGraph 索引 | `.codegraph/` | 本地工具状态，不进业务提交 |
| 用户参考 ZIP | `clawd-on-desk-0.15.0.zip` | 只读、忽略、不得复制资源进仓 |

`pnpm workspace:check` 只给源码、测试、文档和已纳入资产设置预算，不把依赖和本地工具缓存误算成代码膨胀。它还验证根 workspace 门面不声明版本，并要求 `.gstack/package-json-path` 唯一指向 `apps/desktop/package.json`，避免发布版本与安装包版本分叉。清理器是精确 allowlist，遇到未知路径或符号链接会停止。

## 7. 当前架构评价

当前目录结构已在 W1 mechanical move 基线上增加 W2 合同编译深模块和 W3 API/config 深模块：桌面包、合同包与 API host 所有权分离，桌面运行时权限未放宽。W3 只关闭“配置先行拒启、loopback host 与合同 liveness”实现子项，不关闭 migration、DB、鉴权、ACL、N/N-1、业务端口或 DEV-M0 总门。

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
