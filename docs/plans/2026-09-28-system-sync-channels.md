<!-- /autoplan restore point: "/Users/hutou/.gstack/projects/hutou/main-autoplan-restore-20260928-113802.md" -->
# 系统同步：分库看板、坐席提醒、不拆发布主干

## Implementation plan

### Problem

办公机已经能按域发布话术（`rel_24` 活动、`rel_25` 售前）。工作台「系统同步」却仍把话术当成**一个**全局版本号：一张卡、一个 `releaseId`、一个条目总数。坐席侧狐狸头在发布后没有未读点。SOP 不在这条同步里。运营要看「产品 / 活动 / 售前 / 售后 / SOP 各自刚更新了什么」，坐席要在狐狸头右上角看到有新内容。

### What already exists (do not rebuild)

- **合成发布、按域替换：** `publish_content_release` 只替换本批绑定的域，其余域从上一版继承。`rel_25` 换了售前 75 条，活动 4 / 产品 106 / 售后 223 未动。这已经是「部分版本」的数据语义。
- **四域 source gate：** OpenAPI 1.14.0 `/v1/announce/current` 必须一次过四域 canonical 源。`/v1/announce/snapshot` **禁止返回部分快照**。检索租约绑的是**一个** `current_release_id`。
- **话术库已带域：** `DashboardWordingEntry.domain` 已是 `product | campaign | presale | aftersale`。`dashboardWording.list()` 能按域计数。
- **同步管道：** `ProductAnnounce.refresh` → `/v1/announce/current` + ACK + 分页 snapshot + 本地 hydrate。Query 每次检索会 `refreshAnnounce`。ACK 合同写明：**ACK 只是内容游标，不是用户已读**。
- **系统同步 UI：** `AnnounceModule` 两个 tab：话术版本更新、软件版本更新。软件目录 UNSIGNED、禁止 `latest.yml`，本计划不改软件自动更新。
- **狐狸警示：** DESIGN.md 允许快捷键失败时的警示点；Query 已有 `announce-banner`。不要做成通话中弹窗。
- **SOP：** 独立窗、切片 1 过敏 DEMO、不进 `content_releases`。没有正式 SOP 发布接口。
- **合同锁：** OpenAPI 1.14.0 / schema.v1.18。新 HTTP 必须 `contracts:intake`。不手改 `packages/contracts`。不 intake 1.15.0。

### Industry mapping (reuse, do not invent a fourth knowledge product)

业内把三件事拆开，我们按同一拆法落地：

| 业内能力 | 代表 | 我们已有 / 应对 |
|---|---|---|
| 分类知识库 | Salesforce Data Categories；Zendesk Guide Category→Section→Article；Guru Collections | 四个 `category` 域。不要做成四个独立 current_release。 |
| 文章版本 | Salesforce：每篇 1 draft / 1 published / N archived | `content_releases` + `release_items`。全局合成版本仍是 `rel_N`。 |
| 分类上的「这次改了什么」 | Zendesk Team Publishing 生命周期；changelog **label**（Canny/Beamer） | 一次发布产出若干 **channel event**（被替换的域），不是四条平行主干。 |
| 坐席未读 | Canny/Headway/Beamer 应用内 widget：角标，打开即清 | 狐狸头小圆点 + 系统同步看板。**不要** Beamer 式强制弹窗（坐席正在接待）。 |
| 内容已同步 ≠ 人已读 | Zendesk 修订史 vs 帮助中心 Updated 日期经常不一致 | 保持 ACK ≠ 已读。未读用本地 `last_seen`（一期），二期再 intake 服务端游标。 |
| SOP / 流程 | Salesforce Guided Action / 独立流程对象，很少和 FAQ 文章共用版本号 | 一期不进系统同步，避免空货架。 |

**明确不抄：** 四套独立 KB、每域独立检索租约、发布后全屏 modal、把 ACK 当已读、软件自动更新 / `latest.yml`。

### Chosen shape

**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。对外用词锁死「本版已更新 / 本版沿用」，不再写「已替换 / 未替换」。

1. 合成发布仍是唯一 `current_release_id`。发布回执两行：主句 `已发布 rel_N · 姓名`；下一行四库 delta「售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用」。`publishDraft` 把**同一句 delta**写入已有 `Announcement.summary`（现合同 `string | null`，今天桌面传 `null`）。`/v1/announce/current` 的 `announcement.summary` 是所有机器的卡状态源。不改 OpenAPI。
2. 系统同步第一屏是四张卡（顺序：产品、活动、售前、售后）。卡上：库名 → 本版状态 → 当前条数。已更新库可显示**一次** `announcement.title`，不写 `rel_N`。继承库文案「本版沿用」+「内容仍是当前可用」，`StatusBadge` 用现有 `neutral`，禁止 warn/danger。合成 `rel_N` 放四卡下方作检索租约脚注。≥1180 宽 2×2；小于 1180（含 980–1179）一列。
3. **卡状态**只解析 `announcement.summary` 那句固定顺序 delta。禁止用 hydrate 哈希、本机 `sourceBindings`、或「相对上一份快照的域差」填卡。解析失败或 summary 为空：四卡「无法标出本版更新了哪一库」，仍显示库名+条数+脚注 `rel_N`。**点/横幅** = 该 session `userId` 相对 last_seen 的**域内容哈希**（category + 排序后的 `scriptId+content_hash`，**不含** `releaseId`）。无基线：不写时间、不点亮；第一次**四域 snapshot 完整成功**后才建基线。
4. 内容更新是软信号。运输层是现有已登录 Query 的 `sessionStatus`→`refreshAnnounce`（约 10s）以及发布者 `afterPublish` 的 refresh。不是跨机 push。`ProductAnnounce.refresh` 在 `releaseId` 变化时向 fox + query + dashboard 扇出独立 `content-updated`（`{releaseId, summary, domainHashes}`）。**禁止**走 `PRODUCT_ANNOUNCE_INVALIDATED`，**禁止** `refreshAnnounce` 在换 `rel_N` 时 `setResults([])`。`expired` / `source_gate` / `unavailable` 保持现有抽空语义。狐狸未读是品牌紫实心点（约 8px，`--fox` #8B5CF6），按 `data-dock-edge` 锚在**可见内侧**上角（右贴边→视觉左上），**禁止** `FoxHead.warning`。快捷键失败保持黄点 `top:10px; right:10px`。两点同在时间距 ≥10px。Query 横幅 `--muted`，不要 `is-invalid`；计入 hug 高度。已读：Query **窗可见**（非 FOX_IDLE、非 `document.hidden`）且横幅停留 ≥1s 或关掉，或「话术版本更新」tab 实际可见。发布者 userId 不清坐席。单击狐狸仍开查询。
5. SOP 一期不占位。软件 tab 零 diff。卡可点：提升 `WordingLibraryModule` 的 domain 筛选，不要死卡。

可见层级（一屏只保这三层）：

    运营回执
      已发布 rel_N · 姓名
      售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用

    系统同步 · 话术版本更新（≥1180 2×2；小于 1180 一列）
      [产品 沿用 N条] [活动 沿用 N条]
      [售前 已更新 + 标题一次] [售后 沿用 N条]
      脚注：检索租约 rel_N

    坐席
      狐狸内侧紫点（≤10s poll）→ 查询 muted 横幅（可关）→ Top 3 仍在

### Phase 1 (no new HTTP)

- 发布成功两行：短主句 + 四库 delta。仅 `publishDraft` `ok: true` 后画 delta；失败不说替换，内存里的 `sourceBindings` 不得画成已更新。加载沿用「加载中…」。无 `current_release`：整页「未接入当前发布」。有 release 但 `list()` 失败：四卡仍在，条数降级「—」，不拆第一屏。0 条仍保留卡。
- 四卡规格见 Chosen shape。条数和域哈希用**当次 snapshot 内存**，不信 `kept-larger` 磁盘 hydrate。数字用 refresh 后的域计数；list 失败省略括号里的条数。
- 坐席闭环走查询：横幅「售前话术已更新」（多域固定顺序 产品→活动→售前→售后）；≥1s 计时绑定那次 `domainHashes`。下一次**新检索**走新 `rel_N` 租约。
- last_seen 在 **main** origin-keyed userData（对齐 `product-session.${id}.enc`），键 `{userId, domain}`，文件 0o600。IPC **不得**带 userId，只用 `ProductSession.view().userId`；未登录 no-op。Fox 只读未读投影，不得 `PRODUCT_ANNOUNCE_REFRESH`，不得 mark-read。ACK / `client_sync_state` **禁止**写 last_seen。
- 狐狸紫点 + 黄故障点可同时存在。`aria-label`：未读加「有话术更新」；双态时故障文案也要在。
- 测试见任务 5。文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效；summary delta 是卡状态源。

