# Windows 客服前端调整任务卡

> **状态：APPROVED · 本地合成实施。** 2026-11-19。用户要求推进剩余任务卡，授权本地实现和验证。现场诊断、合同冻结及 Windows 实机验收沿用各自门禁。需求来自《客服前端调整》《客服 agent 微调》和 Windows 截图。排查基线为 `main@49f00e90`。

坐席登录后回到原问句。一次查询显示 FAQ 和 SOP 候选。坐席主动进入流程，可命名、并行办理、缩放和贴边暂放。

W10–W17 的设计、实测和待办见文末。

## 推进顺序

按下表依赖推进本地代码和验证。W0 现场证据缺口只影响依赖现场配置的事项。W8 需要获准的候选包和 Windows 设备。[实施输入](../../PROJECT_CHARTER.md#2-本仓的权威顺序) · [阶段条件](../reference-engineering-workflow.md#2-固定阶段与退出条件)

| 卡 | 可独立验收的结果 | 依赖 | 当前状态 |
| --- | --- | --- | --- |
| W0 | 绑定现场包、配置与首查失败点 | 无 | 反馈时段运行 765adfeb，待查首个失败请求 |
| W1 | 登录后回到原问句 | 无 | Windows 登录、取消和回焦通过 |
| W2 | 首查可用，失败可恢复 | W0 定因 | 0.3.44 合成首查通过，旧现场失败请求待查 |
| W3 | × 可点，标题可拖 | 无 | Windows 点 × 收起和恢复原勾选通过 |
| W4 | 并行办理、命名、结束与恢复 | W3 | Windows 并行、改名、结束与退出通过 |
| W5 | 同一问句展示授权 SOP 候选 | 版本化候选合同、W2 资格、W4 实例 | Windows 合成首查、主动打开与组内歧义通过 |
| W6 | Query 和 SOP 缩放后保持尺寸 | SOP 部分依赖 W4 | 查询窗左边拖动修复在 Windows 单屏候选通过 |
| W7 | 左侧首开和实例书签恢复 | W4、W6 | Windows 单屏候选通过首开居中和书签恢复 |
| W8 | 同一安装包贯通操作 | W1 至 W7 | Windows 单屏候选通过，正式换包待验 |
| W9 | 查询拖动、自动尺寸与双端界面复评 | W5、W6、W7 | 本地实现与双端候选复评 |

W1、W3 独立验证。W2 的恢复动作在 W1 后接入 `QueryApp`，再交给 W6 的 Query 缩放。W6 的 SOP 部分接续 W4 的窗口所有权，完成后进入 W7。共享模块或 IPC 由一个工作单元写入，交接记录提交、入口、测试和阻塞。

三路并行。W0/W2 沿现场构建定位首个失败请求。W8 用固定包和合成配置在 Windows 验收 W1 至 W7。2026-11-20 用户确认本轮按单屏收尾。W6 独立跟踪 macOS 收起焦点。[产品 PR #224](https://github.com/tyuanww/customer-agent-prototype/pull/224)

[计划基线 CI · 91f404c1](https://github.com/tyuanww/customer-agent-prototype/actions/runs/44501918151) · [产品候选首轮 CI · 20c55ee9](https://github.com/tyuanww/customer-agent-prototype/actions/runs/44667250735)

## W0 · 找到 Windows 首查的第一个失败点

- [x] Windows 截图显示已登录、已选店、SOP 入口，以及「查询未完成／请刷新店铺」。
- [x] 公开发行版 `v0.3.42@1ca737ee` 的 Windows 安装包 SHA-256 为 `a9fea640460e4056df3a7cd9daa36a783b19953bdc92e101376457d931f81130`，早于添加 SOP 按钮的 `00cec500`。[发布记录](https://github.com/tyuanww/customer-agent-prototype/releases/tag/v0.3.42)
- [x] **现场构建。** 四份安装的 `resources/build-identity.json` 分别对应普通版 `0.3.41@c9ee2240` 和三个 `0.3.43` 试点构建 `c6cf544b`、`540c16f2`、`765adfeb`。
- [x] **反馈时段。** 11 月 19 日备忘录编辑于 15:31–15:48（UTC+8）。Windows 客服 EXE 启动记录中的路径指向 `765adfeb`，15:33:57、15:36:40、15:40:23 均有执行。以其包内提交 `765adfeb529a2f3e915b48551c78a81788f249bf` 复现；原下载 EXE 的 SHA-256 未取得。
- [ ] **定位首个失败。** 核对当时生效的 profile、SOP 模式和授权。沿同一请求查选店、资格、快照分页及本地检索，用最早的脱敏 code/reason 确定 W2 归属。[查询权限](../how-to-check-roster-permission.md)

## W1 · 登录后回到原问句

- [x] **合成复现。** 在 macOS Electron 输入问句后点查询或按 Enter，均未创建登录窗，也未发送登录请求。显式登录保留问句。后台发现店铺后 Query 进入 `RESULTS`。[复现入口](../../apps/desktop/tests/e2e/content-intake-query.spec.ts)
- [x] **改动。** 按钮和回车共用 `runSearch`。未登录提交复用现有独立登录窗。成功后提示一次、保留问句并恢复焦点。读店保持精简搜索框，单店自动选，多店在提交确需选店时打开筛选。[提交与会话](../../apps/desktop/src/renderer/QueryApp.tsx)
- [x] **本地回归。** 旧构建点击查询等待登录窗超时，修复后 Electron 用例通过，确认只发一次登录请求、后台读店后仍保持精简窗。工作台和登录窗口原有测试通过。[Query E2E](../../apps/desktop/tests/e2e/content-intake-query.spec.ts)
- [ ] **设备验收。** 在 W8 核对按钮、Enter、连点、取消及恢复会话。工作台入口保持可用，无查询权账号能登录并在查询时看到原因。

## W2 · 有授权的首次 FAQ 查询可用

- [x] **合成对照。** 在 macOS Electron 用同店同问句。更改资格的 `contextGeneration` 后无快照请求。更改快照的 `releaseId` 后有一次快照请求。两次均显示「查询未完成／请刷新店铺」。恢复响应后点「重试」，均重新获取资格和快照并返回话术。[对照入口](../../apps/desktop/tests/e2e/content-intake-query.spec.ts)
- [x] **与现场版本对照。** `765adfeb` 至合成复现基线 `91f404c1` 的 Main 查询、资格、快照、店铺发现和结果页代码相同。`QueryApp` 差异限于快捷键提示。现有对照可解释相同文案，现场首个失败请求尚待核验。[结果页](../../apps/desktop/src/renderer/features/search/QueryResultsPane.tsx)
- [ ] **按 W0 定因。** 资格失败查服务端范围和 Main 绑定，资格通过后查完整分页及关联字段。现有 `FORBIDDEN` 提示的「刷新店铺」直接走店铺发现。常规重试继续提交原问句。保留授权和分页校验。[资格与快照](../../apps/desktop/src/main/content-intake-usage.ts) · [结果页](../../apps/desktop/src/renderer/features/search/QueryResultsPane.tsx)
- [ ] **验收。** 有效授权与已发布 FAQ 首查即命中。无 grant、过期、无命中、读失败分别可辨，撤权使旧复制句柄失效。用现场对应配置重放，记录资格请求次数、快照页数和首个结果，核对重复请求。

## W3 · 修复 × 的点击命中

- [x] **macOS Electron 复现。** 独立 v1、统一 v11 均观察到 `pointerdown` 命中按钮，标题栏捕获后 `click` 落在标题。Main 的窗口仍可见。键盘 Enter 能收起，证明现有关闭链路可达。[拖动处理](../../apps/desktop/src/renderer/lib/use-window-drag.ts) · [关闭入口](../../apps/desktop/src/main/sop-window-ipc.ts)
- [x] **改动与本地回归。** 四个 SOP 标题栏的 × 独立于拖动命中层。独立 v1 和统一 v11 的 Electron 用例在旧构建上未收起，在修复构建上可收起且重开保留进度。标题栏拖动仍移动窗口。[独立视图](../../apps/desktop/src/renderer/SopQueryView.tsx) · [统一视图](../../apps/desktop/src/renderer/SopUnifiedView.tsx)
- [x] **交接验证。** Query 视觉切换只取消 FAQ 请求，保留 v1 的独立 SOP。实际搜索、选店、筛选和查询取消仍使旧 v1 失效。最终构建通过 FAQ、SOP v1 和 SOP v11 的 Electron 回归。[Query IPC](../../apps/desktop/src/main/content-intake-query-ipc.ts)
- [ ] **设备验收。** Windows 点 × 或按 Enter 只收起一次，重开保留步骤，拖动标题仅移动窗。

## W4 · 同一模板可开两次，分别命名和结束

- [x] **本地取舍。** 合成 v12 每单一窗，默认显示流程标题，可改名。延续现行 × 和 Esc 收起，结束用明确操作。单窗多标签无法并排办理。[现行设计](../../DESIGN.md) · [桌面合同](../reference-desktop-contracts.md)
- [x] **实例归属。** 合成 v12 新增 Main 实例注册表。每窗独立持有步骤、版本、复制和续用句柄，命令按自身主帧路由。登出撤销全部实例。狐狸右键提供可恢复实例。资格变化时撤掉原菜单和书签名称。[窗口注册表](../../apps/desktop/src/main/sop-instance-windows.ts) · [原生菜单](../../apps/desktop/src/main/desktop-shell.ts)
- [x] **本地回归。** Electron 和隔离 PG15 通过并行办理、流程拒绝和登出三个用例。A 结束回执丢失后按原请求确认，B 可从狐狸恢复并复制。退出时核对两条续用记录关闭。[v12 Electron 用例](../../apps/desktop/tests/e2e/sop-v12-normal.spec.ts)

## W5 · FAQ 自动匹配，点击后才打开 SOP

- [x] **接口现状。** `QueryCoordinator` 的 `auto` 在 FAQ 和 SOP 中择一。现有 SOP 匹配按 `sop_group`。统一 runtime 消费就绪结果后立即授权 `open`。服务端现有测试已验证路由择一和组内匹配。[自动路由](../../apps/api/src/query/query-coordinator.ts) · [匹配器](../../apps/api/src/sop-unified-query-context.ts) · [首开链路](../../apps/desktop/src/main/sop-unified-runtime.ts)
- [x] **合同评审包。** 基于现行 v12，生成 W5 的 OpenAPI 1.31.0/schema 1.36 本地评审包。发现只返回名称和句柄，选中签发 C 供 D 首开。接口、存储和合成导出验证通过。
- [x] **首开验证。** 隔离 PG15 的 HTTP 预演通过发现、原 E 选中及 v12 首开。换 E 拒绝，C 丢回执可重放。
- [x] **组内歧义。** 用户确认任一组有歧义就隐藏本次全部 SOP 候选，FAQ 独立呈现。实际匹配器原型和隔离存储约束通过。
- [x] **合同冻结。** 治理仓 `6124b4cc4e29` 已导出并核验 W5 合同。
- [x] **产品接入。** 产品仓校验并消费冻结集 `cs-ai-c11-openapi-1.31.0-schema-1.36-6124b4cc4e29`。API 在显式合成配置中发现、选中，Main 保管原资格和服务端引用，Query 展示名称和本地点击句柄。两条新路径使用 W5 合同头，资格及首开沿用 v12。[模块归属](../reference-project-architecture.md#sop-pipeline-source-and-release-projection)
- [x] **本机合成联验。** macOS Electron、Fastify 与 PG15 贯通仅 FAQ、仅 SOP、同时命中和均无命中。两个组各有一条可选，首次查询零选中和首开；连点和丢失 C/D 回执后的重试只开一单。下一题保留已勾选步骤，组内歧义时仍有 FAQ。仅 SOP 命中时提示选择流程，均无结果才提示升级。窗口加载中资格到期会立即释放空窗。首开回执未知仍可恢复。定向用例覆盖换店、迟到、撤权与超时保留 FAQ 复制。[原生联验](../../apps/desktop/tests/e2e/sop-candidates-real-stack.spec.ts) · [Main 边界](../../apps/desktop/tests/unit/sop-candidate-query.test.ts)
- [x] **0.3.44 审核回归。** 同轮两个候选中，一个缺少材料或版本已变时，原 FAQ 保留，另一单可直接打开。会话在事务开始前失效返回 401，事务超时可重试。[原生联验](../../apps/desktop/tests/e2e/sop-candidates-real-stack.spec.ts) · [HTTP 与 PG15](../../apps/api/tests/sop-unified-query.integration.test.ts)
- [x] **Windows 单屏。** W8 已核对一次输入、主动首开和并行办理。[验收入口](../how-to-verify-desktop.md#w5-候选与安装包联验)

## W6 · Query 与 SOP 都能自由缩放

- [x] **本地实现。** 透明窗保留 `resizable: false`。Main 从自身手势起点应用方向和相对位移，保存并裁剪手动尺寸。布局 ACK 回传实际宽高，renderer 换行与滚动。同一轮结果保留手动尺寸。下一轮查询恢复自动布局，见 W9。[Electron 透明窗约束](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations) · [Query 布局](../../apps/desktop/src/shared/query-layout.ts) · [SOP 窗口](../../apps/desktop/src/main/sop-window-controller.ts)
- [ ] **验收。** 两窗能拖四边四角，宽高独立，受最小可用尺寸和工作区约束。比较松手与出结果、复制后重开、换步骤后的 bounds。按各窗口的尺寸规则验收。跑 float 和受影响的 Electron 交接测试。[分层验证](../how-to-verify-desktop.md)
- [x] **专项。** Float、Query 缩放及 v1 SOP 保宽通过。Main 复核重开的原生焦点，真实失焦仍可收起。
- [ ] **macOS 焦点。** 85 次 Electron 试验中，现行收起对照 5/5 归还键盘、5/5 采到双窗离屏；仅 deactivate 时 0/15 归还。追加两应用对照中，以 AppKit 激活开窗前捕获的应用，5/5 归还键盘，采样期间 Fox 保持可见、Dock 身份保留。接入前仍需验证真实 Fox 点击、快捷键、快速重开与原生模块打包签名。[平台交接](../../apps/desktop/src/main/overlay-platform.ts)

## W7 · SOP 左侧居中，贴边后可恢复原步骤

- [x] **本地实现。** v12 首开优先定位到 Query 所在工作区的左侧中央，可贴边暂放。Electron 已验证两个书签占不同位置，只显示名称，悬停和点击分别恢复实例的步骤与原展开尺寸。[放置函数](../../apps/desktop/src/shared/sop-geometry.ts) · [v12 Electron 用例](../../apps/desktop/tests/e2e/sop-v12-normal.spec.ts)
- [x] **Windows 单屏。** 首开内容居中，两单分别贴边。悬停或点击书签后，原窗口恢复步骤和尺寸。

## W8 · 在同一个 Windows 安装包验收

本轮验收版本为 **0.3.44**。用主线合并提交生成 Windows x64 工程包，以 EXE 的 SHA-256 和包内 `build-identity.json` 核对设备上的构建。下列 0.3.43 记录用于追溯上一轮验证。

- [x] 已构建含 W5 的 Windows x64 未签名工程包 0.3.43。直接从 NSIS 安装程序提取 app.asar，核对 Main、四个 preload 和 renderer 等 14 个构建文件，内容逐字节一致。EXE SHA-256 为 `1ccc50ca35cf3d57ed677f5de1d0f229189d208fec04e43ef0b0678f30e80972`。包内 `build-identity.json` 记录产品提交 `07949f09392bac168eefcde2b3a77c5b6a0fb38c`。
- [x] **合成账号。** [CLI 回归](../../scripts/intake-synthetic/cli.test.ts)以 HTTP 登录确认两种身份，非法值在创建资源前退出。另在本地 PG15 实测：`agent` 有合成店铺查询资格；`roster-nogrant` 登录成功，v12 授权返回 403，`/v1/auth/job` 返回 `actions.query: false`。[同包验收步骤](../how-to-verify-desktop.md#w5-候选与安装包联验)
- [x] **设备和版本。** 2026-11-20 在试点 Windows 测试机安装 `0.3.44 · b8c4a8f`。下载的 EXE SHA-256 为 `9bbe2b3a7b366c1eae316fdedb15f00c0fb6dffee932f46e10084d1fcf3f5e0c`。Windows 10 19045，单屏 1920×1080，缩放 100%，任务栏在底部。Windows 可访问 WSL 基于回环的业务和身份服务。
- [x] **登录与查询。** 人工在未登录时提交，登录后原问句保留，首查同时显示 FAQ 和 SOP 候选。Electron 安装包联验确认焦点恢复，查询按钮连点只开一个登录窗，取消保留问句。无查询权坐席可登录，查询显示拒绝提示。任一组内有歧义时隐藏所有 SOP 候选，FAQ 仍可复制。
- [x] **并行办理与退出。** 人工点击候选、勾选和收起。Electron 安装包联验确认恢复后勾选保留。同模板的两笔办理可分别改名、推进和结束，退出使旧 SOP 窗口与复制入口失效。SOP 缩窄后换步骤仍保持尺寸，两张书签分别恢复原尺寸和进度。
- [x] **窗口缺陷复测。** 查询窗外壳横移遮住左侧缩放区。SOP 首次内容撑高后偏离中心。书签请求高 32，Windows 实际用 39，点击区域相交 1 像素。三项修复见下项单屏实测。
- [x] **单屏窗口候选。** 同一未签名工程包的解包应用在隔离配置中通过复测。查询窗四边四角可命中，左拉后松手和再次查询均保留宽度。SOP 首开内容居中，两张书签间隔 6 像素，分别恢复原尺寸与步骤。应用与 `app.asar` 在 Mac 与 Windows 的 SHA-256 一致。候选构建标识为 `dirty`，安装器 SHA-256 为 `e27699f52999563be75e695b40f87b776821725058186f3fe7025dfd298b66fa`。

## W9 · 查询与 SOP 的操作及双端复评

- Query 复用原生窗口移动。验收狐狸头、空白区、控件与缩放边角。松手时先失去鼠标捕获，保留最后一次拖动的尺寸。
- Main 在新一轮查询开始时恢复自动尺寸。登录失效收回输入条，筛选过期保留刷新入口。
- 查询优先显示首条话术。SOP 优先显示当前步骤，底部固定下一步。
- 同源候选在 macOS 和 Windows 单屏验证，沿用上轮评分权重。两端连续拖动与两轮缩放通过。新查询、短提示和会话到期分别得到 600×620、600×254 和 600×88。SOP 下一步可见，勾选及书签恢复通过。

## 双端界面工单 · 2026-11-20

以 W9 候选为基线。W10 定稿后 W11、W12 并行，各带测试。W13 合验，一人汇总设计文档。

### W10 · 基线、样机与设计规则

- [x] 可点击样机提供 W9 对照布局、W10 候选及 W9 实机参考截图。两版使用「合成入口」和同一组资料，各自动走两次。第一条复制按钮距窗顶均为 172 CSS 像素，第二条从 418 移至 293。指定 SOP 的位置从 324 移至 541，仍可直接点开。两版走完三项任务均有 5 次窗内操作、0 次滚动。坐标来自浏览器对照，未量测人的查找速度。
- [x] 用户选定保留 W10 的 SOP 布局，并要求再调查询窗流程入口。W12 可独立实施。
- [x] 用户选定匹配流程靠近查询条。样机将入口从窗底移至查询条下方，指定按钮距窗顶从 541 降到 84 CSS 像素，首条和第二条复制按钮各下移 44。话术保持连续，匹配流程仍一次点开。右侧入口稿归档。最终样机与逐次记录在本机 `~/.codex/visualizations/2026/11/20/customer-agent-query-bar.e3gvk5OP/`。
- [x] 已在 [DESIGN.md](../../DESIGN.md) 区分 FAQ 与旧卡片字段、隐藏入口与禁用动作，并将作废规则归档到固定提交。W10 布局以此卡记录。

本机设计证据位于 `~/.codex/visualizations/2026/11/20/customer-agent-w10.YK8sCuJg/`。打开 `index.html` 试用，逐次记录见 `observation.json`。两版均使用样机内剪贴板。

### W11 · 查询与恢复

- [x] 匹配流程紧跟查询条，筛选在其下方，三条 FAQ 连续。真实 Query renderer 在 600 和 360 CSS 像素宽时，流程行与查询条下沿间距均为 1 像素。窄窗长名称换行，查流程时可复制第二条，结果为空时移除整行。
- [x] 空白和 501 个 Unicode 码点就地提示，500 个可查询。临时失败可重试，店铺资格过期可刷新，登录失效收回并留问句。W11 定向组件与单元检查共 165 项通过。

### W12 · SOP 当前步骤

- [x] `SopUnifiedView` 将必需图片和未勾项靠近当前动作，补充知识可折叠。按已有资格启用下一步，缺项可定位。
- [x] 20 项 SOP 组件检查通过。macOS 原生办理检查确认 3 张必需图片解码、缺项和推进状态同步、资料可折叠、缩窄后仍可操作，以及从书签恢复同一窗口、尺寸、步骤与勾选。

### W13 · 单屏双端验收

- [x] 工程候选 0.3.44，以 `b8c4a8f3` 工作树构建。macOS 工程 .app 与 Windows 安装器内同源的 Main、preload 与界面共 14 个运行文件哈希一致。Windows 安装器 SHA-256 为 `1e0bf36abac9e95892cb368d1e6ebdb9389814b1d8483ce26d15a9c029a816d4`，包内提交标识 `dirty`。单屏真机上匹配行都在查询条下方 1 逻辑像素，流程按钮 y=98。点击一次只打开所选 SOP，第二条可复制原文。
- macOS 工程包 18 项通过。首次合成登录后选店等待超时，复跑正常。Windows 在试点 Windows 测试机隔离目录通过 12 组检查，载荷与 NSIS 逐字节相同。两端同题 600×577、过期收为 600×88，SOP 暂放均保留步骤及尺寸。
- [ ] 新 NSIS 向导实装待有一次性 Windows 环境时核对。现有办公机保留上一轮安装。同态截图和复评分见本机 `~/.codex/visualizations/2026/11/20/customer-agent-query-bar.e3gvk5OP/acceptance.html`。

### W14 · 主管工作台另排

- [x] 在 macOS Electron、回环服务和隔离 PG15 上走访一个待确认来源批次。合成主体岗位为主管，通用产品会话显示「管理员」。从已登录首页计，0 次点击可找到批次，1 次可见「核对材料」，2 次进入详情，3 次读取材料列表，第 4 次可展开一条原文。未提交审核或发布，尚无主管本人观察。
- 调研建议限于首页表格增加批次直达入口和下一步，保留资料审核明细表。默认筛选按状态筛选资料，建议写「待处理」。在来源表单区分材料已读取与人工已核对。证据见本机 `~/.codex/visualizations/2026/11/20/customer-agent-w14-study/README.md`。

### W15–W17 · 办理流程与查询范围

W13 样机重复列出匹配名单。工程的手动入口另开店铺、流程组和问题表单。组内歧义沿用 W5。

| 工单 | 负责人和依赖 | 交付与验收 |
| --- | --- | --- |
| W15 可编辑画板 | 设计，依赖 W13 | 浏览器点通同题的 1/3/0 个匹配、手动另店办理、第二条复制和改范围后重查得两个具名流程。 |
| W16 查询窗 | Query renderer，按 W15 的动作分工实施 | 已接入真实查询窗。1–2 个具名直达，3–5 个展开再选。已登录且可办理才显示手动入口。改范围清旧结果、留问句，折叠可读已选值，资格到期可刷新。 |
| W17 单屏联验 | 双端并行准备，W16 冻结后运行 | 两端各通过 9 组原生检查，留 12 张稳定截图。首行按钮完整可见。单屏内操作，同源 app.asar 前缀 `ffeba3d1b41f`。0/2/3 来自合成服务；3 项只打开所选一笔，5 项由界面投影验证。 |

设计画板和实点记录分别在本机 `~/.codex/visualizations/2026/11/20/customer-agent-w15-flow-canvas/` 与同级 `customer-agent-w15-flow-evidence/checks.json`。两端对照、评分和限制见同级 `customer-agent-w17-native/acceptance.html`。
