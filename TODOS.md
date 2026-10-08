# TODOS

## 当前资料接入：沿既有内容管理完成本期收尾（2026-10-08 复核）

用户最新目标为“飞书表格维护 → 导出规范 CSV → 桌面上传校验 → 有发布权限者二次确认后直接发布 → 坐席按店查询/复制”。当前新 intake 已按精确批准接收 CSV 合同，并在同一来源登记、对象、隔离解析与确认直发链上支持规范 CSV 和 XLSX；当前 Mac 开发构建的 CSV 与 XLSX 实际 Electron/HTTP/受限 PG15 合成闭环均已通过。同一版 0.3.26 本地未签名包已实际解包并通过 CSV 全流程合成验收；真实资料、真人系统框作业及 Windows 仍未验收。确认直发合同已在所属仓冻结、导出并接收，合成 API/PG/Main 已接入 direct-v1。本节只归纳剩余验收，不新增需求或签发正式接入许可；详细批准与实施证据以[计划 §0](docs/plans/2026-10-03-content-intake-requirements.md)为准，运行入口见[开发指南](docs/how-to-develop-content-intake.md)。

**用户范围与界面校准：** 首批资料为 FAQ、售前、售后、活动，先用当前 Mac 做完整合成验收，再安排办公 Windows。原工作台已有“内容管理”的 CSV/XLSX 上传发布与产品/活动/售前/售后四库选择，话术库已有对应四个子 Tab；FAQ 是标准问答资料格式，不新增第五库。新 intake 合成模式已复用原五模块工作台外壳，内容管理与权限配置切换导航时保留状态；话术库按四域显示当前店铺/商品/场景条件下可用的已发布原文，系统同步显示同一读取结果的发布版本。概览统计、SOP 和软件更新明确未接入，不扩本期范围。本轮已补齐授权列表/只读预览/保存/撤销 HTTP 与内容管理内“权限配置”页面；当前 Mac 已通过具名人员预览取消、保存授予查询、撤销后拒绝新资格的实际 Electron/HTTP/PG15 合成验证。上述在显式 intake 合成模式验证，真实运行条件继续归入下表“正式接入”，不新增业务范围。用户已确认首批店铺为 Menokin，来源是飞书表格导出的 CSV，初始配置/操作只授权总监和经理；既有四岗能力上限不变。首批 FAQ 沿用已选 B/SRC-LOCAL-04，不重问 A/B。实际来源 ID、具名负责主体及旧内容认领仍需受控登记，岗位范围不能替代这些绑定。

**当前安排：** CSV 已完成冻结和实际闭环；其后旧非空目录校验权限缺口也已按精确批准完成治理冻结→完整16件 v4 导出→产品 intake，当前锁为 `cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780`，仍是 VERIFIED_NOT_ACTIVATED、runtime/Ddev=false。0035 仅向既有不可登录函数属主追加八项校验函数 EXECUTE，前34段字节/来源不变；安装前后完整核验与授权/账本处于同一事务。实际受限业务账号完成旧8行两次发布及回退，详见[旧目录接入证据](evidence/qa/intake-legacy-acl-runtime/README.md)。生产 HTTP、真实飞书和名单仍未开放。

**最新角色口径：** 总监、经理配置权限；总监、经理、主管、组长在有效业务授权和负责范围内上传规范 CSV/XLSX 并二次确认发布；主管/组长不能配置他人，普通客服和历史赋能师新操作只查询。角色上限没有再次修改。来源确认和人工质量检查保留，取消的是组织审批。上传→检查→确认发布→另一普通客服查询复制及纠正回退的实际 Electron/HTTP/PG15 合成闭环已通过，见[本轮证据](evidence/qa/intake-direct-publication/README.md)。

**本次审核交接：** 角色代码沿用用户提供的 15/15 可审文件结论，不重做。直发合同轮次的治理 test:release 为 38 步实际通过，直发实现有本机与独立边界复核；本次 A/B/C 回收、追加修复和新验证见[回收记录](evidence/qa/intake-parallel-recovery/README.md)，不混用两个范围。完整 `/review` 仍为 INCOMPLETE，外部超时没有结论。既有审核范围不能冒充本次全部新代码的外部覆盖。

