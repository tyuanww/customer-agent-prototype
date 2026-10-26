-- The overview API uses the runtime role. That role receives USAGE and EXECUTE here.
-- app_runtime already has SELECT on public.query_events from 0008. This migration
-- does not grant SELECT on ops_loop.inaccuracy_reports. The function stays owned
-- by cs_ai_definer.
SET LOCAL search_path = public, pg_catalog, pg_temp;

GRANT USAGE ON SCHEMA analytics TO app_runtime;
GRANT EXECUTE ON FUNCTION analytics.question_v1(timestamptz, timestamptz) TO app_runtime;
