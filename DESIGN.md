# 客服 Agent 产品视觉与交互基线

> **仓库身份：** 客服 Agent 产品实施仓；见 `PROJECT_CHARTER.md`。
> **当前实现状态：** v3 双表面原型模式。Float 仍是输入法式狐狸头；另有一个演示级 Dashboard 讲正式架构故事。
> **证据边界：** 当前屏幕使用合成数据，不等于正式接入或上线，也不代发消息。Dashboard 是交互式合成 BI 与架构模拟，不是已完成的生产 BI / 后端。

本文件拥有产品视觉、交互和内容表达的不变量。下文 “Demo” 指当前原型模式；后续正式数据和服务接入不得推翻已经冻结的人在环、复制语义、可访问性与桌面交互基线。

## 1. 产品印象

第一眼仍应是：**桌面上的输入法式控件**——平时只剩一颗狐狸头，需要时展开成玻璃查询胶囊，给出 Top 3 原文让坐席自己复制。

第二眼才是工作台：查询胶囊上有一个带可访问名称的 Dashboard 图标入口；狐狸右键菜单、系统 Tray / 菜单栏也提供同一入口。打开后出现**白为主、紫为识别锚点**的客服经理决策窗。首屏先回答“哪里在恶化、为什么、让谁处理”，再展示 VOC、四域话术、检索与治理证据。所有中心能力必须显著标为 `架构模拟 / MOCK / NOT CONNECTED`。

它不是 520×760 的普通浮窗工作台，不是聊天机器人，也不是陪伴型桌宠；紫色只用于品牌、键盘焦点剪影 cue 和必要的关键动作，不铺满页面，也不再作为选中导航的默认色。默认主题的狐狸不使用闭合蓝圆。

## 2. 窗口与结构

三个 `BrowserWindow`，职责分开：

