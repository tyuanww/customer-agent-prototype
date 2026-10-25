# F2 采集与脱敏策略评审（2026-10-26）

本文对应任务卡 F2（`docs/plans/2026-10-24-saas-refactor-task-cards.md`）。只描述本分支代码与数据字典里已经存在的行为与形状，不给出法规结论，也不替法务做平台规则认定。

## 1. 本期 L0 范围

任务卡与 2026-10-24 已定决策一致，L0 只覆盖坐席侧四类信号。

| 信号 | 主要落库位置 | 本分支可见字段（字典层） |
| --- | --- | --- |
| 坐席查询与是否命中 | `public.query_events` | `query_text_redacted`、`text_storage_status`、`hit_status`、`collection_mode`、`platform`、`release_id` 等 |
| 展示了哪些候选 | `public.candidate_impressions` | `rank`、`script_id`、`script_version`、`content_hash` |
| 复制了哪条话术 | `public.adoption_events` | `outcome`（`adopted` 表示复制进输入框）、`chosen_rank`、`chosen_script_id`、`push_method` |
| 「话术不准」反馈 | `ops_loop.inaccuracy_reports` | 主键 `(query_id, script_id)`，经 `ops_loop.record_inaccuracy_report` 写入 |

顾客聊天记录不在本期。本分支未见把会话 transcript 写入上述 L0 表的表结构或 API 路由。

业主只读视图（迁移 `0018_owner_read_views.sql`）把内部名映射成可读列，例如 `vw_owner_asked_questions` 的 `library_matched` 对应 `hit_status = 'hit'`，`vw_owner_shown_scripts` 的 `copied_to_clipboard` 对应 `adoption_events.outcome = 'adopted'`。视图注释写明复制只表示进剪贴板，不表示已发送。

## 2. `pilot_recorded` 告知与同意门

### 2.1 数据字典

`public.privacy_notices` 存告知版本、正文、正文 SHA-256、状态（`draft` / `current` / `retired`）。同一时刻最多一行 `status = 'current'`（唯一部分索引 `uq_privacy_notice_current`）。

`public.notice_decisions` 按 `(notice_version, user_id)` 主键记录一次明确决定，取值 `accepted` 或 `declined`，来源 `first_run_prompt` 或 `settings`。迁移注释写明该行是解锁 `pilot_recorded` 采集的只追加证据，改主意需要新告知版本，不能覆盖旧决定。

`public.query_events.collection_mode` 的 CHECK 允许 `synthetic`、`approved_redacted`、`pilot_recorded` 三值。

### 2.2 API 与写入路径

`apps/api/src/notice-routes.ts` 暴露 `GET /v1/notices/current` 与 `POST /v1/notices/{version}/decision`。

`apps/api/src/notice-service.ts` 在 `app_runtime` 角色下读取 `privacy_notices` 与 `notice_decisions`。`hasAcceptedCurrentNotice` 用 SQL 判断当前用户是否对 `status = 'current'` 的告知做过 `decision = 'accepted'`。

`apps/api/src/search-routes.ts` 在组装搜索前调用 `redactQueryText`（`apps/api/src/request-boundary.ts`）。若请求体 `collection_mode` 为 `pilot_recorded` 且注入了 `hasAcceptedCurrentNotice`，则未接受或检查抛错时把写入侧的 `collectionMode` 改为 `synthetic`，并设 `retainQueryText = false`。检索仍继续，HTTP 不因此返回 403。`apps/api/tests/search-routes.test.ts` 钉住了这一降级语义。

`apps/api/src/event-repository.ts` 插入 `query_events` 时，若 `retainQueryText` 为 false，则 `query_text_redacted` 与 `query_text_hash` 为 NULL，`text_storage_status` 为 `suppressed`；为 true 时写入脱敏正文与哈希，`text_storage_status` 为 `stored`。

