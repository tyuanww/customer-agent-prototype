# TODOS

> **复核：** 2026-09-16。四项 P3 窄分支已由产品 PR #69 合并。登录残留红字已由 PR #68 修复。BACKEND-CI-503 已由 PR #91 修复并关闭。它们仍属于 Menokin `PILOT-S0` 合成基线验证，不构成 G0 / Ddev 或正式 DEV-M0 授权。macOS M5 人工勾选见 `docs/how-to-verify-macos-m5.md`，清单进仓不等于验收通过。
>
> **Open 段的来源：** 2026-09-16 的交付形态评审（对 Windows 打包态在办公机上的可用性做只读复核）。该评审推翻了若干先前判断，结论见下。
>
> **状态口径（2026-09-17 打包态实机验证后）：** P1 的可见提示与 P8 的文档修正已随 PR #93 squash 合入 `main`（`2894fd5`）。**P1 的打包态实机验证已执行，结论为通过**。其余各项进度见各自 Status。桌面切片 PR #95–#99 以及调优 PR #101–#109 已合入，不关闭本页办公机交付 Open 项。P2 仍待拍板，未授权 P3 / P4。
>
> **方法论警告（2026-09-17）：** 验证期间曾把「对话框几秒后自行消失」判成缺陷，随后证伪——这台机器上**有人在操作**，观测窗口内 `HIDIdleTime` 从未超过 3.5 秒，且返回值是按钮下标而非模态中止码。**在本机做任何「对话框会不会自己关掉」的自动化观测都不可信**，除非同时记录 HID 输入空闲时间。

## Open

### P1 · 打包态配置失败没有可见反馈

**What:** 打包构建在 userData 缺 `synthetic-stack.json`、其中 origin 非法、或该文件不可读时，`product-runtime-config.ts` 抛错，`main.ts` 的 catch 后 `app.quit()`。双击 exe 时看不到 stdout，使用者只看到「闪一下」。

**Why:** 拒绝业务运行是合理设计；**无可见解释地退出是另一项可用性问题**。当前办公机场景必然命中这条路径。

**Context:** `apps/desktop/src/main/product-runtime-config.ts`（`PackagedProfileError`，kind 为 `missing` / `invalid` / `unreadable`）、`apps/desktop/src/main/startup-failure-notice.ts`（可见提示）、`apps/desktop/src/main/main.ts:168`（调用点）、`apps/desktop/src/main/main.ts:230`（退出路径）。fail-closed 必须保留，不得退回 S0 静默降级。

**Status:** 已实现（`d419016`），**打包态实机验证通过**。

在真实 `.app`（`pnpm package:mac:local` 产物，asar 内含新代码）上确认：

- `missing` 与 `invalid` 两类都弹出了文案与按钮正确的原生对话框。按窗口 ID 截图可见标题、正文与两个按钮；直接运行二进制时进程阻塞在 `-[NSAlert runModal]`，`sample` 采样 1645/1645 帧全在主模态循环内，对话框不会自行关闭。
- `invalid` 正确拒绝了 `apiOrigin` 指向非 loopback 的配置（`kind: 'invalid'`），fail-closed 保留，未退回 S0。
- **「重试」入口被真实点击验证过**：`missing` 场景下按默认按钮（下标 0 = 重试）后，进程树出现 `app.relaunch()` 特征——原进程派生一个子进程后退出，0.5 秒后新实例起来并重新弹窗。重试链路端到端成立。
- 单按钮场景（`invalid`）按下按钮后不重试、直接 fail-closed 退出，与设计一致。

**未覆盖**：`unreadable` 无法在真产物上复现（触发它需要 profile 目录本身不可穿越，那会连带破坏 Electron 其余的 userData 处理），仍只有单测覆盖；「重试」按钮的**合成点击**无法在本机做（进程无辅助功能权限，`AXIsProcessTrusted=false`），上面的重试证据来自真实人工点击。

### P2 · 首轮 Windows 验收范围未定

