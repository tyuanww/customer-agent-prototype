# 数据治理

给看数的人用。表和列以 [数据库字典](database/dictionary/index.md) 为准。本文记录每个 schema 由谁写入、按列名扫到哪些个人相关列，以及一次查询怎么接到发布。

## 字典规模

`docs/database/dictionary/index.md` 写着 9 个 schema、116 张表。这里的「表」是基表。视图另计。

计数范围是该目录里除 `index.md` 以外的 9 个 schema 文件。基表是没有 `类型：VIEW` 的关系。视图是有这行的关系。列定义只取每个关系标题下的列定义表，表头为列、类型、可空、默认、备注。约束表和索引表不计入。

计数结果与 `index.md` 一致。基表 116。视图 7。列定义 1140。非基表关系都标着 `类型：VIEW`。

1140 行里有 3 行备注非空。这 3 行是 `content_intake.candidate_versions.digest` 的 `STORED GENERATED`，以及 `public.candidate_impressions.client_snapshot_release_id` 和 `public.staging_scripts.script_version` 的业务注释。没有一行是敏感级别。其余 1137 行备注为空。因此下面的个人相关列只按列名匹配。

## 每个 schema 管什么

下表的表数、视图数和列数来自同一次计数。

| schema | 表 | 视图 | 列 | 管什么 | 谁写 |
| --- | --- | --- | --- | --- | --- |
| `analytics` | 0 | 0 | 0 | 窗口内的查询与不准反馈比率 | 没有表。`question_v1` 由 `cs_ai_definer` 执行。`app_owner_read` 和 `app_runtime` 有 EXECUTE。`app_runtime` 本来就能 SELECT `query_events`。不准反馈表仍不对 `app_runtime` 开放 |
| `backend_identity` | 5 | 0 | 31 | 登录绑定、坐席、飞书 open id | 写入走 `SECURITY DEFINER` 函数，包括 `create_seat` 和 `establish_feishu_login`。迁移对 PUBLIC 收回表权限，另有 SELECT 和列级 UPDATE |
| `backend_review` | 3 | 0 | 28 | 审核回执与等待 | 迁移 `0033_intake_runtime_v1_23.sql` 把 `receipts` 的 INSERT 授给 `intake_business` |
| `content_intake` | 57 | 1 | 451 | 授权、发布、角色上限、坐席岗位 | 授权和发布事务。撤销填写 `grants.revoked_at` |
| `customer_agent_meta` | 1 | 0 | 8 | 迁移账本 `schema_migrations` | 跑迁移的连接 |
| `intake_organization` | 3 | 0 | 23 | 组织 open id | `bindings` 与 `observations` 的删除和更新会抛出 `ORGANIZATION_HISTORY_IMMUTABLE`。字典没有写 INSERT 授给哪个角色 |
| `intake_runtime` | 0 | 0 | 0 | 运行函数 | 5 个函数，没有表 |
| `ops_loop` | 4 | 0 | 38 | SOP 与不准反馈 | `record_inaccuracy_report` 插入 `inaccuracy_reports`。SOP 在 `sop_nodes` |
| `public` | 43 | 6 | 561 | 查询事件与业主视图 | 查询插入 `query_events`。迁移 `0018_owner_read_views.sql` 把四个 `vw_owner_*` 的 SELECT 授给 `app_owner_read` |

9 个 schema 的表数相加是 116。视图数相加是 7。列数相加是 1140。

`content_intake.grant_history.grant_id` 的外键在字典里标了 `NOT VALID`，指向 `grants`。2026-10-24 的还原经过记在 [备份与恢复演练](reference-backup-and-restore.md)。这次没有重跑演练。

## 按列名匹配的个人相关列

匹配规则是列名等于 `user_id`、`display_name`、`binding_id`、`open_id`、`query_text_redacted`、`query_text_hash`，或以 `_user_id`、`_display_name`、`_binding_id`、`_open_id` 结尾。`actor_user_id` 因结尾 `_user_id` 命中。`feishu_open_id` 因结尾 `_open_id` 命中。

命中 34 行，全部在基表上。按列名分开是 `user_id` 12、`actor_user_id` 9、`binding_id` 4、`display_name` 3、`open_id` 3、`feishu_open_id` 1、`query_text_redacted` 1、`query_text_hash` 1。

按文件分开是 `public.md` 17、`backend_identity.md` 7、`content_intake.md` 4、`backend_review.md` 2、`intake_organization.md` 2、`ops_loop.md` 2、`customer_agent_meta.md` 0、`intake_runtime.md` 0。

本文把这 34 行标成不用于训练。`content_intake.shop_displays.display_name` 和 `content_intake.vocabulary_displays.display_name` 留在这 34 行里，只因为列名匹配。这两张表是店铺显示和词表显示。扫描没有读单元格里的字。

规则之外，同一次扫描还看到 `actor_id` 12 行，以及 `content_intake.principals.person_key` 1 行。这两类没有手标。

