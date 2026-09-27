# 办公机一人发布（飞书文档审核）

> 状态：plan-eng-review 已锁 · plan-devex-review 已锁 · 2026-09-24  
> 基线：main `e54ecfb` / 0.3.19 · 正式库当前 rel_23  
> 完成定义：办公机装上含这些改动的 Windows 桌面包（unsigned 可），选表到屏幕出现版本号和谁发的，秒表 < 2 分钟

## 问题

坐席查话术已通（登录 → announce → hydrate → 出卡，rel_23）。  
办公机一个人点发布会停住。真生产路径不是 43112 合成三连。

生产 IPC `dashboard-content-ipc.ts:76-83` 把 `parkedReview` 接到 `completeSignedInReview`：用当前飞书 owner 会话打 decision / quality / resume。Owner 没有三条能力 → 失败 → `CONTENT_PUBLISH_COPY.awaitingReview`（「导入已进入双人复核。当前会话无法单独完成话术师、管理员和质检。」）。

工作台还有本地假审核：`ContentModule.tsx` 三步「导入草稿 · 审核 · 发布」，`ownerNeedsReview` 在本地 `reviewed` 之前禁用发布键。

业务要的流程：

```
飞书文档审表（组织） → 导出 Excel → 有权限的人导入 → 同一人发布 → 坐席 announce 更新
```

## 锁定决定

| ID | 决定 |
|---|---|
| 4A | 导入校验通过后直接 staged，owner 发布，产品内不再 park 双人复核 |
| 2A | 一次只有一个进行中的导入（validating 或 staged）。服务端 SQL 拒绝第二份；failed 释放名额；staged 可取消 |
| 5A | 生产发布不再调用 `completeSignedInReview`。同时从生产桌面删除 43112 合成三连。禁止用一个人的令牌伪造三张 capability 收据 |
| 5A-SQL | 新 migration（不改 generated `0012`）：staged 用一条组织已审证据过质检门。禁止伪造 lead/manager/quality 三张收据 |
| 5A-SNAP | Owner 导入把上传字节登记为该来源的新 snapshot，再校验哈希。不再用合成栈 CSV 哈希去对飞书表。不自动编造四域绑定 |
| 6A | 导入/发布/announce/串行批次 + 桌面断言（待发布、无审核确认、无 signed-in 三票）完整测试 |
| D7 | 失败中文：问题 + 原因 + 下一步。码留日志 |
| D9 | 内容管理「待审核草稿」改成「待发布」。话术库单条 pending_review 不动 |
| D10 | 去掉本地「审核确认」门闩。流水线导入 → 发布。Owner 选表后发布键可点 |
| D11 | 改发版路径文档：DESIGN.md、how-to-verify-desktop、tutorial-first-run、tutorial-menokin、README 内容管理段、AGENTS.md 相关行。不改 CHANGELOG 旧条目和归档 plans |
| D12 | 完成 = 办公机新 Windows 桌面包，不是 API 合进 main |
| D13 | 办公机秒表：选表 → 看到版本号和谁发的 < 2 分钟，外加 6A |

飞书文档审核是组织前置，产品不读取飞书文档。

### 审核证据边界（实话，交接必读）

`content_quality_review_evidence` 里那条 `org-reviewed:feishu-doc` 证据是 worker 自己写的：审核人 ID 取 `sha256('org-reviewed:feishu-doc:lead:' || 批号)` 与 `:qa:` 的确定值，不是真人账号；`conclusion='passed'` 也由 `record_org_reviewed_quality_evidence` 落库。SQL 里的 `REVIEW_EVIDENCE_TRUST_BOUNDARY` 只挡「worker 在 payload 里夹带审核字段」，挡不住这两个 definer 函数自己写证据。

结论：库里记的是**一条声明**，不是一道独立控制；worker（API 进程）的信任级就等于审核的信任级。谁审的以飞书文档为准，库里的角色字段只用于对账，不能拿来举证。改这条链路前先读 `packages/database/overlays/0016_office_owner_publish.sql` 的两个函数，别在 API 层加"校验"。迁移文件已落库并带内容哈希，**不要改** `0016`（overlay 或 generated），改了会让正式库的 `/ready` 对不上。

## 目标数据流

