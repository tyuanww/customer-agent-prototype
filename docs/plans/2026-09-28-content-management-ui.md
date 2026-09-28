<!-- /autoplan restore point: "/Users/hutou/.gstack/projects/weiweity-customer-agent-prototype/main-autoplan-restore-20260928-114733.md" -->
# 内容管理：顶栏动作一行、会话徽章、导入收入折叠待开发

## Implementation plan

### Problem

工作台「内容管理」已经能走真实导入 / 取消 / 发布（办公机清单：先点「取消未完成导入」，再发 MENOKIN 表）。页面却把三件不同的事堆在一起，看起来像半成品：

1. **发布**和**取消未完成导入**在同一个 `.dash-publish-box` 里，但 CSS 是单列 `display: grid; justify-items: end`。两个 40px 按钮叠成两行，原因文案再占第三行。操作员要找一对相关动作，眼睛却上下跳。
2. 标题下还有装饰性两步向导（`content-pipeline-steps`：1 导入 / 2 发布，`pointer-events: none`）、整宽横幅「导入与发布走产品会话…」、再加一张「内容导入 / 本地导入进入待发布」卡片（角色说明、边界、售后 SOP、选文件、状态、归属话术库、预览表）。主路径被说明书淹没。
3. 没有会话时，未接入语义散落在禁用按钮、发布原因、以及卡片下方横幅三处。标题行本身不说清「现在接没接上」。

要的是干净的运营页：一眼看到接没接上、一对动作在同一行、导入工作区默认收起。不改发布合同，不写假发布。

### What already exists (do not rebuild)

- **发布闸门：** `contentPublishGate` + `CONTENT_PUBLISH_COPY`。无产品会话 / 未登录 / 坐席 / 无草稿 / 话术师一期都 fail-closed。`publishDraft` 只在闸门放行后打 `POST /v1/content/import` → poll → `POST /v1/content/publish`。
- **取消在途：** `cancelInFlight` 发哨兵批号，扫掉本 actor 全部在途。空扫文案「当前没有未完成的导入」。无会话按钮禁用。
- **本地解析：** `readCoachUploadFile` / `parseUpload`。选文件只进本页预览，不导入。归属话术库下拉覆盖文件名猜测。
- **徽章与折叠：** `StatusBadge`（`neutral | ok | warn | danger`）。`.dash-contract-details` / `summary` 已是工作台折叠样式。不要新组件库、不要 accordion 包。
- **视觉不变量：** `DESIGN.md` 白主紫锚、矩形 8px、主 CTA 40px、未接入必须有文字、无会话禁止合成成功。
- **合同锁：** OpenAPI 1.14.0 / schema.v1.18。本切片不 intake、不手改 `packages/contracts`、不碰 1.15.0 话术师自发布。

### Industry mapping (reuse, do not invent a CMS)

业内把「文档头动作栏」「连接状态」「导入工作区」拆开。我们按同一拆法收口现有页，不造第四套知识库产品。

| 业内能力 | 代表 | 我们怎么落 |
| --- | --- | --- |
| 文档头动作栏 | Strapi Content Manager 右上 Publish；Contentful 条目顶栏 Publish；WordPress Gutenberg 顶栏 Update 与次要动作同一行 | 标题行右侧：次要「取消未完成导入」+ 主 CTA「发布」。CSS 改成单行 flex，不再用单列 grid。 |
| 标题旁状态芯片 | Contentful environment / status pill；GitHub Private/Public；Strapi Draft \| Published | `h1 内容管理` 右侧 `StatusBadge`：无会话 `未接入`（warn），已登录 `已接入`（ok）。颜色不够，必须有字。 |
| 连接说明靠标题，不靠整页横幅 | Slack / Notion 顶栏状态；GitHub 仓库头 | 现有句「导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。」挪到标题+徽章的右边，不再用整宽 `.dash-scope-important`。 |
| 导入是次级工作区 | Strapi Media Library 上传可最小化；Zendesk Guide 导入走独立流程，不和 Publish 抢主栏；Nielsen progressive disclosure | 「内容导入 / 本地导入」整块放进默认折叠的 **待开发**（复用 `.dash-contract-details`）。不是宣称导入没做，是把说明书和选文件从主栏拿开。 |
| 草稿 ≠ 已发布 | Strapi Draft & Publish；WordPress draft / publish | 未发布预览写「待发布 · 不是已发布」；发布成功后改五态已发布行。选文件仍不打 import。 |
| 在途可取消 | Strapi 上传对话框 Cancel all | 现成 `cancelInFlight`。只改位置，不改哨兵语义。 |
| 未连接不假装成功 | 各 CMS 无权限时禁用 Publish，并写原因 | 已有闸门。无会话按钮保持未接入 / 禁用，`publishDraft` 不得被点。 |

**明确不抄：** Contentful 多环境切换器、Strapi Releases 定时发布、WordPress 修订浏览器、Beamer 强制弹窗、飞书/Wiki 连接器、新的步骤向导组件。

### Chosen shape

**一条顶栏 + 一块折叠待开发。** 零新 HTTP。

```
┌──────────────────────────────────────────────────────────────────┐
│ 内容管理  [未接入]  导入与发布走产品会话…   [取消未完成导入] [发布] │
│                                           （原因 / 发布反馈）      │
├──────────────────────────────────────────────────────────────────┤
│ ▸ 待开发 · 内容导入                                               │
│   本地 CSV/xlsx、角色与边界说明、选文件、状态、归属话术库、预览表   │
└──────────────────────────────────────────────────────────────────┘
```

已登录时徽章改 `已接入`。横幅句子仍在徽章右侧（用户指定位置），窄宽用 ellipsis + `title` 保全文。

#### 1. 同一行动作

- `.dash-publish-box` 是 `header.dash-module-head` 的 flex item：`flex: 0 0 auto;` 外层 column（动作行 + 原因行）。内层 `.content-action-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; flex-shrink: 0; }`。原因行 `overflow-wrap: anywhere`。
- 顺序：取消（`dash-reset`）在左，发布（`dash-publish`）在右。主 CTA 靠右是 Strapi/Contentful 习惯。
- 980×680：`.content-title-cluster { display: flex; align-items: center; min-width: 0; flex: 1 1 auto; }`。横幅 class `.content-session-banner`（**不用** `dash-scope` / `dash-scope-important`，也**不删除**这两个全局选择器）：`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`。testid `formal-source-warning` 留在该行内节点。layout 测 `.dash-publish-box` 的 `flex: 0 0 auto` 与 `.content-action-row` 的字面量 `flex-shrink: 0`。
- `publish-disabled-reason` 和 `publish-feedback` 留在动作行下方，不插进两个按钮中间。
- 去掉标题下 `dash-kicker`「导入 · 发布」（侧栏 blurb 已有）。
- 徽章 `data-testid="content-session-badge"`。`未接入` iff `sessionView == null || sessionView.enabled === false || sessionView.signedIn !== true`。其余已登录（含 coach/agent，含异常 `role === null`）为「已接入」。徽章 ≠ `gate.allowed`。测试只用 `getByTestId('content-session-badge')`，禁止裸 `getByText('未接入')`（横幅原句也含「未接入」）。发布禁用文案走 `CONTENT_PUBLISH_COPY.ownerPublish` / `agent`，不写 HTTP 403，不调用 `publishDraft`。

#### 2. 标题行：内容管理 + 未接入 + 横幅

- `h1` 与 `StatusBadge` 与横幅同一 flex 簇，垂直居中。
- 徽章公式与 §1 同一 iff：`未接入` iff `sessionView == null || sessionView.enabled === false || sessionView.signedIn !== true`（tone warn）。否则「已接入」（tone ok）。不把 `owner/coach/agent` 画在徽章上。
- 横幅 `data-testid="formal-source-warning"` 从模块中部挪到徽章右侧。文案保持原句。
- 去掉装饰性 `content-pipeline-steps`。两步向导对「选表 → 发布」没有新信息，还占一行。

#### 3. 内容导入 / 本地导入 → 折叠待开发

一层壳：`<details class="dash-contract-details" data-testid="content-pending-dev">`。内层去掉 `.dash-card`，避免双框。

**开关（始终受控，禁止无控→受控切换，禁止从 status 派生 open）：**

```
const [open, setOpen] = useState(false)
<details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
```

仅在 **transition into** `reading | ready | error` 时 `setOpen(true)`（含 `reading→ready`）。`clearUpload` → `setOpen(false)`。用户在 ready 后可再点 summary 收起。`keepContent` 不卸载时保持 `open` 与 upload。

**summary 文案（唯一真源；`n = rows.length`；`title` 保全文；过长 ellipsis）：**

不设 `lastReleaseId`，不在本地预览上写「已发布」。发布成功只走现有 `publish-feedback`（`已发布 {releaseId}`）。summary 在 ready 固定：`待开发 · {sourceName} · 待发布 {n} 行`。体内 ready 仍「待发布 · 不是已发布」。

| 条件 | summary | 体内 status 条 |
| --- | --- | --- |
| idle | 待开发 · 内容导入 | 等待导入 |
| reading | 待开发 · 正在读取 {sourceName} | 正在读取 |
| error | 待开发 · 未进入待发布 | 未进入待发布 |
| ready | 待开发 · {sourceName} · 待发布 {n} 行 | 待发布 · 不是已发布 |

折叠体内保留：草稿说明、角色说明、边界（不连接飞书/Wiki）、售后 SOP 未接入、选文件、清除预览、状态、归属话术库、预览表。

`.content-staged-preview { max-height: 240px; overflow: auto; }`。展开后模块区可滚，顶栏动作行不 sticky；预览不把按钮挤出 980×680 的横向裁切。

测试：可见性用 `toBeVisible` + `open`；hidden input 上传后等到 `content-pending-dev` 有 `open`。jsdom 里 closed details 的子节点仍在 DOM，不能只 `getByLabelText`。

#### 4. 行为不变量（不改协议）

- 无会话：发布、取消都禁用；点不着 `publishDraft` / `cancelInFlight`。
- 选文件仍只本地预览。
- Owner 发布仍是 import-then-publish。Coach 预览可做、发布禁用，文案 `CONTENT_PUBLISH_COPY.ownerPublish`。
- 取消仍是哨兵扫在途，空扫仍「当前没有未完成的导入」。

### Files (blast radius)

| 文件 | 改什么 |
| --- | --- |
| `apps/desktop/src/renderer/features/dashboard/ContentModule.tsx` | 顶栏结构、徽章、details、去掉 pipeline |
| `apps/desktop/src/renderer/styles/dashboard.css` | 单行动作、标题簇、删除 `.content-pipeline-steps` markup/CSS/`pipelineStepStatus` |
| `apps/desktop/tests/component/ContentModule.test.tsx` | 同行、徽章、折叠默认、就绪自动展开 |
| `apps/desktop/tests/component/DashboardApp.test.tsx` | 横幅位置、去掉 pipeline 断言、折叠内文案仍在 |
| `apps/desktop/tests/unit/dashboard-layout.test.ts` | 不再要求 `.content-pipeline-steps`，改为 `.content-action-row` |
| `docs/tutorial-menokin-content-publish.md` | 步骤 3：顶栏徽章 + 展开待开发选表，去掉「应看到两步」 |
| `DESIGN.md` | 内容管理一条：顶栏动作 + 会话徽章 ≠ 发布权 |
| `TODOS.md` | Open 一条：飞书/Wiki 导入仍需 intake，一期不连接 |

`DESIGN.md` 编号项 4 **以及**「没有会话或角色不够时按钮保持未接入 / 禁用」整句一并改写：顶栏「取消+发布」同一行；`StatusBadge` 只表示产品会话已登录；无会话按钮未接入/禁用；已登录即使发布禁用也是「已接入」，原因只走 `CONTENT_PUBLISH_COPY`，不把角色不够写成「未接入」。tutorial 步骤 3 去掉「应看到两步」；同页「仍是 403」和失败表 403 改成 `ownerPublish` 中文。how-to-verify 无「两步向导」则不动。

CEO SELECTIVE EXPANSION 已接受的加固（仍在 blast radius，无新 HTTP）：

- summary 五态表为唯一真源；`n = rows.length`；`lastReleaseId` 不解析反馈字符串。
- 预览表 `.content-staged-preview { max-height: 240px; overflow: auto; }`（与现有 `margin: 0` 合并，不整块覆盖）。
- tutorial 步骤 3 + 403 表同步；TODOS.md 飞书/Wiki defer。

### Tests and manual checklist

自动化：

- 无会话：`content-session-badge` 为「未接入」，发布/取消禁用，`publishDraft` 未调用。
- 已登录 owner：徽章「已接入」。已登录 coach/agent：徽章「已接入」，发布禁用，`publishDraft` 未调用。
- 横幅在 `module-content` 顶栏，不在卡片和动作行之间的整宽条。
- `content-action-row` 同时含 `publish-action` 与 `cancel-in-flight`。
- `content-pending-dev` idle 时 `open` 为 false；点 summary 可展开选文件。hidden input 上传等到 `open`。ready 再点 summary 可关且 summary 含 sourceName 与 `n 行`。error 亦 `open`。clear 后 `open` false、summary 回到「待开发 · 内容导入」。
- DashboardApp 折叠态用 `toBeVisible` + `open`，不用只 `getByLabelText`。layout 对 `.content-staged-preview` 断言 `max-height: 240px`（与现有 `margin: 0` 合并）。
- 原闸门用例（坐席、话术师售后、话术师产品一期、xlsx 预览、取消空扫、归属覆盖）仍过。
- `dashboard-layout`：有 `.content-action-row`、`flex-wrap: nowrap`、动作行 `flex-shrink: 0`、横幅 `min-width: 0`；`not.toContain('.content-pipeline-steps')`。

人工（办公机 0.3.21 行为不得回退）：

- 未登录打开内容管理：顶栏「内容管理 未接入」，发布灰。
- 管理员登录：徽章「已接入」，点「取消未完成导入」得空扫文案且仍登录。
- 展开待开发，选最小【活动】表，预览自动展开，点发布得 `rel_*`，无「上一份还在处理」误报。

### NOT in scope

- 新 HTTP、`contracts:intake`、OpenAPI 1.15.0 话术师自发布
- 飞书 / Wiki 真导入（折叠体内继续写「不连接」）
- Dashboard 整页 IA、产品改名、系统同步频道（另计划 `2026-09-28-system-sync-channels.md`）
- 软件自动更新 / `latest.yml`
- 把导入做成独立窗口或第三步向导
- 徽章上画 RBAC 角色名
- 假发布、fixture 数字、合成成功 toast

