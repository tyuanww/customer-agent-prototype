-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0040_intake_repair_successor_v1_28; source Approved schema.v1.28 repair successor
-- contract_set_id=cs-ai-c11-openapi-1.24.0-schema-1.28-379b793811ed
-- source_git_sha=379b793811edf48bd64f512f5733790b9fdeeb0d
-- source_schema_sha256=c676b8a580e51f6a0cc2ce0b25919fb9aec2b5e470076461131ea233972e6c69
SET LOCAL search_path = public, pg_catalog, pg_temp;

DO $installation$ BEGIN
    IF (SELECT count(*) FROM customer_agent_meta.schema_migrations) <> 39 OR EXISTS (
      SELECT 1 FROM (VALUES (1,'0001_extensions','4876b7ef62bb033b4b7b487e06e88a525b9cb8b3e32e82e6516124b7fc8eca62'),
(2,'0002_identity_and_content','62322728f1621c75b2cc0f66ac20e65710a916c714caa84761a93108b71e1b64'),
(3,'0003_events_and_metrics','c109b3c7ec79c73cb6e3748808aca9296ed1c96e5d8fc91ab0046c80fd2b50d4'),
(4,'0004_import_release_announce','ff68d5969e28a9d4d7eed963906f2fc3783f4c34b5ec1fa347ea87c3bc0b2f6a'),
(5,'0005_idempotency_rate_limit_outbox','715db39163e2a99d10a88126a4bded14c75f4fb4ba1ec97dcba573265babdf02'),
(6,'0006_definer_functions_and_triggers','f5b369165b5e5f0e21801f8fd8eb2c4589ee26ca0761327811f4ed5c5903d4ca'),
(7,'0007_search_bigram','7cf632ec4123b9031893646b0b67348cf5a89dd3fe89ec544dccecb576513189'),
(8,'0008_runtime_acl','f883a929a8742e0f71a498e70de410124e8c25fd2fdee6a492047201475990f2'),
(9,'0009_phase1_policy_seed','a6ae5649347ad56f78cede6f8c34a69ebe4ceff6ea91be92da2d261999088e7e'),
(10,'0010_search_projection_v1_13','026497120b6ad6d7d885de47d54335bb8891d8b45e2da010cc85eae6ea7b6818'),
(11,'0011_search_no_hit_context_v1_14','8f5337b69b1a10fb85013694699e683c99e14399fa3471bd970eb89ac8591a0f'),
(12,'0012_owner_acceptance_v1_15','3bc06f81ed596049e0539a679e066b7a6c2d1814314c3d2ba9fd4d65f469be18'),
(13,'0013_backend_identity_content_v1_16','8794d2e32117d8949a7ccd8c38ac91d04852b406be7e30825ff8fb364925eee2'),
(14,'0014_release_deferred_guard_v1_17','ee7615d9ca7b05b01f66646393fbf26f1757a882b027a3fd6be415872a269339'),
(15,'0015_ops_loop_v1_18','e7ac1d9c5f487336b63ed4a8abeb66031dbcd3189286fbd2d07b97407685613b'),
(16,'0016_office_owner_publish','d574ebd891e3a7db771e6f6a5fb7a85f6e6d3614c7880f2dea4b4bb642d6b447'),
(17,'0017_rollback_previous_target','eb3ccbf3f04c4005393fc757b8f1e03d55a5078837b2b8eb9dbac72d83116788'),
(18,'0018_owner_read_views','c89d76992850aa562a3d24618bccb39a941a8bc88136342505a9edea5440acba'),
(19,'0019_candidate_client_snapshot','e4720feabd0a9b92d8d5cc22fcb6dcce75cf6e8136c0b2d9365d0d7c1cf18cd7'),
(20,'0020_coach_publish_v1_19','fd261530461c20aca90c5468997a695d67921fe53ff74b39de2c0a5f6b80d678'),
(21,'0021_content_intake_v1_20','7c19bf3f97fecb5af61c92131c0ce2a5f5f42822d2e104bb4202d96e292c73db'),
(22,'0022_intake_legacy_fence','8df4f9127362aa49c320b87d7afffd910312d54fab7193224e3bece5993a8b03'),
(23,'0023_intake_quality','c3b37131c28b76b2453e24d5f432e70329c478a7f90d34c95598518124e50136'),
(24,'0024_intake_publication','9b3b1d0ae32f0fc6e0f333428ac52c2e688c57aad1e610bbb6bb7c94e4d13af2'),
(25,'0025_intake_usage_v1_21','f270f787323a65baf3727337dcc34c1ff3f7a0bac0baf79a1894a7f7ae9591f4'),
(26,'0026_intake_discovery_index','c96e289e3ae19d600913b80796f3051eb7c19c5f544e1b8b9e17d5f5f1cd911f'),
(27,'0027_intake_rollback','da90dd3eaa366037fbbe71f4296697fdf3f9f788954119731926e6500df55e98'),
(28,'0028_intake_family','8b241e1b5f808c2278b53351a0d3cbee56f4ac23ca16c65736ba45ace859382e'),
(29,'0029_intake_capacity','9d56a3ea4b56d5ec1ccbef5bc331c12f5f788da725a2d09030f2ccbe9e2f00ab'),
(30,'0030_intake_role_ceiling','8843955f79d970bdc5f03469a7bba316c2f1fb8fa070d2b0f61ba9bc1f5144a3'),
(31,'0031_intake_direct_v1_22','82407ae1c0ce3a3dc975b9b5fe76012b5ab4f19ee5952dafb912a23509c4dcc0'),
(32,'0032_intake_direct_publication','38e72eb66941256861aeb3edddc609cdbbfbc4e1eed56366b370526ad82cbddc'),
(33,'0033_intake_runtime_v1_23','0cbc24c3f6ffbe877c6cd5f3f55fdf71a9af67aac069e04c4544bde74f463e1b'),
(34,'0034_intake_csv_v1_24','2f2e8963c461b0a3d720d5dbc42734851779a073bf71b07bc37d0c335416f31a'),
(35,'0035_intake_legacy_check_acl_v1_25','01a674d1f5a996a511babf193c28c217ec91a72a3f974922e9580cf2bcdabda7'),
(36,'0036_intake_sop_v1_26','1fc9f95dc3c14d743f52515195cf9597820826cf57c2f3c2cfea9bc19746f84d'),
(37,'0037_menokin_source_registration','93fc05c58af3001deb9fa4ce3645b6e3b2a784b220fec9db599fec2becfd8608'),
(38,'0038_menokin_sop_domain_v1_27','1ffdd633c2214eac2dc3ba306d7c905f68e95f7258d6f8cc250db72d85712a5b'),
(39,'0039_menokin_sop_stage_media','637fdbb4f96457361f17e6262eb69c4ae645f5b6745b08353474caad2696aba8')) AS expected(position,id,hash)
      LEFT JOIN customer_agent_meta.schema_migrations actual ON actual.position=expected.position
      WHERE actual.migration_id IS DISTINCT FROM expected.id OR actual.migration_sha256 IS DISTINCT FROM expected.hash
    ) THEN RAISE EXCEPTION 'REPAIR_PREDECESSOR_RECEIPTS_MISMATCH'; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='intake_runtime_fn_owner' AND NOT rolcanlogin AND NOT rolsuper)
      OR to_regrole('intake_business') IS NULL THEN RAISE EXCEPTION 'REPAIR_ROLE_BOUNDARY_MISMATCH'; END IF;
  END $installation$;
-- DRAFT successor. Requires caller-owned transaction over the verified 0039 predecessor.
SELECT backend_review.lock_content();
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
-- GENERATED DRAFT proposal. NOT FROZEN / NOT EXPORTED / NOT INTAKE.
-- No version or migration number assigned. Requires a caller-owned transaction.
-- Existing function ownership, ACL and API idempotency remain unchanged.
-- Current HTTP is owner-only; the approved SQL coach scope is preserved.
-- Does not install prerequisites or authorize a production consumer.
DO $candidate_precondition$
BEGIN
  IF to_regprocedure('content_intake.guard_legacy_write(text,text)') IS NULL
    OR to_regprocedure('content_intake.inherit_legacy_catalog(text,text)') IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc
      WHERE oid=to_regprocedure('public.publish_content_release(text,text,text,text,text)')
        AND encode(public.digest(prosrc,'sha256'),'hex')='34b6769855bd1aa3ea251589f324e6e743d2df00328d5b707bb54ba736b21d46'
    ) THEN
    RAISE EXCEPTION 'PUBLICATION_COMPATIBILITY_PREDECESSOR_MISMATCH';
  END IF;
END;
$candidate_precondition$;

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
BEGIN
  -- p_actor_role is a server-verified end-user claim used for policy/audit. DB ACL authenticates
  -- the isolated app_content_admin workload identity; the API must select that pool only after
  -- verified owner or in-scope coach authorization. The parameter itself is not independent database authentication.
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'publish requires an actor', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_actor_role = 'coach' THEN
    IF EXISTS (
      SELECT 1 FROM public.import_batch_source_bindings ib
      WHERE ib.import_batch_id = p_import_batch_id
        AND ib.domain NOT IN ('product', 'campaign')
    ) OR EXISTS (
      SELECT 1 FROM public.staging_scripts s
      WHERE s.import_batch_id = p_import_batch_id
        AND (
          s.category NOT IN ('product', 'campaign')
          OR coalesce(s.title, '') LIKE '%过敏%'
          OR coalesce(s.title, '') LIKE '%赔付%'
          OR coalesce(s.answer_text, '') LIKE '%过敏%'
          OR coalesce(s.answer_text, '') LIKE '%赔付%'
        )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'coach publish is limited to product and campaign without 过敏/赔付', DETAIL = 'FORBIDDEN';
    END IF;
  ELSIF p_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'publish requires owner or in-scope coach', DETAIL = 'FORBIDDEN';
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

  -- Upsert live scripts from staging upserts only.
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
    -- upsert wins
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

-- GENERATED DRAFT. Caller must own the installation transaction. No official migration number.
DO $precondition$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('content_intake.delete_unused_sop_row(content_intake.identifier,content_intake.version,text)')
    AND encode(public.digest(prosrc,'sha256'),'hex')='0404eca142184b7d7a5c981db424f103abca30c85ad48a4c580a50fb110e2950') THEN
    RAISE EXCEPTION 'SOP_ROW_DELETION_PREDECESSOR_MISMATCH';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=to_regprocedure('content_intake.stage_sop_candidate_media(content_intake.identifier,content_intake.version,content_intake.identifier,content_intake.identifier,content_intake.identifier,content_intake.sha256,bigint,text,text,integer,integer,integer)')
    AND encode(public.digest(prosrc,'sha256'),'hex')='8dd25e3e17ffe8d18f4568eccfc48c052cfb7e65e14009d6a0e411d00d99bb79') THEN
    RAISE EXCEPTION 'SOP_STAGE_PREDECESSOR_MISMATCH';
  END IF;
