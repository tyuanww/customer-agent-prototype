# Windows 客服前端调整任务卡

> **状态：APPROVED · 本地合成实施。** 2026-11-19。用户要求推进剩余任务卡，授权本地实现和验证。现场诊断、合同冻结及 Windows 实机验收沿用各自门禁。需求来自《客服前端调整》《客服 agent 微调》和 Windows 截图。排查基线为 `main@49f00e90`。

坐席登录后回到原问句。一次查询显示 FAQ 和 SOP 候选。坐席主动进入流程，可命名、并行办理、缩放和贴边暂放。

## 推进顺序

按下表依赖推进本地代码和验证。W0 现场证据缺口只影响依赖现场配置的事项。W8 需要获准的候选包和 Windows 设备。[实施输入](../../PROJECT_CHARTER.md#2-本仓的权威顺序) · [阶段条件](../reference-engineering-workflow.md#2-固定阶段与退出条件)

| 卡 | 可独立验收的结果 | 依赖 | 当前状态 |
| --- | --- | --- | --- |
| W0 | 绑定现场包、配置与首查失败点 | 无 | 反馈时段运行 765adfeb，待查首个失败请求 |
| W1 | 登录后回到原问句 | 无 | 本地实现，Electron 回归通过 |
| W2 | 首查可用，失败可恢复 | W0 定因 | 本地已验证刷新和再次查询，现场待定 |
| W3 | × 可点，标题可拖 | 无 | 本地实现，独立 v1 和统一 v11 回归通过 |
| W4 | 并行办理、命名、结束与恢复 | W3 | 合成 v12 已实现，Electron 与 PG15 通过 |
| W5 | 同一问句展示授权 SOP 候选 | 版本化候选合同、W2 资格、W4 实例 | 本机合成链通过，Windows 实机待验 |
| W6 | Query 和 SOP 缩放后保持尺寸 | SOP 部分依赖 W4 | 缩放本地通过；焦点交接和 Windows DPI 待验 |
| W7 | 左侧首开和实例书签恢复 | W4、W6 | 本地双书签通过，Windows 多屏待验 |
| W8 | 同一安装包贯通操作 | W1 至 W7 | 工程包结构通过，待实机 |

W1、W3 独立验证。W2 的恢复动作在 W1 后接入 `QueryApp`，再交给 W6 的 Query 缩放。W6 的 SOP 部分接续 W4 的窗口所有权，完成后进入 W7。共享模块或 IPC 由一个工作单元写入，交接记录提交、入口、测试和阻塞。

三路并行。W0/W2 沿现场构建定位首个失败请求。W8 用固定包和合成配置在 Windows 串行验收 W1 至 W7，覆盖双屏、任务栏和不同 DPI。W6 独立跟踪 macOS 收起焦点。[草稿 PR #224](https://github.com/tyuanww/customer-agent-prototype/pull/224)

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
- [x] **本机合成联验。** macOS Electron、Fastify 与 PG15 贯通仅 FAQ、仅 SOP、同时命中和均无命中。两个组各有一条可选，首次查询零选中和首开；连点和丢失 C/D 回执后的重试只开一单。下一题保留已勾选步骤，组内歧义时仍有 FAQ。仅 SOP 命中时提示选择流程，均无结果才提示升级。窗口加载中资格到期，关闭会释放该窗口；首开回执未知仍可恢复。定向用例覆盖换店、迟到、撤权与超时保留 FAQ 复制。[原生联验](../../apps/desktop/tests/e2e/sop-candidates-real-stack.spec.ts) · [Main 边界](../../apps/desktop/tests/unit/sop-candidate-query.test.ts)
- [ ] **Windows 实机。** 以 W8 同一安装包核对一次输入、主动首开和并行办理。[验收入口](../how-to-verify-desktop.md#w5-候选与安装包联验)

## W6 · Query 与 SOP 都能自由缩放

- [x] **本地实现。** 透明窗保留 `resizable: false`。Main 从自身手势起点应用方向和相对位移，保存并裁剪手动尺寸。布局 ACK 回传实际宽高，renderer 换行与滚动。Query 复制后重开再查询恢复手动尺寸的 Electron 用例通过。[Electron 透明窗约束](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations) · [Query 布局](../../apps/desktop/src/shared/query-layout.ts) · [SOP 窗口](../../apps/desktop/src/main/sop-window-controller.ts)
- [ ] **验收。** 两窗能拖四边四角，宽高独立，受最小可用尺寸和工作区约束。比较松手与出结果、复制后重开、换步骤后的 bounds。工作区未变时保持手动尺寸。跑 float 和受影响的 Electron 交接测试。[分层验证](../how-to-verify-desktop.md)
- [x] **专项。** Float、Query 缩放及 v1 SOP 保宽通过。Main 复核重开的原生焦点，真实失焦仍可收起。
- [ ] **macOS 焦点。** 85 次 Electron 试验中，现行收起对照 5/5 归还键盘、5/5 采到双窗离屏；仅 deactivate 时 0/15 归还。追加两应用对照中，以 AppKit 激活开窗前捕获的应用，5/5 归还键盘，采样期间 Fox 保持可见、Dock 身份保留。接入前仍需验证真实 Fox 点击、快捷键、快速重开与原生模块打包签名。[平台交接](../../apps/desktop/src/main/overlay-platform.ts)

## W7 · SOP 左侧居中，贴边后可恢复原步骤

- [x] **本地实现。** v12 首开优先定位到 Query 所在工作区的左侧中央，可贴边暂放。Electron 已验证两个书签占不同位置，只显示名称，悬停和点击分别恢复实例的步骤与原展开尺寸。[放置函数](../../apps/desktop/src/shared/sop-geometry.ts) · [v12 Electron 用例](../../apps/desktop/tests/e2e/sop-v12-normal.spec.ts)
- [ ] **验收。** Windows 双屏不同缩放及任务栏占边时核对首开。两单分别贴边并恢复原步骤和尺寸。拔掉副屏后仍找得到书签。鼠标从书签进入正文只展开一次。

## W8 · 在同一个 Windows 安装包验收

- [x] 已构建含 W5 的 Windows x64 未签名工程包 0.3.43。直接从 NSIS 安装程序提取 app.asar，核对 Main、四个 preload 和 renderer 等 14 个构建文件，内容逐字节一致。EXE SHA-256 为 `1ccc50ca35cf3d57ed677f5de1d0f229189d208fec04e43ef0b0678f30e80972`。包内 `build-identity.json` 记录产品提交 `07949f09392bac168eefcde2b3a77c5b6a0fb38c`。
- [x] **合成账号。** [CLI 回归](../../scripts/intake-synthetic/cli.test.ts)以 HTTP 登录确认两种身份，非法值在创建资源前退出。另在本地 PG15 实测：`agent` 有合成店铺查询资格；`roster-nogrant` 登录成功，v12 授权返回 403，`/v1/auth/job` 返回 `actions.query: false`。[同包验收步骤](../how-to-verify-desktop.md#w5-候选与安装包联验)
- [ ] **记录环境。** 核对候选 EXE 与已安装构建标识，记录 Windows 版本、缩放和任务栏位置。在 Windows 预检 WSL 两个回环端口，用两份独立配置测试有权和无权会话。[Windows 与 WSL 联调](../how-to-develop-content-intake.md#p2-独立-apipg-与桌面合成联调)
- [ ] **登录与首查。** 未登录提交，成功后焦点回原问句。首查见 FAQ 和候选；另用无查询权会话验证拒绝。与 W2 对照相应请求阶段。
- [ ] **并行办理与窗口。** 点同模板开两单，命名并推进。缩放后换步，贴边后从狐狸恢复，结束一单后另一单仍可用，登出使旧内容失效。
- [ ] **登记结果。** 每项记任务卡编号、输入、预期、实见和证据位置。分别记录代码检查、合成链路、打包结构和 Windows 人工验收。产品复核设备上的实际交互。