### Implementation tasks

1. 重画 `ContentModule` 顶栏：标题簇（h1 + StatusBadge + 横幅）+ 单行动作行 + 原因行。
2. `.dash-publish-box` / `.content-action-row` 单行 flex；980 宽不换行。
3. 上传卡包进默认折叠的 `details`「待开发 · 内容导入」，就绪自动展开。
4. 删除 pipeline 步进；更新 component / layout / tutorial。
5. 删光 pipeline markup/CSS/`pipelineStepStatus`；预览 `max-height: 240px`；summary 五态；DESIGN.md / tutorial / TODOS.md。
6. 跑 `pnpm --filter @customer-agent/desktop exec vitest run tests/component/ContentModule.test.tsx tests/component/DashboardApp.test.tsx tests/unit/dashboard-layout.test.ts`。可见性用 `toBeVisible` + `open`。


<!-- autoplan-accepted:ceo -->
- 发布与取消在同一 `content-action-row`（`flex-wrap: nowrap; flex-shrink: 0`）。头栏 flex item `.dash-publish-box { flex: 0 0 auto; }`。原因行 `overflow-wrap: anywhere`。验证：layout 字面量含 `flex-shrink: 0` 与 `.dash-publish-box` 的 `flex: 0 0 auto`；人工 980 窗两按钮可见。
- 无产品会话或未登录：`data-testid="content-session-badge"` 为「未接入」tone warn。已登录（含 coach/agent）为「已接入」tone ok。徽章 ≠ `gate.allowed`，不画角色名。验证：无会话禁用；coach/agent 已接入且 publishDraft 未调用。
- 原句「导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。」在 `.content-session-banner`（不用也不删全局 `dash-scope` / `dash-scope-important`），testid `formal-source-warning`。验证：徽章只用 `getByTestId('content-session-badge')`。
- 单层 `<details open={open} onToggle>`，`useState(false)` 始终受控。仅 transition into reading|ready|error 时 setOpen(true)；clear 关。summary：idle「待开发 · 内容导入」；reading 正在读取；ready「待开发 · {name} · 待发布 {n} 行」；error 未进入待发布。不设 lastReleaseId，不在预览写已发布。验证：idle open false；上传后 open；ready 再关 summary 仍有文件名。
- 无会话不得调用 `publishDraft`/`cancelInFlight`；选文件只本地预览；Owner import-then-publish；Coach 预览可、发布禁用、文案 `CONTENT_PUBLISH_COPY.ownerPublish`（不是 HTTP 403）；取消哨兵空扫「当前没有未完成的导入」。验证：现有闸门/取消/归属覆盖全过。
- 删除 `content-pipeline-steps` markup、CSS、`pipelineStepStatus`。`.content-staged-preview { max-height: 240px; overflow: auto; }`。DESIGN.md：顶栏动作 + 会话徽章 ≠ 发布权。tutorial 步骤 3 去掉「应看到两步」。TODOS.md 记飞书/Wiki 导入 defer。验证：layout `not.toContain('.content-pipeline-steps')`；docs grep 无「应看到两步」。
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- 会话首次 loading：徽章不渲染或 neutral「正在确认会话」；禁止把 session() 未返回写成「未接入」。settle 失败才未接入。验证：ContentModule 在 session pending 时徽章不是未接入。
- 发布成功：不改 upload/summary；`publish-feedback` 为唯一成功源；本轮成功且未 clear 时发布钮保持禁用。验证：成功后 publish-action disabled，summary 仍待发布 n 行，反馈含 rel_。
- submitting：选文件/清除/归属保持 disabled；summary 保持文件名。验证：submitting 时 pick disabled。
- error summary 带 sourceName（若有），title 放完整 message；体内 span 必须是 parser message。验证：现有 error toHaveTextContent 仍过。
- 同一槽：publish-feedback 优先于 publish-disabled-reason。空扫 muted。验证：点取消后反馈可见、idle 原因让路。
- `signedIn && role===null`：徽章未接入 warn，不用 ok。验证：role null 用例。
- 取消按钮 aria-label：「取消服务器上未完成的导入，不影响本页预览」。验证：getByTestId cancel 的 accessible name。
- 称 upload 四态 + 头栏反馈，禁止第五态 lastReleaseId。已接入时横幅缩短为「导入与发布走产品会话」或只 title；未接入显示全句。
- `.dash-publish-box { flex: 0 0 auto; max-width: 42%; }` 原因 `max-width: 100%; overflow-wrap: anywhere`。h1 与徽章 flex-shrink: 0。`.content-session-banner { font-size: 12px; line-height: 18px; color: var(--dash-muted); }`。
- 折叠体内顺序：选文件/清除 → 状态条 → 归属 → 预览；角色/边界/SOP 在预览下或再套一层默认收起 details。保留 .content-upload-controls/status/preview。
- 自动 setOpen(true) 只在 status 进入 reading|ready|error 的那一次；ready 后用户关上不因 re-render 再开。keepContent 不重置 open。
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:dx -->
- 教程步骤 3 写成可复制核对块（顶栏「内容管理」、徽章已接入或未接入、取消与发布同一行、summary 四态文案）。步骤 4 只保留选表/预览/归属。「你需要」第 4 条：话术师可预览，发布禁用，文案 `CONTENT_PUBLISH_COPY.ownerPublish`，不是 HTTP 403。失败表原 403 行的「你看到」列粘贴 ownerPublish 全文。删除或改写「未接入：没有内容导入通道」，使其等于屏幕上的 noSession/noProduct 句。验证：docs grep 无「应看到两步」；失败表行与 copy 常量一致。
- 空扫唯一真源 `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`（当前没有未完成的导入。登录还在，不必重新登录。），muted，不另造短句。验证：现 ContentModule 空扫用例仍过。
- 显式 `publishSucceededThisRound`（成功 true；clearUpload 或新选文件 false）。`publishDisabled` 并上它。禁止从 feedback 字符串解析 releaseId。验证：成功后 publish-action disabled，summary 仍待发布 n 行。
- 本地读取 catch：「无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。」不提飞书或 Wiki。`signedIn && role===null` 的发布原因：「会话角色无效，无法发布。请退出后重新登录。」不复用 noSession。验证：对应用例。
- 测试：session pending 时徽章不是未接入；ready 后用户关上 details，再 rerender，open 仍 false 且 summary 含 sourceName。验证：ContentModule.test.tsx。
- blast 增加 `docs/reference-content-publish.md`：头栏动作 + 折叠导入；选文件仍只本地预览。
- Chosen shape 与 design accepted 冲突时以后者为准（pending 徽章、role-null 未接入、已接入短横幅、四态、pick-first、42%）。
<!-- /autoplan-accepted:dx -->

