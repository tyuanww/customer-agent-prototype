# 客服 Agent 当前 v3 原型基线 — 开发与验收任务包

> **仓库身份：** 本仓是客服 Agent 产品实施仓，目标包含正式开发与上线；见 `PROJECT_CHARTER.md`。
> **本文范围：** 只描述当前已经实现的 v3 合成原型基线，不定义整个产品仓的永久上限。正式产品化工作进入 `docs/plans/`，并受 G0 / Ddev、数据、安全和发布门约束。

## 1. 目标与边界

在本仓完成一个可运行、可测试、可视觉验收的 Electron 桌面 Demo，验证两条演示表面：

```text
狐狸头 / 全局快捷键
  → 玻璃查询胶囊
  → 本地合成 fixture 检索
  → 返回稳定 Top 3 原文话术（不含过期、不展示匹配分）
  → 坐席人工选择
  → 通过安全 preload IPC 复制
  → 显示「已复制」后收起回狐狸头

查询胶囊 Dashboard 图标 / 狐狸右键 / 系统 Tray 与应用菜单
  → 懒创建标准 Dashboard 窗
  → 浏览交互式合成 BI 与架构故事
  → 不接后端、不写盘、不代发
```

**当前 v3 运行在原型隔离模式，使用 `DEMO · 合成数据`。它不等于 `DEV-M0`、正式接入或上线已经完成；`ai-赋能立项` 只作为项目进度、批准范围和阶段门记录。本仓后续承接正式产品实现，但 Demo 不代发消息。**

v3 只覆盖旧版「本轮不做 Dashboard BI」和「仅双窗口」的范围限制：允许新增一个演示级 Dashboard。它不覆盖安全、合成数据、禁止真后端、禁止自动发送、禁止真实数据和禁止修改正式仓等边界。

Menokin 四域材料已存在于企业受控空间，但尚未授权进入本 Git 合成运行时，因此话术与看板必须保持虚构合成，并持续标注。

## 2. 本次必须完成

### 2.1 桌面浮窗

