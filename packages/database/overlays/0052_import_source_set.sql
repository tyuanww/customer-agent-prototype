-- Import reads authorization_sources at one clock. One missing domain rejects
-- the batch and does not advance snapshots.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION enqueue_content_import(
  p_import_batch_id TEXT,
  p_source_type TEXT,
  p_source_ref TEXT,
  p_source_sha256 TEXT,
  p_source_size_bytes BIGINT,
  p_source_bindings JSONB,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(import_batch_id TEXT, status TEXT, job_id TEXT, source_binding_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job_id TEXT;
  v_base_release_id TEXT;
  v_source_count INT;
  v_source_hash TEXT;
  v_source_noncanonical BOOLEAN;
  v_source_suspended BOOLEAN;
  v_at TIMESTAMPTZ;
  v_principal TEXT;
BEGIN
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  v_at := pg_catalog.clock_timestamp();
  SELECT person.principal_id INTO v_principal
  FROM content_intake.principals person
  WHERE person.user_id = p_actor_user_id;
  IF v_principal IS NOT NULL AND EXISTS (
    SELECT 1
    FROM content_intake.principals person
    JOIN content_intake.principal_facts facts
      ON facts.principal_id = person.principal_id
     AND facts.facts_version = person.current_facts_version
    WHERE person.principal_id = v_principal
      AND facts.checked_at <= v_at
      AND facts.valid_until <= v_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '资料资格过期了，请稍后重试。', DETAIL = 'FORBIDDEN';
  END IF;
  IF v_principal IS NULL OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) AS requested(domain TEXT, source_version_id TEXT)
    WHERE NOT EXISTS (
      SELECT 1
      FROM content_intake.authorization_sources(v_principal, 'import', v_at) allowed
      JOIN content_intake.scopes scope ON scope.scope_id = allowed.scope_id
      WHERE scope.domain = requested.domain
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_type IS NULL OR p_source_type NOT IN ('excel','csv','feishu_api','seed','other') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid import source_type', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_ref IS NULL OR pg_catalog.btrim(p_source_ref) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source_ref must identify an already-persisted upload object', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_sha256 IS NULL OR p_source_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source_sha256 must be lowercase sha256 hex', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_size_bytes IS NULL OR p_source_size_bytes < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source_size_bytes must be nonnegative', DETAIL = 'VALIDATION';
  END IF;
  IF pg_catalog.jsonb_typeof(p_source_bindings) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_source_bindings) < 1
     OR pg_catalog.jsonb_array_length(p_source_bindings) > 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source_bindings must contain one to four domains', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_source_bindings) item(value)
    WHERE pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'object'
       OR NOT item.value ?& ARRAY['domain','source_version_id']
       OR item.value - ARRAY['domain','source_version_id'] <> '{}'::jsonb
       OR coalesce(item.value ->> 'domain', '') NOT IN ('presale','campaign','aftersale','product')
       OR coalesce(item.value ->> 'source_version_id', '') !~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source binding shape is invalid', DETAIL = 'SOURCE_DOMAIN_MISMATCH';
  END IF;
  IF (
    SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT item.value ->> 'domain')
    FROM pg_catalog.jsonb_array_elements(p_source_bindings) item(value)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source binding domains must be unique', DETAIL = 'SOURCE_DOMAIN_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT)
    LEFT JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = requested.source_version_id
    WHERE asv.source_version_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'source version is not registered for runtime use', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT)
    JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = requested.source_version_id
    WHERE asv.domain IS DISTINCT FROM requested.domain
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source version belongs to a different domain', DETAIL = 'SOURCE_DOMAIN_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT)
    JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = requested.source_version_id
    WHERE asv.use_class <> 'canonical'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'reference-only source cannot enter runtime content', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT)
    JOIN public.authoritative_source_suspensions susp
      ON susp.source_version_id = requested.source_version_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'suspended source cannot enter runtime content', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) requested(domain TEXT, source_version_id TEXT)
    JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = requested.source_version_id
    WHERE asv.snapshot_sha256 IS DISTINCT FROM p_source_sha256
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'uploaded snapshot does not match registered source version', DETAIL = 'SOURCE_SNAPSHOT_MISMATCH';
  END IF;

  SELECT cc.current_release_id INTO v_base_release_id
  FROM public.content_current cc WHERE cc.id = 1;
  WITH requested AS (
    SELECT x.domain, x.source_version_id
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) x(domain TEXT, source_version_id TEXT)
  ), prospective AS (
    SELECT requested.domain, requested.source_version_id FROM requested
    UNION ALL
    SELECT rb.domain, rb.source_version_id
    FROM public.release_source_bindings rb
    WHERE rb.release_id = v_base_release_id
      AND NOT EXISTS (SELECT 1 FROM requested WHERE requested.domain = rb.domain)
  )
  SELECT
    pg_catalog.count(*)::INT,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(p.domain || ':' || p.source_version_id, '|' ORDER BY p.domain),
      'UTF8'
    ), 'sha256'), 'hex'),
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE),
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE)
  INTO v_source_count, v_source_hash, v_source_noncanonical, v_source_suspended
  FROM prospective p
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = p.source_version_id AND asv.domain = p.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = p.source_version_id;
  IF v_source_count <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'prospective release requires exactly four source domains', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF v_source_noncanonical THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'inherited source is not canonical', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_source_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'inherited source is suspended and must be replaced', DETAIL = 'SOURCE_SUSPENDED';
  END IF;

  v_job_id := 'job_import_' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.import_batches(
    import_batch_id, source_type, source_ref, source_sha256, source_size_bytes,
    base_release_id, source_binding_hash, status, actor_user_id, actor_role, created_at, tenant_id
  ) VALUES (
    p_import_batch_id, p_source_type, p_source_ref, p_source_sha256, p_source_size_bytes,
    v_base_release_id, v_source_hash, 'validating', p_actor_user_id, p_actor_role, now(), 'default'
  );
  PERFORM pg_catalog.set_config('app.import_binding_write', 'on', true);
  INSERT INTO public.import_batch_source_bindings(import_batch_id, domain, source_version_id, created_at)
  SELECT p_import_batch_id, x.domain, x.source_version_id, now()
  FROM pg_catalog.jsonb_to_recordset(p_source_bindings) x(domain TEXT, source_version_id TEXT);
  INSERT INTO public.outbox_jobs(job_id, job_type, payload, status, created_at, updated_at)
  VALUES (
    v_job_id,
    'import_validate',
    pg_catalog.jsonb_build_object(
      'import_batch_id', p_import_batch_id,
      'source_ref', p_source_ref,
      'source_sha256', p_source_sha256,
      'source_size_bytes', p_source_size_bytes,
      'base_release_id', v_base_release_id,
      'source_binding_hash', v_source_hash,
      'source_bindings', p_source_bindings
    ),
    'pending',
    now(),
    now()
  );

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_import_enqueued', p_actor_role, p_actor_user_id, 'enqueue_content_import',
    pg_catalog.jsonb_build_object(
      'import_batch_id', p_import_batch_id,
      'base_release_id', v_base_release_id,
      'source_binding_hash', v_source_hash,
      'source_version_ids', (
        SELECT pg_catalog.jsonb_agg(x.source_version_id ORDER BY x.domain)
        FROM pg_catalog.jsonb_to_recordset(p_source_bindings) x(domain TEXT, source_version_id TEXT)
      )
    ),
    now()
  );

  import_batch_id := p_import_batch_id;
  status := 'validating';
  job_id := v_job_id;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;