状态（用户看见的，不是后端）：

    FEATURE     LOADING                    EMPTY            ERROR                         SUCCESS                       PARTIAL
    发布回执    现有 disable，无假 delta     —                失败不说替换                   两行主句+delta                —
    四卡        「加载中…」不闪空            0 条仍保留卡      无 current：整页未接入；list 失败保留卡条数「—」  解析 summary 四卡+脚注     summary 不可解析：「无法标出本版更新了哪一库」
    狐狸点      无会话不画                   无基线不点亮      黄点可与紫点同在                内侧 8px --fox                —
    Query横幅   —                            无未读不画        真失效只留 is-invalid          muted 指名域，可关             多域固定顺序 产品→活动→售前→售后

管道（一期桌面，不改合同）：

    publishDraft ok
      -> summary = 四库 delta 原句
      -> afterPublish -> ProductAnnounce.refresh
           |-- ACK（不写 last_seen）
           |-- snapshot
           +-- releaseId 变：content-updated -> fox + query + dashboard
               Query：换租约，禁止 setResults([])
               Fox：只读未读
               Dashboard：四卡重解析 summary

    已登录 Query 10s sessionStatus -> refreshAnnounce  （坐席运输层）
    expired / source_gate / unavailable -> 现有 onInvalidated（可抽空）

### Phase 2 (needs contracts:intake, product decision)

Only after Phase 1 在办公机跑过。

- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。
- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。
- SOP 频道等 SOP 发布合同，不提前编造版本。

### NOT in scope

- 拆四个 `content_current` / 四次 snapshot / 部分快照
- 软件自动更新、签名、`latest.yml`
- 1.15.0 话术师自发布
- Dashboard 整页重设计、改产品名
- SOP 生产发布与过敏流程写路径
- 多租户推送、邮件摘要
- 手改 OpenAPI / 未授权 intake
- Beamer 式强制弹窗、系统通知中心（一期）
- 跨机 push / websocket；狐狸点依赖已有 ≤10s refresh

### Implementation tasks

1. `publishDraft` 在 ok 时把四库 delta 写入 `Announcement.summary`；回执两行；扩展 `isDashboardContentPublishResult`。
2. `AnnounceModule` 解析 summary 画四卡；不可解析则「无法标出…」；条数来自内存 snapshot；点卡提升 wording domain。
3. `ProductAnnounce.refresh` 换 `rel_N` 扇出 `content-updated`；Query 禁止因此 `setResults([])`；Fox/Dashboard 订阅；fox 不得 refresh announce。
4. main last_seen（origin+session.userId）；Query 仅窗可见才记已读；话术 tab 可见才清看板；ACK 不写 last_seen。
5. 测试：坐席机（非发布者）`rel_25` 只标售前已更新；无基线不点亮；通话中 refresh 新 rel Top 3 仍在；隐藏 Query 不清 last_seen；IPC 伪造 userId 无效；右贴边紫点在内侧；expired 仍抽空；软件 tab 零 diff。
6. 文档：summary delta = 卡状态；ACK ≠ 已读；软更新 ≠ 版本失效；坐席点最多约 10s。
7. 办公机：坐席机先有旧快照再收新发布；独立坐席会话看点亮（≤10s）；owner 开看板不得灭坐席点。


<!-- autoplan-accepted:ceo -->
- 合成发布仍是唯一 `current_release_id`；检索/hydrate 不拆四租约。
- 用户拍板诚实四库：四张卡只写「本版已替换 / 本版未替换」；全局 rel 只出现一次。禁止用 rel_N 当域版本，禁止无基线时伪造域级发布时间。
- SOP 一期不占位。发布回执必须带 delta。
- 未读按 userId 隔离；发布者打开看板不得清坐席。狐狸点与故障红分色。发布后必须通知 Fox/Dashboard，不只等下次查询。
- ACK 不得当已读。一期无新 OpenAPI。二期 channels[] 在出现「继承域被当成新发布」或「换机未读不一致」时再 intake。
- 软件 tab 不动。办公机验证用独立坐席会话。
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- 四卡第一屏：库名 → 本版已更新/沿用 → 条数；rel_N 作脚注。沿用 `StatusBadge` `neutral`，不用 warn。已更新卡可显示一次发布标题，不写 rel_N。
- 卡=本版绑定域（回执或本机 releaseId→domains[]）；点/横幅=userId 哈希差。无基线不点亮、不写时间；对不上则「无法标出本版更新了哪一库」。
- 软更新：独立 `content-updated`，不清空检索 / Top 3。紫点 `--fox` 非 `FoxHead.warning`。横幅 `--muted` 非 is-invalid。已读：查询横幅看见（≥1s）或关掉，或话术 tab 可见。发布者 userId 不清坐席。
- 发布回执两行。多域横幅顺序 产品→活动→售前→售后。贴边内侧点。aria 未读加「有话术更新」。卡可点则筛该域，否则死卡。
- 测试：只发售前仅售前「本版已更新」且继承库不得同标题/warn；无基线不点亮；通话中更新不清空 Top 3；第二 userId 未读不被发布者清掉。文档：软更新 ≠ 版本失效。
<!-- /autoplan-accepted:design -->

<!-- autoplan-accepted:eng -->
- 卡状态唯一源：发布 ok 时写入的 `Announcement.summary` 四库 delta 原句；所有机器从 `/v1/announce/current` 读。禁止用 hydrate 哈希或本机 sourceBindings 填卡。summary 空或不可解析：四卡「无法标出本版更新了哪一库」。
- 未读运输层：已登录 Query 现有 ≤10s `refreshAnnounce` + 发布者 afterPublish refresh。`content-updated` 由 main 扇出到 fox/query/dashboard。禁止 `PRODUCT_ANNOUNCE_INVALIDATED`。Query 换 `rel_N` 禁止 `setResults([])`。expired/source_gate 保持抽空。
- last_seen 在 main origin-keyed userData，键 session.view().userId；IPC 不得带 userId；Fox 只读；ACK 不写 last_seen。已读仅 Query 窗可见或话术 tab 可见。域哈希不含 releaseId。
- 对外用词：本版已更新 / 本版沿用。卡可点提升 wording domain。紫点随 data-dock-edge 贴可见内侧。软件 tab 零 diff。
- 测试：坐席机 rel_25 只标售前已更新；隐藏 Query 不清点；通话中 Top 3 保留；伪造 userId 无效；右贴边内侧点；ACK 不灭点；expired 仍抽空。
<!-- /autoplan-accepted:eng -->
## Review record