- Electron + React + TypeScript。
- 两个 overlay `BrowserWindow`：闲置狐狸头 + 查询/结果窗；观感上是同一控件展开。
- 狐狸头窗口约 88px（含动效留白）；查询胶囊约 600×88，原生 `resizable: false`。正常结果路径按 DOM 实测 hug（capsule 88 + banner + result-content + chrome + grip），经 typed query-only layout / 纵向 resize IPC 上报；Main 只接受受信 Query sender、合法枚举 / 0..3 / 有限整数 / 当前 sequence，钳制 `240..min(620, availableHeight)` 后一次 `setBounds` 并 ACK。旧分档 240 / 340 / 430 / 620 只作异常 fallback。不开放 width / x / y / bounds IPC，不用 CSS `resize`。collapse 使用 Main 计算的真实狐狸屏幕中心。小屏只压缩结果区，胶囊 88 不缩。
- **不再使用固定 520×760 普通工作台窗口。**
- 透明、无边框、置顶、跳过任务栏；窗口尺寸贴合可见控件。
- 狐狸没有方形底板。共享透明客服狐狸用于 64px Float / Query 与 18px Tray：有机非对称旧帽子、宽紫帽檐遮眼、下半脸严格 `#F9D6C5`、唯一中央椭圆眼 `#A45C4A` 加短竖线、客服耳麦。禁止对称头盔、白点眼、双侧短弧眼、U 形舌。Dashboard 浅色复用该视觉，深色使用同几何白 / 浅灰耳麦专属 PNG，品牌尺寸固定 40px。耳罩和短麦杆必须进入外轮廓并在各尺寸可辨识。待机 2.8–3.2s、3–4px、约 2°、scale ≤ 1.04。紫色呼吸光晕拆到独立层（约 76px / 84px，opacity `.52–.60→.92–.95`，周期 3.0–3.4s），只动画 opacity；FoxHead 只保留很轻静态 drop-shadow。贴边与非贴边统一紫光，无白 glint、无白点眼、无闭合蓝圆。默认主题键盘焦点只由 `data-fox-keyboard-focus` 显示双耳外侧紫色短弧；pointerdown 同步清除；press / drag / session / settling / handoff 隐藏。贴边重播 420–560ms 方向性吸附；稳定半露时以 `.fox-head` transform 做镜像 inward-ready 动效（内移 3px、上抬 2px、内倾 5°、scale 1.035）；88px 原生窗始终完整留在工作区，由 renderer 做等效 44px 裁切，使 64px 狐狸视觉各露一半。悬停 / 聚焦时以 420ms 镜像动效探头到等效 80px 裁切，离开后以 300ms 反向动效缩回。禁止动画负责裁切的 `.fox-idle` 根节点，禁止把透明窗放到屏外或用循环原生 `setBounds` 做动画。
- 拖拽在 `pointerup`、`pointercancel`、`lostpointercapture`、窗口失焦或 `buttons=0` 时必须立即结束；结束后的移动不得继续改变窗口，也不得触发 click。
- macOS 台前调度若把后台 Fox 限制到 Electron `screen.workArea` 未表达的舞台边界，Main 必须采纳实际 `getBounds()`；peek / retract 只切 renderer crop，不得在 hover 上反复请求理论 x=0。打开 / 关闭 handoff 都从实际 88px frame 计算中心。该模式下交付标准是稳定停在系统接受边界、无 left↔none 与 x0 往返横跳；不承诺 Electron 公共 API 无法保证的物理屏 x=0。
- 闲置狐狸单击打开查询；查询胶囊里的狐狸单击收起查询，拖拽仍只移动。打开 / 收起采用两阶段共享元素交接：隐藏 Query 先按点击瞬间 Fox 的真实屏幕中心、同尺寸 64px 与当前 2D 姿态矩阵准备代理并回执，Main 才交换原生窗可见性、完成 App / BrowserWindow / WebContents 聚焦并启动 CSS；关闭反向等待 renderer 末帧回执。贴边 Query 必须与物理工作区边缘齐平，保持 32px 半露轮廓连续。最终 bounds 每阶段只提交一次，外壳以 `clip-path` 展开约 260ms、收起约 200ms，玻璃只淡入淡出；不得先闪完整面板、双狐狸错位、靠正常路径固定计时猜结束或出现两窗同时不可见。
- 查询胶囊中的狐狸按 `SEARCHING / RESULTS / EMPTY / COPIED` 给出明显但不阻塞操作的原创反馈，业务状态优先于待机动效，并完整支持 reduced motion。Fox idle 另有 renderer-only 三层姿态：structural `handoff > snap > peek > retract > dragging`，transient `none | pressed | dragging | annoyed-drag`，ambient `awake | following-local | drowsy | sleeping`；warning 暂停 ambient。不把 ambient 塞进 OverlayPhase / IPC，不新增 preload。指针只在 88px Fox 窗内做整头局部跟随（≤1.75px / ≤2°，rAF 合帧）；睡眠用 deadline / token，活动 / fox-edge / 打开 / 隐藏即唤醒。约 8s 困倦、14s 睡眠时，只在 Float 为同一中央棕眼叠加逐步闭合表情，并用趴睡 transform、展开的地面影和 inward `Zzz` 表意；不改批准 PNG、Query、Dashboard、Tray 或 Dock。主键按下约 110ms squash，超过既有 4px 后进入拖拽方向反应，同一眼区改为棕色 `><`；长拖后 ≤1.2s 一次性烦躁拖拽。局部跟随或刚唤醒可播放两轮有限耳机声波；睡眠 / 拖拽 / warning / structural pose / handoff / reduced motion 必须停波。现有贴边半露 + peek / retract 即本项目 mini mode。禁止全局鼠标轮询、真实 free-roam、逐帧 setBounds、双击延迟；首击必须立即打开 Query。页面 hidden 时暂停 ambient sleep clock，visible 后 wake 并重新计时。drag-settle IPC 若超时由 generation-guarded watchdog 恢复，旧 ACK 不得覆盖新 drag。整头局部 follow 保留；不得称全局 eye tracking，也不得画白点眼 / 双侧短弧 / 卡通大眼。
- renderer 安全基线：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 只暴露类型化、枚举化的最小 API：复制、平台、窗口上下文、打开/收起、打开 Dashboard、上报 UI 阶段、上报 query layout / 纵向 resize、上报有限 handoff milestone、拖拽位移、订阅 overlay 命令。handoff 回执只接受受信 Query sender、正整数 epoch 与固定枚举，不暴露任意窗口控制。
- 禁止暴露通用 `send/on/invoke`、任意 channel、任意尺寸或文件系统。
- IPC handler 校验 sender 来源；阻止新窗口、外部导航和权限请求。

### 2.2 演示级 Dashboard