DROP FUNCTION public.advance_source_snapshots(JSONB, TEXT, TEXT, TEXT);
CREATE FUNCTION public.advance_source_snapshots(
  p_source_bindings JSONB,
  p_snapshot_sha256 TEXT,
  p_actor_user_id TEXT,
  p_import_batch_id TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INTEGER;
  v_count INTEGER;
  v_at TIMESTAMPTZ;
  v_principal TEXT;
BEGIN
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  v_at := pg_catalog.clock_timestamp();
  SELECT person.principal_id INTO v_principal
  FROM content_intake.principals person
  WHERE person.user_id = p_actor_user_id;
  IF v_principal IS NOT NULL AND EXISTS (
    SELECT 1
    FROM content_intake.principals person
    JOIN content_intake.principal_facts facts
      ON facts.principal_id = person.principal_id
     AND facts.facts_version = person.current_facts_version
    WHERE person.principal_id = v_principal
      AND facts.checked_at <= v_at
      AND facts.valid_until <= v_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '资料资格过期了，请稍后重试。', DETAIL = 'FORBIDDEN';
  END IF;
  IF v_principal IS NULL OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_source_bindings) AS requested(domain TEXT, source_version_id TEXT)
    WHERE NOT EXISTS (
      SELECT 1
      FROM content_intake.authorization_sources(v_principal, 'import', v_at) allowed
      JOIN content_intake.scopes scope ON scope.scope_id = allowed.scope_id
      WHERE scope.domain = requested.domain
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
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

  PERFORM pg_catalog.set_config('customer_agent.source_snapshot_advance', 'on', TRUE);
  UPDATE public.authoritative_source_versions AS asv
  SET snapshot_sha256 = p_snapshot_sha256
  FROM pg_catalog.jsonb_to_recordset(p_source_bindings) AS requested(domain TEXT, source_version_id TEXT)
  WHERE asv.source_version_id = requested.source_version_id
    AND asv.domain = requested.domain
    AND asv.use_class = 'canonical';
  GET DIAGNOSTICS n = ROW_COUNT;
  PERFORM pg_catalog.set_config('customer_agent.source_snapshot_advance', 'off', TRUE);
  IF n IS DISTINCT FROM v_count THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'source version is not registered for runtime use', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.advance_source_snapshots(JSONB, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.advance_source_snapshots(JSONB, TEXT, TEXT, TEXT) TO app_runtime;
ALTER FUNCTION public.advance_source_snapshots(JSONB, TEXT, TEXT, TEXT) OWNER TO cs_ai_definer;