<!-- autoplan-baseline-edits:ceo {"sourceSha256":"0cb1658fbea394f66371edd5e827cbab905bc07adf769c9cc90961e3b96c78b1","replacements":[{"oldText":"| SOP / 流程 | Salesforce Guided Action / 独立流程对象，很少和 FAQ 文章共用版本号 | SOP 单独一列。未接入正式发布前只显示「未接入」，禁止 DEMO 冒充生产版本。 |","newText":"| SOP / 流程 | Salesforce Guided Action / 独立流程对象，很少和 FAQ 文章共用版本号 | 一期不进系统同步，避免空货架。 |"},{"oldText":"### Chosen shape\n\n**一个合成发布 + 五条频道。**\n\n1. 管理员在内容管理上传并发布（现有 `publishDraft`）。被替换的域成为本次的频道事件。\n2. 系统同步「话术版本更新」改成五张卡：产品话术、活动话术、售前流程、售后流程、SOP。每张卡：频道名、当前合成 `rel_N`、该域条目数、最近一次**触及该域**的发布时间 / 标题、未读点。\n3. 合成 `rel_N` 仍是检索/hydrate 的唯一 current。卡片上的「部分版本」是「该域上次被哪次发布换过」，用本地对比上次 hydrate 的域哈希，或（二期）发布时写入的 channel event。\n4. 狐狸头右上角小圆点：任一话术频道相对坐席 `last_seen` 有新事件。点开系统同步或点开狐狸查询并看到更新条后清除。不打断接待。\n5. SOP 卡一期固定未接入。SOP 正式发布（未来合同）后再接同一套频道模型。\n\n### Phase 1 (no new HTTP)\n\nDesktop-only projection on frozen 1.14.0.\n\n- `AnnounceModule` 话术 tab：按 `dashboardWording.list()` 的 `domain` 分成四张卡 + SOP 未接入卡。沿用 `StatusBadge`、现有 token，不新视觉语言。\n- 本地存上一份 hydrate 的 per-domain content hash（已有 snapshot `category`）。新 `rel_N` 且某域哈希变了 → 该频道未读。\n- `last_seen` 写在 origin-keyed userData（与 P7 origin 一致），按 `userId` 分。打开系统同步或点「知道了」写入。\n- 狐狸头：renderer 在 88px 窗内画右上小圆点（约 8px，`--fox` 或危险红配文字「有更新」给读屏）。`prefers-reduced-motion` 静态点。键盘焦点不靠圆点。\n- Query 横幅：已有 invalid banner；releaseId 变且有未读频道时一句「话术已更新，打开系统同步查看」+ 可清未读。不自动展开 Dashboard。\n- 软件 tab 不动。\n- 测试：`AnnounceModule` 四域计数；哈希不变无点；只售前变则仅售前未读；打开看板清点；reduced-motion；无会话不画点。\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n\n### Implementation tasks\n\n1. 从 wording list + 本地 hydrate 哈希算出四频道头与未读。\n2. 重画 `AnnounceModule` 话术 tab 为五张卡（SOP 未接入）。\n3. origin-keyed `last_seen` 读写；打开看板清除。\n4. 狐狸头未读点 + Query 一句更新条。\n5. 组件测试覆盖四域 / 单域未读 / 清除 / 无会话。\n6. 文档：`docs/reference-content-publish.md` 与系统同步说明：合成 rel vs 频道；ACK ≠ 已读。\n7. 办公机：发布售前后狐狸点亮，打开系统同步后熄灭。\n\n","newText":"### Chosen shape\n\n**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。\n\n1. 合成发布仍是唯一 `current_release_id`。发布回执加一行 delta：「本版替换了售前 75 条；活动 / 产品 / 售后本版未替换」。\n2. 系统同步话术 tab 四张卡。每张卡：频道名、该域当前条目数、**本版状态**（「本版已替换」或「本版未替换」）。全局 `rel_N` 只出现一次，在卡组上方，不当每张卡的版本号。无本地基线时写「尚无上次快照，不能声称域级发布时间」，不编造 last-touch。\n3. 「本版已替换」只来自本次发布绑定的域（`source_bindings` / 发布回执），不用 hydrate 哈希冒充发布时间。本地哈希只用于坐席未读：相对上次快照该域内容变了。\n4. 狐狸未读点与快捷键故障红点分区/分色。发布后必须把公告失效打到 Fox/Dashboard，不能只等下次查询。`last_seen` 按 `userId` 隔离；发布者打开看板不得清坐席未读。\n5. SOP 一期不占位。软件 tab 不动。\n\n### Phase 1 (no new HTTP)\n\n- 发布成功文案带 delta（本批 `sourceBindings` 的域 = 已替换）。\n- `AnnounceModule` 四卡 + 顶部一次合成 `rel_N`。继承域默认「本版未替换」。\n- 坐席未读：Query 一句指名域（「售前话术已更新」）；狐狸点非故障红。打开系统同步只清当前 `userId`。\n- 发布后 `afterPublish` 刷新 announce，并通知 Fox / Dashboard，不只 Query。\n- 测试：只发售前则仅售前为「本版已替换」；产品/活动/售后不得出现相同发布标题或「刚更新」；无基线不伪造时间；第二 `userId` 未读不被发布者清掉。\n- 文档写清：合成 rel vs 本版是否替换该域；ACK ≠ 已读。\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n\n### Implementation tasks\n\n1. 发布回执 delta：本批绑定域 = 已替换，其余 = 本版未替换。\n2. `AnnounceModule` 四卡 + 顶部一次 `rel_N`；继承域不得显示成刚发布。\n3. 发布后刷新 announce，通知 Fox 与 Dashboard，不只 Query。\n4. 坐席 `userId` 隔离的 last_seen；Query 指名域横幅；狐狸点与故障红分色。\n5. 测试：只发售前仅售前「本版已替换」；无基线不伪造时间；第二 userId 未读不被发布者清掉。\n6. 文档：合成 rel vs 本版是否替换该域；ACK ≠ 已读。\n7. 办公机：owner 发售前；独立坐席会话看点亮；owner 开看板不得灭坐席点。\n\n"}]} -->
<!-- autoplan-baseline-edits:design {"sourceSha256":"e9df8c4349cf2e2e4e36b4f646ab9b995a121a554dd4234a1aef0267eb634093","replacements":[{"oldText":"### Chosen shape\n\n**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。\n\n1. 合成发布仍是唯一 `current_release_id`。发布回执加一行 delta：「本版替换了售前 75 条；活动 / 产品 / 售后本版未替换」。\n2. 系统同步话术 tab 四张卡。每张卡：频道名、该域当前条目数、**本版状态**（「本版已替换」或「本版未替换」）。全局 `rel_N` 只出现一次，在卡组上方，不当每张卡的版本号。无本地基线时写「尚无上次快照，不能声称域级发布时间」，不编造 last-touch。\n3. 「本版已替换」只来自本次发布绑定的域（`source_bindings` / 发布回执），不用 hydrate 哈希冒充发布时间。本地哈希只用于坐席未读：相对上次快照该域内容变了。\n4. 狐狸未读点与快捷键故障红点分区/分色。发布后必须把公告失效打到 Fox/Dashboard，不能只等下次查询。`last_seen` 按 `userId` 隔离；发布者打开看板不得清坐席未读。\n5. SOP 一期不占位。软件 tab 不动。\n\n### Phase 1 (no new HTTP)\n\n- 发布成功文案带 delta（本批 `sourceBindings` 的域 = 已替换）。\n- `AnnounceModule` 四卡 + 顶部一次合成 `rel_N`。继承域默认「本版未替换」。\n- 坐席未读：Query 一句指名域（「售前话术已更新」）；狐狸点非故障红。打开系统同步只清当前 `userId`。\n- 发布后 `afterPublish` 刷新 announce，并通知 Fox / Dashboard，不只 Query。\n- 测试：只发售前则仅售前为「本版已替换」；产品/活动/售后不得出现相同发布标题或「刚更新」；无基线不伪造时间；第二 `userId` 未读不被发布者清掉。\n- 文档写清：合成 rel vs 本版是否替换该域；ACK ≠ 已读。\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n\n### Implementation tasks\n\n1. 发布回执 delta：本批绑定域 = 已替换，其余 = 本版未替换。\n2. `AnnounceModule` 四卡 + 顶部一次 `rel_N`；继承域不得显示成刚发布。\n3. 发布后刷新 announce，通知 Fox 与 Dashboard，不只 Query。\n4. 坐席 `userId` 隔离的 last_seen；Query 指名域横幅；狐狸点与故障红分色。\n5. 测试：只发售前仅售前「本版已替换」；无基线不伪造时间；第二 userId 未读不被发布者清掉。\n6. 文档：合成 rel vs 本版是否替换该域；ACK ≠ 已读。\n7. 办公机：owner 发售前；独立坐席会话看点亮；owner 开看板不得灭坐席点。\n\n","newText":"### Chosen shape\n\n**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。\n\n1. 合成发布仍是唯一 `current_release_id`。发布回执两行：主句 `已发布 rel_N · 姓名`；下一行四库 delta「售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用」。\n2. 系统同步第一屏是四张卡（顺序：产品、活动、售前、售后）。卡上：库名 → 本版状态 → 当前条数。已更新库可显示**一次**发布标题，不写 `rel_N`。继承库文案「本版沿用」+「内容仍是当前可用」，`StatusBadge` 用现有 `neutral`，禁止 warn/danger。合成 `rel_N` 放四卡下方作检索租约脚注。≥1180 宽 2×2，近 980 一列。\n3. **卡状态** = 本版绑定域（发布回执或本机 `releaseId → domains[]`）。**点/横幅** = 该 `userId` 相对 last_seen 的域哈希差。无基线：不写时间、不点亮、第一次 hydrate 只建基线；卡仍能标本版更新了哪一库。两台对同一 `rel_N` 四卡必须一致，对不上则「无法标出本版更新了哪一库」。\n4. 内容更新是软信号：禁止走 `expired` / 抽空 Top 3。狐狸未读是品牌紫实心点（约 8px，`--fox` #8B5CF6），贴屏幕内侧上角，**禁止** `FoxHead.warning`。快捷键失败保持黄点。Query 横幅 `--muted` 墨色，不要 `is-invalid`；看见（停留 ≥1s）或关掉即清当前 userId。单击狐狸仍开查询，不弹工作台。仅「系统同步 → 话术版本更新」tab 可见时也可清。发布者 userId 不清坐席。\n5. SOP 一期不占位。软件 tab 不动。\n\n可见层级（一屏只保这三层）：\n\n    运营回执\n      已发布 rel_N · 姓名\n      售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用\n\n    系统同步 · 话术版本更新（≥1180 2×2；~980 一列）\n      [产品 沿用 N条] [活动 沿用 N条]\n      [售前 已更新 + 标题一次] [售后 沿用 N条]\n      脚注：检索租约 rel_N\n\n    坐席\n      狐狸内侧紫点 → 查询 muted 横幅（可关）→ Top 3 仍在\n\n### Phase 1 (no new HTTP)\n\n- 发布成功两行：短主句 + 四库 delta。加载沿用「加载中…」，list 失败整页「未接入当前发布」，0 条仍保留卡。\n- 四卡规格见 Chosen shape。卡可点则进话术库筛该域；做不到就死卡。\n- 坐席闭环走查询：横幅「售前话术已更新」（多域固定顺序 产品→活动→售前→售后）；停留 ≥1s 或关闭即已读。内容更新用独立 `content-updated`，不复用会清空结果的 invalidation。\n- 狐狸紫点 + 黄故障点可同时存在；贴边时未读点在屏幕内侧。`aria-label` 未读时加「有话术更新」。\n- 测试：只发售前仅售前「本版已更新」且继承库不得同标题/warn；无基线不点亮；通话中更新不清空 Top 3；第二 userId 未读不被发布者清掉。\n- 文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效。\n\n状态（用户看见的，不是后端）：\n\n    FEATURE     LOADING                    EMPTY            ERROR                         SUCCESS                       PARTIAL\n    发布回执    现有 disable，无假 delta     —                失败不说替换                   两行主句+delta                只把本批绑定域写成已更新\n    四卡        「加载中…」不闪空            0 条仍保留卡      整页「未接入当前发布」         四卡+脚注 rel_N               对不上：「无法标出本版更新了哪一库」\n    狐狸点      无会话不画                   无基线不点亮      黄点可与紫点同在                内侧 8px --fox                —\n    Query横幅   —                            无未读不画        真失效只留 is-invalid          muted 指名域，可关             多域固定顺序 产品→活动→售前→售后\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n\n### Implementation tasks\n\n1. 发布回执两行：主句 `已发布 rel_N · 姓名` + 四库 delta（已更新/沿用）。\n2. `AnnounceModule` 四卡：库名 → 已更新/沿用 → 条数；rel_N 作脚注；沿用 `StatusBadge` `neutral`。\n3. 发布后发 `content-updated` 到 Fox/Dashboard；禁止走 `expired` 抽空 Top 3。\n4. `userId` 隔离 last_seen；Query muted 横幅；狐狸 `--fox` 紫点与黄故障点分色；话术 tab 可见才清看板。\n5. 测试：只发售前仅售前「本版已更新」；无基线不点亮；Top 3 保留；第二 userId 未读不被发布者清掉。\n6. 文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效。\n7. 办公机：坐席机先有旧快照再收新发布；owner 开看板不得灭坐席点。\n\n"}]} -->
<!-- autoplan-baseline-edits:eng {"sourceSha256":"a637f089e736588e2911b006a994ab0dc966321f15ba3f68a8cba0738633ac3e","replacements":[{"oldText":"### Chosen shape\n\n**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。\n\n1. 合成发布仍是唯一 `current_release_id`。发布回执两行：主句 `已发布 rel_N · 姓名`；下一行四库 delta「售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用」。\n2. 系统同步第一屏是四张卡（顺序：产品、活动、售前、售后）。卡上：库名 → 本版状态 → 当前条数。已更新库可显示**一次**发布标题，不写 `rel_N`。继承库文案「本版沿用」+「内容仍是当前可用」，`StatusBadge` 用现有 `neutral`，禁止 warn/danger。合成 `rel_N` 放四卡下方作检索租约脚注。≥1180 宽 2×2，近 980 一列。\n3. **卡状态** = 本版绑定域（发布回执或本机 `releaseId → domains[]`）。**点/横幅** = 该 `userId` 相对 last_seen 的域哈希差。无基线：不写时间、不点亮、第一次 hydrate 只建基线；卡仍能标本版更新了哪一库。两台对同一 `rel_N` 四卡必须一致，对不上则「无法标出本版更新了哪一库」。\n4. 内容更新是软信号：禁止走 `expired` / 抽空 Top 3。狐狸未读是品牌紫实心点（约 8px，`--fox` #8B5CF6），贴屏幕内侧上角，**禁止** `FoxHead.warning`。快捷键失败保持黄点。Query 横幅 `--muted` 墨色，不要 `is-invalid`；看见（停留 ≥1s）或关掉即清当前 userId。单击狐狸仍开查询，不弹工作台。仅「系统同步 → 话术版本更新」tab 可见时也可清。发布者 userId 不清坐席。\n5. SOP 一期不占位。软件 tab 不动。\n\n可见层级（一屏只保这三层）：\n\n    运营回执\n      已发布 rel_N · 姓名\n      售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用\n\n    系统同步 · 话术版本更新（≥1180 2×2；~980 一列）\n      [产品 沿用 N条] [活动 沿用 N条]\n      [售前 已更新 + 标题一次] [售后 沿用 N条]\n      脚注：检索租约 rel_N\n\n    坐席\n      狐狸内侧紫点 → 查询 muted 横幅（可关）→ Top 3 仍在\n\n### Phase 1 (no new HTTP)\n\n- 发布成功两行：短主句 + 四库 delta。加载沿用「加载中…」，list 失败整页「未接入当前发布」，0 条仍保留卡。\n- 四卡规格见 Chosen shape。卡可点则进话术库筛该域；做不到就死卡。\n- 坐席闭环走查询：横幅「售前话术已更新」（多域固定顺序 产品→活动→售前→售后）；停留 ≥1s 或关闭即已读。内容更新用独立 `content-updated`，不复用会清空结果的 invalidation。\n- 狐狸紫点 + 黄故障点可同时存在；贴边时未读点在屏幕内侧。`aria-label` 未读时加「有话术更新」。\n- 测试：只发售前仅售前「本版已更新」且继承库不得同标题/warn；无基线不点亮；通话中更新不清空 Top 3；第二 userId 未读不被发布者清掉。\n- 文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效。\n\n状态（用户看见的，不是后端）：\n\n    FEATURE     LOADING                    EMPTY            ERROR                         SUCCESS                       PARTIAL\n    发布回执    现有 disable，无假 delta     —                失败不说替换                   两行主句+delta                只把本批绑定域写成已更新\n    四卡        「加载中…」不闪空            0 条仍保留卡      整页「未接入当前发布」         四卡+脚注 rel_N               对不上：「无法标出本版更新了哪一库」\n    狐狸点      无会话不画                   无基线不点亮      黄点可与紫点同在                内侧 8px --fox                —\n    Query横幅   —                            无未读不画        真失效只留 is-invalid          muted 指名域，可关             多域固定顺序 产品→活动→售前→售后\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n\n### Implementation tasks\n\n1. 发布回执两行：主句 `已发布 rel_N · 姓名` + 四库 delta（已更新/沿用）。\n2. `AnnounceModule` 四卡：库名 → 已更新/沿用 → 条数；rel_N 作脚注；沿用 `StatusBadge` `neutral`。\n3. 发布后发 `content-updated` 到 Fox/Dashboard；禁止走 `expired` 抽空 Top 3。\n4. `userId` 隔离 last_seen；Query muted 横幅；狐狸 `--fox` 紫点与黄故障点分色；话术 tab 可见才清看板。\n5. 测试：只发售前仅售前「本版已更新」；无基线不点亮；Top 3 保留；第二 userId 未读不被发布者清掉。\n6. 文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效。\n7. 办公机：坐席机先有旧快照再收新发布；owner 开看板不得灭坐席点。\n\n","newText":"### Chosen shape\n\n**用户拍板（2026-09-28）：诚实四库。** 保留产品 / 活动 / 售前 / 售后四张卡；禁止用合成 `rel_N` 冒充该域刚发布。对外用词锁死「本版已更新 / 本版沿用」，不再写「已替换 / 未替换」。\n\n1. 合成发布仍是唯一 `current_release_id`。发布回执两行：主句 `已发布 rel_N · 姓名`；下一行四库 delta「售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用」。`publishDraft` 把**同一句 delta**写入已有 `Announcement.summary`（现合同 `string | null`，今天桌面传 `null`）。`/v1/announce/current` 的 `announcement.summary` 是所有机器的卡状态源。不改 OpenAPI。\n2. 系统同步第一屏是四张卡（顺序：产品、活动、售前、售后）。卡上：库名 → 本版状态 → 当前条数。已更新库可显示**一次** `announcement.title`，不写 `rel_N`。继承库文案「本版沿用」+「内容仍是当前可用」，`StatusBadge` 用现有 `neutral`，禁止 warn/danger。合成 `rel_N` 放四卡下方作检索租约脚注。≥1180 宽 2×2；小于 1180（含 980–1179）一列。\n3. **卡状态**只解析 `announcement.summary` 那句固定顺序 delta。禁止用 hydrate 哈希、本机 `sourceBindings`、或「相对上一份快照的域差」填卡。解析失败或 summary 为空：四卡「无法标出本版更新了哪一库」，仍显示库名+条数+脚注 `rel_N`。**点/横幅** = 该 session `userId` 相对 last_seen 的**域内容哈希**（category + 排序后的 `scriptId+content_hash`，**不含** `releaseId`）。无基线：不写时间、不点亮；第一次**四域 snapshot 完整成功**后才建基线。\n4. 内容更新是软信号。运输层是现有已登录 Query 的 `sessionStatus`→`refreshAnnounce`（约 10s）以及发布者 `afterPublish` 的 refresh。不是跨机 push。`ProductAnnounce.refresh` 在 `releaseId` 变化时向 fox + query + dashboard 扇出独立 `content-updated`（`{releaseId, summary, domainHashes}`）。**禁止**走 `PRODUCT_ANNOUNCE_INVALIDATED`，**禁止** `refreshAnnounce` 在换 `rel_N` 时 `setResults([])`。`expired` / `source_gate` / `unavailable` 保持现有抽空语义。狐狸未读是品牌紫实心点（约 8px，`--fox` #8B5CF6），按 `data-dock-edge` 锚在**可见内侧**上角（右贴边→视觉左上），**禁止** `FoxHead.warning`。快捷键失败保持黄点 `top:10px; right:10px`。两点同在时间距 ≥10px。Query 横幅 `--muted`，不要 `is-invalid`；计入 hug 高度。已读：Query **窗可见**（非 FOX_IDLE、非 `document.hidden`）且横幅停留 ≥1s 或关掉，或「话术版本更新」tab 实际可见。发布者 userId 不清坐席。单击狐狸仍开查询。\n5. SOP 一期不占位。软件 tab 零 diff。卡可点：提升 `WordingLibraryModule` 的 domain 筛选，不要死卡。\n\n可见层级（一屏只保这三层）：\n\n    运营回执\n      已发布 rel_N · 姓名\n      售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用\n\n    系统同步 · 话术版本更新（≥1180 2×2；小于 1180 一列）\n      [产品 沿用 N条] [活动 沿用 N条]\n      [售前 已更新 + 标题一次] [售后 沿用 N条]\n      脚注：检索租约 rel_N\n\n    坐席\n      狐狸内侧紫点（≤10s poll）→ 查询 muted 横幅（可关）→ Top 3 仍在\n\n### Phase 1 (no new HTTP)\n\n- 发布成功两行：短主句 + 四库 delta。仅 `publishDraft` `ok: true` 后画 delta；失败不说替换，内存里的 `sourceBindings` 不得画成已更新。加载沿用「加载中…」。无 `current_release`：整页「未接入当前发布」。有 release 但 `list()` 失败：四卡仍在，条数降级「—」，不拆第一屏。0 条仍保留卡。\n- 四卡规格见 Chosen shape。条数和域哈希用**当次 snapshot 内存**，不信 `kept-larger` 磁盘 hydrate。数字用 refresh 后的域计数；list 失败省略括号里的条数。\n- 坐席闭环走查询：横幅「售前话术已更新」（多域固定顺序 产品→活动→售前→售后）；≥1s 计时绑定那次 `domainHashes`。下一次**新检索**走新 `rel_N` 租约。\n- last_seen 在 **main** origin-keyed userData（对齐 `product-session.${id}.enc`），键 `{userId, domain}`，文件 0o600。IPC **不得**带 userId，只用 `ProductSession.view().userId`；未登录 no-op。Fox 只读未读投影，不得 `PRODUCT_ANNOUNCE_REFRESH`，不得 mark-read。ACK / `client_sync_state` **禁止**写 last_seen。\n- 狐狸紫点 + 黄故障点可同时存在。`aria-label`：未读加「有话术更新」；双态时故障文案也要在。\n- 测试见任务 5。文档：合成 rel vs 本版是否更新该域；ACK ≠ 已读；软更新 ≠ 版本失效；summary delta 是卡状态源。\n\n状态（用户看见的，不是后端）：\n\n    FEATURE     LOADING                    EMPTY            ERROR                         SUCCESS                       PARTIAL\n    发布回执    现有 disable，无假 delta     —                失败不说替换                   两行主句+delta                —\n    四卡        「加载中…」不闪空            0 条仍保留卡      无 current：整页未接入；list 失败保留卡条数「—」  解析 summary 四卡+脚注     summary 不可解析：「无法标出本版更新了哪一库」\n    狐狸点      无会话不画                   无基线不点亮      黄点可与紫点同在                内侧 8px --fox                —\n    Query横幅   —                            无未读不画        真失效只留 is-invalid          muted 指名域，可关             多域固定顺序 产品→活动→售前→售后\n\n管道（一期桌面，不改合同）：\n\n    publishDraft ok\n      -> summary = 四库 delta 原句\n      -> afterPublish -> ProductAnnounce.refresh\n           |-- ACK（不写 last_seen）\n           |-- snapshot\n           +-- releaseId 变：content-updated -> fox + query + dashboard\n               Query：换租约，禁止 setResults([])\n               Fox：只读未读\n               Dashboard：四卡重解析 summary\n\n    已登录 Query 10s sessionStatus -> refreshAnnounce  （坐席运输层）\n    expired / source_gate / unavailable -> 现有 onInvalidated（可抽空）\n\n### Phase 2 (needs contracts:intake, product decision)\n\nOnly after Phase 1 在办公机跑过。\n\n- 发布响应或 announce 投影增加 `channels: [{id, last_release_id, last_release_seq, item_count, published_at, title}]`。服务端从 `import_batch_source_bindings` × `content_releases` 派生，不拆 `content_current`。\n- 独立 `last_seen`（或扩展 ACK 旁路）。合同继续写清 ACK ≠ 已读。\n- SOP 频道等 SOP 发布合同，不提前编造版本。\n\n### NOT in scope\n\n- 拆四个 `content_current` / 四次 snapshot / 部分快照\n- 软件自动更新、签名、`latest.yml`\n- 1.15.0 话术师自发布\n- Dashboard 整页重设计、改产品名\n- SOP 生产发布与过敏流程写路径\n- 多租户推送、邮件摘要\n- 手改 OpenAPI / 未授权 intake\n- Beamer 式强制弹窗、系统通知中心（一期）\n- 跨机 push / websocket；狐狸点依赖已有 ≤10s refresh\n\n### Implementation tasks\n\n1. `publishDraft` 在 ok 时把四库 delta 写入 `Announcement.summary`；回执两行；扩展 `isDashboardContentPublishResult`。\n2. `AnnounceModule` 解析 summary 画四卡；不可解析则「无法标出…」；条数来自内存 snapshot；点卡提升 wording domain。\n3. `ProductAnnounce.refresh` 换 `rel_N` 扇出 `content-updated`；Query 禁止因此 `setResults([])`；Fox/Dashboard 订阅；fox 不得 refresh announce。\n4. main last_seen（origin+session.userId）；Query 仅窗可见才记已读；话术 tab 可见才清看板；ACK 不写 last_seen。\n5. 测试：坐席机（非发布者）`rel_25` 只标售前已更新；无基线不点亮；通话中 refresh 新 rel Top 3 仍在；隐藏 Query 不清 last_seen；IPC 伪造 userId 无效；右贴边紫点在内侧；expired 仍抽空；软件 tab 零 diff。\n6. 文档：summary delta = 卡状态；ACK ≠ 已读；软更新 ≠ 版本失效；坐席点最多约 10s。\n7. 办公机：坐席机先有旧快照再收新发布；独立坐席会话看点亮（≤10s）；owner 开看板不得灭坐席点。\n\n"}]} -->

