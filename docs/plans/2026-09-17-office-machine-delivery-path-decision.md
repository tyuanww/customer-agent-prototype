# 办公机交付路径——决策就绪对比

> **状态：** 决策已拍板（2026-09-17）。首轮只验安装/启动/浮窗/快捷键/卸载；只禁单独装开发工具；必须断网。路径锁 P3。不批准 P4 / P10，不放宽 loopback。
>
> **日期：** 2026-09-17
> **来源：** 对三条候选交付路径做的只读实证（每条主张都要求落到文件:行号），外加每条路径一轮对抗性复核。四条路径评估里有三条被复核挑出问题，纠正已并入下文。
> **相关：** `TODOS.md` 的 Open 段（P2 / P3 / P4 / P10）、`docs/plans/2026-09-16-desktop-delivery-shape-review.md`、`docs/plans/2026-09-10-windows-package-and-device-verification.md`。

## 1. 这个决定卡在哪

整件事只有一个真阻塞：`TODOS.md` P2 的三个问题没有答案。在这三个答案到达之前，三条路径都只是纸面方案。

1. **首轮只验安装 / 启动 / 浮窗 / 快捷键 / 卸载，还是要验完整产品会话链**（登录、查询、复制、STALE）？
2. **办公机是「只是不能单独安装开发工具」，还是也禁止包内辅助进程 / 本地监听 / 数据库进程？** Electron 自带 Node 运行时，"不装 Node/pnpm" 不等于「应用内不能用 Node」。
3. **是否必须断网可用？**

## 2. 三条路径的实证结论

### 2.1 离线 synthetic profile（P3）

**核心结论：运行能力今天已经存在，缺的只是一个「打包态显式进入离线模式」的判定。**

- S0 离线链路在未打包态完整存在，并被真实 Electron E2E 覆盖：`apps/desktop/tests/e2e/smoke.spec.ts:263` 的浮窗 → 输入 → 3 条候选 → 数字键 2 复制 → 剪贴板比对全链，`launchApp` 不带任何 `CUSTOMER_AGENT_DESKTOP_*` 环境变量（`smoke.spec.ts:32-45`）。
- S0 fixture 是 `apps/desktop/src/renderer/data/synthetic-scripts.ts:8` 的 `SYNTHETIC_SCRIPTS`，配本地检索器 `apps/desktop/src/renderer/features/search/search-service.ts:414-478`（`MIN_HIT_SCORE=38` / `MAX_RESULTS=3`）。
- **fixture 已经被打进包了**：`apps/desktop/package.json:59-62` 的 `files` 只收 `out/**/*`，fixture 被 Vite 编进 `out/renderer`；已构建的 macOS 未签名包 asar 里可检出 44 处「澄芽」。
- 渲染器不靠「有没有 product API」选 S0，而是靠 main 投影的 session 视图：session 为 null 时 `apps/desktop/src/main/product-ipc.ts:9` 返回 `enabled:false`，`QueryApp.tsx:825` 的判据因此走 S0 分支。离线复制也放行（`clipboard-ipc.ts:15-24` 只在 `productConnected()` 为 true 时拒绝，`main.ts:156` 传的是 `() => productSession !== null`）。
- **唯一阻塞点已定位**：`main.ts:168` 的 `resolveProductProfile`，packaged 时 `product-runtime-config.ts:142` 无条件走 `readPackagedProductProfile`，缺文件即抛，被 `main.ts:229-242` 捕获后直接 `app.quit()`，窗口根本不创建。
- 离线时 `main.ts:170-176` 整段不构造 `ProductSession` / `ProductHttp` / 登录窗 / `ProductAnnounce`，所以**不监听端口、不 spawn 子进程、不碰数据库**——这正是它对这个未澄清约束不敏感的原因。

**但它不是「加一个开关」：**

- 要反转 `product-runtime-config.ts:22-24` 明写的「打包态不得回退到离线 S0 fixture」不变量。
- 要过 `docs/plans/2026-09-10-windows-package-and-device-verification.md:147` 的授权门（修改打包态 origin 拒启逻辑须先取得阶段批准）。
- 要同步改 `main.ts:168` 调用点、两个打包脚本、后验 gate，以及锁死调用串的测试断言（`apps/desktop/tests/unit/product-runtime-config.test.ts:178-194`，尤其 `:189`/`:191`）。
- **「不退回 S0」这条不变量必须用「显式判定」而不是「删文件」来绕过**：packaged 缺文件仍须是 fail-closed 的 `missing`。

**它验不到什么：** 登录、产品语义的查询与复制、STALE、无命中求助。离线态登录入口不渲染（`QueryApp.tsx:1400-1405` 在 `enabled:false` 时 `productControl=null`），而无命中求助是**死按钮**——`runHelp` 依赖 `lastProductQueryRef`（`QueryApp.tsx:1054-1057`），该 ref 只在 product 分支被赋值（`:869`），S0 分支从头到尾不写它。

