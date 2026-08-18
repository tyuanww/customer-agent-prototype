# 项目架构与目录边界

本页说明这个本地 Electron Demo 的模块职责、运行时边界和文件归属。它描述当前代码，不代表正式客服 Agent 的生产架构。正式项目仍以只读参考的设计合同为准，见 [API adapter 衔接](reference-api-adapter-handoff.md)。

## 1. 先看整体

```text
┌──────────────────────────────────────────────────────────────┐
│ Electron main                                                  │
│  main.ts                                                       │
│   ├─ overlay-controller       三个 BrowserWindow 的生命周期     │
│   ├─ desktop-shell             Tray / 菜单 / Dock 入口           │
│   ├─ desktop-lifecycle         activate / shutdown fence        │
│   └─ window factories           安全偏好与 renderer loader       │
└───────────────┬───────────────────────────────┬───────────────┘
                │ 白名单 IPC                     │ 原生能力
┌───────────────▼───────────────┐   ┌───────────▼────────────────┐
│ preload                         │   │ Electron / OS               │
│ src/preload/index.ts            │   │ clipboard, bounds, shortcut │
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
```

主链是：狐狸浮窗打开查询 → Query 在本地合成 fixture 中检索 → 人工选择 Top 3 → 通过白名单 IPC 写入剪贴板。Dashboard 读取编译期的 `DASHBOARD_MANIFEST`，不读取 Query、不写数据库，也不调用正式九端口。

## 2. 目录归属

| 目录 | 只负责什么 | 不应该放什么 |
| --- | --- | --- |
| `src/main/` | BrowserWindow 生命周期、原生能力、IPC handler、关闭与失败安全 | React 视图、业务 fixture、通用 HTTP 客户端 |
| `src/preload/` | 把 `CustomerAgentApi` 的白名单能力暴露给 renderer | `ipcRenderer` 通用转发、Node 文件系统、token |
| `src/renderer/` | 狐狸、查询胶囊、Dashboard 和其 CSS | Electron 主进程对象、数据库连接、真实客户数据 |
| `src/shared/` | 跨边界协议、类型、校验器、几何和状态纯函数 | 依赖 DOM、Electron、React 的实现 |
| `assets/`、根目录 PNG | 品牌主资产与可确定性派生的 app icon 输入 | 截图、构建包、临时导出 |
| `scripts/` | 图标生成、打包、验证、空间清理等开发/发布脚本 | 运行时业务逻辑 |
| `tests/unit/` | 纯函数、协议、脚本和安全合同 | 真实 OS 交互断言 |
| `tests/component/` | React 状态、焦点、拖拽和视图行为 | 打包产物验证 |
| `tests/e2e/` | Electron 窗口、renderer→preload→main 的集成链 | 把合成输入写成真实 macOS/Windows 证明 |
| `docs/`、`evidence/qa/` | 可读合同、教程、验证方法和冻结证据 | 可执行源码、运行时缓存 |

这里不需要为了“看起来整齐”移动 `src/main`、`src/renderer` 或 `tests`。当前边界和 import 方向已经表达了系统信任边界；机械移动会增加路径变更和测试合同漂移，却不会减少运行时复杂度。

## 3. 三个窗口和安全边界

| WindowRole | Renderer | preload | 主要能力 |
| --- | --- | --- | --- |
| `fox` | `FoxApp` | 有 | 浮窗拖拽、贴边、快捷键唤起、打开 Query |
| `query` | `QueryApp` | 有 | 本地检索、复制、布局高度、打开 Dashboard |
| `dashboard` | `DashboardApp` | 无 | 静态合成 Dashboard、主题和导航 |

所有受信 renderer 都通过 `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false` 的窗口偏好运行。`src/shared/overlay-events.ts` 和 `src/shared/contracts.ts` 是 main 与 preload/renderer 共同遵守的协议边界。任何新能力都应先增加窄类型的 channel、validator 和失败返回，再接到 UI。

Dashboard 没有 preload 是有意的限制，不是遗漏。正式 Dashboard 未来若需要 API，也应新增受信的只读 adapter，而不是把通用 IPC 或 Node 权限塞进当前窗口。

## 4. 数据边界

```text
SYNTHETIC_SCRIPTS ──local searchScripts──> Query view model
                                      └──copyText──> system clipboard

DASHBOARD_MANIFEST ──read-only──> Dashboard modules

正式 PostgreSQL / /v1 API ──当前不存在于 Demo──> 不允许从 renderer 直连
```

`src/renderer/features/search/search-service.ts` 是 Demo 的本地 n-gram 检索器；它返回展示用 `RankedScript`，不等同正式 API 的 candidate。正式衔接必须在后续 Ddev 阶段由 main-process adapter 完成，不能把 fixture 直接插入正式表，具体字段缺口见 [Demo → 正式九端口：为何不能“直接插入”](reference-api-adapter-handoff.md)。

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
pnpm test             # unit + component
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
| Electron/Vite 输出 | `out/` | `pnpm clean:generated` |
| 本地未签名包 | `release/local-unsigned/` | `pnpm clean:generated` |
| 测试报告 | `test-results/`、`playwright-report/` | `pnpm clean:generated` |
| Vite 临时缓存 | `node_modules/.vite*` | `pnpm clean:generated` |
| 依赖 | `node_modules/` | 只有归档时才用 `pnpm clean:deep` |
| CodeGraph 索引 | `.codegraph/` | 本地工具状态，不进业务提交 |
| 用户参考 ZIP | `clawd-on-desk-0.15.0.zip` | 只读、忽略、不得复制资源进仓 |

`pnpm workspace:check` 只给源码、测试、文档和已纳入资产设置预算，不把依赖和本地工具缓存误算成代码膨胀。清理器是精确 allowlist，遇到未知路径或符号链接会停止。

## 7. 当前架构评价

当前目录结构达到 Demo 收尾标准：边界清楚、运行时权限收窄、测试按层分组、生成物有独立清理入口、正式 API 仍保持隔离。

仍然保留的后续债务：`overlay-controller.ts`、`DashboardApp.tsx` 和 `QueryApp.tsx` 仍偏大；它们是状态机和交接逻辑的高耦合区，下一轮应以行为合同为先拆出 controller/hook，而不是为了行数做机械切文件。本轮不移动它们，避免把已验证的交互回归扩大成结构性重构。

## 相关文档

- [第一次运行客服话术浮窗 Demo](tutorial-first-run.md)
- [如何验证桌面 Demo](how-to-verify-desktop.md)
- [桌面合同](reference-desktop-contracts.md)
- [失败安全说明](explanation-failure-safe-lifecycle.md)
- [API adapter 衔接](reference-api-adapter-handoff.md)