- 第三个懒创建的标准系统窗：约 1180×760，最小约 980×680；正常 frame、可缩放、非透明、非置顶、显示在任务栏。macOS 使用 `hiddenInset` 隐藏原生标题文字并保留交通灯，`trafficLightPosition` 为 x14 y16。共享 SSOT：标题栏高度 48px、traffic-light safe zone 0..72、titlebar control island 右缘 120px（仅命中 / no-drag overlay，不是第二条视觉列），macOS integrated collapsed surface / 结构边界 / divider 统一 120px，toggle 占 72..112 且右侧距 divider 8px；Windows / Linux native collapsed surface 仍为 72px。结构列边界由 `--dash-rendered-nav-width` 驱动的 `--dash-structure-boundary`（mac 折叠 120 / native 折叠 72 / 展开为当前合法 nav width / 拖宽预览共用），renderer 经 CSS vars 消费，不开放 preload / IPC。一体 chrome 下 48px 单行标题栏，品牌 / 导航 block offset 48，同一个 PanelLeft 钮固定约 x72 y4 40×40，由侧栏自有透明 island 持有。macOS 四阶段 icon / brand 中心固定 nav.left+60，native 固定 nav.left+36。左侧玻璃与右侧实色 main 顶底连续，分界线单一；macOS 折叠稳态必须是 120，不得再让 72 同时承担 safe zone / toggle / rail / divider 四种职责。Windows / Linux 保持原生标题栏与系统窗控，按钮放在稳定 48px 侧栏 chrome 槽。窗口 title 保持「客服运营工作台 · 演示数据」，侧栏业务标题不得删除。应用菜单顺序：mac `appMenu,fileMenu,agent,edit,window`；Win/Linux `fileMenu,agent,edit,window`。`role:close` 关闭当前表面，无新 renderer IPC，无重复 quit，不加 view/reload/devtools。Page 截图不含原生红绿灯，最终原生外观需真实 macOS 人工或 OS 截图验证。
- 最好无 preload；不得进入 overlay `trustedContents()`；renderer 无 Node / Electron / clipboard。
- 只新增一个无参数 `dashboard:open` 白名单 IPC。main 必须验证 trusted sender 且 role 为 `query`。Fox 或非受信 sender fail-closed。
- 重复打开只 focus；关闭后可重建；关闭不得退出狐狸。
- 九个可浏览模块：管理概览、VOC / 工单洞察、检索效果、离线三维抽样复核、四域话术库、话术优化待办、内容与发布、公告与同步、架构能力图。
- 主内容只支持鼠标滚轮、触控板 / 触控滚动和原生滚动条；鼠标按住拖动不得滚页。最小窗口下不得遮挡关键操作或产生页面级横向滚动。
- BI 驾驶舱至少包含可切指标的固定周期趋势、检索终态构成、VOC Pareto 与产品×问题热力图；图例 / 数据点可通过鼠标和键盘选择并联动详情。所有图表持续标明固定合成口径，不得伪装生产实时数据。
- 管理概览按“需要拍板 → 变化 → 原因 → Owner / 下一步 → 数据可信度”组织，禁止个人排名与伪经营 KPI。
- 离线三维抽样复核必须把是否修改、是否发送、是否适用分账，分别显示样本量、有效分母、`unverifiable` 与证据等级；复制不能推断发送、采纳、未修改或正确，Demo 不采最终发送正文。
- 话术库与发布分开；四域内部枚举固定为 `presale / campaign / aftersale / product`。售前 / 售后卡片中的 `NOT_CREATED / UPSTREAM_AUTHORING` 只允许作为冻结合成场景标签，不能解释为 Menokin 企业材料当前不存在，也不能冒充正式源状态。
- 用户提供的 VOC Excel 仅允许只读提取结构与聚合用于设计校准；仓内只能落去标识合成镜像，不得落客户原文、订单号、图片、批次、员工、快递或竞品评价。
- 数据全部来自 TypeScript 编译期静态 manifest，深冻结；不用 `Date.now` 生成指标；不持久化。
- 每个数字注明合成演示。adopted 只等于复制成功。Publish 必须 disabled。
- 查询胶囊提供「深度思考 · 预留 · OFF」说明入口，仅描述 DeepSeek 可选辅助重排边界；当前不调用模型、不改变结果或排序、不生成、不改写、不发送。
- 查询胶囊的工作台入口使用标准线框 Dashboard 图标，保留明确 `aria-label` / tooltip；不再显示「工作台」文字按钮。
- Fox / Query 右键菜单、系统 Tray 与应用菜单由 Main 固定构造，只提供已经实现的查询、Dashboard 与退出动作。不得由 renderer 传菜单结构或通用命令；Query 输入框右键仍须保留撤销、剪切、复制、粘贴、全选等原生编辑能力。
- Dashboard 品牌区使用 40px 客服耳麦狐狸：浅色显示紫色耳麦，深色使用同几何的独立 PNG 白 / 浅灰耳麦变体；只切换耳麦视觉，不对整只狐狸做 filter，也不改变共享 Float / Query / Tray / Dock 资产。业务导航图标由 `--dash-nav-icon-size: 20px` 同时驱动 wrapper 与 SVG，文字用 `--dash-nav-label-shift: calc(var(--dash-brand-copy-shift) - 4px)` 再靠近约 4px；不改 PanelLeft、品牌 40px、icon slot、mac +60 / native +36 锚点或 selected 面。导航采用紧凑单行模块名；普通面板无悬浮阴影。矩形控件 / 面板 / 卡片 / 输入 / 选择项 / 菜单统一 `--dash-radius: 8px`；pill / 徽标 / 进度条可保留 999px，圆形状态点保留 50%；筛选状态若是语义 chip 用 pill，否则 8px。标准窗保持不透明。Sidebar 是透明 macOS / Codex 风格毛玻璃，顶栏 / Main canvas / 数据卡 / 表格为不透明实色；深色是炭黑层级。只有固定 sidebar 和短时 popover / tooltip 可 backdrop-filter；顶栏、滚动内容、筛选栏、卡片、图表、表格禁止 blur。未选中导航默认透明，hover 是中性灰完整高亮面，selected / active 是淡紫完整高亮面，pressed 比 hover 稍深且不做 translateY；active 不用左侧紫色竖线、inset rail 或 selected 紫色定向边框，也不改变图标坐标。只过渡 background / color / border / opacity 与极小 transform，禁止 blur / filter / box-shadow 过渡和会改布局的属性。紫色用于 focus、选中面与必要关键动作；危险 / 主 CTA 语义不得被抹平。文本链接只做下划线 / 透明度。外观用 `data-dashboard-theme` 显式 token，并让 shell 与 form controls 继承 `color-scheme`，避免 button 子树在手动浅/深色下走错 `light-dark()` 分支。
- Dashboard 不使用英文概念口号或多枚环境徽标墙：macOS integrated 顶栏就是 48px 单行标题栏，左侧模块名与紧凑刷新信息与标题栏同中心线，右侧只保留一个主题图标按钮、一个「演示数据」标识及「无后端 · 不保存」。完整模拟边界与安全免责声明收进侧栏「演示环境」。管理概览使用语义化决策表与连续 KPI 条，显示影响、Owner、下一步、状态、处理窗口、统计周期和指标定义；只有一个编译期合成数据集，不放置不生效的假全局筛选。VOC 模块可在该数据集的预编译年 / 月 / 日切片之间切换，并真实联动 KPI、Pareto、热力图和详情。
- 左侧导航展开宽度可在 `216–360px` 内拖动或用键盘分隔条调整，默认 `248px`；折叠为平台化 collapsed surface（macOS integrated 120 / native 72），展开恢复本次会话的上次宽度。expanded 向左拖视觉 preview 必须连续经过 216→193，不得在 216 形成死区；`lastExpandedWidth` 只保存合法展开终态。raw `<=192` 从当前 raw 已提交帧平滑约 190ms 收到 collapsed surface，`193` 松手从 193 平滑回 216；cancel / lostcapture / blur / buttons=0 不误折。折叠态分隔条仍可命中：从 collapsed surface 连续预览到 207，超过滞回 expand threshold `208` 后必须先保持当前 raw 一个已提交布局帧，再约 190ms 进入既有 expanding 并恢复 `lastExpandedWidth`（至少 min 216），不得在同一 pointermove 跳到 248/320；阈值以下松手 / cancel / lostcapture（即使 buttons===1）/ blur / buttons=0 从当前 preview 平滑弹回 collapsed surface 且不误展开；preview CSS 变量只允许 transitionend 后清理；回滚后 aria-valuenow 保持平台折叠宽度，保留 lastExpandedWidth。键盘分隔条折叠态 ArrowRight / Enter 展开，End 到 max，Home / ArrowLeft 保持 collapsed surface。拖动合帧、pointer capture、titlebar 临时 no-drag，不每帧 setState。图标锚点不重排（mac +60 / native +36），只隐藏文字；collapsing / collapsed / expanding 的 brand copy 与 labels 必须 opacity:0，expanded 结构完成后再 100–120ms 淡入；折叠态图标 hover / focus 时显示不被侧栏裁切的名称提示。Logo 始终固定、不条件卸载、无 overlay 按钮；折叠使用同一个持久 PanelLeft 按钮和显式 `expanded / collapsing / collapsed / expanding` phase，由 shell `grid-template-columns` transitionend 正常收口，transitioncancel 仅在实际结构已达当前目标时 settle，否则等待新的 transitionend；动态 reduced-motion 立即终态，不用硬计时。过渡期只有一个正确的可访问控制；折叠 180–200ms `cubic-bezier(.2,.8,.2,1)`，不以 max-width 瞬断布局。reduced-motion 直接终态。鼠标不强制焦点，键盘 / 虚拟点击在终态用 useLayoutEffect + focus({ preventScroll: true }) 交接。Logo 槽与按钮 no-drag，独立 titlebar strip 保持 drag；拖宽期间 topbar / titlebar strip 必须临时 no-drag。侧栏、主题 trigger 与 menuitemradio 桌面命中区 `40×40px`，粗指针 44px，PanelLeft 线框图标。仅 sidebar 固定玻璃层（light 约 #f2f2f6..#f5f5f8 / dark 约 #121116..#17161c，与 main 平均 RGB 差至少约 9）；`dashboard-main` light `#fff` / dark `#1c1b20` 且 alpha=1 无 blur，topbar / cards / table / filter 无 blur。Dashboard 右上单一主题 trigger（`aria-haspopup=menu`）打开浅色 / 深色 / 跟随系统 roving `menuitemradio` 菜单；ArrowDown / ArrowUp 可从 trigger 打开；支持方向键、Home / End、Enter / Space、Escape。Escape 与提交归还 trigger；Tab / Shift+Tab 关闭并移出，不抢外部焦点；外部指针只关闭不强抢焦点。默认跟随系统且只在当前会话生效，保持 system matchMedia 实时联动，不使用 localStorage / IndexedDB / 文件持久化。`forced-colors` 下 tooltip / popover 为 Canvas / CanvasText 且无 blur。管理概览只保留结构线，去掉装饰性上下 / 竖分隔与首项顶线。另显示禁用占位「工单垃圾桶 · 二期待实施」，它不算第十个可浏览模块，也不提供任何功能。
- 「公告与同步」提供纯本地推送演练：成功 / 失败、loading 和重试可演示，但不得联网、发送、保存或改变四个同步分面。
- 九端口、PG、对象存储、outbox Worker、可选 LLM 只作为架构故事展示，状态为 `DEMO 已实现` / `视觉模拟` / `正式未接入`。search / events / content / workorders 标红线。LLM 默认关闭且不改写 Answer。