Methodology read: `/Users/hutou/.gstack/projects/hutou/autoplan-ceo-methodology-t2zc9V/methodology.md` ranges 1–600, 601–1200, 1201–1800, 1801–2400, 2401–2495 (EOF). Skip-listed sections honored.

### Phase 0
- Source: `docs/plans/2026-09-28-system-sync-channels.md`
- Restore: `/Users/hutou/.gstack/projects/hutou/main-autoplan-restore-20260928-113802.md`
- UI scope: yes (`dashboard` + `modal` ≥2)
- DX scope: no (`dxRequired: false`)
- Codex: `CODEX_MODE: ready`
- Mode override: SELECTIVE EXPANSION

### 0A Premise
Real pain: 运营按四个话术库发布，系统同步仍显示一个 `rel_N`；坐席狐狸头无未读。Do-nothing: 发布通了但坐席不知道，运营无法对账「售前刚换过、售后没动」。Plan solves this directly via channel projection, not a new publish trunk.

### 0B Existing code
`publish_content_release` domain replace; `DashboardWordingEntry.domain`; `ProductAnnounce` + ACK≠已读; `AnnounceModule` tabs; Query announce banner; fox 警示点. Rebuild of four currents would fight OpenAPI four-domain gate.

### 0C Dream state
```
  CURRENT                    THIS PLAN                     12-MONTH
  一个 rel + 一张卡     →    合成 rel + 五频道看板     →    服务端 channel events
  无坐席未读            →    狐狸点 + last_seen         →    跨设备已读
  SOP DEMO 未接入       →    SOP 卡诚实未接入           →    SOP 合同后再接
```

