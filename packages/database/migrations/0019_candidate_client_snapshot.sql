-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0019_candidate_client_snapshot; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534
-- source_git_sha=260ef224c5340a4d26e857bd02119044dd813f9a
-- source_schema_sha256=5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa
-- Product overlay (not a frozen contract snapshot slice).
--
-- R10: record which content release the CLIENT had loaded at search time.
--
-- Why this column exists: the desktop searches its local hydrate snapshot, and when
-- that snapshot is older than the server's current release the client's candidates
-- carry an old release. The server rewrites them to its own current release (that
-- rewrite is what keeps candidate_release_item_provenance_fk satisfiable), so after
-- the fact there was no way to tell a candidate the agent actually saw from one that
-- merely got relabelled. Drift was unidentifiable, which means the corpus would have
-- permanently contained mislabelled exposure rows.
--
-- With this column the drift is a query:
--   SELECT * FROM public.candidate_impressions
--   WHERE client_snapshot_release_id IS DISTINCT FROM release_id;
-- which is also how "which deleted/edited scripts are still being surfaced" gets
-- answered — the question this corpus most needs to answer.
--
-- Deliberately NOT a foreign key. The value is the client's stale release, which may
-- have been pruned from content_releases; an FK would reject exactly the rows worth
-- keeping. `release_id` keeps its own FKs unchanged and remains the authoritative
-- server-side release.
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER TABLE public.candidate_impressions
  ADD COLUMN IF NOT EXISTS client_snapshot_release_id TEXT;

-- Same shape as every other release id in this schema (rel_<seq>), and NULL is
-- allowed because the column was added after the table had rows and because an
-- older client may not report it yet.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.candidate_impressions'::pg_catalog.regclass
      AND conname = 'candidate_client_snapshot_shape'
  ) THEN
    ALTER TABLE public.candidate_impressions
      ADD CONSTRAINT candidate_client_snapshot_shape
      CHECK (client_snapshot_release_id IS NULL OR client_snapshot_release_id ~ '^rel_[0-9]+$');
  END IF;
END $$;

-- Serves the drift query above without scanning the whole table.
CREATE INDEX IF NOT EXISTS idx_candidate_client_snapshot_drift
  ON public.candidate_impressions (client_snapshot_release_id)
  WHERE client_snapshot_release_id IS DISTINCT FROM release_id;

COMMENT ON COLUMN public.candidate_impressions.client_snapshot_release_id IS
  '客户端上报时本机快照的 release。与 release_id 不同 = 坐席看到的是旧版本内容（漂移行）。'
  '不加外键：该版本可能已被清理，而这类行正是需要保留的证据。';

-- 0018 created vw_owner_shown_scripts without this column because the column did not
-- exist yet; a migration cannot reference a column a later one adds. Redefine the view
-- here so the drift is visible to the owner. Column list matches 0018 plus the two new
-- trailing columns, so this stays a superset rather than a silently narrowed view.
CREATE OR REPLACE VIEW public.vw_owner_shown_scripts AS
SELECT
  q.created_at                                  AS asked_at,
  COALESCE(u.display_name, q.user_id)           AS agent,
  c.rank                                        AS shown_rank,
  c.script_id                                   AS script,
  c.script_version                              AS script_version,
  (a.outcome = 'adopted')                       AS copied_to_clipboard,
  a.push_method                                 AS copy_method,
  c.release_id                                  AS library_version,
  -- The release the CLIENT had loaded. When it differs from library_version the agent
  -- was looking at an older snapshot than the server's current release, so this row is
  -- drift: the script may since have been edited or deleted.
  c.client_snapshot_release_id                  AS agent_snapshot_version,
  (c.client_snapshot_release_id IS DISTINCT FROM c.release_id) AS snapshot_was_stale
FROM public.candidate_impressions c
JOIN public.query_events q ON q.query_id = c.query_id
LEFT JOIN public.app_users u ON u.user_id = q.user_id
LEFT JOIN public.adoption_events a
  ON a.query_id = c.query_id AND a.chosen_rank = c.rank AND a.chosen_script_id = c.script_id;

COMMENT ON VIEW public.vw_owner_shown_scripts IS
  '回答：每次提问给坐席看了哪几条话术，他抄了哪一条。一行=一次曝光。'
  'copied_to_clipboard=true 表示话术被复制进输入框，不是「已发送」——'
  '系统不掌握坐席最后发没发出去。'
  'snapshot_was_stale=true 表示坐席用的是旧快照，他看到的内容可能已被改或被删；'
  '只看「坐席当时真正看到的」，加 WHERE NOT snapshot_was_stale。';

ALTER VIEW public.vw_owner_shown_scripts OWNER TO cs_ai_definer;
