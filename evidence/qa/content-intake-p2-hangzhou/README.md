# P2 杭州分层验收（2026-10-07）

产品基线提交：`be1383a2336ddd8b359cd47108752a64a54fc581`。WSL 使用该精确提交；Windows 最终复跑和 Mac 回归使用该产品基线加本轮四个测试文件的修复，精确哈希见验证清单。本轮只做已授权的合成验收，不接真实飞书或客户/员工数据，不改变生产服务、系统 PostgreSQL 或正式运行批准。

最新进展见[Windows安装与卸载验收](#windows-安装启动与卸载验收2026-10-08)：Administrator当前用户安装、隔离profile启动、快捷键打开查询、正常退出及卸载已通过。有效会话取消与打包态实际栈闭环见前一节；普通OS账号、原生拖动和完整离线场景仍未确认。各节保留当时状态，最新进展以验证清单 `windows.latestFollowup` 为准。

## 版本与隔离

- 从干净的 P2 worktree 对完整 SHA 执行 `git archive`；归档 SHA-256 为 `2138111fef0905492928517cc0be286ce30dc9ef56433da295b1b858f6911634`，远端回读一致。
- 现有七类凭据模式检查 1,151 个跟踪文件，0 命中；未发现凭据类跟踪路径。构建后逐一核对全部 1,151 个文件哈希，源码与该提交一致。这不是对所有秘密形式的穷举保证。
- WSL2 Ubuntu 24.04.4，Node 24.21.0 / pnpm 11.19.0。所有仓库安装、构建和测试以 `nobody` 运行；临时 systemd unit 使用 `NoNewPrivileges`、`PrivateTmp`、`ProtectHome`、`ProtectSystem=strict`，生产目录及 Windows 磁盘不可见。
- 系统已有 PG17，本轮从 [PostgreSQL 官方 PGDG 仓库](https://www.postgresql.org/download/linux/ubuntu/)的签名索引下载并仅解包 PG15.19 server/client 和 libpq5 至本轮临时目录。没有执行系统安装或 maintainer scripts。数据库由现有 `Pg15Harness` 创建，只监听临时 Unix socket。

## 实际结果

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 服务构建 | `pnpm build:services` | PASS |
| 数据库迁移与漂移拒绝 | `pnpm --filter @customer-agent/database test:integration` | 25 PASS；34.62 秒 |
| Excel 解析、限制、取消、报告回读 | `pnpm --filter @customer-agent/content-intake test:built` | 41 PASS；3.42 秒 |
| 实际 HTTP/PG 宿主与 CLI | `pnpm test:intake:synthetic` | 5 PASS；用例运行 8.56 秒，不含服务构建 |
| API 类型 | `pnpm --filter @customer-agent/api typecheck` | PASS |
| 完整候选事务套件 | `pnpm --filter @customer-agent/api test:intake:transactions` | 补跑 153 PASS；359.38 秒，退出 0。首轮外层 240 秒超时、退出 124 的原记录保留 |

最终共 **224 项测试通过**（153 + 25 + 41 + 5），各组无跳过；构建和类型检查另列，不重复计入测试数。

宿主用例实际完成解析材料 → 合成人工审批证据 → 人工质量检查 → 原子发布 → 普通坐席同版 snapshot；三条多行话术一致、重复发布仅产生一次发布事实、越店被拒绝，并验证退出/期限及自有资源清理。不是单独 mock 函数通过，也不证明真实飞书租户审批。

首轮完整事务运行期间，管理链路生成了 6,615 字节错误 XLSX 并由 ExcelJS 回读一条问题，整批阻断成立；另一坐席读到实际发布的三条 FAQ。5,000 来源通过真实 HTTP/Main 分页的探针记录 150 页、45,323 毫秒。上述中途结果没有把超时的整组改记为 PASS；补跑仅把外层执行上限设为 600 秒，不修改仓库源码、测试断言、业务期限或单例超时。

补跑全套最终通过，错误 XLSX 为 6,614 字节并完成同样的实际回读；5,000 来源 / 150 页耗时 44,575 毫秒。质量容量用例分别验证：合法的 5,000 条判断实际提交；HTTP 体虽为 8,375,220 字节、但 PostgreSQL JSON 文本增至 8,415,000 字节而超过 8 MiB 的另一请求返回 413，且不留下质量轮次或回执。不能把整组执行时间解释为单次产品操作延迟。

## 环境失败与未确认项

- 第一轮隔离屏蔽了整个 `/mnt`；该 WSL 的 `/etc/resolv.conf` 指向 `/mnt/wsl/resolv.conf`，导致下载 DNS 失败。改为只屏蔽生产目录和 Windows 磁盘后下载通过，DNS 配置只读。
- 依赖初次安装成功，但后续 pnpm 命令没有沿用临时 store 配置，触发非交互重装保护。对本轮进程统一 `CI` / store / Electron 下载环境后构建通过，未改项目依赖或锁文件。
- SSH/Tailscale 间歇性超时，部分状态回读及一次逐文件日志回传失败。失败回传不代表测试停止，也不能当作已回收资源的证据。
- Windows 原生前置探测发现全局 Node 22.20.0 / pnpm 12.9.1 与提升权限的管理员 Session 1。用户随后明确使用已打开的 UU session1 推进，本轮在该会话完成原生合成验收；普通账号验收仍未完成。
- 本轮没有新增产品代码；仅修复 E2E 测试。新差异完成宿主 OCR delegate 审查，历史全功能审查按未变产品内容复用，没有再次调用外部模型。

完整日志位于本 worktree 的 `.gstack/qa-reports/content-intake-cross-platform-20261007/raw-final/evidence/`；原始失败和补跑分文件保留。日志压缩包已完整取回并读取全部 25 个文件，包 SHA-256 为 `69f2d66e46173477f25dba275879d4a099743dee34791b844067f9c010383861`。版本、命令、日志哈希及清理状态见[验证清单](verification.json)。

清理前再次核对全部 1,151 个源码文件，0 差异；本地 25 份日志与远端文件逐一匹配。五个本轮 unit 的 MainPID 均为 0、ControlGroup 均为空后，仅删除本轮临时根目录（含 source / tools / store / home），已回读确认不存在。历史失败 unit 的状态元数据可能保留，不存在本轮活动进程；没有改动生产服务。


## UU / Windows 原生验收与测试修复

通过 UU 的“人事-台式”远程桌面，在现有 session1 PowerShell 启动原生 Windows Node / Electron。设备为 Windows 10 10.0.19045 x64，当前是提升权限的 Administrator。官方 Node 24.21.0 与 pnpm 11.19.0 下载校验后解包在自有临时目录，没有替换全局版本。安装时 pnpm 实际复用了现有全局 store，不能把整个依赖缓存描述为完全隔离；未删除或重配该 store。

原生 tar 首次解包把一个中文启动文件名误解码，源码哈希检查因此停止在安装之前。随后只从同一已校验归档恢复该文件的原名及原字节，完整 1,151 文件核对一致后才开始构建。锁文件安装与 Windows 工作区构建通过。首轮 FAQ 测试为查询通过、管理失败，管理失败后的原生确认框又导致 worker 清理超时，原始失败日志保留。

按用户指定的 `open-code-review-delegate`，先解析规则并审查故障调用链，再做保留断言的诊断：关闭/退出确实产生两次预期提示，因此排除了最初的关闭事件时序猜测。实际缺陷是 `getByRole('status')` 同时匹配上传提示和候选回执。修复将断言限制到“当前候选”的“操作回执”；质量通过、两条回执、只冻结一次及 sandbox/窗口隔离断言全部保留。失败清理统一复用真实 API 测试已有的 `closeOwnedElectron`，仅关闭本测试拥有的 Electron 实例，HTTP 与临时目录清理放在外层 finally。

| 原生检查 | 实际结果 | 覆盖边界 |
| --- | --- | --- |
| FAQ 管理 E2E | 1 PASS，2.589 秒 | 断网后查询原回执、人工质量检查、关闭确认、窗口与 preload 隔离 |
| FAQ 查询 E2E | 1 PASS，4.945 秒 | 登录、切店、多行原文、实际剪贴板复制、资格到期、撤权恢复、越店拒绝 |
| Windows feasibility | 1 PASS，1.040 秒 | Fox/Query 透明像素、快捷键注册、窗口切换及退出 |
| Mac 受影响三条 E2E | 3 PASS，总 48.486 秒 | 上述管理/查询与实际 API/PG15 上传、修订、取消、普通坐席同版查询 |
| 本地静态检查与构建 | PASS | 四个测试文件 ESLint、桌面 typecheck、工作区 build |

两组 Windows 复跑共 3 项，0 失败、0 跳过、0 重试；FAQ 组整体 8.142 秒，窗口组整体 1.769 秒。Windows 使用真实 Electron/Main/preload/HTTP/剪贴板，HTTP 服务为合成合同替身；不能据此声称 Windows 已连接实际 WSL API/PG。Mac 实际 API/PG 流程仍将原生文件选择替换为本轮自有 fixture 路径，不冒充人工文件框验收。

最终 Windows 被测清单为原提交加三份修改测试与一份新增辅助函数，共 1,152 个文件，运行前后哈希 0 差异。新产品权限、renderer 或 IPC 代码均未修改。管理与查询截图已检查，沿用现有浅色面板、紫色按钮和狐狸标识；截图不等于完整 UX 或系统焦点矩阵验收。

OCR workspace 预览的 2 个可审项全部复核，并补审默认排除的 3 个 E2E 和 2 个文档，共覆盖当前 7 个变更文件。两项测试缺陷已修复，无剩余已确认问题；原始规则、逐项范围、失败诊断和修后结果保留在 `windows-native/ocr-*.json`。这不是一次新的全分支或外部模型审查。

Windows 原始失败、诊断、修后 JSON/list 日志、截图及 Playwright trace 均保存在同一 `windows-native/` 目录，各轮分开保留。接下来需要 Windows 原生打开/保存框、Windows 前端连接实际 WSL 后端、普通账号及安装包专项验收；真实飞书和业务数据仍依照各自批准，不由本轮合成结果放行。


资源核验另发现一个位于本轮隔离目录的残留 Electron 进程和测试 profile；仅按该目录归属清理后，从空进程/空 profile 状态重跑同样三项原生检查，仍为 3 PASS，随后立即查询 Windows 进程和临时目录，均为空。不能把残留归因到某一用例而无额外证据。最后这轮因 UU 终端键盘输入不再回显，改从既有 WSL 互操作启动同一 Windows `node.exe`，结果仍是 win32/Electron，未改用 Linux GUI。该轮 21 份日志/截图/trace 已完整取回且哈希匹配，包 SHA-256 为 `e7fcca139f87b7079ed1ca184df5d2fd52cd6be7b422a0a1d3dc7e2fbdfa3ff0`，独立保存为 `clean-repeat-*`，没有覆盖前轮证据，也不重复累计成更多用例。

Windows 本轮源码、解包工具和构建目录暂留在 `%LOCALAPPDATA%\Temp\cai-p2-be1383a-269952`，供后续原生文件框/实际后端联调复用；没有活动测试进程，临时应用 profile 已清空。此前 WSL 隔离根目录已删除，两者的清理状态分别记录。Mac 已有全量基线和 WSL 未变检查继续按产品哈希复用，本轮没有重跑全仓 unit suite 或新增打包验收。上述 4 个测试文件、规划接续记录和 2 个杭州证据文件共 7 项，随后按用户“先commit，然后继续推进”的授权提交为 `732ca7b2e7c46a307ff819135ab37815bd84f950`；未执行对外 Git 动作。

## Windows 连接实际 WSL 后端的原生补验

本节接续前述合同替身验收。2026-10-07 22:55–23:17（北京时间）通过 UU“人事-台式”操作 Windows 原生 Electron，后端为 WSL 内现有 `scripts/intake-synthetic/run.ts` 启动的实际 API/PG15；登录与审批仍为明确的合成 transport。产品源码保持 `be1383a`，Windows 四个测试补丁未变。原生打开/保存对话框没有被 stub，未启用真实数据或正式飞书。

| 检查 | 实测结果 | 证据边界 |
| --- | --- | --- |
| Windows → WSL 回环 HTTP | PASS | Windows Node 的 `/v1/auth/me` 预检返回预期 401；三次新会话分别记录实际端口与 `win32` |
| 原生登录、授权来源与候选读取 | PASS | UU 界面显示管理员、`source-a · shop-a` 和宿主预置的版本 1；session-2 的实际 API 请求记录对应登录、授权、来源和候选读取 |
| Windows 原生选择文件后取消 | PASS | 系统“选择合成 FAQ 工作簿”对话框打开，取消后回到“等待选择文件”；状态记录无新增文件接收、无审批、无发布，仍是 `rel_native_base` |
| 选文件期间资格到期 | PASS（可见保护） | session-4 到期后撤去可上传来源、显示会话/权限变化并禁用选文件；未把输入中的文件上传。宿主按期限停止并删除临时数据库/对象 |
| 错误 Excel 上传、错误报告原生保存/取消及回读 | 未完成 | session-4 在确认文件前到期，没有生成报告；不能复用 Mac 原生保存或 WSL 自动化结果冒充本项 |
| Windows → WSL 审批、质量检查、发布与普通坐席同版查询 | 未完成 | 已联通并验证读取，但这次没有执行写入闭环；先前 Windows 合同替身和 Mac 实际 API/PG 结果仍是独立证据 |

session-2 的请求列表中有一次宿主启动时的预置文件接收与候选创建，它们发生在 Windows `/v1/auth/me` 预检和第二次登录之前。取消后的请求没有新增 `/objects` 或 `/candidates` 写入；状态为 `publications: 0`、`pendingApprovals: 0`、`diagnostics: []`。预置候选不能算作本轮原生上传成功。桌面日志保留到期后的 `410 GONE` 和宿主退出后的 `ECONNREFUSED`，不声称整个会话零错误。

本次受阻于远程操作链路：SSH 间歇超时；UU 输入复杂符号会丢字符，剪贴板同步曾带入旧文本，后续改用已上传的短脚本；原生文件框还出现输入法组合文本与延迟。三次限时宿主均按既有约 5 分钟期限退出，没有延长业务 TTL 或重启 WSL。第二次只完成登录，第三次尚未确认坏文件，故没有新增完整通过用例数。本节 UI 观察来自 CUA 的原生界面记录；未把含其他窗口的整屏截图写入仓库。

环境准备另有两次失败：首次 unit 引用了不存在的 `/mnt/e`，在执行代码前因 mount namespace 失败；随后 Corepack 尝试写入 nobody 的 `/nonexistent/.cache` 而失败。只为本轮进程指定自有 Corepack/XDG 缓存目录后，锁定依赖安装与 `pnpm build:services` 通过。实际宿主仍以 nobody 在 `NoNewPrivileges` / `PrivateTmp` / `ProtectHome` / `ProtectSystem=strict` 下运行，仅可写自有根目录，屏蔽生产路径与 `/mnt/c`、`/mnt/d`。系统 PostgreSQL、全局 Node/pnpm 和现有业务服务未改动。

22 份 WSL/Windows 日志、启动/预检记录和资源核验已取回，逐文件哈希一致；压缩包 SHA-256 为 `19e926c6db7a5319c0fc9b06a71d8032be67dcf0a1d70a4151675c0c9a9df423`，保存在 `.gstack/qa-reports/content-intake-windows-real-20261007/`。WSL 1,151 文件与原提交归档一致，Windows 1,152 文件与上轮补丁清单一致。三次宿主均记录 `hostDataRemoved: true`；Windows 本轮 Electron 已按自有 PID 清理、三个 profile 已删除、归属本轮的进程与 profile 均为空。WSL 根目录在证据取回并再次检查全部 unit 无进程后清理；Windows 工具与构建目录继续保留用于补验。

本次仅追加本节、验证清单和计划接续，没有新增产品或测试代码修复。OCR delegate 复核新增证据，四个测试文件按相同哈希复用上轮审查与回归；不重新调用外部模型。下一次原生验收应在启动限时宿主前准备好 fixture 路径与可用输入方式，拆成“坏文件/报告”和“候选审批发布/另一坐席查询”两段短会话。普通 Windows OS 账号入口与安装包验收仍未提供通过证据；P2 原生平台验收未完成。

## 提交后原生上传补验（2026-10-07）

先完成本地提交 `732ca7b`（`test: harden Electron teardown and record Hangzhou acceptance`），再于北京时间 23:41–23:59 继续三个限时会话（session-5/6/7）。该提交与 `be1383a` 的产品运行源码、合同、依赖及锁文件没有差异；WSL 仍核对原归档 1,151 个文件，Windows 核对原归档加四个已提交测试补丁的 1,152 个文件，均无差异。远端不是完整 `732ca7b` 文档树，沿用的是相同产品运行内容。

session-6 已通过未替换的 Windows 原生文件框选取合成 `bad.xlsx`，在工作台核对整理责任人与实际改稿人并上传。实际 WSL API/PG15 环境中，页面先显示正在读取文件，刷新解析进度后显示“整批校验未通过”“共 1 个问题，当前显示 1 个”，另提示排除 2 张非业务/说明工作表、0 个媒体对象。此次没有查看到问题行的坐标或详细内容，不把其他轮次的行号借作本次证据。

点击“保存完整错误报告”时资格已到期，页面显示“会话、权限或请求上下文已改变，请刷新”，同时撤去可上传来源；没有进入原生保存框，也没有生成可回读的本轮报告文件。session-5 仅完成登录；session-7 再次尝试时，UU 键盘事件未可靠到达原生文件名输入框，确认文件前已到期。一次成功输入不能证明远程输入问题已解决，故不继续重复同样的限时操作，也不延长事实 TTL。

以上上传与阻断结论来自 CUA 原生界面观察，未将整屏截图持久化。session-6 宿主日志只记录启动和停止，没有上传后的状态快照，不能声称其请求追踪或数据库计数已独立证明该上传结果。session-7 的 `status` 是该新宿主的初始预置状态，不能替代 session-6 的上传后状态。没有执行审批、质量检查或发布操作；原生报告保存/取消/回读、Windows→WSL 完整发布与普通坐席查询、普通 Windows OS 账号及安装包验收仍未完成，不新增完整通过用例数。

本轮服务构建通过；三个宿主均按既有期限自动停止，记录 `hostDataRemoved: true`。22 份新增原始文件完整取回并逐个校验，独立位于 `.gstack/qa-reports/content-intake-native-continuation-20261007/raw/`，压缩包 SHA-256 为 `acf8bbb3c29e66358e57fb9e5a43ebbc76c6eac3d0ff81e22fc42948a675a855`。它们与上一节的 22 份文件分别保存。桌面日志保留到期/关闭后的 `410 GONE`、`UND_ERR_SOCKET` 和 `ECONNREFUSED`，不作零诊断声明。

Windows 三轮自有 Electron 进程均已停止，三个 profile 已删除，回读归属本轮的进程/profile 为空；工具与构建目录保留。WSL 四个自有 unit 均为 inactive、MainPID 0、ControlGroup 空，取回证据并校验后删除本轮自有根目录；清理回执为 `.gstack/qa-reports/content-intake-native-continuation-20261007/wsl-cleanup.json`。系统工具、系统 PostgreSQL 和业务服务未改动。

提交后仅更新本说明、验证清单及计划接续，未改产品或测试代码。下一次应先在宿主启动前验证 UU 的原生键盘/文件定位输入可靠，再补保存报告并实际回读文件；之后单独完成审批、质量检查、发布和另一产品坐席同版查询。P2 原生平台验收仍为部分完成。

本轮 OCR delegate 的 1 个可审 JSON 已复核，并补审默认排除的 2 个 Markdown，覆盖全部 3 个变更文件，无剩余确认问题；同时核对证据内容和原始哈希，未调用外部模型。`pnpm docs:check` 通过（204 篇），`git diff --check` 通过。提交后仅有文档变更，未重复全量代码测试。

## Windows 原生报告保存与回读（2026-10-08）

本次“继续推进下一步”沿用现有合成平台验收范围。北京时间 00:16–00:33，Windows 原生 Electron 经 UU 连接临时 WSL API/PG15；产品运行内容仍为 `be1383a`，本地 HEAD 为 `732ca7b`。没有修改产品、测试、合同、依赖或资格 TTL，也没有新增 Git 提交。服务构建通过，WSL 1,151 文件、Windows 1,152 文件再次核对一致。

session-10 完成原生选择 `bad.xlsx`、确认合成参与人、上传及刷新解析，页面显示整批拒绝、1 个问题、排除 2 张工作表。随后通过未替换的 Windows 原生保存框，将错误报告保存到本轮自有证据目录，页面显示“完整校验报告已保存”。Windows Node24 / ExcelJS4.4 实际回读产物，得到：

| 产物核验 | 实际结果 |
| --- | --- |
| 文件 | `native-report.xlsx`，6,615 字节 |
| 工作表与行数 | `校验问题`；表头加 1 条错误，共 2 行 |
| 错误定位 | `FAQ` 工作表，第 `3` 行、第 `C` 列，`REQUIRED` |
| 修正建议 | 补齐必填内容后整批重新上传 |
| SHA-256 | `2a01345d10cc1a8239f87406e18fd53b48f6e094b0c982e30fad3d579f214f93` |

同一 session-10 的宿主状态保留 89 条请求，包括原生登录后的新增文件接收、候选解析及两次报告获取。状态仍为 `rel_native_base`、发布 0、待审批 0、`diagnostics: []`。启动时另有预置候选，不能把预置上传算作原生上传。第二次报告保存窗口跨过资格到期，随后取消并返回上下文失效页面；这只证明窗口关闭和到期保护，**正常有效会话内的保存取消尚未完成**。

session-8 只完成登录和读取，主动 `quit` 后清理；session-9 在选文件前到期，session-10 在报告已保存后到期，后二者均自动停止并清理 PG/对象。session-8 首次启动把 WSL 绝对路径传给 Windows Node，产生 `MODULE_NOT_FOUND`；改为自有 Windows 根目录下的相对脚本参数后正常启动。UU 的输入法状态随窗口变化：上一窗口切为英文不代表下一文件框也是英文。本次分别切换英文并单独发送冒号、反斜杠，观察完整路径后再确认，成功完成打开和保存；不声称所有远程输入问题已解决。

本轮 24 份日志、资源核验和报告产物完整取回，逐文件哈希一致，位于 `.gstack/qa-reports/content-intake-native-20261008/raw/`。归档 SHA-256 为 `8798125f572340303c744287d19ef17dc0e3ceb8b3bb0a58629f065ced2055d6`。首次本地文件计数误用带点文件名匹配，漏计无扩展名的 `source-ready`；改为枚举全部文件后，24 个路径及哈希完整匹配。桌面日志保留 `410 GONE` 和宿主退出后的 `ECONNREFUSED`，不作全会话零错误声明。UI 观察来自 CUA 记录，未持久化含其他窗口的整屏截图。

三个自有 Windows Electron 进程树与 profile 已清理，回读均为空。四个 WSL unit 均为 inactive、MainPID 0、ControlGroup 空；证据传回并校验后删除本轮 WSL 根目录，Windows 工具、源码和构建目录继续保留。没有改全局工具、系统 PostgreSQL 或业务服务。

本次补齐了原生错误报告保存及实际产物回读；没有执行 Windows→WSL 的审批、人工质量检查、发布或另一产品坐席查询。这条写入闭环、有效会话内的保存取消、普通 Windows OS 账号及安装包验收仍待完成。P2 原生平台验收保持部分完成，不追加完整自动化用例通过数。

本节新增证据按 `open-code-review-delegate` 完成宿主审查：1 个可审 JSON 和默认排除后补审的 2 个 Markdown 全部覆盖，无剩余确认问题。另核对同会话请求与产物哈希；`pnpm docs:check`（204篇）及 `git diff --check` 通过。没有调用外部模型，产品与测试未变，未重复全量代码检查。当前分支仍有这3份证据/计划文档未提交。

## Windows 实际 WSL 发布与坐席查询闭环（2026-10-08）

北京时间约 01:07–01:30，继续既定合成验收。Windows 原生 Electron 连接 WSL 内实际 API/PG15，产品运行内容保持 `be1383a`，本地 HEAD 仍为 `732ca7b`。最终完整 E2E 为 **1 PASS，19.8 秒**（Playwright 总计20.4秒）；同一最终测试修订在 Mac 实际 API/PG15 回归为 **1 PASS，19.4 秒**。本轮没有修改产品、合同、依赖、安全边界或业务资格 TTL。

| 验证面 | 实际结果与边界 |
| --- | --- |
| 坏文件、修正重传、报告 | 实际 multipart 上传与解析；阻断错误整批拒绝；保存 XLSX 并用 ExcelJS 回读坐标和修正建议。自动化只替换打开/保存框的路径选择，文件系统和 HTTP 不替换 |
| 候选修订与证据一致性 | 同一候选版本1→2，重新确认来源和组织审批，旧版本证据失效；两个版本均走质量检查交互。审批通过来自脚本化合成 transport，质量检查由测试执行，不代表真实飞书或实际人工审核 |
| 发布与取消 | 版本2发布为 `rel_2`；另一个未发布候选取消后，线上发布仍为 `rel_2`。最终宿主130条请求、发布1、待审批0、diagnostics为空 |
| 另一产品坐席 | 登录合成 agent、等待 shop-a 授权上下文后查询到3条修订后多行答案；复制内容匹配，shop-b 越权被拒绝。仍在 Windows Administrator OS 会话，不代表普通 Windows 用户验收 |
| 桌面边界和样式 | 沙箱/preload与无旧接口旁路断言通过；浅色、深色、最小窗口均无横向溢出。实际截图延续现有紫色品牌、侧栏、按钮、圆角和主题；未新增另一套 UI |
| 原生保存取消补验 | UU曾可见“已取消保存报告”，但重连后该轮 stdout/状态文件含空字节，缺少最终结果及清理回执，**不能记为完整PASS**。原始损坏文件保留，需独立补验 |

先前两次自动化失败分别保留：第一次将Windows外框宽980错误地等同于renderer内容宽964；第二次在店铺选择触发异步权限读取后立即查询，结果被上下文重置。仅修复 `content-intake-real-stack.spec.ts`：保留外框尺寸断言，同时以Electron内容区宽度校验renderer；查询前等待店铺下拉框恢复可用且确认shop-a。没有硬编码Windows边框、放宽权限/内容断言、增加重试或延长超时。最终Windows及Mac均通过。

跨系统验证使用仓外临时stdio桥接，把既有合成宿主的状态、合成审批、身份切换、固定候选GET和关闭操作转给WSL；不新增产品HTTP端点或通用命令执行接口。临时Windows测试副本保留原始业务断言，增加远端清理确认。这是本次实机证据工具，尚未作为可复用跨平台CI入口交付。

114份原始日志、截图、trace和清单已完整取回，逐路径、逐文件SHA-256一致；归档为 `.gstack/qa-reports/content-intake-native-publication-20261008/native-evidence.tar.gz`，SHA-256 `53f61ded2a2bab313790754637760407f70ab23784bc3769f55a006598a1f68c`。两次失败、最终通过、取消中断分目录保留，传输校验不代表损坏文件内容有效。WSL1151个原归档文件未变；Windows1152文件按更新后的测试清单核对一致，单独记录本轮测试补丁。

完整通过轮的Electron、profile与WSL PG/对象均有清理确认。取消补验重连后无本轮进程，留有一个合成profile，已在核验归属后删除；不能据此推断该轮宿主正常close完成。三个本轮WSL unit均inactive、MainPID 0、ControlGroup空，证据传回校验后删除自有WSL根目录。Windows源码/工具/构建及临时证据辅助文件保留于原隔离目录，供后续补验；没有改系统工具、网络配置、系统PG或业务服务。

本轮受影响E2E的ESLint、桌面typecheck、Mac实际栈回归通过；服务构建通过。全量unit/build基线按未变产品哈希复用，不因纯测试同步和证据更新重复运行。后续仍需有效会话内原生保存取消的完整结果、普通Windows OS账号、安装包专项；真实飞书/数据与上线仍须各自批准。P2原生平台验收保持部分完成。工作树现有1个测试文件和3份计划/证据文档未提交，未push/PR/merge/deploy。

本节按 `open-code-review-delegate` 完成审查：OCR可审JSON及补审的E2E、两份Markdown，共4/4文件，0跳过、无剩余已确认问题。复核包括两处测试修复、同轮证据绑定、损坏文件不计通过和清理回读；未调用外部模型。`pnpm docs:check`（204篇）、`git diff --check`通过。

## Windows 原生保存取消与打包态验收（2026-10-08）

接续 §0.38 的缺项。有效会话内原生保存取消补验为 **1 PASS，31.9秒**（总计32.4秒）：Windows原生Save框未被替换，经UU点击取消后显示“已取消保存报告”，没有生成文件。状态采样为UTC `2026-10-07T17:48:24.579Z`，早于资格截止 `17:52:55.018Z`；仍为rel_native_base、发布0、待审批0、diagnostics为空。上传与报告读取使用实际WSL API/PG15，仅打开框选择路径由测试指定。此前损坏/中断记录保留，这一独立完整结果补齐了取消缺项。

Windows官方 `pnpm package:win` 退出0（106.712秒），打包前后workspace检查和包结构后验通过，产物为0.3.26 local-unsigned。额外的Windows系统签名检查为NotSigned、证书为空。初次外围证据脚本在构建成功后因生成的app-icon.png哈希变化退出1：原图与Windows生成图均1024×1024，逐RGBA像素完全一致，只存在PNG字节编码差异。保留原失败记录，另立打包后清单核验，没有手改本地派生资产或放宽官方门禁。

| 验证面 | 最终结果 |
| --- | --- |
| Windows打包态完整FAQ流程 | 1 PASS，19.8秒（总计20.3秒）；从win-unpacked启动，断言app.isPackaged和app.asar，连接实际WSL API/PG15，原始上传、报告回读、v2新证据、发布/取消、另一产品坐席同版查询与越权拒绝断言保留 |
| Windows退出回归 | 2 PASS，总计11.3秒；分别验证阻止正常quit，以及launcher已退出而Electron仍存活；主进程与renderer均退出，临时profile为空 |
| Mac相关回归 | 3 PASS，总计26.2秒；management、query、real-stack（18.8秒），资源清理回读通过 |
| 静态与目录检查 | 三个测试文件ESLint、桌面typecheck、workspace:check通过 |

本次只修测试基础设施：Playwright1.62.1在Windows以cmd.exe启动Electron，原清理仅结束launcher，可能留下持有stdio的原生进程。`closeOwnedElectron`现在捕获并监督实际Electron PID，超时只结束本测试进程树，并明确等待原生进程退出；增加两个真实Windows回归。另将已有query打开/聚焦/parked/opening等待复用于Dashboard关闭后的退出登录操作，修正打包态偶发点击发生在窗口交接期间的问题。没有强制点击、延长业务TTL、放宽业务断言或改产品代码。原清理基线超时、中间修复未覆盖launcher先退出、query交接失败及最终通过各自留存。

安装包保留于杭州 `C:\Users\Administrator\AppData\Local\Temp\cai-p2-be1383a-269952\source\release\local-unsigned\windows\客服话术浮窗 Demo-0.3.26-win-x64-UNSIGNED.exe`，92,203,324字节，SHA-256为 `86f263baaf27cb5a60a9ef0f3631ce307a29eae0cd8cc0aa9af4239588df1514`。exe、app.asar和icon.ico均在最终运行后重新核对哈希。打包态通过不等于NSIS安装/卸载通过。

两批原始证据分别34份和215份，精确路径集合与每个SHA-256均匹配；部分WSL日志重复，不相加声称249份独立证据。目录为 `.gstack/qa-reports/content-intake-native-cancel-r2-20261008/`；归档分别为 `963545d0f57a9cce0a74a6ed153710a706561b1eab716951e1cb222c4c53b7b2` 和 `0e3df0a77896c977201e82d0d3690cb73900433eb9bfc7e38b0f8c7c38788217`。WSL1151原归档文件未变，Windows最终1153文件（含新回归及预期生成图标）与清单一致。最终测试进程/profile为空，WSL两个自有unit均inactive/MainPID0/ControlGroup空；取回证据后删除自有WSL根目录，Windows工具、源码、包与辅助证据保留。

用户确认没有普通Windows账号，先完成当前Administrator与安装包验证；普通OS账号保持待办。合成agent角色不等于普通OS账号。审批仍用合成transport，质量检查由测试执行，不替代真实飞书或人工审核。产品源码、合同、依赖与安全边界未变，复用既有全量基线，未重复无关unit/build。当前三项测试文件与三份计划/证据文档共6项未提交。

本轮按open-code-review-delegate复核OCR可审的helper/JSON，并补审默认排除的两项E2E和两份Markdown，共6/6文件、0跳过，无剩余已确认代码问题；未调用外部模型。原始清单、规则与最终逐文件审查记录保存于同一仓外证据目录。

安装专项接续：按用户“先完成当前账号与安装包验证”推进，预检未发现该应用的卸载注册项或快捷方式；已有默认userData保留。已核验安装包哈希并启动中文向导，目标是自有根目录内 `installed-p2`，目前停在MIT许可页，尚未点击“我同意”、未完成安装；许可确认后继续安装/启动/卸载。界面操作规则要求接受许可时单独确认，因此只暂停这一依赖动作，不把向导打开记为安装PASS。没有为远程测试断开整机网络，不声称完整离线验收。系统进程表还列出历史PID1084/23988，但二者HasExited=true、HandleCount=0，均不是活动Electron。`install-license-pending.json`保留回读；前述artifact-audit是启动安装向导之前的记录。`pnpm docs:check`（204篇）和`git diff --check`通过。

## Windows 安装、启动与卸载验收（2026-10-08）

用户明确回复“同意许可，继续”后，于北京时间约02:38–02:46通过UU“人事-台式”的真实Windows界面完成本次安装专项。使用前节同一0.3.26 UNSIGNED安装包；没有重新构建、修改产品或测试代码。选择中文向导默认的“仅为我安装（Administrator）”，目标在既有自有测试根目录的 `installed-p2` 内，安装器最终落在其 `@customer-agentdesktop` 子目录。首次回读脚本按父目录查找EXE失败，随后依据实际注册项和快捷方式取得正确路径；这不是安装失败。

| 检查 | 实测结果与边界 |
| --- | --- |
| 中文许可与安装向导 | PASS；用户许可确认后继续，当前用户安装，界面显示安装完成 |
| 安装文件、注册与快捷方式 | PASS；0.3.26卸载项、桌面及开始菜单快捷方式存在且指向本轮目录；EXE/app.asar/icon.ico哈希与前节打包产物完全一致 |
| 安装后启动 | PASS；取消向导自动运行，再启动已安装EXE并指定新的隔离userData；未读取或启动已有默认profile |
| 无预置配置的启动 | PASS；新profile自动写入精确 `{"mode":"synthetic-offline"}`，可见紫色狐狸，无缺少配置弹窗 |
| 全局快捷键与窗口 | PASS；Ctrl+Shift+Space打开查询胶囊，Esc收起，狐狸交互也打开查询；没有在本轮进行登录/业务查询 |
| 拖动 | 未确认；UU两次drag操作表现为打开查询，未取得位置稳定变化证据，不能推断产品拖动缺陷或记为通过 |
| 正常退出与卸载 | PASS；狐狸菜单“退出Demo”后无活动应用进程，再经真实中文卸载向导完成卸载；系统回读安装文件、快捷方式和卸载注册项均为空 |
| 数据保留与清理 | PASS；卸载器保留自有测试profile，按归属单独删除并复核；原有默认userData继续保留，安装包与既有源码/工具保留 |

本次通过的是当前Administrator会话中的安装生命周期专项。没有通过Windows设置入口卸载（使用注册信息对应的卸载器）；没有使用未修改快捷方式启动默认profile，也没有断开机器网络，不能据此签署完整办公机离线清单或普通OS账号验收。操作人为Codex经授权远程控制，不代填人类验收签名。此前打包态实际API/PG15闭环与本次合成离线模式启动属于不同证据层。

5份新证据为 `installed-prelaunch.json`、`installed-running.json`、`installed-exit-uninstall.json`、`installed-cleanup.json` 和 `installed-ui-observations.json`，保存在前节同一仓外目录，逐文件哈希见 `installed-evidence-manifest.json` 与验证清单。GUI观察来源为CUA记录，未将包含其他应用的整屏截图持久化。02:45:56的最终回读确认自有安装根目录/profile已删除、原默认数据仍在；前节许可等待记录保留为历史，已不再阻塞。

本轮只接续更新既有3份计划/证据文档，按open-code-review-delegate复核全部3项；此前3个测试文件按精确哈希复用审查及实机回归，无新增已确认代码问题。文档引用/一致性与git diff检查通过，不重复未变化的代码测试。全部未提交变更仍为6个文件，HEAD仍732ca7b；未commit/push/PR/merge/deploy。余项是普通Windows OS账号、可靠原生拖动及完整离线验收；真实飞书/数据/正式运行继续沿各自批准。