| 列名 | schema | 关系 |
| --- | --- | --- |
| `actor_user_id` | `backend_review` | `quality_checks` |
| `actor_user_id` | `backend_review` | `receipts` |
| `actor_user_id` | `ops_loop` | `inaccuracy_reports` |
| `actor_user_id` | `ops_loop` | `script_mutations` |
| `actor_user_id` | `public` | `change_audits` |
| `actor_user_id` | `public` | `import_batches` |
| `actor_user_id` | `public` | `iteration_task_status_audits` |
| `actor_user_id` | `public` | `work_order_export_audits` |
| `actor_user_id` | `public` | `work_order_import_batches` |
| `binding_id` | `backend_identity` | `feishu_login_links` |
| `binding_id` | `backend_identity` | `login_requests` |
| `binding_id` | `backend_identity` | `sessions` |
| `binding_id` | `backend_identity` | `subject_bindings` |
| `display_name` | `content_intake` | `shop_displays` |
| `display_name` | `content_intake` | `vocabulary_displays` |
| `display_name` | `public` | `app_users` |
| `feishu_open_id` | `public` | `app_users` |
| `open_id` | `backend_identity` | `feishu_login_links` |
| `open_id` | `intake_organization` | `bindings` |
| `open_id` | `intake_organization` | `current_bindings` |
| `query_text_hash` | `public` | `query_events` |
| `query_text_redacted` | `public` | `query_events` |
| `user_id` | `backend_identity` | `capability_bindings` |
| `user_id` | `backend_identity` | `subject_bindings` |
| `user_id` | `content_intake` | `entitlements` |
| `user_id` | `content_intake` | `principals` |
| `user_id` | `public` | `adoption_events` |
| `user_id` | `public` | `app_users` |
| `user_id` | `public` | `client_sync_state` |
| `user_id` | `public` | `escalate_actions` |
| `user_id` | `public` | `idempotency_keys` |
| `user_id` | `public` | `notice_decisions` |
| `user_id` | `public` | `query_events` |
| `user_id` | `public` | `snapshot_offline_leases` |

业主视图把部分字段换了名，所以不在这 34 行里。下面 6 个视图列来自迁移 `0018_owner_read_views.sql`。`0019_candidate_client_snapshot.sql` 重写 `vw_owner_shown_scripts` 时，`agent` 仍这样取。

| 视图 | 列 | 取自 |
| --- | --- | --- |
| `vw_owner_agent_daily` | `agent` | `display_name`，没有显示名时用 `user_id` |
| `vw_owner_asked_questions` | `agent` | `display_name`，没有显示名时用 `user_id` |
| `vw_owner_asked_questions` | `question` | `query_text_redacted` |
| `vw_owner_shown_scripts` | `agent` | `display_name`，没有显示名时用 `user_id` |
| `vw_owner_unmatched_questions` | `agent` | `display_name`，没有显示名时用 `user_id` |
| `vw_owner_unmatched_questions` | `question` | `query_text_redacted` |

## 查询文本和到期

`query_text_redacted` 存脱敏后的文本。搜索路由在 `apps/api/src/search-routes.ts`。请求进来时 `collection_mode` 已是 `synthetic`，文本会保留。`pilot_recorded` 并且调用方注入了 `hasAcceptedCurrentNotice`、结果为未接受时，模式改成 `synthetic`，文本不保留，`text_storage_status` 写成 `suppressed`。依赖没注入时，这段检查不跑。

`query_events.text_expires_at` 和 `event_expires_at` 允许为空。约束 `query_expiry_shape` 要求两者都有值时，文本到期不晚于事件到期。

当前插入在 `apps/api/src/event-repository.ts`。这条 `INSERT` 把 `text_expires_at` 和 `event_expires_at` 都写成 `NULL`。在 `apps/` 和 `scripts/` 里，这两列只出现在这一处。所以这条写入路径没有自动到期。字典里有列，不等于已经在删数据。

口令不在字典的列里。账号文件是栈根下的 `password-accounts.json`。默认栈根是用户主目录下的 `.customer-agent-synthetic-stack`。`CUSTOMER_AGENT_STACK_ROOT` 可以改栈根。

## 从查询到发布

1. 坐席查询插入 `public.query_events`。约束 `query_events_hit_status_check` 只允许 `hit` 和 `no_hit`。`query_events.release_id` 指向 `public.content_releases`。
2. 同一次查询还会插入 `public.candidate_impressions`。复制是另一次写入，插入 `public.adoption_events`。`outcome` 为 `adopted` 时，`vw_owner_shown_scripts.copied_to_clipboard` 为真。这只表示复制，不表示发出。
3. 话术正文来自已发布的 release。发布事务写在 `content_intake`。查询行上的 `release_id` 指向当时读到的 `content_releases`。

`ops_loop.record_inaccuracy_report` 把不准反馈插入 `ops_loop.inaccuracy_reports`。该函数的插入不给 `query_events.hit_status` 赋值。
