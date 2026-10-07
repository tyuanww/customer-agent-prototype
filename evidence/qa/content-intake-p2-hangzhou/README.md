# P2 杭州分层验收（2026-10-07）

产品基线提交：`be1383a2336ddd8b359cd47108752a64a54fc581`。WSL 使用该精确提交；Windows 最终复跑和 Mac 回归使用该产品基线加本轮四个测试文件的修复，精确哈希见验证清单。本轮只做已授权的合成验收，不接真实飞书或客户/员工数据，不改变生产服务、系统 PostgreSQL 或正式运行批准。

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

Windows 本轮源码、解包工具和构建目录暂留在 `%LOCALAPPDATA%\Temp\cai-p2-be1383a-269952`，供后续原生文件框/实际后端联调复用；没有活动测试进程，临时应用 profile 已清空。此前 WSL 隔离根目录已删除，两者的清理状态分别记录。Mac 已有全量基线和 WSL 未变检查继续按产品哈希复用，本轮没有重跑全仓 unit suite 或新增打包验收。当前 4 个测试文件、规划接续记录和 2 个杭州证据文件共 7 项未 commit，未执行对外 Git 动作。

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