<!-- autoplan-accepted:eng -->
- Chosen shape / 业内映射 / 第一组验收与后段冲突时，**改掉正文**：徽章 iff 为 design+eng 后段；删除「五态已发布行」和「含 role===null 为已接入」。验证：Implementation 不再出现互相打架的徽章公式。
- 会话三态：无 `window.dashboardContent` → 立刻未接入；有 API 且首次 session() 未返回 → 徽章节点仍在，文案「正在确认会话」/neutral，禁止未接入；settle 后用 iff。focus 刷新保留上一帧 view。验证：deferred session 用例；无 API 用例。
- 丢掉 DX「会话角色无效」专文案。真实 `isDashboardContentSessionResult` 不会送出 signedIn+role null。坏 payload 走 settle 失败。验证：不新增 invalidRole 常量。
- `uploadStatusRef` 记录上一帧 status；仅 transition into reading|ready|error 时 setOpen(true)。onToggle：`next !== open` 才 setOpen。clearUpload 同步关。禁止 `open === (status !== 'idle')`。
- `.dash-publish-box { flex: 0 1 auto; max-width: 42%; min-width: min-content; }`。`.content-action-row .dash-reset { min-height: 40px }`。预算按内容列。验证：打开 nav-content 后两按钮 getBoundingClientRect 在视口内。
- error `{ message, sourceName? }`；catch 用 DX 已接受的「无法读取该文件…」；idle 体内保留「选择 CSV 或 xlsx」帮助句。
- `publishSucceededThisRound` 不因归属下拉复位；`cancelDisabled` 不再并上 submitting。空扫全文 `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`。
- 测试一律 `toBeVisible` + `open`；hidden input 用 waitFor。验证命令加上 tutorial grep 与 gate 单测。blast 含 `docs/how-to-office-machine-product-remote.md` 步骤 7：先展开待开发。
- 折叠体内 pick-first，说明书在预览下，不再套一层默认闭合 details。idle summary 可加「选择 CSV 或 xlsx」，前缀仍「待开发」（UC 未批）。
<!-- /autoplan-accepted:eng -->
## Review record
<!-- autoplan-baseline-edits:ceo {"sourceSha256":"74c88b8f1843c53711380feee875447b3246d5de031acfdda1a62fb7c116e6d1","replacements":[{"oldText":"\n### Problem\n\n工作台「内容管理」已经能走真实导入 / 取消 / 发布（办公机清单：先点「取消未完成导入」，再发 MENOKIN 表）。页面却把三件不同的事堆在一起，看起来像半成品：\n\n1. **发布**和**取消未完成导入**在同一个 `.dash-publish-box` 里，但 CSS 是单列 `display: grid; justify-items: end`。两个 40px 按钮叠成两行，原因文案再占第三行。操作员要找一对相关动作，眼睛却上下跳。\n2. 标题下还有装饰性两步向导（`content-pipeline-steps`：1 导入 / 2 发布，`pointer-events: none`）、整宽横幅「导入与发布走产品会话…」、再加一张「内容导入 / 本地导入进入待发布」卡片（角色说明、边界、售后 SOP、选文件、状态、归属话术库、预览表）。主路径被说明书淹没。\n3. 没有会话时，未接入语义散落在禁用按钮、发布原因、以及卡片下方横幅三处。标题行本身不说清「现在接没接上」。\n\n要的是干净的运营页：一眼看到接没接上、一对动作在同一行、导入工作区默认收起。不改发布合同，不写假发布。\n\n### What already exists (do not rebuild)\n\n- **发布闸门：** `contentPublishGate` + `CONTENT_PUBLISH_COPY`。无产品会话 / 未登录 / 坐席 / 无草稿 / 话术师一期都 fail-closed。`publishDraft` 只在闸门放行后打 `POST /v1/content/import` → poll → `POST /v1/content/publish`。\n- **取消在途：** `cancelInFlight` 发哨兵批号，扫掉本 actor 全部在途。空扫文案「当前没有未完成的导入」。无会话按钮禁用。\n- **本地解析：** `readCoachUploadFile` / `parseUpload`。选文件只进本页预览，不导入。归属话术库下拉覆盖文件名猜测。\n- **徽章与折叠：** `StatusBadge`（`neutral | ok | warn | danger`）。`.dash-contract-details` / `summary` 已是工作台折叠样式。不要新组件库、不要 accordion 包。\n- **视觉不变量：** `DESIGN.md` 白主紫锚、矩形 8px、主 CTA 40px、未接入必须有文字、无会话禁止合成成功。\n- **合同锁：** OpenAPI 1.14.0 / schema.v1.18。本切片不 intake、不手改 `packages/contracts`、不碰 1.15.0 话术师自发布。\n\n### Industry mapping (reuse, do not invent a CMS)\n\n业内把「文档头动作栏」「连接状态」「导入工作区」拆开。我们按同一拆法收口现有页，不造第四套知识库产品。\n\n| 业内能力 | 代表 | 我们怎么落 |\n| --- | --- | --- |\n| 文档头动作栏 | Strapi Content Manager 右上 Publish；Contentful 条目顶栏 Publish；WordPress Gutenberg 顶栏 Update 与次要动作同一行 | 标题行右侧：次要「取消未完成导入」+ 主 CTA「发布」。CSS 改成单行 flex，不再用单列 grid。 |\n| 标题旁状态芯片 | Contentful environment / status pill；GitHub Private/Public；Strapi Draft \\| Published | `h1 内容管理` 右侧 `StatusBadge`：无会话 `未接入`（warn），已登录 `已接入`（ok）。颜色不够，必须有字。 |\n| 连接说明靠标题，不靠整页横幅 | Slack / Notion 顶栏状态；GitHub 仓库头 | 现有句「导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。」挪到标题+徽章的右边，不再用整宽 `.dash-scope-important`。 |\n| 导入是次级工作区 | Strapi Media Library 上传可最小化；Zendesk Guide 导入走独立流程，不和 Publish 抢主栏；Nielsen progressive disclosure | 「内容导入 / 本地导入」整块放进默认折叠的 **待开发**（复用 `.dash-contract-details`）。不是宣称导入没做，是把说明书和选文件从主栏拿开。 |\n| 草稿 ≠ 已发布 | Strapi Draft & Publish；WordPress draft / publish | 预览仍写「待发布 · 不是已发布」。选文件仍不打 import。 |\n| 在途可取消 | Strapi 上传对话框 Cancel all | 现成 `cancelInFlight`。只改位置，不改哨兵语义。 |\n| 未连接不假装成功 | 各 CMS 无权限时禁用 Publish，并写原因 | 已有闸门。无会话按钮保持未接入 / 禁用，`publishDraft` 不得被点。 |\n\n**明确不抄：** Contentful 多环境切换器、Strapi Releases 定时发布、WordPress 修订浏览器、Beamer 强制弹窗、飞书/Wiki 连接器、新的步骤向导组件。\n\n### Chosen shape\n\n**一条顶栏 + 一块折叠待开发。** 零新 HTTP。\n\n```\n┌──────────────────────────────────────────────────────────────────┐\n│ 内容管理  [未接入]  导入与发布走产品会话…   [取消未完成导入] [发布] │\n│                                           （原因 / 发布反馈）      │\n├──────────────────────────────────────────────────────────────────┤\n│ ▸ 待开发 · 内容导入                                               │\n│   本地 CSV/xlsx、角色与边界说明、选文件、状态、归属话术库、预览表   │\n└──────────────────────────────────────────────────────────────────┘\n```\n\n已登录时徽章改 `已接入`。横幅句子仍在徽章右侧（用户指定位置），窄宽用 ellipsis + `title` 保全文。\n\n#### 1. 同一行动作\n\n- `.dash-publish-box` 改为：外层 column（动作行 + 原因行），内层 `.content-action-row` `display: flex; flex-wrap: nowrap; align-items: center; gap: 8px`。\n- 顺序：取消（`dash-reset`）在左，发布（`dash-publish`）在右。主 CTA 靠右是 Strapi/Contentful 习惯。\n- 980×680 最小窗：动作行不得换行。标题簇 `min-width: 0` 收缩，横幅 ellipsis。\n- `publish-disabled-reason` 和 `publish-feedback` 留在动作行下方，不插进两个按钮中间。\n- 去掉标题下 `dash-kicker`「导入 · 发布」（侧栏 blurb 已有）。\n\n#### 2. 标题行：内容管理 + 未接入 + 横幅\n\n- `h1` 与 `StatusBadge` 与横幅同一 flex 簇，垂直居中。\n- 无产品会话或 `signedIn !== true`：徽章 `未接入`，tone `warn`。\n- 已登录：徽章 `已接入`，tone `ok`。不把 `owner/coach/agent` 画在徽章上（查询主路径已禁 RBAC 字）。\n- 横幅 `data-testid=\"formal-source-warning\"` 从模块中部挪到徽章右侧。文案保持原句。\n- 去掉装饰性 `content-pipeline-steps`。两步向导对「选表 → 发布」没有新信息，还占一行。\n\n#### 3. 内容导入 / 本地导入 → 折叠待开发\n\n- 现 `content-upload` 整卡包进 `<details class=\"dash-contract-details\" data-testid=\"content-pending-dev\">`。\n- `summary`：**待开发 · 内容导入**。默认 `open={false}`。\n- 折叠体内保留：草稿说明、角色说明、边界（不连接飞书/Wiki）、售后 SOP 未接入、选文件、清除预览、状态、归属话术库、预览表。\n- 选文件 / 读取中 / 预览就绪 / 读失败时 **自动展开**，避免发布前看不见预览。\n- 清除预览后恢复折叠。\n- 测试仍可通过 hidden file input 上传；DashboardApp 用例要先展开或依赖自动展开。\n\n#### 4. 行为不变量（不改协议）\n\n- 无会话：发布、取消都禁用；点不着 `publishDraft` / `cancelInFlight`。\n- 选文件仍只本地预览。\n- Owner 发布仍是 import-then-publish。Coach 预览可做、发布仍 403 文案。\n- 取消仍是哨兵扫在途，空扫仍「当前没有未完成的导入」。\n\n### Files (blast radius)\n\n| 文件 | 改什么 |\n| --- | --- |\n| `apps/desktop/src/renderer/features/dashboard/ContentModule.tsx` | 顶栏结构、徽章、details、去掉 pipeline |\n| `apps/desktop/src/renderer/styles/dashboard.css` | 单行动作、标题簇、去掉或停用 `.content-pipeline-steps` |\n| `apps/desktop/tests/component/ContentModule.test.tsx` | 同行、徽章、折叠默认、就绪自动展开 |\n| `apps/desktop/tests/component/DashboardApp.test.tsx` | 横幅位置、去掉 pipeline 断言、折叠内文案仍在 |\n| `apps/desktop/tests/unit/dashboard-layout.test.ts` | 不再要求 `.content-pipeline-steps`，改为 `.content-action-row` |\n| `docs/tutorial-menokin-content-publish.md` | 步骤 3：顶栏徽章 + 展开待开发选表，不再写「两步向导」 |\n\n`DESIGN.md` 内容管理一条补「顶栏动作 + 未接入徽章 + 导入折叠」。不重写视觉系统。\n\nCEO SELECTIVE EXPANSION 已接受的加固（仍在 blast radius，无新 HTTP）：\n\n- 折叠 summary 在未选文件时写「待开发 · 内容导入」，就绪后写文件名或「待发布 · N 行」，避免收起后丢失状态。\n- 预览表加 `max-height` + 区域内滚动（FAQ 约百行），980 窗不撑破主栏。\n- `docs/how-to-verify-desktop.md` 内容管理段若仍写「两步向导」则改成顶栏 + 折叠导入；`tutorial-menokin-content-publish.md` 步骤 3 同步。\n\n### Tests and manual checklist\n\n自动化：\n\n- 无会话：徽章「未接入」，发布/取消禁用，`publishDraft` 未调用。\n- 已登录 owner：徽章「已接入」。\n- 横幅在 `module-content` 顶栏，不在卡片和动作行之间的整宽条。\n- `content-action-row` 同时含 `publish-action` 与 `cancel-in-flight`。\n- `content-pending-dev` 默认不含 `open`；点 summary 后出现选文件。\n- 上传就绪后 details 为 open，预览可见。\n- 原闸门用例（坐席、话术师售后、话术师产品一期、xlsx 预览、取消空扫、归属覆盖）仍过。\n- `dashboard-layout`：有 `.content-action-row` / `flex-wrap: nowrap`，无 `.content-pipeline-steps`。\n\n人工（办公机 0.3.21 行为不得回退）：\n\n- 未登录打开内容管理：顶栏「内容管理 未接入」，发布灰。\n- 管理员登录：徽章「已接入」，点「取消未完成导入」得空扫文案且仍登录。\n- 展开待开发，选最小【活动】表，预览自动展开，点发布得 `rel_*`，无「上一份还在处理」误报。\n\n### NOT in scope\n\n- 新 HTTP、`contracts:intake`、OpenAPI 1.15.0 话术师自发布\n- 飞书 / Wiki 真导入（折叠体内继续写「不连接」）\n- Dashboard 整页 IA、产品改名、系统同步频道（另计划 `2026-09-28-system-sync-channels.md`）\n- 软件自动更新 / `latest.yml`\n- 把导入做成独立窗口或第三步向导\n- 徽章上画 RBAC 角色名\n- 假发布、fixture 数字、合成成功 toast\n\n### Implementation tasks\n\n1. 重画 `ContentModule` 顶栏：标题簇（h1 + StatusBadge + 横幅）+ 单行动作行 + 原因行。\n2. `.dash-publish-box` / `.content-action-row` 单行 flex；980 宽不换行。\n3. 上传卡包进默认折叠的 `details`「待开发 · 内容导入」，就绪自动展开。\n4. 删除 pipeline 步进；更新 component / layout / tutorial。\n5. 跑 `pnpm --filter @customer-agent/desktop exec vitest run tests/component/ContentModule.test.tsx tests/component/DashboardApp.test.tsx tests/unit/dashboard-layout.test.ts`。\n\n","newText":"\n### Problem\n\n工作台「内容管理」已经能走真实导入 / 取消 / 发布（办公机清单：先点「取消未完成导入」，再发 MENOKIN 表）。页面却把三件不同的事堆在一起，看起来像半成品：\n\n1. **发布**和**取消未完成导入**在同一个 `.dash-publish-box` 里，但 CSS 是单列 `display: grid; justify-items: end`。两个 40px 按钮叠成两行，原因文案再占第三行。操作员要找一对相关动作，眼睛却上下跳。\n2. 标题下还有装饰性两步向导（`content-pipeline-steps`：1 导入 / 2 发布，`pointer-events: none`）、整宽横幅「导入与发布走产品会话…」、再加一张「内容导入 / 本地导入进入待发布」卡片（角色说明、边界、售后 SOP、选文件、状态、归属话术库、预览表）。主路径被说明书淹没。\n3. 没有会话时，未接入语义散落在禁用按钮、发布原因、以及卡片下方横幅三处。标题行本身不说清「现在接没接上」。\n\n要的是干净的运营页：一眼看到接没接上、一对动作在同一行、导入工作区默认收起。不改发布合同，不写假发布。\n\n### What already exists (do not rebuild)\n\n- **发布闸门：** `contentPublishGate` + `CONTENT_PUBLISH_COPY`。无产品会话 / 未登录 / 坐席 / 无草稿 / 话术师一期都 fail-closed。`publishDraft` 只在闸门放行后打 `POST /v1/content/import` → poll → `POST /v1/content/publish`。\n- **取消在途：** `cancelInFlight` 发哨兵批号，扫掉本 actor 全部在途。空扫文案「当前没有未完成的导入」。无会话按钮禁用。\n- **本地解析：** `readCoachUploadFile` / `parseUpload`。选文件只进本页预览，不导入。归属话术库下拉覆盖文件名猜测。\n- **徽章与折叠：** `StatusBadge`（`neutral | ok | warn | danger`）。`.dash-contract-details` / `summary` 已是工作台折叠样式。不要新组件库、不要 accordion 包。\n- **视觉不变量：** `DESIGN.md` 白主紫锚、矩形 8px、主 CTA 40px、未接入必须有文字、无会话禁止合成成功。\n- **合同锁：** OpenAPI 1.14.0 / schema.v1.18。本切片不 intake、不手改 `packages/contracts`、不碰 1.15.0 话术师自发布。\n\n### Industry mapping (reuse, do not invent a CMS)\n\n业内把「文档头动作栏」「连接状态」「导入工作区」拆开。我们按同一拆法收口现有页，不造第四套知识库产品。\n\n| 业内能力 | 代表 | 我们怎么落 |\n| --- | --- | --- |\n| 文档头动作栏 | Strapi Content Manager 右上 Publish；Contentful 条目顶栏 Publish；WordPress Gutenberg 顶栏 Update 与次要动作同一行 | 标题行右侧：次要「取消未完成导入」+ 主 CTA「发布」。CSS 改成单行 flex，不再用单列 grid。 |\n| 标题旁状态芯片 | Contentful environment / status pill；GitHub Private/Public；Strapi Draft \\| Published | `h1 内容管理` 右侧 `StatusBadge`：无会话 `未接入`（warn），已登录 `已接入`（ok）。颜色不够，必须有字。 |\n| 连接说明靠标题，不靠整页横幅 | Slack / Notion 顶栏状态；GitHub 仓库头 | 现有句「导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。」挪到标题+徽章的右边，不再用整宽 `.dash-scope-important`。 |\n| 导入是次级工作区 | Strapi Media Library 上传可最小化；Zendesk Guide 导入走独立流程，不和 Publish 抢主栏；Nielsen progressive disclosure | 「内容导入 / 本地导入」整块放进默认折叠的 **待开发**（复用 `.dash-contract-details`）。不是宣称导入没做，是把说明书和选文件从主栏拿开。 |\n| 草稿 ≠ 已发布 | Strapi Draft & Publish；WordPress draft / publish | 未发布预览写「待发布 · 不是已发布」；发布成功后改五态已发布行。选文件仍不打 import。 |\n| 在途可取消 | Strapi 上传对话框 Cancel all | 现成 `cancelInFlight`。只改位置，不改哨兵语义。 |\n| 未连接不假装成功 | 各 CMS 无权限时禁用 Publish，并写原因 | 已有闸门。无会话按钮保持未接入 / 禁用，`publishDraft` 不得被点。 |\n\n**明确不抄：** Contentful 多环境切换器、Strapi Releases 定时发布、WordPress 修订浏览器、Beamer 强制弹窗、飞书/Wiki 连接器、新的步骤向导组件。\n\n### Chosen shape\n\n**一条顶栏 + 一块折叠待开发。** 零新 HTTP。\n\n```\n┌──────────────────────────────────────────────────────────────────┐\n│ 内容管理  [未接入]  导入与发布走产品会话…   [取消未完成导入] [发布] │\n│                                           （原因 / 发布反馈）      │\n├──────────────────────────────────────────────────────────────────┤\n│ ▸ 待开发 · 内容导入                                               │\n│   本地 CSV/xlsx、角色与边界说明、选文件、状态、归属话术库、预览表   │\n└──────────────────────────────────────────────────────────────────┘\n```\n\n已登录时徽章改 `已接入`。横幅句子仍在徽章右侧（用户指定位置），窄宽用 ellipsis + `title` 保全文。\n\n#### 1. 同一行动作\n\n- `.dash-publish-box` 是 `header.dash-module-head` 的 flex item：`flex: 0 0 auto;` 外层 column（动作行 + 原因行）。内层 `.content-action-row { display: flex; flex-wrap: nowrap; align-items: center; gap: 8px; flex-shrink: 0; }`。原因行 `overflow-wrap: anywhere`。\n- 顺序：取消（`dash-reset`）在左，发布（`dash-publish`）在右。主 CTA 靠右是 Strapi/Contentful 习惯。\n- 980×680：`.content-title-cluster { display: flex; align-items: center; min-width: 0; flex: 1 1 auto; }`。横幅 class `.content-session-banner`（**不用** `dash-scope` / `dash-scope-important`，也**不删除**这两个全局选择器）：`min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`。testid `formal-source-warning` 留在该行内节点。layout 测 `.dash-publish-box` 的 `flex: 0 0 auto` 与 `.content-action-row` 的字面量 `flex-shrink: 0`。\n- `publish-disabled-reason` 和 `publish-feedback` 留在动作行下方，不插进两个按钮中间。\n- 去掉标题下 `dash-kicker`「导入 · 发布」（侧栏 blurb 已有）。\n- 徽章 `data-testid=\"content-session-badge\"`。`未接入` iff `sessionView == null || sessionView.enabled === false || sessionView.signedIn !== true`。其余已登录（含 coach/agent，含异常 `role === null`）为「已接入」。徽章 ≠ `gate.allowed`。测试只用 `getByTestId('content-session-badge')`，禁止裸 `getByText('未接入')`（横幅原句也含「未接入」）。发布禁用文案走 `CONTENT_PUBLISH_COPY.ownerPublish` / `agent`，不写 HTTP 403，不调用 `publishDraft`。\n\n#### 2. 标题行：内容管理 + 未接入 + 横幅\n\n- `h1` 与 `StatusBadge` 与横幅同一 flex 簇，垂直居中。\n- 徽章公式与 §1 同一 iff：`未接入` iff `sessionView == null || sessionView.enabled === false || sessionView.signedIn !== true`（tone warn）。否则「已接入」（tone ok）。不把 `owner/coach/agent` 画在徽章上。\n- 横幅 `data-testid=\"formal-source-warning\"` 从模块中部挪到徽章右侧。文案保持原句。\n- 去掉装饰性 `content-pipeline-steps`。两步向导对「选表 → 发布」没有新信息，还占一行。\n\n#### 3. 内容导入 / 本地导入 → 折叠待开发\n\n一层壳：`<details class=\"dash-contract-details\" data-testid=\"content-pending-dev\">`。内层去掉 `.dash-card`，避免双框。\n\n**开关（始终受控，禁止无控→受控切换，禁止从 status 派生 open）：**\n\n```\nconst [open, setOpen] = useState(false)\n<details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>\n```\n\n仅在 **transition into** `reading | ready | error` 时 `setOpen(true)`（含 `reading→ready`）。`clearUpload` → `setOpen(false)`。用户在 ready 后可再点 summary 收起。`keepContent` 不卸载时保持 `open` 与 upload。\n\n**summary 文案（唯一真源；`n = rows.length`；`title` 保全文；过长 ellipsis）：**\n\n不设 `lastReleaseId`，不在本地预览上写「已发布」。发布成功只走现有 `publish-feedback`（`已发布 {releaseId}`）。summary 在 ready 固定：`待开发 · {sourceName} · 待发布 {n} 行`。体内 ready 仍「待发布 · 不是已发布」。\n\n| 条件 | summary | 体内 status 条 |\n| --- | --- | --- |\n| idle | 待开发 · 内容导入 | 等待导入 |\n| reading | 待开发 · 正在读取 {sourceName} | 正在读取 |\n| error | 待开发 · 未进入待发布 | 未进入待发布 |\n| ready | 待开发 · {sourceName} · 待发布 {n} 行 | 待发布 · 不是已发布 |\n\n折叠体内保留：草稿说明、角色说明、边界（不连接飞书/Wiki）、售后 SOP 未接入、选文件、清除预览、状态、归属话术库、预览表。\n\n`.content-staged-preview { max-height: 240px; overflow: auto; }`。展开后模块区可滚，顶栏动作行不 sticky；预览不把按钮挤出 980×680 的横向裁切。\n\n测试：可见性用 `toBeVisible` + `open`；hidden input 上传后等到 `content-pending-dev` 有 `open`。jsdom 里 closed details 的子节点仍在 DOM，不能只 `getByLabelText`。\n\n#### 4. 行为不变量（不改协议）\n\n- 无会话：发布、取消都禁用；点不着 `publishDraft` / `cancelInFlight`。\n- 选文件仍只本地预览。\n- Owner 发布仍是 import-then-publish。Coach 预览可做、发布禁用，文案 `CONTENT_PUBLISH_COPY.ownerPublish`。\n- 取消仍是哨兵扫在途，空扫仍「当前没有未完成的导入」。\n\n### Files (blast radius)\n\n| 文件 | 改什么 |\n| --- | --- |\n| `apps/desktop/src/renderer/features/dashboard/ContentModule.tsx` | 顶栏结构、徽章、details、去掉 pipeline |\n| `apps/desktop/src/renderer/styles/dashboard.css` | 单行动作、标题簇、删除 `.content-pipeline-steps` markup/CSS/`pipelineStepStatus` |\n| `apps/desktop/tests/component/ContentModule.test.tsx` | 同行、徽章、折叠默认、就绪自动展开 |\n| `apps/desktop/tests/component/DashboardApp.test.tsx` | 横幅位置、去掉 pipeline 断言、折叠内文案仍在 |\n| `apps/desktop/tests/unit/dashboard-layout.test.ts` | 不再要求 `.content-pipeline-steps`，改为 `.content-action-row` |\n| `docs/tutorial-menokin-content-publish.md` | 步骤 3：顶栏徽章 + 展开待开发选表，去掉「应看到两步」 |\n| `DESIGN.md` | 内容管理一条：顶栏动作 + 会话徽章 ≠ 发布权 |\n| `TODOS.md` | Open 一条：飞书/Wiki 导入仍需 intake，一期不连接 |\n\n`DESIGN.md` 编号项 4 **以及**「没有会话或角色不够时按钮保持未接入 / 禁用」整句一并改写：顶栏「取消+发布」同一行；`StatusBadge` 只表示产品会话已登录；无会话按钮未接入/禁用；已登录即使发布禁用也是「已接入」，原因只走 `CONTENT_PUBLISH_COPY`，不把角色不够写成「未接入」。tutorial 步骤 3 去掉「应看到两步」；同页「仍是 403」和失败表 403 改成 `ownerPublish` 中文。how-to-verify 无「两步向导」则不动。\n\nCEO SELECTIVE EXPANSION 已接受的加固（仍在 blast radius，无新 HTTP）：\n\n- summary 五态表为唯一真源；`n = rows.length`；`lastReleaseId` 不解析反馈字符串。\n- 预览表 `.content-staged-preview { max-height: 240px; overflow: auto; }`（与现有 `margin: 0` 合并，不整块覆盖）。\n- tutorial 步骤 3 + 403 表同步；TODOS.md 飞书/Wiki defer。\n\n### Tests and manual checklist\n\n自动化：\n\n- 无会话：`content-session-badge` 为「未接入」，发布/取消禁用，`publishDraft` 未调用。\n- 已登录 owner：徽章「已接入」。已登录 coach/agent：徽章「已接入」，发布禁用，`publishDraft` 未调用。\n- 横幅在 `module-content` 顶栏，不在卡片和动作行之间的整宽条。\n- `content-action-row` 同时含 `publish-action` 与 `cancel-in-flight`。\n- `content-pending-dev` idle 时 `open` 为 false；点 summary 可展开选文件。hidden input 上传等到 `open`。ready 再点 summary 可关且 summary 含 sourceName 与 `n 行`。error 亦 `open`。clear 后 `open` false、summary 回到「待开发 · 内容导入」。\n- DashboardApp 折叠态用 `toBeVisible` + `open`，不用只 `getByLabelText`。layout 对 `.content-staged-preview` 断言 `max-height: 240px`（与现有 `margin: 0` 合并）。\n- 原闸门用例（坐席、话术师售后、话术师产品一期、xlsx 预览、取消空扫、归属覆盖）仍过。\n- `dashboard-layout`：有 `.content-action-row`、`flex-wrap: nowrap`、动作行 `flex-shrink: 0`、横幅 `min-width: 0`；`not.toContain('.content-pipeline-steps')`。\n\n人工（办公机 0.3.21 行为不得回退）：\n\n- 未登录打开内容管理：顶栏「内容管理 未接入」，发布灰。\n- 管理员登录：徽章「已接入」，点「取消未完成导入」得空扫文案且仍登录。\n- 展开待开发，选最小【活动】表，预览自动展开，点发布得 `rel_*`，无「上一份还在处理」误报。\n\n### NOT in scope\n\n- 新 HTTP、`contracts:intake`、OpenAPI 1.15.0 话术师自发布\n- 飞书 / Wiki 真导入（折叠体内继续写「不连接」）\n- Dashboard 整页 IA、产品改名、系统同步频道（另计划 `2026-09-28-system-sync-channels.md`）\n- 软件自动更新 / `latest.yml`\n- 把导入做成独立窗口或第三步向导\n- 徽章上画 RBAC 角色名\n- 假发布、fixture 数字、合成成功 toast\n\n### Implementation tasks\n\n1. 重画 `ContentModule` 顶栏：标题簇（h1 + StatusBadge + 横幅）+ 单行动作行 + 原因行。\n2. `.dash-publish-box` / `.content-action-row` 单行 flex；980 宽不换行。\n3. 上传卡包进默认折叠的 `details`「待开发 · 内容导入」，就绪自动展开。\n4. 删除 pipeline 步进；更新 component / layout / tutorial。\n5. 删光 pipeline markup/CSS/`pipelineStepStatus`；预览 `max-height: 240px`；summary 五态；DESIGN.md / tutorial / TODOS.md。\n6. 跑 `pnpm --filter @customer-agent/desktop exec vitest run tests/component/ContentModule.test.tsx tests/component/DashboardApp.test.tsx tests/unit/dashboard-layout.test.ts`。可见性用 `toBeVisible` + `open`。\n\n"}]} -->

