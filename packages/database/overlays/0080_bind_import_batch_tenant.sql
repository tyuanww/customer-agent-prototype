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
