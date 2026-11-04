-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0080_bind_import_batch_tenant; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- The legacy enqueue function still emits the historical default tenant while its
-- authorization checks already use the actor's current content-intake principal.
-- Bind the batch to that principal so publish reads one tenant from batch, current
-- release, staged rows and source versions.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION public.bind_import_batch_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_tenant TEXT;
BEGIN
  SELECT person.tenant_id INTO v_tenant
  FROM content_intake.principals person
  WHERE person.user_id = NEW.actor_user_id;
  IF v_tenant IS NOT NULL THEN
    NEW.tenant_id := v_tenant;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.bind_import_batch_tenant() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION public.bind_import_batch_tenant() FROM PUBLIC;

CREATE TRIGGER bind_import_batch_tenant
BEFORE INSERT ON public.import_batches
FOR EACH ROW EXECUTE FUNCTION public.bind_import_batch_tenant();