1. `FOX_IDLE`：约 88px 透明狐狸头常驻窗（含动效留白）；无边框、置顶、跳过任务栏。狐狸视觉约 64px。
2. 查询窗：约 `600×88` 的玻璃胶囊；透明 frameless、原生 `resizable: false`，不开放 width / x / y / bounds IPC。正常结果路径按 DOM 实测 hug：capsule 88 + banner + `result-content` scrollHeight + border/padding + 约 20px grip，经 typed query-only layout IPC 上报后 Main 钳制到 `240..min(620, availableHeight)` 再一次 `setBounds` 并 ACK，然后才显示内容。旧分档 `240 / 340 / 430 / 620` 只作异常 fallback。自定义仅纵向 resize grip；collapse 必须用 Main 按真实狐狸屏幕中心减当前 query bounds 算出的 `handoffCenterX/Y`。小屏或超过 620 只压缩结果区滚动，胶囊 88 不缩。与狐狸同为 overlay。
3. Dashboard：约 `1180×760`、最小约 `980×680` 的标准系统窗。正常 frame、可缩放、非透明、非置顶、显示在任务栏。macOS 使用 `titleBarStyle: 'hiddenInset'`：隐藏原生标题栏文字，保留红黄绿交通灯以及拖动、缩放、最小化 / 最大化 / 关闭；侧栏与顶栏延伸进标题栏，形成一体 chrome。交通灯位置保持 `trafficLightPosition: { x: 14, y: 16 }`。共享 SSOT：macOS 标题栏高度 `48px`、交通灯 / 控件安全左距 `72px`，由 Dashboard renderer 以 CSS vars 消费，不经 preload / IPC。一体 chrome 下是真正的 48px 单行标题栏：drag strip 高 48，主 topbar 高 48 且不再 `padding-top: 38`，模块名 / 刷新信息 / 主题控件与 48px 标题栏同一中心线（约 y24）。品牌与导航从标题栏下方开始（block offset 48），狐狸 Logo 不与红绿灯重叠。同一个持久 DOM PanelLeft 控制按钮在展开 / 过渡 / 折叠 / 展开中都固定存在：macOS integrated 在红绿灯右侧 `left:72px; top:4px; 40×40`（`x=72..112`），由侧栏自有 titlebar control island 持有（顶部 `x=72..120`、高 48、透明 no-drag overlay、`pointer-events:auto` / 顶层 z-index），不再用 `position:fixed` 逃出 `aside`。island 不得填充玻璃或不透明侧栏、不得画第二条实体边线。几何职责必须拆开：traffic-light safe zone 为 `0..72`；toggle 占 `72..112`；toggle 右侧到 divider 固定 8px；macOS integrated 的 collapsed surface / 结构边界 / main 左缘 / topbar 左缘 / resizer 中线 / 唯一全高 divider 统一为 `120px`。Windows / Linux native 的 collapsed surface 仍为 `72px`。视觉结构列边界由 `--dash-rendered-nav-width` 驱动的 `--dash-structure-boundary` 单一 token 决定：mac 折叠 / collapsing 为 120，native 为 72，展开 / expanding 为当前合法展开宽度，拖宽预览共用同一条边界。左侧玻璃与右侧实色 main 都从顶到底是一张连续表面，分界线单一。折叠态 topbar / drag surface 只随共享边界移动，禁止 20→52 的局部 padding 补偿。Win/Linux 在稳定 48px 侧栏 chrome 槽，永不放在狐狸 Logo 上。只做 100–120ms glyph crossfade/scale，不位移 / 旋转 / 闪现。macOS collapsed 时 `toggle.right <= 112` 且 divider=120。macOS 四阶段 brand / nav icon 中心固定为 `nav.left + 60`，native 固定为 `nav.left + 36`，切态与拖动漂移不超过 1px；macOS collapsed 选中面必须围绕图标对称，不得留下 48px 空白假栏。侧栏拖宽 expanded 向左时视觉 preview 必须连续经过 `216→193`，不得在 216 形成死区；`lastExpandedWidth` 只保存合法展开终态。raw `<=192` 时从当前 raw 的已提交帧平滑约 190ms 收到 collapsed surface；raw=`193` 松手从 193 平滑回 216。折叠态向右拖 preview 连续到 207；raw `>=208` 后必须至少保持当前 raw 一个已提交布局帧，再约 190ms 平滑到 `lastExpandedWidth`（至少 min 216），不得在同一 pointermove 直接跳到 248/320。阈值前松手 / 取消 / `lostpointercapture`（即使 `buttons===1`）/ blur / `buttons=0` 从当前 preview 平滑回 collapsed surface，公开 `aria-valuenow=平台折叠宽度` 并保留 `lastExpandedWidth`。preview CSS 变量只允许在 `transitionend` 稳定后清理。重开恢复此前 `lastExpandedWidth`。标题栏空白为 `-webkit-app-region: drag`，按钮 / 导航 / 输入 / 分隔条为 `no-drag`。CDP click 不能冒充 OS 命中；折叠态展开按钮的最终验收仍需真实 macOS 鼠标。Windows / Linux 保持原生标题栏与系统窗控，不套 hiddenInset，也不使用 titleBarOverlay。窗口 title 仍为「客服运营工作台 · 演示数据」，供任务栏 / Mission Control 使用，不得被共用 `index.html` 的浮窗标题覆盖；侧栏业务标题「客服运营工作台 / 运营管理端」必须保留。应用菜单含原生 `fileMenu` / `role:close`：macOS `Cmd+W` 关闭当前 Dashboard，Query 则收回 Fox，Fox idle 无副作用；`Cmd+Q` 才退出。Windows `Ctrl+W` / 标题栏 X / `Alt+F4` 关闭当前表面。Dashboard 关闭后可重建单例，Fox / Tray 继续。Page 截图只证明 webContents，不含原生红绿灯；最终原生外观仍需真实 macOS 人工或 OS 截图验证。懒创建；重复打开只 focus 同一窗口；关闭后可重建；关闭 Dashboard 不得退出狐狸。运行期间 macOS Dock / Cmd+Tab 必须保持 regular activation policy。开发态 ready 后用仓内可追踪 `apps/desktop/assets/app-icon.png` master（1024 近白 squircle 底板 + 光学居中狐狸）直接 `app.dock.setIcon`，不依赖 ignored / stale `apps/desktop/build/icon.png`，也不把透明 `apps/desktop/fox-head.png` 用于 Dock。打包态用 `apps/desktop/build/icon.icns` / `apps/desktop/build/icon.ico`。Float、Dashboard Logo 与 macOS Tray Template 继续用透明狐狸。Query / Fox 可 skipTaskbar，应用级 Dock 图标保留。真实 Cmd+Tab / Dock 外观需人工 macOS 验收。

