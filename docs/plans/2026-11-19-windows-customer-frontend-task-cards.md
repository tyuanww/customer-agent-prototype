# Windows 客服前端调整任务卡

> **状态：ROUGH · 待审。** 2026-11-19。来源为备忘录《客服前端调整》、其中引用的《客服 agent 微调》窗口要求，以及坐席在 Windows 下载安装包后的三张截图。排查基线为产品仓 `main@49f00e90`。本页记录本次功能的依赖、决定与验收进度。

坐席登录后回到原问句。一次查询显示 FAQ 和 SOP 候选。坐席主动进入流程，可命名、并行办理、缩放和贴边暂放。

## 推进顺序

本计划处于 `ROUGH`。现在可继续 W0 的只读排查，以及 W1 至 W7 的独立取证和方案核对。现场诊断使用已获准的环境和证据。W1 至 W7 的代码实施从对应计划获批后开始，按表中依赖逐卡推进。W8 在有获准的 Windows 候选包、设备和测试范围后执行。[计划状态与实施输入](../../PROJECT_CHARTER.md#2-本仓的权威顺序) · [各阶段退出条件](../reference-engineering-workflow.md#2-固定阶段与退出条件)

| 卡 | 可独立验收的结果 | 依赖 | 当前状态 |
| --- | --- | --- | --- |
| W0 | 把现场安装包、实际运行配置与首次失败步骤对应起来 | 无 | 排查中，已核对官网包和 SOP 源码历史，待现场包 |
| W1 | 未登录点查询能登录，成功回到精简搜索框 | 可独立取证，获批后从 main 开工 | macOS 合成登录通过，待获批 |
| W2 | 有资格时首次 FAQ 查询成功，失败时坐席知道如何恢复 | W0 的失败证据决定修复位置 | 已追到授权和快照边界，待定因 |
| W3 | SOP 标题栏的 × 能点，标题空白处仍能拖动 | 可独立取证，获批后从 main 开工 | Chromium 命中对照、macOS SOP 基线通过，待 Windows 复现 |
| W4 | 并行办理可分别命名、结束，并从狐狸右键恢复 | W3；需确定 × 的最终语义 | 方案待审 |
| W5 | 问一次即可看到授权 SOP 候选，点击才开始办理 | W0 确认目标 profile；复用 W2 的资格口径、W4 的实例入口 | 匹配与首开接口待评审 |
| W6 | Query 和 SOP 的四边、四角都能缩放，内容更新后尺寸稳定 | 可独立取证，SOP 部分与 W4 协调窗口所有权 | 已核对尺寸写入，方案待审 |
| W7 | SOP 首开在左侧中央，多个书签分别恢复原步骤与尺寸 | W4、W6 | 方案待审 |
| W8 | 同一 Windows 候选安装包跑通整套客服操作 | W1 至 W7 的适用结果 | 待实机验收 |

**现在并行取证。** W0 查安装包和首查失败点。W1、W3 分别验证登录和 SOP 点击。W6 对照 Query 与 SOP 的尺寸写入。W2、W5 可先做合成对照与合同盘点。W8 可先准备实机用例。

**获批后交叉实施。** W1 与 W3 可从同一基线各开 worktree。W2 等 W0 定因。若 W2 也改 `QueryApp`，在 W1 后接入。W4 在 W3 后拥有 SOP 实例和窗口。W6 的 Query 几何可独立，SOP 部分基于 W4 的窗口所有权。W5 消费 W2 的资格和 W4 的首开接口。W7 等 W4、W6。W8 验收同一候选。

同一模块或 IPC 合同由一个工作区写入。W3 优先改 SOP 标题栏，涉及共享拖动钩子时先交接。共享 `QueryApp` 的卡按落地顺序从最新基线接续。上下游交接记录提交、入口、测试和剩余阻塞。

## W0 · 找到 Windows 首查的第一个失败点

- [x] 坐席确认环境为 Windows 安装包。截图能看到登录后的坐席、当前店铺、SOP 入口，以及「查询未完成／请刷新店铺」。
- [x] 官网为 `Demo-0.3.42-win-x64-UNSIGNED.exe`，SHA-256 为 `a9fea640460e4056df3a7cd9daa36a783b19953bdc92e101376457d931f81130`。SOP 按钮新增于 `00cec500`，`v0.3.42@1ca737ee` 的历史不包含该提交。截图中的 SOP 入口对应更新的源码，包版本仍待核。[官网下载页](https://download.jianghua.site/windows.html) · [对应 Release](https://github.com/weiweity/customer-agent-prototype/releases/tag/v0.3.42)
- [ ] **绑定现场包。** 优先取得原 EXE 文件名及 SHA-256。若只保留已安装应用，核对版本和随包构建标识（若有），再记录生效的 profile 模式、SOP 模式及故障时间。发布记录和现场记录分栏保存；仅有版本号时保留证据缺口。[构建标识与运行配置](../how-to-ship-the-next-desktop-cut.md)
- [ ] **沿同一请求定位。** 先核对目标店铺是否有有效查询授权及 FAQ 来源。再依次核对 Query 提交、Main 选店、资格签发、快照分页校验、本地检索。记录首个失败步骤与脱敏 code/reason，记录「重试」和「刷新店铺」是否到达同一步。真实诊断遵循既有授权，只在本卡记录证据位置和结论。[账号查询权限](../how-to-check-roster-permission.md)
- [ ] **完成条件。** 有与现场包对应的对照，能指出最早失败的边界并把 W2 分派给该边界的所有者。无法确认时列明缺哪条证据，保持待定因。只有无授权时按授权流程处理；界面反馈可单独验收。

## W1 · 登录后回到原问句

- [ ] **链路与调整。** 查询按钮与回车进入同一提交逻辑，未登录时复用已有独立登录窗。会话交换成功后，Query 显示「登录成功」、恢复输入焦点。把店铺发现前后的清理与展开结果页分开。单店自动选，多店在首次提交确需选店时提示，首屏仅保留搜索所需控件。[提交与会话回传](../../apps/desktop/src/renderer/QueryApp.tsx) · [提示显示条件](../../apps/desktop/src/renderer/features/search/QueryCapsule.tsx) · [店铺加载](../../apps/desktop/src/renderer/features/search/use-intake-shops.ts)
- [ ] **回归。** 用按钮、回车和连续点击触发登录。取消或失败后保留原文；恢复已有会话时不重复提示；仍能从工作台入口登录后进入工作台。无查询权的账号可以完成登录，查询时看到真实原因。
- [ ] **Windows 验收。** 新会话输一条合成问句后点查询，只出现一个登录窗。成功后同一问句仍可编辑，后台读店完成时未主动展开店铺或 SOP。记录登录窗创建次数与额外结果页展开次数，重复建窗或自动展开即失败。

## W2 · 有授权的首次 FAQ 查询可用

- [ ] **按证据选方案。** 有效 grant 缺失、店铺范围已变、资料读取失败分别对应不同恢复动作。W0 若定位到资格签发，核对服务端范围和 Main 的合同视图；若签发成功，继续检查完整快照及其关联字段。仅在已确认的所有者处修复，并让原始失败类别贯穿 IPC 和结果页。把“重新查原问题”和“重新发现店铺”分别接到对应动作。[查询 IPC](../../apps/desktop/src/main/content-intake-query-ipc.ts) · [Main 检索](../../apps/desktop/src/main/content-intake-query.ts) · [资格与快照](../../apps/desktop/src/main/content-intake-usage.ts) · [服务端范围](../../apps/api/src/content-intake/usage.ts)
- [ ] **合成对照。** 同店、同问句，有权且已有已发布 FAQ 时首查即见预期话术；无 grant、资格过期、无匹配和读取失败分别得到对应结果。撤权后旧复制句柄失效。沿用服务端授权和完整分页校验。[既有 Query E2E](../../apps/desktop/tests/e2e/content-intake-query.spec.ts)
- [ ] **Windows 验收。** 在与 W0 对应的安装配置重放首查与恢复动作。记录资格请求次数、快照页数和首个结果，额外自动重试或重复获取整套快照须能解释；缺现场对照时只登记合成验证结果。

## W3 · 修复 × 的点击命中

- [ ] **链路与调整。** 当前独立与统一 SOP 表单均把 × 放在启用指针捕获的标题内。上一轮 Chromium 最小实验中，标题捕获时 click 落在 HEADER，对照组落在 BUTTON。先在 Windows 鼠标与键盘上对照标题、按钮、preload、Main 的 close。若命中问题成立，在标题组件划清拖动区和操作区，复核所有共享该拖动行为的窗口。[拖动处理](../../apps/desktop/src/renderer/lib/use-window-drag.ts) · [独立视图](../../apps/desktop/src/renderer/SopQueryView.tsx) · [统一视图](../../apps/desktop/src/renderer/SopUnifiedView.tsx) · [关闭入口](../../apps/desktop/src/main/sop-window-ipc.ts)
- [ ] **验收。** 本卡沿用当前「× 收起、保留进度」语义。Windows 点 × 一次只触发一次收起；键盘激活也能收起；拖动标题只移动窗口。重开后步骤保留。W4 单独处理结束办理的产品语义。

## W4 · 同一模板可开两次，分别命名和结束

- [ ] **产品取舍。** 推荐每次办理独占一个窗口，以流程标题为默认名，支持会话内改名。单窗多标签也能保存多份进度，但两单无法并排。建议明确区分右上角 × 结束本单与 Esc／折叠保留进度；有进度时提示结束后果。该决定会改变现行设计，实施前确认并同步维护源。[现行交互](../../DESIGN.md) · [桌面合同](../reference-desktop-contracts.md)
- [ ] **链路与调整。** 针对 W0 确定支持的 SOP 模式，Main 按办理实例绑定窗口、会话、步骤、发布版本、复制及续用句柄。核对既有单窗、单 active、新查询结束旧 active 和失效广播四处假设。狐狸右键由 Main 原生菜单列出可恢复的实例；能力未启用时隐藏，无进行中实例时给出从查询开始的路径。每个 SOP 主帧仅能操作自己的实例。[窗口控制器](../../apps/desktop/src/main/sop-window-controller.ts) · [统一运行时](../../apps/desktop/src/main/sop-unified-runtime.ts) · [原生菜单](../../apps/desktop/src/main/desktop-menu-model.ts)
- [ ] **验收。** 用同一模板主动打开两次，命名 A/B，各推进一步。结束 A 后从狐狸右键恢复 B 并复制其当前步骤。服务端结束回执丢失时按原请求恢复。登出后旧内容失效。检查一次结束只影响一个实例，结束后其窗口和订阅被回收。[续用与结束验证](../how-to-verify-sop-continuation.md)

## W5 · FAQ 自动匹配，点击后才打开 SOP

- [ ] **先定接口。** FAQ 继续读取授权快照。SOP 复用同次问句及 Main 持有的店铺、商品、场景。比较两种做法：既有按组接口逐组查询，需要合并跨组歧义与多份查询证明；由服务端匹配所有者返回跨组候选，可统一歧义判定。推荐后者。先验证现有自动路由能否同时给出 FAQ 和 SOP 并保留首开证明；需要扩展合同时，按项目流程冻结再接入。[既有匹配器](../../apps/api/src/sop-unified-query-context.ts) · [自动路由](../../apps/api/src/query/query-coordinator.ts) · [桌面服务端口](../../apps/desktop/src/main/sop-unified-port.ts)
- [ ] **打通坐席入口。** Query 展示可进入的流程名称。Main 持有候选证明与短期句柄，点击后重新确认并打开 W4 的实例。新问句只撤销旧候选。独立 v1 的上下文失效与统一续用语义分别核对。SOP 超时仍可展示有效 FAQ。[Query 入口](../../apps/desktop/src/renderer/features/search/SopQueryEntry.tsx) · [SOP 工作流](../../apps/desktop/src/main/sop-unified-runtime.ts)
- [ ] **验收。** 用仅 FAQ、仅 SOP、两者命中、歧义、换店、撤权与迟到响应做对照。未点击时首开次数为零；同一候选双击只开一个实例；下一题不关上一单。人为延迟 SOP 响应，FAQ 可先呈现。Windows 安装包上的实际操作只有一次输入与一次主动进入。[正常后端电子窗用例](../../apps/desktop/tests/e2e/sop-v12-normal.spec.ts)

## W6 · Query 与 SOP 都能自由缩放

- [ ] **链路与调整。** 对照系统原生缩放和既有窄 IPC 手柄，在透明窗口、焦点和狐狸交接都成立的前提下选接口更小的方案。Query 的现有手柄只改高度；共享几何及 SOP 内容高度回报仍会写入固定宽度。Main 拥有最终 bounds，renderer 负责内容换行与滚动。用户拖过后以手动尺寸为准，跨步骤布局 ACK 遵守这一选择。[Query 手柄](../../apps/desktop/src/renderer/features/search/QueryResizeGrip.tsx) · [Query 布局](../../apps/desktop/src/shared/query-layout.ts) · [SOP 几何](../../apps/desktop/src/shared/sop-geometry.ts)
- [ ] **验收。** Windows 分别拖两个窗口的四边和四角，宽高不锁比例，尺寸受内容最低可用范围和工作区约束。查询出结果、复制后收起再展开、SOP 换步骤时都不跳回原宽。记录拖动结束的 bounds 与下一次布局确认后的 bounds；无工作区变化时意外回写一次即失败。运行 float 及受影响的 Electron 交接测试。[分层验证](../how-to-verify-desktop.md)

## W7 · SOP 左侧居中，贴边后可恢复原步骤

- [ ] **链路与调整。** Main 从 Query 所在显示器取工作区，首次靠左垂直居中。展开、折叠标题、贴边书签按实例管理。空闲离开可折叠；拖至边缘保留名称，悬停或点击恢复。输入、拖动或鼠标移入正文期间保持展开。复用 W6 的展开尺寸。[显示器选择](../../apps/desktop/src/main/main.ts) · [SOP 放置](../../apps/desktop/src/shared/sop-geometry.ts) · [窗口生命周期](../../apps/desktop/src/main/sop-window-controller.ts)
- [ ] **验收。** Windows 双屏不同缩放、任务栏占边时，首开在所选屏幕工作区左侧中央。把两个命名流程停成书签，分别恢复到原步骤和手动尺寸。移除显示器后仍能找回。鼠标从书签移入正文只应展开一次，不能循环收起。

## W8 · 在同一个 Windows 安装包验收

- [ ] 记录候选提交、Windows 安装资产的 SHA-256、构建标识、实际 profile 和合成输入。按各卡影响面复用已通过的组件、Electron、API 和 PG 证据；公共合同、权限或跨模块变更按仓库规则跑全套检查。打包检查和设备验收分别记录。[验证范围](../../AGENTS.md) · [打包与签名](../reference-packaging-and-signing.md)
- [ ] 通过正常安装入口操作：未登录提交、登录、一次 FAQ 命中、主动进入 SOP、另开同模板、分别命名、缩放、贴边、从狐狸恢复、结束其中一单、退出账号。再用无查询授权的合成会话验证拒绝路径。把每个失败定位到对应卡，记录版本、输入、预期、实见与证据位置。
- [ ] 产品复核 Windows 实际交互。分别登记「代码检查通过」「合成链路通过」「Windows 安装包人工验收通过」。现场首查的结论沿用 W0/W2 证据。
