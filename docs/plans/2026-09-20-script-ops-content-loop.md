# 话术运营内容闭环（开工切片）

> **状态：** 拍板仍锁。A/B 工作台五项 + fail-closed + Owner dual-review 已合入 `main` `3b88992`（PR #3 / #4）。C（管理员导入 FAQ 再查询）清单在 [tutorial-menokin-content-publish.md](../tutorial-menokin-content-publish.md)，人勾仍是未观察。D/E/F（不准落库、SOP 写库、软件目录）仍要 `contracts:intake`。  
> **实现：** 不要在本计划文件上改代码。  
> **不包含：** 合 `embeddings-delivery`、改 leftover `/v1/search`、ES / pgvector、过敏 SOP 双人审、自动改写已发布 Answer。演示徽标已从工作台拿掉。

2026-09-20 产品拍板：全部采用推荐项 `1A 2C 3A 4A 5C 6A 7A 8A 9C 10A 11B 12A`。

## 拍板（锁定）

| # | 题 | 锁 |
| --- | --- | --- |
| 1 | 草稿能否被浮窗搜到 | **A** 只有已发布 |
| 2 | 售后/过敏发布审批 | **C** 产品/活动：话术师可发；售后及过敏/赔付：管理员发 |
| 3 | 草稿导出 | **A** 只能导出已发布 |
| 4 | 话术不准阈值 | **A** 每次点击先落库；待办用 24h≥3 或 7d≥10。第一期可只展示次数、不自动开单 |
| 5 | SOP 双人审 | **C** 试点管理员单人可发；过敏步骤必须有停手文案 |
| 6 | 版本 | **A** 发布即留版本，可回滚；坐席只看到当前发布 |
| 7 | 不准去重 | **A** 同一查询会话 + 同一条稿只记一次 |
| 8 | 待办关闭 | **A** 新发布后人手关单；系统只提示「已有新发布」 |
| 9 | SOP 与话术审批 | **C** 发布动作可共用，规则按 #2 / #5 分开 |
| 10 | 话术库是否可编辑 | **A** 只读浏览；编辑只在「内容管理」 |
| 11 | 日历过期 | **B** 不做 90 天日历过期；`stale` = 有效窗口已过仍被召回 |
| 12 | 导出格式 | **A** 只要 CSV |

## 角色（映射现有，不新发明一套 RBAC）

| 产品口头 | 现有角色 | 可做 |
| --- | --- | --- |
| 坐席 | `agent` | 浮窗检索已发布、复制、「话术不准」；只读 SOP 窗 |
| 话术师 | `coach` | 「内容与发布」起草；产品/活动域可发布；不可发售后/过敏赔付；不可改 SOP 发布（可起草） |
| 管理员 | `owner` | 发布售后/过敏赔付；发布 SOP；导出已发布 CSV；关待办 |

查询芯片仍然不画 RBAC。工作台按会话角色收编辑/发布按钮。

## 现有可复用（不要再发明平行面）

- 导入审核发布：`POST /v1/content/import`、`/publish`、`/rollback`；公告 + 仓外 hydrate。
- 坐席检索：每次查询 `refreshAnnounce` → BM25 + 可选 MiniMax → **当前发布 hydrate** Top 3。有 hydrate 时 leftover `/v1/search` 关死。
- 待办合同：`GET /v1/metrics/iteration-tasks`、`POST .../start`、`POST .../close`。合成 Dashboard 任务要换成真信号，不新开 `/tickets`。
- 话术不准：查询卡本地按钮，尚不落库。

**新合同（必须 `contracts:intake`，未批准不得写 HTTP）：**

- `POST /v1/inaccuracy-reports`（会话+script 去重）
- SOP 的持久化读写/发布（现有 SOP 窗只读合成树）
- 若 Dashboard 浏览不能继续只读 hydrate、必须服务端分页，再 intake 已发布列表；**禁止** `GET /v1/scripts/query` 替换坐席检索。

## 非目标

- 不把上传/编辑塞进「话术库」。
- 不对草稿开放浮窗检索。
- 不自动改写、不自动覆盖已发布、不自动关待办。
- 不把「话术不准」做成独立产品。
- 不合 `feat/p7-embeddings-delivery`；不上 ElasticSearch / pgvector。
- 顶栏「演示数据」已拿掉（PR #3）。一期发布实现仍是 owner-only（coach 403），比拍板 #2 的「产品/活动话术师可发」更窄。
- 不改备案隧道。

