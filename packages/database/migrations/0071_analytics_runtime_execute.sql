-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0071_analytics_runtime_execute; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- The overview API uses the runtime role. That role may execute this function
-- and use the schema. It still cannot select the base tables.
-- The function stays owned by cs_ai_definer.
SET LOCAL search_path = public, pg_catalog, pg_temp;

GRANT USAGE ON SCHEMA analytics TO app_runtime;
GRANT EXECUTE ON FUNCTION analytics.question_v1(timestamptz, timestamptz) TO app_runtime;
