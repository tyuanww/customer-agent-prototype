# 抽取叶子模块合同

本页记录本轮从高耦合入口抽出的窄模块。它是维护者参考，不是 renderer 的公共 API，也不改变 Electron 的信任边界。抽取的目标是把可独立证明的构造、映射和几何计算集中起来；窗口 `setBounds`、handoff ACK、焦点状态机和 Dashboard 导航 resize 状态机仍由原入口负责。

相关文档：[项目架构](reference-project-architecture.md) · [桌面合同](reference-desktop-contracts.md) · [如何验证](how-to-verify-desktop.md) · [失败安全说明](explanation-failure-safe-lifecycle.md)

## 1. 使用边界

- 叶子函数不得自行发送 IPC、创建窗口、读取文件、访问数据库或引入真实业务数据。
- `apps/desktop/src/shared/` 中的工厂与 ACK helper 只构造通过 validator 的 typed payload；它们不绕过 Main 的 sender、role、main-frame 或 generation 校验。
- `apps/desktop/src/renderer/features/search/query-view.ts` 和 Dashboard helper 属于 renderer 内部模块。不要把它们当作 preload API，也不要从 Main 进程导入。
- 状态机仍以 `FoxApp`、`QueryApp`、`DashboardApp` 和 `overlay-controller` 为权威；叶子函数不能通过 CSS 或副作用偷偷改变状态优先级。

## 2. Query 视图叶子

位置：`apps/desktop/src/renderer/features/search/query-view.ts`

| 符号 | 输入 | 输出 / 合同 |
| --- | --- | --- |
| `queryFoxVisualState` | `searching` 与当前 `OverlayPhase` | 搜索中优先返回 `SEARCHING`；结果、空态、复制态保留对应业务相位；其他情况回到 `IDLE` |
| `queryShellClassName` | 展开、停放、开关动画、布局等待布尔值 | 只组合 `query-shell` 及既有 `is-*` class，不创建新状态 |
| `queryHandoffCssVars` | Fox 视觉矩阵、Query anchor 与 handoff geometry | 生成共享元素所需的 CSS variables；不改矩阵，不触发窗口交换 |
| `resultCopyRankFromKey` | `KeyboardEvent.code/key` | 仅 `Digit1..3` 与 `Numpad1..3` 返回 1..3，其余返回 `null` |
| `maxContentBottom` | 可测量节点数组 | 忽略空节点，返回 DOM bottom 的最大值；没有节点时为 `0` |

该模块还集中维护 Query 的反馈时长常量与 DeepSeek 预留说明。正常布局仍由 `QueryApp` 读取 DOM、经过 typed layout IPC 上报并等待 ACK；`query-view` 不能把估算高度直接当成 Main 的窗口尺寸。

示例：

```ts
const shellClass = queryShellClassName({
  expanded,
  parked,
  opening,
  closing,
  layoutReady,
});

const rank = resultCopyRankFromKey(event.code, event.key);
```

`QueryFoxVisualState` 由该叶子模块定义，`QueryCapsule` 只消费这个 search 内部类型。它不是跨窗口协议，不得上移到 preload 或 shared 合同。

## 3. Shared overlay command 工厂

位置：`apps/desktop/src/shared/overlay-events.ts`

| 工厂 | 产生的协议命令 | 约束 |
| --- | --- | --- |
| `prepareSearchCommand` | `prepare-search` | 携带 handoff id、anchor、中心点和 Fox 2D 矩阵 |
| `activateSearchCommand` | `activate-search` | 只描述 anchor、是否动画及可选 handoff id |
| `collapseQueryCommand` | `collapse` | 携带 handoff、dock edge、anchor、中心点与动画意图 |
| `foxEdgeCommand` | `fox-edge` | 普通边缘回声，带 edge 与 epoch |
| `syncFoxEdgeCommand` | `sync-fox-edge` | 拓扑/权威同步回声，带 edge 与 epoch |
| `syncQueryAnchorCommand` | `sync-query-anchor` | 只同步 Query anchor |
| `shortcutStatusCommand` | `shortcut-status` | 描述注册结果、accelerator 与用户可见消息 |
| `foxDragSettledCommand` | `fox-drag-settled` | 转发 typed drag-settle ACK，不改变 ACK 内容 |

工厂只返回 `OverlayCommand`，不调用 `webContents.send`、不判断 sender，也不替代 `isOverlayCommand`。Main 仍负责 generation / settleId / sender 校验和命令投递；preload 仍负责丢弃不符合协议的 Main 消息。

## 4. Query layout ACK helper

位置：`apps/desktop/src/shared/query-layout.ts`

| 符号 | 用途 |
| --- | --- |
| `reportableOverlayPhase` | 把内部 `FOX_IDLE` 映射为可上报的 `SEARCH_INPUT`；其他可报告相位保持不变 |
| `acceptedQueryLayoutAck` | 构造成功 ACK，保留 session、sequence、height、resize edge、phase 与 result count |
| `queryLayoutAckCommand` | 把成功 ACK 包装成 Main → Query 的 `query-layout-ack` 命令 |
| `rejectedQueryLayoutAck` | 构造失败 ACK，供 validator 拒绝或控制器不可用时使用 |