### 0E Mode
SELECTIVE EXPANSION (autoplan override). Added capability, ~5 files, not greenfield. File estimate: AnnounceModule, fox renderer, last_seen helper, tests, docs.

### 0G Cherry-picks (auto-decided)
| # | Proposal | Effort | Decision | Principle |
|---|----------|--------|----------|-----------|
| 1 | 诚实四库（本版已替换/未替换） | M | ACCEPTED | 用户 2026-09-28 拍板 |
| 2 | 狐狸未读点 + Query 一句 | M | ACCEPTED | P1 |
| 3 | 本地 last_seen，ACK 不兼已读 | S | ACCEPTED | P5 合同已写明 |
| 4 | 打开看板「全部已读」 | S | ACCEPTED | P2 blast |
| 5 | 卡上展示该域条数与最近 rel 标题 | S | ACCEPTED | P1 |
| 6 | 服务端 channel events / intake | L | DEFERRED | P3 一期无新 HTTP |
| 7 | SOP 生产发布 | XL | DEFERRED | 无合同 |
| 8 | 四套独立 current_release | XL | SKIPPED | P4 与 snapshot 禁部分快照冲突 |
| 9 | Beamer 强制弹窗 / 邮件 | M | SKIPPED | 接待中打断 |
| 10 | 软件自动更新 | L | SKIPPED | 已禁 latest.yml |

