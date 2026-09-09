# 如何验证桌面 Demo

本页按「要证明什么 → 跑哪条命令 → 它实际证明了什么」组织。命令都可以复制。先看本机静态 / 自动化结果，再单独列出只有真实设备才能证明的门禁。

相关文档：[第一次运行](tutorial-first-run.md) · [项目架构](reference-project-architecture.md) · [桌面合同](reference-desktop-contracts.md) · [API adapter 衔接](reference-api-adapter-handoff.md) · [失败安全说明](explanation-failure-safe-lifecycle.md) · [README](../README.md)

> 本 Demo 是合成数据、无后端、不代发。验证通过不等于可以正式发包，也不等于真实 OS 焦点 / 台前调度已被证明。

---

## 0. 本机环境（验证前）

```bash
cd ~/Desktop/customer-agent-prototype
export PATH="$HOME/homebrew/opt/node@24/bin:$HOME/homebrew/bin:$PATH"
hash -r
node -v    # 需要 v24.x
pnpm -v    # 项目锁定 11.19.0
```

企业 CA 只适用于当前这台需要系统根证书的开发机，不是通用验证前置。不要关闭 TLS 验证。

本页**不**要求你现在执行 Electron E2E 或打包。下列命令按需使用；文档任务的范围选择见文末「选择检查范围」。

---

## 1. 先选命令

| 你想证明 | 命令 | 包含完整 drag-settle？ | 会生成图标吗？ | 会先 build 吗？ |
| --- | --- | --- | --- | --- |
| 狐狸几何 / 姿态 / 探头 / FoxApp 组件的日常回归 | `pnpm test:float` | **不含** Main 完整 drag-settle 矩阵 | 否 | 否 |
| 仓内现有狐狸 / App 图标合同仍成立 | `pnpm test:assets` | 否 | **否**（只读现有资产；临时目录自测不等于改仓） | 否 |
| 带 `@float` 标签的 Electron 浮窗 smoke | `pnpm test:e2e:float` | 只覆盖 smoke 里标注 `@float` 的用例 | 否 | **是**（脚本自身先 `pnpm build`） |
| 静态质量 + 全量 unit/component | `pnpm lint` `pnpm typecheck` `pnpm test` `pnpm build` | `pnpm test` 含 `overlay-controller-fox-settle`，仍不是真实 OS 拖拽 | 否 | `pnpm build` 本身是构建 |
| W6 统一非设备总门 | `pnpm check` | 含全量 unit/component，不含真实 OS 人工门 | 否 | 是；并生成/扫描非部署型正式服务候选 |
| W4 database 全门禁 | `pnpm test:db` | 不涉及桌面拖拽 | 否 | 会构建 database package，并启动一次性 PG15 cluster |
| 全量 Electron Playwright | `pnpm test:e2e` | 含浮窗与 Dashboard smoke，仍不是真实设备门禁 | 否 | **是** |
| 本机未签名 macOS 证明包 | `pnpm package:mac:local` | 否 | 会先 `generate:app-icons` | 会先 `pnpm build` |
| 正式 macOS 外发门禁 | `pnpm package:mac` | 否 | 同上 | 同上，但当前会因 Demo `appId` fail-closed |
| 本机未签名 Windows 证明包 | `pnpm package:win` | 否 | 会先生成 ICO | 会先 electron-vite build |

---

## 2. 日常与全量检查

### 2.1 `pnpm test:float`

```bash
pnpm test:float
```

根命令会委派给 `apps/desktop`；包内实际执行：

```text
vitest run \
  tests/unit/overlay-chrome-window.test.ts \
  tests/unit/overlay-geometry.test.ts \
  tests/unit/fox-presence.test.ts \
  tests/unit/fox-motion.test.ts \
  tests/unit/overlay-events.test.ts \
  tests/unit/fox-peek-access.test.ts \
  tests/component/FoxApp.test.tsx
```

| 能证明 | 不能证明 |
| --- | --- |
| overlay 窗工厂、几何常量、狐狸姿态分层、探头权限、FoxApp 组件合同 | **完整 drag-settle**：不跑 `apps/desktop/tests/unit/overlay-controller-fox-settle.test.ts`，不覆盖 Main `generation` / `settleId` / `commitFoxDragSettle` 矩阵 |
| 轻量、可反复跑 | 真实拖拽、真实台前调度、真实 OS 焦点 |