- 不再使用固定 `520×760` 工作台，也不再把旧 RecentPanel 冒充 Dashboard。
- Overlay 窗口尺寸等于可见控件，避免大块透明命中区吞掉桌面点击。
- 锚定在狐狸位置附近，并钳制到当前屏 `workArea`。
- 狐狸拖到当前屏左右边缘 18px 内时自动吸附：88px 原生窗始终完整留在工作区，renderer 在稳定窗口内平移裁切，令 64px 狐狸视觉左右都恰好露 32px；打开查询后仍从原侧向屏幕内展开。禁止把透明原生窗反复推到屏外与 WindowServer 争抢位置。
- macOS 台前调度的最近 App 条带可能把后台透明窗限制在一个未由 Electron `screen.workArea` 暴露的“有效舞台边界”。此时以 WindowServer 实际接受的 `BrowserWindow.getBounds()` 为该 dock epoch 的位置真值；hover peek / retract 只改 renderer 裁切，不得再次 `setBounds(workArea.x)`。打开 Query、共享元素中心与关闭恢复都从实际 frame 采样。目标是在系统接受边界稳定半露且不横跳；Electron 公共 API 下不承诺后台窗口一定占据物理屏 x=0。
- 查询与结果窗持续显示环境徽标：`DEMO`、`MOCK AUTH`、`SYNTHETIC DATA`。Dashboard 顶栏在 macOS integrated chrome 下就是 48px 单行标题栏：左侧模块名与紧凑刷新信息与标题栏同中心线；右侧只保留一个主题图标按钮、一个「演示数据」标识及极短边界文本「无后端 · 不保存」。完整 `MOCK AUTH / SYNTHETIC DATA / NO BACKEND` 与安全免责声明收进侧栏「演示环境」，避免把管理端做成 Demo 徽标墙。
- macOS 查询窗保留可激活的普通窗口类型以保障 IME / 物理键盘焦点。应用必须保持 regular Dock / Cmd+Tab；Electron 只允许已是 `UIElementApplication` 时使用 `skipTransformProcessType: true`，因此本 Demo 不再把 Query 加入所有 Space 或覆盖全屏应用。当前 Space 内正常唤起仍成立。显示器新增、拔除、分辨率或 Dock 工作区变化后，Float 以防抖方式重新钳制到可用 `workArea`，不抢焦点、不重播动效、不打断共享元素交接。
- `FOX_IDLE` 按“只显示狐狸头”的目标例外。

## 3. 视觉语言

