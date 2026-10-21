-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0051_publish_source_set; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A missing domain rejects the whole call. Session role is not a gate.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION public.publish_content_release(
  p_import_batch_id TEXT,
  p_title TEXT,
  p_summary TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(release_id TEXT, release_seq BIGINT, announcement_id TEXT, source_binding_hash TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_release_id TEXT;
  v_seq BIGINT;
  v_ann TEXT;
  v_prev TEXT;
  v_base TEXT;
  v_expected_source_hash TEXT;
  v_source_hash TEXT;
  v_source_count INT;
  v_source_noncanonical BOOLEAN;
  v_source_suspended BOOLEAN;
  v_ok_count INT;
  v_publishable_upsert_count INT;
  v_quality_population_hash TEXT;
  v_batch_claimed INT;
  v_tenant TEXT;
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
    SELECT 1 FROM public.import_batch_source_bindings batch
    WHERE batch.import_batch_id = p_import_batch_id
      AND NOT EXISTS (
        SELECT 1
        FROM content_intake.authorization_sources(v_principal, 'publish', v_at) allowed
        JOIN content_intake.scopes scope ON scope.scope_id = allowed.scope_id
        WHERE scope.domain = batch.domain
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staging_scripts staged
    WHERE staged.import_batch_id = p_import_batch_id
      AND staged.category IN ('product', 'campaign')
      AND (
        coalesce(staged.title, '') LIKE '%过敏%'
        OR coalesce(staged.title, '') LIKE '%赔付%'
        OR coalesce(staged.answer_text, '') LIKE '%过敏%'
        OR coalesce(staged.answer_text, '') LIKE '%赔付%'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'product and campaign scripts refuse 过敏 and 赔付', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;

  PERFORM content_intake.guard_legacy_write(p_import_batch_id,NULL);
  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'publish single-flight lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  PERFORM pg_catalog.set_config('app.publishing', 'on', true);

  -- Atomic compare-and-set is the publish/cancel serialization point. If cancel wins first, this
  -- touches zero rows; if publish wins first, cancel waits on the row lock and then sees publishing.
  UPDATE public.import_batches
  SET status = 'publishing'
  WHERE import_batch_id = p_import_batch_id
    AND status = 'staged';
  GET DIAGNOSTICS v_batch_claimed = ROW_COUNT;
  IF v_batch_claimed <> 1 THEN
    IF NOT EXISTS (SELECT 1 FROM public.import_batches WHERE import_batch_id = p_import_batch_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'import_batch does not exist', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import_batch is not staged or is concurrently changing', DETAIL = 'CONFLICT';
  END IF;

  SELECT b.base_release_id, b.source_binding_hash, b.tenant_id
  INTO v_base, v_expected_source_hash, v_tenant
  FROM public.import_batches b
  WHERE b.import_batch_id = p_import_batch_id;

  SELECT c.current_release_id INTO v_prev
  FROM public.content_current c WHERE c.id = 1 FOR UPDATE;
  IF v_prev IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import was validated against a stale current release', DETAIL = 'SOURCE_BASE_RELEASE_STALE';
  END IF;

  IF EXISTS (SELECT 1 FROM public.content_releases previous
      WHERE previous.release_id = v_prev AND previous.tenant_id IS DISTINCT FROM v_tenant)
    OR EXISTS (SELECT 1 FROM public.staging_scripts staged JOIN public.scripts existing USING (script_id)
      WHERE staged.import_batch_id = p_import_batch_id AND existing.tenant_id IS DISTINCT FROM v_tenant)
    OR EXISTS (SELECT 1 FROM public.import_batch_source_bindings binding
      JOIN public.authoritative_source_versions source USING (source_version_id)
      WHERE binding.import_batch_id = p_import_batch_id AND source.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'publish tenant binding mismatch', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staging_scripts staged LEFT JOIN public.scripts existing USING (script_id)
      WHERE staged.import_batch_id = p_import_batch_id AND staged.review_mode = 'owner_acceptance'
        AND staged.script_version::bigint IS DISTINCT FROM coalesce(existing.version::bigint,0) + 1) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'approved version changed after import', DETAIL = 'OWNER_ACCEPTANCE_IMPORT_VERSION_MISMATCH';
  END IF;

  WITH prospective AS (
    SELECT ib.domain, ib.source_version_id
    FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id
    UNION ALL
    SELECT rb.domain, rb.source_version_id
    FROM public.release_source_bindings rb
    WHERE rb.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = rb.domain
      )
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
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release contains a reference-only source', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_source_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release contains a suspended source', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF v_source_hash IS DISTINCT FROM v_expected_source_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'prospective source set changed after enqueue', DETAIL = 'SOURCE_BINDING_HASH_MISMATCH';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id AND s.validation_ok IS NOT TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging has invalid rows', DETAIL = 'VALIDATION';
  END IF;

  SELECT COUNT(*) INTO v_ok_count FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok
    AND s.quality_status = 'clean'
    AND s.quality_gate_passed;
  IF v_ok_count IS NULL OR v_ok_count < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'no clean content passed the quality gate', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;
  SELECT pg_catalog.count(*)::INT INTO v_publishable_upsert_count
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok
    AND s.quality_status = 'clean'
    AND s.quality_gate_passed
    AND s.operation = 'upsert';
  v_quality_population_hash :=
    public.content_quality_staging_population_manifest_hash(p_import_batch_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.import_batches b
    WHERE b.import_batch_id = p_import_batch_id
      AND b.quality_gate_passed
      AND b.clean_count = v_ok_count
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'batch quality gate evidence is missing or stale', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.content_quality_review_plans plan
    JOIN public.content_quality_review_evidence evidence ON evidence.plan_id = plan.plan_id
    WHERE plan.import_batch_id = p_import_batch_id
      AND evidence.import_batch_id = p_import_batch_id
      AND plan.population_manifest_hash = v_quality_population_hash
      AND evidence.population_manifest_hash = v_quality_population_hash
      AND plan.clean_population_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM public.staging_scripts population
        WHERE population.import_batch_id = p_import_batch_id
          AND population.operation = 'upsert'
      )
      AND evidence.publishable_clean_count = v_publishable_upsert_count
      AND evidence.review_quarantined_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM public.staging_scripts quarantined
        WHERE quarantined.import_batch_id = p_import_batch_id
          AND quarantined.operation = 'upsert'
          AND quarantined.quality_status = 'quarantined'
      )
      AND evidence.conclusion = 'passed'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'frozen quality review evidence has not passed', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok
      AND s.quality_status = 'clean'
      AND s.quality_gate_passed
      AND s.operation = 'withdraw'
      AND NOT EXISTS (
        SELECT 1 FROM public.release_items ri
        WHERE ri.release_id = v_prev AND ri.script_id = s.script_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'withdraw target not in current release', DETAIL = 'VALIDATION';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok
      AND s.quality_status = 'clean'
      AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        s.search_document IS NULL
        OR s.search_fallback_text IS NULL
        OR (s.review_mode <> 'owner_acceptance' AND s.content_hash IS DISTINCT FROM
          public.content_governance_hash(
            s.script_id, s.category, s.title, s.answer_text, s.source_ref, s.source_version_id,
            s.owner_role, s.review_due_at, s.platform_scope, s.product_scope_type,
            s.product_scope_refs, s.effective_from, s.effective_to,
            s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict,
            s.review_mode, s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
            s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
            s.placeholder_keys, s.questions_json
          ))
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'upsert governance hash/search_document mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
  END IF;

  -- Register only the non-PII source indirection at the owner-controlled publish boundary. Ordinary
  -- workers cannot write this table or assert promotion/retirement evidence.
  PERFORM pg_catalog.set_config('app.semantic_asset_write', 'publish', true);
  INSERT INTO public.semantic_source_assets(
    source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version,
    source_query_id, promotion_review_ref, promoted_by_role, promoted_at,
    lifecycle, created_at
  )
  SELECT DISTINCT ON (question.value ->> 'source_asset_id')
    question.value ->> 'source_asset_id',
    question.value ->> 'source',
    question.value ->> 'origin_fingerprint',
    question.value ->> 'origin_fingerprint_key_version',
    question.value ->> 'source_query_id',
    question.value ->> 'promotion_review_ref',
    question.value ->> 'promoted_by_role',
    CASE WHEN question.value ->> 'promoted_at' IS NULL THEN NULL
      ELSE (question.value ->> 'promoted_at')::TIMESTAMPTZ END,
    'active',
    pg_catalog.clock_timestamp()
  FROM public.staging_scripts staged
  CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(staged.questions_json) question(value)
  WHERE staged.import_batch_id = p_import_batch_id
    AND staged.validation_ok AND staged.quality_status = 'clean'
    AND staged.quality_gate_passed AND staged.operation = 'upsert'
  ORDER BY question.value ->> 'source_asset_id', staged.script_id,
    question.value ->> 'question_id'
  ON CONFLICT (source_asset_id) DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts staged
    WHERE staged.import_batch_id = p_import_batch_id
      AND staged.validation_ok AND staged.quality_status = 'clean'
      AND staged.quality_gate_passed AND staged.operation = 'upsert'
      AND public.content_questions_source_assets_are_active(staged.questions_json) IS DISTINCT FROM TRUE
  ) OR EXISTS (
    SELECT 1
    FROM public.release_items prior
    WHERE prior.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings touched
        WHERE touched.import_batch_id = p_import_batch_id AND touched.domain = prior.category
      )
      AND public.content_questions_source_assets_are_active(prior.questions_json) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'prospective release uses missing, mismatched or retired semantic source asset', DETAIL = 'SEMANTIC_SOURCE_ASSET_NOT_ACTIVE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(s.questions_json) question(value)
    JOIN public.script_questions existing
      ON existing.question_id = question.value ->> 'question_id'
    JOIN public.semantic_source_assets existing_asset
      ON existing_asset.source_asset_id = existing.source_asset_id
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        existing.script_id IS DISTINCT FROM s.script_id
        OR existing.question_version > (question.value ->> 'question_version')::INTEGER
        OR (
          existing.question_version = (question.value ->> 'question_version')::INTEGER
          AND (
            existing.question_text IS DISTINCT FROM question.value ->> 'question_text'
            OR existing.question_hash IS DISTINCT FROM question.value ->> 'question_hash'
            OR existing.semantic_family_id IS DISTINCT FROM question.value ->> 'semantic_family_id'
            OR existing.origin_fingerprint IS DISTINCT FROM question.value ->> 'origin_fingerprint'
            OR existing.origin_fingerprint_key_version IS DISTINCT FROM question.value ->> 'origin_fingerprint_key_version'
            OR existing.source_asset_id IS DISTINCT FROM question.value ->> 'source_asset_id'
            OR existing.source IS DISTINCT FROM question.value ->> 'source'
            OR existing.intent_taxonomy_version IS DISTINCT FROM question.value ->> 'intent_taxonomy_version'
            OR existing.intent_id IS DISTINCT FROM question.value ->> 'intent_id'
            OR existing.source_query_id IS NOT NULL
            OR existing.promotion_review_ref IS DISTINCT FROM question.value ->> 'promotion_review_ref'
            OR existing.promoted_by_role IS DISTINCT FROM question.value ->> 'promoted_by_role'
            OR existing.promoted_at IS DISTINCT FROM CASE
              WHEN question.value ->> 'promoted_at' IS NULL THEN NULL
              ELSE (question.value ->> 'promoted_at')::TIMESTAMPTZ
            END
            OR existing.status IS DISTINCT FROM 'active'
            OR existing_asset.source_query_id IS DISTINCT FROM question.value ->> 'source_query_id'
            OR existing_asset.lifecycle IS DISTINCT FROM 'active'
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'stable question identity conflicts with published lineage', DETAIL = 'QUESTION_IDENTITY_CONFLICT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.staging_scripts s
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(s.questions_json) question(value)
    LEFT JOIN LATERAL (
      SELECT pg_catalog.max(existing.question_version) AS max_version
      FROM public.script_questions existing
      WHERE existing.question_id = question.value ->> 'question_id'
    ) lineage ON TRUE
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
      AND (
        (lineage.max_version IS NULL AND (question.value ->> 'question_version')::INTEGER <> 1)
        OR (
          lineage.max_version IS NOT NULL
          AND (question.value ->> 'question_version')::INTEGER > lineage.max_version
          AND (question.value ->> 'question_version')::INTEGER <> lineage.max_version + 1
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'question version must start at one and advance without gaps', DETAIL = 'QUESTION_VERSION_GAP';
  END IF;

  -- A bound domain is a complete snapshot. Archive every prior live row in touched domains first;
  -- staging upserts below republish only rows present in the approved replacement snapshot.
  UPDATE public.scripts sc
  SET status = 'archived', updated_at = now()
  WHERE sc.tenant_id = v_tenant AND EXISTS (
    SELECT 1 FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = sc.category
  );

  INSERT INTO public.scripts AS sc (
    script_id, category, title, answer_text, status, version, content_hash,
    source_ref, source_version_id, platform_scope, product_scope_type, product_scope_refs,
    campaign_tag, effective_from, effective_to,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    priority, owner_role, review_due_at, created_at, updated_at, published_at, tenant_id
  )
  SELECT
    s.script_id, s.category, s.title, s.answer_text, 'published', coalesce(s.script_version,1), s.content_hash,
    s.source_ref, s.source_version_id, s.platform_scope, s.product_scope_type, s.product_scope_refs,
    s.campaign_tag, s.effective_from, s.effective_to,
    s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode, s.owner_acceptance_record_sha256,
    s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
    s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
    s.placeholder_keys, s.questions_json,
    0, s.owner_role, s.review_due_at, now(), now(), now(), v_tenant
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'upsert'
  ON CONFLICT (script_id) DO UPDATE SET
    category = EXCLUDED.category,
    title = EXCLUDED.title,
    answer_text = EXCLUDED.answer_text,
    status = 'published',
    version = sc.version + 1,
    content_hash = EXCLUDED.content_hash,
    source_ref = EXCLUDED.source_ref,
    source_version_id = EXCLUDED.source_version_id,
    platform_scope = EXCLUDED.platform_scope,
    product_scope_type = EXCLUDED.product_scope_type,
    product_scope_refs = EXCLUDED.product_scope_refs,
    campaign_tag = EXCLUDED.campaign_tag,
    effective_from = EXCLUDED.effective_from,
    effective_to = EXCLUDED.effective_to,
    intent_taxonomy_version = EXCLUDED.intent_taxonomy_version,
    intent_id = EXCLUDED.intent_id,
    risk_level = EXCLUDED.risk_level,
    risk_categories = EXCLUDED.risk_categories,
    has_conflict = EXCLUDED.has_conflict,
    review_mode = EXCLUDED.review_mode,
    owner_acceptance_record_sha256 = EXCLUDED.owner_acceptance_record_sha256,
    primary_reviewer_id = EXCLUDED.primary_reviewer_id,
    primary_reviewer_role = EXCLUDED.primary_reviewer_role,
    primary_review_evd = EXCLUDED.primary_review_evd,
    secondary_reviewer_id = EXCLUDED.secondary_reviewer_id,
    secondary_reviewer_role = EXCLUDED.secondary_reviewer_role,
    secondary_review_evd = EXCLUDED.secondary_review_evd,
    placeholder_keys = EXCLUDED.placeholder_keys,
    questions_json = EXCLUDED.questions_json,
    owner_role = EXCLUDED.owner_role,
    review_due_at = EXCLUDED.review_due_at,
    updated_at = now(),
    published_at = now();

  -- Immutable question lineage projection. Existing (question_id,version) rows are never overwritten;
  -- a changed semantic/source/taxonomy mapping must arrive as the next version.
  INSERT INTO public.script_questions AS question (
    question_id, script_id, question_version, question_text, question_hash,
    semantic_family_id, origin_fingerprint, origin_fingerprint_key_version,
    source_asset_id, source, intent_taxonomy_version, intent_id, source_query_id,
    promotion_review_ref, promoted_by_role, promoted_at, status, created_at, updated_at
  )
  SELECT
    payload.question_id, s.script_id, payload.question_version, payload.question_text,
    payload.question_hash, payload.semantic_family_id, payload.origin_fingerprint,
    payload.origin_fingerprint_key_version, payload.source_asset_id, payload.source,
    payload.intent_taxonomy_version, payload.intent_id, NULL,
    payload.promotion_review_ref, payload.promoted_by_role, payload.promoted_at,
    'active', now(), now()
  FROM public.staging_scripts s
  CROSS JOIN LATERAL pg_catalog.jsonb_to_recordset(s.questions_json) AS payload(
    question_id TEXT,
    question_version INTEGER,
    question_text TEXT,
    question_hash TEXT,
    semantic_family_id TEXT,
    origin_fingerprint TEXT,
    origin_fingerprint_key_version TEXT,
    source_asset_id TEXT,
    source TEXT,
    intent_taxonomy_version TEXT,
    intent_id TEXT,
    source_query_id TEXT,
    promotion_review_ref TEXT,
    promoted_by_role TEXT,
    promoted_at TIMESTAMPTZ
  )
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'upsert'
  ON CONFLICT (question_id, question_version) DO NOTHING;

  -- Withdraw is an explicit tombstone: archive live material and exclude it from the new snapshot.
  UPDATE public.scripts sc
  SET status = 'archived', updated_at = now()
  FROM public.staging_scripts s
  WHERE s.import_batch_id = p_import_batch_id
    AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
    AND s.operation = 'withdraw'
    AND sc.script_id = s.script_id;

  v_seq := pg_catalog.nextval('public.content_release_seq'::pg_catalog.regclass);
  v_release_id := 'rel_' || v_seq::text;
  v_ann := 'ann_' || v_seq::text;

  UPDATE public.content_releases SET status = 'superseded' WHERE status = 'published';

  INSERT INTO public.content_releases(
    release_id, release_seq, title, summary, import_batch_id, rollback_of_release_id,
    status, source_binding_hash, published_by, published_by_role, published_at, tenant_id
  )
  VALUES (
    v_release_id, v_seq, p_title, p_summary, p_import_batch_id, NULL,
    'published', v_source_hash, p_actor_user_id, p_actor_role, now(), v_tenant
  );

  INSERT INTO public.release_source_bindings(release_id, domain, source_version_id, created_at)
  SELECT v_release_id, p.domain, p.source_version_id, now()
  FROM (
    SELECT ib.domain, ib.source_version_id
    FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id
    UNION ALL
    SELECT rb.domain, rb.source_version_id
    FROM public.release_source_bindings rb
    WHERE rb.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = rb.domain
      )
  ) p;

  -- MERGE by authoritative domain: prior rows from every touched domain are removed as one unit.
  INSERT INTO public.release_items(
    release_id, script_id, script_version, content_hash, answer_text, title, category,
    source_ref, source_version_id, owner_role, review_due_at,
    effective_from, effective_to, platform_scope, product_scope_type, product_scope_refs,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, x.script_id, x.script_version, x.content_hash, x.answer_text, x.title, x.category,
    x.source_ref, x.source_version_id, x.owner_role, x.review_due_at,
    x.effective_from, x.effective_to, x.platform_scope, x.product_scope_type, x.product_scope_refs,
    x.intent_taxonomy_version, x.intent_id, x.risk_level, x.risk_categories, x.has_conflict, x.review_mode, x.owner_acceptance_record_sha256,
    x.primary_reviewer_id, x.primary_reviewer_role, x.primary_review_evd,
    x.secondary_reviewer_id, x.secondary_reviewer_role, x.secondary_review_evd,
    x.placeholder_keys, x.questions_json,
    x.search_document, x.search_fallback_text
  FROM (
    SELECT
      s.script_id, sc.version AS script_version, s.content_hash, s.answer_text, s.title, s.category,
      s.source_ref, s.source_version_id, s.owner_role, s.review_due_at,
      s.effective_from, s.effective_to, s.platform_scope, s.product_scope_type, s.product_scope_refs,
      s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode, s.owner_acceptance_record_sha256,
      s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
      s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
      s.placeholder_keys, s.questions_json,
      s.search_document, s.search_fallback_text
    FROM public.staging_scripts s
    JOIN public.scripts sc ON sc.script_id = s.script_id
    WHERE s.import_batch_id = p_import_batch_id
      AND s.validation_ok AND s.quality_status = 'clean' AND s.quality_gate_passed
      AND s.operation = 'upsert'
    UNION ALL
    -- previous rows not mentioned by either upsert or withdraw remain
    SELECT
      ri.script_id, ri.script_version, ri.content_hash, ri.answer_text, ri.title, ri.category,
      ri.source_ref, ri.source_version_id, ri.owner_role, ri.review_due_at,
      ri.effective_from, ri.effective_to, ri.platform_scope, ri.product_scope_type, ri.product_scope_refs,
      ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode, ri.owner_acceptance_record_sha256,
      ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
      ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
      ri.placeholder_keys, ri.questions_json,
      ri.search_document, ri.search_fallback_text
    FROM public.release_items ri
    WHERE v_prev IS NOT NULL
      AND ri.release_id = v_prev
      AND NOT EXISTS (
        SELECT 1 FROM public.import_batch_source_bindings ib
        WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = ri.category
      )
  ) x;

  IF NOT public.owner_acceptance_release_content_ready(v_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  INSERT INTO public.content_current(id, current_release_id, updated_at)
  VALUES (1, v_release_id, now())
  ON CONFLICT (id) DO UPDATE SET current_release_id = EXCLUDED.current_release_id, updated_at = now();

  INSERT INTO public.announcements(announcement_id, release_id, title, summary, created_at)
  VALUES (v_ann, v_release_id, COALESCE(p_title, '话术库更新'), p_summary, now());

  UPDATE public.import_batches SET status = 'published', finished_at = now()
  WHERE import_batch_id = p_import_batch_id;

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_publish', p_actor_role, p_actor_user_id, 'publish_content_release',
    pg_catalog.jsonb_build_object(
      'release_id', v_release_id,
      'previous_release_id', v_prev,
      'import_batch_id', p_import_batch_id,
      'source_binding_hash', v_source_hash
    ),
    now()
  );

  PERFORM content_intake.inherit_legacy_catalog(v_prev,v_release_id);
  release_id := v_release_id;
  release_seq := v_seq;
  announcement_id := v_ann;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_content_release(
  p_target_release_id TEXT,
  p_title TEXT,
  p_summary TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(
  release_id TEXT,
  release_seq BIGINT,
  announcement_id TEXT,
  rollback_of_release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_current TEXT;
  v_release_id TEXT;
  v_seq BIGINT;
  v_ann TEXT;
  v_source_hash TEXT;
  v_stored_source_hash TEXT;
  v_source_count INT;
  v_source_noncanonical BOOLEAN;
  v_source_suspended BOOLEAN;
  v_tenant TEXT;
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
    SELECT 1 FROM public.release_source_bindings binding
    WHERE binding.release_id = p_target_release_id
      AND NOT EXISTS (
        SELECT 1
        FROM content_intake.authorization_sources(v_principal, 'rollback', v_at) allowed
        JOIN content_intake.scopes scope ON scope.scope_id = allowed.scope_id
        WHERE scope.domain = binding.domain
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_target_release_id IS NULL OR pg_catalog.btrim(p_target_release_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'target_release_id is required', DETAIL = 'VALIDATION';
  END IF;

  PERFORM content_intake.guard_legacy_write(NULL,p_target_release_id);
  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'publish single-flight lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  PERFORM pg_catalog.set_config('app.publishing', 'on', true);

  IF NOT EXISTS (
    SELECT 1 FROM public.content_releases cr WHERE cr.release_id = p_target_release_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'target release does not exist', DETAIL = 'NOT_FOUND';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.release_items ri WHERE ri.release_id = p_target_release_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'target release snapshot is empty', DETAIL = 'NOT_FOUND';
  END IF;

  SELECT target.tenant_id INTO v_tenant FROM public.content_releases target WHERE target.release_id = p_target_release_id;
  IF NOT public.owner_acceptance_release_content_ready(p_target_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  SELECT
    pg_catalog.count(*)::INT,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(rsb.domain || ':' || rsb.source_version_id, '|' ORDER BY rsb.domain),
      'UTF8'
    ), 'sha256'), 'hex'),
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE),
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE),
    pg_catalog.max(cr.source_binding_hash)
  INTO v_source_count, v_source_hash, v_source_noncanonical, v_source_suspended, v_stored_source_hash
  FROM public.content_releases cr
  JOIN public.release_source_bindings rsb ON rsb.release_id = cr.release_id
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = rsb.source_version_id AND asv.domain = rsb.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = rsb.source_version_id
  WHERE cr.release_id = p_target_release_id;
  IF v_source_count <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target has an incomplete source set', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF v_source_noncanonical THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target contains a reference-only source', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_source_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target contains a suspended source', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF v_source_hash IS DISTINCT FROM v_stored_source_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target source binding hash mismatch', DETAIL = 'SOURCE_BINDING_HASH_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.release_items ri
    WHERE ri.release_id = p_target_release_id
      AND ri.review_mode <> 'owner_acceptance'
      AND ri.content_hash IS DISTINCT FROM public.content_governance_hash(
        ri.script_id, ri.category, ri.title, ri.answer_text, ri.source_ref, ri.source_version_id,
        ri.owner_role, ri.review_due_at, ri.platform_scope, ri.product_scope_type,
        ri.product_scope_refs, ri.effective_from, ri.effective_to,
        ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict,
        ri.review_mode, ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
        ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
        ri.placeholder_keys, ri.questions_json
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'rollback target governance snapshot hash mismatch', DETAIL = 'GOVERNANCE_HASH_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.release_items item
    WHERE item.release_id = p_target_release_id
      AND public.content_questions_source_assets_are_active(item.questions_json) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback target uses retired semantic source asset', DETAIL = 'SEMANTIC_SOURCE_ASSET_NOT_ACTIVE';
  END IF;

  SELECT cc.current_release_id INTO v_current
  FROM public.content_current cc WHERE cc.id = 1 FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.content_releases current_release
      WHERE current_release.release_id = v_current AND current_release.tenant_id IS DISTINCT FROM v_tenant) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'rollback tenant binding mismatch', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;
  IF v_current IS NOT DISTINCT FROM p_target_release_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'target release is already current', DETAIL = 'CONFLICT';
  END IF;

  v_seq := pg_catalog.nextval('public.content_release_seq'::pg_catalog.regclass);
  v_release_id := 'rel_' || v_seq::text;
  v_ann := 'ann_' || v_seq::text;

  UPDATE public.content_releases SET status = 'superseded' WHERE status = 'published';
  INSERT INTO public.content_releases(
    release_id, release_seq, title, summary, import_batch_id, rollback_of_release_id,
    status, source_binding_hash, published_by, published_by_role, published_at, tenant_id
  ) VALUES (
    v_release_id,
    v_seq,
    COALESCE(NULLIF(p_title, ''), '回滚到 ' || p_target_release_id),
    p_summary,
    NULL,
    p_target_release_id,
    'published',
    v_source_hash,
    p_actor_user_id,
    p_actor_role,
    now(),
    v_tenant
  );

  INSERT INTO public.release_source_bindings(release_id, domain, source_version_id, created_at)
  SELECT v_release_id, rsb.domain, rsb.source_version_id, now()
  FROM public.release_source_bindings rsb
  WHERE rsb.release_id = p_target_release_id;

  INSERT INTO public.release_items(
    release_id, script_id, script_version, content_hash, answer_text, title, category,
    source_ref, source_version_id, owner_role, review_due_at,
    effective_from, effective_to, platform_scope, product_scope_type, product_scope_refs,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode, owner_acceptance_record_sha256,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, ri.script_id, ri.script_version, ri.content_hash, ri.answer_text,
    ri.title, ri.category, ri.source_ref, ri.source_version_id, ri.owner_role, ri.review_due_at,
    ri.effective_from, ri.effective_to, ri.platform_scope, ri.product_scope_type, ri.product_scope_refs,
    ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode, ri.owner_acceptance_record_sha256,
    ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
    ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
    ri.placeholder_keys,
    ri.questions_json, ri.search_document, ri.search_fallback_text
  FROM public.release_items ri
  WHERE ri.release_id = p_target_release_id;

  IF NOT public.owner_acceptance_release_content_ready(v_release_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release acceptance is not active or complete', DETAIL = 'OWNER_ACCEPTANCE_NOT_ACTIVE';
  END IF;

  INSERT INTO public.content_current(id, current_release_id, updated_at)
  VALUES (1, v_release_id, now())
  ON CONFLICT (id) DO UPDATE
    SET current_release_id = EXCLUDED.current_release_id, updated_at = now();

  INSERT INTO public.announcements(announcement_id, release_id, title, summary, created_at)
  VALUES (
    v_ann,
    v_release_id,
    COALESCE(NULLIF(p_title, ''), '话术库已回滚'),
    p_summary,
    now()
  );

  INSERT INTO public.change_audits(
    change_id, action, actor_role, actor_user_id, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'content_rollback', p_actor_role, p_actor_user_id, 'rollback_content_release',
    pg_catalog.jsonb_build_object(
      'release_id', v_release_id,
      'previous_release_id', v_current,
      'rollback_of_release_id', p_target_release_id,
      'source_binding_hash', v_source_hash
    ),
    now()
  );

  release_id := v_release_id;
  release_seq := v_seq;
  announcement_id := v_ann;
  rollback_of_release_id := p_target_release_id;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;

DROP FUNCTION public.resolve_previous_content_release(TEXT);
CREATE FUNCTION public.resolve_previous_content_release(p_actor_user_id TEXT)
RETURNS TABLE(release_id TEXT, release_seq BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_current_id TEXT;
  v_current_seq BIGINT;
  v_target TEXT;
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

  SELECT cc.current_release_id INTO v_current_id FROM public.content_current cc WHERE cc.id = 1;
  IF v_current_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'no current release', DETAIL = 'NOT_FOUND';
  END IF;
  SELECT cr.release_seq INTO v_current_seq
  FROM public.content_releases cr WHERE cr.release_id = v_current_id;
  IF v_current_seq IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'current release is missing from the release ledger', DETAIL = 'NOT_FOUND';
  END IF;
  SELECT cr.release_id INTO v_target
  FROM public.content_releases cr
  WHERE cr.release_seq < v_current_seq AND cr.status IN ('published', 'superseded')
  ORDER BY cr.release_seq DESC
  LIMIT 1;
  IF v_target IS NULL THEN
    RETURN;
  END IF;
  IF v_principal IS NULL OR EXISTS (
    SELECT 1 FROM public.release_source_bindings binding
    WHERE binding.release_id = v_target
      AND NOT EXISTS (
        SELECT 1
        FROM content_intake.authorization_sources(v_principal, 'rollback', v_at) allowed
        JOIN content_intake.scopes scope ON scope.scope_id = allowed.scope_id
        WHERE scope.domain = binding.domain
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = '没有权限，请找人开通。', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT cr.release_id, cr.release_seq
  FROM public.content_releases cr
  WHERE cr.release_id = v_target;
END;
$$;

ALTER FUNCTION public.resolve_previous_content_release(TEXT) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION public.resolve_previous_content_release(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_previous_content_release(TEXT) TO app_content_admin;
