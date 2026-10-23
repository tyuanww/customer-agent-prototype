-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0063_store_set_keep_members_boundary; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- 0063_store_set_keep_members_boundary; product overlay (not a frozen contract snapshot slice)

SET LOCAL search_path = public, pg_catalog, pg_temp;

-- 0062 created the guard without settling its owner or its default ACL, so the function was
-- owned by the migration role and carried the implicit PUBLIC EXECUTE every new function gets.
-- The runtime boundary probe treats either condition as an unsafe schema and /ready stays 503,
-- which is what happened on deployment. Every other definer-owned function in this schema is
-- settled the same way: owner cs_ai_definer, PUBLIC revoked.
ALTER FUNCTION content_intake.store_set_keep_members() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.store_set_keep_members() FROM PUBLIC;