**本期剩余工作：**

| 工作 | 已具备与尚缺的边界 | 完成标准 |
| --- | --- | --- |
| FAQ 查询适用条件 | 商品/场景多选已接通；店铺显示名合同已冻结、导出并接收，API 有界目录与 Main 全分页消费者接到原选择器。显示名不改变 shopId 或授权范围，目录不完整/失效保留编号并提示；实际 registrar/维护范围及密钥托管待确认 | [选择器原合成验收](evidence/qa/content-intake-p2-query-filters/README.md)保留；本轮名称/重名/更名/撤权/分页结果见[接入证据](evidence/qa/intake-parallel-recovery/runtime-formal/README.md)，真实名称未载入 |
| 容量与并发收尾 | 四类对象统一预留/采用/释放、未知提交保护、只读账本干跑已实现；10→100 并发与 10→100 合成发布历史、双来源 CAS 重审已验证，见[第二组证据](evidence/qa/content-intake-p2-capacity/README.md) | 剩余是历史保留期批准及批准后的历史清理/磁盘核对；当前不删历史，不把合成性能等同生产容量承诺 |
| 正式接入 | 直发、组织输入、用途权限及名称目录已完成版本化接收。会话锁直接调用正式函数，独立用途池逐次校验；合成 host 通过受限组织池完成登记/观察/事实写入，业务/usage/worker 复用原消费者，无 SQL 文本改写桥。权限配置与原五模块工作台接线已接通；目录使用独立资格和窄只读 IPC，旧适配器保持隔离。已收 Menokin/飞书表格/CSV/首批总监经理的范围元信息；已只读核对原文件表头，未读入运行链。CSV 已正式冻结/export/intake 并接通共享解析、原字节上传和确认发布，当前 Mac 开发态 CSV/XLSX 闭环通过，见[CSV 接入证据](evidence/qa/intake-csv-runtime/README.md)；旧非空目录 CHECK 执行权限已精确冻结/export/intake，通过0035追加闭包；受限业务账号的旧8行发布→二次发布→回退及来源/权限/旧审批失效拒绝已实际通过，见[旧目录接入证据](evidence/qa/intake-legacy-acl-runtime/README.md)；剩余还有真实资料字段/必要图片文字说明、真实认证观察/刷新与容量配置、生产账号/密钥/装配、具名主体/来源绑定和旧目录认领 | 按已批准环境验证真实字段、撤权、确认直发/旧审批历史兼容和目录承接；缺前置时拒绝启用，不沿用合成身份或管理员连接池 |
| 业务与设备验收 | 当前 Mac 正式合同用途池下的上传/报告回读/修订/取消/确认发布/另一坐席真实剪贴板、回退、权限配置与店铺重名/编号切换四项 Electron 合成验收通过；本轮追加四域工作台实际 HTTP/PG15/Electron 读取、版本一致与撤权验收通过，跨导航输入保留和 Query 独立资格也已验证，见[统一工作台证据](evidence/qa/intake-unified-workspace/README.md)。本轮 0.3.26 Universal DMG 已实际展开并运行，打包态完整 XLSX 闭环及 CUA 操作真实文件/取消/确认框均通过，见[Mac 包证据](evidence/qa/intake-mac-package/README.md)。汇总记录保留首轮路径断言失败及一次不明输入，整体 QA verdict 为 inconclusive，不写全部全绿。本次追加 CSV/XLSX 开发态合成回归，并实际重打 0.3.26 本地未签名包、从新 DMG 解包独立副本完成 CSV 全流程 1/1 PASS，见[CSV 安装副本证据](evidence/qa/intake-csv-runtime/README.md)；文件/确认框仍为受控响应，不把该结果当作真人系统窗验收。旧 Windows/WSL 证据不替代这版验收；非开发维护者的编号/修错演练、普通 Windows 账号、可靠拖动和整机断网未完成 | 证据绑定版本/输入/设备；新回退与同题覆盖不借用旧包结果。普通账号及现场断网按用户当前安排等待条件 |

前三项可按接口边界并行准备；共同的合同、迁移编号、发布目录和测试宿主由同一集成负责人协调。Git 交付与业务验收分开：本地 commit 不代表 push、PR、合并、部署或真实数据放行。本轮工作区根规则通过，但冻结快照及实验接收后超过 32 MiB 源码体积预算；记录为未通过检查，未删除历史合同/证据或放宽阈值。

