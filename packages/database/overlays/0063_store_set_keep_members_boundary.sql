-- 0063_store_set_keep_members_boundary; product overlay (not a frozen contract snapshot slice)

SET LOCAL search_path = public, pg_catalog, pg_temp;

-- 0062 created the guard without settling its owner or its default ACL, so the function was
-- owned by the migration role and carried the implicit PUBLIC EXECUTE every new function gets.
-- The runtime boundary probe treats either condition as an unsafe schema and /ready stays 503,
-- which is what happened on deployment. Every other definer-owned function in this schema is
-- settled the same way: owner cs_ai_definer, PUBLIC revoked.
ALTER FUNCTION content_intake.store_set_keep_members() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.store_set_keep_members() FROM PUBLIC;
