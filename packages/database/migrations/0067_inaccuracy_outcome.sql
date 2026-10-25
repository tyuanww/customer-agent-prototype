-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0067_inaccuracy_outcome; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A closed inaccuracy todo can be compared only after the same span has passed
-- that was observed before the close. Seven days is the span that already opens
-- the todo. This function owns that span so a page cannot pick another one.
-- Counts stay null until the after-span is complete, so a short after-window
-- cannot be shown as a smaller number.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION ops_loop.list_resolved_inaccuracy_outcomes(p_actor_role TEXT)
RETURNS TABLE (
  script_id TEXT,
  resolved_at TIMESTAMPTZ,
  ready BOOLEAN,
  before_count INTEGER,
  after_count INTEGER,
  window_days INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_window INTERVAL := interval '7 days';
BEGIN
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('coach', 'owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'inaccuracy outcome role denied', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN QUERY
  WITH marked AS (
    SELECT substring(task.signal_id FROM 12) AS script_id, task.resolved_at
    FROM public.iteration_tasks AS task
    WHERE task.status = 'resolved'
      AND task.resolved_at IS NOT NULL
      AND task.signal_id LIKE 'inaccuracy:%'
      AND char_length(task.signal_id) > 11
      AND char_length(substring(task.signal_id FROM 12)) BETWEEN 1 AND 128
  ),
  latest AS (
    SELECT DISTINCT ON (marked.script_id) marked.script_id, marked.resolved_at
    FROM marked
    ORDER BY marked.script_id, marked.resolved_at DESC
  )
  SELECT
    latest.script_id,
    latest.resolved_at,
    pg_catalog.clock_timestamp() >= latest.resolved_at + v_window,
    CASE WHEN pg_catalog.clock_timestamp() >= latest.resolved_at + v_window THEN (
      SELECT count(*)::integer
      FROM ops_loop.inaccuracy_reports AS report
      WHERE report.script_id = latest.script_id
        AND report.created_at >= latest.resolved_at - v_window
        AND report.created_at < latest.resolved_at
    ) ELSE NULL END,
    CASE WHEN pg_catalog.clock_timestamp() >= latest.resolved_at + v_window THEN (
      SELECT count(*)::integer
      FROM ops_loop.inaccuracy_reports AS report
      WHERE report.script_id = latest.script_id
        AND report.created_at >= latest.resolved_at
        AND report.created_at < latest.resolved_at + v_window
    ) ELSE NULL END,
    7
  FROM latest
  ORDER BY latest.resolved_at DESC, latest.script_id;
END;
$$;

ALTER FUNCTION ops_loop.list_resolved_inaccuracy_outcomes(TEXT) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION ops_loop.list_resolved_inaccuracy_outcomes(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_loop.list_resolved_inaccuracy_outcomes(TEXT) TO app_runtime;