CEO methodology ranges read: 1–600, 601–1200, 1201–1800, 1801–2400, 2401–2461 / 2461 EOF.
Mode: SELECTIVE EXPANSION (autoplan override; ~6 files, added UI capability, not greenfield).
No new approach decision was needed. User direction stands: same-row actions, session banner right of 内容管理 未接入, import in collapsed 待开发.
UI scope: yes (dashboard/layout/component). DX scope: yes by term matches (import/action/agent/library); incidental, still runs.
Outside preflight: CODEX_MODE ready (claude). Aside: not connected — landscape via WebSearch.

### Taste calibration
- Good: `StatusBadge` + 文字未接入（Overview/SOP）；`.dash-contract-details` 折叠；`contentPublishGate` fail-closed。
- Avoid: `.dash-publish-box` 单列 grid；装饰性 `content-pipeline-steps`；说明书抢主栏。

### Landscape (Layer 1–3)
- L1: 文档头动作栏（Strapi/Contentful/django CMS/DatoCMS Publish 在标题行右侧）；Draft ≠ Published；导入是次级对话框。
- L2: Webflow「Draft changes」与 Publish 分开；Umbraco 在途要 waiting 态；dotCMS 状态芯片一列扫描。
- L3: 本产品没有条目编辑器，只有「选表 → 发布」。不要抄条目 CMS。根因是 CSS 把两个按钮叠成列。原生 `<details>` + 现成徽章够用。

### 0A Premise
真问题：操作员找不齐「发布 / 取消」，未接入语义散落，导入说明书压住主路径。不是缺发布协议。Do-nothing：办公机继续点不到同一行的取消+发布，误以为没接上。计划直接改布局，不是代理指标。

### 0B Existing code
闸门、取消哨兵、parseUpload、StatusBadge、dash-contract-details 全复用。只改 ContentModule 结构和 CSS。

### 0C Dream state
```
  CURRENT                      THIS PLAN                     12-MONTH
  叠按钮+向导+整宽横幅     →   顶栏一行+徽章+折叠导入   →   干净运营台
  未接入散落三处            →   标题旁一块徽章            →   各模块同一连接芯片
  导入说明书当主界面        →   待开发折叠                →   飞书导入仍另合同
```

### Decision ledger

| ID and owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
|---|---|---|---|---|---|
| CEO-M0 mode | autoplan SELECTIVE EXPANSION | unset | SELECTIVE EXPANSION | approved | autoplan override; 6 files |
| CEO-S1 same-row actions | user #1; `.dash-publish-box` grid | stacked buttons | flex nowrap 取消+发布 | approved | user instruction |
| CEO-S2 banner+badge | user #2/#3; DESIGN.md 未接入 | full-width banner | h1 + StatusBadge + banner right | approved | user instruction |
| CEO-S3 import disclosure | user #2 待开发 | always-open card | details default collapsed, auto-open on read/ready/error | approved | user instruction |
| CEO-X1 DESIGN.md one-liner | DESIGN.md §4 内容管理 | no header pattern | one sentence | approved | P2 blast <1d |
| CEO-X2 preview scroll | FAQ ~100 rows | unbounded table | max-height + overflow | approved | P1 completeness |
| CEO-X3 summary status | collapsed hides filename | only 待开发 title | filename / 待发布 N 行 | approved | P1 completeness |
| CEO-D1 待开发 label | user said 待开发; industry uses Import | 待开发 | keep 待开发 | approved (taste) | user label; gate if both voices rename |
| CEO-CUT pipeline | decorative ol | two-step wizard | remove | approved | cleanliness |
| CEO-DEF feishu import | DESIGN 不连接飞书 | copy only | stay deferred | deferred | needs intake |
| CEO-SKIP rbac badge | DESIGN 查询主路径禁角色字 | none | none | skipped | keep |
| CEO-SPEC1 details SM | spec 1.1/2.1/2.3/5.1 | open={false} | enter reading/ready/error → open true; then user may collapse; clear closes | approved | spec loop iter 1; P1 completeness |
| CEO-SPEC2 header flex | spec 1.5/5.2 | important box | action flex-shrink 0; banner ellipsis; drop dash-scope-important | approved | spec loop iter 1 |
| CEO-SPEC3 badge vs gate | spec 1.4/2.4/2.5 | 403 copy | session badge ≠ publish; ownerPublish/agent copy; content-session-badge | approved | spec loop iter 1 |
| CEO-SPEC4 preview 240 | spec 1.3 | unbounded | max-height 240px | approved | spec loop iter 1 |
| CEO-SPEC5 delete pipeline CSS | spec 2.2 | 去掉或停用 | delete markup+CSS+helper | approved | spec loop iter 1 |

Approval readiness: PASS (CEO-M0, CEO-S1, CEO-S2, CEO-S3, CEO-X1, CEO-X2, CEO-X3, CEO-D1, CEO-CUT, CEO-DEF, CEO-SKIP, CEO-SPEC1–5). Taste CEO-D1 provisional until Phase 4.