## 切片（按此顺序，一刀一分支）

### A. 话术库浏览（无新合同）

**用户看见：** 「话术库」仍只读当前发布。可搜标题/场景/正文、按四域筛选、分页、导出**当前筛选结果**的已发布 CSV。详情卡标签继续跟 `ownerRole`（当前发布）。

**刻意不做：** 编辑入口、草稿、Publish、浮窗改检索。

**验收：** 现有 `rel_*` hydrate 上，域切换 + 搜索把列表收窄；导出 CSV 只有已发布行；「内容与发布」仍是现在的治理页。

### B. 内容与发布接真链

**用户看见：** 话术师在「内容与发布」起草/导入并保存；产品/活动可发布；售后及过敏/赔付只有管理员能发。发布后产生新版本 + 公告，坐席目录与话术库读同一当前发布。

**刻意不做：** 浮窗换 API、不准落库、SOP 编辑器。

**依赖：** 复用 import/publish/rollback。Dashboard 写操作走独立受信 adapter，**不**把 publish 塞进 `dashboard.cjs` 只读 preload。

**验收：** 发布产品域稿后，话术库与下一次查询都出现新稿；售后稿用话术师会话发布被拒。

### C. 坐席仍走 hydrate（不是新 query API）

**用户看见：** 与 B 同一发布结果。查询 Top 3 来自新公告允许的 hydrate，不是合成 fixture。

**刻意不做：** 改 BM25/MiniMax、打开 leftover `/v1/search`。

**验收：** 设了桌面 API origin 时问句不打 leftover search；`refreshAnnounce` 仍每次查询。

### D. 「话术不准」落库

**用户看见：** 点「话术不准」后服务端有记录；同一查询会话对同一 `script_id` 再点不新增。工作台待办页能看到按稿聚合的次数。

**刻意不做：** 自动开 `iteration_task`（次数先给人看）。

**依赖：** `contracts:intake` 新面。

**验收：** 两次同会话同稿 → 一条报告；不同会话 → 两条；Dashboard 显示次数。

### E. 待办接真信号

**用户看见：** 「话术优化待办」不再是刷新即丢的合成五条。来源：不准聚合（24h≥3 或 7d≥10 才**开单**）、无命中缺口、跳过 Top1 的排序问题、有效窗口已过仍召回。人改稿并发布后，系统提示可关单，人手关。

**刻意不做：** 日历 90 天过期、`low_usage` 定时任务、自动改写、自动关单。`mixed` 先留着。

**依赖：** 复用已有 iteration-tasks 合同；不准开单用 D 的聚合。

### F. SOP 库（后做）

**用户看见：** 话术运营增加 SOP 板块。管理员单人可发；坐席 SOP 窗只读已发布树。过敏步骤无停手文案不能发。

**刻意不做：** 双人审、和话术同一张表、坐席可编辑。

**依赖：** `contracts:intake`。

## 并行轨（已切工作树）

互不改同一批文件。各自从 `origin/main` 出分支。不要在 `wt-dashboard-live` 上改。

| 轨 | 分支 / 工作树 | 做 | 不做 |
| --- | --- | --- | --- |
| A | `feat/wording-library-browse` · `wt-wording-browse` | 话术库分页 + 已发布 CSV 导出（搜索/四域已有） | 编辑、Publish、新 IPC |
| B | `feat/content-publish-live` · `wt-content-publish` | Dashboard「内容与发布」接现有 import/publish；角色闸门 | 不准、SOP、改 Query 检索 |
| D | `feat/inaccuracy-intake` · `wt-inaccuracy` | 会话+稿去重纯函数、合同草稿、待办次数投影形状 | **禁止** 未 intake 写 HTTP handler |
| C | （无独立分支） | B 合入后验收：查询仍 hydrate | 新 query API |
| E | 等 D 合同 | 待办真信号 + 人手关单 | 自动关单、90 天日历 |
| F | 后做 | SOP 库 | 双人审 |

## 第一刀建议

三轨已开工。合入顺序建议 A → B → D（intake 过了再 D 的 HTTP）。F 最后。