**已经完成的合成开发：** 权限/委派与撤权规则、Excel 解析及错误报告、持久候选与修订/取消、质量检查、来源确认、历史审批兼容及原操作恢复、确认直发、店铺与商品/场景 FAQ 查询复制、纠正回退、显式同题覆盖与通用回落。完成范围及限制见[回退验收](evidence/qa/content-intake-p2-rollback/README.md)、[同题覆盖及复审](evidence/qa/content-intake-p2-family/README.md)、[杭州验收](evidence/qa/content-intake-p2-hangzhou/README.md)。这不等于真实组织接入或全部 FAQ 退出条件完成。

**后续方向，不计入本期 FAQ 待办：** SOP 完整闭环（P3）、飞书/Wiki 正文直读与自动同步（P5）、第二应用共享权限服务（C07）。这里的 P1–P5 是资料接入阶段；下方旧待办里的 `Priority: P1/P2/P3` 是优先级，不能混读。

## 既有产品待办与历史复核

下方保留既有交付、运维和平台事项，条目中的“已实现”不再计为待开发；验收仍看各项证据。历史日期的“未授权/下一步”只描述当时状态，不覆盖后续明确批准与当前计划。

> **复核：** 2026-09-29（产品 0.3.25）。#26 已合入：Windows NSIS assisted 向导。办公机须用新打的 0.3.25 UNSIGNED 勾选。公开 GitHub Release 0.3.24 仍是 oneClick。P1 打包态配置失败、P2 首轮范围、P3 离线 profile 三项已收口。
>
> **历史结论（2026-09-16）：** 四项 P3 窄分支已由产品 PR #69 合并。登录残留红字已由 PR #68 修复。BACKEND-CI-503 已由 PR #91 修复并关闭。它们仍属于 Menokin `PILOT-S0` 合成基线验证，不构成 G0 / Ddev 或正式 DEV-M0 授权。macOS M5 人工勾选见 `docs/how-to-verify-macos-m5.md`，清单进仓不等于验收通过。
>
> **Open 段的来源：** 2026-09-16 的交付形态评审（对 Windows 打包态在办公机上的可用性做只读复核）。该评审推翻了若干先前判断，结论见下。
>
> **状态口径（2026-09-17）：** P1 打包失败提示已合入且 Mac 实机通过。桌面切片 #95–#99、调优 #101–#109、P3 离线打包 #111–#114、办公机清单 #116 已合入。P2 已拍板走 P3。P4 / P10 未授权。办公机 Windows 实机勾选仍待人填。
>
> **方法论警告（2026-09-17）：** 验证期间曾把「对话框几秒后自行消失」判成缺陷，随后证伪——这台机器上**有人在操作**，观测窗口内 `HIDIdleTime` 从未超过 3.5 秒，且返回值是按钮下标而非模态中止码。**在本机做任何「对话框会不会自己关掉」的自动化观测都不可信**，除非同时记录 HID 输入空闲时间。

## Open

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
**Status:** OPEN · 代码已合入 main（#133 / #135 / #145 / #153 / #154）。**2026-09-29 起后端已搬到杭州**：`agent-auth` / `agent-pass` 两个入口由杭州 WSL 的 `customer-agent-stack` + `customer-agent-tunnel` 提供，Mac 退回纯开发；数据（55 张基表逐表一致）与对象存储已按 `docs/how-to-run-backend-on-hangzhou.md` 迁完，切换做过闭环回滚演练。**办公机侧尚未在真人手上验过**——那份 how-to 的勾选仍是空的。macOS UNSIGNED v0.3.7：狐狸 / 飞书 / 查询 / 复制已观察，账号登录与关窗/断网未观察。现行文档/详情卡口径是 v0.3.8。Windows 办公机与 Linux 打包态远端仍全部未观察。`package:linux` 须在 Linux 上跑。API 绑 `0.0.0.0` 仍未做。

### 杭州迁移 · 子进程崩溃自愈

**What:** 让 `stack.ts` 支持前台模式，由 systemd 直接监督 api / worker / identity，任一个退出即重启。

