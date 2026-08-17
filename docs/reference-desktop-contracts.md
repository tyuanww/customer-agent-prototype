# 桌面合同参考

本页是当前源码里的桌面合同，不是产品愿景。数值与通道名以 `src/` 与 `package.json` 为准。

相关文档：[第一次运行](tutorial-first-run.md) · [如何验证](how-to-verify-desktop.md) · [失败安全说明](explanation-failure-safe-lifecycle.md)

---

## 1. 三个窗口的职责与安全配置

三个 `BrowserWindow`，同一份 renderer 入口 `src/renderer/index.html`，用 `?role=` 分流（`src/renderer/lib/window-role.ts`）。

| | Fox | Query | Dashboard |
| --- | --- | --- | --- |
| 职责 | 闲置狐狸头 | 玻璃查询 / 结果 | 演示级运营工作台 |
| 工厂 | `createOverlayChromeWindow` | 同左 | `createDashboardBrowserWindow` |
| 典型尺寸 | 88×88（`FOX_SIZE`） | 宽 600；高见第 4 节 | 1180×760，最小 980×680 |
| frame / 透明 / 置顶 | frameless、透明、`alwaysOnTop`、`skipTaskbar` | 同左；`resizable: false` | 标准 frame、不透明、非置顶、显示任务栏 |
| macOS 形态 | 默认可为 `panel` + `hiddenInMissionControl` | `macPanel: false`，保持 regular Dock | `hiddenInset`，交通灯 `{ x: 14, y: 16 }` |
| preload | `src/preload/index.ts` → `out/preload/index.cjs` | 同左 | **无 preload** |
| `customerAgent` | 有（白名单） | 有（白名单，且多数写通道仅 query） | **无** |
| `trustedContents()` | 是 | 是 | **否**（`overlayRoleOf` 对 Dashboard 返回 `null`） |
| webPreferences | `contextIsolation: true` `sandbox: true` `nodeIntegration: false` `spellcheck: false` | 同左；Query 另设 `backgroundThrottling: false` | `DASHBOARD_WINDOW_SECURITY`：同样三项 + `spellcheck: false`，**不设 preload** |

共同锁定（`lockRendererWindow`）：拒绝 `window.open`、拦截 `will-navigate`、拦截 `will-attach-webview`。会话级（`applySessionSecurity`）：权限请求 / 权限检查一律 false。

CSP（`src/main/main.ts`）至少 `default-src 'self'`。开发态额外允许本机 Vite HMR；生产态 `script-src 'self'`，`connect-src 'self'`。

---

## 2. Dashboard：无 preload、无 `customerAgent`

- `createDashboardBrowserWindow` 使用 `DASHBOARD_WINDOW_SECURITY`，不传入 `preload`。
- `readDashboardWindowSnapshot().hasPreload` 因此为 false。
- Dashboard renderer 不得进入 `trustedContents()`，也拿不到 `window.customerAgent`。
- 打开通道只有无参数 `dashboard:open`。Main 要求 `isTrustedSender` 且 `role === 'query'`（`canOpenDashboard`）。Fox / 未受信 sender fail-closed，返回 `OpenDashboardResult` `{ ok: false, message }`。
- 原生菜单 / Tray / Dock **不走**该 IPC：它们直接调 `OverlayController.openDashboard()`，失败用 `runDashboardOpenAttempt` + `notifyDashboardOpenFailure`（原生对话框），查询窗保持可用。

`OpenDashboardResult`：

```ts
{ ok: true } | { ok: false; message: string }
```

成功对象不得带 `message`。失败文案常量：`工作台未打开，请重试。查询窗口仍保持可用。`

---

## 3. Typed IPC：role / main-frame / sender / payload

preload 只把 `CustomerAgentApi` 挂到 `window.customerAgent`，没有通用 `send` / `on` / `invoke`。

白名单（`src/shared/ipc-channels.ts`）：

