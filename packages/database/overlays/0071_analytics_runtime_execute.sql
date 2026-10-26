-- The overview API uses the runtime role. That role may execute this function
-- and use the schema. It still cannot select the base tables.
-- The function stays owned by cs_ai_definer.
SET LOCAL search_path = public, pg_catalog, pg_temp;

GRANT USAGE ON SCHEMA analytics TO app_runtime;
GRANT EXECUTE ON FUNCTION analytics.question_v1(timestamptz, timestamptz) TO app_runtime;