### 颜色（浅白玻璃 + 内部工具）

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
- Dashboard：白色卡片与极浅灰画布为主，紫色控制在品牌、焦点环、选中面与必要的关键动作；风险继续使用红 / 黄 / 绿并配文字。标准 `BrowserWindow` 保持不透明，不启用 vibrancy / transparent。深色是炭黑层级（画布 / 侧栏 / 卡片），不是纯黑或简单反相。仅 sidebar 是固定玻璃层：light 最终视觉约 `#f2f2f6..#f5f5f8`，dark 约 `#121116..#17161c`，与 main 的平均 RGB 差至少约 9；静态 `blur(20px)` + saturate、单一中性 hairline 和极轻顶部高光。右侧 `dashboard-main` 明确不透明：light 纯白 `#fff`，dark 不透明炭黑约 `#1c1b20`，alpha=1 且无 blur。只有固定 sidebar 和短时 popover / tooltip 可使用 `backdrop-filter`；顶栏、滚动中的筛选 / 工具区、卡片、图表与表格禁止 blur。resize / phase 期间 blur 数值恒定。数据正文保持高对比实色字。`prefers-reduced-transparency` 使用同等层级实色；`forced-colors` 使用 Canvas / CanvasText 且无 blur。禁止紫色渐变、霓虹发光、漂浮卡片墙、超大圆角、重阴影和噪点。
- Dashboard 按成熟运营工具处理：工作内容居中、固定可调面板、最小但可发现的控件、稳定肌肉记忆。导航紧凑、4/8 间距，主内容留白约 20–24px，section 约 20px；矩形控件 / 面板 / 卡片 / 输入 / 选择项 / 菜单统一 `--dash-radius: 8px`（`--dash-panel-radius` 为其别名）。pill / 徽标 / 进度条可保留 999px，圆形状态点保留 50%。普通数据面板不悬浮、不堆阴影、不做卡片马赛克。hover 必须是中性灰完整高亮面；selected / active 恢复淡紫完整高亮面（浅色约紫色 8–10%，深色约 14–16%），selected icon 可使用克制紫色；pressed 比 hover 稍深，但不做 `translateY`。绝不能恢复左侧紫色竖线、inset rail 或改变图标坐标。只过渡 `background` / `color` / `border` / `opacity`，至多极小 `transform`；禁止 `blur` / `filter` / `box-shadow` 过渡，也禁止 `padding` / `margin` / `border-width` 等会改布局的属性。危险操作用红，主 CTA 保持可识别，不得被通用中性规则抹平。文本链接只做下划线 / 透明度，不强铺底。
- 风险、过期、无命中、阻断、未接入不能只靠颜色，必须有文字。
- 闲置狐狸：2.8–3.2 秒一轮，3–4px 浮动、约 2° 摆动、最大 scale 1.04。紫色呼吸光晕拆到独立层，在 88px native bounds 内约 76px 内层 / 84px 外层双层 radial（最多留 2px 安全），只动画 opacity（约 3.0–3.4s，`.52–.60` 到 `.92–.95`）；FoxHead 只保留很轻的静态 drop-shadow，idle keyframe 不再动画 filter。稳定贴边时狐狸以与 idle 同周期的镜像 ready motion 朝屏幕内探身：峰值约内移 3px、上抬 2px、向内倾 5°、scale 1.035，呈现跃跃欲试但不脱离半露裁切；只允许在 `.fox-head` 上动画 transform，不能动画负责裁切的 `.fox-idle` 根节点或 `.fox-head-image`，避免 Query handoff 姿态跳变。贴边与非贴边统一紫光且 dock 自然裁半，无白 glint、无白点眼、无霓虹多圈、无实色圆盘。默认主题取消闭合蓝圆；键盘焦点只由明确 keyboard focus origin / `data-fox-keyboard-focus` 显示为双耳外侧短弧紫色剪影，不得由裸 `:focus-visible` 直接画出，也不得覆盖脸或耳麦。pointerdown 同步清键盘焦点；press / drag / session / settling / handoff 全部隐藏。`forced-colors` 仍用系统 Highlight。snap / peek / retract / warning / handoff 优先于 ready motion 并暂停 halo；warning 保留黄点与黄语义轮廓、不叠紫。reduced-motion 关闭 ready motion 并保留较明显静态紫轮廓；reduced-transparency / forced-colors 关闭 aura。CSS 变量是生产 SSOT。应用 Dock / 任务栏图标使用独立 1024 master：约 896px 连续圆角近白 squircle 底板、狐狸按有效 alpha 边界光学居中并占底板约 74–76%，四角透明。
- 狐狸姿态分三层，不进入 Main 的 OverlayPhase / IPC：structural `handoff > snap > peek > retract > dragging`；transient `none | pressed | dragging | annoyed-drag`；ambient `awake | following-local | drowsy | sleeping`。warning 是 modifier，暂停 ambient。派生单一 `data-fox-pose`。指针只在现有 88px Fox 窗内时，整只狐狸做局部跟随（≤1.75px / ≤2°，rAF 合帧，离开回正）。这是整头局部跟随，不是全局 eye tracking，也不宣传眼球追踪。角色只有一颗位于帽檐与暖色脸交界的中央椭圆眼，外加眼底一条短竖线；运行时表情层只能覆盖并重绘这同一颗眼，不得新增白点眼、双眼珠或双侧卡通眼。无操作约 8s 进入 drowsy、约 14s 进入 sleeping：中央眼逐步闭合，狐狸下沉内倾为趴睡姿态，地面影展开并显示朝屏幕内侧漂移的 `Zzz`；Fox 隐藏 / fox-edge / sync / 指针 / 聚焦 / 打开查询都会唤醒并作废旧 token。主键按下约 110ms squash 表示戳 / 按住；超过既有 4px 阈值后进入拖拽方向倾斜 / 被提起，同时同一眼区显示棕色 `><` 应力表情；长时间或较长距离拖住后播放 ≤1.2s 的一次性烦躁拖拽。局部跟随或刚唤醒时，耳罩外侧可播放两轮有限声波；睡眠、拖拽、warning、snap / peek / retract、handoff 与 reduced motion 必须停波，不能新增常驻第三循环。现有左右贴边半露 + inward-ready + hover peek / retract 就是本项目的 mini mode，保持不变。Query 的 SEARCHING / RESULTS / EMPTY / COPIED 业务动画不受 ambient 污染。不实现全局鼠标轮询、真实 free-roam、逐帧 setBounds、双击 / 多击累加器；首击必须立即打开 Query。
- 遵守 `prefers-reduced-motion`：取消持续位移、呼吸和吸附变形，只保留克制静态轮廓。`prefers-reduced-transparency` 与 `forced-colors` 关闭 aura filter，保留系统 focus。