| Channel | 方向 | 额外门禁 |
| --- | --- | --- |
| `clipboard:copy-text` | invoke | `isTrustedSender` + `role === 'query'` + `resolveClipboardWrite` |
| `app:get-platform` | invoke | sender 必须过 guard；失败仍只回 `process.platform` |
| `overlay:get-window-context` | invoke | 未受信回降级上下文 |
| `overlay:open-search` | invoke | 若带 transform：必须 `role === 'fox'` 且 `isFoxVisualTransform` |
| `dashboard:open` | invoke | `trusted && role === 'query'` |
| `overlay:dismiss` | invoke | trusted overlay |
| `overlay:report-ui-phase` | invoke | query-only；`isReportablePhase`；`resultCount ∈ {0,1,2,3}` |
| `overlay:report-handoff-milestone` | invoke | `role === 'query'`；正整数 `handoffId`；枚举 `open-armed \| open-finished \| close-finished` |
| `overlay:report-query-layout` | invoke | **`isTrustedMainFrameSender`** + query + 精确 key 的 `QueryLayoutRequest` |
| `overlay:resize-query-height` | invoke | **main-frame** + query + `QueryResizeRequest` |
| `overlay:move-fox-by` | invoke | Fox：正整数 `generation`（测试 harness 可省略）；Query：允许无 generation |
| `overlay:commit-fox-drag-settle` | invoke | **main-frame** + `role === 'fox'` + 正整数 `settleId` |
| `overlay:set-fox-peek` | invoke | `role === 'fox'`；`peek \| retract`；`epoch >= 0` |
| `overlay:command` | Main → renderer | preload 丢弃非 `isOverlayCommand` 的载荷 |

`isTrustedSender`：sender 未销毁、属于 `trustedContents()`（仅 Fox / Query）、`senderFrame` 无 parent、URL 为允许的本机 dev server 或打包 `index.html`。

`isTrustedMainFrameSender`：上述全部成立，且 `senderFrame === sender.mainFrame`。缺 frame 则拒绝。

Payload 共性：精确 key 集合、安全整数、枚举。不开放 width / x / y / bounds IPC，不暴露文件系统。

---

## 4. Query 实测布局与纵向 resize ACK

正常结果路径（`RESULTS` / `EMPTY` / `ERROR`）：

1. Query 在 DOM 上测量 hug：优先 `measureQueryHugHeight`（最后一张卡 / 复制按钮 / banner / content 的实际底边），否则 `composeQueryDesiredHeight`（capsule + banner + `result-content` scrollHeight + chrome + 空白容差 12px）。
2. 经 `overlay:report-query-layout` 上报 `{ sessionId, sequence, phase, resultCount, desiredHeight }`。
3. Main 只接受：受信 Query **主框**、当前 handoff `sessionId`、单调递增 `sequence`、phase / resultCount 与 Main 一致、handoff 不在 preparing/opening/closing。
4. `clampQueryDesiredHeight(desired, availableHeight)`，其中 `availableHeight = workArea.height - 16`（`SCREEN_MARGIN * 2`），再与常量上下限相交：`240 .. min(620, availableHeight)`。
5. 一次 `setBounds`，返回 typed `QueryLayoutAck`。Query 必须 `acceptQueryLayoutAck`（ok、session、sequence、phase、count）后才 `layoutReady` 并展示内容。

纵向 resize（`overlay:resize-query-height`）同一套 session / sequence / ACK：`begin | update | end | cancel | keyboard`。不开放水平或任意 bounds。

**旧分档只属于异常 fallback**（`preferredQuerySizeForPhase` / `fallbackQuerySizeForPhase`，超时 `QUERY_LAYOUT_FALLBACK_MS = 160`）：

| 条件 | fallback 高 |
| --- | --- |
| `SEARCH_INPUT` | 88 |
| `EMPTY` 或 0 条 `ERROR` | 240 |
| 1 条 | 340 |
| 2 条 | 430 |
| 3 条 | 620 |

不要把 fallback 写成正常 hug 结果。

---

## 5. 两阶段共享元素 handoff

打开：

1. Main 按点击瞬间 Fox 的真实屏幕中心、64px、当前 2D 矩阵，给**隐藏** Query 发 `prepare-search`（`handoffId`、`handoffCenterX/Y`、`foxVisualTransform`），`chromeHandoffMode = preparing-open`。
2. Query 准备代理首帧后回执 `open-armed`。
3. Main `startPreparedOpen`：`show` Query、立刻 `setBounds` 回准备好的 frame、`hide` Fox、聚焦 App / BrowserWindow / WebContents，再发 `activate-search`。
4. 外壳 `clip-path` 约 260ms；Query 回执 `open-finished`。定时器 `180ms`（准备）/ `260+100ms`（打开）只作异常兜底。