**两处必须纠正的既有说法：**

- 复核推翻了「12 条 fixture 有效期全部到 2099-12-31」。实际是 11 条有效至 2099-12-31，**`syn-camp-002` 到 2026-06-30 已过期**（`synthetic-scripts.ts:196`、`:221`），按设计不返回。
- 覆盖 S0 全链的那条 E2E **不在默认 CI 门禁**：`.github/workflows/ci.yml:139` 只跑 `--grep @windows-feasibility`；且 `launchApp` 用 `...process.env` 起步（`smoke.spec.ts:41`）未清除 `CUSTOMER_AGENT_DESKTOP_*`，测试并未强制或断言走 S0。**在把它显式纳入按需门禁之前，这条路径没有回归保护。**

### 2.2 远端后端 profile（P4）

**核心结论：技术上可行，但「可信身份来源 + 远端访问准入」必须先做，不能附带做。这条评估通过了对抗性复核，未被反驳。**

- **身份不可信且可达即提权**：`scripts/synthetic-stack/identity-provider.ts:73` 无条件把 code 设为 `DEFAULT_BINDING`（`:30`），`/exchange`（`:79-93`）只按预置集合比对；而 `scripts/synthetic-stack/profile.ts:59` 的 `ALLOWED_BINDINGS` 含 `role=owner` 的 `synthetic_owner`。**远端可达 = 任意客户端可自选 owner bearer。**
- 仓库已有可复用的授权机制（`apps/api/src/product-auth-service.ts` 的 `authenticate`、`apps/api/src/policy-rules.ts` 的 `authorizePolicyUpdate`、能力池的角色约束），所以补身份是**复用加缺件，不是重建授权层**。
- 客户端 loopback 假设：`apps/desktop/src/main/product-http.ts`、`product-runtime-config.ts`、`product-login-window.ts`、`apps/api/src/synthetic-identity-provider.ts:4` 及 callback 路径。
- **两处评估漏列、由复核补上的必改点：**
  - `auth_mode` 硬编码：`apps/api/src/product-auth-service.ts:153` 写死 `auth_mode:'mock'`，客户端在 `apps/desktop/src/main/product-session.ts:41` 直接按 `'mock'` 收窄。
  - **服务端也有 loopback 硬编码**（不只是客户端）：`apps/api/src/synthetic-identity-provider.ts:4-11`、`apps/api/src/runtime-config.ts:498-502`。
- 证书 pinning **不应作为默认必选项**（证书轮换、备用 pin、企业 TLS 检查代理的兼容成本）。
- 改 loopback 红线本身需要独立安全评审与阶段批准（`docs/plans/2026-09-10-windows-package-and-device-verification.md:41`、`:147-150`）。

### 2.3 包内托管后端（P10 的直接解）

**核心结论：在今天不可能直接落地；且它把未澄清约束压到最强读法。**

- `scripts/synthetic-stack/postgres.ts:40-65` 的 PG15 发现只认 `CUSTOMER_AGENT_PG15_BIN` / `pg_config` / Homebrew，`:114`/`:124` 用 unix socket + `auth-local=trust`；**没有 Windows 分支、没有 `.exe` 语义**。
- `scripts/synthetic-stack/profile.ts:93-98` 把 `synthetic-stack.json` 写死到 macOS 的 `Library/Application Support`，**Windows 上落不到** `app.getPath('userData')`。

> **2026-09-19 注：** 写入路径已按平台对齐 Electron userData，见 [P10 userData](2026-09-19-p10-desktop-userdata-path.md)。包内后端仍不做。
- `scripts/synthetic-stack/stack.ts:45-47` 的 `API_ENTRY` 依赖仓内 `apps/api/dist/main.js`，即要求目标机先构建 API。
- 固定端口 `43100`/`43101`/`43199` 占用即 fail-closed（`profile.ts:47-52`、`stack.ts:91-100`），终端用户机无法保证空闲。
- 本机 Homebrew PG15 依赖外部 dylib、**非自包含**，不能只拷 bin 目录；mac 基线包已 213MB。
- unix socket + `auth-local=trust` 模型在 Windows 上必须改成 TCP loopback——**这会重新触发「本地监听」这条未澄清约束**。

### 2.4 横切件

| 项 | 现状（file:line） | 在哪条路径下成为阻塞 |
|---|---|---|
| P5 会话未按环境隔离 | `product-session-store.ts:9` 固定文件名 `product-session.enc`；`product-session.ts:57` restore 后直接调 `/v1/auth/me` | 仅远端 / 包内后端（换目标时旧 token 会发往新目标）；离线不成立 |
| P6 两条网络栈的证书/代理 | `product-http.ts:23`（全局 `fetch`）与 `product-login-window.ts:21`（独立 Electron session） | 仅远端 |
| P7 检索资产交付 | `packaged-retrieval-paths.ts:18-27` 仅 `existsSync` 命中才设 env，调用点在 `main.ts:171` 的 `if (productProfile)` 内 | 远端 / 包内后端；离线整段跳过，不成立 |
| P9 新 profile 下 M5 重验 | `docs/how-to-verify-macos-m5.md` 第 7 节 | 取决于最终选哪条，任一新 profile 都需要 |

