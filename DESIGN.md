# 客服 Agent 产品视觉与交互基线

> **仓库身份：** 客服 Agent 产品实施仓；见 `PROJECT_CHARTER.md`。
> **当前实现状态：** v3 双表面。Float 仍是输入法式狐狸头；Dashboard 是客服经理工作台。
> **证据边界：** 工作台数字与按钮必须走产品会话 / 数据库支持的冻结接口。没有接口时显示禁用或一句「何时会有数据」，禁止合成成功、禁止 fixture 数字冒充生产。

本文件拥有产品视觉、交互和内容表达的不变量。下文 “Demo” 指当前原型模式；后续正式数据和服务接入不得推翻已经冻结的人在环、复制语义、可访问性与桌面交互基线。

> **2026-10-24**：工作台与登录窗的外观以 §3「工作台与登录窗」为准；页面去留与各角色文案的设计稿在 [前端设计结论](docs/plans/2026-10-24-frontend-design-decisions.md)（未批准）。坐席的狐狸、查询条、Top 3 与复制保持本文件原规则。下文标注「已作废」的段落只作历史记录，不再约束实现。

## 1. 产品印象

第一眼仍应是：**桌面上的输入法式控件**——平时只剩一颗狐狸头，需要时展开成玻璃查询胶囊，给出 Top 3 原文让坐席自己复制。

第二眼才是工作台：查询胶囊上有一个带可访问名称的 Dashboard 图标入口；狐狸右键菜单、系统 Tray / 菜单栏也提供同一入口。打开后出现**白为主、紫为识别锚点**的客服经理决策窗。旧 profile 的首屏可以回答“哪里在恶化、为什么、让谁处理”。当前 faq-v2 工作台不画恶化指标，规则见「当前工作台（faq-v2）」。没有活数据时写「未接入」，不得用 MOCK 徽标墙或发明数字。

它不是 520×760 的普通浮窗工作台，不是聊天机器人，也不是陪伴型桌宠；紫色只用于品牌、键盘焦点剪影 cue 和必要的关键动作，不铺满页面，也不再作为选中导航的默认色。默认主题的狐狸不使用闭合蓝圆。

## 2. 窗口与结构

五个 `BrowserWindow`，职责分开。Fox / Query 是 overlay；Dashboard 是工作台；登录窗与售后 SOP 窗都不是 overlay，不参与狐狸交接。

1. `FOX_IDLE`：约 88px 透明狐狸头常驻窗（含动效留白）；无边框、置顶、跳过任务栏。狐狸视觉约 64px。
2. 查询窗：约 `600×88` 的玻璃胶囊；透明 frameless、原生 `resizable: false`，不开放 width / x / y / bounds IPC。正常结果路径按 DOM 实测 hug：capsule 88 + banner + `result-content` scrollHeight + border/padding + 约 20px grip，经 typed query-only layout IPC 上报后 Main 钳制到 `240..min(620, availableHeight)` 再一次 `setBounds` 并 ACK，然后才显示内容。旧分档 `240 / 340 / 430 / 620` 只作异常 fallback。自定义仅纵向 resize grip；collapse 必须用 Main 按真实狐狸屏幕中心减当前 query bounds 算出的 `handoffCenterX/Y`。小屏或超过 620 只压缩结果区滚动，胶囊 88 不缩。与狐狸同为 overlay。
3. **（像素规则已作废，2026-10-24）** 工作台侧栏固定宽度，可收起成图标栏，不提供拖动改宽度；交通灯、标题栏、PanelLeft 与拖宽阈值的像素约定不再约束实现。以下原文仅作历史记录。Dashboard：约 `1180×760`、最小约 `980×680` 的标准系统窗。正常 frame、可缩放、非透明、非置顶、显示在任务栏。macOS 使用 `titleBarStyle: 'hiddenInset'`：隐藏原生标题栏文字，保留红黄绿交通灯以及拖动、缩放、最小化 / 最大化 / 关闭；侧栏与顶栏延伸进标题栏，形成一体 chrome。交通灯位置保持 `trafficLightPosition: { x: 14, y: 16 }`。共享 SSOT：macOS 标题栏高度 `48px`、交通灯 / 控件安全左距 `72px`，由 Dashboard renderer 以 CSS vars 消费，不经 preload / IPC。一体 chrome 下是真正的 48px 单行标题栏：drag strip 高 48，主 topbar 高 48 且不再 `padding-top: 38`，模块名 / 刷新信息 / 主题控件与 48px 标题栏同一中心线（约 y24）。品牌与导航从标题栏下方开始（block offset 48），狐狸 Logo 不与红绿灯重叠。同一个持久 DOM PanelLeft 控制按钮在展开 / 过渡 / 折叠 / 展开中都固定存在：macOS integrated 在红绿灯右侧 `left:72px; top:4px; 40×40`（`x=72..112`），由侧栏自有 titlebar control island 持有（顶部 `x=72..120`、高 48、透明 no-drag overlay、`pointer-events:auto` / 顶层 z-index），不再用 `position:fixed` 逃出 `aside`。island 不得填充玻璃或不透明侧栏、不得画第二条实体边线。几何职责必须拆开：traffic-light safe zone 为 `0..72`；toggle 占 `72..112`；toggle 右侧到 divider 固定 8px；macOS integrated 的 collapsed surface / 结构边界 / main 左缘 / topbar 左缘 / resizer 中线 / 唯一全高 divider 统一为 `120px`。Windows / Linux native 的 collapsed surface 仍为 `72px`。视觉结构列边界由 `--dash-rendered-nav-width` 驱动的 `--dash-structure-boundary` 单一 token 决定：mac 折叠 / collapsing 为 120，native 为 72，展开 / expanding 为当前合法展开宽度，拖宽预览共用同一条边界。左侧玻璃与右侧实色 main 都从顶到底是一张连续表面，分界线单一。折叠态 topbar / drag surface 只随共享边界移动，禁止 20→52 的局部 padding 补偿。Win/Linux 在稳定 48px 侧栏 chrome 槽，永不放在狐狸 Logo 上。只做 100–120ms glyph crossfade/scale，不位移 / 旋转 / 闪现。macOS collapsed 时 `toggle.right <= 112` 且 divider=120。macOS 四阶段 brand / nav icon 中心固定为 `nav.left + 60`，native 固定为 `nav.left + 36`，切态与拖动漂移不超过 1px；macOS collapsed 选中面必须围绕图标对称，不得留下 48px 空白假栏。侧栏拖宽 expanded 向左时视觉 preview 必须连续经过 `216→193`，不得在 216 形成死区；`lastExpandedWidth` 只保存合法展开终态。raw `<=192` 时从当前 raw 的已提交帧平滑约 190ms 收到 collapsed surface；raw=`193` 松手从 193 平滑回 216。折叠态向右拖 preview 连续到 207；raw `>=208` 后必须至少保持当前 raw 一个已提交布局帧，再约 190ms 平滑到 `lastExpandedWidth`（至少 min 216），不得在同一 pointermove 直接跳到 248/320。阈值前松手 / 取消 / `lostpointercapture`（即使 `buttons===1`）/ blur / `buttons=0` 从当前 preview 平滑回 collapsed surface，公开 `aria-valuenow=平台折叠宽度` 并保留 `lastExpandedWidth`。preview CSS 变量只允许在 `transitionend` 稳定后清理。重开恢复此前 `lastExpandedWidth`。标题栏空白为 `-webkit-app-region: drag`，按钮 / 导航 / 输入 / 分隔条为 `no-drag`。CDP click 不能冒充 OS 命中；折叠态展开按钮的最终验收仍需真实 macOS 鼠标。Windows / Linux 保持原生标题栏与系统窗控，不套 hiddenInset，也不使用 titleBarOverlay。窗口 title 为「客服运营工作台」，供任务栏 / Mission Control 使用，不得被共用 `index.html` 的浮窗标题覆盖；侧栏业务标题「客服运营工作台 / 运营管理端」必须保留。不得再写「演示数据」。应用菜单含原生 `fileMenu` / `role:close`：macOS `Cmd+W` 关闭当前 Dashboard，Query 则收回 Fox，Fox idle 无副作用；`Cmd+Q` 才退出。Windows `Ctrl+W` / 标题栏 X / `Alt+F4` 关闭当前表面。Dashboard 关闭后可重建单例，Fox / Tray 继续。Page 截图只证明 webContents，不含原生红绿灯；最终原生外观仍需真实 macOS 人工或 OS 截图验证。懒创建；重复打开只 focus 同一窗口；关闭后可重建；关闭 Dashboard 不得退出狐狸。运行期间 macOS Dock / Cmd+Tab 必须保持 regular activation policy。开发态 ready 后用仓内可追踪 `apps/desktop/assets/app-icon.png` master（1024 近白 squircle 底板 + 光学居中狐狸）直接 `app.dock.setIcon`，不依赖 ignored / stale `apps/desktop/build/icon.png`，也不把透明 `apps/desktop/fox-head.png` 用于 Dock。打包态用 `apps/desktop/build/icon.icns` / `apps/desktop/build/icon.ico`。Float、Dashboard Logo 与 macOS Tray Template 继续用透明狐狸。Query / Fox 可 skipTaskbar，应用级 Dock 图标保留。真实 Cmd+Tab / Dock 外观需人工 macOS 验收。
4. 登录窗：约 `520×420` 的标准系统窗，**只用原生标题栏**，不套 hiddenInset / overlay chrome。标题「登录」。胶囊点「登录」打开；分段文案只有 **飞书 / 账号**，禁止内部 / 外包或其它受众标签。~~视觉复用查询胶囊 token（浅白玻璃底、`--ink` / `--muted`、淡紫主按钮、11px 次控件、输入井 16/24 与 14px 圆角）。~~ **（已作废，2026-10-24）** 登录窗改用工作台同款 antd 外观：白底实色、紫色主按钮、8px 圆角。本窗只做选择器和账号表单，**不内嵌飞书官方登录页**。点「飞书登录」后用系统浏览器打开校验过的授权地址；文案写「将用浏览器打开飞书登录」，不要写「将在此窗口打开」。账号是管理员下发的口令表单，失败只说「账号或密码不正确」，找回只说联系管理员。独立非持久 session，不与 Query / Dashboard 共享 cookie。关窗或 Esc 是取消，成功以会话交换为准。不改胶囊几何，也不把登录做成胶囊内表单。
5. 售后 SOP 窗：独立 `role=sop` 可拖动窗，宽 600，起壳高 240，hug `240..620`，40px chrome。过敏售后 Top 3 在结果标题和卡片之间给「打开过敏售后流程」；已有进度时改成「继续过敏售后流程」。Query 检索与 SOP 可同时开，不自动弹出。Esc / × 收起并保留进度；「结束并清除进度」销毁窗口。`OverlayRole` 仍只有 `fox | query`。SOP 复制只反馈 1.2s，不进入 Query `COPIED`，也不走 `copyAdopt`。复制卡不画 Query 排名。切片 1 仅合成过敏树 DEMO，坐席只读。凭证 / 高风险话术步才出现「本步只给话术，不建单、不指令仓配」。