冻结合同 OpenAPI（例如 `contracts/upstream/customer-agent/cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed/openapi.v1.yaml` 中 `CollectionMode` 与 `/v1/search` 说明）文字要求 `pilot_recorded` 时服务端确认当前告知已被接受，未接受时 fail-closed。本评审只记录「合同条文」与「上述路由实现」并存，不在此裁定以哪一方为准。

### 2.3 桌面客户端

`apps/desktop/src/main/product-ipc.ts` 把告知读写限制在 Query 窗口。`product-session.ts` 的 `currentNotice` / `decideNotice` 调用对应 HTTP。

`apps/desktop/src/main/product-search.ts` 的 `collectionMode` 在调用 `currentNotice()` 后仍固定返回 `pilot_recorded`，并不根据 `decision` 切换为 `synthetic`。因此同意门在服务端写入路径上生效，而不是靠客户端改 `collection_mode`。

`docs/how-to-pilot-collection-consent.md` 描述弹窗、决策入库顺序，以及 2026-10-15 草稿告知尚未入库的状态。该 how-to 与 `search-routes.ts` 在「未同意是否 403」上的表述不一致，实施时应以代码与测试为准。

## 3. 脱敏策略（姓名、地址、订单号、昵称）

`apps/api/src/request-boundary.ts` 定义 `REDACTION_POLICY_VERSION = 'phase1-redaction-v1'`。`redactQueryText` 对输入做 NFKC 后，用正则替换中国大陆手机号与 15/18 位身份证号片段为字面量 `[REDACTED]`。

本分支该文件未包含针对姓名、地址、订单号、昵称的替换规则。任务卡 F2 与 `docs/plans/2026-10-24-frontend-design-decisions.md` 也写明姓名与地址当前不脱敏，告知只应写已做到的手机号与身份证号处理。

复制路径在话术模板层使用 `{订单号}` / `{日期}` 占位符（见 `docs/reference-desktop-contracts.md`），那是渲染复制内容，不是对 `query_events.query_text_redacted` 的额外脱敏。

写入行会记录 `redaction_policy_version`，便于日后区分策略版本。

## 4. 保留期列 `text_expires_at` 与 `event_expires_at`

### 4.1 字典与约束

`docs/database/dictionary/public.md` 中 `query_events` 含可空的 `text_expires_at`、`event_expires_at`。

`packages/database/migrations/0003_events_and_metrics.sql` 定义约束 `query_expiry_shape`：

- 两列若不为 NULL，则必须 `>= created_at`。
- 若两列都不为 NULL，则 `text_expires_at <= event_expires_at`。
- 并为非 NULL 值建部分索引 `idx_query_text_expiry`、`idx_query_event_expiry`。

语义上，字典把「问题正文是否还保留」投影到业主视图列 `question_retention`（来自 `text_storage_status`，见 `0018_owner_read_views.sql`），与上述时间戳列是不同维度。

### 4.2 运行时写入

`apps/api/src/event-repository.ts` 在 `INSERT INTO public.query_events` 时把 `text_expires_at` 与 `event_expires_at` 固定写为 `NULL`。

本分支 `apps/` 下未见根据这两列执行删除或 anonymize 的定时任务或路由。保留期在 schema 上预留，到期逻辑与具体天数未在本分支应用代码中实现。

## 5. 店铺级开关与撤回

任务卡要求评审店铺级开关与撤回。在本分支 `docs/database/dictionary/` 与 `apps/api/src/` 中，未见按店铺单独关闭 L0 采集的专用表、flag 或 HTTP 操作。

`public.policy_flags`（字典 `public.md`）存全局布尔开关，种子迁移 `0009_phase1_policy_seed.sql` 写入的是 `rewrite`、`auto_send` 等 Phase 1 能力，不是店铺采集开关。

撤回在数据层最接近的机制是坐席对当前告知提交 `declined`，或发布新 `notice_version` 后重新决策。`notice_decisions` 不允许对同一版本改投相反票（冲突返回 409）。前端设计稿（`docs/plans/2026-10-24-frontend-design-decisions.md`）描述了菜单里重新打开告知与「撤回后不再记录、已记数据按保留期删除」的文案方向，该文案尚未作为已发布 `privacy_notices` 正文出现在本分支迁移里。