**Why:** 旧的 `Type=oneshot` 单元无法监督 `stack.ts` detach 出去的子进程，API 单独崩掉时单元仍显示 `active`。生产入口现在增加 `--foreground` 模式，由前台 supervisor 持有 identity、API、worker；任一子进程异常退出都会让栈失败，交给 systemd `Restart=on-failure` 重启整组。

**Context:** `scripts/synthetic-stack/stack.ts` 增加前台启动和子进程监督；`scripts/ops/customer-agent-stack.service` 固化 `Type=simple`、`Restart=on-failure`、`KillMode=control-group`。普通 `start/stop/restart` 仍保留 detached 行为，Mac 合成开发路径不变。2026-10-02 已在杭州 WSL 部署 SHA `8faf5759382bf3ded9ba0245bec8c893701cf270`，并完成 API 子进程强杀后的自动恢复演练。

**Effort:** M
**Priority:** P2
**Depends on:** 杭州迁移完成
**Status:** 已实现 · 杭州已安装并完成子进程故障演练；健康告警 timer 已启用并完成一次告警演练（2026-10-02）

### 杭州迁移 · 去掉单点（HA）

**What:** 两个公网入口不再依赖单台 WSL 桌面机。

**Why:** 杭州那台同时是在用的桌面机：WSL 里跑着 fuqing-crm-analytics、WeKnora、tyuan-chat，还有 nginx / PG17 / Redis / Tailscale。它重启、被关机、或者被拿去装别的东西，办公机的登录就一起没了。

**Context:** 先量负载与重启频率，再决定要不要第二台机器。量级远超本次迁移。

**Effort:** L
**Priority:** P3
**Depends on:** 杭州迁移完成
**Status:** OPEN

### 杭州迁移 · 公网入口健康探测与告警

**What:** 给 `agent-auth` / `agent-pass` 加外部探测 + 告警通道。

**Why:** 「子进程崩溃自愈」和「WSL 自启」之外，剩下的所有失效模式（隧道失效、证书过期、DNS 改错、进程崩了没人重启）目前共同的症状都是**没有任何人收到通知**——办公机那边只表现为「登录不了」，等有人说出来才知道。

**Context:** 需要不在同一故障域的探测点与告警通道。Cloudflare 可用性监测，或一台外部 VPS。

**Effort:** S
**Priority:** P2
**Depends on:** 无
**Status:** OPEN

### P5 · 会话未绑定后端身份

**What:** 会话存储文件名固定 `product-session.enc`，未按环境或服务身份隔离。

**Why:** 新增远端 profile 后若复用同一存储，恢复逻辑可能把旧 token 发往新目标。属安全隐患。

**Context:** `apps/desktop/src/main/product-session-store.ts:9`、`apps/desktop/src/main/product-session.ts:57`。修法：按环境/服务身份隔离会话与缓存，切换目标时清理旧状态。

**Effort:** M
**Priority:** P2
**Depends on:** P4（若走远端才成为阻塞）
**Status:** 代码已合入 main。会话文件按 `apiOrigin` 哈希分文件（`product-session.<id>.enc`）。本机与远端 token 不再共用一个文件。

### P6 · 两条网络栈的证书/代理覆盖

**What:** `ProductHttp` 默认使用全局 `fetch`；登录窗口使用独立 Electron session。

**Why:** 不能假设给默认 session 加一个证书钩子就覆盖所有请求。代理、证书策略与 pinning 都必须验证**实际传输路径**。

**Context:** `apps/desktop/src/main/desktop-fetch.ts`、`product-http.ts`、`product-login-window.ts`。规格：`docs/plans/2026-09-19-p6-cert-proxy-paths.md`。

**Effort:** M
**Priority:** P3
**Depends on:** P4
**Status:** 代码已合入 main（#136）。ProductHttp / 登录 identity / MiniMax 共用 `electron.net.fetch`。不做默认 pinning。

### P7 · 检索资产的交付路径

**What:** 桌面主要查询能力不全在 API——main 使用仓外本地索引与 hydrate 快照。