### 2.3 状态机

```text
FOX_IDLE -> SEARCH_INPUT -> RESULTS | EMPTY | ERROR -> COPIED -> FOX_IDLE
```

- 默认全局快捷键：`CommandOrControl+Shift+Space`。
- 注册失败必须可见降级到「点击狐狸头」。
- 单实例：第二次启动聚焦/展开已有控件。
- 打开 Dashboard 后 Float 收起为狐狸。
- macOS 程序坞 `activate` 在应用就绪后打开 / 恢复单例 Dashboard，不展开查询；首次启动不得因此自动打开 Dashboard。

### 2.4 搜索纵向切片

- 自建至少 8 条**合成**护肤客服话术 fixture，覆盖产品、活动、售前、售后；使用虚构产品名/活动名。
- **不得使用 Menokin 名义、真实产品事实或真实客户原文，也不得近义改写真实话术。**
- 确定性本地评分：完整问法 + 字符 n-gram 为主，fixture 级合成实体锚点 / 别名 / 规则意图只作受控辅助；强品类文本 + 匹配主题 / 意图可在词法下限之上召回自然问法，纯泛化意图不得制造命中；宽品类别名含未知品牌 / 剩余文本时 fail-closed。
- 有效期与数据合同先 fail-closed，再按 ID / 原始正文去重、稳定排序并返回最多 3 条；同分使用不依赖 locale 的 ID 顺序。
- **过期与未生效内容永不返回。卡片不展示匹配分。**
- 卡片可展示「精确问法 / 同义表达 / 主题与意图 / 相似问法」等非数字原因；答案展示和复制必须是 fixture 中的原始 `answerText`。
- 不迁移旧学习项目代码、词典、权重、真实数据或持久化 / 学习链路；本仓查询增强必须独立实现并只用合成 fixture。