END;
$precondition$;

-- DRAFT successor only: exact row identity and private charged payloads.
DO $media_precondition$
DECLARE k record; actual text;
BEGIN
  FOR k IN SELECT * FROM (VALUES
    ('content_intake.objects','objects_purpose_check','CHECK ((purpose = ANY (ARRAY[''input''::text, ''report''::text, ''review-package''::text])))'),
    ('content_intake.object_reservations','object_reservations_purpose_check','CHECK ((purpose = ANY (ARRAY[''input''::text, ''report''::text, ''review-package''::text])))'),
    ('content_intake.objects','objects_mime_check','CHECK ((mime = ANY (ARRAY[''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''::text, ''text/csv''::text, ''application/pdf''::text, ''application/json''::text])))'),
    ('content_intake.objects','objects_input_format_check','CHECK ((((purpose = ''input''::text) AND (bytes <= 10485760) AND (mime = ANY (ARRAY[''application/vnd.openxmlformats-officedocument.spreadsheetml.sheet''::text, ''text/csv''::text]))) OR ((purpose <> ''input''::text) AND (mime <> ''text/csv''::text))))'),
    ('content_intake.sop_candidate_media','sop_candidate_media_pkey','PRIMARY KEY (candidate_id, candidate_version, media_object_id, ordinal)'),
    ('content_intake.sop_release_media','sop_release_media_pkey','PRIMARY KEY (release_id, media_object_id, ordinal)')
  ) AS expected(tbl,name,definition) LOOP
    SELECT pg_get_constraintdef(oid) INTO actual FROM pg_constraint WHERE conrelid=to_regclass(k.tbl) AND conname=k.name;
    IF actual IS DISTINCT FROM k.definition THEN RAISE EXCEPTION 'SOP_MEDIA_PREDECESSOR_MISMATCH: %',k.name; END IF;
  END LOOP;