**Why:** 新机器上的索引初始化、发布版本对齐、缓存失效必须纳入交付设计，不能只迁移 API + PG。打包态目前按文件存在与否决定是否启用（`packaged-retrieval-paths.ts:25`），文件不在就没有主链。

**Context:** `docs/reference-desktop-retrieval.md`、`apps/desktop/src/main/packaged-retrieval-paths.ts:18`。Mac 开发机路径已拍板：仓外 `~/.customer-agent-synthetic-stack/` 文件 + `existsSync` 才挂 env；不打进包；离线 S0 无主链。见 `docs/plans/2026-09-18-mac-dev-remainder.md`。远端拉索引仍跟 P4。

**Effort:** M
**Priority:** P2
**Depends on:** P2
**Status:** 代码已合入 main（#140）。origin 分文件、登录写 BM25/向量、查询按 origin 读；产品模式写入 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN`。多公司 PG 分库未做。

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
**Status:** OPEN · 包内后端仍不做。缺配置文案不再叫人装数据库。Linux userData 跟随 `XDG_CONFIG_HOME`。办公机远端主链 how-to 已写、全部未观察。见 `docs/how-to-office-machine-product-remote.md`、`docs/plans/2026-09-19-p10-no-bundled-stack.md`。实证仍成立：PG15 发现无 Windows 分支、Homebrew 非自包含，不能只拷 bin。

### P9 · M5 受影响项在新 profile 下需重验

**What:** 若引入远端或离线 profile，以下 M5 既有观察需重验：登录失效提示（含断网，确认网络错误不被误当身份失效）、M4 打包态登录/查询/复制（从干净配置开始）、STALE（远端发布/回退、租约、延迟响应）。

**Why:** 历史观察仍然有效，但**不能自动覆盖新模式**。

**Context:** `docs/how-to-verify-macos-m5.md` 第 7 节。关窗取消已于 2026-09-18 在开发态观察到（#127）。`synthetic-offline` 是 S0，没有登录/查询/复制主链，**不能**用来重验 M5 这三项。P3 段记不适用；P4 远端落地后再验。见 `docs/plans/2026-09-18-mac-dev-remainder.md`。不能替代 Windows 实机证据。

**Effort:** M
**Priority:** P2
**Depends on:** P3 或 P4
**Status:** P3 段不适用主链。macOS 打包态 how-to 的狐狸 / 飞书 / 查询 / 复制已在 v0.3.7 观察，**不等于**本项完成。P9 要的断网 / STALE / 干净 userData 仍 **未观察**。账号登录、Windows 办公机、Linux 打包态远端仍未观察。清单见 `docs/how-to-verify-macos-m5.md` §7.1、`docs/how-to-macos-packaged-product-remote.md`、`docs/plans/2026-09-19-p9-remote-m5.md`。本刀不把 M5 标完成。

### Overlay · Windows 收起后交还前台输入框

**What:** Windows 上收起查询胶囊后，把键盘交回前一个应用的输入框（千牛 / 编辑器），不必再点窗口。

**Why:** 当前 `app.hide()` 只在 darwin。Windows Query 是普通置顶窗，收起后前台应用通常不会自动拿回光标。办公机 Windows 验收会踩同一坑。

**Context:** `apps/desktop/src/main/overlay-controller.ts` 的 `yieldOrKeepPalette`。macOS 路径是有条件 `app.hide()` + 闲置狐狸 `setFocusable(false)`。Windows 可参考：先 `query.hide()` / `minimize`，再 `hide`，让上一窗口提前。不要 `app.focus({ steal: true })`。先等 macOS 交还落地。

**Effort:** M
**Priority:** P3
**Depends on:** macOS 收起交还焦点已在 v0.3.1 / PR #120 落地
**Status:** OPEN · 第一刀：Windows 收起闲置狐狸时 `blur` + `hide` 一帧再 `showInactive`，不用 `app.hide()`、不用 `app.focus({ steal: true })`。未做 Windows 实机勾选。见 `docs/plans/2026-09-19-windows-yield-focus.md`。

### Overlay · NSPanel 隐身属性（becomesKeyOnlyIfNeeded）

**What:** 在 Electron `type: 'panel'` 之上补 AppKit 面板属性（`becomesKeyOnlyIfNeeded`、必要时 `_setPreventsActivation`），让点击浮窗按钮也不把本 App 推到前台。

