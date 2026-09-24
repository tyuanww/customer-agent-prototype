-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0016_office_owner_publish; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.14.0-schema-1.18-260ef224c534
-- source_git_sha=260ef224c5340a4d26e857bd02119044dd813f9a
-- source_schema_sha256=5713f80e9abfd72592ad49955efb83cd8498ce9cd6c7be52b96c57bcde836caa
-- Product overlay (not a frozen contract snapshot slice).
-- Office owner publish: org-reviewed staging, snapshot revision, per-actor in-flight.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE TABLE IF NOT EXISTS public.source_snapshot_revisions (
  import_batch_id TEXT NOT NULL,
  source_version_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  previous_sha256 TEXT NOT NULL CHECK (previous_sha256 ~ '^[0-9a-f]{64}$'),
  new_sha256 TEXT NOT NULL CHECK (new_sha256 ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (import_batch_id, source_version_id)
);

DROP FUNCTION IF EXISTS public.advance_source_snapshots(JSONB, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.assert_no_in_flight_content_import();

CREATE OR REPLACE FUNCTION public.record_org_reviewed_quality_evidence(
  p_job TEXT,
  p_owner TEXT,
  p_lease BIGINT,
  p_batch TEXT,
  p_plan TEXT,
  p_rows JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan public.content_quality_review_plans%ROWTYPE;
  v_existing public.content_quality_review_evidence%ROWTYPE;
  v_clean INTEGER;
  v_quarantined INTEGER;
  v_ref TEXT := 'org-reviewed:feishu-doc';
BEGIN
  PERFORM 1 FROM public.outbox_jobs job
    WHERE job.job_id = p_job AND job.job_type = 'import_validate' AND job.status = 'running'
      AND job.payload->>'import_batch_id' = p_batch
      AND job.lease_owner = p_owner AND job.lease_version = p_lease
      AND job.lease_expires_at > clock_timestamp()
    FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
  SELECT plan.* INTO v_plan
  FROM public.content_quality_review_plans plan
  WHERE plan.plan_id = p_plan AND plan.import_batch_id = p_batch;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'quality review plan not found', DETAIL = 'NOT_FOUND';
  END IF;
  IF pg_catalog.jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging_rows must be a JSON array', DETAIL = 'VALIDATION';
  END IF;
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
        AND item.value ->> 'quality_status' = 'clean'
    )::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
        AND item.value ->> 'quality_status' = 'quarantined'
    )::INTEGER
  INTO v_clean, v_quarantined
  FROM pg_catalog.jsonb_array_elements(p_rows) AS item(value);

  INSERT INTO public.content_quality_review_evidence(
    plan_id, import_batch_id, population_manifest_hash,
    initial_sample_reviewed_count, initial_defect_count,
    expanded_sample_reviewed_count, expanded_defect_count,
    mandatory_reviewed_count, mandatory_defect_count,
    publishable_clean_count, review_quarantined_count,
    conclusion, evidence_ref, recorded_at
  ) VALUES (
    p_plan, p_batch, v_plan.population_manifest_hash,
    v_plan.initial_sample_target, 0,
    NULL, NULL,
    v_plan.mandatory_full_review_count, 0,
    v_clean, v_quarantined,
    'passed', v_ref, pg_catalog.clock_timestamp()
  ) ON CONFLICT DO NOTHING;

  SELECT evidence.* INTO v_existing
  FROM public.content_quality_review_evidence evidence
  WHERE evidence.plan_id = p_plan;
  IF NOT FOUND
     OR v_existing.conclusion IS DISTINCT FROM 'passed'
     OR v_existing.evidence_ref IS DISTINCT FROM v_ref
     OR v_existing.publishable_clean_count IS DISTINCT FROM v_clean
     OR v_existing.review_quarantined_count IS DISTINCT FROM v_quarantined THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'org-reviewed evidence replay mismatch', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_org_reviewed_import_validation(
  p_job TEXT,
  p_owner TEXT,
  p_lease BIGINT,
  p_batch TEXT,
  p_rows JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
  v_lead TEXT;
  v_qa TEXT;
  v_evd TEXT := 'org-reviewed:feishu-doc';
  v_population TEXT;
  v_persisted TEXT;
BEGIN
  PERFORM 1 FROM public.outbox_jobs job
    WHERE job.job_id = p_job AND job.job_type = 'import_validate' AND job.status = 'running'
      AND job.payload->>'import_batch_id' = p_batch
      AND job.lease_owner = p_owner AND job.lease_version = p_lease
      AND job.lease_expires_at > clock_timestamp()
    FOR UPDATE OF job;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
  IF pg_catalog.jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_rows) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staged import must contain at least one row', DETAIL = 'VALIDATION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_rows) AS item(value)
    WHERE item.value ?| ARRAY[
      'review_mode','primary_reviewer_id','primary_reviewer_role','primary_review_evd',
      'secondary_reviewer_id','secondary_reviewer_role','secondary_review_evd','quality_gate_passed'
    ]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'worker payload cannot self-assert review or quality decisions', DETAIL = 'REVIEW_EVIDENCE_TRUST_BOUNDARY';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.content_quality_review_plans plan
    JOIN public.content_quality_review_evidence evidence ON evidence.plan_id = plan.plan_id
    WHERE plan.import_batch_id = p_batch
      AND evidence.import_batch_id = p_batch
      AND evidence.conclusion = 'passed'
      AND evidence.evidence_ref = v_evd
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'frozen quality plan/evidence is missing, blocked or stale', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;

  v_lead := pg_catalog.encode(public.digest(pg_catalog.convert_to('org-reviewed:feishu-doc:lead:' || p_batch, 'UTF8'), 'sha256'), 'hex');
  v_qa := pg_catalog.encode(public.digest(pg_catalog.convert_to('org-reviewed:feishu-doc:qa:' || p_batch, 'UTF8'), 'sha256'), 'hex');
  v_population := public.content_quality_population_manifest_hash(p_rows);

  DELETE FROM public.staging_scripts WHERE import_batch_id = p_batch;

  INSERT INTO public.staging_scripts(
    staging_id, import_batch_id, script_id, operation, category, title, answer_text,
    content_hash, source_ref, source_version_id, owner_role, review_due_at,
    platform_scope, product_scope_type, product_scope_refs, campaign_tag, effective_from, effective_to,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd, placeholder_keys,
    questions_json, search_document, search_fallback_text, validation_ok, validation_errors,
    quality_status, quality_issue_codes, quality_gate_passed
  )
  SELECT
    r.staging_id,
    p_batch,
    r.script_id,
    coalesce(r.operation, 'upsert'),
    r.category,
    r.title,
    r.answer_text,
    r.content_hash,
    asv.source_ref,
    r.source_version_id,
    r.owner_role,
    r.review_due_at,
    r.platform_scope,
    r.product_scope_type,
    r.product_scope_refs,
    r.campaign_tag,
    r.effective_from,
    r.effective_to,
    r.intent_taxonomy_version,
    r.intent_id,
    r.risk_level,
    r.risk_categories,
    r.has_conflict,
    CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN 'dual' ELSE 'single' END,
    v_lead,
    'ROLE-CONTENT-LEAD',
    v_evd,
    CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN v_qa ELSE NULL END,
    CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN 'ROLE-CS-MANAGER' ELSE NULL END,
    CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN v_evd ELSE NULL END,
    r.placeholder_keys,
    coalesce(r.questions_json, '[]'::jsonb),
    pg_catalog.setweight(pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.questions_grams_text, '')), 'A')
      || pg_catalog.setweight(pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.title_grams_text, '')), 'B')
      || pg_catalog.setweight(pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.answer_grams_text, '')), 'C'),
    r.search_fallback_text,
    TRUE,
    NULL,
    coalesce(r.quality_status, 'clean'),
    coalesce(r.quality_issue_codes, '[]'::jsonb),
    coalesce(r.quality_status, 'clean') = 'clean'
  FROM pg_catalog.jsonb_to_recordset(p_rows) AS r(
    staging_id TEXT,
    script_id TEXT,
    operation TEXT,
    category TEXT,
    title TEXT,
    answer_text TEXT,
    content_hash TEXT,
    source_version_id TEXT,
    owner_role TEXT,
    review_due_at TIMESTAMPTZ,
    platform_scope TEXT[],
    product_scope_type TEXT,
    product_scope_refs TEXT[],
    campaign_tag TEXT,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    intent_taxonomy_version TEXT,
    intent_id TEXT,
    risk_level TEXT,
    risk_categories TEXT[],
    has_conflict BOOLEAN,
    placeholder_keys TEXT[],
    questions_json JSONB,
    questions_grams_text TEXT,
    title_grams_text TEXT,
    answer_grams_text TEXT,
    search_fallback_text TEXT,
    quality_status TEXT,
    quality_issue_codes JSONB
  )
  JOIN public.import_batch_source_bindings ib
    ON ib.import_batch_id = p_batch
   AND ib.domain = r.category
   AND ib.source_version_id = r.source_version_id
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = ib.source_version_id
   AND asv.domain = ib.domain;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> pg_catalog.jsonb_array_length(p_rows) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row count mismatch', DETAIL = 'VALIDATION';
  END IF;

  v_persisted := public.content_quality_staging_population_manifest_hash(p_batch);
  IF v_persisted IS DISTINCT FROM v_population THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'persisted staging population differs from the frozen quality population', DETAIL = 'QUALITY_POPULATION_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staging_scripts s
    WHERE s.import_batch_id = p_batch
      AND s.operation = 'upsert'
      AND s.content_hash IS DISTINCT FROM public.content_governance_hash(
        s.script_id, s.category, s.title, s.answer_text, s.source_ref, s.source_version_id,
        s.owner_role, s.review_due_at, s.platform_scope, s.product_scope_type,
        s.product_scope_refs, s.effective_from, s.effective_to,
        s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict,
        s.review_mode, s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
        s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
        s.placeholder_keys, s.questions_json
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging governance snapshot hash mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
  END IF;

  UPDATE public.import_batches
  SET status = 'staged',
      quality_gate_passed = TRUE,
      clean_count = (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_batch AND s.quality_status = 'clean'
      ),
      quarantined_count = (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_batch AND s.quality_status = 'quarantined'
      ),
      error_report = NULL,
      finished_at = now()
  WHERE import_batch_id = p_batch;

  UPDATE public.outbox_jobs
  SET status = 'done',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE job_id = p_job
    AND status = 'running'
    AND lease_owner = p_owner
    AND lease_version = p_lease
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost before atomic finalize', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.advance_source_snapshots(
  p_source_bindings JSONB,
  p_snapshot_sha256 TEXT,
  p_actor_role TEXT,
  p_import_batch_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INTEGER;
  v_count INTEGER;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'only owner may advance source snapshots', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_snapshot_sha256 IS NULL OR p_snapshot_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'snapshot sha256 is invalid', DETAIL = 'VALIDATION';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF pg_catalog.jsonb_typeof(p_source_bindings) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_source_bindings) < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source bindings are required', DETAIL = 'VALIDATION';
  END IF;
  INSERT INTO public.source_snapshot_revisions(
    import_batch_id, source_version_id, domain, previous_sha256, new_sha256
  )
  SELECT p_import_batch_id, asv.source_version_id, asv.domain, asv.snapshot_sha256, p_snapshot_sha256
  FROM pg_catalog.jsonb_to_recordset(p_source_bindings) AS requested(domain TEXT, source_version_id TEXT)
  JOIN public.authoritative_source_versions AS asv
    ON asv.source_version_id = requested.source_version_id
   AND asv.domain = requested.domain
   AND asv.use_class = 'canonical';

  SELECT pg_catalog.count(*)::INTEGER INTO v_count
  FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT);

  UPDATE public.authoritative_source_versions AS asv
  SET snapshot_sha256 = p_snapshot_sha256
  FROM pg_catalog.jsonb_to_recordset(p_source_bindings) AS requested(domain TEXT, source_version_id TEXT)
  WHERE asv.source_version_id = requested.source_version_id
    AND asv.domain = requested.domain
    AND asv.use_class = 'canonical';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'source version is not registered for runtime use', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_source_snapshots(p_import_batch_id TEXT) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  UPDATE public.authoritative_source_versions AS asv
  SET snapshot_sha256 = rev.previous_sha256
  FROM public.source_snapshot_revisions AS rev
  WHERE rev.import_batch_id = p_import_batch_id
    AND asv.source_version_id = rev.source_version_id
    AND asv.domain = rev.domain
    AND asv.snapshot_sha256 = rev.new_sha256;
  DELETE FROM public.source_snapshot_revisions WHERE import_batch_id = p_import_batch_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_restore_snapshots_on_import_failed() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'failed' AND OLD.status IN ('validating', 'staged') THEN
    PERFORM public.restore_source_snapshots(NEW.import_batch_id);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS import_batches_restore_snapshots ON public.import_batches;
