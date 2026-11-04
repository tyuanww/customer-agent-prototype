-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0081_require_import_batch_principal; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- The accepted import entry points already resolve the actor to a content-intake
-- principal before insert. Make that boundary a database invariant so a privileged
-- direct insert cannot create a new batch without an explicit tenant identity.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION public.bind_import_batch_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant TEXT;
BEGIN
  BEGIN
    SELECT person.tenant_id INTO STRICT v_tenant
    FROM content_intake.principals person
    WHERE person.user_id = NEW.actor_user_id;
  EXCEPTION
    WHEN NO_DATA_FOUND OR TOO_MANY_ROWS THEN
      v_tenant := NULL;
  END;
  IF v_tenant IS NULL OR v_tenant = 'default' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA003',
      MESSAGE = 'import batch actor has no tenant-bound principal',
      DETAIL = 'TENANT_BINDING_REQUIRED';
  END IF;
  NEW.tenant_id := v_tenant;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bind_import_batch_tenant() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION public.bind_import_batch_tenant() FROM PUBLIC;