- 不再使用固定 `520×760` 工作台，也不再把旧 RecentPanel 冒充 Dashboard。
- Overlay 窗口尺寸等于可见控件，避免大块透明命中区吞掉桌面点击。
- 锚定在狐狸位置附近，并钳制到当前屏 `workArea`。
- 狐狸拖到当前屏左右边缘 18px 内时自动吸附：88px 原生窗始终完整留在工作区，renderer 在稳定窗口内平移裁切，令 64px 狐狸视觉左右都恰好露 32px；打开查询后仍从原侧向屏幕内展开。禁止把透明原生窗反复推到屏外与 WindowServer 争抢位置。
- macOS 台前调度的最近 App 条带可能把后台透明窗限制在一个未由 Electron `screen.workArea` 暴露的“有效舞台边界”。此时以 WindowServer 实际接受的 `BrowserWindow.getBounds()` 为该 dock epoch 的位置真值；hover peek / retract 只改 renderer 裁切，不得再次 `setBounds(workArea.x)`。打开 Query、共享元素中心与关闭恢复都从实际 frame 采样。目标是在系统接受边界稳定半露且不横跳；Electron 公共 API 下不承诺后台窗口一定占据物理屏 x=0。
- 查询胶囊不再贴 `DEMO`、`MOCK AUTH` 徽标。话术卡片不再贴 `DEMO · 合成数据`；身份与目录仍是合成。产品远端登录后，会话芯片只显示「{操作者姓名} · 退出」，禁止把 RBAC 角色（`owner` / `agent` / `coach`）画在查询主路径。Dashboard 顶栏在 macOS integrated chrome 下就是 48px 单行标题栏：左侧模块名与紧凑刷新信息与标题栏同中心线；右侧只保留一个主题图标按钮。禁止「演示数据」「无后端 · 不保存」「演示环境」徽标墙。没有登录时写「请先登录」。没有数字时写「暂无记录」。不要写「未接入」，也不要发明数字。
- macOS 查询窗保留可激活的普通窗口类型以保障 IME / 物理键盘焦点。应用必须保持 regular Dock / Cmd+Tab；Electron 只允许已是 `UIElementApplication` 时使用 `skipTransformProcessType: true`，因此本 Demo 不再把 Query 加入所有 Space 或覆盖全屏应用。当前 Space 内正常唤起仍成立。显示器新增、拔除、分辨率或 Dock 工作区变化后，Float 以防抖方式重新钳制到可用 `workArea`，不抢焦点、不重播动效、不打断共享元素交接。
- `FOX_IDLE` 按“只显示狐狸头”的目标例外。

## 3. 视觉语言

### 工作台与登录窗（2026-10-24 起的现行规则）

本节是工作台和登录窗外观的唯一规则。狐狸和查询条不受本节约束，继续使用下文「颜色（浅白玻璃 + 内部工具）」中的 Float Query 规则。下文与本节冲突的工作台旧规则一律以本节为准。

**目标**：给每天要用的人一个安静、有秩序的界面。层级靠字重、颜色和间距建立，不靠装饰。

**颜色**