<!-- autoplan-accepted:ceo -->
- 合成发布仍是唯一 `current_release_id`；检索/hydrate 不拆四租约。
- 用户拍板诚实四库：四张卡只写「本版已替换 / 本版未替换」；全局 rel 只出现一次。禁止用 rel_N 当域版本，禁止无基线时伪造域级发布时间。
- SOP 一期不占位。发布回执必须带 delta。
- 未读按 userId 隔离；发布者打开看板不得清坐席。狐狸点与故障红分色。发布后必须通知 Fox/Dashboard，不只等下次查询。
- ACK 不得当已读。一期无新 OpenAPI。二期 channels[] 在出现「继承域被当成新发布」或「换机未读不一致」时再 intake。
- 软件 tab 不动。办公机验证用独立坐席会话。
<!-- /autoplan-accepted:ceo -->

<!-- autoplan-accepted:design -->
- 四卡第一屏：库名 → 本版已更新/沿用 → 条数；rel_N 作脚注。沿用 `StatusBadge` `neutral`，不用 warn。已更新卡可显示一次发布标题，不写 rel_N。
- 卡=本版绑定域（回执或本机 releaseId→domains[]）；点/横幅=userId 哈希差。无基线不点亮、不写时间；对不上则「无法标出本版更新了哪一库」。
- 软更新：独立 `content-updated`，不清空检索 / Top 3。紫点 `--fox` 非 `FoxHead.warning`。横幅 `--muted` 非 is-invalid。已读：查询横幅看见（≥1s）或关掉，或话术 tab 可见。发布者 userId 不清坐席。
- 发布回执两行。多域横幅顺序 产品→活动→售前→售后。贴边内侧点。aria 未读加「有话术更新」。卡可点则筛该域，否则死卡。
- 测试：只发售前仅售前「本版已更新」且继承库不得同标题/warn；无基线不点亮；通话中更新不清空 Top 3；第二 userId 未读不被发布者清掉。文档：软更新 ≠ 版本失效。
<!-- /autoplan-accepted:design -->

<!-- AUTONOMOUS DECISION LOG -->
## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|-----------|-----------|----------|----------|
| 1 | CEO | SELECTIVE EXPANSION | Mechanical | autoplan override | 能力增量约 5 文件 | SCOPE EXPANSION / HOLD |
| 2 | CEO | 合成 rel + 频道卡，不拆 current | Mechanical | P4 DRY / OpenAPI | snapshot 禁部分快照 | 四套 KB |
| 3 | CEO | 一期本地 last_seen | Taste | P5 | 合同 ACK≠已读；跨设备二期 | 立刻 intake |
| 4 | CEO | 狐狸点非弹窗 | Mechanical | P1+坐席接待 | Canny widget 非 Beamer modal | 强制弹窗 |
| 5 | CEO | SOP 卡未接入 | Mechanical | 无 SOP 发布合同 | 禁止 DEMO 冒充版本 | 假 SOP 版本 |
| 6 | CEO | 服务端 channel events 延期 | Taste | P3 | 一期桌面可对账 | Phase1 intake |
| 7 | CEO | 五卡+本地哈希是否开工 | User Challenge | both voices | 继承域会显示成刚发布；一期无域级 last-touch 字段 | 用户原方向 |

CEO DUAL VOICES — CONSENSUS TABLE:
  Dimension                            Claude  Codex  Consensus
  1. Premises valid?                   mixed   mixed  域替换/禁部分快照/ACK≠已读成立；五卡 last-touch 是假设
  2. Right problem to solve?           yes*    yes*   新鲜度对；产品化成五条平行频道不对
  3. Scope calibration correct?        no      no     一期桌面投影兑现不了承诺字段
  4. Alternatives sufficiently explored? no    no     发布回执 delta / 事件时间线未比
  5. Competitive/market risks covered? med     med    内部工具；错抄 changelog widget
  6. 6-month trajectory sound?         no      no     空 SOP 卡 + 假 rel + 本地伪事件
CONFIRMED = completed native + Codex.

User Challenge resolved 2026-09-28: 用户选「诚实四库」——四卡保留，禁止假 last-touch；SOP 不占位；发布回执 delta；狐狸点与故障红分色；未读按 userId 隔离。

Phase 2.5 skipped — no developer-facing scope detected (`dxRequired: false`, matchCount 1).

### Phase 2 Design
Methodology read: `/Users/hutou/.gstack/projects/hutou/autoplan-design-methodology-BwXZp6/methodology.md` ranges 1–600, 601–1200, 1201–1800, 1801–1890 (EOF). Skip-listed sections honored. Classifier: OPERATE（工作台）+ overlay（狐狸/查询）。DESIGN.md exists; calibrate to `--fox` `#8B5CF6`, `--ink`/`--muted`, `--dash-radius: 8px`, `StatusBadge`（含 `neutral`）, 风险必须有文字, 单击狐狸开查询。

Step 0 initial rating: 4/10. CEO-era copy put `rel_N` first, wrote engineer prose as UI, treated content update as invalidation, and left loading/error/dock/a11y unspecified. A 10 is: first screen four library names, inherited libraries look available, agents keep Top 3, unread is a purple cue with words.

DESIGN.md: 白主紫锚; 狐狸 88px overlay; Dashboard 1180×760 / min 980×680; 贴边露 32px; shortcut-fail 黄点 + `FoxHead.warning`. Reuse `dash-card`, `StatusBadge`, existing announce banner slot. No new visual language.

Mockups: DESIGN_READY at `/Users/hutou/.claude/skills/gstack/design/dist/design`. Autoplan skipped the comparison-board wait so Eng can still run; Approved Mockups = 0. Text hierarchy and state table are the visual spec.

#### Dual voices
Native INPUT: design `0141a1f828037224eede436d0cc2a4aadc49038c79c258fe346754c1a4a64a48` (subagent `01a0e63c-58a3-7400-97a9-22884a942d02`). 16 findings F1–F16; F5/F6/F7/F8 critical.
Outside Claude Code: unavailable (`Selected model is at capacity`). `[subagent-only]`. Consensus cells N/A, never CONFIRMED.