## 3. 建议目录

```text
src/
  main/          窗口、快捷键、锚定、生命周期、白名单 IPC、Dashboard 单例、
                 drag settle、layout ACK、handoff、shutdown fence、app identity
  preload/       最小类型化 API（仅 overlay）
  shared/        合同、状态机、几何、狐狸动效参数、Dashboard 访问控制
  renderer/      FoxApp + QueryApp + DashboardApp + 合成 fixture / manifest
docs/            Tutorial / How-to / Reference / Explanation（四象限）
tests/
  unit/          状态机、锚定、动效参数、manifest、Dashboard 授权、drag settle
  component/     展开、空查询、IME、Top 3、复制、导航、Fox 吸附 class
  e2e/           Electron smoke + Dashboard 单例 / 安全窗
scripts/         图标派生、本机证明包、正式门禁与打包后验
```

## 4. 数据流与信任边界

```text
[Fox pointer / generation++]
      |
      +-- moveFoxBy(dx,dy,finished,generation) --> [Main dock session]
      |         finished + matching generation
      |              v
      |     setBounds once + settleId++ + fox-drag-settled
      |              v
      |     Fox paints same frame --> commitFoxDragSettle(settleId)
      |              v
      |     watchdog 1.6s / stale ACK ignored
      |
[Fox click / globalShortcut] -- if drag still settling, defer OPEN
      |
      v
[two-phase handoff]
      prepare-search (hidden Query, actual 88px center, 64px, matrix)
        --> open-armed --> show Query / hide Fox / focus
        --> activate-search --> open-finished
      close: collapse --> close-finished --> showInactive Fox
      |
      v
[Query capsule input]
      |
      v
[local deterministic search] ---> [synthetic fixture only]
      |
      +--> [Top 3 original answers, effective only]
      |
      +-- copy request --> [typed preload API] --> [Main clipboard]
      |
      +-- DOM hug measure --> report-query-layout / resize-query-height
               trusted Query main-frame + session/sequence/phase gate
               clamp 240..min(620, availableHeight) --> one setBounds --> ACK
               stale/mismatch --> 240/340/430/620 fallback only

[Query Dashboard icon] -- dashboard:open, trusted + role=query
      |
[native menu / Tray / Dock] -- Main openDashboard + native failure notifier
      |
      v
[single-flight openDashboard]
      existing window? reveal : lazy create (show:false, no preload)
      loadRenderer --> reveal (restore/show/focus)
      reveal ok --> dismiss Query --> {ok:true}
      any fail --> destroy new window, keep Query --> {ok:false}

[app ready] applyApplicationIdentity (regular Dock, assets/app-icon.png)
[before-quit / will-quit] shutdown fence.begin --> guarded scheduler dispose
[package:*] generate icons --> build --> electron-builder --> post-verifier
```