店铺维度授权仍在 `content_intake.grants` 等 intake 表，控制的是查询与内容动作资格，不是 L0 采集开关。

## 6. 训练准入

L0 事件默认进入 `query_events` 等业务表，不等于自动进入训练语料。

`public.semantic_source_assets`（字典 `public.md`）描述语义来源资产。`source = 'from_log'` 时约束要求 `promotion_review_ref`、`promoted_by_role`、`promoted_at` 非空，且 `lifecycle = 'active'` 时必须挂 `source_query_id` 指向 `query_events`。`source` 为 `manual` 或 `import` 时不要求上述晋升字段。`lifecycle = 'retired'` 时要求 `retirement_evd` 等退役证据，且 `source_query_id` 必须为 NULL。

`public.script_questions` 通过外键引用语义资产，把「日志晋升」与话术问题绑定。

本分支未见一键把任意 L0 行推入训练的 HTTP 路由。`docs/reference-api-adapter-handoff.md` 写明一期 OpenAPI 不得出现 training 路由。

## 7. 外部规则与法律来源（未核实）

任务卡注明，淘宝与抖音的平台数据使用规则，以及《个人信息保护法》具体条款，规划方未核实到可靠来源，需法务确认。

本评审不引用上述来源，也不写「已合规」或「违法」类结论。产品文案层面，`docs/plans/2026-10-24-frontend-design-decisions.md` 已要求告知不写未核实的合规暗示。

## 8. 评审结论（仅就本分支事实）

| 主题 | 本分支状态 |
| --- | --- |
| L0 四信号表结构与业主视图 | 已存在 |
| `pilot_recorded` 告知表、决策表、服务端接受检查与正文抑制 | 已存在；合同文字与路由降级语义需单独对齐 |
| Phase 1 脱敏 | 仅手机号与身份证号；姓名、地址、订单号、昵称未在 `redactQueryText` 处理 |
| 保留期时间戳 | 列与 CHECK/索引已有；写入恒为 NULL，无到期作业 |
| 店铺级采集开关 | 未见 |
| 撤回 | 告知 `declined` 与新版本决策；无独立「撤回 API」 |
| 训练准入 | `semantic_source_assets` 约束定义晋升形状；无 training 路由 |

## 9. 建议交给法务或产品确认的项（不在本分支代码内）

- 告知正文定稿与入库（参见 `docs/how-to-pilot-collection-consent.md` 草稿状态）。
- 姓名、地址、订单号、昵称是否及如何进入 Phase 2 脱敏规则。
- `text_expires_at` / `event_expires_at` 的目标天数与删除作业 owner。
- 店铺级 opt-out 是否需要新表或新 flag，与 intake 店铺授权如何分工。
- OpenAPI fail-closed 与 `search-routes.ts` 降级行为是否统一。

---

证据文件（本评审阅读路径，均相对于仓库根目录）：

- `docs/plans/2026-10-24-saas-refactor-task-cards.md`
- `docs/plans/2026-10-24-frontend-design-decisions.md`
- `docs/how-to-pilot-collection-consent.md`
- `docs/how-to-query-collection-data.md`
- `docs/database/dictionary/public.md`
- `docs/database/dictionary/ops_loop.md`
- `packages/database/migrations/0002_identity_and_content.sql`
- `packages/database/migrations/0003_events_and_metrics.sql`
- `packages/database/migrations/0018_owner_read_views.sql`
- `apps/api/src/notice-routes.ts`
- `apps/api/src/notice-service.ts`
- `apps/api/src/search-routes.ts`
- `apps/api/src/request-boundary.ts`
- `apps/api/src/event-repository.ts`
- `apps/api/tests/search-routes.test.ts`
- `apps/desktop/src/main/product-search.ts`
- `apps/desktop/src/main/product-ipc.ts`
- `contracts/upstream/customer-agent/cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed/openapi.v1.yaml`