END $media_precondition$;
ALTER TABLE content_intake.sop_candidate_media DROP CONSTRAINT sop_candidate_media_pkey;
ALTER TABLE content_intake.sop_candidate_media ADD PRIMARY KEY(candidate_id,candidate_version,row_id,media_object_id,ordinal);
ALTER TABLE content_intake.sop_release_media DROP CONSTRAINT sop_release_media_pkey;
ALTER TABLE content_intake.sop_release_media ADD PRIMARY KEY(release_id,row_id,media_object_id,ordinal);
ALTER TABLE content_intake.objects DROP CONSTRAINT objects_purpose_check, DROP CONSTRAINT objects_mime_check, DROP CONSTRAINT objects_input_format_check;
ALTER TABLE content_intake.objects ADD CONSTRAINT objects_purpose_check CHECK(purpose IN ('input','report','review-package','sop-media')),
  ADD CONSTRAINT objects_mime_check CHECK(mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/pdf','application/json','image/png','image/jpeg','image/gif')),
  ADD CONSTRAINT objects_input_format_check CHECK(
    (purpose='input' AND bytes<=10485760 AND mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'))
    OR (purpose IN ('report','review-package') AND mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/json'))
    OR (purpose='sop-media' AND bytes<=5242880 AND mime IN ('image/png','image/jpeg','image/gif'))),
  ADD CONSTRAINT objects_sop_payload_identity UNIQUE(object_id,source_id,sha256,bytes,mime,purpose);
ALTER TABLE content_intake.object_reservations DROP CONSTRAINT object_reservations_purpose_check;
ALTER TABLE content_intake.object_reservations ADD CONSTRAINT object_reservations_purpose_check CHECK(purpose IN ('input','report','review-package','sop-media'));
ALTER TABLE content_intake.sop_media_objects ADD COLUMN payload_object_id content_intake.identifier,
  ADD COLUMN payload_purpose text NOT NULL DEFAULT 'sop-media' CHECK(payload_purpose='sop-media'),
  ADD CONSTRAINT sop_payload_exact FOREIGN KEY(payload_object_id,source_id,sha256,bytes,mime,payload_purpose)
    REFERENCES content_intake.objects(object_id,source_id,sha256,bytes,mime,purpose);
-- Existing missing payloads stay unknown; only new trusted freeze can create full rows.
CREATE TABLE content_intake.sop_payload_bindings (
  job_id content_intake.identifier NOT NULL REFERENCES content_intake.parse_jobs,
  media_object_id content_intake.identifier NOT NULL CHECK(media_object_id ~ '^med_[0-9a-f]{64}$'),
  object_id text NOT NULL REFERENCES content_intake.object_reservations,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  sha256 content_intake.sha256 NOT NULL,
  bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 5242880),
  mime text NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/gif')),
  PRIMARY KEY(job_id,media_object_id)
);
ALTER TABLE content_intake.sop_payload_bindings OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_payload_bindings FROM PUBLIC;
GRANT SELECT,INSERT ON content_intake.objects TO intake_runtime_fn_owner;
GRANT SELECT,INSERT,UPDATE ON content_intake.object_reservations TO intake_runtime_fn_owner;
GRANT SELECT ON content_intake.entitlement_scopes TO intake_runtime_fn_owner;

-- One internal state machine; four public capabilities fix their action, avoiding
-- a caller-controlled generic mutation API. File exclusivity belongs to the store.
CREATE FUNCTION content_intake.sop_payload_transition(p_actor text,p_job text,p_media text,p_object text,p_action text,p_expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; s content_intake.sources; a content_intake.principals;
  b content_intake.sop_payload_bindings; r content_intake.object_reservations; v_object text; v_used bigint;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO j FROM content_intake.parse_jobs WHERE job_id=p_job;
  IF NOT FOUND OR j.actor_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT * INTO STRICT s FROM content_intake.sources WHERE source_id=j.source_id;
  SELECT * INTO STRICT a FROM content_intake.principals WHERE principal_id=p_actor;
  IF p_action IN ('reserve','complete') AND (j.state NOT IN ('reading','parsing','validated')
    OR s.mode<>'v2-preview' OR s.current_mapping_version<>j.source_version
    OR content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp()) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT * INTO b FROM content_intake.sop_payload_bindings WHERE job_id=p_job AND media_object_id=p_media;
  IF p_action='reserve' THEN
    IF p_media IS NULL OR p_media !~ '^med_[0-9a-f]{64}$' OR jsonb_typeof(p_expected) IS DISTINCT FROM 'object'
      OR p_expected-ARRAY['sha256','bytes','mime']<>'{}'::jsonb OR NOT p_expected ?& ARRAY['sha256','bytes','mime']
      OR coalesce(p_expected->>'sha256','') !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_expected->'bytes') IS DISTINCT FROM 'number'
      OR coalesce(p_expected->>'bytes','') !~ '^[1-9][0-9]{0,6}$' OR (p_expected->>'bytes')::bigint>5242880
      OR coalesce(p_expected->>'mime','') NOT IN ('image/png','image/jpeg','image/gif') THEN
      RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
    IF b.job_id IS NOT NULL THEN
      IF b.actor_id<>p_actor OR b.source_id<>j.source_id OR b.sha256<>p_expected->>'sha256'
        OR b.bytes<>(p_expected->>'bytes')::bigint OR b.mime<>p_expected->>'mime' THEN
        RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    ELSE
      SELECT o.payload_object_id INTO v_object FROM content_intake.sop_media_objects o JOIN content_intake.objects payload ON payload.object_id=o.payload_object_id
        JOIN content_intake.object_reservations reservation ON reservation.object_id=payload.object_id AND reservation.state='adopted'
        WHERE o.media_object_id=p_media AND o.source_id=j.source_id AND o.sha256=p_expected->>'sha256'
          AND o.bytes=(p_expected->>'bytes')::bigint AND o.mime=p_expected->>'mime' AND payload.purpose='sop-media';
      IF v_object IS NULL THEN
        SELECT (SELECT coalesce(sum(bytes),0) FROM content_intake.objects WHERE tenant_id=a.tenant_id)+
          (SELECT coalesce(sum(reserved_bytes),0) FROM content_intake.object_reservations WHERE tenant_id=a.tenant_id AND state IN ('reserved','persisted','releasing')) INTO v_used;
        IF v_used+(p_expected->>'bytes')::bigint>1073741824 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='QUOTA_EXCEEDED'; END IF;
        v_object:='obj_'||encode(public.gen_random_bytes(32),'hex');
        INSERT INTO content_intake.object_reservations(object_id,tenant_id,app_id,actor_id,source_id,purpose,reserved_bytes,state)
          VALUES(v_object,a.tenant_id,a.app_id,p_actor,j.source_id,'sop-media',(p_expected->>'bytes')::bigint,'reserved');
      END IF;
      INSERT INTO content_intake.sop_payload_bindings VALUES(p_job,p_media,v_object,j.source_id,p_actor,p_expected->>'sha256',(p_expected->>'bytes')::bigint,p_expected->>'mime') RETURNING * INTO b;
    END IF;
  ELSIF b.job_id IS NULL OR b.actor_id<>p_actor OR b.source_id<>j.source_id OR b.object_id IS DISTINCT FROM p_object THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  SELECT * INTO STRICT r FROM content_intake.object_reservations WHERE object_id=b.object_id FOR UPDATE;
  IF r.purpose<>'sop-media' OR r.source_id<>j.source_id OR r.tenant_id<>a.tenant_id OR r.app_id<>a.app_id THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF p_action='complete' THEN
    IF r.state NOT IN ('reserved','persisted','adopted') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    UPDATE content_intake.object_reservations SET state='persisted',actual_bytes=b.bytes,sha256=b.sha256,updated_at=clock_timestamp()
      WHERE object_id=r.object_id AND state='reserved' RETURNING * INTO r;
    IF NOT FOUND THEN SELECT * INTO STRICT r FROM content_intake.object_reservations WHERE object_id=b.object_id; END IF;
  ELSIF p_action IN ('begin-release','complete-release') THEN
    -- Clean only this original reservation. Reused adopted payloads are never freed.
    IF r.actor_id=p_actor AND NOT EXISTS(SELECT 1 FROM content_intake.objects WHERE object_id=r.object_id)
      AND NOT EXISTS(SELECT 1 FROM content_intake.sop_media_objects WHERE payload_object_id=r.object_id) THEN
      IF p_action='begin-release' AND r.state IN ('reserved','persisted','releasing') THEN
        UPDATE content_intake.object_reservations SET state='releasing',updated_at=clock_timestamp() WHERE object_id=r.object_id RETURNING * INTO r;
      ELSIF p_action='complete-release' AND r.state='releasing' THEN
        UPDATE content_intake.object_reservations SET state='released',updated_at=clock_timestamp() WHERE object_id=r.object_id RETURNING * INTO r;
      END IF;
    END IF;
  ELSIF p_action<>'reserve' THEN RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  RETURN jsonb_build_object('objectId',b.object_id,'mediaObjectId',b.media_object_id,'sourceId',b.source_id,'sha256',b.sha256,'bytes',b.bytes,'mime',b.mime,'state',r.state);
END $$;
ALTER FUNCTION content_intake.sop_payload_transition(text,text,text,text,text,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_payload_transition(text,text,text,text,text,jsonb) FROM PUBLIC;
CREATE FUNCTION content_intake.reserve_sop_media_payload(p_actor text,p_job text,p_media text,p_sha text,p_bytes bigint,p_mime text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.sop_payload_transition(p_actor,p_job,p_media,NULL,'reserve',jsonb_build_object('sha256',p_sha,'bytes',p_bytes,'mime',p_mime));
$$;
CREATE FUNCTION content_intake.complete_sop_media_payload(p_actor text,p_job text,p_media text,p_object text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.sop_payload_transition(p_actor,p_job,p_media,p_object,'complete',NULL);
$$;
CREATE FUNCTION content_intake.begin_sop_media_release(p_actor text,p_job text,p_media text,p_object text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.sop_payload_transition(p_actor,p_job,p_media,p_object,'begin-release',NULL);
$$;
CREATE FUNCTION content_intake.complete_sop_media_release(p_actor text,p_job text,p_media text,p_object text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.sop_payload_transition(p_actor,p_job,p_media,p_object,'complete-release',NULL);
$$;
ALTER FUNCTION content_intake.reserve_sop_media_payload(text,text,text,text,bigint,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.complete_sop_media_payload(text,text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.begin_sop_media_release(text,text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.complete_sop_media_release(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.reserve_sop_media_payload(text,text,text,text,bigint,text),content_intake.complete_sop_media_payload(text,text,text,text),
  content_intake.begin_sop_media_release(text,text,text,text),content_intake.complete_sop_media_release(text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.reserve_sop_media_payload(text,text,text,text,bigint,text),content_intake.complete_sop_media_payload(text,text,text,text),
  content_intake.begin_sop_media_release(text,text,text,text),content_intake.complete_sop_media_release(text,text,text,text) TO intake_business;

-- Adopt charged files only inside the trusted freeze transaction. Stable media
-- identity wins concurrent jobs; the unused competing payload stays reclaimable.
CREATE FUNCTION content_intake.adopt_sop_payloads(p_actor text,p_job text,p_media jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; a content_intake.principals; item jsonb; b content_intake.sop_payload_bindings; r content_intake.object_reservations;
  canonical_id text; normalized jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO STRICT j FROM content_intake.parse_jobs WHERE job_id=p_job AND actor_id=p_actor;
  SELECT * INTO STRICT a FROM content_intake.principals WHERE principal_id=p_actor;
  FOR item IN SELECT x FROM jsonb_array_elements(p_media->'items') x LOOP
    SELECT m.payload_object_id INTO canonical_id FROM content_intake.objects o JOIN content_intake.sop_media_objects m ON m.payload_object_id=o.object_id
      WHERE m.media_object_id=item->>'mediaObjectId' AND o.source_id=j.source_id AND o.purpose='sop-media'
      AND o.sha256=item->>'sha256' AND o.bytes=(item->>'bytes')::bigint AND o.mime=item->>'mime' AND o.tenant_id=a.tenant_id AND o.app_id=a.app_id;
    IF canonical_id IS NOT NULL AND canonical_id=item->>'payloadObjectId' THEN
      normalized:=normalized||jsonb_build_array(item); CONTINUE;
    END IF;
    SELECT * INTO b FROM content_intake.sop_payload_bindings WHERE job_id=p_job AND media_object_id=item->>'mediaObjectId' AND object_id=item->>'payloadObjectId';
    IF NOT FOUND OR b.actor_id<>p_actor OR b.source_id<>j.source_id OR b.sha256 IS DISTINCT FROM item->>'sha256' OR b.bytes IS DISTINCT FROM (item->>'bytes')::bigint OR b.mime IS DISTINCT FROM item->>'mime' THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF canonical_id IS NOT NULL THEN
      normalized:=normalized||jsonb_build_array(item||jsonb_build_object('payloadObjectId',canonical_id)); CONTINUE;
    END IF;
    SELECT * INTO STRICT r FROM content_intake.object_reservations WHERE object_id=b.object_id FOR UPDATE;
    IF r.state NOT IN ('persisted','adopted') OR r.purpose<>'sop-media' OR r.actor_id<>p_actor OR r.source_id<>j.source_id
      OR r.tenant_id<>a.tenant_id OR r.app_id<>a.app_id OR r.sha256 IS DISTINCT FROM b.sha256 OR r.actual_bytes IS DISTINCT FROM b.bytes THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF r.state='adopted' AND NOT EXISTS(SELECT 1 FROM content_intake.objects WHERE object_id=b.object_id AND source_id=b.source_id AND sha256=b.sha256 AND bytes=b.bytes AND mime=b.mime AND purpose='sop-media') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    INSERT INTO content_intake.objects(object_id,source_id,actor_id,tenant_id,app_id,object_key,sha256,bytes,mime,purpose,received_at)
      VALUES(b.object_id,j.source_id,p_actor,a.tenant_id,a.app_id,'intake/'||b.object_id,b.sha256,b.bytes,b.mime,'sop-media',clock_timestamp()) ON CONFLICT(object_id) DO NOTHING;
    UPDATE content_intake.object_reservations SET state='adopted',updated_at=clock_timestamp() WHERE object_id=b.object_id;
    normalized:=normalized||jsonb_build_array(item);
  END LOOP;
  RETURN p_media||jsonb_build_object('items',normalized);
END $$;
ALTER FUNCTION content_intake.adopt_sop_payloads(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.adopt_sop_payloads(text,text,jsonb) FROM PUBLIC;

-- DRAFT source. Explicit row bindings, immutable revision, no production activation.
CREATE TABLE content_intake.sop_candidate_rows (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  row_id text NOT NULL CHECK (row_id ~ '^sop:[^:]{1,128}:[1-9][0-9]{0,3}$'),
  business_entry_id text NOT NULL,
  CHECK (split_part(row_id,':',2) IN ('过敏流程SOP','少错破SOP','品质售后SOP','税收相关规则','品牌对接资源汇总','长痘痘SOP') AND split_part(row_id,':',3)::int<=5000),
  PRIMARY KEY(candidate_id,candidate_version,row_id),
  UNIQUE(candidate_id,candidate_version,business_entry_id),
  FOREIGN KEY(candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id)
);
ALTER TABLE content_intake.sop_candidate_rows OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_candidate_rows FROM PUBLIC;
GRANT SELECT,INSERT ON content_intake.candidate_vocabulary TO intake_runtime_fn_owner;
-- candidate_format_guard reads the original input object on each revision.
GRANT SELECT ON content_intake.objects TO intake_runtime_fn_owner;

-- Trusted parser passes exact workbook row -> generated entry mappings at freeze.
-- Older candidates without such provenance must be reimported, never inferred.
CREATE FUNCTION content_intake.register_sop_candidate_rows(p_actor text,p_id text,p_version bigint,p_rows jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; v_count integer;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version FOR UPDATE;
  IF NOT FOUND OR content_intake.authorization_deadline(p_actor,'import',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') OR c.publication_policy<>'direct-v1'
    OR NOT EXISTS (SELECT 1 FROM content_intake.source_mappings m JOIN content_intake.scopes s ON s.scope_id=c.scope_id
      WHERE m.source_id=c.source_id AND m.version=c.source_version AND
      (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  v_count:=jsonb_array_length(p_rows);
  IF v_count<>jsonb_array_length(c.material->'entries') OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE
      r-ARRAY['rowId','businessEntryId','title','answerText']<>'{}'::jsonb OR
      NOT r ?& ARRAY['rowId','businessEntryId','title','answerText'] OR
      jsonb_typeof(r->'rowId')<>'string' OR (r->>'rowId') !~ '^sop:[^:]{1,128}:[1-9][0-9]{0,3}$' OR
      split_part(r->>'rowId',':',2) IS DISTINCT FROM r->>'title' OR
      NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.material->'entries') e
        WHERE e->'businessEntryId'=r->'businessEntryId' AND e->'title'=r->'title' AND e->'answerText'=r->'answerText')
    ) OR (SELECT count(DISTINCT r->>'rowId')<>v_count OR count(DISTINCT r->>'businessEntryId')<>v_count FROM jsonb_array_elements(p_rows) r) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM content_intake.sop_candidate_rows WHERE candidate_id=p_id AND candidate_version=p_version) THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r WHERE NOT EXISTS (
      SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=p_id AND b.candidate_version=p_version
        AND b.row_id=r->>'rowId' AND b.business_entry_id=r->>'businessEntryId')) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    RETURN;
  END IF;
  INSERT INTO content_intake.sop_candidate_rows
    SELECT p_id,p_version,c.source_id,r->>'rowId',r->>'businessEntryId' FROM jsonb_array_elements(p_rows) r;
END $$;
ALTER FUNCTION content_intake.register_sop_candidate_rows(text,text,bigint,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.register_sop_candidate_rows(text,text,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.register_sop_candidate_rows(text,text,bigint,jsonb) FROM intake_business;

CREATE TABLE content_intake.sop_asset_registrations (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  -- NULL marks a manual derived revision, not a replayable parser registration.
  payload_digest content_intake.sha256,
  content_version jsonb NOT NULL CHECK (jsonb_typeof(content_version)='object'),
  PRIMARY KEY(candidate_id,candidate_version),
  FOREIGN KEY(candidate_id,candidate_version) REFERENCES content_intake.candidate_versions(candidate_id,version)
);
ALTER TABLE content_intake.sop_asset_registrations OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_asset_registrations FROM PUBLIC;

-- Deletion facts never disappear when the current media projection is reused.
CREATE TABLE content_intake.sop_row_deletion_events (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  row_id text NOT NULL,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  content_version jsonb NOT NULL,
  deleted_at timestamptz NOT NULL CHECK (isfinite(deleted_at)),
  media jsonb NOT NULL CHECK (jsonb_typeof(media)='array'),
  PRIMARY KEY(candidate_id,candidate_version,row_id),
  FOREIGN KEY(candidate_id,candidate_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id)
);
ALTER TABLE content_intake.sop_row_deletion_events OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_row_deletion_events FROM PUBLIC;
CREATE INDEX sop_deletion_source_row ON content_intake.sop_row_deletion_events(source_id,row_id);
CREATE TRIGGER sop_deletion_history BEFORE UPDATE OR DELETE ON content_intake.sop_row_deletion_events
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();

-- One trusted parser call owns complete row/media registration. Metadata is supplied
-- only by the server parser after validating bytes; this is not a renderer API.
CREATE FUNCTION content_intake.stage_sop_candidate_assets(p_actor text,p_id text,p_version bigint,p_rows jsonb,p_media jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; r jsonb; v_items jsonb; v_existing jsonb; v_payload text; v_registered text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version FOR UPDATE;
  IF NOT FOUND OR content_intake.authorization_deadline(p_actor,'import',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') OR c.publication_policy<>'direct-v1' OR EXISTS
    (SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=p_id AND candidate_version=p_version AND action='publish' AND state IN ('pending','unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM content_intake.sources WHERE source_id=c.source_id AND current_mapping_version=c.source_version AND mode='v2-preview') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  IF jsonb_typeof(p_media) IS DISTINCT FROM 'object' OR p_media-ARRAY['sourceId','sourceVersion','fileSha256','materialDigest','contentVersion','freshRowIds','items']<>'{}'::jsonb
    OR NOT p_media ?& ARRAY['sourceId','sourceVersion','fileSha256','materialDigest','contentVersion','freshRowIds','items']
    OR p_media->'sourceId' IS DISTINCT FROM to_jsonb(c.source_id::text)
    OR p_media->'sourceVersion' IS DISTINCT FROM to_jsonb(c.source_version::bigint)
    OR p_media->'fileSha256' IS DISTINCT FROM to_jsonb(c.file_sha256::text)
    OR p_media->'materialDigest' IS DISTINCT FROM to_jsonb(c.digest::text)
    OR jsonb_typeof(p_media->'freshRowIds') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_media->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF jsonb_typeof(p_media->'contentVersion') IS DISTINCT FROM 'object'
    OR (p_media->'contentVersion')-ARRAY['kind','value']<>'{}'::jsonb OR NOT (p_media->'contentVersion') ?& ARRAY['kind','value']
    OR jsonb_typeof(p_media#>'{contentVersion,kind}') IS DISTINCT FROM 'string'
    OR p_media#>>'{contentVersion,kind}' NOT IN ('declared','sha256')
    OR jsonb_typeof(p_media#>'{contentVersion,value}') IS DISTINCT FROM 'string'
    OR length(p_media#>>'{contentVersion,value}') NOT BETWEEN 1 AND 32767 OR btrim(p_media#>>'{contentVersion,value}')=''
    OR (p_media#>>'{contentVersion,kind}'='sha256' AND p_media#>>'{contentVersion,value}'<>c.file_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  v_items:=p_media->'items';
  IF jsonb_array_length(v_items)>500 OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x WHERE
    jsonb_typeof(x) IS DISTINCT FROM 'object' OR x-ARRAY['mediaObjectId','payloadObjectId','sha256','bytes','mime','sheetName','rowNumber','columnNumber','ordinal']<>'{}'::jsonb
    OR NOT x ?& ARRAY['mediaObjectId','payloadObjectId','sha256','bytes','mime','sheetName','rowNumber','columnNumber','ordinal']
    OR jsonb_typeof(x->'mediaObjectId') IS DISTINCT FROM 'string' OR (x->>'mediaObjectId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR jsonb_typeof(x->'payloadObjectId') IS DISTINCT FROM 'string' OR (x->>'payloadObjectId') !~ '^obj_[0-9a-f]{64}$'
    OR jsonb_typeof(x->'sha256') IS DISTINCT FROM 'string' OR (x->>'sha256') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(x->'mime') IS DISTINCT FROM 'string' OR (x->>'mime') NOT IN ('image/png','image/jpeg','image/gif')
    OR jsonb_typeof(x->'sheetName') IS DISTINCT FROM 'string'
    OR jsonb_typeof(x->'bytes') IS DISTINCT FROM 'number' OR (x->>'bytes') !~ '^[1-9][0-9]{0,6}$'
    OR jsonb_typeof(x->'rowNumber') IS DISTINCT FROM 'number' OR (x->>'rowNumber') !~ '^[1-9][0-9]{0,3}$'
    OR jsonb_typeof(x->'columnNumber') IS DISTINCT FROM 'number' OR (x->>'columnNumber') !~ '^[1-9][0-9]?$'
    OR jsonb_typeof(x->'ordinal') IS DISTINCT FROM 'number' OR (x->>'ordinal') !~ '^[1-9][0-9]{0,2}$') THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  -- The row helper validates every material entry and never infers missing rows.
  PERFORM content_intake.register_sop_candidate_rows(p_actor,p_id,p_version,p_rows);
  IF EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d JOIN content_intake.sop_candidate_rows b
      ON b.source_id=d.source_id AND b.row_id=d.row_id WHERE b.candidate_id=p_id AND b.candidate_version=p_version
      AND d.content_version=p_media->'contentVersion') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x WHERE (x->>'bytes')::bigint>5242880
    OR (x->>'columnNumber')::int>32 OR (x->>'ordinal')::int>100 OR NOT EXISTS
    (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=p_id AND b.candidate_version=p_version
      AND b.row_id='sop:'||(x->>'sheetName')||':'||(x->>'rowNumber')))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x GROUP BY x->>'sheetName',x->>'rowNumber',x->>'mediaObjectId',x->>'ordinal' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) x GROUP BY x->>'sheetName',x->>'rowNumber',x->>'columnNumber',x->>'ordinal' HAVING count(*)>1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  v_payload:=encode(public.digest(public.jsonb_jcs(jsonb_build_object('rows',
    (SELECT jsonb_agg(x ORDER BY x->>'rowId') FROM jsonb_array_elements(p_rows) x),
    'media',p_media||jsonb_build_object('freshRowIds',(SELECT coalesce(jsonb_agg(x ORDER BY x),'[]'::jsonb) FROM jsonb_array_elements(p_media->'freshRowIds') x),'items',(SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x)))),'sha256'),'hex');
  SELECT payload_digest INTO v_registered FROM content_intake.sop_asset_registrations WHERE candidate_id=p_id AND candidate_version=p_version;
  IF FOUND THEN
    IF v_registered IS DISTINCT FROM v_payload THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    RETURN;
  END IF;
  -- A published entry's workbook row identity is immutable. Historical candidates
  -- lacking reliable row provenance must be reimported through an approved repair.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.candidate_versions prior
      ON prior.candidate_id=l.candidate_id AND prior.version=l.candidate_version
    JOIN content_intake.sop_candidate_rows current ON current.candidate_id=p_id AND current.candidate_version=p_version AND current.business_entry_id=l.business_entry_id
    WHERE l.release_id=c.base_release_id AND l.source_id=c.source_id AND NOT EXISTS
      (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version
        AND b.business_entry_id=l.business_entry_id AND b.source_id=c.source_id AND b.row_id=current.row_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Parser labels fresh rows explicitly: equal text does not imply inherited
  -- media because a fresh workbook may replace/remove images without text edits.
  IF jsonb_array_length(p_media->'freshRowIds')>(SELECT count(*) FROM content_intake.sop_candidate_rows WHERE candidate_id=p_id AND candidate_version=p_version)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_media->'freshRowIds') x WHERE jsonb_typeof(x)<>'string'
      OR NOT EXISTS (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=p_id AND b.candidate_version=p_version AND to_jsonb(b.row_id)=x))
    OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(p_media->'freshRowIds') x)
    OR EXISTS (
      -- Expand each immutable version once. Correlated expansion per lineage row
      -- multiplies whole-workbook scans and can exhaust the transaction deadline.
      WITH base_lineage AS MATERIALIZED (
        SELECT candidate_id,candidate_version,source_id,business_entry_id
        FROM content_intake.release_lineage WHERE release_id=c.base_release_id AND source_id=c.source_id
      ), prior_versions AS MATERIALIZED (
        SELECT prior.candidate_id,prior.version,prior.material
        FROM (SELECT DISTINCT candidate_id,candidate_version FROM base_lineage) versions
        JOIN content_intake.candidate_versions prior ON prior.candidate_id=versions.candidate_id AND prior.version=versions.candidate_version
      ), prior_entries AS MATERIALIZED (
        SELECT prior.candidate_id,prior.version,old.value AS entry FROM prior_versions prior
        CROSS JOIN LATERAL jsonb_array_elements(prior.material->'entries') old
      ), current_entries AS MATERIALIZED (
        SELECT value AS entry FROM jsonb_array_elements(c.material->'entries')
      ), inherited_rows AS MATERIALIZED (
        SELECT b.row_id,b.business_entry_id FROM base_lineage l
        JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version
          AND b.source_id=l.source_id AND b.business_entry_id=l.business_entry_id
        JOIN prior_entries old ON old.candidate_id=l.candidate_id AND old.version=l.candidate_version
          AND old.entry->>'businessEntryId'=b.business_entry_id
        JOIN current_entries current_entry ON current_entry.entry=old.entry
      )
      SELECT 1 FROM content_intake.sop_candidate_rows current WHERE current.candidate_id=p_id AND current.candidate_version=p_version
        AND NOT (p_media->'freshRowIds') ? current.row_id
        AND NOT EXISTS(SELECT 1 FROM inherited_rows prior WHERE prior.row_id=current.row_id AND prior.business_entry_id=current.business_entry_id)
    ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Only explicitly inherited entries retain the exact prior media set.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.candidate_versions prior
      ON prior.candidate_id=l.candidate_id AND prior.version=l.candidate_version
    JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version AND b.business_entry_id=l.business_entry_id
    JOIN LATERAL jsonb_array_elements(prior.material->'entries') old ON old->>'businessEntryId'=l.business_entry_id
    WHERE l.release_id=c.base_release_id AND l.source_id=c.source_id AND NOT (p_media->'freshRowIds') ? b.row_id
    AND (SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',(SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=m.media_object_id),'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,
      'sheetName',m.sheet_name,'rowNumber',m.row_number,'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
      FROM content_intake.sop_candidate_media m WHERE m.candidate_id=l.candidate_id AND m.candidate_version=l.candidate_version AND m.row_id=b.row_id)
    IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x
      WHERE 'sop:'||(x->>'sheetName')||':'||(x->>'rowNumber')=b.row_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',(SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=m.media_object_id),'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,
    'sheetName',m.sheet_name,'rowNumber',m.row_number,'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
    INTO v_existing FROM content_intake.sop_candidate_media m WHERE candidate_id=p_id AND candidate_version=p_version;
  IF v_existing<>'[]'::jsonb AND v_existing IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x->>'sheetName',(x->>'rowNumber')::int,(x->>'columnNumber')::int,(x->>'ordinal')::int,x->>'mediaObjectId'),'[]'::jsonb) FROM jsonb_array_elements(v_items) x) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(v_items) x LOOP
    IF EXISTS (SELECT 1 FROM content_intake.sop_media_objects o WHERE o.media_object_id=r->>'mediaObjectId' AND
      (o.source_id<>c.source_id OR o.sha256<>r->>'sha256' OR o.bytes<>(r->>'bytes')::bigint OR o.mime<>r->>'mime' OR o.payload_object_id IS DISTINCT FROM r->>'payloadObjectId'))
      OR EXISTS (SELECT 1 FROM content_intake.sop_media_objects o WHERE o.source_id=c.source_id AND o.sha256=r->>'sha256' AND o.bytes=(r->>'bytes')::bigint AND o.mime=r->>'mime' AND o.media_object_id<>r->>'mediaObjectId') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
      WHERE d.source_id=c.source_id AND d.content_version=p_media->'contentVersion' AND m->>'mediaObjectId'=r->>'mediaObjectId' AND m->>'state'='discarded') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF EXISTS (SELECT 1 FROM content_intake.sop_media_objects WHERE media_object_id=r->>'mediaObjectId' AND state='discarded') THEN
      -- A different operation/job is not a different content version. All deletion
      -- history participates, including an older version seen before the last one.
      IF NOT (p_media->'freshRowIds') ? ('sop:'||(r->>'sheetName')||':'||(r->>'rowNumber'))
        OR EXISTS (SELECT 1 FROM content_intake.sop_candidate_media WHERE media_object_id=r->>'mediaObjectId')
        OR EXISTS (SELECT 1 FROM content_intake.sop_release_media WHERE media_object_id=r->>'mediaObjectId')
        OR EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
          WHERE d.source_id=c.source_id AND d.content_version=p_media->'contentVersion' AND m->>'mediaObjectId'=r->>'mediaObjectId')
        OR NOT EXISTS (SELECT 1 FROM content_intake.sop_row_deletion_events d CROSS JOIN LATERAL jsonb_array_elements(d.media) m
          JOIN content_intake.sop_media_objects o ON o.media_object_id=m->>'mediaObjectId'
          WHERE d.source_id=c.source_id AND o.media_object_id=r->>'mediaObjectId' AND o.adopted_at IS NULL
            AND m->>'state'='discarded' AND m->>'sha256'=o.sha256 AND (m->>'bytes')::bigint=o.bytes AND m->>'mime'=o.mime
            AND (m->>'discardedAt')::timestamptz=o.discarded_at AND d.content_version IS DISTINCT FROM p_media->'contentVersion') THEN
        RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
      UPDATE content_intake.sop_media_objects SET state='staged',discarded_at=NULL WHERE media_object_id=r->>'mediaObjectId' AND state='discarded' AND adopted_at IS NULL;
    END IF;
    INSERT INTO content_intake.sop_media_objects(media_object_id,source_id,actor_id,sha256,bytes,mime,state,created_at,payload_object_id)
      VALUES(r->>'mediaObjectId',c.source_id,p_actor,r->>'sha256',(r->>'bytes')::bigint,r->>'mime','staged',clock_timestamp(),r->>'payloadObjectId') ON CONFLICT(media_object_id) DO NOTHING;
    INSERT INTO content_intake.sop_candidate_media VALUES(p_id,p_version,c.source_id,r->>'mediaObjectId',r->>'sheetName',(r->>'rowNumber')::int,(r->>'columnNumber')::int,
      'sop:'||(r->>'sheetName')||':'||(r->>'rowNumber'),(r->>'ordinal')::int,r->>'sha256',r->>'mime',(r->>'bytes')::bigint) ON CONFLICT(candidate_id,candidate_version,row_id,media_object_id,ordinal) DO NOTHING;
  END LOOP;
  INSERT INTO content_intake.sop_asset_registrations VALUES(p_id,p_version,v_payload,p_media->'contentVersion');
  IF content_intake.authorization_deadline(p_actor,'import',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
END $$;
ALTER FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.stage_sop_candidate_assets(text,text,bigint,jsonb,jsonb) FROM intake_business;

-- Read provenance only through the authenticated source/job, never global tables.
CREATE FUNCTION content_intake.read_sop_inherited_assets(p_actor text,p_job text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; s content_intake.sources; v_rows jsonb; v_media jsonb; v_frozen jsonb:='[]'::jsonb; v_cleanup jsonb:='[]'::jsonb;
BEGIN
  SELECT * INTO j FROM content_intake.parse_jobs WHERE job_id=p_job;
  IF NOT FOUND OR j.actor_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT * INTO STRICT s FROM content_intake.sources WHERE source_id=j.source_id;
  IF content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF j.state NOT IN ('reading','parsing','validated') OR s.mode<>'v2-preview' OR s.current_mapping_version<>j.source_version THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l WHERE l.release_id=j.base_release_id AND l.source_id=j.source_id
    AND NOT EXISTS (SELECT 1 FROM content_intake.sop_candidate_rows b WHERE b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version AND b.source_id=l.source_id AND b.business_entry_id=l.business_entry_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('rowId',b.row_id,'businessEntryId',b.business_entry_id,'title',e->>'title','answerText',e->>'answerText') ORDER BY b.row_id),'[]'::jsonb)
    INTO v_rows FROM content_intake.release_lineage l JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version AND b.source_id=l.source_id AND b.business_entry_id=l.business_entry_id
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
    WHERE l.release_id=j.base_release_id AND l.source_id=j.source_id AND e->>'businessEntryId'=l.business_entry_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',(SELECT payload_object_id FROM content_intake.sop_media_objects WHERE media_object_id=m.media_object_id),'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,'sheetName',m.sheet_name,'rowNumber',m.row_number,'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
    INTO v_media FROM content_intake.release_lineage l JOIN content_intake.sop_candidate_rows b ON b.candidate_id=l.candidate_id AND b.candidate_version=l.candidate_version AND b.source_id=l.source_id AND b.business_entry_id=l.business_entry_id
    JOIN content_intake.sop_candidate_media m ON m.candidate_id=b.candidate_id AND m.candidate_version=b.candidate_version AND m.row_id=b.row_id AND m.source_id=b.source_id
    WHERE l.release_id=j.base_release_id AND l.source_id=j.source_id;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(v_media) item WHERE item->>'payloadObjectId' IS NULL) THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Recovery exposes only this job's durable result, not arbitrary candidate IDs.
  -- The original freeze still validates material, state and registration digest.
  IF j.state='validated' THEN
    IF NOT EXISTS(SELECT 1 FROM content_intake.candidate_versions c
      WHERE c.candidate_id=j.result_candidate_id AND c.version=j.result_candidate_version
        AND c.source_id=j.source_id AND c.actor_id=p_actor AND c.object_id=j.object_id) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',m.media_object_id,'payloadObjectId',o.payload_object_id,
      'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,'sheetName',m.sheet_name,'rowNumber',m.row_number,
      'columnNumber',m.column_number,'ordinal',m.ordinal) ORDER BY m.sheet_name,m.row_number,m.column_number,m.ordinal,m.media_object_id),'[]'::jsonb)
      INTO v_frozen FROM content_intake.sop_candidate_media m
      JOIN content_intake.sop_candidate_rows b ON b.candidate_id=m.candidate_id AND b.candidate_version=m.candidate_version
        AND b.source_id=m.source_id AND b.row_id=m.row_id
      JOIN content_intake.sop_media_objects o ON o.media_object_id=m.media_object_id AND o.source_id=m.source_id
      WHERE m.candidate_id=j.result_candidate_id AND m.candidate_version=j.result_candidate_version AND m.source_id=j.source_id;
    IF jsonb_array_length(v_frozen)<>(SELECT count(*) FROM content_intake.sop_candidate_media m
        WHERE m.candidate_id=j.result_candidate_id AND m.candidate_version=j.result_candidate_version AND m.source_id=j.source_id)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(v_frozen) item WHERE item->>'payloadObjectId' IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  END IF;
  -- A confirmed validated job also recovers its unadopted competing payloads.
  -- This is metadata only; the existing release capability rechecks ownership
  -- and references under the file/content locks before deleting any bytes.
  IF j.state='validated' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('objectId',b.object_id,'mediaObjectId',b.media_object_id,
      'sourceId',b.source_id,'sha256',b.sha256,'bytes',b.bytes,'mime',b.mime,'state',r.state)
      ORDER BY b.media_object_id),'[]'::jsonb) INTO v_cleanup
      FROM content_intake.sop_payload_bindings b JOIN content_intake.object_reservations r USING(object_id)
      WHERE b.job_id=p_job AND b.actor_id=p_actor AND b.source_id=j.source_id AND r.actor_id=p_actor
        AND r.source_id=j.source_id AND r.purpose='sop-media' AND r.state IN ('reserved','persisted','releasing');
  END IF;
  RETURN jsonb_build_object('rows',v_rows,'media',v_media,'frozenMedia',v_frozen,'pendingPayloads',v_cleanup);
END $$;
ALTER FUNCTION content_intake.read_sop_inherited_assets(text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_inherited_assets(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_inherited_assets(text,text) TO intake_business;

-- Complete freeze capability: inputs are produced by the trusted parser, never
-- accepted as arbitrary HTTP material. SQL owns persistence and current authority.
GRANT SELECT ON content_intake.parse_jobs,content_intake.release_catalogs,content_intake.vocabulary,content_intake.vocabulary_displays TO intake_runtime_fn_owner;
GRANT UPDATE(state,finished_at,result_candidate_id,result_candidate_version) ON content_intake.parse_jobs TO intake_runtime_fn_owner;
CREATE FUNCTION content_intake.freeze_sop_parsed_candidate(p_actor text,p_job text,p_material jsonb,p_rows jsonb,p_media jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; s content_intake.sources; old content_intake.candidate_versions;
  o content_intake.objects; v_id text; v_version bigint; v_until timestamptz; v_encoded text; entry_data jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO j FROM content_intake.parse_jobs WHERE job_id=p_job FOR UPDATE;
  IF NOT FOUND OR j.actor_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT * INTO STRICT s FROM content_intake.sources WHERE source_id=j.source_id;
  v_until:=content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp());
  IF v_until IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF j.state NOT IN ('reading','parsing','validated') OR s.mode<>'v2-preview' OR s.current_mapping_version<>j.source_version THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  IF jsonb_typeof(p_material) IS DISTINCT FROM 'object'
    OR p_material-ARRAY['canonicalEncodingVersion','scope','sourceVersion','sourceClaim','templateVersion','ruleVersion','mappingVersion','selectedSheets','object','entries','differences','contributors','risk','baseReleaseId','media']<>'{}'::jsonb
    OR NOT p_material ?& ARRAY['canonicalEncodingVersion','scope','sourceVersion','sourceClaim','templateVersion','ruleVersion','mappingVersion','selectedSheets','object','entries','differences','contributors','risk','baseReleaseId','media']
    OR jsonb_typeof(p_material->'entries') IS DISTINCT FROM 'array' OR jsonb_typeof(p_material->'differences') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_material->'contributors') IS DISTINCT FROM 'array' OR p_material->'media' IS DISTINCT FROM '[]'::jsonb
    OR jsonb_typeof(p_material->'object') IS DISTINCT FROM 'object' OR (p_material->'object')-ARRAY['objectId','sha256','bytes','mime','sourceId']<>'{}'::jsonb
    OR jsonb_typeof(p_material->'sourceClaim') IS DISTINCT FROM 'object' OR (p_material->'sourceClaim')-ARRAY['versionKind','versionValue','acquisition','fileSha256']<>'{}'::jsonb
    OR jsonb_typeof(p_material->'risk') IS DISTINCT FROM 'object' OR (p_material->'risk')-ARRAY['policyVersion','level','reasons','explicitDisableCount','sameSourceDisabledLast24Hours','evaluatedAt']<>'{}'::jsonb THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  IF jsonb_array_length(p_material->'entries') NOT BETWEEN 1 AND 5000 OR jsonb_array_length(p_material->'differences')>5000
    OR (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(p_material->'contributors') x) IS DISTINCT FROM
       (SELECT jsonb_agg(x ORDER BY x) FROM unnest(j.contributor_ids) x) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  FOR entry_data IN SELECT x FROM jsonb_array_elements(p_material->'entries') x LOOP
    IF jsonb_typeof(entry_data) IS DISTINCT FROM 'object' OR entry_data-ARRAY['businessEntryId','scriptVersion','operation','title','answerText','questions','productRefs','scenarioRefs','effectiveFrom','effectiveTo','applicabilityNote','familySourceId','familyBusinessEntryId','brandNonOverridable','category','internalNote','riskNote','attachmentNote']<>'{}'::jsonb
      OR NOT entry_data ?& ARRAY['businessEntryId','scriptVersion','operation','title','answerText','questions','productRefs','scenarioRefs','effectiveFrom','effectiveTo','applicabilityNote','familySourceId','familyBusinessEntryId','brandNonOverridable','category','internalNote','riskNote','attachmentNote']
      OR jsonb_typeof(entry_data->'questions') IS DISTINCT FROM 'array' OR jsonb_typeof(entry_data->'productRefs') IS DISTINCT FROM 'array' OR jsonb_typeof(entry_data->'scenarioRefs') IS DISTINCT FROM 'array'
      OR entry_data->>'operation' NOT IN ('upsert','disable') OR entry_data->'attachmentNote' IS DISTINCT FROM '""'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(entry_data->'questions') q WHERE jsonb_typeof(q) IS DISTINCT FROM 'object'
      OR q-ARRAY['id','version','text','active']<>'{}'::jsonb OR NOT q ?& ARRAY['id','version','text','active'])
      OR EXISTS (SELECT 1 FROM jsonb_array_elements((entry_data->'productRefs')||(entry_data->'scenarioRefs')) q WHERE jsonb_typeof(q) IS DISTINCT FROM 'object'
      OR q-ARRAY['id','displayVersion']<>'{}'::jsonb OR NOT q ?& ARRAY['id','displayVersion']) THEN
      RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_material->'differences') d WHERE jsonb_typeof(d) IS DISTINCT FROM 'object'
    OR d-ARRAY['businessEntryId','change','previousVersion','nextVersion','beforeDigest','afterDigest']<>'{}'::jsonb
    OR NOT d ?& ARRAY['businessEntryId','change','previousVersion','nextVersion','beforeDigest','afterDigest']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_INVALID'; END IF;
  SELECT * INTO o FROM content_intake.objects WHERE object_id=j.object_id AND source_id=j.source_id AND actor_id=p_actor AND purpose='input';
  IF NOT FOUND OR p_material->'object' IS DISTINCT FROM jsonb_build_object('objectId',o.object_id,'sha256',o.sha256,'bytes',o.bytes,'mime',o.mime,'sourceId',o.source_id)
    OR p_material->'baseReleaseId' IS DISTINCT FROM coalesce(to_jsonb(j.base_release_id),'null'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  v_encoded:=public.jsonb_jcs(p_material);
  p_media:=content_intake.adopt_sop_payloads(p_actor,p_job,p_media);
  IF j.state='validated' THEN
    SELECT * INTO old FROM content_intake.candidate_versions WHERE candidate_id=j.result_candidate_id AND version=j.result_candidate_version;
    IF NOT FOUND OR old.material IS DISTINCT FROM p_material THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    PERFORM content_intake.stage_sop_candidate_assets(p_actor,old.candidate_id,old.version,p_rows,p_media);
    RETURN jsonb_build_object('candidateId',old.candidate_id,'version',old.version,'digest',old.digest,'validUntil',v_until);
  END IF;
  IF j.state='reading' THEN UPDATE content_intake.parse_jobs SET state='parsing' WHERE job_id=p_job; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  IF j.base_release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED'; END IF;
  IF j.base_release_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=j.base_release_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MODE_CONFLICT'; END IF;
  IF j.expected_prior_id IS NOT NULL THEN
    SELECT * INTO old FROM content_intake.candidate_versions WHERE candidate_id=j.expected_prior_id AND version=j.expected_prior_version FOR UPDATE;
    IF NOT FOUND OR old.source_id<>j.source_id OR old.digest<>j.expected_prior_digest OR old.state NOT IN ('awaiting-evidence','ready') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    IF EXISTS (SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=old.candidate_id AND candidate_version=old.version AND action='publish' AND state IN ('pending','unknown')) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='COMMIT_UNKNOWN'; END IF;
    v_id:=old.candidate_id; v_version:=old.version+1;
    UPDATE content_intake.candidate_versions SET state='invalidated',revocation_generation=revocation_generation+1,updated_at=clock_timestamp()
      WHERE candidate_id=old.candidate_id AND version=old.version;
  ELSE v_id:='candidate_'||pg_catalog.gen_random_uuid()::text; v_version:=1;
  END IF;
  -- A parser cannot silently omit a published source entry from a full catalog.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l WHERE l.release_id=j.base_release_id AND l.source_id=j.source_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_material->'entries') e WHERE e->>'businessEntryId'=l.business_entry_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
    canonical_encoding,canonical_material,material,risk,explicit_disable_count,created_at,updated_at,publication_policy)
    VALUES(v_id,v_version,j.source_id,s.scope_id,j.source_version,o.object_id,o.sha256,p_actor,j.base_release_id,'candidate-p1.1',v_encoded,p_material,
      p_material#>>'{risk,level}',(p_material#>>'{risk,explicitDisableCount}')::int,clock_timestamp(),clock_timestamp(),'direct-v1');
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_material->'entries') e CROSS JOIN LATERAL jsonb_array_elements((e->'productRefs')||(e->'scenarioRefs')) ref
    WHERE NOT EXISTS (SELECT 1 FROM content_intake.vocabulary v JOIN content_intake.vocabulary_displays d USING(vocabulary_id)
      JOIN content_intake.scopes scope ON scope.scope_id=v.scope_id JOIN content_intake.scopes current ON current.scope_id=s.scope_id
      WHERE v.vocabulary_id=ref->>'id' AND d.display_version=(ref->>'displayVersion')::bigint AND v.active
      AND scope.tenant_id=current.tenant_id AND scope.app_id=current.app_id AND scope.brand_id=current.brand_id AND scope.domain=current.domain
      AND (scope.shop_id IS NULL OR scope.shop_id IS NOT DISTINCT FROM current.shop_id))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  INSERT INTO content_intake.candidate_vocabulary SELECT DISTINCT v_id,v_version,ref->>'id',(ref->>'displayVersion')::bigint
    FROM jsonb_array_elements(p_material->'entries') e CROSS JOIN LATERAL jsonb_array_elements((e->'productRefs')||(e->'scenarioRefs')) ref;
  PERFORM content_intake.stage_sop_candidate_assets(p_actor,v_id,v_version,p_rows,p_media);
  UPDATE content_intake.parse_jobs SET state='validated',finished_at=clock_timestamp(),result_candidate_id=v_id,result_candidate_version=v_version WHERE job_id=p_job;
  v_until:=content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp());
  IF v_until IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  RETURN jsonb_build_object('candidateId',v_id,'version',v_version,'digest',encode(public.digest(v_encoded,'sha256'),'hex'),'validUntil',v_until);
END $$;
ALTER FUNCTION content_intake.freeze_sop_parsed_candidate(text,text,jsonb,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.freeze_sop_parsed_candidate(text,text,jsonb,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.freeze_sop_parsed_candidate(text,text,jsonb,jsonb,jsonb) TO intake_business;

-- New command; the old media-only delete remains inaccessible to application roles.
CREATE FUNCTION content_intake.revise_unused_sop_row(p_actor text,p_id text,p_version bigint,p_digest text,p_row text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; v_entry text; v_material jsonb; v_encoded text;
  v_until timestamptz; v_removed content_intake.identifier[]; v_new bigint; v_contributors jsonb; v_content_version jsonb; v_deleted_at timestamptz;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  v_until:=content_intake.authorization_deadline(p_actor,'candidate-cancel',c.scope_id,c.source_id,clock_timestamp());
  IF v_until IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF c.state='published' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ALREADY_PUBLISHED'; END IF;
  IF c.state='publishing' OR EXISTS (SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=p_id
    AND candidate_version=p_version AND action='publish' AND state IN ('pending','unknown')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='COMMIT_UNKNOWN'; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') OR c.digest IS DISTINCT FROM p_digest OR c.publication_policy<>'direct-v1' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM content_intake.sources s WHERE s.source_id=c.source_id
      AND s.current_mapping_version=c.source_version AND s.mode='v2-preview') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  IF c.base_release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED'; END IF;
  SELECT business_entry_id INTO v_entry FROM content_intake.sop_candidate_rows
    WHERE candidate_id=p_id AND candidate_version=p_version AND row_id=p_row;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT content_version INTO v_content_version FROM content_intake.sop_asset_registrations WHERE candidate_id=p_id AND candidate_version=p_version;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Protect text-only as well as media-backed published rows, including history.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage WHERE source_id=c.source_id AND business_entry_id=v_entry)
    OR EXISTS (SELECT 1 FROM content_intake.sop_release_media WHERE source_id=c.source_id AND row_id=p_row)
    OR EXISTS (SELECT 1 FROM content_intake.sop_candidate_media cm JOIN content_intake.sop_media_objects o USING(media_object_id)
      WHERE cm.candidate_id=p_id AND cm.candidate_version=p_version AND cm.row_id=p_row
        AND (o.adopted_at IS NOT NULL OR o.state IN ('adopted','released'))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ALREADY_PUBLISHED'; END IF;
  -- Removing the last unused row cancels the upload. Its immutable history stays;
  -- no empty, publishable full-catalog revision is created.
  IF jsonb_array_length(c.material->'entries')=1 THEN
    UPDATE content_intake.candidate_versions SET state='cancelled',revocation_generation=revocation_generation+1,updated_at=clock_timestamp()
      WHERE candidate_id=p_id AND version=p_version;
    v_new:=c.version; v_encoded:=c.canonical_material;
  ELSE
  v_material:=jsonb_set(c.material,'{entries}',(SELECT jsonb_agg(e ORDER BY ord)
    FROM jsonb_array_elements(c.material->'entries') WITH ORDINALITY AS x(e,ord) WHERE e->>'businessEntryId'<>v_entry));
  v_material:=jsonb_set(v_material,'{differences}',coalesce((SELECT jsonb_agg(e ORDER BY ord)
    FROM jsonb_array_elements(c.material->'differences') WITH ORDINALITY AS x(e,ord) WHERE e->>'businessEntryId'<>v_entry),'[]'::jsonb));
  -- Retain conservative risk classification; never reuse the previous quality gate.
  v_material:=jsonb_set(v_material,'{risk,explicitDisableCount}',to_jsonb((SELECT count(*)::int FROM jsonb_array_elements(v_material->'differences') e WHERE e->>'change'='disable')));
  SELECT jsonb_agg(x ORDER BY x COLLATE "C") INTO v_contributors FROM
    (SELECT DISTINCT jsonb_array_elements_text(c.material->'contributors') AS x UNION SELECT p_actor) q;
  v_material:=jsonb_set(v_material,'{contributors}',v_contributors);
  v_encoded:=public.jsonb_jcs(v_material); v_new:=c.version+1;
  UPDATE content_intake.candidate_versions SET state='invalidated',revocation_generation=revocation_generation+1,updated_at=clock_timestamp()
    WHERE candidate_id=p_id AND version=p_version;
  INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,
    base_release_id,canonical_encoding,canonical_material,material,risk,explicit_disable_count,created_at,updated_at,publication_policy)
    VALUES(p_id,v_new,c.source_id,c.scope_id,c.source_version,c.object_id,c.file_sha256,p_actor,c.base_release_id,c.canonical_encoding,
      v_encoded,v_material,c.risk,(v_material#>>'{risk,explicitDisableCount}')::integer,clock_timestamp(),clock_timestamp(),c.publication_policy);
  INSERT INTO content_intake.sop_asset_registrations VALUES(p_id,v_new,NULL,v_content_version);
  INSERT INTO content_intake.candidate_vocabulary SELECT p_id,v_new,vocabulary_id,display_version
    FROM content_intake.candidate_vocabulary WHERE candidate_id=p_id AND candidate_version=p_version;
  INSERT INTO content_intake.sop_candidate_rows SELECT p_id,v_new,source_id,row_id,business_entry_id
    FROM content_intake.sop_candidate_rows WHERE candidate_id=p_id AND candidate_version=p_version AND row_id<>p_row;
  INSERT INTO content_intake.sop_candidate_media SELECT p_id,v_new,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes
    FROM content_intake.sop_candidate_media WHERE candidate_id=p_id AND candidate_version=p_version AND row_id<>p_row;
  END IF;
  SELECT coalesce(array_agg(media_object_id),ARRAY[]::content_intake.identifier[]) INTO v_removed
    FROM content_intake.sop_candidate_media WHERE candidate_id=p_id AND candidate_version=p_version AND row_id=p_row;
  DELETE FROM content_intake.sop_candidate_media WHERE candidate_id=p_id AND candidate_version=p_version AND row_id=p_row;
  v_deleted_at:=clock_timestamp();
  UPDATE content_intake.sop_media_objects o SET state='discarded',discarded_at=v_deleted_at
    WHERE o.media_object_id=ANY(v_removed) AND o.state='staged' AND o.adopted_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM content_intake.sop_candidate_media m WHERE m.media_object_id=o.media_object_id)
    AND NOT EXISTS(SELECT 1 FROM content_intake.sop_release_media m WHERE m.media_object_id=o.media_object_id);
  INSERT INTO content_intake.sop_row_deletion_events(candidate_id,candidate_version,source_id,row_id,actor_id,content_version,deleted_at,media)
    VALUES(p_id,p_version,c.source_id,p_row,p_actor,v_content_version,v_deleted_at,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('mediaObjectId',o.media_object_id,'sha256',o.sha256,'bytes',o.bytes,'mime',o.mime,
        'state',o.state,'discardedAt',o.discarded_at,'adoptedAt',o.adopted_at) ORDER BY o.media_object_id),'[]'::jsonb)
        FROM content_intake.sop_media_objects o WHERE o.media_object_id=ANY(v_removed)));
  RETURN jsonb_build_object('key',jsonb_build_object('candidateId',p_id,'version',v_new,'digest',encode(public.digest(v_encoded,'sha256'),'hex')),
    'validUntil',v_until,'rowIds',CASE WHEN v_new=c.version THEN '[]'::jsonb ELSE
      (SELECT jsonb_agg(row_id ORDER BY row_id COLLATE "C") FROM content_intake.sop_candidate_rows WHERE candidate_id=p_id AND candidate_version=v_new) END);
END $$;
ALTER FUNCTION content_intake.revise_unused_sop_row(text,text,bigint,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.revise_unused_sop_row(text,text,bigint,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.revise_unused_sop_row(text,text,bigint,text,text) TO intake_business;
REVOKE ALL ON FUNCTION content_intake.delete_unused_sop_row(content_intake.identifier,content_intake.version,text) FROM intake_business;


-- Every supported writer inserts lineage. This statement trigger is the sole
-- image publication owner; rollback/inherit use exact historical candidate rows.
CREATE FUNCTION content_intake.project_sop_release_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- Classify against the captured source version, never a newer source mapping.
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.source_mappings m ON m.source_id=c.source_id AND m.version=c.source_version
    JOIN content_intake.scopes s ON s.scope_id=c.scope_id
    WHERE (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')
      AND (NOT EXISTS(SELECT 1 FROM content_intake.sop_asset_registrations a WHERE a.candidate_id=c.candidate_id AND a.candidate_version=c.version)
      OR NOT EXISTS(SELECT 1 FROM content_intake.sop_candidate_rows r WHERE r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.source_mappings m ON m.source_id=c.source_id AND m.version=c.source_version JOIN content_intake.scopes s ON s.scope_id=c.scope_id
    WHERE NOT (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')
    AND EXISTS(SELECT 1 FROM content_intake.sop_candidate_media image WHERE image.candidate_id=c.candidate_id AND image.candidate_version=c.version)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Expand each candidate once, then verify all inserted identities in a set.
  IF EXISTS(WITH selected AS (SELECT DISTINCT candidate_id,candidate_version FROM sop_new_lineage), entries AS MATERIALIZED (
    SELECT c.candidate_id,c.version,e FROM selected x JOIN content_intake.candidate_versions c ON c.candidate_id=x.candidate_id AND c.version=x.candidate_version
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e)
    SELECT 1 FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    WHERE NOT EXISTS(SELECT 1 FROM entries WHERE candidate_id=l.candidate_id AND version=l.candidate_version AND e->>'businessEntryId'=l.business_entry_id AND (e->>'scriptVersion')::bigint=l.script_version)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    JOIN content_intake.sop_candidate_media m ON m.candidate_id=r.candidate_id AND m.candidate_version=r.candidate_version AND m.source_id=r.source_id AND m.row_id=r.row_id
    JOIN content_intake.sop_media_objects o ON o.media_object_id=m.media_object_id
    LEFT JOIN content_intake.objects p ON p.object_id=o.payload_object_id
    LEFT JOIN content_intake.object_reservations reservation ON reservation.object_id=p.object_id
    WHERE o.state='discarded' OR p.object_id IS NULL OR p.purpose<>'sop-media' OR reservation.state IS DISTINCT FROM 'adopted'
      OR p.source_id<>m.source_id OR p.sha256<>m.sha256 OR p.bytes<>m.bytes OR p.mime<>m.mime) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.sop_release_media(release_id,candidate_id,candidate_version,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes)
    SELECT l.release_id,m.candidate_id,m.candidate_version,m.source_id,m.media_object_id,m.sheet_name,m.row_number,m.column_number,m.row_id,m.ordinal,m.sha256,m.mime,m.bytes
    FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    JOIN content_intake.sop_candidate_media m ON m.candidate_id=r.candidate_id AND m.candidate_version=r.candidate_version AND m.source_id=r.source_id AND m.row_id=r.row_id;
  UPDATE content_intake.sop_media_objects o SET state='adopted',adopted_at=clock_timestamp()
    WHERE o.state='staged' AND EXISTS(SELECT 1 FROM content_intake.sop_release_media m JOIN sop_new_lineage l
      ON l.release_id=m.release_id AND l.candidate_id=m.candidate_id AND l.candidate_version=m.candidate_version AND l.source_id=m.source_id
      WHERE m.media_object_id=o.media_object_id);
  RETURN NULL;
END $$;
ALTER FUNCTION content_intake.project_sop_release_media() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.project_sop_release_media() FROM PUBLIC;
CREATE TRIGGER project_sop_release_media AFTER INSERT ON content_intake.release_lineage
  REFERENCING NEW TABLE AS sop_new_lineage FOR EACH STATEMENT EXECUTE FUNCTION content_intake.project_sop_release_media();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.sop_release_media
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();

-- Only internal metadata leaves this function; payload IDs never leave the API.
-- The caller still owns full scopes/binding/deadline checks and row applicability.
CREATE FUNCTION content_intake.read_sop_release_assets(p_actor text,p_entitlement_hash text,p_session_token_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lease content_intake.entitlements; result jsonb;
BEGIN
  SELECT e.* INTO lease FROM content_intake.entitlements e JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    JOIN content_intake.principals p ON p.principal_id=e.principal_id AND p.revocation_generation=e.principal_generation
    JOIN public.snapshot_offline_leases offline USING(lease_token_hash)
    JOIN backend_identity.sessions session ON session.token_hash=ctx.session_token_hash
    JOIN backend_identity.subject_bindings binding ON binding.binding_id=session.binding_id AND binding.user_id=e.user_id
    WHERE e.entitlement_hash=p_entitlement_hash AND e.principal_id=p_actor AND ctx.session_token_hash=p_session_token_hash
      AND e.issued_at<=clock_timestamp() AND e.valid_until>clock_timestamp() AND offline.expires_at>clock_timestamp()
      AND session.revoked_at IS NULL AND session.expires_at>clock_timestamp() AND binding.enabled
      AND NOT EXISTS(SELECT 1 FROM content_intake.release_revocations revoked WHERE revoked.release_id=e.release_id);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  IF EXISTS(SELECT 1 FROM content_intake.sop_release_media m JOIN content_intake.entitlement_scopes es ON es.source_id=m.source_id AND es.entitlement_hash=lease.entitlement_hash
    JOIN content_intake.sources s ON s.source_id=m.source_id JOIN content_intake.sop_media_objects o ON o.media_object_id=m.media_object_id
    WHERE m.release_id=lease.release_id AND content_intake.authorization_deadline(p_actor,'query',s.scope_id,s.source_id,clock_timestamp()) IS NOT NULL
      AND (o.payload_object_id IS NULL OR o.state NOT IN ('adopted','released'))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  WITH chosen AS (SELECT DISTINCT m.candidate_id,m.candidate_version FROM content_intake.sop_release_media m
    JOIN content_intake.entitlement_scopes es ON es.source_id=m.source_id AND es.entitlement_hash=lease.entitlement_hash WHERE m.release_id=lease.release_id),
  entries AS MATERIALIZED(SELECT c.candidate_id,c.version,e FROM chosen x JOIN content_intake.candidate_versions c ON c.candidate_id=x.candidate_id AND c.version=x.candidate_version CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e)
  SELECT coalesce(jsonb_agg(jsonb_build_object('objectId',m.media_object_id,'payloadObjectId',o.payload_object_id,'sha256',m.sha256,'bytes',m.bytes,'mime',m.mime,
    'sourceId',m.source_id,'rowId',m.row_id,'businessEntryId',r.business_entry_id,'productRefIds',(SELECT coalesce(jsonb_agg(x->>'id'),'[]') FROM jsonb_array_elements(e->'productRefs') x),
    'scenarioRefIds',(SELECT coalesce(jsonb_agg(x->>'id'),'[]') FROM jsonb_array_elements(e->'scenarioRefs') x),'familySourceId',e->>'familySourceId',
    'operation',e->>'operation','effectiveFrom',e->'effectiveFrom','effectiveTo',e->'effectiveTo') ORDER BY m.source_id,m.row_id,m.ordinal,m.media_object_id),'[]') INTO result
  FROM content_intake.sop_release_media m JOIN content_intake.sop_media_objects o ON o.media_object_id=m.media_object_id
    JOIN content_intake.sop_candidate_rows r ON r.candidate_id=m.candidate_id AND r.candidate_version=m.candidate_version AND r.source_id=m.source_id AND r.row_id=m.row_id
    JOIN entries ON entries.candidate_id=m.candidate_id AND entries.version=m.candidate_version AND e->>'businessEntryId'=r.business_entry_id
    JOIN content_intake.entitlement_scopes es ON es.entitlement_hash=lease.entitlement_hash AND es.source_id=m.source_id
    JOIN content_intake.sources s ON s.source_id=m.source_id
  WHERE m.release_id=lease.release_id AND e->>'operation'='upsert' AND (e->>'effectiveFrom')::timestamptz<=lease.issued_at
    AND (e->>'effectiveTo' IS NULL OR (e->>'effectiveTo')::timestamptz>lease.issued_at)
    AND content_intake.authorization_deadline(p_actor,'query',s.scope_id,s.source_id,clock_timestamp()) IS NOT NULL;
  RETURN jsonb_build_object('items',result);
END $$;
ALTER FUNCTION content_intake.read_sop_release_assets(text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_release_assets(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_release_assets(text,text,text) TO intake_usage;

-- Preserve the old stage signature and ACL while matching the successor row key.
CREATE OR REPLACE FUNCTION content_intake.stage_sop_candidate_media(
  p_candidate_id content_intake.identifier,
  p_version content_intake.version,
  p_source_id content_intake.identifier,
  p_actor_id content_intake.identifier,
  p_media_object_id content_intake.identifier,
  p_sha256 content_intake.sha256,
  p_bytes bigint,
  p_mime text,
  p_sheet text,
  p_row integer,
  p_column integer,
  p_ordinal integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = content_intake, public, pg_temp
AS $$
DECLARE
  v_state text;
  v_row_id text := 'sop:' || p_sheet || ':' || p_row::text;
BEGIN
  SELECT state INTO v_state
  FROM content_intake.candidate_versions
  WHERE candidate_id = p_candidate_id AND version = p_version AND source_id = p_source_id;
  IF NOT FOUND OR v_state IN ('published','publishing') THEN
    RAISE EXCEPTION 'SOP_ROW_IN_USE';
  END IF;
  INSERT INTO content_intake.sop_media_objects (media_object_id, source_id, actor_id, sha256, bytes, mime, state, created_at)
  VALUES (p_media_object_id, p_source_id, p_actor_id, p_sha256, p_bytes, p_mime, 'staged', clock_timestamp())
  ON CONFLICT (media_object_id) DO NOTHING;
  INSERT INTO content_intake.sop_candidate_media (
    candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes
  ) VALUES (
    p_candidate_id, p_version, p_source_id, p_media_object_id, p_sheet, p_row, p_column, v_row_id, p_ordinal, p_sha256, p_mime, p_bytes
  ) ON CONFLICT (candidate_id, candidate_version, row_id, media_object_id, ordinal) DO NOTHING;
END;
$$;
