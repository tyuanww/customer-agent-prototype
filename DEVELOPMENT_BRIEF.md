# 客服 Agent Demo v3 — 开发任务包

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

**本仓是原型隔离区，使用 `DEMO · 合成数据`。它不等于正式开发，也不是 `DEV-M0` 的开始；正式立项与设计文档仓只可作为只读需求参考。Demo 不代发消息。**

v3 只覆盖旧版「本轮不做 Dashboard BI」和「仅双窗口」的范围限制：允许新增一个演示级 Dashboard。它不覆盖安全、合成数据、禁止真后端、禁止自动发送、禁止真实数据和禁止修改正式仓等边界。

真实达肤妍材料即使存在于仓外，也未授权进入本 Git Demo，因此话术与看板必须保持虚构合成，并持续标注。

## 2. 本次必须完成

### 2.1 桌面浮窗

- Electron + React + TypeScript。
- 两个 overlay `BrowserWindow`：闲置狐狸头 + 查询/结果窗；观感上是同一控件展开。
- 狐狸头窗口约 88px（含动效留白）；查询胶囊约 600×88；空态/错误态约 600×240，1/2/3 条候选分别约 600×340/430/620。
- **不再使用固定 520×760 普通工作台窗口。**
- 透明、无边框、置顶、跳过任务栏；窗口尺寸贴合可见控件。
- 狐狸没有方形底板；待机 2.8–3.2s、3–4px、约 2°、scale ≤ 1.04。贴边重播 420–560ms 方向性吸附；88px 原生窗始终完整留在工作区，由 renderer 做等效 44px 裁切，使 64px 狐狸视觉各露一半。悬停 / 聚焦时以 420ms 镜像动效探头到等效 80px 裁切，离开后以 300ms 反向动效缩回。禁止把透明窗放到屏外或用循环原生 `setBounds` 做动画。
- 拖拽在 `pointerup`、`pointercancel`、`lostpointercapture`、窗口失焦或 `buttons=0` 时必须立即结束；结束后的移动不得继续改变窗口，也不得触发 click。
- 闲置狐狸单击打开查询；查询胶囊里的狐狸单击收起查询，拖拽仍只移动。打开 / 收起采用两阶段共享元素交接：隐藏 Query 先按点击瞬间 Fox 的真实屏幕中心、同尺寸 64px 与当前 2D 姿态矩阵准备代理并回执，Main 才交换原生窗可见性、完成 App / BrowserWindow / WebContents 聚焦并启动 CSS；关闭反向等待 renderer 末帧回执。贴边 Query 必须与物理工作区边缘齐平，保持 32px 半露轮廓连续。最终 bounds 每阶段只提交一次，外壳以 `clip-path` 展开约 260ms、收起约 200ms，玻璃只淡入淡出；不得先闪完整面板、双狐狸错位、靠正常路径固定计时猜结束或出现两窗同时不可见。
- 查询胶囊中的狐狸按 `SEARCHING / RESULTS / EMPTY / COPIED` 给出明显但不阻塞操作的原创反馈，业务状态优先于待机动效，并完整支持 reduced motion。
- renderer 安全基线：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 只暴露类型化、枚举化的最小 API：复制、平台、窗口上下文、打开/收起、打开 Dashboard、上报 UI 阶段、上报有限 handoff milestone、拖拽位移、订阅 overlay 命令。handoff 回执只接受受信 Query sender、正整数 epoch 与固定枚举，不暴露任意窗口控制。
- 禁止暴露通用 `send/on/invoke`、任意 channel、任意尺寸或文件系统。
- IPC handler 校验 sender 来源；阻止新窗口、外部导航和权限请求。

### 2.2 演示级 Dashboard