CREATE TRIGGER import_batches_restore_snapshots
  AFTER UPDATE OF status ON public.import_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_restore_snapshots_on_import_failed();

CREATE OR REPLACE FUNCTION public.assert_no_in_flight_content_import(p_actor_user_id TEXT) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'actor_user_id is required', DETAIL = 'VALIDATION';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 19);
  IF EXISTS (
    SELECT 1 FROM public.import_batches
    WHERE status IN ('validating', 'staged')
      AND actor_user_id = p_actor_user_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'another import is already in flight', DETAIL = 'CONFLICT';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_actor_in_flight_imports(
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id TEXT;
  n INTEGER := 0;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner' AND p_actor_role IS DISTINCT FROM 'coach' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import cancel requires owner or originating coach', DETAIL = 'FORBIDDEN';
  END IF;
  FOR v_id IN
    SELECT import_batch_id FROM public.import_batches
    WHERE status IN ('validating', 'staged')
      AND actor_user_id = p_actor_user_id
  LOOP
    PERFORM public.cancel_content_import(v_id, 'in-flight-self', p_actor_user_id, p_actor_role);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.record_org_reviewed_quality_evidence(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_org_reviewed_import_validation(TEXT,TEXT,BIGINT,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.advance_source_snapshots(JSONB,TEXT,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_source_snapshots(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_no_in_flight_content_import(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_actor_in_flight_imports(TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_restore_snapshots_on_import_failed() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_org_reviewed_quality_evidence(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB) TO app_backend_worker;
GRANT EXECUTE ON FUNCTION public.finalize_org_reviewed_import_validation(TEXT,TEXT,BIGINT,TEXT,JSONB) TO app_backend_worker;
GRANT EXECUTE ON FUNCTION public.advance_source_snapshots(JSONB,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.assert_no_in_flight_content_import(TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_actor_in_flight_imports(TEXT,TEXT) TO app_runtime;

GRANT SELECT, INSERT, DELETE ON public.source_snapshot_revisions TO cs_ai_definer;
GRANT UPDATE (snapshot_sha256) ON public.authoritative_source_versions TO cs_ai_definer;

GRANT CREATE ON SCHEMA public TO cs_ai_definer;
ALTER FUNCTION public.record_org_reviewed_quality_evidence(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.finalize_org_reviewed_import_validation(TEXT,TEXT,BIGINT,TEXT,JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.advance_source_snapshots(JSONB,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.restore_source_snapshots(TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.assert_no_in_flight_content_import(TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.cancel_actor_in_flight_imports(TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_restore_snapshots_on_import_failed() OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;