成功 ACK 仍必须满足共享合同：session / sequence 为安全正整数，height 由 Main 约束在 `240..620` 与当前可用高度之间，phase 和 result count 使用白名单枚举。helper 的存在不意味着 renderer 可以自行确认布局；只有 Main 接受并回传的 ACK 才能提交到 Query 状态。

## 5. Dashboard 叶子

### 5.1 Manifest 与导航

位置：`apps/desktop/src/renderer/data/dashboard-manifest.ts`

- `nextDashboardNavId(active, delta)` 在 `DASHBOARD_NAV` 中循环移动，调用方传入整数步长（当前键盘路径使用 `-1` / `+1`）。它只返回已有导航 id，不创建新路由。

### 5.2 外观与 tooltip 几何

位置：`apps/desktop/src/renderer/lib/dashboard-appearance.ts`

- `systemPrefersDark()` 在 `matchMedia` 可用时读取系统深色偏好，在无 DOM / 无该 API 的测试环境返回 `false`。renderer 入口用它计算初始主题；Dashboard 组件仍负责监听后续系统主题变化。
- `dashboardNavTooltipPosition({ right, top, height })` 将 tooltip 放到导航项右侧 10px、垂直中心位置。它只返回位置，不负责显示、计时或 ARIA 关联。

主题仍是 Dashboard 会话内状态，不写入文件、不改变 Fox / Query 的共享主题。tooltip 的可见性、延迟和 `aria-describedby` 继续由 `DashboardApp` 负责。

## 6. Fox presence 运行时

位置：`apps/desktop/src/renderer/lib/fox-presence-runtime.ts`

- `FoxSleepClock` 独占睡眠 timer、deadline 与 token 生命周期；它消费 shared 的纯 schedule helper，但只在 renderer 创建或清理计时器。
- `writeFoxCssVars` 把已经解析的姿态数值写入 Fox 元素的 CSS variables；Main、preload 与 shared 不持有 DOM 引用。
- `apps/desktop/src/shared/fox-presence.ts` 继续只负责姿态优先级、跟随/拖拽数值、睡眠 deadline 等纯计算。

该拆分是依赖方向约束，不是新的跨窗口 API。改变睡眠阈值或姿态优先级时仍需同时验证 shared 纯函数和 `FoxApp` 生命周期。

## 7. Test-only harness

位置：`apps/desktop/src/main/overlay-test-harness.ts`

`isTestHarnessEnabled()` 仅在 `DEMO_E2E=1` 或命令行包含 `--demo-e2e` 时返回 true。`attachTestHarness(controller)` 在启用时把非枚举的 `globalThis.__demoTest` 绑定到 Electron 主进程，用于 E2E 的展开、收起、窗口快照、布局回执和阶段报告。

`beginFoxSetBoundsTrace()` 会清空并开始记录应用对 E2E Fox 窗口发起的 `setBounds` 调用；`endFoxSetBoundsTrace()` 停止记录并返回 bounds / animate 快照。这两个方法只包装测试进程中已存在的 Fox `BrowserWindow`，用来区分应用主动移窗与 WindowServer 重新安置；它们不记录 OS 内部调用，也不改变生产 bounds 策略。

这不是生产 API：生产启动不注入 harness，renderer 不应依赖 `__demoTest`，也不得用 harness 证明真实 macOS WindowServer、Dock、Stage Manager 或 Windows 合成器行为。相关自动化边界见 [如何验证桌面 Demo](how-to-verify-desktop.md)。

## 8. 对应测试与验证

叶子合同的单元测试与入口如下：

| 范围 | 测试 |
| --- | --- |
| Query 视图 helper | `apps/desktop/tests/unit/query-view.test.ts`、`apps/desktop/tests/unit/query-visual.test.ts` |
| Shared overlay command | `apps/desktop/tests/unit/overlay-events.test.ts` |
| Query layout ACK | `apps/desktop/tests/unit/query-layout.test.ts` |
| Dashboard manifest / 外观 | `apps/desktop/tests/unit/dashboard-manifest.test.ts`、`apps/desktop/tests/unit/dashboard-appearance.test.ts` |
| Fox presence 纯逻辑 / renderer runtime | `apps/desktop/tests/unit/fox-presence.test.ts`、`apps/desktop/tests/component/FoxApp.test.tsx` |
| Test-only harness | `apps/desktop/tests/unit/overlay-test-harness.test.ts` |

推荐先跑窄反馈环：

```bash
pnpm --filter @customer-agent/desktop exec vitest run \
  tests/unit/query-view.test.ts \
  tests/unit/overlay-events.test.ts \
  tests/unit/query-layout.test.ts \
  tests/unit/dashboard-manifest.test.ts \
  tests/unit/dashboard-appearance.test.ts \
  tests/unit/overlay-test-harness.test.ts
```

合入前仍需按 [如何验证桌面 Demo](how-to-verify-desktop.md) 跑 lint、typecheck、全量 unit/component、build，以及本次变更涉及的 Float / Electron smoke；本页的单元测试不能替代跨进程和真实设备门禁。