- Dashboard renderer 不得直接访问 Node/Electron API，也不得获得 `customerAgent`。
- Fox / Query 才进入 `trustedContents()`；Dashboard 不在 overlay 信任集里。
- fixture 与 manifest 静态打包，不发网络请求。
- 禁止 `localStorage`、IndexedDB、文件落盘或分析 SDK。
- 不读取 `.env`、钥匙串或凭证。
- CSP 至少限制 `default-src 'self'`。
- 关机后 overlay 视为 inactive；`GuardedScheduler` 丢弃未触发的定时器。
- 本地证明包的后验只证明文件树 / Universal / 许可 / 品牌副本，不构成外发授权。

## 5. 工具链与脚本

- Node.js 24.x；`packageManager` 锁定 pnpm 11.19.0。
- 必须提供：`pnpm dev`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。日常狐狸动效回归使用轻量 `pnpm test:float`（**不含**完整 drag-settle）；`pnpm test:assets` 只验证现有品牌 raster / Dock 合同，不等于生成，不得塞回每次动效 fast loop；`pnpm test:e2e:float` 自身先 build 再跑 `@float`。狐狸品牌 raster canonical 用 `pnpm generate:fox-head` 从 `assets/fox-head-master.png` 派生 `fox-head.png`、Dashboard 深色耳麦；默认同时派生 `assets/app-icon.png` 与 build PNG/ICO，macOS 上再派生 ICNS。
- 保留 `pnpm package:win`，Windows 未签名本机证明包隔离写入 `release/local-unsigned/windows/`，NSIS 关闭 differential package；builder 完成后必须 fail-closed 跑 `scripts/verify-windows-package.mjs`：校验 `UNSIGNED.exe`、无 blockmap / latest / app-update 元数据、`win-unpacked/resources/icon.ico` 与 `build/icon.ico` 字节一致且必要许可证非空。不把该后验写成 PE 图标资源、Authenticode 或真实 Windows 安装验收。本轮主流程最终决定是否实际跨平台产包，日常定向测试不要求产出 Windows 安装包。
- 提供 `pnpm package:mac:local` 生成显式未签名、不可外发的 Universal DMG + ZIP，用于本机证明，并跑 `finalize-mac-package` + `verify-mac-package`；提供 `pnpm package:mac` 作为正式门禁，缺长期 Bundle ID、完整 Xcode、Developer ID 或公证凭证时必须 fail-closed。当前 `appId=local.demo.customer-agent` 不满足正式外发前置，不能暗示已经可以正式发包。
- Mac / Windows 应用图标从仓内透明狐狸确定性合成独立 `assets/app-icon.png` master（近白 squircle 底板），再生成 `build/icon.icns` / `build/icon.ico`；Tray 与浮窗仍用透明 `fox-head.png`。正式包启用 Hardened Runtime、最小权限 entitlement、签名与 Apple notarization。证书和公证凭证永不进入 Git。