DESIGN OUTSIDE VOICES — LITMUS SCORECARD:
═══════════════════════════════════════════════════════════════
  Check                                    Native  Codex  Consensus
  ─────────────────────────────────────── ─────── ─────── ─────────
  1. Brand unmistakable in first screen?   YES     N/A    N/A
  2. One strong visual anchor?             YES     N/A    N/A
  3. Scannable by headlines only?          YES*    N/A    N/A
  4. Each section has one job?             YES     N/A    N/A
  5. Cards actually necessary?             YES     N/A    N/A
  6. Motion improves hierarchy?            YES     N/A    N/A
  7. Premium without decorative shadows?   YES     N/A    N/A
  ─────────────────────────────────────── ─────── ─────── ─────────
  Hard rejections triggered:               none after F1–F13 auto-fix
═══════════════════════════════════════════════════════════════
YES* after moving `rel_N` under the cards. Cards are the per-library status, not a SaaS mosaic. No pulsing unread dot.

Native criticals auto-fixed into Implementation (P5+P1): F1 rel footnote; F2 沿用+neutral; F3 title once on updated card; F4 loading/error/0-count; F5 no-baseline no light; F6 bind-domain vs hash; F7 soft `content-updated`; F8 query-path read; F9 fox still opens Query; F10 purple inner-edge vs yellow warning; F11 muted banner order; F12 two-line receipt; F13 2×2 / dead card; F14 wording tab only; F15 card vs unread split; F16 aria text.

#### Pass 1 Information Architecture  4/10 → 9/10
Examined: first read of 系统同步, publish receipt, fox, Query banner. Gap was `rel_N` as title (F1) and 「未替换」as fault (F2). Fix applied: library name → 已更新/沿用 → count; rel as footnote. ASCII hierarchy in Chosen shape. Remaining 1: no generated mockup.

#### Pass 2 Interaction State Coverage  3/10 → 9/10
Examined: WordingTab 「加载中…」/「未接入当前发布」, 0-count libraries, list failure, no-baseline, dual fox dots. State table now in Phase 1. Remaining 1: refresh-in-flight keeps old cards (specified as 不闪空; no skeleton art).

#### Pass 3 User Journey  4/10 → 9/10
    STEP | USER DOES              | USER FEELS           | PLAN SPECIFIES?
    1    | 运营点发布              | 怕冲掉其他库         | 两行回执：rel + 四库 delta
    2    | 打开系统同步            | 要对账               | 四卡已更新/沿用，rel 脚注
    3    | 坐席接待中收到新发布    | 不能丢当前话术       | 紫点 + Top 3 保留
    4    | 单击狐狸                | 要继续接待           | 仍开查询，不弹工作台
    5    | 看见或关掉横幅          | 知道哪库变了         | 当前 userId 已读，点灭
    6    | 无基线新装              | 不应被四点全亮吓到   | 卡能标更新库，狐狸不亮
5-sec: 库名+已更新/沿用. 5-min: 坐席横幅可关并继续复制. 5-year: 仍是合成 rel，不把 ACK 当已读.

#### Pass 4 AI Slop  6/10 → 9/10
Mode OPERATE. Hard rejection 7 (card mosaic) does not fire: four cards ARE the channel-status interaction, existing `dash-card` + 8px radius, no icon-in-circle grid, no purple gradient, no pulse. Copy is utility (已更新/沿用/条数), not mood. Remaining 1: mockup pixels not inspected.

#### Pass 5 Design System  5/10 → 9/10
Tokens: `--fox` unread fill; `--muted` banner ink; `--ink` body; `StatusBadge` `neutral` for 沿用; shortcut-fail stays warning yellow + `FoxHead.warning`. Unread never sets `warning={true}`. 风险/未读有文字（卡上文案 + aria「有话术更新」）. No new component library.

#### Pass 6 Responsive & Accessibility  4/10 → 9/10
≥1180 2×2; ~980 one column. Fox 64px already meets 44px; 8px dot is indicator only, keyboard stays on the fox button. Dock: unread on screen-inner corner so 32px peek does not clip it. `prefers-reduced-motion`: static dot. Contrast: `--fox` on glass / `--muted` on query glass; no color-only status.

#### Pass 7 Unresolved  0 resolved-as-deferred, 0 open
No remaining AskUserQuestion. Taste logged: inner-edge purple vs Query badge — inner-edge (existing fox is the launcher). Mockups deferred (board wait would stop Eng).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — AnnounceModule — Four library cards with 已更新/沿用 and rel footnote
  - Surfaced by: Pass 1 — F1 F2 F3 F13
  - Files: `apps/desktop/src/renderer/features/dashboard/AnnounceModule.tsx`
  - Verify: 只发售前仅售前「本版已更新」；沿用 `neutral`；rel 在脚注
- [ ] **T2 (P1, human: ~2h / CC: ~25min)** — QueryApp — Soft content-updated banner without clearing Top 3
  - Surfaced by: Pass 2/3 — F7 F8 F11
  - Files: `apps/desktop/src/renderer/QueryApp.tsx`, `apps/desktop/src/main/product-announce.ts`
  - Verify: 通话中更新 Top 3 仍在；横幅非 `is-invalid`；停留 ≥1s 或关闭即已读
- [ ] **T3 (P1, human: ~1h / CC: ~15min)** — FoxApp — Purple unread dot distinct from warning yellow
  - Surfaced by: Pass 5/6 — F10 F16
  - Files: `apps/desktop/src/renderer/FoxApp.tsx`
  - Verify: 禁止 `FoxHead.warning`；贴边内侧；aria 含「有话术更新」
- [ ] **T4 (P1, human: ~1h / CC: ~15min)** — last_seen — userId-isolated last_seen; no light without baseline
  - Surfaced by: Pass 2/3 — F5 F6 F14 F15
  - Files: `apps/desktop/src/main`
  - Verify: 无基线不点亮；发布者 userId 不清坐席；仅话术 tab 可见才清看板

JSONL: `/Users/hutou/.gstack/projects/hutou/tasks-design-review-20260928-123124.jsonl` (copy of weiweity slug file).

TODOS.md: none proposed. All F1–F16 landed in Phase 1 tasks.

  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | DESIGN.md present; UI scope yes; OPERATE    |
  | Step 0               | 4/10; gaps: rel-first, 未替换, invalidation |
  | Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 3/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 4/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 6/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 5/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 4/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 0 open, mockups deferred                    |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (8 items, unchanged)                |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 0 generated, 0 approved                     |
  | Decisions made       | 16 native findings auto-applied             |
  | Decisions deferred   | mockups (board wait)                        |
  | Overall design score | 4/10 → 9/10                                 |
  +====================================================================+

### Phase 3 Eng
Methodology read: `/Users/hutou/.gstack/projects/hutou/autoplan-eng-methodology-bjWYTp/methodology.md` ranges 1–600, 601–1200, 1201–1800, 1801–2169 (EOF). Skip-listed sections honored.
Native INPUT: eng `1cba4c949fdba0207299782d030072d7628829c7cd037c478f8942057a89c722` (subagent `01a0e655-f3ac-70b2-a780-c8d3223c656a`). 14 findings F1–F14.
Outside Claude Code: completed (host=codex, provider=claude-code). P0/P1 agree with native F1–F4/F9.

ENG DUAL VOICES — CONSENSUS TABLE:
  Dimension                           Native  Claude Code  Consensus
  1. Architecture sound?               no      no          卡状态无跨机源；狐狸点无独立 push，应诚实用已有 refresh
  2. Test coverage sufficient?         no      no          缺坐席机四卡、隐藏 Query、refresh 不清 Top 3
  3. Performance risks addressed?      yes     yes         域哈希可在 main 按 category 计；不加第四个 /current 定时器
  4. Security threats covered?         no      mixed       last_seen userId 必须来自 session；ACK 不得当已读
  5. Error paths handled?              mixed   mixed       发布失败/list 失败/summary 不可解析需锁
  6. Deployment risk manageable?       yes     yes         一期仍桌面投影；办公机 ≤10s poll
CONFIRMED = native + outside agree on the three holes. Not a User Challenge: 诚实四库保留，卡状态改走已有 `Announcement.summary`，不砍四卡、不 intake。

Scope Challenge: never reduce. Files >8 (ContentModule, dashboard-content, AnnounceModule, WordingLibraryModule, QueryApp, FoxApp, product-announce+ipc, last_seen store, docs, tests). Original arrangement kept. Sub-problems map to existing: domain replace, dashboardWording.list domain, ProductAnnounce.refresh, StatusBadge.neutral, 10s sessionStatus poll, announcement.summary already on /current.