**Why:** Electron 的 panel 只加了 NonactivatingPanel 掩码，点搜索框仍会成为 key window；收起后闲置狐狸头也可能抢走键盘。真正 Spotlight/Alfred 级「前台应用一直保持 key」需要原生属性。

**Context:** 不要在本轮 overlay 交还焦点里做。本轮只用 `setFocusable(false)` + 有条件 `app.hide()`。原生模块会牵动公证、打包和 Electron 版本。参考：philz.blog NSPanel notes。2026-09-18 拍板：本轮 **不** 引入 native addon；IME 级隐身等产品明确要求再开。见 `docs/plans/2026-09-18-mac-dev-remainder.md`。

**Effort:** L
**Priority:** P3
**Depends on:** 本轮 macOS 交还先用 Electron 公共 API 验证是否够用
**Status:** 本轮不做 native · IME 级隐身仍待产品明确

### 内容管理 · 飞书 / Wiki 导入

**What:** 让「内容管理」直接连接飞书文档或 Wiki 做内容导入，而不是只认本地 CSV / xlsx。

**Why:** 组织审核在飞书文档完成，但导入目前要人把表导出到本地再选文件。真正接通会省掉一次导出。

**Context:** 一期明确**不连接**：折叠体「内容导入」里仍然写「不连接飞书或 Wiki」，用户可见文案不得提前改成已接入。接通需要新的冻结合同（`contracts:intake`，新增来源类型与凭证通道），不是渲染层改动；本切片零新 HTTP。在合同放行前，任何「飞书导入已在做」的说法都属假发布。相关代码：`apps/desktop/src/renderer/features/dashboard/ContentModule.tsx`、`apps/desktop/src/renderer/features/dashboard/coach-content-upload.ts`。

**Effort:** L
**Priority:** P3
**Depends on:** `contracts:intake`（OpenAPI 1.15.0 及以上）+ 凭证通道设计评审
**Status:** OPEN · 一期不连接 · 折叠体内文案保持「不连接飞书或 Wiki」

**2026-10-04 规划补充（C06 / M2-B）：** [五模块内容接入规划](docs/plans/2026-10-03-content-intake-requirements.md) 延续“飞书维护→导出 Excel→桌面上传”的第一期。后续直读只替换资料取得方式，仍产生同一规范候选、差异和审批，不自动发布。文件解析失败不得再误报“未连接飞书”；这是本期拟修文案，不代表直连已开通。新增 URL 路径可复用已冻结 schema；新的来源 payload/权限/凭据语义才需要相应合同 intake，不能假定 OpenAPI 1.15.0 已覆盖全部需求。

**逐项核对后的范围说明：** 本项仅延期飞书/Wiki 资料正文直读与自动同步。M1 飞书岗位自动匹配已由用户明确前移首期，M4 飞书审核证据的核验另有适配范围；登录、组织信息、审核证据与资料正文读取分别核对权限和合同，不能用本项延期覆盖其他已确认需求。

**Pros:** 减少人工导出，保留同一校验与发布机制，避免第二条内容真源。
**Cons:** 需要飞书应用可见范围、文档授权、分页/限流、版本比较及撤权对账；维护成本高于本地文件入口。
**Blocked by:** 首期 Excel 完整闭环、B1 权威来源和维护人、B4 企业字段及授权验证、连接器合同与真实接入批准。

### 内容平台 · 第二应用复用权限模块（C07）

**What:** 在出现第二个实际应用消费者时，提取稳定的身份/能力/范围授权接口；根据部署需要选择公共包或独立服务。

**Why:** 让其他软件复用经过验证的权限规则与运维能力，避免复制职位判断，同时控制单人开发的部署负担。

**Context:** [五模块规划](docs/plans/2026-10-03-content-intake-requirements.md) 的 M1 由现有 API identity/actor registry 拥有授权；逐项核对已确认首期飞书岗位自动匹配角色，店铺范围与个人分配资格人工配置，支持一人多店及两层授权。实际企业字段与权限仍待核验。C07 仅延期独立跨应用 IAM，不延期本期的岗位识别、范围权限、撤权、审计，也不阻止 Main/API 两个现存解析消费者共用内容解析包。重启时先核对两应用的 subject/scope/action、撤权时限和管理员职责，再决定边界；不要先造五个微服务。