```
Owner 登录 (Feishu)
    │
    ▼
工作台 内容管理：选 CSV/xlsx（预览，无本地审核确认）
    │
    ▼
登记上传字节为该来源新 snapshot
    │
    ▼
POST /v1/content/import
    │
    ▼
worker validate
    │  4A：成功则 staged，不写 backend_review.waits
    │  5A-SQL：写入组织已审质检证据，不伪造三票
    ▼
Owner 点发布
    │
    ▼
POST /v1/content/publish    owner-only，无 completeSignedInReview
    │
    ▼
content_current 切换
    │
    ▼
坐席登录 / 查询 → GET /v1/announce/current → hydrate
```

失败：校验失败 → failed，工作台中文原因 + 改表后重新导入。  
第二份导入在第一份未 publish/cancel/failed 前由 SQL 拒绝，界面给中文原因。

## 不在范围

- 检索排序、签名、自动更新、runtime_activated、Linux
- 注册产品、推送系统
- 打开或隧道 43112
- 一人自动打三票 / 伪造三张 capability 收据
- 自动补齐缺失的四域 source_bindings（登记快照 ≠ 编造域）
- 话术库单条 PATCH/DELETE 的 pending_review 合同与文案
- 产品内 TTHW 埋点
- 改写 CHANGELOG 历史条目

## 最小改动面

1. worker：validate 成功走 staged，不 park（production）
2. 新 migration：组织已审证据过 `QUALITY_GATE_NOT_PASSED`，禁止改 `0012_owner_acceptance_v1_15.sql`
3. 导入：登记上传字节 snapshot，再跑哈希门
4. 桌面生产路径：IPC 不再传 `completeSignedInReview`；删/停用 `dashboard-content-review.ts` 合成三连
5. 桌面 UI：`ContentModule` 去掉审核确认；文案待发布；成功面板 `releaseId` + `displayName`；`asFailure` 把 `error.reason` 翻成中文
6. SQL + UI：一次一个 in-flight import；staged 可取消
7. 文档见 D11
8. 测试见 6A；办公机新包 + 秒表见 D12/D13

## 失败文案（D7）

工作台显示中文，码进日志，不把 HMAC/路径打到窗口。

| reason / code | 屏幕 |
|---|---|
| SOURCE_SNAPSHOT_MISMATCH | 文件和当前登记的来源对不上。请确认这是要发的那份表后重新导入。 |
| CONTENT_CONTRACT_INVALID | 表格式或花括号不合法。请按模板改表后重新导入。 |
| 进行中第二份（CONFLICT / SOURCE_BASE_RELEASE_STALE） | 上一份还在处理。请等它发布或点取消后再导下一份。 |
| QUALITY_GATE_NOT_PASSED | 质检证明没写上，不能发布。请联系管理员，不要重复点发布。 |
| FORBIDDEN 非 owner | 一期发布仅管理员。 |
| 其它 VALIDATION | 表没通过校验。请改表后重新导入。 |

## 测试图（6A）

```
CODE PATHS                                         USER FLOWS
[+] worker validate                                [+] 有权限的人发一版
  ├── [GAP] [→E2E] 成功 → staged 无 waits            ├── [GAP] [→E2E] 导入→发布→announce 新 release_id
  ├── [★★  已有] 校验失败 → failed                   ├── [GAP]        第二份导入被拒，原因可见
  └── [GAP]         不写 synthetic / signed-in 三票  └── [GAP]        坐席重登后搜到新标题
[+] publish
  ├── [GAP] owner + staged + 组织已审证据 → published
  └── [★★  已有] 非 owner → FORBIDDEN
[+] announce
  └── [GAP] current_release_id == 刚发布的 id
[+] desktop
  ├── [GAP] 无「审核确认」门闩，选表后发布可点
  ├── [GAP] 文案「待发布」不是「待审核草稿」
  └── [GAP] 成功面板含 releaseId 与 displayName
```

回归 **CRITICAL**：dual-review / signed-in review / `DashboardApp` 流水线 / `dashboard-manifest` 「待审核草稿」断言按 4A/D9/D10 改，不要跳过。

