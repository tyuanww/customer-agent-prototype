# Windows 安装包与实机验证方案

> **状态：DRAFT · NOT APPROVED TO START。**
> 本文是 Windows 安装包、启动配置与实机验证的计划入口，供用户审阅后决定是否开工。它不授权打包、安装、签名、公证、部署或真实数据。当前执行状态由[执行清单](2026-09-06-execution-goal.md#当前执行清单)拥有。
> D0–D5 设计真源仍是 [2026-09-09 准备](2026-09-09-desktop-integration-preparation.md)；本机未签名打包事实仍由 [README 打包现状](../../README.md#windows-打包现状) 与 [如何验证 §3.3](../how-to-verify-desktop.md#33-pnpm-packagewin) 拥有。本文不复制那些真源，只引用并补安装/实机阶段缺口。
> 核对日期：2026-09-10。产品基线 `main@5d6a8023d734e7ee3c83364944adada7751c0d93`。本文不是 Windows 产品实现、安装验收或部署完成记录。

## 0. 目标与非目标

**目标：** 形成可供用户测试、随后供客服受控试装的 Windows 安装包方案。首轮仍使用纯合成数据与合成身份。

**本次（2026-09-10 收口 Goal）只写 DRAFT，不实施。** 不得把本文存在写成已批准开工，也不得把 hosted-runner smoke 或 macOS 用户反馈写成 Windows 实机通过。

| 在范围内（批准后才做） | 明确不在本文授权内 |
| --- | --- |
| 选定 Windows 版本/架构/设备后的安装包方案 | 现在就打包、安装、签名、公证、部署 |
| 未签名证明包 → 用户测试机 → 受控试装的分阶段任务 | 真实飞书、真实客户数据、冻结合同、旧 migration |
| 安装/升级/卸载/异常恢复与诊断约定 | 自动外发、自动更新、GitHub Pages、治理 PR #80 合并 |
| 签名策略、SmartScreen 提示、费用与待批准事项 | 修复 BACKEND-CI-503 或登录残留提示 |

## 1. 支持的 Windows 版本、架构、目标设备

下列为**当前仓库事实**与**待确认**，不编造设备名、证书或负责人。

| 项 | 当前事实 | 待确认 |
| --- | --- | --- |
| 安装包格式 | electron-builder **NSIS**，`oneClick: true`，`perMachine: false`，不可改安装目录，关闭 differential package | 试装是否改成可改目录 / 按机安装，需阶段批准 |
| 架构 | 仅声明 **x64**（`apps/desktop/package.json` `build.win.target`） | 是否需要 Windows ARM64 / 32 位；当前产物不能冒充已支持 |
| 最低 OS | Windows 目标**未**声明 `minimumSystemVersion`（macOS 声明了 12.0） | 对照 Electron 43 官方支持矩阵后选定；在选定前不写“已支持 Windows 10/11” |
| 应用身份 | `appId` 仍为 `local.demo.customer-agent`；`productName` 为「客服话术浮窗 Demo」 | 试装是否继续 Demo appId，或另批长期 ID |
| 目标设备 | 未指定 | 用户测试机台账、客服受控试装机台账、是否允许远程协助 |
| 本机环境 | 当前开发与人工观察在 macOS 合成栈 | Windows 测试机是否可安装 Node 24 / pnpm / PostgreSQL 15，或只收安装包 |

**推荐第一步（仍不实施）：** 用户确认一台 x64 Windows 测试机的版本（例如 10/11 及具体版本号）、是否允许本机跑 loopback API + PostgreSQL 15，以及首轮是否仍用未签名 NSIS 包。未确认前不打包。

## 2. 数据与身份

- **首轮仍使用纯合成数据与合成身份。** 真实客户数据、真实飞书凭据与正式运行身份必须另行批准。
- 现有 D1–D5 接入 profile 要求 `CUSTOMER_AGENT_DESKTOP_API_ORIGIN` 与 `CUSTOMER_AGENT_DESKTOP_IDENTITY_ORIGIN` 均为精确 loopback `http://127.0.0.1:端口/`（pathname `/`）。缺一项、不成对、非 loopback 拒启。
- **打包态当前拒启该 profile：** `apps/desktop/src/main/main.ts` 在 `app.isPackaged` 时只要设置了上述变量就抛错。因此**当前 `pnpm package:win` 产物不能携带 D1–D5 产品会话**；未签名包最多验证 S0 浮窗/安装路径，不能冒充客服主链试装。
- 若用户测试或客服试装需要安装包内的合成登录/查询，必须先批准一项独立工程：在不把 token 交给 renderer、不放开任意 URL 的前提下，为打包态提供受控合成 origin 配置。该工程不在本文开工授权内。
- Dashboard 继续无 preload。复制成功只表示「已复制」。

## 3. 安装包、启动配置、后端连接、日志

打包命令与后验以 [如何验证 §3.3](../how-to-verify-desktop.md#33-pnpm-packagewin) 为准。当前产物：

- `release/local-unsigned/windows/客服话术浮窗 Demo-<version>-win-x64-UNSIGNED.exe`
- 同目录 `win-unpacked/`
- 仓库**没有** Windows `distribution` 路径；`mode !== 'local'` 直接失败
- 文件名强制 `UNSIGNED`；`CSC_IDENTITY_AUTO_DISCOVERY=false`；`signExecutable: false`
- 后验拒绝 `.blockmap` / `latest*.yml` / `app-update.yml`

| 主题 | DRAFT 约定 | 待确认 |
| --- | --- | --- |
| 启动配置 | 未批准打包态产品 profile 前，安装包按 S0 合成 fixture 启动，不读真实 URL | 合成 API 是同机 loopback，还是另批测试主机；当前代码只允许 127.0.0.1 |
| 后端连接 | 首轮若要跑 D1–D5 主链，API / 合成身份 / PostgreSQL 15 必须出现在获批拓扑里，且仍是 synthetic-only | Windows 测试机是否安装 PG15；端口、防火墙、开机自启均未定 |
| 日志与脱敏 | 诊断不得写入真实客户原文、token、内部 URL；失败码与哈希化标识可保留 | 安装后日志目录、保留天数、如何从试装机取回；现无现成 Windows 采集手册 |
| 交付位置 | 未签名包只放本机 `release/local-unsigned/windows/`，被 Git 忽略 | 用户测试包的传递方式（当面拷贝 / 受控网盘）；禁止公开 Release 当正式分发 |

## 4. 功能验收项（实机，合成数据）

下列是**Windows 实机**要看到的行为。macOS 用户反馈与自动化不得直接勾选本表。

| 项 | 通过标准 | 失败/禁止 |
| --- | --- | --- |
| 登录 | 合成登录后可见角色与退出；DEMO / MOCK AUTH / SYNTHETIC DATA 边界仍在 | 真实飞书登录；token 出现在 renderer / 日志 |
| 退出 | 退出后查询被拦 | 退出后仍能查出上一会话候选 |
| 查询复制 | 命中后复制成功只显示「已复制」 | 「已发送」「已采纳」「已转交成功」 |
| 无匹配求助 | 显示「没找到可用话术」；可复制合成联系方式或打开合成入口；状态仅「已打开入口 / 已复制联系方式 / 待核实」 | 「已转交成功」 |
| 内容失效 | 获批拓扑下发布/回退后，旧候选不可继续当有效答案使用 | 只凭「回退后仍能查到同一句话术」勾选 STALE。该现象只证明回退后查询可用 |
| 登录残留 | 不作为本阶段通过门禁 | 已见残留红色「合成登录…」，见 [TODOS](../../TODOS.md#login-residual-invalid-banner)，独立修复 |

S0 安装包若未接通产品 profile，上表登录/查询/失效不适用；只能验收安装、启动、浮窗与卸载，并在报告中写明未测产品主链。

## 5. 安装、升级、卸载、异常恢复

| 检查 | 当前实现能支持什么 | 实机仍要看什么 |
| --- | --- | --- |
| 安装 | NSIS one-click 写入当前用户目录 | SmartScreen / 未签名警告文案；是否要管理员；任务栏/开始菜单快捷方式；图标 |
| 升级 | 无自动更新元数据；再次安装同一 NSIS 的覆盖行为未在实机验证 | 覆盖后用户数据目录是否保留；是否出现双图标；版本号是否可见 |
| 卸载 | 依赖 NSIS 默认卸载器 | 「应用和功能」能卸干净；开始菜单与安装目录是否残留；userData 是否按约定保留或删除 |
| 异常恢复 | 开发态缺配置/非 loopback/打包态产品 profile 均 fail-closed | 安装中断、杀软拦截、缺 VC++ 运行库、杀进程后重启、卸载失败后的手工清理步骤 |

回退方式：保留上一份已知安装包；卸载当前版本后改装上一份。没有在线回滚通道。

## 6. 签名、Windows 安全提示、费用、待批准事项

| 事项 | 当前事实 | 待批准 / 待确认 |
| --- | --- | --- |
| Authenticode / EV | 无；产物强制 UNSIGNED | 是否购买/使用公司代码签名证书；证书主体、硬件钥匙、年限、费用未提供 |
| SmartScreen | 未签名 exe 预期出现保护提示 | 是否接受首轮测试机点「仍要运行」；是否要 EV 以降信誉拦截 |
| 防病毒误报 | 未测 | 试装机上的杀软名单 |
| 公证 | Windows 无 Apple 式公证；macOS 公证路径与本文无关 | 不要把 macOS 公证脚本写成 Windows 已具备 |
| 费用 | 未估算 | 证书、时间戳服务、可能的 EV 硬件、测试机；不得在本文填写虚构金额 |
| 法律/分发 | 第三方许可已随包；自身分发条款未定 | 收件人范围、内部试用协议 |

未批准签名前，任何外发或客服试装材料必须继续带 `UNSIGNED`，并书面说明「未签名，不是正式外发包」。

## 7. 证据必须分账

| 证据类 | 能证明 | 不能证明 |
| --- | --- | --- |
| 自动化（本机/CI Linux+PG15） | D1–D5 合成工程、同一 SHA 整链 e2e | 人工观感、Windows 实机 |
| Windows hosted-runner smoke | clean-checkout 上 `package:win` 后验 + 定向 Playwright 启动/快捷键/透明浮窗/干净退出 | 企业设备策略、IME、DPI、读屏、GPU 玻璃、签名、更新、Pilot、产品会话主链 |
| 用户反馈（macOS 合成） | 用户已在本机合成栈看过登录/复制/求助/回退后查询/退出拦截 | Windows 实机；STALE 缓存失效的人工验证 |
| Windows 实机 | 指定设备上的安装、启动、安全提示与获批功能表 | 未记录的其他机型或真实数据 |

禁止用 CI 绿、文档存在或 macOS 反馈勾选 Windows 实机验收。

## 8. 分阶段任务、依赖、完成标准、回退

| 阶段 | 做什么 | 依赖 | 完成标准 | 回退 |
| --- | --- | --- | --- | --- |
| P0 批准本 DRAFT | 用户确认范围、设备、首轮仍合成、是否接受未签名 | 无 | 书面批准对象/动作/限制；TBD 清单有归属 | 保持 DRAFT，不打包 |
| P1 采集 TBD | OS 版本、架构、测试机、是否本机 API/PG15、证书意向与费用 | P0 | 台账列出设备与缺口，不编造 | 缺项保持 TBD，不进入 P2 |
| P2 打包态合成配置（若需要客服主链） | 设计打包态 loopback/受控 origin，renderer 仍无 token | P0 + 独立工程批准 | 获批计划 + 实现 PR + CI；打包态不再误拒合成 profile，也不接受任意 URL | 还原「打包态拒启产品 profile」 |
| P3 未签名安装包 | 在获批 SHA 上 `pnpm package:win`，产物后验 | P0；主链试装还依赖 P2 | 存在 `UNSIGNED.exe`、后验通过、SHA 绑定 | 丢弃该份 `release/` 产物，不入库 |
| P4 用户测试机 | 安装、启动、卸载；若 P2 已合并则加第 4 节功能表 | P3 + 实际设备 | 实机记录（机型/OS/包 SHA/现象）；失败原样保留 | 卸载，改回上一份包或卸干净 |
| P5 签名策略 | 仅在 P4 未签名路径可重复之后 | 证书、费用、法律批准 | 独立 `release/distribution/` 方案，不复用 UNSIGNED 当已签名 | 继续 UNSIGNED，不外发 |
| P6 客服受控试装 | 仍合成，除非另批真实数据 | P4 或 P5 + 试装机 + 负责人 | 试装名单、回退包、脱敏日志回收 | 卸载并回收安装包 |

**完成标准（整个 Windows 阶段，不是本文）：** 指定 Windows 设备上的获批安装包可安装、可启动、可按第 4 节验收、可卸载回退；证据绑定包 SHA、设备与数据范围。本文 DRAFT 本身的完成标准只是：计划可审阅、TBD 显式、未实施。

## 9. 可并行 vs 必须先取得设备或阶段批准

**现在可并行、且不构成本文开工：**

- 继续引用 D0–D5 已合并自动化证据
- 登记登录残留与 BACKEND-CI-503（保持 OPEN）
- 用户填写第 1 节 TBD（设备、OS、是否本机 API）
- 查询证书采购周期与大致费用（只收集，不购买）

**必须先取得阶段批准才能做：**

- 任何 `package:win` 以外的「给别人的包」传递
- 修改打包态 origin 拒启逻辑（P2）
- 在真实 Windows 设备安装
- 购买证书、启用 Authenticode、去掉 `UNSIGNED`
- 客服受控试装、真实数据、非 loopback 后端

**必须先有设备才能做：** 第 4–5 节全部实机项、SmartScreen 文案、卸载残留、GPU 玻璃。

## 10. 推荐第一步与 TBD 清单

**推荐第一步：** 用户指定一台 x64 Windows 测试机（OS 版本号）并确认：① 首轮仍纯合成；② 首轮是否接受未签名 NSIS；③ 该机能否本机运行 API + PostgreSQL 15。收到这三项后再把本文从 DRAFT 改为可批准实施计划。在此之前不运行打包、安装、签名或部署。

待确认（不得用占位符冒充已填）：

1. Windows 测试机型号、版本、架构、是否加入域/杀软
2. 客服试装机数量与保管人
3. 合成 API 拓扑（同机 loopback vs 另批主机）
4. 是否批准打包态产品 profile 的独立工程
5. 代码签名证书主体、类型（OV/EV）、费用、保管人
6. 未签名包的传递与回收方式
7. 试装日志如何脱敏取回
8. 登录残留是否必须在试装前修复（建议：独立、可并行，不阻塞 P0/P1）

## 11. 与已有文档的关系

| 文件 | 关系 |
| --- | --- |
| [执行清单](2026-09-06-execution-goal.md) | 当前动作与证据分账 |
| [D0–D5 准备](2026-09-09-desktop-integration-preparation.md) | 合成桌面设计 SSOT；不授权 Windows 开工 |
| [如何验证](../how-to-verify-desktop.md) | 命令与 hosted smoke 边界 |
| [README 打包现状](../../README.md#windows-打包现状) | 未签名包路径与禁止事项 |