**Pros:** 以真实第二消费者验证接口，集中策略、拒绝原因和审计，降低后续二次开发成本。
**Cons:** 独立服务增加部署、网络失败、策略版本和迁移成本；公共包则需要各应用协调升级。
**Effort:** L
**Priority:** P3
**Depends on:** M1 范围授权在首个应用验收、第二个明确应用消费者及其合同。
**Blocked by:** 第二应用尚未确定；T1 提取时机仍为规划建议。
**Status:** DEFERRED · 仅记录后续方向，未实施或部署。

## Completed

### P3 · 显式离线 synthetic profile

**What:** 给应用加一个离线演示运行模式，使用安装包内自带的合成 fixture，完全不连后端。

**Why:** 满足办公机约束的最短路径。可验安装、启动、浮窗、快捷键、卸载；不可验登录/查询/复制/STALE。

**Context:** 仅在 P2 判定为「只验安装与交互」时实施。不得把它当作产品主链验收。

**Effort:** M
**Priority:** P2
**Depends on:** P2
**Status:** 已合入 main。本机 UNSIGNED mac seed 与 `pnpm package:win` 后验已记录。办公机实机勾选清单：`docs/how-to-office-machine-first-round.md`（人填，开发机不代填）。

### P2 · 首轮 Windows 验收范围未定

**What:** 需要用户明确：办公机首轮只验安装/启动/浮窗/快捷键/卸载，还是要验完整产品会话链（登录、查询、复制、STALE）。

**Why:** 这个决定直接选择实现路径，比「Windows 四项确认」更根本。只验前者用离线 synthetic profile 即可；验后者必须先补后端鉴权与访问准入。

**Context:** 见 `docs/plans/2026-09-10-windows-package-and-device-verification.md`。约束澄清要点：办公机是**只是不能单独安装开发工具**，还是**也禁止包内辅助进程、本地监听、数据库进程**？Electron 本身内置 Node.js，"不装 Node/pnpm" 不等于"应用内不能用 Node 运行时"。

**Status:** 已拍板（2026-09-17）。首轮只验安装 / 启动 / 浮窗 / 快捷键 / 卸载；办公机只禁单独安装开发工具，不禁 Electron 自带运行时；首轮必须断网可用。路径锁 P3 显式离线 profile，不走 P4 / P10。

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

**未覆盖**：`unreadable` 无法在真产物上复现（触发它需要 profile 目录本身不可穿越，那会连带破坏 Electron 其余的 userData 处理），仍只有单测覆盖；「重试」按钮的**合成点击**无法在本机做（进程无辅助功能权限，`AXISProcessTrusted=false`），上面的重试证据来自真实人工点击。


### P1 · 待办页按稿展示「话术不准」次数

**What:** 概览待办按 `inaccuracy:{script_id}` 展示去重后的样本查询数。没有产品会话不画这块。

**Why:** 拍板 D。24h/7d 窗口次数仍没有合同 GET，未达开单阈值的稿不会出现。

**Completed:** 2026-09-22（产品 PR #9，`d388ef6`）

### P1 · 无命中 / 跳过 Top1 / stale 召回开 iteration_task

**What:** 记录到的搜索无命中、复制跳过 Top1、过期仍被召回，会在同一事务打开 `iteration_task`。

**Why:** 拍板 E。hydrate 主链仍是 `collection_disabled`，不写这些事件。

**Completed:** 2026-09-22（产品 PR #10，`70f6c4c`）

### P1 · 新发布后提示可关单

**What:** 当前 hydrate 新于待办、相关稿仍在目录时，提示「已有新发布 / 可关单」。人手关。

**Why:** 拍板 E。不自动关单。

**Completed:** 2026-09-22（产品 PR #11，`103eb94`）

### P1 · SOP 过敏步骤无停手文案不能发

**What:** title 或 body 含「过敏」时，body 必须同时有「停手」和「确认」，否则导入和 PATCH 失败。

**Why:** 拍板 F。不改 CSV 列。

**Completed:** 2026-09-22（产品 PR #12，`4c1d87a`）

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