Health stack：`pnpm typecheck` `pnpm lint` `pnpm test`（及改动触及的 `pnpm test:db` / content 集成）。  
打包：办公机 Windows 包（现有 `package:win` / local-unsigned 流程）。

## Developer Persona Card

```
TARGET DEVELOPER PERSONA
========================
Who:       有发布权的人（飞书 owner / 管理员会话）
Context:   办公机。飞书文档已审完表，导出 Excel，要让坐席搜到新标题
Tolerance: 冠军 < 2 分钟。看到双人复核或待审核就放弃，把表打回 Mac
Expects:   选表 → 发布 → 看到版本号和谁发的
```

## Developer Empathy Narrative

我打开工作台内容管理。标题还写「本地导入进入待审核草稿」。我选了飞书刚导出的表，预览出来了，但发布键是灰的，旁边写「请先完成审核确认」。我点了「确认审核通过，进入发布」，然后点发布。过一会儿屏幕写「导入已进入双人复核。当前会话无法单独完成话术师、管理员和质检。」没有版本号。我以为自己没权限。若表对不上登记哈希，API 给 SOURCE_SNAPSHOT_MISMATCH，窗口只剩「请求内容无效」。我把表发回 Mac。坐席侧 rel_23 还是别人发出的，我查不到是谁传送的。

计划之后：选表 → 发布可点 → 校验通过 staged → 看到版本号和我的名字。失败则中文告诉我改表还是等上一份结束。

## Competitive DX Benchmark

```
COMPETITIVE DX BENCHMARK
=========================
Tool              | TTHW      | Notable DX Choice          | Source
内部 CMS 发版      | < 2 min   | 审完即发，失败可改         | 0C 目标
Stripe 收款        | ~30s      | 一次调用看到结果           | 参考
当前 0.3.19        | 放弃      | 假三票 + 本地审核确认       | 办公机现场
本计划             | < 2 min   | 选表→发布→版本+谁发的      | D12/D13
```

## Magical Moment Specification

车辆：成功面板（0D）。  
发布成功后工作台写：新 `releaseId`、发布人 `displayName`（`product-session` 已有，需传到内容会话）。不要只写 `已提交发布 · ${releaseId}`。

## Developer Journey Map

```
STAGE           | DEVELOPER DOES              | FRICTION POINTS      | STATUS
----------------|-----------------------------|--------------------- |--------
1. Discover     | 工作台 → 内容管理            | 无                   | ok
2. Install      | 已装 0.3.19                 | 新文案要新包          | fixed (D12)
3. Hello World  | 选表 → 发布                 | 双人复核/待审核/门闩  | fixed (D9/D10/5A)
4. Real Usage   | 看谁发的；一次一份表         | 成功无名字；第二份卡死 | fixed (0D/2A)
5. Debug        | 失败改表重导                 | 英文合同码            | fixed (D7)
6. Upgrade      | 装新 Windows 包             | 只合 API 看不见       | fixed (D12)
```

## First-Time Developer Confusion Report

```
FIRST-TIME DEVELOPER REPORT
============================
Persona: 有发布权的人
Attempting: 办公机发一版

CONFUSION LOG:
T+0:00  打开内容管理，选 Excel。标题写待审核草稿。
T+0:30  发布键灰，要先「审核确认」。
T+1:00  点发布后看到双人复核，以为没权限。
T+2:00  若哈希失败看到英文码，无法改表。
T+3:00  放弃，表打回 Mac。

计划后：T+0 选表，T+0:30 点发布，T+<2:00 看到版本号和谁发的。四处都改（D8）。
```

## What already exists

- `POST /v1/content/import`、`POST /v1/content/publish`、`GET /v1/announce/current`
- `CONTENT_PUBLISH_COPY`、`PRODUCT_ERRORS` 已是中文骨架，缺 reason 映射
- `displayName` 已在 `product-session`
- Windows local-unsigned 打包与 `verify-windows-package.mjs`
- Health stack：`pnpm typecheck` `pnpm lint` `pnpm test`

## DX Scorecard

