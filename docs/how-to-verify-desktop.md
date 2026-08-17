# 如何验证桌面 Demo

本页按「要证明什么 → 跑哪条命令 → 它实际证明了什么」组织。命令都可以复制。先看本机静态 / 自动化结果，再单独列出只有真实设备才能证明的门禁。

相关文档：[第一次运行](tutorial-first-run.md) · [桌面合同](reference-desktop-contracts.md) · [失败安全说明](explanation-failure-safe-lifecycle.md) · [README](../README.md)

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

本页**不**要求你现在执行 Electron E2E 或打包。下列命令按需使用；「本轮文档任务」的最低核验见文末「文档任务建议跑的集合」。

---

## 1. 先选命令

| 你想证明 | 命令 | 包含完整 drag-settle？ | 会生成图标吗？ | 会先 build 吗？ |
| --- | --- | --- | --- | --- |
| 狐狸几何 / 姿态 / 探头 / FoxApp 组件的日常回归 | `pnpm test:float` | **不含** Main 完整 drag-settle 矩阵 | 否 | 否 |
| 仓内现有狐狸 / App 图标合同仍成立 | `pnpm test:assets` | 否 | **否**（只读现有资产；临时目录自测不等于改仓） | 否 |
| 带 `@float` 标签的 Electron 浮窗 smoke | `pnpm test:e2e:float` | 只覆盖 smoke 里标注 `@float` 的用例 | 否 | **是**（脚本自身先 `pnpm build`） |
| 静态质量 + 全量 unit/component | `pnpm lint` `pnpm typecheck` `pnpm test` `pnpm build` | `pnpm test` 含 `overlay-controller-fox-settle`，仍不是真实 OS 拖拽 | 否 | `pnpm build` 本身是构建 |
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

实际执行：

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
| overlay 窗工厂、几何常量、狐狸姿态分层、探头权限、FoxApp 组件合同 | **完整 drag-settle**：不跑 `tests/unit/overlay-controller-fox-settle.test.ts`，不覆盖 Main `generation` / `settleId` / `commitFoxDragSettle` 矩阵 |
| 轻量、可反复跑 | 真实拖拽、真实台前调度、真实 OS 焦点 |

完整 drag-settle 在 `pnpm test` 里，不在这条 fast loop。

### 2.2 `pnpm test:assets`

```bash
pnpm test:assets
```

实际执行：

```text
vitest run tests/unit/fox-head-assets.test.ts tests/unit/app-identity.test.ts
```

| 能证明 | 不能证明 |
| --- | --- |
| 现有 `assets/fox-head-master.png`、`fox-head.png`、Dashboard 深色耳麦、`assets/app-icon.png` 以及路径候选仍满足合同 | **不等于生成**。它不调用 `pnpm generate:fox-head` / `pnpm generate:app-icons` 去改仓内图标 |
| 生成器在临时目录的自检（若测试里用到） | 没有把临时产物写成新的 SSOT |

要重新派生图标，必须显式跑生成脚本，见 [桌面合同](reference-desktop-contracts.md#11-公开-scripts-和模块图)。

### 2.3 `pnpm test:e2e:float`

```bash
pnpm test:e2e:float
```

脚本定义是 `pnpm build && playwright test tests/e2e/smoke.spec.ts --grep @float`。

| 能证明 | 不能证明 |
| --- | --- |
| 当前构建产物能被 Playwright 拉起；`@float` 用例（半露 / 探头、harness 下的舞台边界、局部 follow / 睡眠 / press、reduced motion、Dock 程序证据等） | 真实 macOS 台前调度、真实程序坞点击观感、真实全局快捷键投递、完整 Dashboard E2E（那些不带 `@float`） |
| 脚本**自身包含 build**；不要再假设「上次的 `out/` 一定够用」 | OS 焦点一定落到输入框（自动化 activate ≠ 真实应用激活） |

### 2.4 全量静态 + 构建 + 全量 E2E

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

| 命令 | 能证明 | 不能证明 |
| --- | --- | --- |
| `pnpm lint` | ESLint 通过 | 运行时行为 |
| `pnpm typecheck` | `tsc --noEmit` 通过 | 打包签名 |
| `pnpm test` | Vitest 全量 unit / component，**含** drag-settle 与 Dashboard 授权 | 真实窗口、真实剪贴板持久化到用户会话 |
| `pnpm build` | `electron-vite` 写出 `out/main`、`out/preload`、`out/renderer` | 可以发给客户 |
| `pnpm test:e2e` | 先 build，再跑全部 Playwright（浮窗交接、数字键复制、Dashboard 单例 / 安全窗 / 滚动 / 导航等） | 真实设备门禁，见第 4 节 |

`pnpm test:e2e` 截图写到本机忽略的 `.gstack/qa-reports/screenshots/`。不要把历史 `evidence/qa/2026-08-13/` 里的像素尺寸抄成当前 Query 高度。

---

## 3. 打包命令：输出路径、能证明 / 不能证明

三类打包都**不是**「点一下就能外发」。本仓 `build.appId` 仍是 `local.demo.customer-agent`。

### 3.1 `pnpm package:mac:local`

输出目录：`release/local-unsigned/`

预期产物（名称由 `productName` + `version` + `UNSIGNED` 组成）：

- `release/local-unsigned/客服话术浮窗 Demo-0.1.0-mac-universal-UNSIGNED.dmg`
- `release/local-unsigned/客服话术浮窗 Demo-0.1.0-mac-universal-UNSIGNED.zip`
- `release/local-unsigned/mac-universal/*.app`

构建后会跑 `scripts/finalize-mac-package.mjs local`（删 `.blockmap`）和 `scripts/verify-mac-package.mjs local`。

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
node scripts/verify-mac-release-env.mjs && node scripts/package-macos.mjs distribution
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

- `release/local-unsigned/windows/客服话术浮窗 Demo-0.1.0-win-x64-UNSIGNED.exe`
- `release/local-unsigned/windows/win-unpacked/`（含 `resources/icon.ico`）

本仓没有 Windows `distribution` 路径。`mode !== 'local'` 会直接抛错。

`scripts/verify-windows-package.mjs` 能证明：存在 `UNSIGNED.exe`、无更新元数据、`win-unpacked/resources/icon.ico` 与 `build/icon.ico` 字节一致、许可文件非空。

它**不能**证明：PE 可执行文件内部图标资源、Authenticode / EV 签名、真实 Windows 安装、任务栏图标。对应验收必须在 Windows 设备上做。禁止把未签名产物写成已签名。

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

## 5. 文档任务建议跑的集合

本轮若只核文档与静态卫生，在前置 PATH 后跑：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

不要把未跑的 `pnpm test:e2e` / `package:*` 写成通过。