## 3. 决策矩阵

| 约束读法 | 可行路径 | 能验到什么 | 验不到什么 | 代价 | 最大阻塞风险 |
|---|---|---|---|---|---|
| **读法一（最宽）**：只禁「单独安装开发工具」，允许包内进程 / 本地监听 / 数据库进程 | 三条都可行；**只有包内后端能同时做到零外部准备 + 完整主链** | 包内后端可零外部准备跑通完整会话链（前提是先补身份与准入） | 都不能自动证明办公机实机行为、SmartScreen、中文 userData 路径 | 包内后端 L+；远端 L + 安全评审；离线 M | 办公机若是 Windows，需先做一次完整栈移植，且固定端口在用户机上不保证空闲 |
| **读法二（中）**：也禁包内进程 / 本地监听 / 数据库进程，但允许出站到受控远端 | **只剩远端（P4）**；离线降为演示包 | 完整会话链，且办公机不跑任何本地进程 | 断网可用性；上 HTTPS 本身也证明不了「连接者是谁、获准做什么」 | L + 独立安全评审 | 可信身份来源与远端准入必须先做（现状：可达即等于可自选 owner） |
| **读法三（最严）**：读法二 + 必须断网可用 | **只剩离线 profile（P3）**，且只能定位为演示包 | 仅安装 / 启动 / 浮窗 / 快捷键 / 卸载 + S0 本地查询与复制 | 登录、产品语义的查询/复制、STALE、无命中求助 | M（但含反转不变量、过授权门、改打包与测试断言） | 唯一覆盖 S0 全链的 E2E 不在默认 CI 门禁，当前无回归保护 |
| **读法四（叠加平台）**：读法一 + 办公机是 Windows x64 | 同读法一，但包内后端要额外背一次完整栈移植 | 同读法一，但所有实机证据必须来自 Windows 真机 | 包内后端在 Windows 上今天完全不可跑 | 包内后端 Windows 化 L+ | PG15 能否随包再分发；socket→TCP 会重新触发「本地监听」约束 |

## 4. 共同前置（无论选哪条）

1. **先拿到 P2 的三项答复**，这是唯一的真阻塞。
2. 确认办公机 OS 与实机台账，确认首轮仍纯合成、接受未签名 NSIS。
3. 建立证据分账口径：CI 绿、macOS 反馈、文档存在**都不得勾选 Windows 实机项**。
4. 任何触达打包态 origin 拒启逻辑 / loopback 红线的改动，先取独立工程与阶段批准，且**不得削弱 fail-closed、不得退回 S0 静默降级**。
5. 若首轮要产品主链：先补可信身份来源 + 远端访问准入。
6. 若首轮要产品主链：会话存储按目标隔离（P5）、检索资产交付纳入设计（P7）。

## 5. 推荐

**在 P2 三个答案到达之前，以离线 profile（P3）作为首轮可交付形态推进。** 理由：它对唯一未澄清的约束（是否禁包内进程 / 本地监听 / 数据库）不敏感——不监听端口、不 spawn 子进程、不碰数据库——而且是唯一不被身份与准入缺口阻塞的路径。

但必须同时接受三条限制：它**不是**加一个开关；它**只能**验安装/启动/浮窗/快捷键/卸载 + S0 本地查询复制，**绝不能当产品主链验收**；它的 S0 全链 E2E 需要显式纳入按需门禁，否则没有回归保护。

**若拍板必须完整会话链，选远端（P4）而不是包内后端。** 包内后端今天在 Windows 上要先完成 `postgres.ts` / `profile.ts` 的完整移植，并把未澄清约束压到最强读法；远端的前置同样是先补身份与准入，但不需要目标机跑任何本地进程。

> **2026-09-19 注：** 包内后端本轮不做。安装包合同禁止 extraResources 打进 PG/API。见 [P10 第一刀](2026-09-19-p10-no-bundled-stack.md)。

## 6. 本轮纠正的既有误判

- 「12 条 fixture 全部有效到 2099」→ 实际 11 条，`syn-camp-002` 已于 2026-06-30 过期。
- 「离线 profile 只是加一个开关」→ 它要反转一条明写的不变量、过一次授权门、改打包脚本与测试断言。
- 「补身份是从零重建授权层」→ 不成立，仓库已有 `authenticate` / `authorizePolicyUpdate` / 能力池角色约束，缺的是**可信身份来源**与**远端访问准入**。
- 远端路径评估漏列两处必改点：`auth_mode` 硬编码 `'mock'`，以及服务端（不只是客户端）的 loopback 硬编码。

**未变的红线：** loopback 红线不动；fail-closed 不削弱；不退回 S0 静默降级；本轮没有做任何打包、安装、签名、公证或部署。
