-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0018_owner_read_views; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534
-- source_git_sha=260ef224c5340a4d26e857bd02119044dd813f9a
-- source_schema_sha256=5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa
-- Product overlay (not a frozen contract snapshot slice).
--
-- The owner's read surface: one NOLOGIN capability role plus four views whose columns
-- are named after the question they answer, so the owner can read the collection data
-- without knowing the internal vocabulary (`release_id` is "library version", a
-- `hit_status` of 'hit' means "the library matched", and an `adopted` outcome means
-- "copied into the input box", never "sent").
--
-- The role gets SELECT on the views and NOTHING on the base tables. Views here are
-- owned by cs_ai_definer and run with the owner's privileges, so the semantic layer
-- is the only path: the owner cannot reach request_hash, tenant_id, the fingerprint
-- columns, or the raw event tables by going around it.
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- NOLOGIN, like every other capability role in this schema. The owner connects as a
-- login role that is a MEMBER of this one; creating that login role with a password is
-- a deployment action and deliberately does not live in a committed migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'app_owner_read') THEN
    CREATE ROLE app_owner_read NOLOGIN;
  END IF;
END $$;
ALTER ROLE app_owner_read NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO app_owner_read;

-- A view runs with its OWNER's privileges, so cs_ai_definer needs SELECT on every base
-- table these views read. It already had query_events and adoption_events (0008) but not
-- candidate_impressions or app_users; without both, selecting the view fails with 42501
-- even though app_owner_read was granted the view.
--
-- The alternative — granting the base tables to app_owner_read instead — would let the
-- owner bypass this layer entirely and read request_hash and the fingerprint columns,
-- which is the thing this overlay exists to prevent.
GRANT SELECT ON public.query_events, public.candidate_impressions,
                public.adoption_events, public.app_users
  TO cs_ai_definer;

GRANT CREATE ON SCHEMA public TO cs_ai_definer;

-- `app_users` is not seeded, so display_name is usually NULL and the raw id shows.
-- That is intentional and called out in the how-to: a NULL name is a fact about the
-- deployment, not a broken query.
CREATE OR REPLACE VIEW public.vw_owner_asked_questions AS
SELECT
  q.created_at                                  AS asked_at,
  COALESCE(u.display_name, q.user_id)           AS agent,
  q.query_text_redacted                         AS question,
  (q.hit_status = 'hit')                        AS library_matched,
  q.release_id                                  AS library_version,
  q.platform                                    AS platform,
  q.latency_ms                                  AS waited_ms,
  q.text_storage_status                         AS question_retention
FROM public.query_events q
LEFT JOIN public.app_users u ON u.user_id = q.user_id;

COMMENT ON VIEW public.vw_owner_asked_questions IS
  '回答：坐席都问了什么、话术库有没有匹配上。一行=一次提问。'
  'library_matched=true 表示库里找到了内容，不代表坐席用了；'
  'question 为空（question_retention=suppressed）是脱敏策略的结果，不是查询出错。';

CREATE OR REPLACE VIEW public.vw_owner_shown_scripts AS
SELECT
  q.created_at                                  AS asked_at,
  COALESCE(u.display_name, q.user_id)           AS agent,
  c.rank                                        AS shown_rank,
  c.script_id                                   AS script,
  c.script_version                              AS script_version,
  (a.outcome = 'adopted')                       AS copied_to_clipboard,
  a.push_method                                 AS copy_method,
  c.release_id                                  AS library_version
FROM public.candidate_impressions c
JOIN public.query_events q ON q.query_id = c.query_id
LEFT JOIN public.app_users u ON u.user_id = q.user_id
LEFT JOIN public.adoption_events a
  ON a.query_id = c.query_id AND a.chosen_rank = c.rank AND a.chosen_script_id = c.script_id;

COMMENT ON VIEW public.vw_owner_shown_scripts IS
  '回答：每次提问给坐席看了哪几条话术，他抄了哪一条。一行=一次曝光。'
  'copied_to_clipboard=true 表示话术被复制进输入框，不是「已发送」——'
  '系统不掌握坐席最后发没发出去。';

-- The unmatched view deliberately has no candidate columns: no_hit means nothing was
-- shown, so there is no "compared against what" to display. The how-to states this
-- gap explicitly rather than letting an empty join look like missing data.
CREATE OR REPLACE VIEW public.vw_owner_unmatched_questions AS
SELECT
  q.created_at                                  AS asked_at,
  COALESCE(u.display_name, q.user_id)           AS agent,
  q.query_text_redacted                         AS question,
  q.release_id                                  AS library_version,
  q.platform                                    AS platform
FROM public.query_events q
LEFT JOIN public.app_users u ON u.user_id = q.user_id
WHERE q.hit_status = 'no_hit';

COMMENT ON VIEW public.vw_owner_unmatched_questions IS
  '回答：哪些提问在话术库里没找到。一行=一次未命中提问。'
  '未命中时系统不记录「比对过哪些候选」，所以这个视图只有提问，没有候选列——'
  '这是信息缺口，不是查询写漏了。';

CREATE OR REPLACE VIEW public.vw_owner_agent_daily AS
SELECT
  date_trunc('day', q.created_at)               AS day,
  COALESCE(u.display_name, q.user_id)           AS agent,
  count(*)                                      AS questions,
  count(*) FILTER (WHERE q.hit_status = 'hit')  AS matched,
  count(a.query_id)                             AS copied,
  round(
    count(a.query_id)::numeric / NULLIF(count(*)::numeric, 0),
    4
  )                                             AS copy_rate
FROM public.query_events q
LEFT JOIN public.app_users u ON u.user_id = q.user_id
LEFT JOIN public.adoption_events a
  ON a.query_id = q.query_id AND a.outcome = 'adopted'
GROUP BY 1, 2;

COMMENT ON VIEW public.vw_owner_agent_daily IS
  '回答：每个坐席每天问了多少、命中多少、抄了多少。一行=一个坐席的一天。'
  'copy_rate 是「抄/问」，不是「发送成功率」。当天没有提问的坐席不会出现在本视图。';

GRANT SELECT ON public.vw_owner_asked_questions,
                public.vw_owner_shown_scripts,
                public.vw_owner_unmatched_questions,
                public.vw_owner_agent_daily
  TO app_owner_read;

ALTER VIEW public.vw_owner_asked_questions    OWNER TO cs_ai_definer;
ALTER VIEW public.vw_owner_shown_scripts      OWNER TO cs_ai_definer;
ALTER VIEW public.vw_owner_unmatched_questions OWNER TO cs_ai_definer;
ALTER VIEW public.vw_owner_agent_daily        OWNER TO cs_ai_definer;

REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