- 只用 [Radix UI Colors](https://www.radix-ui.com/colors) v3。中性色 mauve，强调色 violet，成功 grass，提醒 amber，危险 tomato。色值只写在 `apps/desktop/src/renderer/styles/radix-palette.css`；组件样式只读 `workbench-tokens.css` 里的语义变量，不写颜色字面量。antd 主题的色值镜像在 `intake-antd.tsx` 的 `RADIX`，两处必须一致。
- 按 Radix 的阶梯用色：1–2 是页面和侧栏底色；3 是悬停面，4 是按下面，选中行用 violet-3；6 是分隔线，7 是可交互控件的边框，8 是焦点环；9 是主按钮实色，10 是主按钮悬停；11 是次要文字，12 是正文。
- 状态文字用对应色的 11 阶，底色用 3 阶，边线用 6 阶。状态不能只靠颜色，必须有文字。
- 紫色只出现在三处：主按钮、侧栏选中行、焦点环。不铺满页面，不做渐变。

**文字**

- 只有三种字号：12（辅助信息、表头、标签）、14（正文、按钮、输入）、20（页面标题和概览数字）。最小 12。
- 不够区分时用字重（400 / 500 / 600）、颜色（12 / 11 / 9 阶）和间距，不再加字号。
- 不在区块标题上方加眉题或英文大写小标签。侧栏不显示分组名，分组之间只留 12px 空隙。顶栏只写当前页名，不写「分组 / 页名」。

**线、圆角、阴影**

- 线一律 0.5px（`--wb-hair`）。
- 圆角两档：控件 6，面板 10。控件嵌在面板内 4px 时，10 − 4 = 6，保持同心。分段选择器的轨道 8、滑块 6、内边距 2，同理。
- 工作台表面不用阴影。只有浮层（菜单、下拉、弹窗）用一层很淡的阴影把它和底层分开。
- 不用卡片左侧的彩色竖线，不用装饰性圆角。

**动效**

- 只过渡颜色、背景和透明度，200ms，ease-out（`--wb-motion` / `--wb-ease`）。
- 不做弹跳、发光、漂浮、位移入场。`prefers-reduced-motion` 时全部关闭。
- 侧栏折叠沿用现有行为，速度同上。

**文案**

- 不用「·」做分隔符。复合标签用「 / 」，代码里统一走 `shared/display-separator.ts`；句内并列用顿号或逗号；字段用「标签：值」或标签和值分开排。
- 不放解释界面怎么用的长句。按钮名和字段名本身应该说清楚；必须提醒的风险放在发生选择的那个按钮或确认框里。
- 空状态只写一句「什么时候会有数据」，例如「坐席查询后会出现」。不放插画。
- 用使用者的说法，不用内部词。「资格」「投影」「hydrate」「release」这类词不出现在界面上。
- 复制成功只写「已复制」。

**控件**

- 工作台各页和登录窗只用 antd 控件。ESLint 规则拦截原生 `<button>`、`<input>`、`<select>`、`<textarea>`；隐藏的文件选择 `<input type="file">` 除外。
- 例外只有两类：窗口外壳（侧栏导航、折叠按钮、返回按钮、主题菜单），它们承担拖动与折叠，外观与 antd 一致；以及待删除的旧 profile 模块（任务卡 D4）。登录窗的「飞书 / 账号」切换是逐行豁免的原生按钮。

**等待与反馈**（统一由 `features/dashboard/WorkbenchState.tsx` 渲染）

- 首次读取：在内容的位置放骨架屏，不写「加载中」。超过 8 秒加一行「还在读取…」。
- 按钮触发的短动作：按钮自己显示转圈并禁用，防止连点。
- 没有数据：一句何时会有数据。
- 读取或写入失败、可以安全重试：一行原因加「重试」，输入不清空。
- 写入结果不确定：一行说明加「按原请求确认结果」或「刷新查看」，**不给重试**，因为重试可能重复写入。
- 危险操作（撤销、停用、回退、取消候选）先确认；确认框写清楚做什么、能不能撤销。
- 复制成功只写「已复制」。

**没有权限**（统一由 `WorkbenchNoAccess` 渲染，判断文字由 `shared/workbench-access.ts` 给出）

- 页面和按钮留着，不藏。做不了的按钮禁用，旁边或上方一句「你还不能…」，下一行「请联系{角色}开通。」。
- 该找的角色写角色名，不写人名：给他人开通找「你的经理」，上传 SOP 找「客服主管」，职务没登记或没登录找「管理员」。
- 登录状态过期不是缺权限：写「登录状态需要确认，请重新登录。」。
- 这层只决定显示。是否放行由服务端判断，前端不得据此放开任何操作。

**概览**

- 只放真实数字。没有数据时数字位置显示「—」，下面一行写何时会有。
- 「命中率」在口径确定前不出现在概览上。也不放「较上期 ↑ 8%」这类对比。
- 本机预览地址加 `preview=intake` 时可以出现样例数字，打包后的应用不会出现。

**登录窗**

- 系统原生标题栏。窗口内只有狐狸、「登录」标题、飞书 / 账号分段、对应表单和按钮。
- 使用工作台同一套颜色、字号和控件。不再复用查询条的玻璃外观。

### 颜色（浅白玻璃 + 内部工具）

> 本小节下面关于 Dashboard 的颜色、玻璃侧栏和 blur 规则已被上一节取代，只保留 Float Query 部分。

```css
--glass: rgba(250, 252, 255, 0.88);
--ink: #20242D;
--muted: #5F6876;
--fox: #8B5CF6;
--focus: #5B8CFF;
--success: #22896F;
--hairline: rgba(46, 55, 74, 0.14);
--shadow: 0 18px 48px rgba(35, 45, 72, 0.20);
```

- Float Query：使用 Query 专属语义 token，接近 macOS 搜索面板的轻透与清晰层级，不声称或照抄 Spotlight 精确 opacity。浅色起点为 `rgba(248, 249, 252, .80)` 主玻璃、`rgba(255, 255, 255, .48)` 内层、白色 highlight hairline、`blur(28px) saturate(118%)`，阴影 `0 22px 58px rgba(23, 27, 38, .22)` 加 `0 2px 10px` 同色 `.10`。深色可用炭灰 `rgba(31, 30, 36, .76)`，以实际可读性为准。不引入 BrowserWindow vibrancy，不改 transparent 或窗口安全选项。`backdrop-filter` 固定采样，不得进入 transition / keyframes；打开关闭只动画 `clip-path` 与 `opacity`。`prefers-reduced-transparency` 用实色无 blur；`forced-colors` 用 Canvas / CanvasText 且无 shadow / blur。这些 token 不得让 Dashboard 或 Fox 主题漂移。
- **（Dashboard 玻璃侧栏与 blur 要求已作废，2026-10-24：工作台全部实色，不用 blur；紫色只做主按钮与选中行。）** Dashboard：白色卡片与极浅灰画布为主，紫色控制在品牌、焦点环、选中面与必要的关键动作；风险继续使用红 / 黄 / 绿并配文字。标准 `BrowserWindow` 保持不透明，不启用 vibrancy / transparent。深色是炭黑层级（画布 / 侧栏 / 卡片），不是纯黑或简单反相。仅 sidebar 是固定玻璃层：light 最终视觉约 `#f2f2f6..#f5f5f8`，dark 约 `#121116..#17161c`，与 main 的平均 RGB 差至少约 9；静态 `blur(20px)` + saturate、单一中性 hairline 和极轻顶部高光。右侧 `dashboard-main` 明确不透明：light 纯白 `#fff`，dark 不透明炭黑约 `#1c1b20`，alpha=1 且无 blur。只有固定 sidebar 和短时 popover / tooltip 可使用 `backdrop-filter`；顶栏、滚动中的筛选 / 工具区、卡片、图表与表格禁止 blur。resize / phase 期间 blur 数值恒定。数据正文保持高对比实色字。`prefers-reduced-transparency` 使用同等层级实色；`forced-colors` 使用 Canvas / CanvasText 且无 blur。禁止紫色渐变、霓虹发光、漂浮卡片墙、超大圆角、重阴影和噪点。
- Dashboard 按成熟运营工具处理：工作内容居中、固定可调面板、最小但可发现的控件、稳定肌肉记忆。导航紧凑、4/8 间距，主内容留白约 20–24px，section 约 20px；矩形控件 / 面板 / 卡片 / 输入 / 选择项 / 菜单统一 `--dash-radius: 8px`（`--dash-panel-radius` 为其别名）。pill / 徽标 / 进度条可保留 999px，圆形状态点保留 50%。普通数据面板不悬浮、不堆阴影、不做卡片马赛克。hover 必须是中性灰完整高亮面；selected / active 恢复淡紫完整高亮面（浅色约紫色 8–10%，深色约 14–16%），selected icon 可使用克制紫色；pressed 比 hover 稍深，但不做 `translateY`。绝不能恢复左侧紫色竖线、inset rail 或改变图标坐标。只过渡 `background` / `color` / `border` / `opacity`，至多极小 `transform`；禁止 `blur` / `filter` / `box-shadow` 过渡，也禁止 `padding` / `margin` / `border-width` 等会改布局的属性。危险操作用红，主 CTA 保持可识别，不得被通用中性规则抹平。文本链接只做下划线 / 透明度，不强铺底。
- 风险、过期、无命中、阻断、未接入不能只靠颜色，必须有文字。
- 闲置狐狸：2.8–3.2 秒一轮，3–4px 浮动、约 2° 摆动、最大 scale 1.04。紫色呼吸光晕拆到独立层，在 88px native bounds 内约 76px 内层 / 84px 外层双层 radial（最多留 2px 安全），只动画 opacity（约 3.0–3.4s，`.52–.60` 到 `.92–.95`）；FoxHead 只保留很轻的静态 drop-shadow，idle keyframe 不再动画 filter。稳定贴边时狐狸以与 idle 同周期的镜像 ready motion 朝屏幕内探身：峰值约内移 3px、上抬 2px、向内倾 5°、scale 1.035，呈现跃跃欲试但不脱离半露裁切；只允许在 `.fox-head` 上动画 transform，不能动画负责裁切的 `.fox-idle` 根节点或 `.fox-head-image`，避免 Query handoff 姿态跳变。贴边与非贴边统一紫光且 dock 自然裁半，无白 glint、无白点眼、无霓虹多圈、无实色圆盘。默认主题取消闭合蓝圆；键盘焦点只由明确 keyboard focus origin / `data-fox-keyboard-focus` 显示为双耳外侧短弧紫色剪影，不得由裸 `:focus-visible` 直接画出，也不得覆盖脸或耳麦。pointerdown 同步清键盘焦点；press / drag / session / settling / handoff 全部隐藏。`forced-colors` 仍用系统 Highlight。snap / peek / retract / warning / handoff 优先于 ready motion 并暂停 halo；warning 保留黄点与黄语义轮廓、不叠紫。reduced-motion 关闭 ready motion 并保留较明显静态紫轮廓；reduced-transparency / forced-colors 关闭 aura。CSS 变量是生产 SSOT。应用 Dock / 任务栏图标使用独立 1024 master：约 896px 连续圆角近白 squircle 底板、狐狸按有效 alpha 边界光学居中并占底板约 74–76%，四角透明。
- 狐狸姿态分三层，不进入 Main 的 OverlayPhase / IPC：structural `handoff > snap > peek > retract > dragging`；transient `none | pressed | dragging | annoyed-drag`；ambient `awake | following-local | drowsy | sleeping`。warning 是 modifier，暂停 ambient。派生单一 `data-fox-pose`。指针只在现有 88px Fox 窗内时，整只狐狸做局部跟随（≤1.75px / ≤2°，rAF 合帧，离开回正）。这是整头局部跟随，不是全局 eye tracking，也不宣传眼球追踪。角色只有一颗位于帽檐与暖色脸交界的中央椭圆眼，外加眼底一条短竖线；运行时表情层只能覆盖并重绘这同一颗眼，不得新增白点眼、双眼珠或双侧卡通眼。无操作约 8s 进入 drowsy、约 14s 进入 sleeping：中央眼逐步闭合，狐狸下沉内倾为趴睡姿态，地面影展开并显示朝屏幕内侧漂移的 `Zzz`；Fox 隐藏 / fox-edge / sync / 指针 / 聚焦 / 打开查询都会唤醒并作废旧 token。主键按下约 110ms squash 表示戳 / 按住；超过既有 4px 阈值后进入拖拽方向倾斜 / 被提起，同时同一眼区显示棕色 `><` 应力表情；长时间或较长距离拖住后播放 ≤1.2s 的一次性烦躁拖拽。局部跟随或刚唤醒时，耳罩外侧可播放两轮有限声波；睡眠、拖拽、warning、snap / peek / retract、handoff 与 reduced motion 必须停波，不能新增常驻第三循环。现有左右贴边半露 + inward-ready + hover peek / retract 就是本项目的 mini mode，保持不变。Query 的 SEARCHING / RESULTS / EMPTY / COPIED 业务动画不受 ambient 污染。不实现全局鼠标轮询、真实 free-roam、逐帧 setBounds、双击 / 多击累加器；首击必须立即打开 Query。
- 遵守 `prefers-reduced-motion`：取消持续位移、呼吸和吸附变形，只保留克制静态轮廓。`prefers-reduced-transparency` 与 `forced-colors` 关闭 aura filter，保留系统 focus。

### 字体与尺寸

- 中文使用本地系统栈：PingFang SC / Microsoft YaHei UI / Segoe UI，不引入网络字体。
- 狐狸与查询条：输入 16/24；正文 14/22；辅助信息不小于 11px；外壳圆角约 22–24px。工作台与登录窗的字号、圆角见上文「工作台与登录窗」。
- Float 采用双窗共享元素交接：主进程一次性提交目标 `BrowserWindow` bounds，先让隐藏 Query renderer 按点击瞬间狐狸的真实屏幕中心、64px 尺寸和当前 2D 位移 / 旋转 / 缩放矩阵准备代理首帧；renderer 回执 `open-armed` 后才显示 Query、隐藏 Fox 并启动约 260ms 的外壳 `clip-path` 展开。收起约 200ms，Query 抵达代理末帧并回执后才显示 Fox、隐藏 Query。贴边时 Query 与物理工作区边缘齐平，确保半露狐狸的 32px 可见轮廓连续。定时器只作异常兜底，不作为正常完成信号；禁止逐帧原生 resize、双狐狸错位、完整面板首闪或两窗同时不可见。玻璃层只做透明度变化，不再与 `backdrop-filter` 一起缩放。检索反馈至少 280ms，结果卡依次进入。

## 4. 关键组件

### 狐狸头

- 资源：保留根目录用户原始 `logo-wordmark.png`。本仓原创确定性 master 是 `apps/desktop/assets/fox-head-master.png`（1254 RGBA raster canonical，由用户批准的透明构图确定性 scale/pad + 高置信内部 recolor 生产化；禁止 Bézier 临摹或把已否决 SVG 当 SSOT），由 `apps/desktop/scripts/generate-fox-head.mjs` 字节一致派生透明 `apps/desktop/fox-head.png`。角色 DNA：有机非对称旧帽子（左耳更高更窄且略外倾，右耳更低更宽，帽檐带轻微自然斜度）、宽紫帽檐遮眼、下半脸严格纯色 `#F9D6C5` / `RGB(249,214,197)`、唯一中央眼为小横向椭圆 `#A45C4A` / `RGB(164,92,74)`（上半略跨入帽檐、下半进入暖色脸）、眼底一条短细深紫竖线、客服耳麦。禁止镜像式对称头盔、白点眼、双侧短弧、卡通大眼、紫色 U 形舌、笑嘴、脸部阴影块。40px Dashboard 静态简化，18/20px Tray 不依赖眼细节。Float / Query / Tray 共享根 `apps/desktop/fox-head.png`；Dashboard 浅色复用该视觉，深色使用同几何的独立 `apps/desktop/src/renderer/assets/dashboard-fox-headset-dark.png` 只改耳麦颜色。耳罩与短麦杆在 64 / 40 / 18px 仍可辨识；不得用整图 CSS filter 把狐狸一起反色，也不得污染共享 Float / Query / Tray / Dock 资产。Tray 不得使用白底 Dock 图。
- 可点击打开，可拖拽移动。
- 拖到左右桌面边缘后自动收缩；收缩后保留可点击把手，不完全藏掉。
- 贴边态悬停 / 键盘聚焦时，renderer 从等效 44px 半露裁切过渡到 80px 探头裁切，左右使用 420ms 镜像原创动效；离开后以 300ms 反向动效缩回。原生窗口 bounds 保持稳定，禁止逐帧 `setBounds`。
- 拖拽必须在 `pointerup`、`pointercancel`、`lostpointercapture`、窗口失焦或检测到主键已释放时立即终止；结束后的鼠标移动不得继续带动窗口，也不得误触打开。
- 查询胶囊内按业务状态切换狐狸反馈：`SEARCHING` 寻找、`RESULTS` 弹跳、`EMPTY` 歪头、`COPIED` 点头；业务状态优先于待机循环。
- 闲置狐狸单击打开查询；查询胶囊内同一狐狸单击收起查询，拖拽仍只移动窗口。
- 快捷键注册失败时要有可见降级提示（警示点 + 查询窗横幅），禁止静默失败。
- 有话术更新时狐狸内侧画品牌紫点（`--fox`），与快捷键失败的黄故障点可同时存在，互不覆盖。紫点只读未读投影，不 ACK、不 mark-read。无会话、无基线不点亮。

### 查询胶囊

- 左侧同一狐狸头，右侧输入，Enter 查询，Esc 收起。
- 打开时自动聚焦并全选已有内容；应用或窗口恢复焦点时只恢复键盘路由，不再次全选，避免下一键覆盖已输入问题。
- 中文 IME 组合输入期间按 Enter 不得误提交。
- 空查询给出明确提示，不检索。
- Dashboard 图标是清晰但不抢主 CTA 的次入口，具有 `aria-label` 与 tooltip。未登录点它先走「登录」，成功后再打开工作台；打开后 Float 收起为狐狸。
- 查询胶囊的玻璃外壳、输入井、次入口、查询按钮与结果卡沿用白主紫锚的克制材质，观感接近专业桌面输入工具；不得新增装饰文案，也不得改变共享元素交接几何、打开关闭 ACK、焦点 / IME、检索、Top 3、复制、窗口尺寸或 IPC。
- 接入模式可显示只读版本横幅（当前 release / 公告标题）。ACK 只表示客户端核验动作，不得写成已读、已同步或已生效。
- 狐狸右键使用主进程固定生成的原生菜单；系统 Tray / 菜单栏与应用菜单提供「打开话术查询」「打开运营工作台」。这些可信入口直接调用主进程窗口动作，不允许 renderer 传任意菜单或 command，也不放宽 `dashboard:open` 的 query-only IPC 门禁。
- macOS 程序坞图标代表完整应用表面：应用已就绪后点击程序坞打开 / 恢复单例 Dashboard，不展开查询；首次启动仍只显示狐狸。
- 「智能检索」是查询胶囊右侧小开关，默认开。它只允许 MiniMax 规划检索式并重排已有话术 id；不得生成或改写 Answer，也不得出现「AI 正在生成答案」。关闭、缺 key 或超时则只走本地 BM25。
- macOS 收起查询（Esc、点狐狸头、再按快捷键、复制后自动收起）必须把键盘还给上一个应用的输入框，坐席不必再点那个窗口。工作台 / 登录 / SOP 可见时不得用 `app.hide()` 把它们一起藏掉。

### FAQ P2 合成查询

显式 FAQ profile 复用查询胶囊、Top 3、键盘与复制反馈。胶囊仅提供“筛选”入口，店铺及商品/场景多选在结果区顶部，沿用 600px 宽与内容测量/ACK，胶囊保持 88px。词项支持名称查找和清除；未选择的维度只检索通用条目，不表示全选。换店清除条件；换条件撤回结果与复制资格、保留客户问题，等待手动查询。单店自动选择；空词表明确显示。店铺名称来自已冻结的只读目录；名称未取得或过期时退回明确的店铺 ID 并提示，不虚构名称。同名店铺附编号区分。该 profile 隐藏尚未接线的智能检索。

FAQ 卡片使用自己的合同：标题、正文原文、适用说明、风险提示、发布版本与资格截止；不补造旧卡片的平台、风险等级或匹配原因。无命中和空店明确展示，复制仅表示“已复制”。已知撤权、退出、换店、到期撤正文与复制；普通新发布不主动清空当前仍有效结果。告知门禁必须保持可见，后台店铺读取不能收起它。

FAQ 管理在显式合成 profile 中消费 OpenAPI 1.20.0 引入、当前 1.21.0 承接的确认直发合同。新 `direct-v1` 候选不发起或刷新组织审批；来源与人工质量检查满足要求后，有当前范围发布权限的人可提交。Main 冻结发布输入，再用原生二次确认展示标题、来源与候选版本；默认和关闭均为取消。取消保留表单、不登记待提交操作、不请求发布；会话变化、窗口销毁或权限到期后的迟到确认无效。renderer 只传发布意图，不能在命令中提供候选摘要、操作 ID 或确认结论来替代 Main。二次确认不代替当前权限、来源、质量和版本冲突检查。

FAQ 纠正回退先展示上一发布版本及全部影响范围，再由 Main 冻结计划并原生确认；弹窗显示当前版本、目标版本与影响范围，默认取消，确认后重新核对会话与权限。回退创建新发布版本，不直接移动历史指针；越范围时只能在有权范围上传纠正稿。旧 `approval-v1` 候选保留只读审批历史，首次直发须显式修订或重新导入，不能原地换政策。已确认的直发未知操作仅恢复精确原输入；旧协议未知发布或回退只查原回执，不转换成新的确认请求，也不伪造审批通过。合成实际 Electron/HTTP/PG15 证据与人工设备验收分开，见[FAQ 验证方法](docs/how-to-verify-desktop.md#faq-原生上传与报告)。

资料管理的当前步骤提示只解释 Main 投影，并导航到既有材料、来源、质量或发布区域，不触发业务操作、不保存第二套流程状态。回执与当前状态分别呈现；未知写恢复原操作。存在回退输入、活动回退计划或未知回退时，保留回退区域自己的提示，不用候选步骤误导。权限及资料日期显示本机可读时间和对应 UTC 偏移，传输与到期校验保持原时间戳。主要提交与危险动作分别复用现有 primary / danger 样式，确认与取消同组保留工具栏间距。

### FAQ P2 工作台接线

显式 FAQ 合成 profile 使用下面「当前工作台（faq-v2）」的六个页签和同一外壳。导航 id `content` 显示为「知识库」。切导航不丢尚未提交输入，隐藏期间继续接收会话与资格失效。FAQ 是统一资料格式，不是第五个库，也不采用旧内容页“缺行整库替换”的语义。

### 当前工作台（faq-v2）

> **页签列表已作废（2026-10-24）**：工作台改为七页（概览、话术库、SOP、知识库、资料、权限、账号），见[前端设计结论 §6](docs/plans/2026-10-24-frontend-design-decisions.md)。下文六页签规格只作历史记录；其中「复制只表示已复制」「不得用样例数字」等内容约束继续有效。用户可见文案「未接入」改为一句何时会有数据，「读取资格已到期」改为「登录状态需要确认，请重新登录。」

这一节是 faq-v2 六个页签的唯一视觉和交互规格。下文「演示级 Dashboard」里的 KPI、整库替换、下架、系统同步四张卡和 SOP 树只属于旧 profile。顾问和实现都不得把那些旧模块画回这一节。外壳仍用同一套侧栏、48px 顶栏、折叠动效和紫色 token。不另做蓝色主题，不搬数字员工、培训、巡检或云数据向导。

动效只改变透明度、颜色和背景。侧栏折叠 180–200ms，`cubic-bezier(.2,.8,.2,1)`。导航 hover 在 120–160ms 内出现整行中性灰。选中是整行淡紫，图标可以用克制的紫，不画左侧竖线，图标坐标不动。按钮 hover 只换背景。弹层用短淡入。`prefers-reduced-motion` 直接到终态。不许弹跳、发光、漂浮，也不把狐狸的浮动语言用到工作台。

侧栏已经是页面名。顶栏不再重复这个名字，也不写 `PILOT`、`SYNTHETIC`、`DEMO` 或「演示数据」。顶栏右侧只留主题按钮。侧栏底部不放「合成验证」说明。页内不写长说明。没有冻结接口时写「未接入」，这是缺接口，不是故障。瞬时失败才写「请重试」，并且必须有重试按钮。资格倒计时还没开始，不得显示「读取资格已到期」。

图标必须对上名字，20px、24 viewBox、线框：管理概览用四宫格，话术库用书，SOP 用清单，知识库用文档，权限用钥匙或人，系统同步用循环箭头。知识库不得用上传箭头。权限不得只剩一个勾选框。系统同步不得用铃铛。

六个页签：

1. 管理概览。可以有使用排行、SOP 使用、无命中排行、话术过期提醒、迭代待办，以及趋势和占比。这些可视化必须来自真实口径。没有接口时该块写「未接入」，不得用预览样例人数、次数或命中率充当生产数据。命中率口径未确认前，正式界面不把它写成已核定指标。迭代待办继续用真实待办：只列待处理和进行中，原因是内容缺口、排序问题、过期仍召回、待判。内容缺口的「已处理」要等更新的已发布版本。没有待办时写「当前没有待办」。待生效和已失效来自知识库真实状态，不变成不准行。
2. 话术库。已发布目录，只读白表。筛选只有一行：目标店铺、话术类型、问题、刷新图标。话术类型页签是产品、活动、售前、售后，再加一个 SOP 页签。SOP 没有真实目录时该页签写「未接入」，不显示静态假流程。空条件是通用条目，不写成全店总库。不能在这页改正文、下架、导出或复制。
3. SOP。没有打开原始表时只有「未接入」。不放假流程树，不放「SOP 接口」开关，不加步骤埋点。运营在本机打开六表 xlsx 后，只读展示候选原文，标题写明未发布，坐席流程不切换；图片不入库。这不是 `POST /v1/sop/import`，也不写入产品目录。
4. 知识库。白底表。人设是下划线页签：全店、售前客服、售后客服。右上主按钮是实心 `var(--dash-purple)`、白字、「添加话术」。添加层点遮罩或右上角关闭。列只有：话术名称、话术内容、状态、最后更新时间、操作。不编造「最后更新账号」。不在这页放隐性知识，也不写「坐席会收到 N 条」这种说明。运营可改有效期、删除。坐席只看已生效的行。状态用文字：未生效、待生效、生效中、已失效。
5. 权限。选配置范围之前就有人员表头。列是姓名、登录名、岗位、状态。授权和撤销是分开的按钮。撤销用 danger，不写成淡红说明块。不放「停止等待」，除非真的有进行中的请求。不写人员不可用时的长说明。
6. 系统同步。一行状态：当前发布版本、条数、资格截止。软件更新单独写「未接入」。不说全库已同步，不画四张库卡。下面是使用情况：时间、坐席、客户问题、命中话术、结果。问题被抑制时显示「已脱敏」。已复制只表示进了输入框，不等于已发送。接口没接上时写「未接入」。安装包默认仍打开 React 工作台。独立 HTML 稿不放进仓库。

没有接口的记账保持「未接入」：复制、无命中、不准不能在现有事件里同时记下问题和发布版本。门槛和关单规则可以留在界面上，但不得用样例数字冒充生产计数。

话术库通过独立 Dashboard 只读目录消费者展示“当前店铺和商品/场景条件下可用的话术”，按四域 Tab 分组；空条件只代表通用条目，不能标为全店总库。域来自本次使用资格中的来源范围。目录与 Query 各自持有选择及资格，目录刷新/条件选择不改变 Query 的选择和有效复制资格；打开工作台仍遵循既有浮窗收起并取消旧查询结果的生命周期。仅展示新合同已有原文、版本、有效时间、分类、适用说明和风险提示，不补造平台/风险等级，不提供旧下架、导出或复制入口。完整分页成功后才显示，过期、退出或确认权限失效时撤回正文；失败可见且可重试。

系统同步和其余五个页签的画面以「当前工作台（faq-v2）」为准。下文旧 hydrate、旧 owner 发布/下架和 Announcement.summary 规则只适用于旧 profile，不能作为新 FAQ 的画面或写入回退。

### Top 3 话术卡

每张卡必须显示：适用场景、渠道 / 分类、有效状态、非数字匹配原因、话术正文原文、明确的「复制话术」按钮。

主演示问法应稳定给出三个独立、互补且合格的合成候选。第一条可以高亮，但绝不自动复制。

未登录的 S0 本地检索以现有字符 bigram / trigram 与完整问法为主，并独立增加 fixture 级的合成实体锚点、别名和规则意图辅助。纯意图词不能单独制造命中；强品类文本 + 匹配问题主题 / 意图可在词法下限之上受控召回自然问法。未带合成品牌的宽品类别名只有在去掉别名与已支持意图后不剩未知文本时才成立，防止陌生品牌串话术。有效期硬过滤、ID / 正文去重完成后才截取稳定 Top 3，该路径下答案正文永不参与召回或改写。合成登录且已加载 hydrate 时，召回改走 main 的 BM25(标题/问法) ∥ 仓外 embedding(正文)（失败则 BM25 正文）+ RRF，不再用 leftover `/v1/search` 换标题；见 [桌面语义检索](docs/reference-desktop-retrieval.md)。该能力为本仓 clean-room 实现，不复制旧学习项目的代码、词典、参数、数据或真实话术。

**禁止展示数值匹配分。** 过期与未生效内容永不进入结果。

### 演示级 Dashboard

> **整节已作废（2026-10-24）**：旧 profile 的五模块、拖宽规则与主题菜单键盘细节不再约束实现。保留下方「复制不能推断发送、采纳、未修改或回答正确」一句。

左侧可折叠分组导航 + 顶栏 + 内容区，键盘可访问。展开宽度可在 `216–360px` 内拖动或键盘调整，默认 `248px`；折叠采用平台化 collapsed surface（macOS integrated `120px`，Windows / Linux native `72px`），展开时恢复本次会话的上次宽度。折叠态分隔条仍可命中：向右拖从 collapsed surface 连续预览到 207，超过滞回 expand threshold（`208`，相对 collapse `192`）后先保持当前 raw 至少一个已提交布局帧，再进入既有 expanding 并约 190ms 恢复 `lastExpandedWidth`（至少 min `216`），无需 pointerup；阈值以下松手 / `pointercancel` / `lostpointercapture`（即使 `buttons===1`）/ blur / `buttons=0` 从当前 preview 平滑弹回 collapsed surface 且不误展开；回滚后分隔条公开 `aria-valuenow=平台折叠宽度`，保留 `lastExpandedWidth`，不把上次展开宽度写回 collapsed 态。键盘分隔条在折叠态：ArrowRight / Enter 展开，End 展开到 max，Home / ArrowLeft 保持 collapsed surface。拖动期间 titlebar drag 临时 no-drag，pointer 合帧，不每帧 setState，不动画 backdrop-filter / filter / box-shadow / padding / margin。图标锚点在四阶段不变（mac `nav.left+60` / native `nav.left+36`），只裁切文字；collapsing / collapsed / expanding 期间 brand copy 与 nav labels 必须 `opacity:0`，expanded 结构过渡完成后再用 100–120ms 淡入。折叠态图标在 hover / focus 时于侧栏外显示明确名称。狐狸 Logo 保持原槽位，不再叠加展开按钮。主内容只使用系统滚轮、触控滚动与原生滚动条，不把鼠标按住拖动解释为滚页。`980×680`、`1180×760` 与更大窗口下不得出现页面级横向遮挡，图表和卡片按断点重排。5 个可切换模块：

品牌区使用用户的透明狐狸头 Logo，不使用紫底「狐」字块。模块导航只显示短名称，页面解释放在内容标题或顶栏。侧栏是唯一固定玻璃层：浅色最终视觉约 `#f2f2f6..#f5f5f8`，深色约 `#121116..#17161c`，与 main 平均 RGB 差至少约 9；`20px` blur + saturate、单一中性 hairline 与极轻顶部高光。顶栏、主区、卡片与表格使用不透明实色（main light `#fff` / dark `#1c1b20`）和极轻内高光，不单独做 blur，正文保持 `--dash-ink` 对比。外观由 `data-dashboard-theme` 显式 token 与 shell / form control 继承的 `color-scheme` 共同决定，手动浅色 / 深色不得再走 `light-dark()` 的系统分支。侧栏导航未选中行默认透明；hover / focus-visible 在 120–160ms 内出现完整中性灰高亮框；selected / active 使用淡紫完整高亮面，selected icon 可用克制紫色，不再使用 3px 左侧紫色竖线、inset rail 或任何 selected 紫色定向边框，也不因此改变图标坐标。侧栏折叠使用固定 Logo DOM + 同一个持久 PanelLeft 按钮（同一 ref / testid / aria-controls），四阶段只切换 `aria-expanded` / label / icon。结构以 shell 的 `grid-template-columns` `transitionend` 正常收口为显式 `expanded / collapsing / collapsed / expanding` phase；`transitioncancel` 仅在实际结构边界已到达当前目标时 settle，否则等待新的 `transitionend`。动态切换到 `prefers-reduced-motion` 必须立即终态。折叠 180–200ms `cubic-bezier(.2,.8,.2,1)`，labels / brand copy 在 collapsing / collapsed / expanding 保持 `opacity:0`，expanded 结构完成后再淡入，不以 `max-width` 瞬断造成布局跳。品牌、标签与列表必须稳定裁切，resizer 保持可命中。不 bounce，不让 icon x/y 位移，toggle glyph 只在同一槽位 crossfade/scale。`prefers-reduced-motion` 直接终态。鼠标操作不强制焦点，键盘 / 虚拟点击在终态用 `useLayoutEffect` + `focus({ preventScroll: true })` 交接。Logo 槽与按钮 `no-drag`，独立 titlebar strip 保持 drag；拖宽期间 topbar / titlebar strip 必须临时 no-drag。侧栏按钮、主题 trigger 与 `menuitemradio` 桌面最小 `40×40px`，粗指针提升到 `44px`，使用行业通用的 PanelLeft 线框图标。Dashboard 外观由右上单一主题 trigger（`aria-haspopup=menu`）打开小型 menu，内含浅色 / 深色 / 跟随系统三个 roving `menuitemradio`；ArrowDown / ArrowUp 可从 trigger 打开；支持 Home / End、Enter / Space、Escape。Escape 与提交归还 trigger；Tab / Shift+Tab 关闭并移出到相邻可聚焦控件，不抢外部焦点；外部指针只关闭、不归还焦点。默认跟随系统，仅在当前 Dashboard 会话内生效，不读取或写入持久化存储，并保持 `matchMedia` 实时联动。菜单当前项用淡紫 selected，hover 灰。`forced-colors` 下选中面必须 `Highlight` + `HighlightText`；tooltip / popover 必须 `Canvas` / `CanvasText` 且 `backdrop-filter: none`。管理概览去掉装饰性上下 / 竖分隔与列表首项顶线，只保留结构线。矩形筛选状态用 8px，语义 chip 用 pill。其余动效优先 `opacity / color / background`，不沿用桌宠的弹跳、发光或漂浮语言。

下面这一组是旧 profile。faq-v2 不得使用它。旧 profile 的主标题只使用「客服运营工作台 / 运营管理端」，不使用英文概念口号。旧管理概览以固定统计范围、语义化待处理决策表和连续 KPI 条为首屏骨架。决策行只渲染冻结合同已有字段（事项、Owner、下一步、状态）；影响 / 处理窗口没有接口时写「未接入」，不得发明数字。没有活数据时整页空态，不提供无法真正改变数据的假全局筛选。

1. 管理概览：统计范围、KPI 条、话术优化待办；有产品会话时 KPI 读检索账无命中率 / 复制完成率
2. 话术库：已发布目录管理员。有检索租约且与目录 `releaseId` 一致时写「当前发布已挂载」；否则写「本机目录」，不装成坐席正在搜的发布。详情可下架（Owner DELETE → pending_review，坐席要等下次发布才搜不到）。不在这页上传或改正文。发布成功后话术库跟 announce 内存 snapshot，与四卡同一份 `rel_N`。
3. SOP：有产品会话时读/导入/更新当前会话树，删除仅管理员；没有会话保持未接入，不把合成过敏树当运营目录
4. 内容管理：顶栏右侧「取消未完成导入」与「发布」同一行（取消在左、主 CTA 在右），原因与发布反馈在动作行下方。发布成功主句 `已发布 rel_N · 姓名`；有 `summary` 才画第二行四库 delta，失败不画 delta。成功后发布钮保持禁用，直到清除预览或重选文件；发布进行中取消钮仍可用。标题旁是产品会话徽章，不是发布权徽章：`StatusBadge` 只表示产品会话是否已登录——无会话或未登录写「未接入」（warn），首次 `session()` 未返回写「正在确认会话」（neutral），已登录写「已接入」（ok），即使该角色当前不能发布也仍是「已接入」，原因只走 `CONTENT_PUBLISH_COPY`。会话说明书只放在徽章 `title`，标题行不再跟一句「导入与发布走产品会话」。标题下方是常驻「将替换」下拉（产品 / 活动 / 售前 / 售后），在导入折叠外；发布前必须手选目标库，不能靠文件名默认。选错会整库替换到选中域；表里识别到的库和将替换不一致时，点发布先确认再 POST。发布成功留在本页看回执，回执下给「去系统同步」「去话术库」。「内容导入」默认折起，选表 / 状态 / 预览在折叠体内，读文件进入 reading / ready / error 自动展开。本地 CSV / xlsx 导入；Owner 校验通过后 staged 并发布。组织审核在飞书文档，产品内不再 park 双人复核
5. 系统同步：本版 changelog。话术版本更新第一屏是四张卡（产品 → 活动 → 售前 → 售后），徽章写「本版已更新」或「本版沿用」，卡面只跟条数，不把徽章句子再写一遍；点卡切到话术库对应域；未读紫点跟在库名后面。卡状态只解析 `Announcement.summary`，summary 读不出时写「无法标出本版更新了哪一库」，不冒充沿用。脚注写「当前发布 rel_N」。Owner 软件目录列出 signed/unsigned，禁止 `latest.yml`，目录进页即读、不把 latest.yml 写进说明书。「打开下载页」由 Main 用当前建议版本的 https `download_url` 打开系统浏览器，renderer 不传 URL。ACK 不是已读。

侧栏业务导航图标由单一 `--dash-nav-icon-size: 20px` 同时驱动 `.dashboard-nav-icon` wrapper 与 SVG `width/height`，保留 24 viewBox / path / stroke。导航文字用静态 `--dash-nav-label-shift: calc(var(--dash-brand-copy-shift) - 4px)` 再靠近约 4px，expanded 态 icon-to-label 间隙约 14px。不改 PanelLeft toggle、品牌狐狸 40px、icon slot、macOS `nav.left+60` / native `+36` 锚点、8px inset、42px hit row、selected `::before inset:0`，也不给 icon transform。

一期导航不再包含 VOC / 工单垃圾桶 / 离线抽样 / 架构图。复制不能推断发送、采纳、未修改或回答正确。

话术库与内容发布必须分开：话术库是已发布目录（可导出 CSV，详情「下架」），内容管理是用一张表替换四库之一。话术库读当前发布 hydrate（与查询胶囊同一份目录；hydrate 为空才回退本机检索索引），不复制、不上传、不改正文。Owner 下架走 `DELETE /v1/content/scripts/{id}`，进入 `pending_review` 草稿，不能跳过 dual-review，发布后才离开当前目录。屏幕写明坐席要等下次发布才搜不到。没有登录或没有数字时写「请先登录」或「暂无记录」。不要因为话术库挂上当前发布就宣称工作台已接正式后端。

不读取 Float 真实输入，不写磁盘，不用 localStorage / IndexedDB。

Owner 发布必须走冻结合同：导入校验通过后 staged，再 `POST /v1/content/publish`。组织审核在飞书文档。没有会话时按钮保持禁用。角色不够时写请谁发布，不写成没连上。已登录写「已登录」。发布禁用原因只走 `CONTENT_PUBLISH_COPY`。

### 状态与反馈

- `EMPTY`：明确「没找到可用话术」。提示先让客户稍等，再联系话术师或运营核实，必要时升级客服经理。可复制联系方式或打开求助入口。状态只允许「已打开入口 / 已复制联系方式 / 待核实」，禁止「已转交成功」。S0 未接线时说明当前没有可用的升级入口。查询胶囊不把 ACK 画成已读。内容发布后可以出 `--muted` 横幅（「售前话术已更新」），禁止因此抽空 Top 3；真正失效才走 `is-invalid`。
- `SEARCHING`：查询按钮显示本地检索动效；用户改动问题时取消旧检索。
- `ERROR`：保留输入，给出可重试动作。
- `COPIED`：只显示「已复制」。绝不能写「已发送」「已采纳」或「已解决」。
- 复制成功后只显示「已复制」约 900ms，再自动收起回狐狸头。

## 5. 可访问性与键盘

- 所有可操作元素都有可见 focus。狐狸默认主题不用闭合蓝圆，只用键盘态紫色短弧剪影；`forced-colors` 用系统 Highlight。
- 复制反馈使用 `aria-live="polite"`。
- Dashboard 左侧导航支持方向键切换，有明确选中态。
- 对比度分别按浅色与深色语义色校准；主要侧栏、主题 trigger 与 `menuitemradio` 桌面至少 40px，粗指针设备提升到 44px。

## 6. 明确禁止

- 不生成自由回答，不显示「AI 正在思考」。
- 不使用 Menokin 名义、真实产品事实、真实客户原文，也不对真实话术做近义改写。
- 不把 copy 解释为发送、采纳、正确、解决或自动学习。
- 不实现陪伴型桌宠、进程监听或聊天窗口标题监听。
- 不把 Dashboard 宣传成已接通 PostgreSQL、九端口、工单回写或生产发布。
- 不复制 Clawd / DeepSeek 的源码、Logo 或 All Rights Reserved 资产。

### 附件借鉴矩阵（clean-room，不是复制或兼容 Clawd）

只读附件 `clawd-on-desk-0.15.0.zip` 的根源码是 AGPL-3.0，`assets/LICENSE` 明确 SVG/PNG/GIF/ICO All Rights Reserved。本 Demo 禁止复制、改色、转描、提取或提交其中任何资产 / path / 代码 / 图像，也不执行 ZIP 内脚本、hooks、postinstall 或 package。以下只借鉴抽象的“状态分层与动作节奏”，并用本仓已有紫色客服耳麦 `apps/desktop/fox-head.png` 做原创适配：

| 类别 | 内容 |
| --- | --- |
| 落地 | 88px 窗内整头局部 follow；可中断 sleep / wake；press / drag / long-drag reaction；现有贴边 inward-ready + 半露 + peek / retract 作为本项目 mini mode |
| 仅理念 | 动作优先级、左右镜像、被抓住暂停 ambient、睡眠被局部活动唤醒、free-roam 的可中断性（free-roam 未进入产品） |
| 明确不做 | ZIP 资产 / 源码、全局追踪、真实 roam、双击 / 多击 accumulator、per-frame native window move、眼球追踪宣传 |

### 显式合成后端接入 profile（D2）

> **整节已作废（2026-10-24）**：这是旧的查询接入剖面，与任务卡里的 D2（加载与反馈）无关，名字重复容易混淆。坐席查询的现行规则见上文「查询胶囊」「FAQ P2 合成查询」「Top 3 话术卡」。

登录后的查询通过 main 获取 Top 3 原文，保留人在环和“已复制”语义。查询前手动确认平台及商品范围；无具体商品仅查全店话术。上下文控件和占位符输入位于结果区域，纳入既有 DOM 高度测量，不改变胶囊与原生窗几何合同。接入模式显示「智能检索」开关（默认 ON），不再使用「深度思考 · 预留」说明入口。接入故障显示可恢复错误，不回退本地 fixture；旧 S0 profile 保留原合成 n-gram 检索。
