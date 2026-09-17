# 交付形态评审：打包态桌面应用如何连接后端（2026-09-16）

> **状态：评审记录（REVIEW RECORD）。本文不是实施批准。**
> 它固定一次只读评审的结论：打包态桌面应用应当如何连接后端，以及现有方案（强制本机 loopback + 本机合成 PG15）在办公机场景是否可行。
> 本文不授权任何代码、拓扑、打包、签名、部署或安全改动；不授权开工 Windows 实机、远端后端或新 profile；不把任何 M5 人工项写成已通过。
> 评审对象是**当前交付形态的可行性**，不是某个 PR 的代码质量。本文写作时未改动 `apps/` / `packages/` 的实现。
> 与本文配套的 Open 待办见 [TODOS](../../TODOS.md#open)，Windows 计划入口见 [Windows 安装包与实机验证方案](2026-09-10-windows-package-and-device-verification.md)（仍为 DRAFT）。

相关：[执行清单](2026-09-06-execution-goal.md) · [桌面与后端接入准备](2026-09-09-desktop-integration-preparation.md) · [API 启动配置与拒启矩阵](../reference-api-runtime-config.md) · [macOS M5 人工核验](../how-to-verify-macos-m5.md) · [项目架构](../reference-project-architecture.md)

## 0. 评审问题与结论摘要

**问题：**

1. 打包态桌面应用应该怎么连接后端？
2. 现有方案——强制本机 loopback `http://127.0.0.1:<port>/` + 本机合成 PostgreSQL 15——在办公机场景是否可行？

**结论：**

- 现有 loopback 方案**在架构上并非不可行**，但它的成立前提是「API、合成身份、PG15 与检索资产都出现在同一台机器上」。办公机约束若只禁止「单独安装开发工具」，它可成立；若禁止「包内辅助进程、本地监听、数据库进程」，它不成立。这条前提目前**未确认**（见 §7 未决问题 1）。
- 真正必须先决定的是**首轮验收范围**：只验安装/浮窗/快捷键/卸载，还是验完整产品会话链。这个决定比「选哪个传输方案」更根本，因为它直接决定要不要先补后端鉴权与访问准入。
- 若首轮要求完整会话链，则**不能先把远端客户端做完再发现后端无法安全承接**。后端安全边界应与客户端一起做成一个合成纵向切片。
- loopback 强制的真实价值是**访问范围限制**，不是**调用者身份证明**。把服务搬上 HTTPS 而不补**可信身份来源与远端访问准入**，等于让更多主体触达一个「授权层在、但身份来源不可信」的接口（见 §4）。**注意：本仓已有 bearer 校验与 owner 角色授权，缺的是可信身份来源，不是从零建授权层。**

**本文的证据分级：** 每节区分【已知事实】（可核验）、【推断】（由事实推出、未直接验证）、【不确定】（查不到或工具受限）。工具受限项在 §9 说明。

## 1. 被推翻的判断

本节记录评审过程中被推翻的四条先前判断。它们**曾被写入或用于讨论**，本节的目的是固化「错在哪、为什么错」，避免同类推理再次发生。所有四条都被推翻，不要再引用为事实。

### 1.1 被推翻：「clawd-on-desk 是零本地服务」

- **原判断：** `clawd-on-desk` 不启动任何本地服务。依据是它的 `package.json` 依赖列表里没有数据库或 Web 框架。
- **事实：** 该仓库的 `src/server.js` 用 Node 内置 `http` 模块创建 HTTP server 并监听 `127.0.0.1`。
  - 行号核实（对仓内只读参考件 `clawd-on-desk-0.15.0.zip` 的 `src/server.js`）：`const http = require("http")`（`:5`）、`http.createServer`（`:72`）、`httpServer.listen(listenPorts[listenIndex], "127.0.0.1")`（`:797`、`:857`）。
  - 上游 [`rullerzhou-afk/clawd-on-desk` `src/server.js`](https://github.com/rullerzhou-afk/clawd-on-desk/blob/main/src/server.js) 的当前 `main` 分支含**同样的**三处结构（`require("http")`、`http.createServer`、`listen(..., "127.0.0.1")`），行号已演进：`require("http")` 仍在 `:5`，`http.createServer` 在 `:74`，`listen(..., "127.0.0.1")` 在 `:853`、`:913`。引用行号时以 0.15.0 参考件为准。
  - 依赖列表确为 `@larksuiteoapi/node-sdk`、`electron-updater`、`htmlparser2`、`jsonc-parser`、`koffi`、`markdown-it`、`ws`——没有 `http`（`gh api repos/rullerzhou-afk/clawd-on-desk/contents/package.json` 与参考件一致）。
- **错在哪：** 用**依赖列表**推断**架构**。`node:http` 是 Node 内置模块，从设计上就不会出现在 `package.json` 的依赖里；「依赖里没有 Web 框架」不能推出「进程里没有 HTTP server」。
- **教训：** 判断一个应用有没有本地服务，要看**启动路径与网络调用**（`listen` / `createServer` / `spawn`），不是看依赖清单。

### 1.2 被推翻：「OpenAI Codex 是单个静态二进制，所以无本地服务」

- **原判断：** Codex 发布物是单个静态二进制，因此没有本地服务。依据是产物文件名按 Rust target triple 命名。
- **事实：** target triple 只描述**平台与 ABI**，不证明静态链接、进程数量或有无服务。该 release 实际提供多个独立产物：
  - `gh api repos/openai/codex/releases/latest`（tag `rust-v0.154.0`）共 **160** 个 asset，除 `codex-*-<triple>` 外还有 `codex-app-server-*`、`codex-responses-api-proxy-*`、`codex-app-server-package-*` 等。
  - CLI 支持多种传输：`codex-rs/app-server-transport/src/transport/mod.rs` 定义 `enum AppServerTransport { Stdio, UnixSocket { socket_path }, WebSocket { bind_address } }`，解析错误信息形如 `unsupported --listen URL ...; expected 'stdio://', 'unix://', 'unix://PATH', 'ws://IP:PORT', or 'off'`，默认 `DEFAULT_LISTEN_URL = "stdio://"`。
  - `codex-rs/state/Cargo.toml` 依赖 `libsqlite3-sys`（`codex-state` 依赖 SQLite）。
- **错在哪：** 从**产物命名规则**推出**运行时形态**。triple 是构建目标，不是进程模型，也不是链接方式。
- **教训：** 「单二进制」与「无服务」是两件独立的事；一个二进制可以既监听 socket 又内嵌 SQLite。

### 1.3 被推翻：「本仓 profile 矩阵里的 single-host 就是行业标准答案的名字」

- **原判断：** 本仓 profile 矩阵里已经有 `single-host`，说明这就是「标准答案」的名字。
- **事实：** `single-host` 描述的是**后端部署拓扑**（API 与 PG/worker 的部署关系），不决定**桌面客户端连接哪里**。
  - [API 启动配置与拒启矩阵](../reference-api-runtime-config.md) 的 profile 取值是 `demo | formal-dev | test | single-host | multi-instance | production`，其中 `single-host` 当前**拒启**，原因是「DB、storage、auth、readiness 与部署门尚未闭合」。
  - [后端运行时计划](2026-09-08-backend-runtime-plan.md) 把它定义为「API + 独立 TS worker……首个开发 profile 单主机 API/worker 共享持久卷」。
- **错在哪：** 把**部署拓扑的维度**当成了**客户端连接方式的答案**。两者可以同时成立：后端仍是 `single-host`，而桌面客户端连的是远端主机。
- **教训：** 一个名字只回答它所在维度的问题，不要从一个维度的取值外推到另一个维度。

### 1.4 被推翻：「本仓拒绝 latest\*.yml / .blockmap 说明后端架构落后」

- **原判断：** 打包配置不产出 `latest*.yml` / `.blockmap`，说明后端架构落后或缺失。
- **事实：** 这与后端架构**无关**，与远端业务 API 是**两条独立链路**。
  - `apps/desktop/package.json` 的 `build.publish` 为 `null`，因此 electron-builder 不产出增量更新元数据与差分块。仓内 `find` 未找到 `latest*.yml` / `*.blockmap`。**注意：`publish: null` 与「是否签名」是两件事。** 本仓 mac 目标设 `hardenedRuntime: true` / `forceCodeSigning: true` / `notarize: true`，artifactName 不含 `UNSIGNED`；而 `package:mac:local` 会显式覆盖为 `identity=null` / `notarize=false` / `forceCodeSigning=false` 并加 `-UNSIGNED` 后缀。所以「拒绝更新元数据」只说明**没有自动更新通道**，不能用来推断签名状态，也不能用来判定后端架构成熟度。
  - 自动更新链路（更新元数据、签名、块差分）走的是**发布分发**；业务数据链路走的是**这台机器与业务 API 之间**的会话。二者的成败互不证明。
- **错在哪：** 把**分发链路的配置**读成了**业务后端架构的证据**。
- **教训：** 先确认一条证据属于哪条链路，再谈它证明了什么。

## 2. 【已知事实】外部依据

### 2.1 桌面应用内嵌本地服务是既有产品形态

| 产品 | 事实 | 依据（可核验） |
| --- | --- | --- |
| pgAdmin 4（Desktop 模式） | 桌面运行时启动 pgAdmin server，并开一个窗口渲染界面；运行时基于 Electron，「集成了浏览器与 Python server」 | [`pgadmin-org/pgadmin4` `docs/en_US/desktop_deployment.rst`](https://github.com/pgadmin-org/pgadmin4/blob/master/docs/en_US/desktop_deployment.rst)（原文：*The desktop runtime is a standalone application that when launched, runs the pgAdmin server and opens a window to render the user interface.*；*The Desktop Runtime is based on Electron which integrates a browser and the Python server creating a standalone application.*）。服务进程的创建在 [`runtime/src/js/pgadmin.js`](https://github.com/pgadmin-org/pgadmin4/blob/master/runtime/src/js/pgadmin.js)：`:15` `import { spawn } from 'child_process';`、`:269` `pgadminServerProcess = spawn(pythonPath, ['-s', pgadminFile]);`。Python 可执行路径由 [`runtime/src/js/misc.js`](https://github.com/pgadmin-org/pgadmin4/blob/master/runtime/src/js/misc.js) 的 `getAppPaths` 组装（该文件**不含** `child_process`，只做路径拼装）；[`runtime/package.json`](https://github.com/pgadmin-org/pgadmin4/blob/master/runtime/package.json) 依赖 `electron` |
| JupyterLab Desktop | 基于 Electron；管理本机 Python 环境并为每个会话启动 JupyterLab Server | [`jupyterlab/jupyterlab-desktop`](https://github.com/jupyterlab/jupyterlab-desktop)（描述：*JupyterLab desktop application, based on Electron.*）；[`README.md`](https://github.com/jupyterlab/jupyterlab-desktop/blob/master/README.md) 有 *Sessions represent local project launches and connections to existing JupyterLab servers.*；[`python-env-management.md`](https://github.com/jupyterlab/jupyterlab-desktop/blob/master/python-env-management.md) 有 *bundled environment installer*、*default Python environment for JupyterLab Server instances launched by JLD* |

**结论（已知事实）：** 桌面应用内嵌本地服务、甚至内嵌数据库解释器，是已发布产品的正常形态。**它不能被外推成「每个桌面安装都必须有本机 PG」。**

### 2.2 Electron 本身内置 Node.js

- **已知事实：** Electron 的 main process 运行在 Node.js 环境里，可以 `require` 模块并使用全部 Node.js API（含 `node:http`、`node:child_process`）。
  - 依据：[`electron/electron` `docs/tutorial/process-model.md`](https://github.com/electron/electron/blob/main/docs/tutorial/process-model.md) —— *The main process runs in a Node.js environment, meaning it has the ability to `require` modules and use all of Node.js APIs.*；utility process 同样 *runs in a Node.js environment*。
  - 本仓 `apps/desktop/package.json` 依赖 `electron: ^43.4.0`。
- **推论（重要）：** **「办公机不装 Node/pnpm」不等于「应用内不能用 Node 运行时」。** 约束的真正落点是「能不能随包带入并在包内跑辅助进程」，不是「这台机器上有没有 Node 命令」。

### 2.3 DaVinci Resolve 的 PostgreSQL 工作流

- **【不确定】** 评审未取得 Blackmagic 官方文档的可核验链接（本环境 WebSearch / WebFetch 不可用，见 §9），因此**不把「DaVinci Resolve 用 PostgreSQL 项目库」写成本文的事实依据**。
- 可以确定的方向是：它属于**可选的工作流**（多工位共享项目库时要求自建 PostgreSQL），而不是「每个桌面安装都必须有本机 PG」的证明。这一条**仍待核实来源**，不要据此决策。

## 3. 【已知事实】本仓代码依据

以下行号于 2026-09-16 核对。注意 `apps/desktop/src/main/product-runtime-config.ts` 与 `main.ts` 当时**正处于工作树未提交修改中**（P1 可见反馈的实现）；`readPackagedProductProfile` 在提交版约为 `product-runtime-config.ts:72`，工作树当前为 `:103`。引用时以符号名为准。

### 3.1 打包态配置缺失是拒启，不退回 S0

- `apps/desktop/src/main/product-runtime-config.ts`
  - `readPackagedProductProfile(userDataDirectory)`（`:103`）调用 `parsePackagedProductProfile`，失败即 `throw new PackagedProfileError(result.kind)`（`:105`）。
  - `parsePackagedProductProfile`（`:73`）在文件缺失、非普通文件、超长、非 JSON、`mode` 不符、任一 origin 非法、或两 origin 相同时返回 `{ ok: false }`；错误详情原因是**有限枚举**（`missing` / `invalid`）。
  - `resolveProductProfile`（`:113`）在 `packaged` 时只读该文件，**忽略 `environment`**（`developmentProductProfile` 只在未打包时读 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` / `..._IDENTITY_ORIGIN`）。
  - 注释明确：*A missing or invalid file is a startup error: the packaged client must not fall back to the offline S0 fixture, and it must not consult the environment as a substitute.*
- `apps/desktop/src/main/main.ts`
  - 调用点 `const productProfile = resolveProductProfile(app.isPackaged, userDataDirectory, process.env)`（`:168`）。
  - 退出路径：启动链 `.catch((error: unknown) => { ... })`（`:229`）记一条 `console.error('[bootstrap] 主进程启动失败，已安全退出。', error)`（`:230`）后 `app.quit()`（`:241`）。
- **后果（已知事实）：** 双击 exe 时看不到 stdout；配置缺失时使用者只看到「闪一下」。
- **注（工作树事实）：** 评审期间已有并行实现引入 `apps/desktop/src/main/startup-failure-notice.ts`（`dialog.showErrorBox` 呈现固定文案，`PackagedProfileError.kind` 区分 missing / invalid，未知错误退回通用文案），并在 `main.ts:239` 调用 `notifyStartupFailure(error)`；`fail-closed` 与 `app.quit()` 未变。**该改动当时未提交**，本文只记录其存在，不据此宣称 P1 已解决。

### 3.2 会话存储未按环境或服务身份隔离

- `apps/desktop/src/main/product-session-store.ts:9`：`const target = path.join(directory, 'product-session.enc')`。文件名**固定**，未按 profile、环境或服务身份隔离。
- `apps/desktop/src/main/product-session.ts:57` `restore()` 会读取该文件、校验并调 `/v1/auth/me` 重新识别身份（`:37` `identify`）。
- **风险（推断）：** 引入远端 profile 后，若同一 `userData` 目录被复用，`restore()` 可能把上一次目标（例如本机 loopback）留下的 token 发往**新的**目标主机。当前 loopback 单目标下不构成问题；一旦出现第二个目标就成为隐患。

### 3.3 两条独立网络栈

- `apps/desktop/src/main/product-http.ts:23`：`constructor(origin: string, private readonly transport: typeof fetch = fetch)` —— 业务 HTTP **默认走全局 `fetch`**。
- `apps/desktop/src/main/product-login-window.ts:21`：登录窗用 `session.fromPartition('synthetic-login-<uuid>')` 创建**独立 Electron session**（非持久分区），并挂 `setPermissionRequestHandler` / `onBeforeRequest` / `will-navigate` / `will-redirect` 守卫。
- **推断：** 不能假设「给默认 session 加一个证书 / 代理钩子」就覆盖所有出站请求——业务请求与登录导航走的是两条路径，代理、证书策略与 pinning 都必须按**实际传输路径**分别验证。

### 3.4 合成身份不验证使用者身份

- `scripts/synthetic-stack/identity-provider.ts`
  - `/authorize`（`:60`）无条件把 `DEFAULT_BINDING = 'synthetic_agent'`（`:30`）作为 `code` 回送，*The synthetic provider always grants the default subject*（模块注释）。
  - `/exchange`（`:79`）只校验 `code` 是否在 `ALLOWED_BINDINGS`（`:90`），命中即回 `{ provider: 'synthetic', binding_id: code }`。
  - 当前唯一的准入是 `loopback(url, request)`（`:51`）：要求 `url.hostname === '127.0.0.1'` 且 `request.socket.remoteAddress === '127.0.0.1'`。
- `apps/api/src/synthetic-identity-provider.ts:4`（`createSyntheticIdentityProvider`）同样要求精确 loopback URL，且 callback 路径固定 `/v1/auth/callback`。
- **已知事实：** 合成身份**不验证使用者是谁**；它的安全性**完全依赖「只有本机能连」**这一条。

### 3.5 桌面主要查询能力不全在 API

- `apps/desktop/src/main/packaged-retrieval-paths.ts`
  - `applyPackagedRetrievalDefaults`（`:18`）在打包态把 hydrate / BM25 指向**仓外**文件（`~/.customer-agent-synthetic-stack/retrieval-index.json`、`retrieval-hydrate.json`），且**仅当文件存在**时才设置环境变量（`:25`、`:26` 的 `existsSync` 判断）。
  - 注释：*If the known off-repo files exist, point hydrate / BM25 at them so leftover `/v1/search` is not the packaged main chain.*
- **已知事实：** 打包态的主查询链依赖**随机器准备的仓外索引文件**，不是纯 API 能力。新机器上的索引初始化与发布版本对齐必须纳入交付设计，不能只迁移 API + PG。

### 3.6 loopback 假设不止一处

| 位置 | loopback 假设 |
| --- | --- |
| `apps/desktop/src/main/product-http.ts:7` | `loopbackOrigin` 只接受 `http:` + `127.0.0.1` + 显式端口，拒绝 userinfo / path / query / fragment |
| `apps/desktop/src/main/product-runtime-config.ts:58` | 同上的独立实现（未知值版本），并对 `synthetic-stack.json` 全字段复验 |
| `apps/desktop/src/main/product-login-window.ts:15` | `loopbackOrigin(providerOrigin)` / `loopbackOrigin(apiOrigin)` |
| `apps/desktop/src/main/product-help-open.ts:18` | `loopbackOrigin(identityOrigin)` |
| `apps/api/src/synthetic-identity-provider.ts:8` | provider 与 callback 均要求精确 loopback URL |
| `apps/api/src/runtime-config.ts:498` | `SYNTHETIC_IDENTITY_PROVIDER_ORIGIN` 解析约束 |

- **已知事实：** 把客户端或服务搬上 HTTPS 不是「改一个 URL 校验」。上述每一处都要重新定义「什么目标是合法的」，并分别回答访问准入与业务授权。
- **附注（已知事实）：** `apps/desktop/src/main/main.ts:34` 的开发态 CSP `connect-src` 白名单为 `'self'` 加 `127.0.0.1` / `localhost`；`PROD_CSP`（`:37`）为 `connect-src 'self'`。CSP 约束的是 renderer，不是 main 的 `fetch`，但它是「哪些出站目标被视为正常」这一认知的又一处痕迹。

## 4. 【关键判断】loopback 强制的真实价值，与证书固定的边界

这两条是评审的核心结论，直接决定后续方案的排序。

### 4.1 loopback 强制的真实价值是「访问范围限制」，不是「调用者身份证明」

- 当前合成链路的安全性由**两点**共同构成：合成的信任模型（**身份来源不验证使用者是谁**）＋ 只有本机能连（`identity-provider.ts:51` 的 `loopback()`）。
- **注意区分两件事**：本仓**已经有可用的授权机制**——`apps/api/src/product-auth-service.ts` 的 `authenticate` 会校验 bearer 并调用 `backend_identity.actor()` 取角色，`apps/api/src/policy-rules.ts` 的 `authorizePolicyUpdate` 按 `owner` 角色授权，能力池另有角色约束与 readiness 投影。**缺的不是授权层，而是可信身份来源**：合成 provider 的 `/authorize` 直接授予默认身份（`identity-provider.ts:60`），所以「验过身份」这一环在合成环境下是空的。
- **因此：** 只把服务搬上 HTTPS 而不补**可信身份来源与远端访问准入**，等于让更多主体能够触达一个「授权层在、但身份来源不可信」的接口。HTTPS 保护传输中的机密性与完整性，它不回答「这个连接者是谁、有没有资格调用」。
- **证书固定（pinning）只加强「连的是谁」，不证明「连接者获准做什么」。** pinning 是**服务端身份**的证明手段，不是**客户端授权**手段。两者不可互相替代。

### 4.2 pinning 不应作为默认必选项

- **理由（推断，基于运维常识与 §3.3 的两条栈事实）：**
  - 证书轮换：pin 值随证书更新而失效，需要备用 pin 与更新窗口。
  - 企业 TLS 检查代理：中间人代理会替换证书链，pinning 会与之直接冲突，需要例外策略。
  - 覆盖不全：§3.3 表明请求分散在全局 `fetch` 与独立 Electron session 两条路径，单点钩子不覆盖全部。
- **约束：** 若未来确需 pinning，应当**按实际传输路径逐条验证**，并作为显式安全决策记录，不作为默认开关。

## 5. 方案对比

比较维度：跨平台可行性 / 安全边界 / 运维成本 / 对「办公机不能装依赖」约束的满足度。

| 方案 | 跨平台可行性 | 安全边界 | 运维成本 | 满足「办公机不能装依赖」 |
| --- | --- | --- | --- | --- |
| **本机 loopback（现状）** | 好：三平台都用 `127.0.0.1` | 仅「只有本机能连」；合成身份不验证使用者；**已有** bearer 会话、角色校验与数据库能力权限，缺的是**可信身份来源**与远端访问准入 | 每台机器要备齐 API + 合成身份 + PG15 + 仓外索引文件；**当前安装包只含 desktop out 与资产，后端全部依赖外部准备**；无集中运维 | **取决于约束定义**：禁止「单独安装开发工具」→ 基本满足；禁止「包内辅助进程 / 本地监听 / 数据库进程」→ 不满足 |
| **远端 HTTPS 后端** | 好 | **需补齐，不是从零**：可信身份来源 + 访问准入 + 传输安全。既有 `product-auth-service.ts` 的 bearer 校验 / `backend_identity.actor()` 与 `policy-rules.ts` 的 owner 授权可复用并复核；**不补准入就是给不设防接口扩面** | 集中运维（一套后端）；网络可达性与企业代理策略是关键未知 | 好（客户端不需要本机服务） |
| **unix socket / named pipe** | **中等**：Windows 自 Insider Build 17063 起支持 `AF_UNIX`（见 [Microsoft 互操作文档](https://learn.microsoft.com/en-us/windows/win32/ipc/interprocess-communications)），并非「无 unix socket」；named pipe 是另一套 API。**但 Node / Electron / PostgreSQL 各自对 `AF_UNIX` 的实际支持仍需另行验证**，不能由 OS 有能力直接推出全链路可用 | **换传输不等于完成鉴权**——它仍是访问范围限制，不解决「合成身份不验证使用者」 | 中：双平台分支、命名与清理规则、Windows 安全描述符 | 中：仍是本机服务，只是不监听 TCP 端口 |
| **嵌入式数据库（如 SQLite）** | 好：成熟跨平台 | **SQLite 不实现 PostgreSQL 式 `GRANT` / `REVOKE`**；本仓能力角色与 readiness 指纹（`app_runtime` / `app_content_admin` / `cs_ai_definer` 的封闭成员关系与 ACL 投影）在 SQLite 没有等价物 | 低（无独立服务进程），但要重写权限模型 | 好（无独立数据库进程） |
| **安装包内置后端** | 好 | 与本机 loopback 同级：范围限制能成立，身份问题仍在 | 分发体积与启动编排变复杂；后续版本升级要换包 | 好（不要求用户单独安装） |
| **显式离线 synthetic profile** | 好 | 最小：完全不出网 | 最低 | 好 |
| **远端后端 + 本地索引缓存** | 好 | 需要处理缓存与远端发布版本的对齐、失效与越权读 | 中高：索引版本、失效、回滚 | 好，但要注意 §3.5：索引文件本身是一次交付负担 |
| **Web / VDI** | 好（浏览器即可） | 与传统 Web 应用同级问题域 | 集中化，最低的客户端运维 | 最好（无本地安装） |

**表格使用注意：**

- **named pipe 换传输不等于完成鉴权。** 它把「哪些主体能连上」收窄了，但不回答「连上的主体获准做什么」。
- **SQLite 不能当换驱动处理。** 本仓已有能力角色与 readiness 指纹（[API 启动配置与拒启矩阵](../reference-api-runtime-config.md) §3 的 capability 投影与 `app_runtime` 封闭成员关系）。SQLite 没有 `GRANT` / `REVOKE`，也没有等价的 definer 与 ACL 投影；换到 SQLite 意味着**权限模型要重新设计**，不是移植 SQL。
- 「离线 synthetic profile」这一行**只满足安装 / 启动 / 浮窗 / 快捷键 / 卸载**，不满足登录 / 查询 / 复制 / STALE。不要把它当作产品主链验收。

## 6. 推荐路径

### 6.1 第一步不是选方案

**第一步是先回答「验什么」。** 同样的问题在 [TODOS](../../TODOS.md#open) P2 已登记为待用户决定。两种首轮验收目标对应的实现路径完全不同：

| 首轮验什么 | 可实现路径 | 需要先补什么 |
| --- | --- | --- |
| 只验安装 / 启动 / 浮窗 / 快捷键 / 卸载 | 显式离线 synthetic profile（包内 fixture，不连后端） | 打包态配置失败要有可见解释；不引入任何新后端边界 |
| 验完整产品会话链（登录、查询、复制、STALE） | 必须有可安全承接的后端 | **先补后端访问准入与业务授权**，再谈传输 |

### 6.2 不要先做好远端客户端再发现后端无法安全承接

- 若 6.1 选了「完整会话链」，正确顺序是：**后端安全边界与客户端一起做成一个合成纵向切片**，而不是先让客户端连上、再回头补鉴权。
- 理由（推断，由 §4.1 推出）：当前后端的可达性建立在「只有本机能连」上，而**身份来源**是合成的（授权层本身存在）。客户端先行会在**可信身份来源与远端访问准入建立之前**，把接口以更广的可达范围暴露出去。
- 纵向切片应至少同时覆盖：目标合法性的重新定义（§3.6 各处）、会话与存储的按身份隔离（§3.2）、两条网络栈的策略一致性（§3.3）、以及合成身份之外的身份与授权来源（§3.4）。

## 7. 未决问题（待用户回答）

以下四项是**阻塞性输入**。在得到答复前，本文只记录问题，不预设答案，也不据此开工。

1. **办公机限制的精确定义。** 是**只是不能单独安装开发工具**（Node / pnpm / PostgreSQL 命令），还是**也禁止包内辅助进程、本地监听、数据库进程**？这条直接决定 §5 表中「本机 loopback」与「安装包内置后端」是否可行。§2.2 已说明「不装 Node/pnpm」与「应用内不能用 Node 运行时」是两件事。
2. **远端环境是否实际获批。** 具体主机、访问范围、维护责任归属、企业代理策略。没有获批主机与责任主体时，「远端 HTTPS」只是纸面方案。
3. **首轮验收目标。** 仅安装交互，还是完整会话链？是否必须**断网可用**？断网可用会把方案选择直接推向离线 profile 一侧。
4. **检索能力范围。** 保留本地检索还是迁服务端？合成索引如何交付（随包、随机器初始化、还是远端下发）？§3.5 说明打包态主链目前依赖仓外索引文件。

## 8. 对新 profile 的 M5 影响

**前提：** 若引入新的 profile（远端、离线、或其它），[macOS M5 人工核验清单](../how-to-verify-macos-m5.md) 的既有观察**仍然有效**，但**不能自动覆盖新模式**。历史观察绑定的是当时的客户端路径与拓扑（开发态或 M4 UNSIGNED + 本机 loopback 合成栈）。

**需重验项：**

| 项 | 为什么在新模式下要重验 |
| --- | --- |
| 登录失效提示（含**断网**） | 新模式引入真实网络失败面。必须确认**网络错误不被误当身份失效**——当前 `UNAVAILABLE`（「服务暂不可用，请重试」）与 `UNAUTHORIZED`（「请先登录，或重新登录后继续」）是两个不同文案（`apps/desktop/src/shared/product-session.ts:8`、`:10`），新路径下要保持这个区分 |
| M4 打包态登录 / 查询 / 复制 | 必须**从干净配置开始**重跑，不能复用旧观察。§3.1 的拒启路径与 §3.5 的仓外索引都在新环境下重新成立或重新失效 |
| STALE | 远端发布 / 回退、租约、延迟响应的时序与本地不同；STALE 的人工观察要按新模式重新做 |

**保持未观察：** 关窗取消项（登录窗出现后关闭）**保持未观察**，不因本次评审改变其状态。

**不得表述：** 本文不把任何 M5 项写成已通过或已验收。清单进仓、CI 绿、unit 绿、Playwright 绿都不构成人工验收。

## 9. 核实边界与工具限制

本节说明本文证据的来源与**未能核实**的部分，避免把「没查到」误读成「不存在」。

**已核实的来源：**

- **GitHub 源码与发布记录**：通过 `gh api` 直接读取仓库内容与 release asset 列表，包括 `rullerzhou-afk/clawd-on-desk`、`openai/codex`、`pgadmin-org/pgadmin4`、`jupyterlab/jupyterlab-desktop`、`electron/electron`。这些是**一手来源**（仓库自身的文件与 API 响应）。
- **本仓源码**：逐文件阅读并核对行号，见 §3。
- **本仓只读参考件**：`clawd-on-desk-0.15.0.zip` 中的 `src/server.js` 与 `package.json` 与上游一致（[项目架构](../reference-project-architecture.md) 记录该 ZIP 为只读、忽略、不得复制资源进仓）。

**未核实 / 工具受限：**

- 本环境的 `WebSearch` 与 `WebFetch` **不可用**（网络策略拦截），返回空结果或域名校验失败。因此所有无法从 GitHub API 或本仓源码取得的证据都**没有**被写入断言。
- **DaVinci Resolve 的 PostgreSQL 工作流**：未能取得 Blackmagic 官方文档的可核验 URL，见 §2.3，标为【不确定】。
- pgAdmin 的「Python server」描述取自其仓库内官方文档 `docs/en_US/desktop_deployment.rst`（与官网 `pgadmin.org` 同源内容）；官网页面本身本次无法直接抓取。
- OpenAI Codex 的 `stdio://` / `unix://` / `ws://` 判断来自 `app-server-transport` 的源码与错误信息字符串，未在真实二进制上做运行时验证。

**本文明确不断言：**

- 不声称任何方案已被批准、已实施或已验证。
- 不声称办公机约束的答案已知（见 §7）。
- 不声称 M5 任何项已通过（见 §8）。
- 不把「依赖列表」「产物命名」「配置文件名」当作架构证据（见 §1）。