关闭反向：`collapse` → Query 末帧 `close-finished` → Main `showInactive` Fox、`hide` Query。贴边 Query 与物理工作区边缘齐平，保持 32px 半露轮廓。每阶段最终 bounds 只提交一次。禁止双狐狸错位、先闪完整面板、两窗同时不可见。

---

## 6. Fox `generation` + `settleId` + `commit`

1. 指针按下时 renderer `dragGeneration++`，后续 `moveFoxBy(dx, dy, finished, generation)` 都带这个正整数。
2. Main 把原生拖拽会话绑到第一个合法 generation；generation 不匹配则忽略（含 finished）。新 generation 的真实 move 会丢掉未提交的旧 `awaitingFoxDragSettle`。
3. `finished === true` 且 generation 匹配：按 workArea / dock session `setBounds` 一次，分配单调 `settleId`，向 Fox 发 `fox-drag-settled`，并记下 `awaitingFoxDragSettle`。
4. Fox 仅当 `settleId` 更新且 `generation` 仍是当前原生拖拽代时才 `commitFoxDragSettle(settleId)`。
5. Main 的 commit 必须：main-frame Fox sender、`settleId` 正是 awaiting、当前没有新的 drag session / generation。成功后才释放「拖完再打开 Query」的栅栏。
6. renderer watchdog：`FOX_DRAG_SETTLE_WATCHDOG_MS = 1600`。超时按**当前 generation** `abortDragSettle`。旧 ACK 不得覆盖新 drag。

`test:float` 不覆盖上述 Main 矩阵；见 [如何验证](how-to-verify-desktop.md)。

---

## 7. Dashboard single-flight 与原子 reveal

`openDashboard()`：

1. `isInactive` → `{ ok: false }`。
2. 已有 `dashboardOpening` → 返回同一 Promise（single-flight）。
3. 已有未销毁窗 → `revealDashboardWindow`（restore / show / focus）。
4. 否则 `createDashboardBrowserWindow()`（`show: false`）+ `lockRendererWindow` + `loadRenderer(..., 'dashboard')`。
5. 加载取消 / 抛错 / 已 shutdown → `abandonDashboardWindow`（destroy，不清 Query）。
6. `revealDashboardWindow` 里 restore / show / focus 任一步失败同样 abandon，返回 `{ ok: false }`。
7. **只有 reveal 成功才 `dismiss()` Query**，返回 `{ ok: true }`。

Query 侧若收到非 `ok: true`，保留查询并显示失败文案。原生入口另弹「运营工作台未打开」对话框，狐狸与查询继续可用。

---

## 8. 台前调度：接受 actual bounds

macOS 台前调度可能把后台透明窗限制在 Electron `screen.workArea` 未表达的舞台边。

合同：

- `bindFoxNativeBoundsReadback` 监听 `move` / `moved`，把 `fox.getBounds()` 写入 `foxOrigin`。
- `setFoxPeek` 只 `syncFoxOriginFromNativeBounds`，**不**因 hover 再 `setBounds(workArea.x)`。peek / retract 是 renderer crop。
- 打开 / 关闭 handoff 从实际 88px frame 算中心。
- `finishClosingHandoff`：`showInactive` 后再次读 actual bounds；若系统再次改座，采用新 frame，不补偿回理论 x=0。

交付标准：停在系统接受边界，无 `left↔none` 与理论 x0 往返横跳。Electron 公共 API **不承诺**后台窗占据物理屏 x=0。自动化未证明真实 Stage Manager。

---

## 9. App / Fox 图标 SSOT

| 角色 | 路径 | 谁用 |
| --- | --- | --- |
| Raster canonical | `assets/fox-head-master.png`（1254 RGBA） | `pnpm generate:fox-head` 的输入 |
| 共享透明狐狸 | `fox-head.png`（与 master 字节一致派生） | Float / Query / Tray / Dashboard 浅色 |
| Dashboard 深色耳麦 | `src/renderer/assets/dashboard-fox-headset-dark.png` | 只改耳麦，狐狸本体不反色 |
| App / Dock master | `assets/app-icon.png`（1024，近白 squircle） | 开发态 `app.dock.setIcon`；再派生 build 图标 |
| 打包图标 | `build/icon.png`、`build/icon.ico`、`build/icon.icns` | electron-builder / 包内 Resources |