## 6. 最低测试矩阵

1. 相同输入结果与排序稳定，最多 3 条。
2. 匹配阈值以下返回 no-hit。
3. exact 命中优先于弱 token/bigram 命中。
4. fixture 别名 + 意图及强品类 + 问题主题能召回对应合成条目；「怎么用 / 怎么办 / 能用吗」等纯泛问必须 no-hit，陌生品牌 + 宽品类别名不得串到合成条目。
5. 展示与复制的是原始 `answerText`；仅出现在答案正文中的词不能反向召回。
6. 过期内容永不返回；重复 ID / 重复正文先去重。
7. UI 不出现「匹配分」，只显示非数字匹配原因。
8. 空查询有明确提示；中文 IME 组合期 Enter 不提交。
9. 复制成功文案是「已复制」，页面不出现「已发送」。
10. Esc / 外部点击 / 再次快捷键收起回狐狸头；复制成功短反馈后自动收起，失败不收起。
11. 搜索过程中改问题会取消旧结果；数字键不会在输入框、IME、修饰键或 repeat 场景误触。
12. 左右贴边原生窗口都稳定留在工作区、renderer 等效裁出 44px 窗区且狐狸视觉都露 32px；稳定半露态以 `.fox-head` transform 做镜像 inward-ready 动效（峰值内移 3px、上抬 2px、内倾 5°、scale 1.035），探头到等效 80px，吸附 / ready / 探头动画左右镜像且每次可重播；不得动画负责裁切的根节点，reduced motion 关闭持续位移、ready、声波和吸附变形。约 8s / 14s 分别可见困倦 / 闭眼趴睡 + `Zzz`，拖拽跨过 4px 后同一眼区显示 `><`，耳机声波只播放有限两轮且与睡眠 / 拖拽 / warning / handoff 互斥。台前调度下若 WindowServer 接受边界不同于 workArea，连续 hover / retract 只改变 renderer crop，实际 native x 不得往返理论 x0。整头局部 follow / 睡眠 / press / drag reaction 不得改变 88px native bounds，不得新增第三条持续动画循环，也不得污染 Query 业务动画。
13. 拖拽松手、取消、失焦或 capture 丢失后只完成一次，后续无按键移动不再改变窗口或误触 click。Ctrl+主键走原生 context menu；右键 / 非主键不触发 reaction；键盘 click `detail=0` 仍立即打开且仅一次。
14. Dashboard：IPC 仍 query-only，原生菜单 / Tray / macOS 程序坞可直接调用 Main；单例、关闭重建、最小化恢复、无 customerAgent、九模块可浏览；滚轮 / 原生滚动条与最小窗口响应式可用，鼠标拖动不滚页；侧栏可折叠且以稳定 `data-nav-phase` 收口，同一 toggle 不放在 Logo 上，193/192 折叠阈值、208 滞回展开阈值与 lastExpandedWidth 恢复成立，折叠态可拖宽预览且阈值前平滑弹回（含 lostcapture 即使 buttons===1、回滚后 aria-valuenow=平台折叠宽度），跨阈值必须先提交当前 raw 帧再进入 expanding，titlebar/sidebar/main/divider 由唯一 renderedNavWidth 驱动且误差 ≤1（mac 折叠稳态 120，toggle.right≤112；native 折叠 72），二期垃圾桶保持 disabled；趋势 / 构成 / Pareto / 热力图可交互；VOC 年 / 月 / 日切片、下钻、离线三维复核和话术四域筛选真实联动；本地推送演练不改变四分面；Publish disabled。macOS 为 hiddenInset 一体 chrome，原生标题文字不可见，交通灯与 drag / no-drag 安全；Windows / Linux 保持原生窗控；选中导航无左侧紫色竖线，hover 灰、selected 淡紫；主题为单 trigger / menu；980 / 1180 / 1440 无页面级横溢出；main light/dark alpha 1 且无 blur。
15. Electron smoke：启动狐狸头、左右停靠 / drag-settle、台前调度边界采纳、反复展开 / 收起且无双窗同时不可见、共享狐狸首帧中心 / 64px 尺寸 / 姿态矩阵连续、关闭后不点击页面即可直接键入、点击胶囊狐狸收起、内容贴合高度、数字键复制、自动收起，以及 Dashboard 的可信入口、单例、安全隔离与程序坞恢复。探头 / 缩回、Query 纵向拖拽及 Dashboard 导航 / 主题 / 筛选 / 模块交互使用 unit/component 测试作为默认门禁，避免让 macOS draggable region 或透明 overlay 下不确定的 CDP 长鼠标链阻塞交付。真实 OS 的应用激活、BrowserWindow / WebContents 键盘投递、Cmd+W / Dock 外观、折叠侧栏与 Query 纵向拖拽、贴边 hover / retract 命中仍需实机。Query 只保证当前 Space 唤起，不再承诺跨 Space / 覆盖全屏。自动化使用 `--demo-e2e` / `DEMO_E2E=1` 的 main harness 验证同一状态机与 `app.dock.isVisible()` 程序证据。
16. 桌面入口：图标按钮具备可访问名称；应用菜单含原生 fileMenu/close，Tray 菜单包含查询 / Dashboard / 退出；Fox / Query 原生右键菜单可用且不扩展 IPC 白名单，Query 可编辑区域保留标准编辑项。