<!-- autoplan-accepted:ceo -->
- 发布与取消在同一 `content-action-row`（`flex-wrap: nowrap; flex-shrink: 0`）。头栏 flex item `.dash-publish-box { flex: 0 0 auto; }`。原因行 `overflow-wrap: anywhere`。验证：layout 字面量含 `flex-shrink: 0` 与 `.dash-publish-box` 的 `flex: 0 0 auto`；人工 980 窗两按钮可见。
- 无产品会话或未登录：`data-testid="content-session-badge"` 为「未接入」tone warn。已登录（含 coach/agent）为「已接入」tone ok。徽章 ≠ `gate.allowed`，不画角色名。验证：无会话禁用；coach/agent 已接入且 publishDraft 未调用。
- 原句「导入与发布走产品会话。没有会话时按钮保持未接入，不会写入假发布。」在 `.content-session-banner`（不用也不删全局 `dash-scope` / `dash-scope-important`），testid `formal-source-warning`。验证：徽章只用 `getByTestId('content-session-badge')`。
- 单层 `<details open={open} onToggle>`，`useState(false)` 始终受控。仅 transition into reading|ready|error 时 setOpen(true)；clear 关。summary：idle「待开发 · 内容导入」；reading 正在读取；ready「待开发 · {name} · 待发布 {n} 行」；error 未进入待发布。不设 lastReleaseId，不在预览写已发布。验证：idle open false；上传后 open；ready 再关 summary 仍有文件名。
- 无会话不得调用 `publishDraft`/`cancelInFlight`；选文件只本地预览；Owner import-then-publish；Coach 预览可、发布禁用、文案 `CONTENT_PUBLISH_COPY.ownerPublish`（不是 HTTP 403）；取消哨兵空扫「当前没有未完成的导入」。验证：现有闸门/取消/归属覆盖全过。
- 删除 `content-pipeline-steps` markup、CSS、`pipelineStepStatus`。`.content-staged-preview { max-height: 240px; overflow: auto; }`。DESIGN.md：顶栏动作 + 会话徽章 ≠ 发布权。tutorial 步骤 3 去掉「应看到两步」。TODOS.md 记飞书/Wiki 导入 defer。验证：layout `not.toContain('.content-pipeline-steps')`；docs grep 无「应看到两步」。
<!-- /autoplan-accepted:ceo -->

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 1 | CEO | SELECTIVE EXPANSION | Mechanical | autoplan override | 6 files, UI cleanup not greenfield | SCOPE EXPANSION / HOLD |
| 2 | CEO | Keep user header+disclosure shape | Mechanical | P6 action | User named same-row, badge, 待开发 | Rewrite as full CMS |
| 3 | CEO | Accept DESIGN.md + preview scroll + summary status | Mechanical | P1 P2 | Blast radius, <1d CC | Defer docs |
| 4 | CEO | Keep label 待开发 | Taste | User sovereignty | Working import labeled 待开发 is odd; user asked it | Rename to 导入工作区 |
| 5 | CEO | Remove pipeline stepper | Mechanical | P3 P5 | Decorative, pointer-events none | Keep wizard |
| 6 | CEO | Defer Feishu/Wiki import | Mechanical | P3 | Needs contracts:intake | Build connector now |
| 7 | CEO | Spec loop: details SM, 240px preview, header flex, badge≠gate, delete pipeline CSS | Mechanical | P1 | Spec 5/10 FAIL; fixes make user direction implementable | Ship the contradictory open={false} |

### 0I Temporal
- Hour 1: swap grid→flex; StatusBadge; details wrap.
- Hour 2–3: tests query pipeline and file input inside closed details — update DashboardApp to expand or rely on auto-open.
- Hour 4: 980 width, long banner ellipsis vs nowrap buttons.
- Hour 5: office checklist still finds 取消/发布 without opening 待开发; publish still needs file so auto-open on ready.

### System audit
main @ 79008b4, no stash, no open PR. ContentModule touched 14 times in 30 days. No TODO/FIXME in those files. Formal backend is manual restart (prior learning) — this slice is desktop UI only, no API restart. Office publish still owner-only, no dual-review (user preference).

### Dual voices (CEO)

Native in-host INPUT: `ceo bbbd37320fb35c9cd9b58e795ceb9d15b746d3138fe8046a5cd428d8080ab1e0` (reviewed pre-F1-strip snapshot Hz1YVn; F1 lastReleaseId since removed).
Claude Code outside: completed, provider=claude-code, model `claude-opus-5`, host=codex. Usage: in 7732 / out 4499 / cache_read 512.

```
CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                            Codex (in-host)  Claude Code  Consensus
  1. Premises valid?                   MIXED            NO           DISAGREE→taste/UC
  2. Right problem to solve?           MIXED            NO           DISAGREE→taste
  3. Scope calibration correct?        YES (layout)     NO           DISAGREE→UC
  4. Alternatives sufficiently explored? NO             NO           CONFIRMED gap
  5. Competitive/market risks covered? YES (low)        YES (demo)   CONFIRMED
  6. 6-month trajectory sound?         NO if 待开发     NO           CONFIRMED concern
```

CONFIRMED = both completed. User Challenges (both want to change user direction):
- UC-CEO-1: 不要把能用的本地导入标成「待开发」。用户指定该词。原方向保留到终审。
- UC-CEO-2: 选文件不要只藏在默认折叠里。用户指定内容导入进待开发。原方向保留到终审。
- UC-CEO-3: 取消未完成导入不要做成与发布同级常驻 CTA。用户指定同一行。原方向保留到终审。

Mechanical applied: F1 删除 lastReleaseId 假已发布态（规格循环发明，用户未要）。

Taste: 徽章用「未接入/已接入」vs「未登录」（用户指定未接入）；横幅 ellipsis vs 换行。

### Section 1 Architecture
Current scope: SELECTIVE EXPANSION, desktop ContentModule only, zero new HTTP.
```
  DashboardApp
    └── ContentModule
          ├── header (h1 + StatusBadge + banner | publish-box)
          ├── details.dash-contract-details (upload copy, file, preview)
          └── window.dashboardContent → main dashboard-content.ts
                    └── POST /v1/content/import|publish  (unchanged)
```
No new services. Coupling is CSS + tests. Rollback = revert the renderer files. 10x load is one operator; nothing scales. SPOF remains the existing API. Decision: keep.

### Section 2 Error & Rescue
No new methods. Existing: parseUpload fail → error status; publishDraft fail → publish-feedback; cancel empty → NO_IN_FLIGHT; no session → disabled. Details onToggle cannot fail closed. Rescue: keep existing copy. No CRITICAL GAP in new codepaths.

```
  CODEPATH                 | WHAT CAN GO WRONG        | RESCUED | USER SEES
  onPublish                | HTTP fail / 403          | Y       | existing Chinese copy
  cancelInFlight           | GONE empty sweep         | Y       | 当前没有未完成的导入
  readCoachUploadFile      | parse fail               | Y       | error summary + span message
  details onToggle         | user closes during read  | Y       | auto-open on reading→ready
```

### Section 3 Security
No new endpoints, no new secrets, no new deps. File input already renderer-local. Publish still gated in main. Threat: none expanded. Coach still cannot publish. OK.

### Section 4 Data / interaction
Happy: pick file → preview → publish. Nil session: buttons disabled. Empty file: existing parser error. Double-click publish: submitting disables. Navigate away: keepContent preserves upload. Back: N/A. Decision: keep generation token already in ContentModule.

### Section 5 Quality
Reuse StatusBadge and dash-contract-details. Delete pipelineStepStatus (DRY). Naming: content-session-badge, content-action-row, content-pending-dev (testid keeps user 待开发 until UC). No new method with >5 branches if open is useState. OK.

### Section 6 Tests
New flows: same-row, badge iff, details open machine, banner class, max-height 240px, no pipeline CSS. Existing gate tests retained. Gaps closed in plan. Pyramid: component + CSS string tests; office manual for 980. No evals.

### Section 7 Performance
Preview table 5000-row cap already; 240px scroll. No N+1. OK.

### Section 8 Observability
No new logs. Failures already surface as Chinese copy. Debuggability: testids. No new alerts. OK for a renderer-only slice.

### Section 9 Deploy
Desktop unsigned rebuild later; no migration. Rollback = previous asar. Risk: office checklist still finds 取消/发布. Smoke: ContentModule vitest. OK.

### Section 10 Trajectory
Reversibility 5/5 (CSS+JSX). Debt: 待开发 copy if UC rejected. Platform: header action pattern reusable. 1-year: obvious if testids stay.

### Section 11 Design
IA: title+badge+actions first; import disclosure second. States: loading/empty/error/ready in summary table. DESIGN.md rewrite session badge ≠ publish. a11y: 40px targets, details keyboard, badge text not color-only. 980 responsive specified. Recommend design-review after implement.

ASCII user flow:
```
  open 内容管理
    ├─ no session → badge 未接入, buttons disabled
    └─ signed in → badge 已接入
         ├─ click 取消 → feedback (empty or cancelled)
         ├─ expand 待开发 / auto-open on file
         │     pick CSV → preview → 发布 → feedback rel_*
         └─ idle publish disabled 「请先导入草稿」
```

### Error & Rescue Registry
See Section 2 table. 0 CRITICAL GAPS (all rescued + user-visible).

### Failure Modes Registry
```
  CODEPATH              | FAILURE MODE      | RESCUED? | TEST? | USER SEES        | LOGGED?
  onPublish             | no session click  | Y        | Y     | disabled+reason  | n/a renderer
  onPublish             | HTTP fail         | Y        | Y     | feedback         | main existing
  cancelInFlight        | empty sweep       | Y        | Y     | NO_IN_FLIGHT     | n/a
  parse                 | bad table         | Y        | Y     | error status     | n/a
  980 layout            | buttons clipped   | Y (flex) | Y css | both buttons     | n/a
```
0 CRITICAL (none silent).

### Dream state delta
This slice: same-row + badge + collapsed copy. 12-month: shared header chip across modules + real import connectors. Still far from Feishu import.

### NOT in scope (CEO)
Deferred: Feishu/Wiki import (TODOS). Skipped: RBAC on badge, pipeline wizard, lastReleaseId fake published. User Challenges pending: 待开发 label, hiding picker, always-on cancel.

### What already exists
contentPublishGate, cancelInFlight, parseUpload, StatusBadge, dash-contract-details CSS, publish-feedback.

### Scope Expansion Decisions
Accepted: DESIGN rewrite, preview 240px, summary filename, tutorial 403→ownerPublish, details SM, header flex, badge iff, drop lastReleaseId.
Deferred: Feishu/Wiki.
Skipped: RBAC badge, pipeline, lastReleaseId.

### Diagrams
Architecture, user flow, error table produced. No deploy sequence (no migration). No stale diagrams in ContentModule.

### Implementation Tasks
- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — ContentModule — Rebuild header action row + session badge + details disclosure
  - Surfaced by: CEO S1/S2/S3
  - Files: ContentModule.tsx, dashboard.css
  - Verify: vitest ContentModule + DashboardApp + dashboard-layout
- [ ] **T2 (P1, human: ~45min / CC: ~10min)** — tests/docs — Update tests, DESIGN.md, tutorial, TODOS Feishu defer
  - Surfaced by: CEO-X1, spec loop
  - Files: ContentModule.test.tsx, DashboardApp.test.tsx, dashboard-layout.test.ts, DESIGN.md, tutorial-menokin-content-publish.md, TODOS.md
  - Verify: docs grep 无「应看到两步」; vitest

Approval readiness: PASS for retained user direction + mechanical F1. User Challenges listed, not applied.

```
  +====================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
  +====================================================================+
  | Mode selected        | SELECTIVE_EXPANSION                         |
  | System Audit         | main 79008b4; ContentModule hot file        |
  | Step 0               | SEL EXP; user header+disclosure retained    |
  | Section 1  (Arch)    | 0 issues (renderer-only)                    |
  | Section 2  (Errors)  | 4 paths mapped, 0 GAPS                      |
  | Section 3  (Security)| 0 issues, 0 High                            |
  | Section 4  (Data/UX) | keepContent + submitting covered            |
  | Section 5  (Quality) | delete pipeline helper                      |
  | Section 6  (Tests)   | diagram in plan, gaps listed as tasks       |
  | Section 7  (Perf)    | 0 issues (240px cap)                        |
  | Section 8  (Observ)  | 0 new gaps                                  |
  | Section 9  (Deploy)  | unsigned rebuild later                      |
  | Section 10 (Future)  | Reversibility: 5/5, debt: 待开发 UC         |
  | Section 11 (Design)  | 0 blocking; UCs at gate                     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (3 deferred/skip + 3 UC)            |
  | What already exists  | written                                     |
  | Dream state delta    | written                                     |
  | Error/rescue registry| 4 rows, 0 CRITICAL GAPS                     |
  | Failure modes        | 5 total, 0 CRITICAL GAPS                    |
  | TODOS.md updates     | 1 proposed (Feishu import)                  |
  | Scope proposals      | 10 proposed, 8 accepted, 1 deferred, 1 skip |
  | CEO plan             | written                                     |
  | Outside voice        | claude-code completed, 11 concerns          |
  | Lake Score           | N/A (kind decisions)                        |
  | Diagrams produced    | architecture, user flow, error              |
  | Stale diagrams found | 0                                           |
  | Unresolved decisions | 3 User Challenges                           |
  +====================================================================+
```

<!-- autoplan-accepted:design -->
- 会话首次 loading：徽章不渲染或 neutral「正在确认会话」；禁止把 session() 未返回写成「未接入」。settle 失败才未接入。验证：ContentModule 在 session pending 时徽章不是未接入。
- 发布成功：不改 upload/summary；`publish-feedback` 为唯一成功源；本轮成功且未 clear 时发布钮保持禁用。验证：成功后 publish-action disabled，summary 仍待发布 n 行，反馈含 rel_。
- submitting：选文件/清除/归属保持 disabled；summary 保持文件名。验证：submitting 时 pick disabled。
- error summary 带 sourceName（若有），title 放完整 message；体内 span 必须是 parser message。验证：现有 error toHaveTextContent 仍过。
- 同一槽：publish-feedback 优先于 publish-disabled-reason。空扫 muted。验证：点取消后反馈可见、idle 原因让路。
- `signedIn && role===null`：徽章未接入 warn，不用 ok。验证：role null 用例。
- 取消按钮 aria-label：「取消服务器上未完成的导入，不影响本页预览」。验证：getByTestId cancel 的 accessible name。
- 称 upload 四态 + 头栏反馈，禁止第五态 lastReleaseId。已接入时横幅缩短为「导入与发布走产品会话」或只 title；未接入显示全句。
- `.dash-publish-box { flex: 0 0 auto; max-width: 42%; }` 原因 `max-width: 100%; overflow-wrap: anywhere`。h1 与徽章 flex-shrink: 0。`.content-session-banner { font-size: 12px; line-height: 18px; color: var(--dash-muted); }`。
- 折叠体内顺序：选文件/清除 → 状态条 → 归属 → 预览；角色/边界/SOP 在预览下或再套一层默认收起 details。保留 .content-upload-controls/status/preview。
- 自动 setOpen(true) 只在 status 进入 reading|ready|error 的那一次；ready 后用户关上不因 re-render 再开。keepContent 不重置 open。
<!-- /autoplan-accepted:design -->

### Design Review

Design methodology ranges read: 1–600, 601–1200, 1201–1800, 1801–1889 / 1889 EOF.
Scope gate: plan mode — auto-selected B (reviewing `docs/plans/2026-09-28-content-management-ui.md`).
Classifier: OPERATE / APP UI (客服运营工作台模块，不是营销落地页)。
DESIGN_NOT_AVAILABLE: skip visual mockups. ASCII in Chosen shape is the wireframe.
Prior learning applied: office-owner-publish-skip-dual-review (confidence 10, 2026-09-24): this slice still does not park dual-review or invent votes.
Prior learning applied: formal-backend-is-a-manual-restart (confidence 10, 2026-09-27): renderer-only, no API restart.