`pnpm generate:fox-head` **默认**在写出共享 PNG 与深色耳麦后调用 `generateAppIcons`，因此也会派生 App / Dock master、PNG 与 ICO；仅在 macOS 上继续生成 ICNS。`--skip-icons` 才跳过。`--qa` 另写 `evidence/qa/2026-08-17-approved-fox/` 五张小图，那些小图不是 canonical。

开发态不要把透明 `fox-head.png` 设为 Dock 图标；Tray 不要用白底 Dock 图。

---

## 10. 生命周期与身份模块

| 模块 | 合同 |
| --- | --- |
| `src/main/shutdown-fence.ts` | `begin()` 后 `isShuttingDown()` 永真 |
| `isInactiveOverlay` | `disposed \|\| fence` |
| `GuardedScheduler` | dispose 后不再调度；回调前再查 disposed |
| `applyApplicationIdentity` | macOS `regular` activation；unpackaged 用 `assets/app-icon.png`；shutdown 中途停止 |
| `desktop-lifecycle` | 就绪后的 `activate` 打开 Dashboard；启动期不听 activate；second-instance 在就绪前 defer |

---

## 11. 公开 scripts 和模块图

### package.json scripts

| script | 实现 |
| --- | --- |
| `dev` | `electron-vite dev` |
| `lint` / `typecheck` / `test` / `test:watch` | eslint / tsc / vitest |
| `test:float` | 见 [如何验证](how-to-verify-desktop.md#21-pnpm-testfloat) |
| `test:assets` | 只跑资产合同测试 |
| `test:e2e:float` | `pnpm build && playwright … --grep @float` |
| `test:e2e` | `pnpm build && playwright test` |
| `build` | `electron-vite build` → `out/` |
| `generate:fox-head` | `scripts/generate-fox-head.mjs` |
| `generate:app-icons` | `scripts/generate-app-icons.mjs` |
| `generate:mac-icon` | `scripts/generate-mac-icon.sh`（从 `assets/app-icon.png` 做 ICNS） |
| `preview` | `electron-vite preview` |
| `package:mac:local` | `scripts/package-macos.mjs local` |
| `package:mac` | `verify-mac-release-env.mjs` + `package-macos.mjs distribution` |
| `package:win` | `scripts/package-windows.mjs local` |

### 源码分层

```text
src/main/main.ts                 单实例、CSP、identity、IPC、fence、shell
src/main/overlay-controller.ts   三窗、handoff、layout、drag、Dashboard
src/main/overlay-ipc.ts          overlay / dashboard invoke 门禁
src/main/clipboard-ipc.ts        复制门禁
src/main/sender-guard.ts         trusted + main-frame
src/main/window-security.ts      导航 / 权限锁
src/main/dashboard-window.ts     无 preload 的标准窗
src/main/dashboard-open-failure.ts 原生失败对话框
src/main/desktop-shell.ts        菜单 / Tray
src/main/desktop-lifecycle.ts    Dock activate / 二次启动
src/main/app-identity.ts         Dock / 品牌图
src/main/shutdown-fence.ts
src/main/guarded-scheduler.ts
src/preload/index.ts             customerAgent 白名单
src/shared/                      合同、几何、状态机、IPC 名
src/renderer/FoxApp.tsx
src/renderer/QueryApp.tsx
src/renderer/DashboardApp.tsx
src/renderer/data/               合成 fixture / manifest
scripts/verify-*-package.mjs     打包后验
scripts/verify-mac-release-env.mjs 正式外发前置（当前会因 local.demo appId 失败）
```

### 构建产物（`pnpm build`）

| 入口 | 输出 |
| --- | --- |
| `src/main/main.ts` | `out/main/index.js` |
| `src/preload/index.ts` | `out/preload/index.cjs` |
| `src/renderer/index.html` | `out/renderer/` |

renderer 无 Node 权限。打包 `files` 只含 `out/**/*` 与 `package.json`；狐狸 PNG 与第三方许可走 `extraResources`。