Prior learning applied: refreshAnnounce-vs-hydrate-persist (10/10, 2026-09-20) — refresh 只换租约；hydrate 写盘仍在 persist。软更新不得误当成 STALE 清会话。

#### Section 1 Architecture
    owner publishDraft
      POST /v1/content/import + /publish
      summary = "售前已更新（75 条）· 活动沿用 · 产品沿用 · 售后沿用"
      afterPublish -> ProductAnnounce.refresh
    ProductAnnounce (main)
      GET /v1/announce/current (+ ACK, never last_seen)
      snapshot pages
      if releaseId changed: emit content-updated {releaseId, summary, domainHashes}
        -> fox (read unread only)
        -> query (banner, keep Top 3)
        -> dashboard (reparse cards)
      expired/source_gate/unavailable: existing drop()/onInvalidated
    last_seen.json (userData, origin hash, 0o600)
      key: session.view().userId + domain
      writers: Query (visible banner) / Dashboard (wording tab)
      Fox: GET unread projection only

Coupling: new channel beside overlay-events, not PRODUCT_ANNOUNCE_INVALIDATED. Query 10s poll is the agent transport.

#### Section 2 Code Quality
DRY: one `parseLibraryDelta(summary)` used by receipt, cards, tests. Do not copy bindings from ContentModule into AnnounceModule.
Naming: `content-updated` not `invalidated`. last_seen not ack.
Complexity: do not give Fox announce.refresh (F11). Lift wording domain rather than dead cards (F13).
`isDashboardContentPublishResult` exactKeys must include summary/delta or IPC drops the receipt (F3 native tests).

#### Section 3 Test Review
    CODE PATHS                                              USER FLOWS
    [GAP] publish ok writes Announcement.summary            [GAP] 坐席机 rel_25 只标售前已更新
    [GAP] parse summary -> four card states                 [GAP] summary 空：无法标出… 仍有库名
    [GAP] Query refresh new rel keeps results  QueryApp:774 [GAP] 通话中 Top 3 仍在 + muted 横幅
    [★★ TESTED] onInvalidated expired clears                [GAP] content-updated 不得进该 listener
    [GAP] hidden Query 10s poll does not mark-read          [GAP] FOX_IDLE 紫点亮、1s 不计
    [GAP] last_seen IPC ignores renderer userId             [GAP] 发布者开看板，坐席点仍在
    [GAP] fox unread uses data-dock-edge inner corner       [★★ TESTED] dock-edge left/right exists
    [GAP] ACK success does not write last_seen              [GAP] 第一次查询灭点 = 回归失败
    [★★ TESTED] software tab UNSIGNED / no latest.yml       [GAP] 快照：软件 tab 无四卡
    [GAP] kept-larger disk not used for card counts         [GAP] 0 条卡仍在

    COVERAGE: existing tests do not cover the new UX. Add main unit + Query component.
    LLM/eval: none.

Test plan: `/Users/hutou/.gstack/projects/hutou/hutou-main-eng-review-test-plan-20260928.md`

#### Section 4 Performance
No extra /current timer. Domain hashes computed in main from snapshot items. 412–5000 scripts: sort+hash once per refresh. Banner hug is one layout report. No N+1 HTTP.

#### Failure modes
| Path | Failure | Handling | User sees | Test |
|---|---|---|---|---|
| 坐席无 summary | 四卡假已更新 | 无法标出… | 库名+条数+脚注 | 坐席机 rel_25 |
| refresh 换 rel | Top 3 被清 | 禁止 setResults([]) | 旧结果+横幅 | Query 组件 |
| 隐藏 Query 1s | 点永不亮 | 仅窗可见记已读 | 闲置紫点 | 假时钟 |
| renderer 传 userId | 清坐席 | handler 用 session | 坐席点仍在 | IPC 单测 |
| 右贴边 | 紫点被裁 | data-dock-edge 内侧 | 可见点 | Fox 组件 |
| ACK 当已读 | 一搜即灭 | ACK 不写 last_seen | 点仍在直到横幅 | 单测 |
Silent+untested would be hidden Query mark-read and refresh-clear: both now required tests. Critical gaps after amend: 0.

Parallelization: Sequential implementation, no parallelization opportunity (shared product-announce + QueryApp).

## Implementation Tasks
Synthesized from this review's findings.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — publish summary delta — Write four-library delta into Announcement.summary on ok publish
  - Surfaced by: Architecture F1 / outside P0
  - Files: `apps/desktop/src/renderer/features/dashboard/ContentModule.tsx`, `apps/desktop/src/main/dashboard-content.ts`
  - Verify: /current.announcement.summary equals receipt delta
- [ ] **T2 (P1, human: ~2h / CC: ~25min)** — AnnounceModule parse summary — Four cards from summary; unparseable fallback
  - Surfaced by: Architecture F1 F12 F13
  - Files: `apps/desktop/src/renderer/features/dashboard/AnnounceModule.tsx`, `WordingLibraryModule.tsx`
  - Verify: 坐席机 rel_25 仅售前已更新
- [ ] **T3 (P1, human: ~3h / CC: ~30min)** — content-updated fan-out — Refresh must not clear Top 3; fox read-only unread
  - Surfaced by: Architecture F2 F11 / QueryApp.tsx:774
  - Files: `apps/desktop/src/main/product-announce.ts`, `QueryApp.tsx`, `FoxApp.tsx`
  - Verify: new releaseId keeps results; expired still clears
- [ ] **T4 (P1, human: ~2h / CC: ~20min)** — main last_seen — session.userId only; visible Query/tab; ACK ignored
  - Surfaced by: Architecture F3 F4 F9 F10
  - Files: `apps/desktop/src/main` last_seen store + IPC
  - Verify: hidden Query does not mark-read; spoofed userId ignored
- [ ] **T5 (P1, human: ~1h / CC: ~15min)** — fox inner-edge unread — data-dock-edge; hug banner
  - Surfaced by: Edge F5 F6 F16 design
  - Files: `FoxApp.tsx`, `app.css`, Query layout
  - Verify: right dock inner corner; input visible with banner

JSONL: `/Users/hutou/.gstack/projects/hutou/tasks-eng-review-20260928-130000.jsonl`

TODOS.md: none. Phase 2 channels[] stays deferred in this plan.

  +====================================================================+
  |         ENG PLAN REVIEW — COMPLETION SUMMARY                       |
  +====================================================================+
  | Step 0 Scope Challenge | accepted as-is (never reduce); 10+ files  |
  | Architecture Review    | 4 issues, auto-fixed into Phase 1 pipes   |
  | Code Quality Review    | 3 issues (parse helper, exactKeys, no fox refresh) |
  | Test Review            | diagram produced, 11 gaps -> required tests |
  | Performance Review     | 0 issues                                  |
  | NOT in scope           | written (+ no websocket)                  |
  | What already exists    | written                                   |
  | TODOS.md updates       | 0                                         |
  | Failure modes          | 0 critical gaps after amend               |
  | Unresolved decisions   | 0                                         |
  | Outside voice          | claude-code completed                     |
  | Parallelization        | sequential                                |
  | Lake Score             | 10/10                                     |
  +====================================================================+

<!-- autoplan-accepted:eng -->
- 卡状态唯一源：发布 ok 时写入的 `Announcement.summary` 四库 delta 原句；所有机器从 `/v1/announce/current` 读。禁止用 hydrate 哈希或本机 sourceBindings 填卡。summary 空或不可解析：四卡「无法标出本版更新了哪一库」。
- 未读运输层：已登录 Query 现有 ≤10s `refreshAnnounce` + 发布者 afterPublish refresh。`content-updated` 由 main 扇出到 fox/query/dashboard。禁止 `PRODUCT_ANNOUNCE_INVALIDATED`。Query 换 `rel_N` 禁止 `setResults([])`。expired/source_gate 保持抽空。
- last_seen 在 main origin-keyed userData，键 session.view().userId；IPC 不得带 userId；Fox 只读；ACK 不写 last_seen。已读仅 Query 窗可见或话术 tab 可见。域哈希不含 releaseId。
- 对外用词：本版已更新 / 本版沿用。卡可点提升 wording domain。紫点随 data-dock-edge 贴可见内侧。软件 tab 零 diff。
- 测试：坐席机 rel_25 只标售前已更新；隐藏 Query 不清点；通话中 Top 3 保留；伪造 userId 无效；右贴边内侧点；ACK 不灭点；expired 仍抽空。
<!-- /autoplan-accepted:eng -->