**What:** 需要用户明确：办公机首轮只验安装/启动/浮窗/快捷键/卸载，还是要验完整产品会话链（登录、查询、复制、STALE）。

**Why:** 这个决定直接选择实现路径，比「Windows 四项确认」更根本。只验前者用离线 synthetic profile 即可；验后者必须先补后端鉴权与访问准入。

**Context:** 见 `docs/plans/2026-09-10-windows-package-and-device-verification.md`。约束澄清要点：办公机是**只是不能单独安装开发工具**，还是**也禁止包内辅助进程、本地监听、数据库进程**？Electron 本身内置 Node.js，"不装 Node/pnpm" 不等于"应用内不能用 Node 运行时"。

**Effort:** — （决定项）
**Priority:** P1
**Depends on:** None
**Status:** 已拍板（2026-09-17）。首轮只验安装 / 启动 / 浮窗 / 快捷键 / 卸载；办公机只禁单独安装开发工具，不禁 Electron 自带运行时；首轮必须断网可用。路径锁 **P3 显式离线 profile**，不走 P4 / P10。

### P3 · 显式离线 synthetic profile

**What:** 给应用加一个离线演示运行模式，使用安装包内自带的合成 fixture，完全不连后端。

**Why:** 满足办公机约束的最短路径。可验安装、启动、浮窗、快捷键、卸载；不可验登录/查询/复制/STALE。

**Context:** 仅在 P2 判定为「只验安装与交互」时实施。不得把它当作产品主链验收。

**Effort:** M
**Priority:** P2
**Depends on:** P2
**Status:** 三刀代码已合入。本机 UNSIGNED mac `.app` 已 seed；本机 `pnpm package:win` 后验通过且 `win-unpacked/resources/synthetic-offline.json` 精确。办公机 Windows 实机勾选仍属后续。

### P4 · 远端后端 profile（含必须先做的鉴权）

**What:** 让打包客户端连接受控 HTTPS 远端，后端 API 与 PG 留在服务器内网，不公开 PG。

**Why:** **这是候选路径之一，不是唯一路径。** 若 P2 判定需要完整产品会话链，则需要一条能让办公机访问后端的通道；远端是其中一条，包内后端（P10）与受控本机栈是另外的候选。选择取决于「办公机是否允许包内辅助进程 / 本地监听」这一未决约束。

**Context:** **关键前置：当前合成身份不验证使用者身份**——`scripts/synthetic-stack/identity-provider.ts:60` 的 `/authorize` 直接授予默认身份，`/exchange` 接受预置 binding。**只把服务搬上 HTTPS 而不补可信身份来源与访问准入，等于把不设防接口暴露给更多主体。** loopback 强制的真实价值是**访问范围限制**，不是调用者身份证明；证书固定只加强"连的是谁"，不证明"连接者获准做什么"。

**但鉴权不是从零开始。** 本仓已有可复用的授权机制：`apps/api/src/product-auth-service.ts` 的 `authenticate` 校验 bearer 并调用 `backend_identity.actor()` 取角色；`apps/api/src/policy-rules.ts` 的 `authorizePolicyUpdate` 按 `owner` 角色授权；能力池另有角色约束与 readiness 投影。缺口是**可信身份来源**（合成 provider 直接放行）与**远端访问准入**，应基于既有机制补齐，不是重建授权层。

工程量不止一处 URL 校验：`apps/desktop/src/main/product-http.ts:7`、`product-runtime-config.ts`、`product-login-window.ts`、`apps/api/src/synthetic-identity-provider.ts:4` 及 callback 路径均有 loopback 假设。

pinning 不应作为默认必选项（证书轮换、备用 pin、企业 TLS 检查代理的兼容成本）。