### 字体与尺寸

- 中文使用本地系统栈：PingFang SC / Microsoft YaHei UI / Segoe UI，不引入网络字体。
- 输入 16/24；正文 14/22；辅助信息不小于 11px。
- 外壳圆角约 22–24px。
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

### 查询胶囊

- 左侧同一狐狸头，右侧输入，Enter 查询，Esc 收起。
- 打开时自动聚焦并全选已有内容；应用或窗口恢复焦点时只恢复键盘路由，不再次全选，避免下一键覆盖已输入问题。
- 中文 IME 组合输入期间按 Enter 不得误提交。
- 空查询给出明确提示，不检索。
- Dashboard 图标是清晰但不抢主 CTA 的次入口，具有 `aria-label` 与 tooltip。打开后 Float 收起为狐狸。
- 查询胶囊的玻璃外壳、输入井、次入口、查询按钮与结果卡沿用白主紫锚的克制材质，观感接近专业桌面输入工具；不得新增装饰文案，也不得改变共享元素交接几何、打开关闭 ACK、焦点 / IME、检索、Top 3、复制、窗口尺寸或 IPC。
- 狐狸右键使用主进程固定生成的原生菜单；系统 Tray / 菜单栏与应用菜单提供「打开话术查询」「打开运营工作台」。这些可信入口直接调用主进程窗口动作，不允许 renderer 传任意菜单或 command，也不放宽 `dashboard:open` 的 query-only IPC 门禁。
- macOS 程序坞图标代表完整应用表面：应用已就绪后点击程序坞打开 / 恢复单例 Dashboard，不展开查询；首次启动仍只显示狐狸。
- 「深度思考 · 预留 · OFF」是 DeepSeek 辅助重排的说明入口，当前点击只展示边界说明；不得调用模型、改变排序、生成或改写 Answer，也不得出现「AI 正在生成答案」。

### Top 3 话术卡

每张卡必须显示：适用场景、渠道 / 分类、有效状态、非数字匹配原因、话术正文原文、明确的「复制话术」按钮。

主演示问法应稳定给出三个独立、互补且合格的合成候选。第一条可以高亮，但绝不自动复制。

本地检索以现有字符 bigram / trigram 与完整问法为主，并独立增加 fixture 级的合成实体锚点、别名和规则意图辅助。纯意图词不能单独制造命中；强品类文本 + 匹配问题主题 / 意图可在词法下限之上受控召回自然问法。未带合成品牌的宽品类别名只有在去掉别名与已支持意图后不剩未知文本时才成立，防止陌生品牌串话术。有效期硬过滤、ID / 正文去重完成后才截取稳定 Top 3，答案正文永不参与召回或改写。该能力为本仓 clean-room 实现，不复制旧学习项目的代码、词典、参数、数据或真实话术。

**禁止展示数值匹配分。** 过期与未生效内容永不进入结果。

### 演示级 Dashboard