完整 drag-settle 在 `pnpm test` 里，不在这条 fast loop。

### 2.2 `pnpm test:assets`

```bash
pnpm test:assets
```

根命令会委派给 `apps/desktop`；包内实际执行：

```text
vitest run tests/unit/fox-head-assets.test.ts tests/unit/app-identity.test.ts
```

| 能证明 | 不能证明 |
| --- | --- |
| 现有 `apps/desktop/assets/fox-head-master.png`、`apps/desktop/fox-head.png`、Dashboard 深色耳麦、`apps/desktop/assets/app-icon.png` 以及路径候选仍满足合同 | **不等于生成**。它不调用 `pnpm generate:fox-head` / `pnpm generate:app-icons` 去改仓内图标 |
| 生成器在临时目录的自检（若测试里用到） | 没有把临时产物写成新的 SSOT |

要重新派生图标，必须显式跑生成脚本，见 [桌面合同](reference-desktop-contracts.md#11-公开-scripts-和模块图)。

### 2.3 `pnpm test:e2e:float`

```bash
pnpm test:e2e:float
```

桌面包脚本定义是 `pnpm build && playwright test tests/e2e/smoke.spec.ts --grep @float`。

| 能证明 | 不能证明 |
| --- | --- |
| 当前构建产物能被 Playwright 拉起；`@float` 用例（左右停靠 / drag-settle、harness 下的舞台边界、局部 follow / 睡眠 / press、reduced motion、Dock 程序证据等） | 真实 macOS 台前调度、真实贴边 hover / retract、真实程序坞点击观感、真实全局快捷键投递、完整 Dashboard E2E（那些不带 `@float`） |
| 脚本**自身包含 build**；不要再假设「上次的 `apps/desktop/out/` 一定够用」 | OS 焦点一定落到输入框（自动化 activate ≠ 真实应用激活） |

### 2.4 全量静态 + 构建 + 全量 E2E

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
```

| 命令 | 能证明 | 不能证明 |
| --- | --- | --- |
| `pnpm lint` | ESLint 通过 | 运行时行为 |
| `pnpm typecheck` | `tsc --noEmit` 通过 | 打包签名 |
| `pnpm test` | Vitest 全量 unit / component，**含** drag-settle、Dashboard 授权、合同、database 普通 lane 与 API mock/失败关闭 | PostgreSQL 15 隔离集成门禁、真实窗口、真实剪贴板持久化到用户会话 |
| `pnpm build` | `electron-vite` 写出 `apps/desktop/out/main`、`apps/desktop/out/preload`、`apps/desktop/out/renderer` | 可以发给客户 |
| `pnpm test:e2e` | 先 build，再跑全部 Playwright（浮窗交接、数字键复制、Dashboard 可信入口 / 单例 / 安全隔离 / Dock 恢复） | 真实设备门禁，见第 4 节 |

数据库实现、migration、runner、verifier 或 PG harness 有变化时，另跑：

```bash
CUSTOMER_AGENT_PG15_BIN=/path/to/postgresql-15/bin pnpm test:db
CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api exec vitest run tests/app.test.ts
```

两条命令都只创建私有临时 data directory / Unix socket / database，结束后清理；不连接共享或生产数据库。前者证明 migration/catalogue/ledger，后者证明 runtime readiness、runtime/admin 角色隔离、策略函数完整性和失败关闭。普通桌面/UI 改动无需反复运行这些重门禁。

探头 / 缩回、Query 纵向拖拽，以及 Dashboard 导航、主题、筛选和模块交互由 `pnpm test` 中的 unit/component 测试覆盖；默认 Playwright 门禁不再执行透明 overlay 或 macOS draggable region 下不稳定的长鼠标拖拽。真实贴边 hover / retract、Query 纵向拖拽和侧栏拖拽仍按第 4 节实机验收。`pnpm test:e2e` 截图写到本机忽略的 `.gstack/qa-reports/screenshots/`。不要把历史 `evidence/qa/2026-08-13/` 里的像素尺寸抄成当前 Query 高度。

---

## 3. 打包命令：输出路径、能证明 / 不能证明

三类打包都**不是**「点一下就能外发」。本仓 `build.appId` 仍是 `local.demo.customer-agent`。

### 3.1 `pnpm package:mac:local`

输出目录：`release/local-unsigned/`

预期产物（名称由 `productName` + `version` + `UNSIGNED` 组成）：

- `release/local-unsigned/客服话术浮窗 Demo-<version>-mac-universal-UNSIGNED.dmg`
- `release/local-unsigned/客服话术浮窗 Demo-<version>-mac-universal-UNSIGNED.zip`
- `release/local-unsigned/mac-universal/*.app`

构建后会跑 `apps/desktop/scripts/finalize-mac-package.mjs local`（删 `.blockmap`）和 `apps/desktop/scripts/verify-mac-package.mjs local`。

| 后验能证明 | 后验不能证明 |
| --- | --- |
| Universal 可执行文件同时含 `arm64` 与 `x86_64` | Developer ID 签名、公证、Gatekeeper 对外部下载放行 |
| 包内 `THIRD_PARTY_NOTICES.md` 与 Electron / Chromium 许可非空 | 本 Demo 自身已被授权分发给外包或客户 |
| 品牌 ICNS 门禁通过；无 `app-update.yml` / `latest*.yml` / `.blockmap` | 真实机器上的 Dock 观感、第一次打开的系统对话框 |
| 每个本地产物文件名带 `UNSIGNED`；`codesign --verify` **必须失败**（未签名） | 「可以发给别人试」 |

该包禁止外发。经外部渠道下载后通常会被 Gatekeeper 拦截。

### 3.2 `pnpm package:mac`

脚本是：

```text
node apps/desktop/scripts/verify-mac-release-env.mjs && node apps/desktop/scripts/package-macos.mjs distribution
```

若前置通过，输出目录将是 `release/distribution/`，产物**不得**带 `UNSIGNED`，构建后再做 `codesign --verify --deep --strict`、`spctl --assess --type execute`、`xcrun stapler validate`。

**当前仓库不能暗示已经可以正式发包。** `verify-mac-release-env.mjs` 会在以下任一条件失败时直接退出：

- 不在 macOS 上构建
- 没有完整 Xcode（不能只靠 Command Line Tools）
- `appId` 以 `local.` 开头或包含 `.demo.`——**当前就是 `local.demo.customer-agent`**
- 没有 `Developer ID Application` 且未设 `CSC_LINK`
- 没有 Apple 公证凭证（API key / Apple ID / keychain profile 三选一）

因此：在公司确定长期 Bundle ID、安装证书并配置公证之前，`pnpm package:mac` 的预期结果是 **fail-closed**，不会静默产出可误外发的未签名包。不要把「脚本存在」写成「正式包已打通」。

### 3.3 `pnpm package:win`

输出目录：`release/local-unsigned/windows/`

预期产物：

- `release/local-unsigned/windows/客服话术浮窗 Demo-<version>-win-x64-UNSIGNED.exe`
- `release/local-unsigned/windows/win-unpacked/`（含 `resources/icon.ico`）

本仓没有 Windows `distribution` 路径。`mode !== 'local'` 会直接抛错。

`apps/desktop/scripts/verify-windows-package.mjs` 能证明：存在 `UNSIGNED.exe`、无更新元数据、`win-unpacked/resources/icon.ico` 与 `apps/desktop/build/icon.ico` 字节一致、许可文件非空。

它**不能**证明：PE 可执行文件内部图标资源、Authenticode / EV 签名、真实 Windows 安装、任务栏图标。对应验收必须在 Windows 设备上做。禁止把未签名产物写成已签名。

W6 的 GitHub Actions `Windows feasibility smoke` 在 hosted Windows runner 上执行 `pnpm test:e2e:windows-feasibility` 与 `pnpm package:win`。定向 E2E 会实际启动 `apps/desktop/out/main/index.js`，不经过 `apps/desktop/node_modules/@customer-agent/*` 的嵌套解析；`package:win` 先构建 `packages/contracts` runtime `dist`，再让 electron-vite 把该包内联进 main，并在打包前检查产物不含 workspace 裸导入。该路径确认 Fox / Query 两个 overlay 使用透明背景、快捷键注册成功、查询窗可打开并能干净退出；它比“脚本存在”多证明一次 clean-checkout 的 Windows 运行路径与未签名产物后验，但仍不是企业坐席真机、IME/DPI/读屏、真实 OS 按键投递、GPU 合成观感、签名、更新或 Pilot 验收。

### 3.4 W6 正式服务候选产物

```bash
pnpm artifact:m0:build
pnpm artifact:m0:verify
```

`artifact:m0:build` 和 `artifact:m0:verify` 都只接受干净工作树；builder 会自行执行全包构建，避免把旧 `dist` 误绑定到当前提交。输出位于 `release/m0-formal-runtime-candidate/`，只允许 `.js`、`.d.ts`、`.json`，内容包括 contracts、database（排除 testkit）和 API 编译结果、合同消费锁及逐文件 SHA-256 manifest。manifest 固定 `deployable=false`、`runtime_activated=false`；验证器要求 `build_git_sha` 与当前 HEAD 一致、合同身份通过仓库 intake 验证、候选合同锁与仓库受控锁逐字节一致，并拒绝 source map、tests/testkit、符号链接、桌面合成 fixture 模块、E2E 开关和常见凭证格式。该目录是 M0 构建隔离证据，不是可部署生产包。

---

## 4. 真实设备 / OS 门禁（自动化代替不了）

下列事项即使 E2E 绿了也仍需实机：

| 门禁 | 为什么自动化不够 |
| --- | --- |
| 真实程序坞点击、Cmd+Tab、Dock 图标观感 | Playwright `activate` / `app.dock.isVisible()` 只是程序证据 |
| 真实键盘焦点进入查询输入框 | BrowserWindow / WebContents 投递与 OS 激活不是一回事 |
| 真实全局快捷键 | 自动化环境往往无法稳定注入 |
| 真实台前调度舞台边界 | 代码**接受** `getBounds()`；没有自动化套件能宣称「真实 Stage Manager 已证明」 |
| macOS 折叠侧栏按钮命中 | CDP click 不能冒充 OS 命中 |
| 跨实体多显示器拖拽 | 单屏开发机测不到 |
| Windows 玻璃是否模糊桌面 | 取决于 GPU / 合成器 |
| 正式签名 / 公证 / 外发 | 当前 `local.demo` appId 直接挡住 `package:mac` |

---

## 5. 空间占用与清理

Electron 项目的工作区体积通常主要来自可再生成内容，而不是 UI 源码。先审计，再清理：

```bash
pnpm workspace:size
pnpm workspace:check
pnpm clean:preview
```

`workspace:size` 按磁盘分配量拆分 `release/`、根与桌面包 `node_modules/`、`.git/`、本地工具索引 / 报告与其余源码。项目外的 pnpm store、Playwright / Electron 下载缓存不会算进工作区总量，也不会被仓内清理脚本修改。

`workspace:check` 只检查源码、测试、文档和已纳入项目的资产等 workspace remainder，默认上限为 32 MiB；`node_modules`、本地发布包、`.git`、`.codegraph` 和用户参考 ZIP 继续单独统计，不会把可重建或本地工具内容误报为代码膨胀。若有一次性大资产确实需要纳入，可临时使用 `--remainder-budget-mib=N`，并在评审记录原因，不要永久抬高默认门槛。

| 命令 | 行为 | 恢复方式 |
| --- | --- | --- |
| `pnpm clean:preview` | 默认 dry-run；列出本地未签名包、`apps/desktop/out/`、派生 `apps/desktop/build/icon.*`、测试报告、gstack QA 报告与 Vite 缓存 | 无改动 |
| `pnpm workspace:check` | 检查不可再生源码区是否超过 32 MiB 预算 | 删除或迁移新增大文件后重跑 |
| `pnpm clean:generated` | 只删除上面的精确 allowlist | `pnpm build`、相应 `package:*` / 测试命令重新生成 |
| `pnpm clean:deep:preview` | 预览 generated + `node_modules` | 无改动 |
| `pnpm clean:deep` | 在 generated 之外删除根、API、database 与桌面包依赖目录；适合归档或依赖树严重陈旧时 | `pnpm install --frozen-lockfile`，再按需 `pnpm electron:install` |

`clean:generated` 本身就是执行入口，不要给它追加 `--dry-run`。预览必须使用独立的 `clean:preview`；CLI 会拒绝未知参数，避免把无效参数误认为已经覆盖了 `--apply`。

清理器会核对仓库包名、realpath 和精确 allowlist；遇到符号链接、仓外路径或未知 scope 会 fail-closed。它永远不接受 `.git`、`.codegraph`、`apps/desktop/src`、`apps/desktop/assets`、`evidence`、`docs`、`apps/desktop/tests` 和 `clawd-on-desk-0.15.0.zip` 作为目标。冻结 QA 证据、用户只读参考，以及 `docs/reference-api-adapter-handoff.md` 这类衔接说明都不是缓存，清理脚本不得删除。

业内通常把依赖视为锁文件可重建内容、把安装包交给 CI artifact / Release 的保留策略，而不是长期堆在源码工作区；测试报告应短期保存；共享 pnpm store 只偶尔运行 `pnpm store prune`，避免切旧分支时反复下载；Playwright 浏览器使用系统级共享缓存及其自身的未引用版本回收。

## 6. 选择检查范围

验证范围以 [AGENTS.md 第6节](../AGENTS.md#6-验证与证据) 为准；本页只解释命令和证据边界。普通文档任务执行 `git diff --check`、`pnpm docs:check` 及引用/语义核对；不默认运行 lint/typecheck/test/build。命令、CI 或构建输入实际变化时，按其代码影响面验证。

`pnpm verify:plan --base <commit>` 显示本地差异的 CI 路由（包含未提交与新增文件）。机器分类由 `scripts/verification-policy.mjs` 唯一拥有：已知文档走轻量检查，规则文档额外核对执行入口，未知路径回退完整检查。CI 保留原有检查名称并以 `CI gate` 汇总，失败、取消或缺失输出不能放行。

`pnpm test` 构建服务依赖一次并执行测试；`pnpm build` 只构建和检查生成物。干净候选的 `pnpm check` 在构建后执行测试并组装绑定 SHA 的正式候选。未提交开发使用 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`；不得为了运行 `pnpm check` 自动提交。`pnpm test:e2e*` 自带桌面 build，不需要紧邻先执行另一次桌面 build。

PG lane 的 `pnpm test:g1a:e0:ci` 仅允许纯合成输入，并核对 JSON 测试结果实际有用例且无跳过。真实包 runner 继续只在既有明确授权入口运行，不由 CI 启用。

未运行的 Electron、打包或设备验证不得写成通过。

## 合成产品会话接入（D1）

仅开发态显式设置 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 与 `CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN` 后运行 `pnpm dev`。两者必须是含端口的 `http://127.0.0.1:端口` origin，分别对应已经启动的 formal-dev API 与合成身份提供方；不能使用真实飞书地址或凭据。缺一项、非 loopback 或打包态拒启。无配置继续显式 S0 开发模式；接入模式故障不回退 S0。

Query 的「合成登录」经过独立受控登录窗，返回后显示角色、退出按钮，悬停可见到期时间；退出立即清除本地会话并尝试远端撤销。加密存储不可用时不登录、不落明文。D1 尚未接通后端搜索，登录后提示等待 D2。

自动化窗口验收：`pnpm --filter @customer-agent/desktop build` 后运行 `pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/product-session.spec.ts`。该测试使用真实 Electron 与合成 HTTP double，校验加密文件生命周期、Query 状态及 token 不跨 preload；不等于真实身份、PG 整链或人工/Windows 验收。

### D2 合成查询与复制验证

沿用 D1 的两个 loopback 配置。登录后输入问题、点击查询，先选择平台；按需选择品类或具体款并填写对应合成标识，无具体商品仅查询全店话术。有占位符的候选须填写合成订单号或日期后复制。复制成功只表示剪贴板写入，不表示发送。

`pnpm --filter @customer-agent/desktop exec vitest run tests/unit/product-search.test.ts` 检查候选归属、隔离、半开有效期、并发复制、取消及事件失败。`pnpm --filter @customer-agent/desktop exec playwright test tests/e2e/product-session.spec.ts` 在 build 后运行真实 Electron 登录/搜索/复制/退出，HTTP 为合成 double；不是 PG 整链、人工观察或 Windows 实机证据。

### D5 合成整链验证

`CUSTOMER_AGENT_API_PG15_INTEGRATION=1 pnpm --filter @customer-agent/api test:e2e:backend` 在同一 SHA 上跑导入→worker→审核→发布→桌面 adapter 查询复制→回退后旧候选 STALE→退出清空会话。桌面 adapter 经 loopback 调用已启动的 API 进程，不经 Dashboard，不等于人工观察、Windows 实机或真实飞书。