```
+====================================================================+
|              DX PLAN REVIEW — SCORECARD                             |
+====================================================================+
| Dimension            | Score  | Prior  | Trend  |
|----------------------|--------|--------|--------|
| Getting Started      | 8/10   | —      | —      |
| API/CLI/SDK          | 8/10   | —      | —      |
| Error Messages       | 7/10   | —      | —      |
| Documentation        | 8/10   | —      | —      |
| Upgrade Path         | 7/10   | —      | —      |
| Dev Environment      | 7/10   | —      | —      |
| Community            | 3/10   | —      | n/a 内部 |
| DX Measurement       | 6/10   | —      | —      |
+--------------------------------------------------------------------+
| TTHW                 | 放弃   | <2 min | 目标冠军 |
| Competitive Rank     | Champion (目标)                              |
| Magical Moment       | designed via 成功面板 releaseId+displayName  |
| Product Type         | 内部工作台（内容发布 GUI）                    |
| Mode                 | POLISH                                       |
| Overall DX           | 7/10   | —      | 实施后办公机可发版          |
+====================================================================+
| DX PRINCIPLE COVERAGE                                               |
| Zero Friction      | covered（去门闩、待发布、新包）                  |
| Learn by Doing     | covered（how-to/教程按 4A 改）                  |
| Fight Uncertainty  | covered（D7 中文失败）                          |
| Opinionated + Escape Hatches | covered（2A 可取消）                 |
| Code in Context    | gap（内部产品，无公开 SDK 示例）                 |
| Magical Moments    | covered（成功面板）                             |
+====================================================================+
```

Community 3/10 不挡内部发版。Error 7/10：新合同码要补进映射表。Measurement 6/10：靠秒表，不埋点。

## DX Implementation Checklist

```
DX IMPLEMENTATION CHECKLIST
============================
[ ] Time to hello world < 2 min（办公机秒表）
[x] 选表后发布可点（无审核确认）
[x] 成功面板：releaseId + displayName
[x] 每个导入失败：问题 + 原因 + 怎么修（码在日志）
[x] 一次一份进行中导入，原因可见，staged 可取消
[x] how-to / tutorial / README / DESIGN / AGENTS 与 4A 一致
[ ] 新 Windows 桌面包装到办公机
[x] 6A 测试含桌面断言，dual-review 回归改断言不跳过
[x] Health stack 绿
```

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. Run with Claude Code or Codex; checkbox as you ship.

- [x] **T1 (P1, human: ~4h / CC: ~30min)** — desktop — 生产发布去掉 completeSignedInReview，并停用 43112 合成三连
  - 完成（0.3.20 切生产路径；0.3.21 后由 `chore/remove-dormant-dual-review-code` 删除残留死代码）
  - Surfaced by: Outside voice #1 / D14 — ipc.ts:76-83 才是办公机路径
  - Files: `apps/desktop/src/main/dashboard-content-ipc.ts`, `apps/desktop/src/main/dashboard-content.ts`, `apps/desktop/src/main/dashboard-content-review.ts`
  - Verify: `pnpm test` 中 dashboard-content-signed-in-review 与 dashboard-content-review 改断言

- [x] **T2 (P1, human: ~1d / CC: ~2h)** — database — 新 migration：组织已审证据过质检门
  - Surfaced by: Outside voice #3 / D15 — QUALITY_GATE_NOT_PASSED
  - Files: 新 migration（禁止改 `packages/database/migrations/0012_owner_acceptance_v1_15.sql`）
  - Verify: `pnpm test:db` publish owner+staged 无三票

- [x] **T3 (P1, human: ~1d / CC: ~2h)** — api/desktop — 导入登记上传字节为新 snapshot
  - Surfaced by: Outside voice #4 / D16 — SOURCE_SNAPSHOT_MISMATCH
  - Files: enqueue/import 路径、`apps/desktop/src/renderer/features/dashboard/ContentModule.tsx` 绑定来源（不编造四域）
  - Verify: 飞书导出表可入队；错误哈希仍中文失败

- [x] **T4 (P1, human: ~4h / CC: ~30min)** — worker — validate 成功 staged，不 park
  - Surfaced by: 4A
  - Files: content worker validate
  - Verify: 成功无 `backend_review.waits`