左侧可折叠分组导航 + 顶栏 + 内容区，键盘可访问。展开宽度可在 `216–360px` 内拖动或键盘调整，默认 `248px`；折叠采用平台化 collapsed surface（macOS integrated `120px`，Windows / Linux native `72px`），展开时恢复本次会话的上次宽度。折叠态分隔条仍可命中：向右拖从 collapsed surface 连续预览到 207，超过滞回 expand threshold（`208`，相对 collapse `192`）后先保持当前 raw 至少一个已提交布局帧，再进入既有 expanding 并约 190ms 恢复 `lastExpandedWidth`（至少 min `216`），无需 pointerup；阈值以下松手 / `pointercancel` / `lostpointercapture`（即使 `buttons===1`）/ blur / `buttons=0` 从当前 preview 平滑弹回 collapsed surface 且不误展开；回滚后分隔条公开 `aria-valuenow=平台折叠宽度`，保留 `lastExpandedWidth`，不把上次展开宽度写回 collapsed 态。键盘分隔条在折叠态：ArrowRight / Enter 展开，End 展开到 max，Home / ArrowLeft 保持 collapsed surface。拖动期间 titlebar drag 临时 no-drag，pointer 合帧，不每帧 setState，不动画 backdrop-filter / filter / box-shadow / padding / margin。图标锚点在四阶段不变（mac `nav.left+60` / native `nav.left+36`），只裁切文字；collapsing / collapsed / expanding 期间 brand copy 与 nav labels 必须 `opacity:0`，expanded 结构过渡完成后再用 100–120ms 淡入。折叠态图标在 hover / focus 时于侧栏外显示明确名称。狐狸 Logo 保持原槽位，不再叠加展开按钮。主内容只使用系统滚轮、触控滚动与原生滚动条，不把鼠标按住拖动解释为滚页。`980×680`、`1180×760` 与更大窗口下不得出现页面级横向遮挡，图表和卡片按断点重排。9 个可切换模块：

品牌区使用用户的透明狐狸头 Logo，不使用紫底「狐」字块。模块导航只显示短名称，页面解释放在内容标题或顶栏。侧栏是唯一固定玻璃层：浅色最终视觉约 `#f2f2f6..#f5f5f8`，深色约 `#121116..#17161c`，与 main 平均 RGB 差至少约 9；`20px` blur + saturate、单一中性 hairline 与极轻顶部高光。顶栏、主区、卡片与表格使用不透明实色（main light `#fff` / dark `#1c1b20`）和极轻内高光，不单独做 blur，正文保持 `--dash-ink` 对比。外观由 `data-dashboard-theme` 显式 token 与 shell / form control 继承的 `color-scheme` 共同决定，手动浅色 / 深色不得再走 `light-dark()` 的系统分支。侧栏导航未选中行默认透明；hover / focus-visible 在 120–160ms 内出现完整中性灰高亮框；selected / active 使用淡紫完整高亮面，selected icon 可用克制紫色，不再使用 3px 左侧紫色竖线、inset rail 或任何 selected 紫色定向边框，也不因此改变图标坐标。侧栏折叠使用固定 Logo DOM + 同一个持久 PanelLeft 按钮（同一 ref / testid / aria-controls），四阶段只切换 `aria-expanded` / label / icon。结构以 shell 的 `grid-template-columns` `transitionend` 正常收口为显式 `expanded / collapsing / collapsed / expanding` phase；`transitioncancel` 仅在实际结构边界已到达当前目标时 settle，否则等待新的 `transitionend`。动态切换到 `prefers-reduced-motion` 必须立即终态。折叠 180–200ms `cubic-bezier(.2,.8,.2,1)`，labels / brand copy 在 collapsing / collapsed / expanding 保持 `opacity:0`，expanded 结构完成后再淡入，不以 `max-width` 瞬断造成布局跳。品牌、标签与列表必须稳定裁切，resizer 保持可命中。不 bounce，不让 icon x/y 位移，toggle glyph 只在同一槽位 crossfade/scale。`prefers-reduced-motion` 直接终态。鼠标操作不强制焦点，键盘 / 虚拟点击在终态用 `useLayoutEffect` + `focus({ preventScroll: true })` 交接。Logo 槽与按钮 `no-drag`，独立 titlebar strip 保持 drag；拖宽期间 topbar / titlebar strip 必须临时 no-drag。侧栏按钮、主题 trigger 与 `menuitemradio` 桌面最小 `40×40px`，粗指针提升到 `44px`，使用行业通用的 PanelLeft 线框图标。Dashboard 外观由右上单一主题 trigger（`aria-haspopup=menu`）打开小型 menu，内含浅色 / 深色 / 跟随系统三个 roving `menuitemradio`；ArrowDown / ArrowUp 可从 trigger 打开；支持 Home / End、Enter / Space、Escape。Escape 与提交归还 trigger；Tab / Shift+Tab 关闭并移出到相邻可聚焦控件，不抢外部焦点；外部指针只关闭、不归还焦点。默认跟随系统，仅在当前 Dashboard 会话内生效，不读取或写入持久化存储，并保持 `matchMedia` 实时联动。菜单当前项用淡紫 selected，hover 灰。`forced-colors` 下选中面必须 `Highlight` + `HighlightText`；tooltip / popover 必须 `Canvas` / `CanvasText` 且 `backdrop-filter: none`。管理概览去掉装饰性上下 / 竖分隔与列表首项顶线，只保留结构线。矩形筛选状态用 8px，语义 chip 用 pill。其余动效优先 `opacity / color / background`，不沿用桌宠的弹跳、发光或漂浮语言。