### Step 0 Design Scope

**0A.** Initial design completeness **5/10**. The plan names the header, the two buttons, the badge, and the disclosure. A 10 for this slice would specify every first-scan object (what is primary, what is caption, what is hidden), every session/upload/publish state the operator can land in, width budgets at 980×680, and an empty-state that points at picking a file without calling a working import 「待开发」. Missing at intake: session loading, success-vs-ready, 980 width budget, picker-first inside the disclosure, conflict rules for `onToggle`.

**0B.** DESIGN.md exists. All tokens calibrate against it: white surface, purple CTA, 8px radius, 40px primary button, 「未接入」 must have text, no synthetic success.

**0C.** Reuse: `StatusBadge`, `.dash-contract-details`, `.dash-publish` / `.dash-reset`, `contentPublishGate`, `CONTENT_PUBLISH_COPY`, `content-upload-controls` / `status` / `preview`. Do not add an accordion library or a new badge.

**0D.** Autoplan override: all 7 passes. Structural gaps auto-fixed. User Challenges (待开发 label, default-collapsed picker, always-on cancel) held for the final gate.

### Dual voices (Design)

Native in-host INPUT: `design a919eff120c374317aa7b55843df3aa79b59279dd690cdd5a576703413ce6a6e` (subagent `01a0e64e-6c64-7702-a4d0-d4d5482370f3`). Findings F1–F20.
Claude Code outside: completed, provider=claude-code, model `claude-opus-5`, host=codex. Recommendation: **Revise the disclosure, keep the header**.

CODEX (IN-HOST) SUBAGENT (design completeness): header chrome is right; 「待开发」 names a live import; picker starts collapsed; session `null` flashes 未接入; success leaves 待发布 + enabled 发布; 980 has no width budget; copy still precedes the file picker inside the disclosure.
CLAUDE CODE SAYS (design critique): same-row 发布/取消 and fail-closed badge are the right app chrome; labeling a working picker 待开发 and default-collapsing it makes the office path unscannable.

```
DESIGN OUTSIDE VOICES — LITMUS SCORECARD:
═══════════════════════════════════════════════════════════════
  Check                                    Codex (in-host)  Claude Code  Consensus
  ─────────────────────────────────────── ─────── ─────── ─────────
  1. Brand unmistakable in first screen?   YES     YES    CONFIRMED
  2. One strong visual anchor?             YES     YES    CONFIRMED (发布)
  3. Scannable by headlines only?          NO      NO     CONFIRMED fail (待开发)
  4. Each section has one job?             NO      NO     CONFIRMED fail (disclosure does 3 jobs)
  5. Are cards actually necessary?         NO      NO     CONFIRMED (plan deletes .dash-card)
  6. Motion improves hierarchy?            NO      NO     CONFIRMED fail (collapse hides the picker)
  7. Premium without decorative shadows?   YES     YES    CONFIRMED
  ─────────────────────────────────────── ─────── ─────── ─────────
  Hard rejections triggered:               none    #7 near-miss   none (not stacked cards)
═══════════════════════════════════════════════════════════════
```

CONFIRMED = both completed. 7/7 litmus cells agree. Failures on 3/4/6 are the three User Challenges, not auto-applied.

Taste (provisional): coach/agent badge stays 「已接入」 + tone `ok` (user and CEO: badge ≠ `gate.allowed`); F12 wanted `neutral` for no-publish roles. Banner 12px muted vs 13px `.dash-scope`.

Mechanical applied into `<!-- autoplan-accepted:design -->` (11 bullets). User Challenges UC-CEO-1/2/3 unchanged.

### Pass 1: Information Architecture — 5/10 → 7/10

First / second / third after the mechanicals:

1. `h1 内容管理` + session badge (loading | 未接入 | 已接入) + short/full banner at 12px muted.
2. Same-row 取消 | 发布, reason/feedback under the buttons, `.dash-publish-box` max-width 42%.
3. Disclosure summary. Idle still reads 「待开发 · 内容导入」 because UC-CEO-1/2 are held. Inside, pick/clear come first; role/boundary/SOP sit under the preview.

No `[HARD REJECTION]`. Hard-rule 7 (stacked cards) does not fire: the plan deletes `.dash-card` and uses header + one `details`.

A 10 would put a live empty CTA (`内容导入 · 还没有待发布草稿`) on the first screen. That changes the user's 待开发 + default-collapsed direction, so it stays at the gate. 7 because pick-first, short signed-in banner, and 42% width make the header scannable even while the disclosure label stays user-owned.

### Pass 2: Interaction State Coverage — 6/10 → 9/10

```
  FEATURE              | LOADING | EMPTY | ERROR | SUCCESS | PARTIAL
  ---------------------|---------|-------|-------|---------|--------
  会话徽章              | 不渲染或 neutral「正在确认会话」 | 未接入 warn（session null / enabled false / signedIn false / role null） | settle 失败 = 未接入 | 已接入 ok（已登录且 role 有值） | coach/agent 已接入但发布禁用
  发布按钮              | 禁用，不写未接入 | idle「请先导入草稿」 | HTTP 走 publish-feedback | 本轮成功且未 clear：保持禁用，反馈「已发布 rel_*」 | submitting：禁用，文案仍「发布」
  取消未完成导入        | 禁用 | 无会话禁用 | 空扫 muted「当前没有未完成的导入」 | 取消成功走 feedback | aria-label 说明不影响本页预览
  导入 details         | reading：open true，summary 正在读取 {name} | idle：open false，summary 待开发 · 内容导入 | error：open true，summary 带 sourceName，title=message，体内 span=parser message | 成功不改 summary | ready：待开发 · {name} · 待发布 n 行；用户可再关
  选文件/清除/归属      | reading/submitting disabled | idle 可点选文件 | error 可再选 | 成功后仍可 clear | keepContent 不重置 open
```

Empty is a feature: idle summary is the only empty CTA while UC-CEO-2 holds the picker collapsed. Warmth is the existing draft sentence inside, not a new illustration. 9 not 10 because the empty CTA still says 待开发.

### Pass 3: User Journey & Emotional Arc — 6/10 → 7/10

Required storyboard (accepted journey, UCs held):

```
  STEP | USER DOES                         | USER FEELS              | PLAN SPECIFIES?
  -----|-----------------------------------|-------------------------|----------------
  1    | 打开内容管理，session() 未返回     | 不该被吓成没接上        | 徽章 loading，不是未接入
  2    | 未登录 settle                      | 诚实：接不上、发不了    | 未接入 + 全句横幅 + 两钮禁用
  3    | 管理员登录                         | 安心，下一手该选表      | 已接入；横幅缩短；取消+发布同行
  4    | 点「取消未完成导入」               | 仪式完成，仍登录        | 空扫 muted；不 clear 本地预览
  5    | 展开「待开发 · 内容导入」          | 多一次点击（UC 保留）   | idle open false；体内先选文件
  6    | 选最小【活动】表                   | 看见待发布，不是已发布  | auto-open；summary 文件名+n 行
  7    | 点发布                             | 等待，不能改表          | submitting：pick/clear/归属禁用
  8    | 看到 已发布 rel_*                  | 做完了，不要再点        | feedback 优先；发布钮保持禁用
  9    | 话术师登录                         | 能预览，不能发          | 徽章已接入；原因 ownerPublish
```

5-second visceral: title + badge + 发布. 5-minute behavioral: cancel → expand → pick → publish. 5-year reflective: header chrome can copy to other modules; 待开发 copy is debt if UC is rejected. 7 because step 5 still spends goodwill on a working import labeled unfinished.

### Pass 4: AI Slop Risk — 8/10 → 8/10

OPERATE rules: calm header, utility copy, no card mosaic, one accent (existing `--dash-purple`). Specific CSS (`flex-wrap: nowrap`, `max-width: 42%`, banner `12px/18px` muted). Blacklist: no 3-column grid, no hero, no emoji chrome, no gradient CTA beyond the existing purple fill.

12px banner is caption, not body. DESIGN.md already uses 12–13px muted notes; forcing 16px would fight the 22px `h1` and the 40px buttons. Auto-decided keep 12px.

Litmus 3/4/6 remain NO while UCs hold. Unresolved hard rejection would cap below 8; none fired. Score stays 8.

### Pass 5: Design System Alignment — 7/10 → 8/10

Cite DESIGN.md:

- 白主紫锚、矩形 8px、主 CTA 40px: keep `.dash-publish`.
- 「未接入」必须有文字: `StatusBadge` text, not color-only.
- 「没有会话或角色不够时按钮保持未接入 / 禁用」整句改写: 按钮未接入只表示无会话；角色不够走 `CONTENT_PUBLISH_COPY`；徽章 ≠ 发布权.
- 无会话禁止合成成功: `publishDraft` 点不着.

New classes stay in the existing vocabulary: `.content-action-row`, `.content-title-cluster`, `.content-session-banner`, `.content-pending-dev`. No new component. 8 not 10 because 待开发 fights the honesty rule the same file uses for empty/unwired surfaces.

### Pass 6: Responsive & Accessibility — 7/10 → 8/10

980×680 is the product window, not a phone. Layout: title cluster `flex: 1 1 auto; min-width: 0`; `h1` and badge `flex-shrink: 0`; banner ellipsis; publish box `flex: 0 0 auto; max-width: 42%`; action row `flex-wrap: nowrap; flex-shrink: 0`. Preview `max-height: 240px; overflow: auto`. Module scrolls; header is not sticky.

Keyboard: native `details` summary, native buttons. Tab order: title cluster → 取消 → 发布 → details. Cancel accessible name: 「取消服务器上未完成的导入，不影响本页预览」. Badge queried by testid so 未接入 in the banner sentence does not collide. 40px targets match DESIGN.md (desktop; this is not a 44px phone surface). Contrast: warn/ok badges use text + tone. 8 not 10: no extra live region beyond existing `role="status"` on feedback and upload status.

### Pass 7: Unresolved Design Decisions

```
  DECISION NEEDED                         | IF DEFERRED, WHAT HAPPENS
  ----------------------------------------|---------------------------
  UC-CEO-1 summary 是否仍写「待开发」     | 办公机第一眼读成导入没做完（终审）
  UC-CEO-2 选文件是否默认折叠             | idle 主 CTA 悬空，多一次点击（终审）
  UC-CEO-3 取消是否与发布常驻同一行       | 顶栏两个按钮；取消/清除可能被当成同一动作（终审；aria-label 已机械补上）
  Taste: coach 徽章 tone ok vs neutral    | 绿徽章 + 灰发布；原因行已有 ownerPublish
```

11 mechanical decisions recorded in accepted:design. 3 User Challenges remain. Taste coach-tone: keep `ok` (badge means signed-in).

### Design NOT in scope

- Rename 待开发 / default-open picker / hide cancel until needed: User Challenges, not this phase.
- Feishu/Wiki connector, OpenAPI 1.15.0, Dashboard-wide IA, Beamer modal, new wizard.
- Visual mockups: designer binary missing.
- Coach badge drawing RBAC names.

### Design what already exists

`StatusBadge`, `.dash-contract-details`, `.dash-publish` 40px, `contentPublishGate`, `CONTENT_PUBLISH_COPY`, upload four-state union, `publish-feedback` `role="status"`, DESIGN.md 未接入-with-text.

### TODOS.md updates

No new design-debt TODO. Feishu/Wiki import remains the CEO deferral. None remain to ask.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — ContentModule — Rebuild header action row + session badge + details disclosure
  - Surfaced by: CEO S1/S2/S3; Design Pass 1
  - Files: ContentModule.tsx, dashboard.css
  - Verify: vitest ContentModule + DashboardApp + dashboard-layout
- [ ] **T2 (P1, human: ~45min / CC: ~10min)** — tests/docs — Update tests, DESIGN.md, tutorial, TODOS Feishu defer
  - Surfaced by: CEO-X1, spec loop, Design Pass 5
  - Files: ContentModule.test.tsx, DashboardApp.test.tsx, dashboard-layout.test.ts, DESIGN.md, tutorial-menokin-content-publish.md, TODOS.md
  - Verify: docs grep 无「应看到两步」; vitest
- [ ] **T3 (P1, human: ~45min / CC: ~10min)** — ContentModule — Session pending + role-null badge
  - Surfaced by: Design F5 F10 Pass 2
  - Files: ContentModule.tsx, ContentModule.test.tsx
  - Verify: pending 徽章不是未接入；role null → 未接入 warn
- [ ] **T4 (P1, human: ~45min / CC: ~10min)** — ContentModule — Success disable, submitting lock, feedback priority
  - Surfaced by: Design F6 F7 F9 Pass 2
  - Files: ContentModule.tsx, ContentModule.test.tsx
  - Verify: 成功后 publish-action disabled；submitting 时 pick disabled；空扫 muted 且让路
- [ ] **T5 (P1, human: ~1h / CC: ~15min)** — ContentModule — 980 width, pick-first, cancel aria-label, onToggle once
  - Surfaced by: Design F4 F13 F16 F17 F20 Pass 1/6
  - Files: ContentModule.tsx, dashboard.css, dashboard-layout.test.ts
  - Verify: layout 含 max-width 42%、banner 12px；体内选文件在说明书前；cancel accessible name；ready 后手关不因 re-render 再开