- [x] **T5 (P1, human: ~0.5d / CC: ~45min)** — desktop — 去掉审核确认；待发布文案；成功面板
  - Surfaced by: D9 / D10 / 0D — ContentModule.tsx:136-151, :273, :314
  - Files: `ContentModule.tsx`, `dashboard-content.ts` CONTENT_PUBLISH_COPY, session displayName
  - Verify: ContentModule / DashboardApp / dashboard-manifest 测试改断言

- [x] **T6 (P1, human: ~0.5d / CC: ~1h)** — desktop — asFailure 映射 reason 中文
  - Surfaced by: D7 — dashboard-content.ts:26-38 丢掉 reason
  - Files: `apps/desktop/src/main/dashboard-content.ts`, `apps/desktop/src/shared/dashboard-content.ts`
  - Verify: 失败文案表三例

- [x] **T7 (P1, human: ~0.5d / CC: ~30min)** — api — 2A 服务端拒绝第二份 in-flight；staged 可取消
  - Surfaced by: 2A / Outside voice #5
  - Files: enqueue SQL/API、工作台取消
  - Verify: 第二份原因可见；failed 释放

- [x] **T8 (P2, human: ~0.5d / CC: ~30min)** — docs — D11 发版路径文档
  - Surfaced by: Pass 4 / D11
  - Files: `DESIGN.md`, `README.md`, `docs/how-to-verify-desktop.md`, `docs/tutorial-first-run.md`, `docs/tutorial-menokin-content-publish.md`, `AGENTS.md`
  - Verify: 上述文件不再教办公机 dual-review

- [ ] **T9 (P1, human: ~1d / CC: ~1h)** — release — Windows 包到办公机 + 秒表 < 2 分钟
  - Surfaced by: D12 / D13
  - Files: 现有 package:win / local-unsigned
  - Verify: 办公机选表到版本号+谁发的 < 2 min；坐席 announce 新 release_id

**T1–T8 完成复核（2026-09-27，0.3.21 main）：**
- T1 生产路径已切：`dashboard-content-ipc` 不再走 `completeSignedInReview`；43112 合成三连停用，残留死代码已在本分支删除。
- T2/T3/T4：`0016_office_owner_publish.sql` 的 `record_org_reviewed_quality_evidence` / `advance_source_snapshots` / `finalize_org_reviewed_import_validation` 已接线（worker 与 enqueue 路径均调用）。
- T5/T6：`ContentModule` 文案已是「待发布」（「待审核草稿」0 处）；`CONTENT_IMPORT_FAILURE_COPY` 已接进 `asFailure`。
- T7：`assert_no_in_flight_content_import` 与 `cancel_actor_in_flight_imports` 已接线，含哨兵分支与共锁。
- T8：README / DESIGN / AGENTS 不再教办公机 dual-review（DESIGN 仅保留「产品内不再 park 双人复核」这句正确表述）。

**T9 仍 OPEN：** 唯一未闭合项。需要人在办公机 Windows 上装新包、点「取消未完成导入」、选表发布并掐表 < 2 分钟。开发机不能代填。

_No new tasks from Pass 6 tooling beyond T9. No new tasks from Pass 7 community._

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | Codex timeout → Claude subagent | Independent 2nd opinion | 1 native | unavailable (Codex) / issues_found (native) | 生产路径是 completeSignedInReview 不是 43112。D14–D16 已采纳 |
| Eng Review | `/plan-eng-review` | Architecture & tests | 1 | AMENDED | 5A 对准 signed-in 三票；补 migration 与 snapshot 登记 |
| Design Review | `/design-review` | Live UI | 1 | DONE_WITH_CONCERNS | C+→B-；修 001/003/004；说明书墙未动 |
| DX Review | `/plan-devex-review` + `/devex-review` | Plan POLISH then live | 1+1 | LIVE 6/10 | 待发布 1.1s TESTED；发布未测；how-to/CHANGELOG 仍 dual-review |

**OUTSIDE COVERAGE:** plan Codex unavailable；live `/devex-review` 无独立外审。

**VERDICT:** 方案已实施可继续打磨。冠军 TTHW 未在办公机发布上闭合。eng review required for ship。

**UNRESOLVED DECISIONS:**
- 本分支未合 main；0.3.20 的包是开发机打的，正式发版仍要合并后重打
- T9 办公机秒表未跑：需要人在那台 Windows 上装新包、清掉孤儿导入、走完一次发布