## 7. 完成定义

- 当前机器使用 Node 24 + pnpm 能安装并运行 Demo。
- 当前 Mac 能构建并启动同时包含 `x86_64 + arm64` 的本地 Universal 包；正式签名 / 公证只有在公司 Apple Developer 前置齐全时才可宣称通过。
- lint、typecheck、unit/component test、build 全部实际通过。
- Electron smoke 尽量实际通过；若环境限制，不能把「测试文件存在」写成 PASS。
- 无真实数据、凭证、飞书链接、远端 API、数据库或模型调用。
- README 写清启动命令、快捷键、双表面边界、数据边界、透明效果平台差异、快捷键冲突降级，并一跳到达四象限文档。
- 任务包本身不授权 Git；commit、push、merge、deploy 分别授权。

## 8. 当前 v3 原型基线明确不做

以下内容不是“永远不在本仓”，而是不得在当前原型变更中顺手接入。进入正式产品阶段时必须由获批计划、合同和验收门单独承接。

- 正式 OAuth/RBAC、PostgreSQL、Fastify、真实内容导入/发布、生产 Dashboard BI。
- 向量库、Embedding、LLM、自动发送、自动学习。
- 陪伴型桌宠、进程监听、聊天窗口标题监听。不把本 Demo 写成复制或兼容 Clawd；附件只可 clean-room 借鉴抽象理念。
- ZIP 内任何 SVG/PNG/GIF/ICO、AGPL 源码、脚本、hooks 或 package；全局鼠标追踪、真实 free-roam、双击 / 多击 accumulator、per-frame native window move。
- 读取或伪造 Menokin 正式发布快照，或把仓外 Menokin 材料写入本 Git 合成运行时。
- 自动更新、真实 Windows 安装验收。
- 替公司代选长期 Bundle ID、代办 Apple Developer Program 或把签名 / 公证凭证写入仓库；这些是正式外发的审批与凭证前置。