**Effort:** L
**Priority:** P2
**Depends on:** P2 + 独立安全评审
**Status:** OPEN · 未授权 · **决策材料已就绪**（`docs/plans/2026-09-17-office-machine-delivery-path-decision.md`）。该路径评估经对抗性复核**未被反驳**。漏列必改点的落地情况：(1) `auth_mode` 硬编码 **第一刀已落地**（`7d0e93c`：服务端从部署配置注入，桌面端接受 `mock|feishu`，未知值 fail-closed；`AUTH_MODE=feishu` 启动门未开）；(2) **服务端 loopback 硬编码仍在**——`apps/api/src/synthetic-identity-provider.ts:4-11`、`apps/api/src/runtime-config.ts:498-502`。真实飞书 provider、打开启动门、放宽 loopback 均未授权。

### P5 · 会话未绑定后端身份

**What:** 会话存储文件名固定 `product-session.enc`，未按环境或服务身份隔离。

**Why:** 新增远端 profile 后若复用同一存储，恢复逻辑可能把旧 token 发往新目标。属安全隐患。

**Context:** `apps/desktop/src/main/product-session-store.ts:9`、`apps/desktop/src/main/product-session.ts:57`。修法：按环境/服务身份隔离会话与缓存，切换目标时清理旧状态。

**Effort:** M
**Priority:** P2
**Depends on:** P4（若走远端才成为阻塞）
**Status:** OPEN

### P6 · 两条网络栈的证书/代理覆盖

**What:** `ProductHttp` 默认使用全局 `fetch`；登录窗口使用独立 Electron session。

**Why:** 不能假设给默认 session 加一个证书钩子就覆盖所有请求。代理、证书策略与 pinning 都必须验证**实际传输路径**。

**Context:** `apps/desktop/src/main/product-http.ts:23`、`apps/desktop/src/main/product-login-window.ts:21`。

**Effort:** M
**Priority:** P3
**Depends on:** P4
**Status:** OPEN

### P7 · 检索资产的交付路径

**What:** 桌面主要查询能力不全在 API——main 使用仓外本地索引与 hydrate 快照。

**Why:** 新机器上的索引初始化、发布版本对齐、缓存失效必须纳入交付设计，不能只迁移 API + PG。打包态目前按文件存在与否决定是否启用（`packaged-retrieval-paths.ts:25`），文件不在就没有主链。

**Context:** `docs/reference-desktop-retrieval.md`、`apps/desktop/src/main/packaged-retrieval-paths.ts:18`。

**Effort:** M
**Priority:** P2
**Depends on:** P2
**Status:** OPEN

### P8 · Windows DRAFT 与启动代码冲突

**What:** Windows 方案文档两处称缺少拓扑时「按 S0 合成 fixture 启动」「只能验浮窗」，与当前启动代码不符——代码是**配置缺失即抛错退出，不退回 S0**。

**Why:** 文档与代码冲突会误导验收范围判断。**这是 P1 的根因在文档层的体现。**

**Context:** `docs/plans/2026-09-10-windows-package-and-device-verification.md` 的 §2 数据与身份、§3 启动配置行、§4 末尾、§9 日志口径共四处；对照 `apps/desktop/src/main/product-runtime-config.ts`。

**Status:** 已在工作区修正。缺文件仍退出、不退回 S0；显式 `{ "mode": "synthetic-offline" }` 才进离线浮窗。

### P10 · 办公机免装依赖的交付问题（尚未解决）

**What:** 当前安装包**只包含 desktop 的 `out` 与资产**。要跑产品主链，目标机仍需外部准备 API、worker、合成身份、PostgreSQL 15 与仓外索引文件（`discoverPg15Bin` 要求本机有 PG15 二进制；栈侧代码还要求 `requireDist` 指向已构建的 API 产物）。**这不是「基本满足免装依赖」，而是完全依赖外部准备。**

**Why:** 这是办公机场景的**真正待解问题**。P1 只让失败变得可见，没有让包变得自足。

**Context:** `scripts/synthetic-stack/stack.ts`（PG15 发现与 API dist 依赖）、`apps/desktop/scripts/package-windows.mjs`（打包范围）、`apps/desktop/src/main/packaged-retrieval-paths.ts`（索引文件存在于用户家目录）。候选方向：包内托管后端（见评审文档方案表）、远端后端（P4）、显式离线 profile（P3）。选哪条取决于 P2 的约束澄清。