Dashboard 主标题只使用「客服运营工作台 / 运营管理端」，不使用英文概念口号。管理概览以固定统计范围、语义化待处理决策表和连续 KPI 条为首屏骨架；决策行必须显示影响、Owner、下一步、状态与处理窗口，操作使用可区分的具体名称。Demo 只有一个编译期合成数据集，不提供无法真正改变数据的假全局筛选；VOC 模块例外提供同一数据集内预编译的年 / 月 / 日切片，选择后必须真实联动 KPI、Pareto、热力图与详情。

1. 管理概览：今日需要拍板、VOC 信号、四域健康
2. VOC / 工单洞察：产品筛选、问题 Pareto、聚合归因与数据契约
3. 检索效果：根问题 / 操作双账
4. 离线三维抽样复核：是否修改、是否发送、是否适用分别报告样本量、有效分母、不可核验与证据等级
5. 话术库：产品话术、活动话术、售前流程、售后流程分域浏览
6. 话术优化待办
7. 内容与发布
8. 公告与同步
9. 架构能力图

侧栏业务导航图标由单一 `--dash-nav-icon-size: 20px` 同时驱动 `.dashboard-nav-icon` wrapper 与 SVG `width/height`，保留 24 viewBox / path / stroke。导航文字用静态 `--dash-nav-label-shift: calc(var(--dash-brand-copy-shift) - 4px)` 再靠近约 4px，expanded 态 icon-to-label 间隙约 14px。不改 PanelLeft toggle、品牌狐狸 40px、icon slot、macOS `nav.left+60` / native `+36` 锚点、8px inset、42px hit row、selected `::before inset:0`，也不给 icon transform。

导航在「VOC / 工单洞察」下另显示禁用的「工单垃圾桶 · 二期待实施」占位。它不进入 9 个一期可切换模块、不可聚焦、不可执行，也不暗示功能已完成。

「公告与同步」提供本地推送演练：用户可选择合成成功 / 失败回执并观察 loading、结果和重试反馈；演练不得联网、发送、保存或修改 published / announced / client ACK / offline lease 四分面。

离线三维抽样复核必须与检索自动事实分账：复制不能推断发送、采纳、未修改或回答正确；三项均以全合成冻结样本演示交互，`unverifiable` 单独列示，不采最终发送正文，也不冒充真实 Pilot EVD。

话术库与内容发布必须分开：前者是只读资产浏览，后者是治理生命周期。当前四域页面只能显示公开安全的合成规模和结构样例；`NOT_CREATED / UPSTREAM_AUTHORING` 若仍出现在售前 / 售后卡片中，只代表冻结的合成演示场景，不代表 Menokin 企业材料当前不存在。合成四域 release 只能说明合同形状，不能冒充正式四域已经完成 G0-09、发布或运行接入。

VOC 页面使用用户提供工作簿做**只读结构与聚合校准**，Git 内只保存去标识合成镜像。不得保存客户原文、订单号、图片、批次、员工、快递或竞品原始评价；自有与竞品分域；时间精度混合时不得伪造日 / 周趋势。

Dashboard 的 BI 表达至少包含：概览的可切指标固定周期趋势图、检索终态构成图，以及 VOC 的问题 Pareto 与产品×问题热力图。图表必须有标题、单位 / 周期、合成口径、键盘可达的选择态和联动详情；筛选或选择必须真实改变本地视图，不能只是装饰。

全部数据来自编译期静态、深冻结的合成 manifest。不读取 Float 真实输入，不写磁盘，不用 localStorage / IndexedDB。

Publish 若出现，必须 disabled，并附 `演示禁用 · 正式需 owner + G0/Ddev`。

### 状态与反馈

- `EMPTY`：明确「未找到可用话术」，说明 Demo 未接通真实飞书。
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
