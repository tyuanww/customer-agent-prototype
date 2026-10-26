# 分析层口径

口径仍以本文为准。迁移 `0070` 已经落地函数 `analytics.question_v1`，它不是无参视图。字典见 `docs/database/dictionary/analytics.md`。本文不建新角色。

## 现成的只读面

现成的只读面是 `public.vw_owner_asked_questions`、`vw_owner_shown_scripts`、`vw_owner_unmatched_questions`、`vw_owner_agent_daily`。定义在迁移 `0018_owner_read_views.sql`。`0019_candidate_client_snapshot.sql` 重写了 `vw_owner_shown_scripts`，并加上 `agent_snapshot_version` 和 `snapshot_was_stale`。

`app_owner_read` 在同一份 `0018` 迁移里创建，属性是 `NOLOGIN`。它得到这四个视图的 SELECT，得不到基表。`packages/database/migrations` 里的 `CREATE ROLE` 有 17 处，每一处都写了 `NOLOGIN`。能登录的账号不在这些迁移里建。

数仓接口是函数 `analytics.question_v1(p_start, p_end)`。第一版返回三个比率。分子和分母都限制在同一个闭区间，查询行来自 `query_events`，不准反馈来自同一窗口的 `ops_loop.inaccuracy_reports`。

## 命中率

命中率是同一时间窗里 `hit_status` 为 `hit` 的 `query_events` 行数，除以该时间窗的 `query_events` 行数。

没有查询时，函数把三个比率留空，不写成 0。`copied_to_clipboard` 不进入分子。复制不是命中。

## 无命中率

无命中率是同一时间窗里 `hit_status` 为 `no_hit` 的 `query_events` 行数，除以该时间窗的 `query_events` 行数。

约束 `query_events_hit_status_check` 只允许 `hit` 和 `no_hit`。在这个约束下，时间窗里有查询时，命中率加无命中率等于 1。如果以后出现第三种值，单独计数，不并进无命中。

## 不准反馈率

不准反馈率是同一时间窗里 `ops_loop.inaccuracy_reports` 的行数，除以该时间窗的 `query_events` 行数。

主键是 `query_id` 加 `script_id`。一条查询可以有零行或多行反馈。反馈行数可以大于查询行数。分母用查询行数。用命中行数当分母会把无命中查询排除。

## 和现有视图的关系

`vw_owner_asked_questions.library_matched` 为真，表示 `hit_status` 是 `hit`。`vw_owner_unmatched_questions` 只保留 `no_hit`。`vw_owner_shown_scripts` 提供展示和 `copied_to_clipboard`，不提供这三个比率。

`vw_owner_agent_daily` 按人和按天给出 `questions`、`matched`、`copied`，另有 `copy_rate`。`copy_rate` 是复制数除以提问数，不是上面三个比率。

`text_storage_status` 为 `suppressed` 时，约束 `query_text_storage_shape` 要求 `query_text_redacted` 为空。`hit_status` 仍在。原文为空的行仍留在三个比率里。业主视图把这段状态放在 `question_retention`，问题列名是 `question`。