- 第三个懒创建的标准系统窗：约 1180×760，最小约 980×680；正常 frame、可缩放、非透明、非置顶、显示在任务栏。
- 最好无 preload；不得进入 overlay `trustedContents()`；renderer 无 Node / Electron / clipboard。
- 只新增一个无参数 `dashboard:open` 白名单 IPC。main 必须验证 trusted sender 且 role 为 `query`。Fox 或非受信 sender fail-closed。
- 重复打开只 focus；关闭后可重建；关闭不得退出狐狸。
- 九个可浏览模块：管理概览、VOC / 工单洞察、检索效果、离线三维抽样复核、四域话术库、话术优化待办、内容与发布、公告与同步、架构能力图。
- 主内容只支持鼠标滚轮、触控板 / 触控滚动和原生滚动条；鼠标按住拖动不得滚页。最小窗口下不得遮挡关键操作或产生页面级横向滚动。
- BI 驾驶舱至少包含可切指标的固定周期趋势、检索终态构成、VOC Pareto 与产品×问题热力图；图例 / 数据点可通过鼠标和键盘选择并联动详情。所有图表持续标明固定合成口径，不得伪装生产实时数据。
- 管理概览按“需要拍板 → 变化 → 原因 → Owner / 下一步 → 数据可信度”组织，禁止个人排名与伪经营 KPI。
- 离线三维抽样复核必须把是否修改、是否发送、是否适用分账，分别显示样本量、有效分母、`unverifiable` 与证据等级；复制不能推断发送、采纳、未修改或正确，Demo 不采最终发送正文。
- 话术库与发布分开；四域内部枚举固定为 `presale / campaign / aftersale / product`。售前 / 售后正式源当前必须显示 `NOT_CREATED / UPSTREAM_AUTHORING`。
- 用户提供的 VOC Excel 仅允许只读提取结构与聚合用于设计校准；仓内只能落去标识合成镜像，不得落客户原文、订单号、图片、批次、员工、快递或竞品评价。
- 数据全部来自 TypeScript 编译期静态 manifest，深冻结；不用 `Date.now` 生成指标；不持久化。
- 每个数字注明合成演示。adopted 只等于复制成功。Publish 必须 disabled。
- 查询胶囊提供「深度思考 · 预留 · OFF」说明入口，仅描述 DeepSeek 可选辅助重排边界；当前不调用模型、不改变结果或排序、不生成、不改写、不发送。
- 查询胶囊的工作台入口使用标准线框 Dashboard 图标，保留明确 `aria-label` / tooltip；不再显示「工作台」文字按钮。
- Fox / Query 右键菜单、系统 Tray 与应用菜单由 Main 固定构造，只提供已经实现的查询、Dashboard 与退出动作。不得由 renderer 传菜单结构或通用命令；Query 输入框右键仍须保留撤销、剪切、复制、粘贴、全选等原生编辑能力。
- Dashboard 品牌区使用仓内 `fox-head.png`，导航采用紧凑单行模块名；普通面板无悬浮阴影，圆角收敛到 6–8px，顶栏不使用玻璃模糊。
- Dashboard 不使用英文概念口号或多枚环境徽标墙：顶栏只保留一个「演示数据」标识，完整模拟边界收进可展开说明。管理概览使用语义化决策表与连续 KPI 条，显示影响、Owner、下一步、状态、处理窗口、统计周期和指标定义；只有一个编译期合成数据集，不放置不生效的假全局筛选。VOC 模块可在该数据集的预编译年 / 月 / 日切片之间切换，并真实联动 KPI、Pareto、热力图和详情。
- 左侧导航展开宽度可在 `216–360px` 内拖动或用键盘分隔条调整，默认 `248px`；折叠为固定 `72px` 图标轨，展开恢复本次会话的上次宽度。图标与分组占位不重排，只隐藏文字；折叠态图标 hover / focus 时显示不被侧栏裁切的名称提示，狐狸 Logo 槽在 hover / focus 时覆盖显示展开按钮。折叠按钮保留语义化 `button`，以 `aria-expanded` 驱动标准「左侧面板收起 / 展开」线框图标，命中区 `40×40px`，支持 reduced motion。Dashboard 提供「浅色 / 深色 / 跟随系统」三态外观，默认跟随系统且只在当前会话生效，不使用 localStorage / IndexedDB / 文件持久化。另显示禁用占位「工单垃圾桶 · 二期待实施」，它不算第十个可浏览模块，也不提供任何功能。
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
- **不得使用达肤妍名义、真实产品事实或真实客户原文，也不得近义改写真实话术。**
- 确定性本地评分：完整问法 + 字符 n-gram 为主，fixture 级合成实体锚点 / 别名 / 规则意图只作受控辅助；强品类文本 + 匹配主题 / 意图可在词法下限之上召回自然问法，纯泛化意图不得制造命中；宽品类别名含未知品牌 / 剩余文本时 fail-closed。
- 有效期与数据合同先 fail-closed，再按 ID / 原始正文去重、稳定排序并返回最多 3 条；同分使用不依赖 locale 的 ID 顺序。
- **过期与未生效内容永不返回。卡片不展示匹配分。**
- 卡片可展示「精确问法 / 同义表达 / 主题与意图 / 相似问法」等非数字原因；答案展示和复制必须是 fixture 中的原始 `answerText`。
- 不迁移旧学习项目代码、词典、权重、真实数据或持久化 / 学习链路；本仓查询增强必须独立实现并只用合成 fixture。