_No new tasks from Pass 4._

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI = ContentModule       |
  | Step 0               | 5/10; all 7 passes; DESIGN_NOT_AVAILABLE    |
  | Pass 1  (Info Arch)  | 5/10 → 7/10 after fixes                    |
  | Pass 2  (States)     | 6/10 → 9/10 after fixes                    |
  | Pass 3  (Journey)    | 6/10 → 7/10 after fixes                    |
  | Pass 4  (AI Slop)    | 8/10 → 8/10 after fixes                    |
  | Pass 5  (Design Sys) | 7/10 → 8/10 after fixes                    |
  | Pass 6  (Responsive) | 7/10 → 8/10 after fixes                    |
  | Pass 7  (Decisions)  | 11 resolved, 3 deferred (UC-CEO-1/2/3)     |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (4 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 new (Feishu already deferred)             |
  | Approved Mockups     | 0 generated, 0 approved                     |
  | Decisions made       | 11 added to accepted:design                 |
  | Decisions deferred   | 3 User Challenges + 1 taste (coach tone)    |
  | Overall design score | 5/10 → 7/10                                 |
  +====================================================================+
```

Overall is the lowest rated pass: 7. Plan is not design-complete (need 8+ on every pass). IA and journey stay below 8 while UCs hold.

### Unresolved Decisions

- UC-CEO-1: user-visible 「待开发」 on a working import.
- UC-CEO-2: file picker inside default-collapsed details.
- UC-CEO-3: 取消未完成导入 always on the same row as 发布.

<!-- AUTONOMOUS DECISION LOG (design) -->
| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|
| 8 | Design | Keep header; do not auto-rename 待开发 or default-open picker | User Challenge | user sovereignty | Both voices want 内容导入 + visible picker | Auto-apply UC |
| 9 | Design | Session loading + role-null 未接入 | Mechanical | P1 P5 | F5/F10 false-negative honesty | Flash 未接入 |
| 10 | Design | Success keeps upload; disable publish; no lastReleaseId | Mechanical | P5 | F6/F15 | Fifth state |
| 11 | Design | Pick-first inside details; copy under preview | Mechanical | P1 | F4; does not lift UC-2 | Copy-first |
| 12 | Design | Signed-in short banner; 42% publish box; 12px muted | Mechanical | P5 | F3/F16/F17 980 | Full sentence always |
| 13 | Design | Feedback over reason; cancel aria-label; onToggle once | Mechanical | P1 | F9/F13/F20 | Dual messages / fight open |
| 14 | Design | Coach badge stays 已接入 ok | Taste | user badge≠gate | F12 wanted neutral | Neutral non-owner |

Plan is not design-complete. Run /design-review after implementation for visual QA. Unresolved UCs go to the final approval gate.

### DX Review

DX methodology ranges read: 1–600, 601–1200, 1201–1800, 1801–2132 / 2132 EOF.
Mode: DX POLISH (autoplan override). Product type: **Documentation + internal desktop workbench** (term-match incidental: import/action/agent/library). Not an SDK.
Hall of fame: Pass 1–8 read from `plan-devex-review/dx-hall-of-fame.md`.
Aside: not connected — competitive notes from prior CEO WebSearch + Hall of Fame, not live timed onboarding.

#### Step 0

**0A Persona (inferred, P6):** 办公机管理员（office-owner-publisher）。已经装着 UNSIGNED 0.3.21，会登录，手里有 MENOKIN 表。容忍度：找不到选文件或发布灰却叫「已接入」就会停手。次要读者：改 ContentModule 的桌面贡献者，要 vitest 绿灯、办公机路径不回退。

```
TARGET DEVELOPER PERSONA
========================
Who:       办公机管理员（owner），次要为桌面贡献者
Context:   打开工作台内容管理，发一份仓外表
Tolerance: 已安装路径下 2 分钟内要看到 rel_*；多一次「猜折叠块」就会当半成品
Expects:   选文件看得见、取消和发布同一行、失败是中文原因不是 403
```

**0B Empathy (first person):**
我开工作台，点内容管理。以前选文件就在卡片上。现在顶栏两个按钮同一行，这还好。旁边徽章「已接入」，发布却是灰的，底下写请先导入草稿。主栏一块「待开发 · 内容导入」。我以为飞书导入还没接，不敢点。点开才是选 CSV。发成功看到 rel_*，预览还写待发布，发布钮还在——我不知道能不能再点。取消写在顶栏，清除预览在折叠里，我差点用取消丢掉这张表。话术师同事登录也是「已接入」，点发布没反应，要读按钮下那句一期仅管理员。

**0C Benchmark (installed owner → 已发布 rel_*):**

| Tool | Start → result | Time + evidence | DX choice | Source |
|------|----------------|-----------------|-----------|--------|
| Strapi Content Manager | open entry → Publish | reported <1 min | Publish in header, upload in canvas | Hall of Fame / CEO landscape |
| Contentful entry | open entry → Publish | reported <1 min | status pill ≠ Publish permission copy | CEO landscape |
| WP Gutenberg | editor → Update | reported <1 min | primary + secondary same row | CEO landscape |
| This slice (now) | 内容管理 → 选表 → 发布 | observed office ~1 min | picker always visible | office 0.3.21 checklist |
| This slice (plan) | 内容管理 → 展开待开发 → 选表 → 发布 | estimated +1 click | picker default collapsed | this plan |

Auto-decided target: **Champion (< 2 min)** for the already-installed owner path. The extra expand click still fits the clock; the label 「待开发」 is the adoption risk, held as UC-CEO-1/2. Feasibility: do not add install/login to this clock.

**0D Magical moment:** 头栏 `publish-feedback` 出现 `已发布 rel_*`，发布钮保持禁用。Vehicle: existing `role="status"` feedback (POLISH, no new API).

**0E** DX POLISH.

**0F Journey (all stages, POLISH):**

```
STAGE           | DEVELOPER DOES                         | FRICTION              | STATUS
----------------|----------------------------------------|-----------------------|--------
1. Discover     | 侧栏内容管理                           | 待开发标签            | deferred UC
2. Install      | 已安装 0.3.21                          | 本切片不改安装        | ok
3. Hello World  | 展开 → 选表 → 发布                     | 默认折叠              | deferred UC; tutorial 步骤 3 写死核对块
4. Real Usage   | 取消空扫 → 再发                        | 取消 vs 清除          | fixed aria-label
5. Debug        | 解析失败 / 无会话 / 话术师             | catch 假因飞书；403 教程 | fixed copy + tutorial
6. Upgrade      | 删 pipeline CSS                        | 静默 UI break         | tutorial 同步；无 changelog 条目（非 VERSION bump）
```

**0G First-time (installed owner):**
```
T+0:00  打开内容管理。看见已接入、发布灰、待开发。
T+0:30  犹豫要不要点待开发。点开才有选文件。
T+1:00  选活动表，预览待发布 n 行。点发布。
T+2:00  看到已发布 rel_*。发布钮灰。不确定要不要清预览。
T+3:00  成功。若从没展开待开发，会在 T+0:30 放弃。
```

Native INPUT: `dx 4ac9af273a4c197d2f6b7d77a98b2b5c96f09f865dbab8b2d50c0e7d19d6bd5f` (subagent `01a0e65e-b724-7271-bbf1-6f445581814e`).
Claude Code outside: completed, claude-opus-5. Recommendation: **Revise the disclosure, keep the header**.

```
DX DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Codex (in-host)  Claude Code  Consensus
  1. Getting started < 5 min?          NO (worse IA)    NO           CONFIRMED fail (UC)
  2. API/CLI naming guessable?         MIXED            MIXED        CONFIRMED
  3. Error messages actionable?        MIXED            MIXED        CONFIRMED
  4. Docs findable & complete?         MIXED            MIXED        CONFIRMED
  5. Upgrade path safe?                YES (contract)   YES          CONFIRMED
  6. Dev environment friction-free?    YES (vitest)     n/a          native only
```

Both voices want to change 待开发 / default-collapsed picker → already UC-CEO-1/2, not auto-applied.

#### Pass 1 Getting Started — 4/10 → 6/10

Installed TTHW stays under 2 minutes if the operator expands. Hall of Fame anti-pattern: a golden path labeled unfinished. 10 would put the picker on the first screen with an action-named summary. Held at the gate. 6 because tutorial step 3 becomes a copy-paste checklist and idle reason will point at the disclosure.

#### Pass 2 API/CLI/SDK — 6/10 → 7/10

No public SDK. Buttons 发布 / 取消未完成导入 are guessable. testid `content-pending-dev` is a historical name. Unify Chosen shape with design accepted (pending badge, role-null, short banner, four states). Explicit `publishSucceededThisRound` so nobody parses `rel_*`. 7 not 10: 待开发 remains the summary prefix.

#### Pass 3 Errors — 5/10 → 7/10

Hall of Fame formula: what + why + how + docs. POLISH: what/why/how on paths this slice touches; no new doc_url field.

- Empty sweep: verbatim `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`.
- File catch: stop blaming 飞书/Wiki.
- role-null: stop reusing 请先登录.
- Success: feedback only, publish stays disabled.
Docs links on every `CONTENT_PUBLISH_COPY` line stay out of scope (would be a copy-system expansion).

#### Pass 4 Documentation — 6/10 → 8/10

Tutorial is the golden path. Step 3 must list the exact strings on screen. Failure table 403 row pastes `ownerPublish`. Drop 「没有内容导入通道」 or match `noSession`/`noProduct`. Add `docs/reference-content-publish.md` to blast radius (header + collapsed import). 8: contributor can implement from the file table; operator following the tutorial will expand.

#### Pass 5 Upgrade — 8/10 → 8/10

OpenAPI 1.14.0 unchanged. Tests keep gate/cancel/preview. Pipeline stepper deleted with tutorial sync. No VERSION bump, no changelog row. Residual: silent chrome break for anyone who memorized 两步向导.

#### Pass 6 Dev Environment — 7/10 → 8/10

`pnpm --filter @customer-agent/desktop exec vitest run` three files is the contributor hello world. jsdom details caveat already in the plan. 8.

#### Pass 7 Community — 7/10 → 7/10

Public MIT repo. This slice does not add a channel. No issues. Score stays 7 (not this lake).

#### Pass 8 Measurement — 4/10 → 6/10

Office checklist is the boomerang: 未登录灰、空扫、最小活动表、`rel_*`. No TTHW telemetry (would be new infra, out of POLISH). 6.

```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                             |
+====================================================================+
| Dimension            | Score  | Prior  | Trend  |
|----------------------|--------|--------|--------|
| Getting Started      | 6/10   | 4/10   | ↑      |
| API/CLI/SDK          | 7/10   | 6/10   | ↑      |
| Error Messages       | 7/10   | 5/10   | ↑      |
| Documentation        | 8/10   | 6/10   | ↑      |
| Upgrade Path         | 8/10   | 8/10   | →      |
| Dev Environment      | 8/10   | 7/10   | ↑      |
| Community            | 7/10   | 7/10   | →      |
| DX Measurement       | 6/10   | 4/10   | ↑      |
+--------------------------------------------------------------------+
| TTHW                 | ~1 min installed | <2 min Champion |
| Competitive Rank     | Champion clock, Needs Work IA (UC) |
| Magical Moment       | designed via publish-feedback rel_* |
| Product Type         | docs + internal workbench           |
| Mode                 | DX POLISH                           |
| Overall DX           | 4/10 → 6/10 (lowest pass)           |
+====================================================================+
```

Overall 6 (Pass 8). Getting Started 6 is the UC residual, not a new API.

### DX NOT in scope

- Rename 待开发 / default-open picker (UC-CEO-1/2).
- doc_url on every CONTENT_* copy line.
- New install/onboarding from zero clone.
- TTHW telemetry / SPACE instrumentation.

### DX what already exists

tutorial-menokin-content-publish.md, CONTENT_PUBLISH_COPY, CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT, publish-feedback role=status, vitest ContentModule/DashboardApp/dashboard-layout.

### TODOS.md

No new DX TODO. Feishu/Wiki remains CEO deferral.

## Implementation Tasks (DX)

- [ ] **T6 (P1, human: ~30min / CC: ~8min)** — tutorial — Exact UI-string checklist in step 3; ownerPublish in 你需要 and failure table
  - Surfaced by: DX D1 Pass 4
  - Files: docs/tutorial-menokin-content-publish.md
  - Verify: grep 无「应看到两步」；失败表 403 行等于 ownerPublish
- [ ] **T7 (P1, human: ~30min / CC: ~8min)** — ContentModule — publishSucceededThisRound + pending/success/rerender tests
  - Surfaced by: DX E5 G2 X3
  - Files: ContentModule.tsx, ContentModule.test.tsx
  - Verify: 成功后 disabled；pending 非未接入；ready 关闭后 rerender 仍关
- [ ] **T8 (P2, human: ~20min / CC: ~5min)** — docs — Sync reference-content-publish.md to header + collapsed import
  - Surfaced by: DX D2
  - Files: docs/reference-content-publish.md
  - Verify: 文档写头栏动作与选文件仍只预览
- [ ] **T9 (P1, human: ~15min / CC: ~5min)** — ContentModule — Honest file-read catch and role-null reason
  - Surfaced by: DX R3
  - Files: ContentModule.tsx, dashboard-content.ts or CONTENT_PUBLISH_COPY, tests
  - Verify: catch 不含飞书/Wiki；role null 不是「请先登录」
- [ ] **T10 (P1, human: ~10min / CC: ~3min)** — ContentModule — Empty sweep uses NO_IN_FLIGHT verbatim
  - Surfaced by: DX R2
  - Files: ContentModule.tsx, tests
  - Verify: 空扫 toHaveTextContent 现常量全文

_No new tasks from Pass 5/6/7._

<!-- autoplan-accepted:dx -->
- 教程步骤 3 写成可复制核对块（顶栏「内容管理」、徽章已接入或未接入、取消与发布同一行、summary 四态文案）。步骤 4 只保留选表/预览/归属。「你需要」第 4 条：话术师可预览，发布禁用，文案 `CONTENT_PUBLISH_COPY.ownerPublish`，不是 HTTP 403。失败表原 403 行的「你看到」列粘贴 ownerPublish 全文。删除或改写「未接入：没有内容导入通道」，使其等于屏幕上的 noSession/noProduct 句。验证：docs grep 无「应看到两步」；失败表行与 copy 常量一致。
- 空扫唯一真源 `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`（当前没有未完成的导入。登录还在，不必重新登录。），muted，不另造短句。验证：现 ContentModule 空扫用例仍过。
- 显式 `publishSucceededThisRound`（成功 true；clearUpload 或新选文件 false）。`publishDisabled` 并上它。禁止从 feedback 字符串解析 releaseId。验证：成功后 publish-action disabled，summary 仍待发布 n 行。
- 本地读取 catch：「无法读取该文件。请确认文件未打开且仍是 CSV/xlsx 后重试。」不提飞书或 Wiki。`signedIn && role===null` 的发布原因：「会话角色无效，无法发布。请退出后重新登录。」不复用 noSession。验证：对应用例。
- 测试：session pending 时徽章不是未接入；ready 后用户关上 details，再 rerender，open 仍 false 且 summary 含 sourceName。验证：ContentModule.test.tsx。
- blast 增加 `docs/reference-content-publish.md`：头栏动作 + 折叠导入；选文件仍只本地预览。
- Chosen shape 与 design accepted 冲突时以后者为准（pending 徽章、role-null 未接入、已接入短横幅、四态、pick-first、42%）。
<!-- /autoplan-accepted:dx -->

### Eng Review

Eng methodology ranges read: 1–600, 601–1200, 1201–1800, 1801–2169 / 2169 EOF.
Scope gate: plan mode — auto-selected B (reviewing `docs/plans/2026-09-28-content-management-ui.md`).
Mode: FULL_REVIEW. Autoplan override: never reduce. File count 10 (8 original + `docs/reference-content-publish.md` + `docs/how-to-office-machine-product-remote.md`). 0 new services. Original arrangement kept.
Native INPUT: `eng 6a93df502171fbd6bd9f2adb5123b8d52be64cd2ea22a41cd9c2f0ddc5723673` (subagent `01a0e667-ad18-7163-8465-df8d67cd3f7c`).
Outside: unavailable (claude-code returned deepseek-v4.1-flash without `Recommendation:` marker; no coverage credit). Native-only for consensus.

```
ENG DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Codex (in-host)  Claude Code  Consensus
  1. Architecture sound?               YES w/ fixes    N/A          N/A
  2. Test coverage sufficient?         NO until listed N/A          N/A
  3. Performance risks addressed?      YES (240px)     N/A          N/A
  4. Security threats covered?         YES             N/A          N/A
  5. Error paths handled?              MIXED           N/A          N/A
  6. Deployment risk manageable?       YES (asar)      N/A          N/A
```

Prior learning applied: `fb87b14` stopped showing 未接入 for a signed-in operator. Session pending must not reintroduce that flash.
Retrospective: `e6e0dae` added `content-pipeline-steps`; this slice deletes it. `2a8f945` disables cancel without a session; keep that.

#### Scope Challenge

What already solves it: `contentPublishGate`, `cancelInFlight`, `parseUpload`, `StatusBadge`, `.dash-contract-details`, `CONTENT_PUBLISH_COPY`. Minimum change: CSS flex + header JSX + details wrap. Complexity: 10 files, 0 new classes. Search: native `<details>` [Layer 1]. TODOS: Feishu import stays Open. Completeness: listed tests + office checklist. Distribution: unsigned rebuild later.

No issues found that require cutting files. Arrangement: Original (ContentModule + css + three vitest files + DESIGN/tutorial/TODOS + reference + office how-to).

#### Section 1 Architecture

```
  DashboardApp (keepContent)
    └── ContentModule
          ├── sessionEffect → window.dashboardContent.session()
          ├── header: h1 + StatusBadge + banner | publish-box
          ├── details.content-pending-dev
          └── onPublish → publishDraft (unchanged HTTP)
```

No new IPC. Coupling is CSS + tests. Rollback = revert renderer files.

Findings:
1. [P1] (confidence: 9/10) plan Chosen shape vs accepted tail — two badge formulas. Quote plan: `其余已登录（含 coach/agent，含异常 role === null）为「已接入」` vs accepted `signedIn && role===null` 未接入. Fix: rewrite Chosen shape to the later iff; delete industry 「五态已发布行」.
2. [P1] (confidence: 9/10) ContentModule.tsx:92,110-122 — `useState(null)` + `setSessionView(result.ok ? result : null)`. First paint and focus reload can flash 未接入. Fix: tri-state. No API → 未接入 immediately. First `session()` pending → badge mounted, text 正在确认会话, not 未接入. Focus keeps last view until the next result.
3. [P2] (confidence: 9/10) dashboard-content.ts:233-244 — `isDashboardContentSessionResult` requires `role ∈ {agent,coach,owner}` when signedIn. Renderer `signedIn && role===null` is mock-only. Fix: drop DX `invalidRole` copy. Bad payload = settle fail → 未接入 + existing failure message.
4. [P2] (confidence: 8/10) planned `<details open={open} onToggle>` — React 18 will retrigger toggle. Fix: `uploadStatusRef`; setOpen(true) only on transition into reading|ready|error; `onToggle` only if `next !== open`.
5. [P2] (confidence: 8/10) 980 is the window, sidebar 248 leaves ~660px module. `flex: 0 0 auto; max-width: 42%` can clip or squeeze reasons. Fix: `flex: 0 1 auto; max-width: 42%; min-width: min-content`; `.content-action-row .dash-reset { min-height: 40px }`; geometric assert both buttons in view after `nav-content`.

No new security surface. Sequential implementation, no parallelization.

#### Section 2 Code quality

Reuse StatusBadge and dash-contract-details. Delete `pipelineStepStatus`. No new shared helper (one caller).

6. [P1] (confidence: 9/10) ContentModule.tsx:31-35 — error variant has no `sourceName`. Catch at 180-183 drops the filename and blames 飞书. Fix: `{ status:'error'; message; sourceName?: string }`; catch copy from DX accepted; keep idle help sentence so DashboardApp status match still works.
7. [P1] (confidence: 8/10) ContentModule.tsx:188 `cancelDisabled = submitting || sessionView?.signedIn !== true` — same-row cancel is the in-flight escape; submitting must not grey it. `publishSucceededThisRound` must not reset on domain override.

Do not nest a second details for SOP copy (would hide DashboardApp assertions). pick-first, copy under preview.

#### Section 3 Tests

Framework: vitest via `pnpm --filter @customer-agent/desktop exec vitest run`.

```
CODE PATHS                                              USER FLOWS
[+] ContentModule session                               [+] Open 内容管理
  ├── [GAP] pending first session()                     ├── [★★ TESTED] no session publish disabled
  ├── [GAP] no dashboardContent → 未接入 immediately    ├── [GAP] pending is not 未接入
  └── [★★ TESTED] coach/agent gate                      ├── [GAP] 980 both buttons visible
[+] details open machine                                [+] Pick file
  ├── [GAP] transition-only setOpen                     ├── [★★ TESTED] xlsx preview (must waitFor open)
  ├── [GAP] ready close + rerender stays closed         └── [GAP] error keeps sourceName + parser span
  └── [★★ TESTED] idle closed after plan update
[+] publishSucceededThisRound                           [+] Publish
  ├── [GAP] success disables publish                    ├── [★★ TESTED] owner publishDraft called
  ├── [GAP] override does not re-enable                 └── [GAP] success rel_* + still 待发布 n 行
  └── [GAP] submitting pick disabled
[+] cancel                                              [+] Cancel
  ├── [★★ TESTED] empty sweep NO_IN_FLIGHT              ├── [GAP] aria-label accessible name
  └── [GAP] enabled while submitting                    └── [★★ TESTED] disabled without session

COVERAGE (planned): gaps listed as T7/T11–T13
QUALITY: existing gate tests ★★★; new layout tests must be ★★ not smoke
GAPS: 11 (0 E2E required if component geometry test exists; 0 eval)
```

Regression CRITICAL: office 0.3.21 cancel-then-publish still finds both buttons without opening 待开发 for cancel; pick still needs expand. Keep gate tests. jsdom: `toBeVisible` + `open`.

#### Section 4 Performance

Preview already caps 5000 rows. 240px overflow does not bound React commit cost. Do not virtualize this slice (P3). Summary uses `n = rows.length`. No N+1. OK.

#### Failure modes

```
  PATH                  | FAILURE                         | RESCUED | TEST | USER SEES
  session pending       | flash 未接入                    | Y (tri-state) | Y | 正在确认会话
  no API                | hang pending                    | Y (immediate 未接入) | Y | 未接入
  details onToggle      | close then reopen               | Y (ref) | Y | stays closed
  980 clip              | 发布 cropped                    | Y (flex 0 1) | Y geometry | both buttons
  success re-click      | IMPORT_IN_FLIGHT                | Y (flag) | Y | disabled + rel_*
  file catch            | 飞书 blame                      | Y (new copy) | Y | 无法读取该文件
```
0 CRITICAL silent gaps after accepted:eng.

#### NOT in scope (Eng)

Virtualize 5000-row preview. Nested SOP details. invalidRole HTTP contract. New IPC.

#### What already exists

Quoted above. `fb87b14` honesty for signed-in 未接入.

Sequential implementation, no parallelization opportunity.

## Implementation Tasks (Eng)

- [ ] **T11 (P1, human: ~45min / CC: ~12min)** — ContentModule — Session tri-state; badge always mounted
  - Surfaced by: Eng finding 2 ContentModule.tsx:92,110-122
  - Files: ContentModule.tsx, ContentModule.test.tsx
  - Verify: pending 不是未接入；无 API 立刻未接入；focus 不闪
- [ ] **T12 (P1, human: ~30min / CC: ~8min)** — ContentModule — details prev-status ref + onToggle guard
  - Surfaced by: Eng finding 4
  - Files: ContentModule.tsx, ContentModule.test.tsx
  - Verify: ready 关闭后 rerender 仍关
- [ ] **T13 (P1, human: ~30min / CC: ~8min)** — layout — content-column 42% flex 0 1 auto; 40px reset; geometry
  - Surfaced by: Eng finding 5
  - Files: dashboard.css, dashboard-layout.test.ts, ContentModule.test.tsx
  - Verify: 980 nav-content 两按钮在视口内
- [ ] **T14 (P2, human: ~15min / CC: ~4min)** — docs — how-to-office-machine step 7 expand 待开发
  - Surfaced by: Eng finding 8
  - Files: docs/how-to-office-machine-product-remote.md
  - Verify: 步骤含展开待开发

<!-- autoplan-accepted:eng -->
- Chosen shape / 业内映射 / 第一组验收与后段冲突时，**改掉正文**：徽章 iff 为 design+eng 后段；删除「五态已发布行」和「含 role===null 为已接入」。验证：Implementation 不再出现互相打架的徽章公式。
- 会话三态：无 `window.dashboardContent` → 立刻未接入；有 API 且首次 session() 未返回 → 徽章节点仍在，文案「正在确认会话」/neutral，禁止未接入；settle 后用 iff。focus 刷新保留上一帧 view。验证：deferred session 用例；无 API 用例。
- 丢掉 DX「会话角色无效」专文案。真实 `isDashboardContentSessionResult` 不会送出 signedIn+role null。坏 payload 走 settle 失败。验证：不新增 invalidRole 常量。
- `uploadStatusRef` 记录上一帧 status；仅 transition into reading|ready|error 时 setOpen(true)。onToggle：`next !== open` 才 setOpen。clearUpload 同步关。禁止 `open === (status !== 'idle')`。
- `.dash-publish-box { flex: 0 1 auto; max-width: 42%; min-width: min-content; }`。`.content-action-row .dash-reset { min-height: 40px }`。预算按内容列。验证：打开 nav-content 后两按钮 getBoundingClientRect 在视口内。
- error `{ message, sourceName? }`；catch 用 DX 已接受的「无法读取该文件…」；idle 体内保留「选择 CSV 或 xlsx」帮助句。
- `publishSucceededThisRound` 不因归属下拉复位；`cancelDisabled` 不再并上 submitting。空扫全文 `CONTENT_IMPORT_FAILURE_COPY.NO_IN_FLIGHT`。
- 测试一律 `toBeVisible` + `open`；hidden input 用 waitFor。验证命令加上 tutorial grep 与 gate 单测。blast 含 `docs/how-to-office-machine-product-remote.md` 步骤 7：先展开待开发。
- 折叠体内 pick-first，说明书在预览下，不再套一层默认闭合 details。idle summary 可加「选择 CSV 或 xlsx」，前缀仍「待开发」（UC 未批）。
<!-- /autoplan-accepted:eng -->

```
  +====================================================================+
  |            ENG PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | Step 0 Scope Challenge | scope accepted as-is (never reduce)       |
  | Architecture           | 5 issues, all mapped                      |
  | Code Quality           | 2 issues, all mapped                      |
  | Test Review            | diagram produced, 11 gaps → tasks         |
  | Performance            | 0 blocking (no virtualize)                |
  | NOT in scope           | written                                   |
  | What already exists    | written                                   |
  | TODOS.md updates       | 0 new (Feishu already deferred)           |
  | Failure modes          | 6 rows, 0 CRITICAL after eng accepted     |
  | Unresolved decisions   | 0 in this review (UCs belong to gate)     |
  | Outside voice          | unavailable (missing Recommendation)      |
  | Parallelization        | sequential                                |
  | Lake Score             | N/A (kind)                                |
  +====================================================================+
```

Approval readiness: PASS (eng mechanical T11–T14 + accepted:eng). User Challenges unchanged.

### DX Implementation Checklist (late, required by DX skill)

```
DX IMPLEMENTATION CHECKLIST
============================
[ ] TTHW installed owner < 2 min (Champion clock; extra expand is UC)
[ ] Magical moment: publish-feedback 已发布 rel_*
[ ] Errors touched this slice: problem + cause + fix (no new doc_url)
[ ] Tutorial step 3 copy-paste matches UI strings
[ ] NO_IN_FLIGHT verbatim
[ ] vitest three files + tutorial grep
[ ] Changelog/VERSION: not this slice
```


## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` via /autoplan | Scope & strategy | 1 | issues_open | 10 proposals, 8 accepted, 1 deferred |
| Outside Review | claude-code | Independent 2nd opinion | 3 | mixed | design+dx completed; eng unavailable |
| Eng Review | `/plan-eng-review` via /autoplan | Architecture & tests (required) | 1 | issues_open | 11 issues, 0 critical gaps |
| Design Review | `/plan-design-review` via /autoplan | UI/UX gaps | 1 | issues_open | score: 5/10 → 7/10, 11 decisions |
| DX Review | `/plan-devex-review` via /autoplan | Developer experience gaps | 1 | issues_open | score: 4/10 → 6/10, TTHW: ~1 min → <2 min |

- **OUTSIDE COVERAGE:** design completed (Revise disclosure, keep header). dx completed (same). eng unavailable (validator: missing Recommendation line; model deepseek-v4.1-flash). Native eng INPUT `6a93df50…` completed.
- **CROSS-MODEL:** design+dx native + claude-opus-5 agreed on header keep / disclosure revise. Eng outside missing; native-only.
- **VERDICT:** APPROVED as-is 2026-09-28 (user D1 A). UC-CEO-1/2/3 kept as original direction.

**UNRESOLVED DECISIONS:**
- none — user kept 待开发 label, default-collapsed picker, and same-row cancel+publish
