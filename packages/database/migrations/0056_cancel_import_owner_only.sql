-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0056_cancel_import_owner_only; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Cancelling a historical import batch is operator-only, matching the upload that creates it.
-- The binding role is read here, so the definer needs the columns 0054 already granted.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION cancel_content_import(
  p_import_batch_id TEXT,
  p_reason TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_batch public.import_batches%ROWTYPE;
  v_diagnostic_id TEXT;
  n INT;
BEGIN
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'actor_user_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF p_actor_role IS NULL OR pg_catalog.btrim(p_actor_role) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'actor_role is required', DETAIL = 'VALIDATION';
  END IF;
  SELECT * INTO v_batch
  FROM public.import_batches
  WHERE import_batch_id = p_import_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'import batch does not exist', DETAIL = 'NOT_FOUND';
  END IF;
  -- Cancelling mutates a batch, and upload has been operator-only since the batch chain was
  -- narrowed. Keep the two layers describing the same rule: a coach can no longer originate
  -- a batch, so the originating-coach branch was unreachable and is gone.
  IF NOT EXISTS (
    SELECT 1 FROM backend_identity.subject_bindings
    WHERE user_id = p_actor_user_id AND enabled AND role = 'owner'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
  UPDATE public.import_batches
  SET status = 'failed',
      error_report = pg_catalog.jsonb_build_object(
        'code', 'CANCELLED',
        'diagnostic_id', v_diagnostic_id
      ),
      finished_at = now()
  WHERE import_batch_id = p_import_batch_id
    AND status IN ('validating', 'staged');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = pg_catalog.format('import batch cannot be cancelled from %s', v_batch.status), DETAIL = 'CONFLICT';
  END IF;

  UPDATE public.outbox_jobs
  SET status = 'dead',
      lease_owner = NULL,
      lease_version = lease_version + 1,
      lease_expires_at = NULL,
      completed_at = now(),
      updated_at = now(),
      last_error = 'CANCELLED'
  WHERE job_type = 'import_validate'
    AND payload ->> 'import_batch_id' = p_import_batch_id
    AND status IN ('pending','running');

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_import_cancel', p_actor_role, p_actor_user_id, 'cancel_content_import',
    pg_catalog.jsonb_build_object(
      'import_batch_id', p_import_batch_id,
      'diagnostic_id', v_diagnostic_id,
      'reason', p_reason
    ),
    now()
  );
END;
$$;