**Effort:** L
**Priority:** P1
**Depends on:** P2
**Status:** OPEN · 未开工 · **决策材料已就绪**（`docs/plans/2026-09-17-office-machine-delivery-path-decision.md`）。实证：这条路今天不可能直接落地——`scripts/synthetic-stack/postgres.ts:40-65` 的 PG15 发现只认 `CUSTOMER_AGENT_PG15_BIN` / `pg_config` / Homebrew 且**无 Windows 分支**，`scripts/synthetic-stack/profile.ts:93-98` 把配置写死到 macOS 的 `Library/Application Support`，`stack.ts:45-47` 依赖仓内 `apps/api/dist`，固定端口 43100/43101/43199 占用即 fail-closed，且本机 Homebrew PG15 依赖外部 dylib、**非自包含**，不能只拷 bin 目录。**它还把未澄清约束压到最强读法**：Windows 上 unix socket + `auth-local=trust` 必须改成 TCP loopback，会重新触发「本地监听」这一条。

### P9 · M5 受影响项在新 profile 下需重验

**What:** 若引入远端或离线 profile，以下 M5 既有观察需重验：登录失效提示（含断网，确认网络错误不被误当身份失效）、M4 打包态登录/查询/复制（从干净配置开始）、STALE（远端发布/回退、租约、延迟响应）。

**Why:** 历史观察仍然有效，但**不能自动覆盖新模式**。

**Context:** `docs/how-to-verify-macos-m5.md` 第 7 节。关窗取消项**保持未观察**；Mac 浮窗等未受影响行为可按变更范围复用原证据，但不能替代 Windows 实机证据。

**Effort:** M
**Priority:** P2
**Depends on:** P3 或 P4
**Status:** OPEN

## Completed

### Login residual invalid banner

**What:** After a successful synthetic login, Query no longer reuses the red `invalidMessage` banner. Session notices distinguish unsigned, success, expired, and failed; restore and re-login paths are covered.

**Why:** Login success must not look like a validation error. Independent of D1–D5 closeout and of Windows packaging.

**Context:** Fixed in `codex/macos-m2-login-status` for the macOS synthetic query-experience slice. Not a Windows-device finding.

**Effort:** S
**Priority:** P3
**Depends on:** None
**Status:** DONE

### Cover the unavailable WindowContext branch

**What:** Handler-level test for `GET_WINDOW_CONTEXT` when the overlay controller is unavailable.

**Why:** Preserve the typed fail-closed response at the Main IPC boundary.

**Context:** Added in `apps/desktop/tests/unit/overlay-ipc-handlers.test.ts` next to the trusted and untrusted sender cases.

**Effort:** S
**Priority:** P3
**Status:** DONE

### Cover a rejected renderer WindowContext request

**What:** Query component test in which `getWindowContext()` rejects and the manual search interaction remains usable.

**Why:** Prove renderer startup degrades safely when the context request itself fails.

**Context:** Added in `apps/desktop/tests/component/QueryApp.test.tsx`.

**Effort:** S
**Priority:** P3
**Status:** DONE

### Cover simultaneous shortcut and error banners

**What:** Query layout test for the shortcut warning and the `ERROR` result banner being visible together.

**Why:** Lock the shared banner measurement owner against future height-accounting drift.

**Context:** Reused the EMPTY layout fixture in `apps/desktop/tests/component/QueryApp.test.tsx` with a copy-failure ERROR result.

**Effort:** S
**Priority:** P3
**Status:** DONE

### Cover the test harness without a Fox window

**What:** Unit test for `attachTestHarness()` when no Fox `BrowserWindow` is present.

**Why:** Keep the optional E2E provenance helper fail-closed without expanding production behavior.

**Context:** Added in `apps/desktop/tests/unit/overlay-test-harness.test.ts` with a fake Main-process fixture.

**Effort:** S
**Priority:** P3
**Status:** DONE
