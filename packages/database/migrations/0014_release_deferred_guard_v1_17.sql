-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0014_release_deferred_guard_v1_17; source schema.v1.17 lines 10726-10730
-- contract_set_id=cs-ai-c11-openapi-1.13.0-schema-1.17-0904a0aa11f2
-- source_git_sha=0904a0aa11f2dc29ae7700871a943c41295cd329
-- source_schema_sha256=419d84fbe827a5803b731250145e97786f6cb76c6d7aa9b3bc21bcac3c90f133
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER FUNCTION public.trg_release_source_set_complete() OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_release_source_set_complete() SECURITY DEFINER;
ALTER FUNCTION public.trg_release_source_set_complete() SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION public.trg_release_source_set_complete() FROM PUBLIC;
COMMENT ON SCHEMA public IS 'CS-AI-C11 schema.v1.17; synthetic backend development only; runtime activation and production NOT_CERTIFIED';