## 3. 建议目录

```text
src/
  main/          窗口、快捷键、锚定、生命周期、白名单 IPC、Dashboard 单例
  preload/       最小类型化 API（仅 overlay）
  shared/        合同、状态机、几何、狐狸动效参数、Dashboard 访问控制
  renderer/      FoxApp + QueryApp + DashboardApp + 合成 fixture / manifest
tests/
  unit/          状态机、锚定、动效参数、manifest、Dashboard 授权
  component/     展开、空查询、IME、Top 3、复制、导航、Fox 吸附 class
  e2e/           Electron smoke + Dashboard 单例 / 安全窗
```

## 4. 数据流与信任边界

```text
[Fox click / globalShortcut]
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

[Query Dashboard icon]
      |
      v
[dashboard:open IPC] -- trusted + role=query --+
                                               |
[native context menu / Tray / app menu / Dock]-+--> [Main openDashboard]
                                                        |
                                                        v
                                         [lazy BrowserWindow, no preload]
                                                        |
                                                        v
                                         [static frozen manifest only]

```

- Dashboard renderer 不得直接访问 Node/Electron API，也不得获得 `customerAgent`。
- fixture 与 manifest 静态打包，不发网络请求。
- 禁止 `localStorage`、IndexedDB、文件落盘或分析 SDK。
- 不读取 `.env`、钥匙串或凭证。
- CSP 至少限制 `default-src 'self'`。

## 5. 工具链与脚本

- Node.js 24.x；`packageManager` 锁定 pnpm 11.19.0。
- 必须提供：`pnpm dev`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、`pnpm test:e2e`。
- 保留 `pnpm package:win`，本轮不要求产出 Windows 安装包。

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
12. 左右贴边原生窗口都稳定留在工作区、renderer 等效裁出 44px 窗区且狐狸视觉都露 32px；探头到等效 80px，吸附 / 探头动画左右镜像且每次可重播；reduced motion 关闭持续位移和吸附变形。
13. 拖拽松手、取消、失焦或 capture 丢失后只完成一次，后续无按键移动不再改变窗口或误触 click。
14. Dashboard：IPC 仍 query-only，原生菜单 / Tray / macOS 程序坞可直接调用 Main；单例、关闭重建、最小化恢复、无 customerAgent、九模块可浏览；滚轮 / 原生滚动条与最小窗口响应式可用，鼠标拖动不滚页；侧栏可折叠，二期垃圾桶保持 disabled；趋势 / 构成 / Pareto / 热力图可交互；VOC 年 / 月 / 日切片、下钻、离线三维复核和话术四域筛选真实联动；本地推送演练不改变四分面；Publish disabled。
15. Electron smoke：启动狐狸头、左右半露 / 探头 / 缩回、反复展开 / 收起且无双窗同时不可见、共享狐狸首帧中心 / 64px 尺寸 / 姿态矩阵连续、关闭后不点击页面即可直接键入、点击胶囊狐狸收起、三条同屏、数字键复制、自动收起、程序坞激活 Dashboard、Dashboard 原生滚动 / 折叠导航 / VOC 时间切片 / 本地推送 / 图表联动 / 多尺寸截图。真实 OS 的应用激活、BrowserWindow / WebContents 键盘投递与全局快捷键仍需实机；自动化使用 `--demo-e2e` / `DEMO_E2E=1` 的 main harness 验证同一状态机。
16. 桌面入口：图标按钮具备可访问名称；应用菜单与 Tray 菜单包含查询 / Dashboard / 退出；Fox / Query 原生右键菜单可用且不扩展 IPC 白名单，Query 可编辑区域保留标准编辑项。

## 7. 完成定义

- 当前机器使用 Node 24 + pnpm 能安装并运行 Demo。
- lint、typecheck、unit/component test、build 全部实际通过。
- Electron smoke 尽量实际通过；若环境限制，不能把「测试文件存在」写成 PASS。
- 无真实数据、凭证、飞书链接、远端 API、数据库或模型调用。
- README 写清启动命令、快捷键、双表面边界、数据边界、透明效果平台差异、快捷键冲突降级。
- 不 commit、不 push。

## 8. 明确不做

- 正式 OAuth/RBAC、PostgreSQL、Fastify、真实内容导入/发布、生产 Dashboard BI。
- 向量库、Embedding、LLM、自动发送、自动学习。
- 陪伴型桌宠、进程监听、聊天窗口标题监听。
- 读取或伪造达肤妍正式发布快照，或把仓外达肤妍材料写入本 Git Demo。
- 生产签名、自动更新、真实 Windows 安装验收。
