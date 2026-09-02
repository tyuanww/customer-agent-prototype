-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0006_definer_functions_and_triggers; source schema.v1.12 lines 2772-6782
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION trg_release_items_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'release_items history is immutable', DETAIL = 'SOURCE_HISTORY_IMMUTABLE';
END;
$$;
DROP TRIGGER IF EXISTS release_items_immutable ON release_items;
CREATE TRIGGER release_items_immutable
  BEFORE UPDATE OR DELETE ON release_items
  FOR EACH ROW EXECUTE FUNCTION trg_release_items_immutable();

CREATE OR REPLACE FUNCTION trg_source_history_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'ZA005',
    MESSAGE = pg_catalog.format('%I source/audit history is immutable', TG_TABLE_NAME),
    DETAIL = 'SOURCE_HISTORY_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS authoritative_source_versions_immutable ON authoritative_source_versions;
CREATE TRIGGER authoritative_source_versions_immutable
  BEFORE UPDATE OR DELETE ON authoritative_source_versions
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS authoritative_source_suspensions_immutable ON authoritative_source_suspensions;
CREATE TRIGGER authoritative_source_suspensions_immutable
  BEFORE UPDATE OR DELETE ON authoritative_source_suspensions
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS intent_taxonomy_versions_immutable ON intent_taxonomy_versions;
CREATE TRIGGER intent_taxonomy_versions_immutable
  BEFORE UPDATE OR DELETE ON intent_taxonomy_versions
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS intent_taxonomy_entries_immutable ON intent_taxonomy_entries;
CREATE TRIGGER intent_taxonomy_entries_immutable
  BEFORE UPDATE OR DELETE ON intent_taxonomy_entries
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS intent_taxonomy_mappings_immutable ON intent_taxonomy_mappings;
CREATE TRIGGER intent_taxonomy_mappings_immutable
  BEFORE UPDATE OR DELETE ON intent_taxonomy_mappings
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS script_questions_immutable ON script_questions;
CREATE TRIGGER script_questions_immutable
  BEFORE UPDATE OR DELETE ON script_questions
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS content_quality_review_plans_immutable ON content_quality_review_plans;
CREATE TRIGGER content_quality_review_plans_immutable
  BEFORE UPDATE OR DELETE ON content_quality_review_plans
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS content_quality_review_evidence_immutable ON content_quality_review_evidence;
CREATE TRIGGER content_quality_review_evidence_immutable
  BEFORE UPDATE OR DELETE ON content_quality_review_evidence
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS content_review_decisions_immutable ON content_review_decisions;
CREATE TRIGGER content_review_decisions_immutable
  BEFORE UPDATE OR DELETE ON content_review_decisions
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS import_batch_source_bindings_immutable ON import_batch_source_bindings;
CREATE TRIGGER import_batch_source_bindings_immutable
  BEFORE UPDATE OR DELETE ON import_batch_source_bindings
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS change_audits_immutable ON change_audits;
CREATE TRIGGER change_audits_immutable
  BEFORE UPDATE OR DELETE ON change_audits
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS source_denial_audits_immutable ON source_denial_audits;
CREATE TRIGGER source_denial_audits_immutable
  BEFORE UPDATE OR DELETE ON source_denial_audits
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();
DROP TRIGGER IF EXISTS snapshot_offline_leases_immutable ON snapshot_offline_leases;
CREATE TRIGGER snapshot_offline_leases_immutable
  BEFORE UPDATE OR DELETE ON snapshot_offline_leases
  FOR EACH ROW EXECUTE FUNCTION trg_source_history_immutable();

-- Cross-table semantic lineage cannot be a CHECK constraint. Publish/search/rollback use this
-- stable reader and INSERT is independently fenced below. Every payload field that identifies the
-- source asset must match, and only an active asset is eligible.
CREATE OR REPLACE FUNCTION public.content_questions_source_assets_are_active(
  p_questions JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
STRICT
PARALLEL RESTRICTED
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF public.content_questions_are_valid(p_questions) IS DISTINCT FROM TRUE THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
    LEFT JOIN public.semantic_source_assets asset
      ON asset.source_asset_id = question.value ->> 'source_asset_id'
     AND asset.source = question.value ->> 'source'
     AND asset.origin_fingerprint_key_version = question.value ->> 'origin_fingerprint_key_version'
     AND asset.origin_fingerprint = question.value ->> 'origin_fingerprint'
    WHERE asset.source_asset_id IS NULL
       OR asset.lifecycle <> 'active'
       OR asset.promotion_review_ref IS DISTINCT FROM question.value ->> 'promotion_review_ref'
       OR asset.promoted_by_role IS DISTINCT FROM question.value ->> 'promoted_by_role'
       OR asset.promoted_at IS DISTINCT FROM CASE
         WHEN question.value ->> 'promoted_at' IS NULL THEN NULL
         ELSE (question.value ->> 'promoted_at')::TIMESTAMPTZ
       END
       OR asset.source_query_id IS DISTINCT FROM question.value ->> 'source_query_id'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.content_questions_source_assets_are_active(JSONB) FROM PUBLIC;

-- Closed public Question mapper shared by snapshot and any future controlled public reader. It does
-- not expose source query/asset ids, origin HMAC/key, promotion evidence, reviewer roles or times.
CREATE OR REPLACE FUNCTION public.content_public_questions(
  p_questions JSONB
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'question_id', question.value ->> 'question_id',
        'question_version', (question.value ->> 'question_version')::INTEGER,
        'question_text', question.value ->> 'question_text',
        'question_hash', question.value ->> 'question_hash',
        'semantic_family_id', question.value ->> 'semantic_family_id'
      ) ORDER BY question.ordinality
    ),
    '[]'::jsonb
  )
  FROM pg_catalog.jsonb_array_elements(p_questions)
    WITH ORDINALITY AS question(value, ordinality)
$$;
REVOKE ALL ON FUNCTION public.content_public_questions(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trg_semantic_source_asset_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'semantic source assets cannot be deleted', DETAIL = 'SEMANTIC_ASSET_IMMUTABLE';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF pg_catalog.current_setting('app.semantic_asset_write', true) IS DISTINCT FROM 'publish' THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'semantic source asset insert requires publish fence', DETAIL = 'INV_BYPASS';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_catalog.current_setting('app.semantic_asset_write', true) IS DISTINCT FROM 'retire'
     OR OLD.lifecycle IS DISTINCT FROM 'active'
     OR NEW.lifecycle IS DISTINCT FROM 'retired'
     OR NEW.source_asset_id IS DISTINCT FROM OLD.source_asset_id
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.origin_fingerprint IS DISTINCT FROM OLD.origin_fingerprint
     OR NEW.origin_fingerprint_key_version IS DISTINCT FROM OLD.origin_fingerprint_key_version
     OR NEW.promotion_review_ref IS DISTINCT FROM OLD.promotion_review_ref
     OR NEW.promoted_by_role IS DISTINCT FROM OLD.promoted_by_role
     OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.source_query_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'semantic source asset transition is immutable', DETAIL = 'SEMANTIC_ASSET_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trg_semantic_source_asset_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS semantic_source_asset_guard ON semantic_source_assets;
CREATE TRIGGER semantic_source_asset_guard
  BEFORE INSERT OR UPDATE OR DELETE ON semantic_source_assets
  FOR EACH ROW EXECUTE FUNCTION trg_semantic_source_asset_guard();

CREATE OR REPLACE FUNCTION retire_semantic_source_asset(
  p_source_asset_id TEXT,
  p_retirement_evd TEXT,
  p_actor_subject_hash TEXT,
  p_actor_subject_key_version TEXT,
  p_actor_role TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_asset public.semantic_source_assets%ROWTYPE;
BEGIN
  IF p_source_asset_id IS NULL OR p_source_asset_id !~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
     OR p_retirement_evd IS NULL OR p_retirement_evd !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'
     OR p_actor_subject_hash IS NULL OR p_actor_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_actor_subject_key_version IS NULL
     OR p_actor_subject_key_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR p_actor_role IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'semantic asset retirement capability or payload is invalid', DETAIL = 'FORBIDDEN';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'publish/retirement lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  SELECT asset.* INTO v_asset
  FROM public.semantic_source_assets asset
  WHERE asset.source_asset_id = p_source_asset_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'semantic source asset not found', DETAIL = 'NOT_FOUND';
  END IF;
  IF v_asset.lifecycle = 'retired' THEN
    IF v_asset.retirement_evd IS DISTINCT FROM p_retirement_evd
       OR v_asset.retired_by_subject_hash IS DISTINCT FROM p_actor_subject_hash
       OR v_asset.retired_by_subject_key_version IS DISTINCT FROM p_actor_subject_key_version THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'retirement replay differs from tombstone', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
    END IF;
    RETURN p_source_asset_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.content_current current_release
    JOIN public.release_items item ON item.release_id = current_release.current_release_id
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(item.questions_json) question(value)
    WHERE question.value ->> 'source_asset_id' = p_source_asset_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'current release still uses semantic source asset', DETAIL = 'SEMANTIC_ASSET_IN_USE';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.snapshot_offline_leases lease
    JOIN public.release_items item ON item.release_id = lease.release_id
    CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(item.questions_json) question(value)
    WHERE lease.expires_at > pg_catalog.clock_timestamp()
      AND question.value ->> 'source_asset_id' = p_source_asset_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'unexpired snapshot lease still uses semantic source asset', DETAIL = 'SEMANTIC_ASSET_IN_USE';
  END IF;

  PERFORM pg_catalog.set_config('app.semantic_asset_write', 'retire', true);
  UPDATE public.semantic_source_assets
  SET lifecycle = 'retired',
      source_query_id = NULL,
      retirement_evd = p_retirement_evd,
      retired_by_subject_hash = p_actor_subject_hash,
      retired_by_subject_key_version = p_actor_subject_key_version,
      retired_at = pg_catalog.clock_timestamp()
  WHERE source_asset_id = p_source_asset_id AND lifecycle = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'semantic source asset retirement conflict', DETAIL = 'CONFLICT';
  END IF;

  INSERT INTO public.change_audits(
    change_id, action, actor_role, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    'semantic_source_asset_retired',
    p_actor_role,
    'retire_semantic_source_asset',
    pg_catalog.jsonb_build_object(
      'source_asset_id', p_source_asset_id,
      'retirement_evd', p_retirement_evd,
      'actor_subject_hash', p_actor_subject_hash,
      'actor_subject_key_version', p_actor_subject_key_version
    ),
    pg_catalog.clock_timestamp()
  );
  RETURN p_source_asset_id;
END;
$$;
REVOKE ALL ON FUNCTION retire_semantic_source_asset(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- A source can be suspended only through the owner-only definer operation below. It shares the
-- publish advisory lock, so "publish passed the source check" and "source became suspended" cannot
-- both commit across the same serialization point. A committed suspension makes reads fail closed.
CREATE OR REPLACE FUNCTION trg_authoritative_source_suspension_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.source_governance_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA005',
      MESSAGE = 'authoritative source suspension requires governance fence',
      DETAIL = 'INV_BYPASS';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS authoritative_source_suspension_insert_guard ON authoritative_source_suspensions;
CREATE TRIGGER authoritative_source_suspension_insert_guard
  BEFORE INSERT ON authoritative_source_suspensions
  FOR EACH ROW EXECUTE FUNCTION trg_authoritative_source_suspension_insert_guard();

CREATE OR REPLACE FUNCTION suspend_authoritative_source(
  p_source_version_id TEXT,
  p_reason_code TEXT,
  p_evidence_ref TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_suspension_id TEXT;
  v_domain TEXT;
  v_source_ref TEXT;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'only owner may suspend an authoritative source', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_source_version_id IS NULL OR pg_catalog.btrim(p_source_version_id) = ''
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'SOURCE_REVOKED','SOURCE_COMPROMISED','SOURCE_EXPIRED','SOURCE_REPLACED'
     )
     OR p_evidence_ref IS NULL OR pg_catalog.btrim(p_evidence_ref) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'source version, reason and evidence are required', DETAIL = 'VALIDATION';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'source governance lock not acquired', DETAIL = 'CONFLICT';
  END IF;

  SELECT asv.domain, asv.source_ref
  INTO v_domain, v_source_ref
  FROM public.authoritative_source_versions asv
  WHERE asv.source_version_id = p_source_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'authoritative source version does not exist', DETAIL = 'NOT_FOUND';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.authoritative_source_suspensions susp
    WHERE susp.source_version_id = p_source_version_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'authoritative source version is already suspended', DETAIL = 'SOURCE_SUSPENDED';
  END IF;

  PERFORM pg_catalog.set_config('app.source_governance_write', 'on', true);
  v_suspension_id := 'susp_' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.authoritative_source_suspensions(
    suspension_id, source_version_id, reason_code, evidence_ref,
    suspended_by, suspended_by_role, suspended_at
  ) VALUES (
    v_suspension_id, p_source_version_id, p_reason_code, p_evidence_ref,
    p_actor_user_id, p_actor_role, now()
  );
  INSERT INTO public.change_audits(
    change_id, script_id, action, before_hash, after_hash, actor_role, actor_user_id,
    source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    NULL,
    'authoritative_source_suspended',
    NULL,
    NULL,
    p_actor_role,
    p_actor_user_id,
    'suspend_authoritative_source',
    pg_catalog.jsonb_build_object(
      'source_version_id', p_source_version_id,
      'source_ref', v_source_ref,
      'domain', v_domain,
      'reason_code', p_reason_code,
      'evidence_ref', p_evidence_ref
    ),
    now()
  );
  RETURN v_suspension_id;
END;
$$;
REVOKE ALL ON FUNCTION suspend_authoritative_source(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- IMPORTANT transaction contract: this function MUST run only after the denied business transaction
-- has rolled back, on a fresh transaction/connection, and that audit transaction MUST commit before
-- the API returns the denial. Calling it inside the doomed business transaction is non-conforming.
-- denial_key is an HMAC-derived idempotency key; a replay with a different safe body is rejected.
CREATE OR REPLACE FUNCTION record_source_denial_audit(
  p_denial_key TEXT,
  p_operation TEXT,
  p_reason_code TEXT,
  p_actor_subject_hash TEXT,
  p_hash_key_version TEXT,
  p_actor_role TEXT,
  p_release_id TEXT,
  p_source_version_id TEXT,
  p_source_binding_hash TEXT,
  p_diagnostic_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing public.source_denial_audits%ROWTYPE;
BEGIN
  IF p_denial_key IS NULL OR p_denial_key !~ '^sda_[0-9a-f]{64}$'
     OR p_operation IS NULL OR p_operation NOT IN (
       'content_import','content_publish','content_rollback','search',
       'announce_current','announce_snapshot','announce_ack','source_suspend'
     )
     OR p_reason_code IS NULL OR p_reason_code NOT IN (
       'SOURCE_NOT_REGISTERED','SOURCE_NOT_ELIGIBLE','SOURCE_SUSPENDED',
       'SOURCE_DOMAIN_MISMATCH','SOURCE_SNAPSHOT_MISMATCH','SOURCE_SET_INCOMPLETE',
       'SOURCE_BASE_RELEASE_STALE','SOURCE_BINDING_HASH_MISMATCH','SOURCE_GATE_NOT_READY',
       'OFFLINE_LEASE_INVALID','OFFLINE_LEASE_EXPIRED','OFFLINE_LEASE_BINDING_MISMATCH'
     )
     OR p_actor_subject_hash IS NULL OR p_actor_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_hash_key_version IS NULL OR pg_catalog.btrim(p_hash_key_version) = ''
     OR p_actor_role IS NULL OR p_actor_role NOT IN ('agent','coach','owner')
     OR (p_release_id IS NOT NULL AND pg_catalog.btrim(p_release_id) = '')
     OR (p_source_version_id IS NOT NULL AND p_source_version_id !~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$')
     OR (p_source_binding_hash IS NOT NULL AND p_source_binding_hash !~ '^[0-9a-f]{64}$')
     OR p_diagnostic_id IS NULL OR p_diagnostic_id !~ '^diag_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid safe source denial audit', DETAIL = 'VALIDATION';
  END IF;

  INSERT INTO public.source_denial_audits(
    denial_key, operation, reason_code, actor_subject_hash, hash_key_version,
    actor_role, release_id, source_version_id, source_binding_hash, diagnostic_id, committed_at
  ) VALUES (
    p_denial_key, p_operation, p_reason_code, p_actor_subject_hash, p_hash_key_version,
    p_actor_role, p_release_id, p_source_version_id, p_source_binding_hash,
    p_diagnostic_id, pg_catalog.clock_timestamp()
  )
  ON CONFLICT (denial_key) DO NOTHING;

  SELECT * INTO STRICT v_existing
  FROM public.source_denial_audits sda
  WHERE sda.denial_key = p_denial_key;
  IF v_existing.operation IS DISTINCT FROM p_operation
     OR v_existing.reason_code IS DISTINCT FROM p_reason_code
     OR v_existing.actor_subject_hash IS DISTINCT FROM p_actor_subject_hash
     OR v_existing.hash_key_version IS DISTINCT FROM p_hash_key_version
     OR v_existing.actor_role IS DISTINCT FROM p_actor_role
     OR v_existing.release_id IS DISTINCT FROM p_release_id
     OR v_existing.source_version_id IS DISTINCT FROM p_source_version_id
     OR v_existing.source_binding_hash IS DISTINCT FROM p_source_binding_hash
     OR v_existing.diagnostic_id IS DISTINCT FROM p_diagnostic_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'denial audit key was reused with a different safe body', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;
  RETURN p_denial_key;
END;
$$;
REVOKE ALL ON FUNCTION record_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Workload wrappers keep the shared writer private and make the operation set executable. Runtime
-- cannot claim publish/admin denials; admin cannot use its capability as a general search logger.
CREATE OR REPLACE FUNCTION record_runtime_source_denial_audit(
  p_denial_key TEXT,
  p_operation TEXT,
  p_reason_code TEXT,
  p_actor_subject_hash TEXT,
  p_hash_key_version TEXT,
  p_actor_role TEXT,
  p_release_id TEXT,
  p_source_version_id TEXT,
  p_source_binding_hash TEXT,
  p_diagnostic_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_operation NOT IN ('content_import','search','announce_current','announce_snapshot','announce_ack') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'runtime source-denial operation is not permitted', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN public.record_source_denial_audit(
    p_denial_key, p_operation, p_reason_code, p_actor_subject_hash, p_hash_key_version,
    p_actor_role, p_release_id, p_source_version_id, p_source_binding_hash, p_diagnostic_id
  );
END;
$$;
REVOKE ALL ON FUNCTION record_runtime_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION record_admin_source_denial_audit(
  p_denial_key TEXT,
  p_operation TEXT,
  p_reason_code TEXT,
  p_actor_subject_hash TEXT,
  p_hash_key_version TEXT,
  p_actor_role TEXT,
  p_release_id TEXT,
  p_source_version_id TEXT,
  p_source_binding_hash TEXT,
  p_diagnostic_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_operation NOT IN ('content_publish','content_rollback','source_suspend') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'admin source-denial operation is not permitted', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN public.record_source_denial_audit(
    p_denial_key, p_operation, p_reason_code, p_actor_subject_hash, p_hash_key_version,
    p_actor_role, p_release_id, p_source_version_id, p_source_binding_hash, p_diagnostic_id
  );
END;
$$;
REVOKE ALL ON FUNCTION record_admin_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trg_import_source_binding_insert_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.import_binding_write', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import source bindings require enqueue fence', DETAIL = 'INV_BYPASS';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS import_source_binding_insert_guard ON import_batch_source_bindings;
CREATE TRIGGER import_source_binding_insert_guard
  BEFORE INSERT ON import_batch_source_bindings
  FOR EACH ROW EXECUTE FUNCTION trg_import_source_binding_insert_guard();

CREATE OR REPLACE FUNCTION trg_release_source_binding_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' OR current_setting('app.publishing', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'release source binding history is immutable', DETAIL = 'SOURCE_HISTORY_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS release_source_binding_guard ON release_source_bindings;
CREATE TRIGGER release_source_binding_guard
  BEFORE INSERT OR UPDATE OR DELETE ON release_source_bindings
  FOR EACH ROW EXECUTE FUNCTION trg_release_source_binding_guard();

CREATE OR REPLACE FUNCTION trg_release_source_set_complete()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count INT;
  v_hash TEXT;
  v_noncanonical BOOLEAN;
  v_suspended BOOLEAN;
BEGIN
  SELECT
    pg_catalog.count(*)::INT,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(rsb.domain || ':' || rsb.source_version_id, '|' ORDER BY rsb.domain),
      'UTF8'
    ), 'sha256'), 'hex'),
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE),
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE)
  INTO v_count, v_hash, v_noncanonical, v_suspended
  FROM public.release_source_bindings rsb
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = rsb.source_version_id AND asv.domain = rsb.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = rsb.source_version_id
  WHERE rsb.release_id = NEW.release_id;

  IF v_count <> 4 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'release requires exactly four authoritative source domains', DETAIL = 'SOURCE_SET_INCOMPLETE';
  END IF;
  IF v_noncanonical THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release contains a reference-only source', DETAIL = 'SOURCE_NOT_ELIGIBLE';
  END IF;
  IF v_suspended THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'release contains a suspended source', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF NEW.source_binding_hash IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'release source binding hash mismatch', DETAIL = 'SOURCE_BINDING_HASH_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS release_source_set_complete ON content_releases;
CREATE CONSTRAINT TRIGGER release_source_set_complete
  AFTER INSERT ON content_releases
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION trg_release_source_set_complete();

CREATE OR REPLACE FUNCTION trg_scripts_protect_published()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'published'
     AND (
       NEW.answer_text IS DISTINCT FROM OLD.answer_text
       OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
       OR NEW.source_ref IS DISTINCT FROM OLD.source_ref
       OR NEW.source_version_id IS DISTINCT FROM OLD.source_version_id
       OR NEW.owner_role IS DISTINCT FROM OLD.owner_role
       OR NEW.review_due_at IS DISTINCT FROM OLD.review_due_at
       OR NEW.platform_scope IS DISTINCT FROM OLD.platform_scope
       OR NEW.product_scope_type IS DISTINCT FROM OLD.product_scope_type
       OR NEW.product_scope_refs IS DISTINCT FROM OLD.product_scope_refs
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
       OR NEW.intent_taxonomy_version IS DISTINCT FROM OLD.intent_taxonomy_version
       OR NEW.intent_id IS DISTINCT FROM OLD.intent_id
       OR NEW.risk_level IS DISTINCT FROM OLD.risk_level
       OR NEW.risk_categories IS DISTINCT FROM OLD.risk_categories
       OR NEW.has_conflict IS DISTINCT FROM OLD.has_conflict
       OR NEW.review_mode IS DISTINCT FROM OLD.review_mode
       OR NEW.primary_reviewer_id IS DISTINCT FROM OLD.primary_reviewer_id
       OR NEW.primary_reviewer_role IS DISTINCT FROM OLD.primary_reviewer_role
       OR NEW.primary_review_evd IS DISTINCT FROM OLD.primary_review_evd
       OR NEW.secondary_reviewer_id IS DISTINCT FROM OLD.secondary_reviewer_id
       OR NEW.secondary_reviewer_role IS DISTINCT FROM OLD.secondary_reviewer_role
       OR NEW.secondary_review_evd IS DISTINCT FROM OLD.secondary_review_evd
       OR NEW.placeholder_keys IS DISTINCT FROM OLD.placeholder_keys
       OR NEW.questions_json IS DISTINCT FROM OLD.questions_json
     )
     AND current_setting('app.publishing', true) IS DISTINCT FROM 'on'
  THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'published script body only mutable during app.publishing=on', DETAIL = 'INV_BYPASS';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS scripts_protect_published ON scripts;
CREATE TRIGGER scripts_protect_published
  BEFORE UPDATE ON scripts
  FOR EACH ROW EXECUTE FUNCTION trg_scripts_protect_published();

-- A staged batch is immutable input to publish. Only the fenced validator may write rows while the
-- owning batch is still validating; no lost worker or API code can patch a staged/published batch.
CREATE OR REPLACE FUNCTION trg_staging_mutable_while_validating()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_batch_id TEXT;
  v_status TEXT;
BEGIN
  v_batch_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.import_batch_id ELSE NEW.import_batch_id END;
  SELECT status INTO v_status
  FROM public.import_batches
  WHERE import_batch_id = v_batch_id;
  IF v_status IS DISTINCT FROM 'validating' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'staging rows are mutable only while batch is validating', DETAIL = 'INV_BYPASS';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS staging_mutable_while_validating ON staging_scripts;
CREATE TRIGGER staging_mutable_while_validating
  BEFORE INSERT OR UPDATE OR DELETE ON staging_scripts
  FOR EACH ROW EXECUTE FUNCTION trg_staging_mutable_while_validating();

DO $content_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.scripts'::pg_catalog.regclass AND conname = 'scripts_campaign_requires_window') THEN
    ALTER TABLE scripts ADD CONSTRAINT scripts_campaign_requires_window CHECK (
      category <> 'campaign' OR (effective_from IS NOT NULL AND effective_to IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.staging_scripts'::pg_catalog.regclass AND conname = 'staging_campaign_requires_window') THEN
    ALTER TABLE staging_scripts ADD CONSTRAINT staging_campaign_requires_window CHECK (
      operation = 'withdraw' OR category <> 'campaign'
      OR (effective_from IS NOT NULL AND effective_to IS NOT NULL)
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.release_items'::pg_catalog.regclass AND conname = 'release_campaign_requires_window') THEN
    ALTER TABLE release_items ADD CONSTRAINT release_campaign_requires_window CHECK (
      category <> 'campaign' OR (effective_from IS NOT NULL AND effective_to IS NOT NULL)
    );
  END IF;
END
$content_constraints$;

CREATE TABLE IF NOT EXISTS rewrite_logs (
  rewrite_id         TEXT PRIMARY KEY,
  source_script_id   TEXT,
  proposed_text      TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending_review','approved','rejected')),
  model              TEXT,
  prompt_hash        TEXT,
  tenant_id          TEXT NOT NULL DEFAULT 'default',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Policy flag write-only via function (dangerous flags audited)
CREATE OR REPLACE FUNCTION set_policy_flag(
  p_flag_key TEXT,
  p_flag_value BOOLEAN,
  p_actor_user_id TEXT,
  p_actor_role TEXT,
  p_adr_id TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_before BOOLEAN;
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'only owner may set policy flags', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_flag_key IS NULL OR pg_catalog.btrim(p_flag_key) = '' OR p_flag_value IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'policy flag key and value are required', DETAIL = 'VALIDATION';
  END IF;
  IF p_flag_key NOT IN ('rewrite','auto_send','autofill_adapter','llm_ranker','metrics_experimental_kpi') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = pg_catalog.format('unknown or deployment-only policy flag %s', p_flag_key), DETAIL = 'VALIDATION';
  END IF;
  -- Phase1 hard gate: ADR is evidence, not permission to cross a lifecycle boundary.
  IF p_flag_key IN ('rewrite','auto_send') AND p_flag_value IS TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = pg_catalog.format('phase1 forbids enabling %s even with adr_id', p_flag_key), DETAIL = 'POLICY_DENIED';
  END IF;
  SELECT flag_value INTO v_before FROM public.policy_flags WHERE flag_key = p_flag_key FOR UPDATE;
  INSERT INTO public.policy_flags(flag_key, flag_value, updated_at, updated_by)
  VALUES (p_flag_key, p_flag_value, now(), p_actor_user_id)
  ON CONFLICT (flag_key) DO UPDATE
    SET flag_value = EXCLUDED.flag_value,
        updated_at = now(),
        updated_by = EXCLUDED.updated_by;
  INSERT INTO public.change_audits(
    change_id, script_id, action, before_hash, after_hash, actor_role, actor_user_id,
    source, metadata, created_at
  )
  VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    NULL,
    'policy_set',
    NULL,
    NULL,
    p_actor_role,
    p_actor_user_id,
    'set_policy_flag',
    pg_catalog.jsonb_build_object(
      'flag_key', p_flag_key,
      'before_value', v_before,
      'after_value', p_flag_value,
      'adr_id', p_adr_id
    ),
    now()
  );
END;
$$;
REVOKE ALL ON FUNCTION set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Publish: MERGE semantics (prev current release_items ∪ staging overwrite by script_id).
-- Never "batch-only world". Empty ok-count → VALIDATION.
CREATE OR REPLACE FUNCTION publish_content_release(
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
BEGIN
  -- p_actor_role is a server-verified end-user claim used for policy/audit. DB ACL authenticates
  -- the isolated app_content_admin workload identity; the API must select that pool only after
  -- verified owner authorization. The parameter itself is not independent database authentication.
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'phase1 publish requires owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import_batch_id is required', DETAIL = 'VALIDATION';
  END IF;

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

  SELECT b.base_release_id, b.source_binding_hash
  INTO v_base, v_expected_source_hash
  FROM public.import_batches b
  WHERE b.import_batch_id = p_import_batch_id;

  SELECT c.current_release_id INTO v_prev
  FROM public.content_current c WHERE c.id = 1 FOR UPDATE;
  IF v_prev IS DISTINCT FROM v_base THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import was validated against a stale current release', DETAIL = 'SOURCE_BASE_RELEASE_STALE';
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
        OR s.content_hash IS DISTINCT FROM
          public.content_governance_hash(
            s.script_id, s.category, s.title, s.answer_text, s.source_ref, s.source_version_id,
            s.owner_role, s.review_due_at, s.platform_scope, s.product_scope_type,
            s.product_scope_refs, s.effective_from, s.effective_to,
            s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict,
            s.review_mode, s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
            s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
            s.placeholder_keys, s.questions_json
          )
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
  WHERE EXISTS (
    SELECT 1 FROM public.import_batch_source_bindings ib
    WHERE ib.import_batch_id = p_import_batch_id AND ib.domain = sc.category
  );

  -- Upsert live scripts from staging upserts only.
  INSERT INTO public.scripts AS sc (
    script_id, category, title, answer_text, status, version, content_hash,
    source_ref, source_version_id, platform_scope, product_scope_type, product_scope_refs,
    campaign_tag, effective_from, effective_to,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    priority, owner_role, review_due_at, created_at, updated_at, published_at, tenant_id
  )
  SELECT
    s.script_id, s.category, s.title, s.answer_text, 'published', 1, s.content_hash,
    s.source_ref, s.source_version_id, s.platform_scope, s.product_scope_type, s.product_scope_refs,
    s.campaign_tag, s.effective_from, s.effective_to,
    s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode,
    s.primary_reviewer_id, s.primary_reviewer_role, s.primary_review_evd,
    s.secondary_reviewer_id, s.secondary_reviewer_role, s.secondary_review_evd,
    s.placeholder_keys, s.questions_json,
    0, s.owner_role, s.review_due_at, now(), now(), now(), 'default'
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
    'published', v_source_hash, p_actor_user_id, p_actor_role, now(), 'default'
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
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, x.script_id, x.script_version, x.content_hash, x.answer_text, x.title, x.category,
    x.source_ref, x.source_version_id, x.owner_role, x.review_due_at,
    x.effective_from, x.effective_to, x.platform_scope, x.product_scope_type, x.product_scope_refs,
    x.intent_taxonomy_version, x.intent_id, x.risk_level, x.risk_categories, x.has_conflict, x.review_mode,
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
      s.intent_taxonomy_version, s.intent_id, s.risk_level, s.risk_categories, s.has_conflict, s.review_mode,
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
      ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode,
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

  release_id := v_release_id;
  release_seq := v_seq;
  announcement_id := v_ann;
  source_binding_hash := v_source_hash;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Rollback never rewrites history: replay a target snapshot into a new monotonic release.
CREATE OR REPLACE FUNCTION rollback_content_release(
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
BEGIN
  IF p_actor_role IS DISTINCT FROM 'owner'
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'phase1 rollback requires owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_target_release_id IS NULL OR pg_catalog.btrim(p_target_release_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'target_release_id is required', DETAIL = 'VALIDATION';
  END IF;

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
    'default'
  );

  INSERT INTO public.release_source_bindings(release_id, domain, source_version_id, created_at)
  SELECT v_release_id, rsb.domain, rsb.source_version_id, now()
  FROM public.release_source_bindings rsb
  WHERE rsb.release_id = p_target_release_id;

  INSERT INTO public.release_items(
    release_id, script_id, script_version, content_hash, answer_text, title, category,
    source_ref, source_version_id, owner_role, review_due_at,
    effective_from, effective_to, platform_scope, product_scope_type, product_scope_refs,
    intent_taxonomy_version, intent_id, risk_level, risk_categories, has_conflict, review_mode,
    primary_reviewer_id, primary_reviewer_role, primary_review_evd,
    secondary_reviewer_id, secondary_reviewer_role, secondary_review_evd,
    placeholder_keys, questions_json,
    search_document, search_fallback_text
  )
  SELECT
    v_release_id, ri.script_id, ri.script_version, ri.content_hash, ri.answer_text,
    ri.title, ri.category, ri.source_ref, ri.source_version_id, ri.owner_role, ri.review_due_at,
    ri.effective_from, ri.effective_to, ri.platform_scope, ri.product_scope_type, ri.product_scope_refs,
    ri.intent_taxonomy_version, ri.intent_id, ri.risk_level, ri.risk_categories, ri.has_conflict, ri.review_mode,
    ri.primary_reviewer_id, ri.primary_reviewer_role, ri.primary_review_evd,
    ri.secondary_reviewer_id, ri.secondary_reviewer_role, ri.secondary_review_evd,
    ri.placeholder_keys,
    ri.questions_json, ri.search_document, ri.search_fallback_text
  FROM public.release_items ri
  WHERE ri.release_id = p_target_release_id;

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
REVOKE ALL ON FUNCTION rollback_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Import 202 is legal only after this function atomically persists batch, requested source bindings and
-- outbox job. Rejected source attempts cannot be audited in this transaction because RAISE rolls it back:
-- the API MUST catch ZA001/ZA004, then write source_policy_rejected in a separate audit transaction/log
-- with only action, details.reason, diagnostic_id and safe source-version hashes (never URLs/tokens).
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
BEGIN
  IF p_actor_role IS NULL OR p_actor_role NOT IN ('coach','owner')
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import requires coach or owner', DETAIL = 'FORBIDDEN';
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
REVOKE ALL ON FUNCTION enqueue_content_import(TEXT,TEXT,TEXT,TEXT,BIGINT,JSONB,TEXT,TEXT) FROM PUBLIC;

-- Work-order import uses a separate capability boundary and job type. The persisted source object
-- must already be durable and checksum-verified before this function is called.
CREATE OR REPLACE FUNCTION enqueue_work_order_import(
  p_import_batch_id TEXT,
  p_tenant_scope TEXT,
  p_source_system TEXT,
  p_source_ref TEXT,
  p_source_file_name_safe TEXT,
  p_source_sha256 TEXT,
  p_source_size_bytes BIGINT,
  p_mapping_version TEXT,
  p_data_from TIMESTAMPTZ,
  p_data_to TIMESTAMPTZ,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(import_batch_id TEXT, status TEXT, job_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job_id TEXT;
BEGIN
  IF p_actor_role NOT IN ('coach','owner')
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'work-order import requires coach or owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = ''
     OR p_tenant_scope IS NULL OR pg_catalog.btrim(p_tenant_scope) = ''
     OR p_source_system IS NULL OR pg_catalog.btrim(p_source_system) = ''
     OR p_source_ref IS NULL OR pg_catalog.btrim(p_source_ref) = ''
     OR p_mapping_version IS NULL OR pg_catalog.btrim(p_mapping_version) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'work-order import identity is incomplete', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_file_name_safe IS NULL
     OR pg_catalog.length(p_source_file_name_safe) > 255
     OR pg_catalog.strpos(p_source_file_name_safe, '/') > 0
     OR pg_catalog.strpos(p_source_file_name_safe, pg_catalog.chr(92)) > 0
     OR pg_catalog.strpos(p_source_file_name_safe, '..') > 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'unsafe work-order source filename', DETAIL = 'VALIDATION';
  END IF;
  IF p_source_sha256 IS NULL OR p_source_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source_size_bytes IS NULL OR p_source_size_bytes < 0
     OR (p_data_from IS NOT NULL AND p_data_to IS NOT NULL AND p_data_to < p_data_from) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order source metadata', DETAIL = 'VALIDATION';
  END IF;

  v_job_id := 'job_work_order_' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.work_order_import_batches(
    import_batch_id, tenant_scope, source_system, source_ref, source_file_name_safe,
    source_sha256, source_size_bytes, mapping_version, status, data_from, data_to,
    actor_user_id, actor_role, created_at
  ) VALUES (
    p_import_batch_id, p_tenant_scope, p_source_system, p_source_ref, p_source_file_name_safe,
    p_source_sha256, p_source_size_bytes, p_mapping_version, 'validating', p_data_from, p_data_to,
    p_actor_user_id, p_actor_role, pg_catalog.clock_timestamp()
  );
  INSERT INTO public.outbox_jobs(job_id, job_type, payload, status, created_at, updated_at)
  VALUES (
    v_job_id,
    'work_order_import_validate',
    pg_catalog.jsonb_build_object(
      'import_batch_id', p_import_batch_id,
      'tenant_scope', p_tenant_scope,
      'source_ref', p_source_ref,
      'source_sha256', p_source_sha256,
      'source_size_bytes', p_source_size_bytes,
      'mapping_version', p_mapping_version
    ),
    'pending',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  );

  import_batch_id := p_import_batch_id;
  status := 'validating';
  job_id := v_job_id;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION enqueue_work_order_import(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT) FROM PUBLIC;

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
  IF p_actor_role IS DISTINCT FROM 'owner'
     AND (
       p_actor_role IS DISTINCT FROM 'coach'
       OR p_actor_user_id IS NULL
       OR v_batch.actor_user_id IS NULL
       OR v_batch.actor_user_id IS DISTINCT FROM p_actor_user_id
     ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import cancel requires owner or originating coach', DETAIL = 'FORBIDDEN';
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
REVOKE ALL ON FUNCTION cancel_content_import(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Monotonic, user-bound client ACK. ACK proves use of an unexpired bound lease but never updates the
-- immutable lease row and therefore cannot renew offline authorization. Drop the unsafe legacy overload.
DROP FUNCTION IF EXISTS ack_client_release(TEXT,TEXT,TEXT,BIGINT);
CREATE OR REPLACE FUNCTION ack_client_release(
  p_client_id TEXT,
  p_user_id TEXT,
  p_release_id TEXT,
  p_release_seq BIGINT,
  p_offline_lease_token TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing_user_id TEXT;
  v_existing_seq BIGINT;
  v_lease_release_seq BIGINT;
  v_source_binding_hash TEXT;
  v_lease_token_hash TEXT;
BEGIN
  IF p_client_id IS NULL OR pg_catalog.btrim(p_client_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'client_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'user_id is required', DETAIL = 'VALIDATION';
  END IF;
  IF p_release_id IS NULL OR pg_catalog.btrim(p_release_id) = '' OR p_release_seq IS NULL OR p_release_seq < 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'release_id and positive release_seq are required', DETAIL = 'VALIDATION';
  END IF;
  SELECT lease.release_seq, lease.source_binding_hash
  INTO v_lease_release_seq, v_source_binding_hash
  FROM public.validate_snapshot_offline_lease(
    p_offline_lease_token, p_client_id, p_user_id, p_release_id
  ) AS lease;
  IF v_lease_release_seq IS DISTINCT FROM p_release_seq THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'offline lease release sequence mismatch', DETAIL = 'OFFLINE_LEASE_BINDING_MISMATCH';
  END IF;
  v_lease_token_hash := pg_catalog.encode(public.digest(
    pg_catalog.convert_to(p_offline_lease_token, 'UTF8'), 'sha256'
  ), 'hex');

  LOOP
    SELECT user_id, last_seen_release_seq
    INTO v_existing_user_id, v_existing_seq
    FROM public.client_sync_state
    WHERE client_id = p_client_id
    FOR UPDATE;

    IF FOUND THEN
      IF v_existing_user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'client_id belongs to another user', DETAIL = 'FORBIDDEN';
      END IF;
      IF v_existing_seq IS NULL OR p_release_seq >= v_existing_seq THEN
        UPDATE public.client_sync_state
        SET last_seen_release_id = p_release_id,
            last_seen_release_seq = p_release_seq,
            last_seen_source_binding_hash = v_source_binding_hash,
            last_ack_lease_token_hash = v_lease_token_hash,
            last_ack_at = pg_catalog.clock_timestamp(),
            updated_at = pg_catalog.clock_timestamp()
        WHERE client_id = p_client_id;
        RETURN TRUE;
      END IF;
      RETURN FALSE;
    END IF;

    BEGIN
      INSERT INTO public.client_sync_state(
        client_id, user_id, last_seen_release_id, last_seen_release_seq,
        last_seen_source_binding_hash, last_ack_lease_token_hash, last_ack_at, updated_at
      ) VALUES (
        p_client_id, p_user_id, p_release_id, p_release_seq,
        v_source_binding_hash, v_lease_token_hash,
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
      );
      RETURN TRUE;
    EXCEPTION WHEN unique_violation THEN
      -- A concurrent first ACK won the insert; loop, lock, then enforce owner + monotonicity.
    END;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION ack_client_release(TEXT,TEXT,TEXT,BIGINT,TEXT) FROM PUBLIC;

-- Durable outbox fencing. Claiming a pending or expired-running job always advances lease_version.
CREATE OR REPLACE FUNCTION outbox_claim(
  p_job_type TEXT,
  p_lease_owner TEXT,
  p_lease_seconds INT DEFAULT 60
) RETURNS TABLE(
  claimed_job_id TEXT,
  claimed_job_type TEXT,
  job_payload JSONB,
  claimed_lease_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_job_type IS NULL OR p_lease_owner IS NULL OR pg_catalog.btrim(p_lease_owner) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'outbox job_type and lease_owner are required', DETAIL = 'VALIDATION';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid outbox lease', DETAIL = 'VALIDATION';
  END IF;

  -- Expired poison jobs are terminalized before another claim; they remain auditable as dead rows.
  -- Both import domains are excluded: their dedicated reconcilers must close job + batch atomically.
  UPDATE public.outbox_jobs
  SET status = 'dead',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = now(),
      last_error = coalesce(last_error, 'MAX_ATTEMPTS_EXHAUSTED'),
      updated_at = now()
  WHERE job_type = p_job_type
    AND p_job_type NOT IN ('import_validate','work_order_import_validate')
    AND status = 'running'
    AND (lease_expires_at IS NULL OR lease_expires_at <= pg_catalog.clock_timestamp())
    AND attempts >= max_attempts;

  RETURN QUERY
  WITH candidate AS (
    SELECT j.job_id
    FROM public.outbox_jobs j
    WHERE j.job_type = p_job_type
      AND (
        (j.status = 'pending' AND j.available_at <= pg_catalog.clock_timestamp())
        OR (
          j.status = 'running'
          AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= pg_catalog.clock_timestamp())
        )
      )
      AND j.attempts < j.max_attempts
    ORDER BY j.created_at, j.job_id
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_jobs j
  SET status = 'running',
      attempts = j.attempts + 1,
      lease_owner = p_lease_owner,
      lease_version = j.lease_version + 1,
      lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
      completed_at = NULL,
      updated_at = now()
  FROM candidate c
  WHERE j.job_id = c.job_id
  RETURNING j.job_id, j.job_type, j.payload, j.lease_version;
END;
$$;
REVOKE ALL ON FUNCTION outbox_claim(TEXT,TEXT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION outbox_heartbeat(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_extend_seconds INT DEFAULT 60
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
BEGIN
  IF p_extend_seconds IS NULL OR p_extend_seconds < 5 OR p_extend_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid outbox heartbeat extension', DETAIL = 'VALIDATION';
  END IF;
  UPDATE public.outbox_jobs
  SET lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_extend_seconds),
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION outbox_heartbeat(TEXT,TEXT,BIGINT,INT) FROM PUBLIC;

-- Retry is fenced too. A claimed job either returns to pending with bounded backoff or becomes dead.
CREATE OR REPLACE FUNCTION outbox_retry(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_retry_after_seconds INT DEFAULT 5,
  p_last_error TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_retry_after_seconds IS NULL OR p_retry_after_seconds < 1 OR p_retry_after_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid outbox retry delay', DETAIL = 'VALIDATION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.outbox_jobs
    WHERE job_id = p_job_id AND job_type IN ('import_validate','work_order_import_validate')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import validation must use its domain batch-closing retry function', DETAIL = 'INV_BYPASS';
  END IF;

  UPDATE public.outbox_jobs
  SET status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
      available_at = CASE
        WHEN attempts >= max_attempts THEN available_at
        ELSE pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_retry_after_seconds)
      END,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END,
      last_error = p_last_error,
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING status INTO v_status;

  IF v_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION outbox_retry(TEXT,TEXT,BIGINT,INT,TEXT) FROM PUBLIC;

-- Capability-scoped worker entrypoints. The import role never receives the generic outbox APIs,
-- so it cannot claim, extend or retry event_upload/rewrite/announce jobs.
-- Reaper boundary: an exhausted import job and its validating batch must become terminal together.
-- Lock order is always batch -> outbox, matching cancel/finalize/retry and preventing deadlock cycles.
CREATE OR REPLACE FUNCTION reconcile_exhausted_content_imports(
  p_limit INT DEFAULT 10
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_attempts INT;
  v_max_attempts INT;
  v_diagnostic_id TEXT;
  n INT;
  v_reconciled INT := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid import reconcile limit', DETAIL = 'VALIDATION';
  END IF;

  FOR r IN
    SELECT
      j.job_id,
      j.payload ->> 'import_batch_id' AS import_batch_id
    FROM public.outbox_jobs j
    WHERE j.job_type = 'import_validate'
      AND j.status = 'running'
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= pg_catalog.clock_timestamp())
      AND j.attempts >= j.max_attempts
    ORDER BY j.updated_at, j.job_id
    LIMIT p_limit
  LOOP
    IF r.import_batch_id IS NOT NULL AND pg_catalog.btrim(r.import_batch_id) <> '' THEN
      PERFORM 1
      FROM public.import_batches b
      WHERE b.import_batch_id = r.import_batch_id
      FOR UPDATE;
    END IF;

    UPDATE public.outbox_jobs j
    SET status = 'dead',
        lease_owner = NULL,
        lease_version = j.lease_version + 1,
        lease_expires_at = NULL,
        completed_at = now(),
        last_error = 'MAX_ATTEMPTS_EXHAUSTED',
        updated_at = now()
    WHERE j.job_id = r.job_id
      AND j.job_type = 'import_validate'
      AND j.status = 'running'
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= pg_catalog.clock_timestamp())
      AND j.attempts >= j.max_attempts
    RETURNING
      j.attempts,
      j.max_attempts
    INTO v_attempts, v_max_attempts;

    IF FOUND THEN
      v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
      UPDATE public.import_batches b
      SET status = 'failed',
          error_report = pg_catalog.jsonb_build_object(
            'code', 'MAX_ATTEMPTS_EXHAUSTED',
            'diagnostic_id', v_diagnostic_id,
            'attempts', v_attempts,
            'max_attempts', v_max_attempts
          ),
          finished_at = now()
      WHERE b.import_batch_id = r.import_batch_id
        AND b.status = 'validating';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 1 THEN
        INSERT INTO public.change_audits(
          change_id, action, actor_role, source, metadata, created_at
        ) VALUES (
          'chg_' || pg_catalog.gen_random_uuid()::text,
          'content_import_exhausted', 'system', 'reconcile_exhausted_content_imports',
          pg_catalog.jsonb_build_object(
            'diagnostic_id', v_diagnostic_id,
            'job_id', r.job_id,
            'import_batch_id', r.import_batch_id,
            'error_code', 'MAX_ATTEMPTS_EXHAUSTED'
          ),
          now()
        );
        v_reconciled := v_reconciled + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_reconciled;
END;
$$;
REVOKE ALL ON FUNCTION reconcile_exhausted_content_imports(INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_content_import_validation(
  p_lease_owner TEXT,
  p_lease_seconds INT DEFAULT 60
) RETURNS TABLE(
  claimed_job_id TEXT,
  claimed_job_type TEXT,
  job_payload JSONB,
  claimed_lease_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Claim remains a bounded short transaction: reap at most one poison job here. A scheduler may
  -- call the reconciler separately in <=10-row transactions; bulk reaping is deliberately forbidden.
  PERFORM public.reconcile_exhausted_content_imports(1);
  RETURN QUERY
  SELECT * FROM public.outbox_claim('import_validate', p_lease_owner, p_lease_seconds);
END;
$$;
REVOKE ALL ON FUNCTION claim_content_import_validation(TEXT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION heartbeat_content_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_extend_seconds INT DEFAULT 60
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.outbox_jobs
    WHERE job_id = p_job_id AND job_type = 'import_validate'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'job is outside import worker capability', DETAIL = 'INV_BYPASS';
  END IF;
  PERFORM public.outbox_heartbeat(p_job_id, p_lease_owner, p_lease_version, p_extend_seconds);
END;
$$;
REVOKE ALL ON FUNCTION heartbeat_content_import_validation(TEXT,TEXT,BIGINT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION reconcile_exhausted_work_order_imports(
  p_limit INT DEFAULT 10
) RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r RECORD;
  v_attempts INT;
  v_max_attempts INT;
  v_diagnostic_id TEXT;
  n INT;
  v_reconciled INT := 0;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 10 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order reconcile limit', DETAIL = 'VALIDATION';
  END IF;

  FOR r IN
    SELECT
      j.job_id,
      j.payload ->> 'import_batch_id' AS import_batch_id
    FROM public.outbox_jobs j
    WHERE j.job_type = 'work_order_import_validate'
      AND j.status = 'running'
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= pg_catalog.clock_timestamp())
      AND j.attempts >= j.max_attempts
    ORDER BY j.updated_at, j.job_id
    LIMIT p_limit
  LOOP
    IF r.import_batch_id IS NOT NULL AND pg_catalog.btrim(r.import_batch_id) <> '' THEN
      PERFORM 1
      FROM public.work_order_import_batches b
      WHERE b.import_batch_id = r.import_batch_id
      FOR UPDATE;
    END IF;

    UPDATE public.outbox_jobs j
    SET status = 'dead',
        lease_owner = NULL,
        lease_version = j.lease_version + 1,
        lease_expires_at = NULL,
        completed_at = now(),
        last_error = 'MAX_ATTEMPTS_EXHAUSTED',
        updated_at = now()
    WHERE j.job_id = r.job_id
      AND j.job_type = 'work_order_import_validate'
      AND j.status = 'running'
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= pg_catalog.clock_timestamp())
      AND j.attempts >= j.max_attempts
    RETURNING j.attempts, j.max_attempts
    INTO v_attempts, v_max_attempts;

    IF FOUND THEN
      v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
      UPDATE public.work_order_import_batches b
      SET status = 'failed',
          record_count = 0,
          accepted_count = 0,
          rejected_count = 0,
          error_report = pg_catalog.jsonb_build_object(
            'code', 'MAX_ATTEMPTS_EXHAUSTED',
            'diagnostic_id', v_diagnostic_id
          ),
          completed_at = now()
      WHERE b.import_batch_id = r.import_batch_id
        AND b.status = 'validating';
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n = 1 THEN
        INSERT INTO public.change_audits(
          change_id, action, actor_role, source, metadata, created_at
        ) VALUES (
          'chg_' || pg_catalog.gen_random_uuid()::text,
          'work_order_import_exhausted', 'system', 'reconcile_exhausted_work_order_imports',
          pg_catalog.jsonb_build_object(
            'diagnostic_id', v_diagnostic_id,
            'job_id', r.job_id,
            'import_batch_id', r.import_batch_id,
            'attempts', v_attempts,
            'max_attempts', v_max_attempts,
            'error_code', 'MAX_ATTEMPTS_EXHAUSTED'
          ),
          now()
        );
        v_reconciled := v_reconciled + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN v_reconciled;
END;
$$;
REVOKE ALL ON FUNCTION reconcile_exhausted_work_order_imports(INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION claim_work_order_import_validation(
  p_lease_owner TEXT,
  p_lease_seconds INT DEFAULT 60
) RETURNS TABLE(
  claimed_job_id TEXT,
  claimed_job_type TEXT,
  job_payload JSONB,
  claimed_lease_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Keep poison-job closure bounded; scheduled reconciliation may call the same function in <=10 rows.
  PERFORM public.reconcile_exhausted_work_order_imports(1);
  RETURN QUERY
  SELECT * FROM public.outbox_claim('work_order_import_validate', p_lease_owner, p_lease_seconds);
END;
$$;
REVOKE ALL ON FUNCTION claim_work_order_import_validation(TEXT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION heartbeat_work_order_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_extend_seconds INT DEFAULT 60
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.outbox_jobs
    WHERE job_id = p_job_id AND job_type = 'work_order_import_validate'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'job is outside work-order worker capability', DETAIL = 'INV_BYPASS';
  END IF;
  PERFORM public.outbox_heartbeat(p_job_id, p_lease_owner, p_lease_version, p_extend_seconds);
END;
$$;
REVOKE ALL ON FUNCTION heartbeat_work_order_import_validation(TEXT,TEXT,BIGINT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION retry_work_order_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_retry_after_seconds INT DEFAULT 5,
  p_last_error TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_import_batch_id TEXT;
  v_batch_status TEXT;
  v_status TEXT;
  v_attempts INT;
  v_max_attempts INT;
  v_safe_error_code TEXT;
  v_diagnostic_id TEXT;
BEGIN
  IF p_retry_after_seconds IS NULL OR p_retry_after_seconds < 1 OR p_retry_after_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order retry delay', DETAIL = 'VALIDATION';
  END IF;
  v_safe_error_code := CASE pg_catalog.upper(pg_catalog.btrim(p_last_error))
    WHEN 'VALIDATION_FAILED' THEN 'VALIDATION_FAILED'
    WHEN 'SOURCE_UNREADABLE' THEN 'SOURCE_UNREADABLE'
    WHEN 'HASH_MISMATCH' THEN 'HASH_MISMATCH'
    WHEN 'UNSUPPORTED_FORMAT' THEN 'UNSUPPORTED_FORMAT'
    WHEN 'STORAGE_UNAVAILABLE' THEN 'STORAGE_UNAVAILABLE'
    ELSE 'WORK_ORDER_IMPORT_RETRY'
  END;

  SELECT j.payload ->> 'import_batch_id'
  INTO v_import_batch_id
  FROM public.outbox_jobs j
  WHERE j.job_id = p_job_id
    AND j.job_type = 'work_order_import_validate';
  IF NOT FOUND OR v_import_batch_id IS NULL OR pg_catalog.btrim(v_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'job is outside work-order worker capability', DETAIL = 'INV_BYPASS';
  END IF;

  SELECT b.status
  INTO v_batch_status
  FROM public.work_order_import_batches b
  WHERE b.import_batch_id = v_import_batch_id
  FOR UPDATE;
  IF NOT FOUND OR v_batch_status IS DISTINCT FROM 'validating' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'work-order batch is no longer owned by this worker', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  UPDATE public.outbox_jobs j
  SET status = CASE WHEN j.attempts >= j.max_attempts THEN 'dead' ELSE 'pending' END,
      available_at = CASE
        WHEN j.attempts >= j.max_attempts THEN j.available_at
        ELSE pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_retry_after_seconds)
      END,
      lease_owner = NULL,
      lease_version = CASE WHEN j.attempts >= j.max_attempts THEN j.lease_version + 1 ELSE j.lease_version END,
      lease_expires_at = NULL,
      completed_at = CASE WHEN j.attempts >= j.max_attempts THEN now() ELSE NULL END,
      last_error = v_safe_error_code,
      updated_at = now()
  WHERE j.job_id = p_job_id
    AND j.job_type = 'work_order_import_validate'
    AND j.status = 'running'
    AND j.lease_owner = p_lease_owner
    AND j.lease_version = p_lease_version
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING j.status, j.attempts, j.max_attempts
  INTO v_status, v_attempts, v_max_attempts;

  IF v_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'work-order outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
  IF v_status = 'dead' THEN
    v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    UPDATE public.work_order_import_batches b
    SET status = 'failed',
        record_count = 0,
        accepted_count = 0,
        rejected_count = 0,
        error_report = pg_catalog.jsonb_build_object(
          'code', 'MAX_ATTEMPTS_EXHAUSTED',
          'diagnostic_id', v_diagnostic_id
        ),
        completed_at = now()
    WHERE b.import_batch_id = v_import_batch_id
      AND b.status = 'validating';
    INSERT INTO public.change_audits(
      change_id, action, actor_role, source, metadata, created_at
    ) VALUES (
      'chg_' || pg_catalog.gen_random_uuid()::text,
      'work_order_import_exhausted', 'system', 'retry_work_order_import_validation',
      pg_catalog.jsonb_build_object(
        'diagnostic_id', v_diagnostic_id,
        'job_id', p_job_id,
        'import_batch_id', v_import_batch_id,
        'attempts', v_attempts,
        'max_attempts', v_max_attempts,
        'error_code', v_safe_error_code
      ),
      now()
    );
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION retry_work_order_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION retry_content_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_retry_after_seconds INT DEFAULT 5,
  p_last_error TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_import_batch_id TEXT;
  v_batch_status TEXT;
  v_status TEXT;
  v_attempts INT;
  v_max_attempts INT;
  v_safe_error_code TEXT;
  v_diagnostic_id TEXT;
BEGIN
  IF p_retry_after_seconds IS NULL OR p_retry_after_seconds < 1 OR p_retry_after_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid import retry delay', DETAIL = 'VALIDATION';
  END IF;
  -- p_last_error is a legacy parameter name. Only an allowlisted, non-sensitive token is persisted;
  -- raw parser/storage diagnostics belong in a restricted log keyed by diagnostic_id.
  v_safe_error_code := CASE pg_catalog.upper(pg_catalog.btrim(p_last_error))
    WHEN 'VALIDATION_FAILED' THEN 'VALIDATION_FAILED'
    WHEN 'SOURCE_UNREADABLE' THEN 'SOURCE_UNREADABLE'
    WHEN 'HASH_MISMATCH' THEN 'HASH_MISMATCH'
    WHEN 'UNSUPPORTED_FORMAT' THEN 'UNSUPPORTED_FORMAT'
    WHEN 'STORAGE_UNAVAILABLE' THEN 'STORAGE_UNAVAILABLE'
    ELSE 'IMPORT_VALIDATION_RETRY'
  END;
  SELECT j.payload ->> 'import_batch_id'
  INTO v_import_batch_id
  FROM public.outbox_jobs j
  WHERE j.job_id = p_job_id
    AND j.job_type = 'import_validate';
  IF NOT FOUND OR v_import_batch_id IS NULL OR pg_catalog.btrim(v_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'job is outside import worker capability', DETAIL = 'INV_BYPASS';
  END IF;

  SELECT b.status
  INTO v_batch_status
  FROM public.import_batches b
  WHERE b.import_batch_id = v_import_batch_id
  FOR UPDATE;
  IF NOT FOUND OR v_batch_status IS DISTINCT FROM 'validating' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'import batch is no longer owned by this worker', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  UPDATE public.outbox_jobs j
  SET status = CASE WHEN j.attempts >= j.max_attempts THEN 'dead' ELSE 'pending' END,
      available_at = CASE
        WHEN j.attempts >= j.max_attempts THEN j.available_at
        ELSE pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_retry_after_seconds)
      END,
      lease_owner = NULL,
      lease_version = CASE WHEN j.attempts >= j.max_attempts THEN j.lease_version + 1 ELSE j.lease_version END,
      lease_expires_at = NULL,
      completed_at = CASE WHEN j.attempts >= j.max_attempts THEN now() ELSE NULL END,
      last_error = v_safe_error_code,
      updated_at = now()
  WHERE j.job_id = p_job_id
    AND j.job_type = 'import_validate'
    AND j.status = 'running'
    AND j.lease_owner = p_lease_owner
    AND j.lease_version = p_lease_version
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
  RETURNING j.status, j.attempts, j.max_attempts
  INTO v_status, v_attempts, v_max_attempts;

  IF v_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
  IF v_status = 'dead' THEN
    v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    UPDATE public.import_batches b
    SET status = 'failed',
        error_report = pg_catalog.jsonb_build_object(
          'code', 'MAX_ATTEMPTS_EXHAUSTED',
          'diagnostic_id', v_diagnostic_id,
          'attempts', v_attempts,
          'max_attempts', v_max_attempts
        ),
        finished_at = now()
    WHERE b.import_batch_id = v_import_batch_id
      AND b.status = 'validating';
    INSERT INTO public.change_audits(
      change_id, action, actor_role, source, metadata, created_at
    ) VALUES (
      'chg_' || pg_catalog.gen_random_uuid()::text,
      'content_import_exhausted', 'system', 'retry_content_import_validation',
      pg_catalog.jsonb_build_object(
        'diagnostic_id', v_diagnostic_id,
        'job_id', p_job_id,
        'import_batch_id', v_import_batch_id,
        'error_code', v_safe_error_code
      ),
      now()
    );
  END IF;
  RETURN v_status;
END;
$$;
REVOKE ALL ON FUNCTION retry_content_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) FROM PUBLIC;

-- Record one server-authorized human decision. Normal import workers have no EXECUTE or table INSERT;
-- the caller capability must match the immutable reviewer role encoded by this row.
CREATE OR REPLACE FUNCTION record_content_review_decision(
  p_decision_id TEXT,
  p_script_id TEXT,
  p_content_hash TEXT,
  p_reviewer_role TEXT,
  p_reviewer_subject_hash TEXT,
  p_reviewer_subject_key_version TEXT,
  p_evidence_ref TEXT,
  p_decision TEXT,
  p_decided_at TIMESTAMPTZ,
  p_actor_capability TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_existing public.content_review_decisions%ROWTYPE;
BEGIN
  IF p_decision_id IS NULL OR p_decision_id !~ '^crd_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
     OR p_script_id IS NULL OR pg_catalog.btrim(p_script_id) = ''
     OR p_content_hash IS NULL OR p_content_hash !~ '^[0-9a-f]{64}$'
     OR p_reviewer_role NOT IN ('ROLE-CONTENT-LEAD','ROLE-CS-MANAGER')
     OR p_reviewer_subject_hash IS NULL OR p_reviewer_subject_hash !~ '^[0-9a-f]{64}$'
     OR p_reviewer_subject_key_version IS NULL
     OR p_reviewer_subject_key_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR p_evidence_ref IS NULL OR pg_catalog.btrim(p_evidence_ref) = ''
     OR p_decision NOT IN ('approved','rejected')
     OR p_decided_at IS NULL OR p_decided_at > pg_catalog.clock_timestamp()
     OR (p_reviewer_role = 'ROLE-CONTENT-LEAD' AND p_actor_capability IS DISTINCT FROM 'content_review_lead')
     OR (p_reviewer_role = 'ROLE-CS-MANAGER' AND p_actor_capability IS DISTINCT FROM 'content_review_manager') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'review decision capability or payload is invalid', DETAIL = 'FORBIDDEN';
  END IF;

  INSERT INTO public.content_review_decisions(
    decision_id, script_id, content_hash, reviewer_role,
    reviewer_subject_hash, reviewer_subject_key_version,
    evidence_ref, decision, decided_at, recorded_at
  ) VALUES (
    p_decision_id, p_script_id, p_content_hash, p_reviewer_role,
    p_reviewer_subject_hash, p_reviewer_subject_key_version,
    p_evidence_ref, p_decision, p_decided_at, pg_catalog.clock_timestamp()
  ) ON CONFLICT DO NOTHING;

  SELECT review.* INTO v_existing
  FROM public.content_review_decisions review
  WHERE review.decision_id = p_decision_id;
  IF NOT FOUND
     OR v_existing.script_id IS DISTINCT FROM p_script_id
     OR v_existing.content_hash IS DISTINCT FROM p_content_hash
     OR v_existing.reviewer_role IS DISTINCT FROM p_reviewer_role
     OR v_existing.reviewer_subject_hash IS DISTINCT FROM p_reviewer_subject_hash
     OR v_existing.reviewer_subject_key_version IS DISTINCT FROM p_reviewer_subject_key_version
     OR v_existing.evidence_ref IS DISTINCT FROM p_evidence_ref
     OR v_existing.decision IS DISTINCT FROM p_decision
     OR v_existing.decided_at IS DISTINCT FROM p_decided_at THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'review decision was replayed with different inputs', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION record_content_review_decision(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT
) FROM PUBLIC;

-- Freeze the replayable quality sample before any result evidence is accepted. Plan freeze is an
-- import-worker capability; evidence recording is restricted to app_content_admin. Neither is a
-- public HTTP route, and both share the import job fencing token.
DROP FUNCTION IF EXISTS freeze_content_quality_review_plan(
  TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT
);
CREATE OR REPLACE FUNCTION freeze_content_quality_review_plan(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_import_batch_id TEXT,
  p_plan_id TEXT,
  p_sampling_policy_version TEXT,
  p_cutoff_at TIMESTAMPTZ,
  p_clean_population_count INTEGER,
  p_ordinary_population_count INTEGER,
  p_mandatory_full_review_count INTEGER,
  p_selection_seed_hash TEXT,
  p_selection_manifest_hash TEXT,
  p_selection_algorithm TEXT,
  p_population_rows JSONB
) RETURNS TABLE(
  frozen_plan_id TEXT,
  initial_sample_target INTEGER,
  expanded_sample_target INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_initial_target INTEGER;
  v_expanded_target INTEGER;
  v_population_manifest_hash TEXT;
  v_derived_population_count INTEGER;
  v_derived_ordinary_count INTEGER;
  v_derived_mandatory_count INTEGER;
  v_existing public.content_quality_review_plans%ROWTYPE;
BEGIN
  IF p_plan_id IS NULL OR p_plan_id !~ '^qplan_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
     OR p_sampling_policy_version IS NULL OR pg_catalog.btrim(p_sampling_policy_version) = ''
     OR p_cutoff_at IS NULL OR p_cutoff_at > pg_catalog.clock_timestamp()
     OR p_clean_population_count IS NULL OR p_clean_population_count < 0 OR p_clean_population_count > 5000
     OR p_ordinary_population_count IS NULL OR p_ordinary_population_count < 0
     OR p_mandatory_full_review_count IS NULL OR p_mandatory_full_review_count < 0
     OR p_clean_population_count <> p_ordinary_population_count + p_mandatory_full_review_count
     OR p_selection_seed_hash IS NULL OR p_selection_seed_hash !~ '^[0-9a-f]{64}$'
     OR p_selection_manifest_hash IS NULL OR p_selection_manifest_hash !~ '^[0-9a-f]{64}$'
     OR p_selection_algorithm IS DISTINCT FROM 'sha256-ranked-v1'
     OR pg_catalog.jsonb_typeof(p_population_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality review plan is invalid', DETAIL = 'QUALITY_PLAN_INVALID';
  END IF;

  v_population_manifest_hash := public.content_quality_population_manifest_hash(p_population_rows);
  SELECT
    pg_catalog.count(*) FILTER (
      WHERE coalesce(row_item.value ->> 'operation', 'upsert') = 'upsert'
    )::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE coalesce(row_item.value ->> 'operation', 'upsert') = 'upsert'
        AND row_item.value ->> 'risk_level' IN ('low','medium')
        AND row_item.value ->> 'has_conflict' = 'false'
    )::INTEGER,
    pg_catalog.count(*) FILTER (
      WHERE coalesce(row_item.value ->> 'operation', 'upsert') = 'upsert'
        AND (
          row_item.value ->> 'risk_level' = 'high'
          OR row_item.value ->> 'has_conflict' = 'true'
        )
    )::INTEGER
  INTO v_derived_population_count, v_derived_ordinary_count, v_derived_mandatory_count
  FROM pg_catalog.jsonb_array_elements(p_population_rows) AS row_item(value);
  IF p_clean_population_count IS DISTINCT FROM v_derived_population_count
     OR p_ordinary_population_count IS DISTINCT FROM v_derived_ordinary_count
     OR p_mandatory_full_review_count IS DISTINCT FROM v_derived_mandatory_count THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA001',
      MESSAGE = 'quality counts do not match the DB-computed population manifest',
      DETAIL = 'QUALITY_POPULATION_MISMATCH';
  END IF;

  PERFORM 1
  FROM public.outbox_jobs job
  WHERE job.job_id = p_job_id
    AND job.job_type = 'import_validate'
    AND job.status = 'running'
    AND job.lease_owner = p_lease_owner
    AND job.lease_version = p_lease_version
    AND job.lease_expires_at > pg_catalog.clock_timestamp()
    AND job.payload ->> 'import_batch_id' = p_import_batch_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost before quality plan freeze', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  v_initial_target := CASE
    WHEN p_ordinary_population_count <= 500 THEN p_ordinary_population_count
    ELSE LEAST(
      300,
      GREATEST(100, pg_catalog.ceil(p_ordinary_population_count * 0.10)::INTEGER)
    )
  END;
  v_expanded_target := CASE
    WHEN p_ordinary_population_count <= 500 THEN p_ordinary_population_count
    ELSE pg_catalog.ceil(p_ordinary_population_count * 0.30)::INTEGER
  END;

  INSERT INTO public.content_quality_review_plans(
    plan_id, import_batch_id, sampling_policy_version, cutoff_at,
    clean_population_count, ordinary_population_count, mandatory_full_review_count,
    initial_sample_target, expanded_sample_target, selection_seed_hash,
    selection_manifest_hash, population_manifest_hash, selection_algorithm, frozen_at
  ) VALUES (
    p_plan_id, p_import_batch_id, p_sampling_policy_version, p_cutoff_at,
    p_clean_population_count, p_ordinary_population_count, p_mandatory_full_review_count,
    v_initial_target, v_expanded_target, p_selection_seed_hash,
    p_selection_manifest_hash, v_population_manifest_hash, p_selection_algorithm,
    pg_catalog.clock_timestamp()
  ) ON CONFLICT DO NOTHING;

  SELECT plan.* INTO v_existing
  FROM public.content_quality_review_plans plan
  WHERE plan.plan_id = p_plan_id;
  IF NOT FOUND
     OR v_existing.import_batch_id IS DISTINCT FROM p_import_batch_id
     OR v_existing.sampling_policy_version IS DISTINCT FROM p_sampling_policy_version
     OR v_existing.cutoff_at IS DISTINCT FROM p_cutoff_at
     OR v_existing.clean_population_count IS DISTINCT FROM p_clean_population_count
     OR v_existing.ordinary_population_count IS DISTINCT FROM p_ordinary_population_count
     OR v_existing.mandatory_full_review_count IS DISTINCT FROM p_mandatory_full_review_count
     OR v_existing.selection_seed_hash IS DISTINCT FROM p_selection_seed_hash
     OR v_existing.selection_manifest_hash IS DISTINCT FROM p_selection_manifest_hash
     OR v_existing.population_manifest_hash IS DISTINCT FROM v_population_manifest_hash
     OR v_existing.selection_algorithm IS DISTINCT FROM p_selection_algorithm THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'quality review plan id was reused with different inputs', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;

  frozen_plan_id := v_existing.plan_id;
  initial_sample_target := v_existing.initial_sample_target;
  expanded_sample_target := v_existing.expanded_sample_target;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION freeze_content_quality_review_plan(
  TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT,JSONB
) FROM PUBLIC;

DROP FUNCTION IF EXISTS record_content_quality_review_evidence(
  TEXT,TEXT,BIGINT,TEXT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT
);
CREATE OR REPLACE FUNCTION record_content_quality_review_evidence(
  p_plan_id TEXT,
  p_initial_sample_reviewed_count INTEGER,
  p_initial_defect_count INTEGER,
  p_expanded_sample_reviewed_count INTEGER,
  p_expanded_defect_count INTEGER,
  p_mandatory_reviewed_count INTEGER,
  p_mandatory_defect_count INTEGER,
  p_publishable_clean_count INTEGER,
  p_review_quarantined_count INTEGER,
  p_conclusion TEXT,
  p_evidence_ref TEXT,
  p_actor_capability TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_plan public.content_quality_review_plans%ROWTYPE;
  v_existing public.content_quality_review_evidence%ROWTYPE;
  v_initial_rate NUMERIC;
  v_expanded_rate NUMERIC;
  v_expected_conclusion TEXT;
  v_final_ordinary_defects INTEGER;
BEGIN
  SELECT plan.* INTO v_plan
  FROM public.content_quality_review_plans plan
  WHERE plan.plan_id = p_plan_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'quality review plan not found', DETAIL = 'NOT_FOUND';
  END IF;

  -- Quality evidence is durable plan evidence, not a worker-lease heartbeat. The isolated admin
  -- workload must present its server-side capability and the frozen plan/batch must still be open.
  IF p_actor_capability IS DISTINCT FROM 'content_quality_reviewer' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'quality reviewer capability is required', DETAIL = 'FORBIDDEN';
  END IF;
  PERFORM 1
  FROM public.import_batches batch
  WHERE batch.import_batch_id = v_plan.import_batch_id
    AND batch.status = 'validating'
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'quality plan batch is no longer validating', DETAIL = 'CONFLICT';
  END IF;

  IF p_initial_sample_reviewed_count IS DISTINCT FROM v_plan.initial_sample_target
     OR p_initial_defect_count IS NULL OR p_initial_defect_count < 0
     OR p_initial_defect_count > p_initial_sample_reviewed_count
     OR p_mandatory_reviewed_count IS DISTINCT FROM v_plan.mandatory_full_review_count
     OR p_mandatory_defect_count IS NULL OR p_mandatory_defect_count < 0
     OR p_mandatory_defect_count > p_mandatory_reviewed_count
     OR p_publishable_clean_count IS NULL OR p_publishable_clean_count < 0
     OR p_review_quarantined_count IS NULL OR p_review_quarantined_count < 0
     OR p_publishable_clean_count + p_review_quarantined_count <> v_plan.clean_population_count
     OR p_conclusion IS NULL OR p_conclusion NOT IN ('passed','blocked')
     OR p_evidence_ref IS NULL OR pg_catalog.btrim(p_evidence_ref) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality review evidence shape is invalid', DETAIL = 'QUALITY_EVIDENCE_INVALID';
  END IF;

  v_initial_rate := CASE
    WHEN p_initial_sample_reviewed_count = 0 THEN 0
    ELSE p_initial_defect_count::NUMERIC / p_initial_sample_reviewed_count::NUMERIC
  END;
  IF v_plan.ordinary_population_count <= 500 OR v_initial_rate <= 0.02 OR v_initial_rate > 0.05 THEN
    IF p_expanded_sample_reviewed_count IS NOT NULL OR p_expanded_defect_count IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality expansion is not permitted for this initial result', DETAIL = 'QUALITY_EVIDENCE_INVALID';
    END IF;
    v_final_ordinary_defects := p_initial_defect_count;
    v_expected_conclusion := CASE WHEN v_initial_rate > 0.05 THEN 'blocked' ELSE 'passed' END;
  ELSE
    IF p_expanded_sample_reviewed_count IS DISTINCT FROM v_plan.expanded_sample_target
       OR p_expanded_defect_count IS NULL OR p_expanded_defect_count < 0
       OR p_expanded_defect_count > p_expanded_sample_reviewed_count THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = '30 percent expanded quality sample is required', DETAIL = 'QUALITY_EXPANSION_REQUIRED';
    END IF;
    v_expanded_rate := CASE
      WHEN p_expanded_sample_reviewed_count = 0 THEN 0
      ELSE p_expanded_defect_count::NUMERIC / p_expanded_sample_reviewed_count::NUMERIC
    END;
    v_final_ordinary_defects := p_expanded_defect_count;
    v_expected_conclusion := CASE WHEN v_expanded_rate > 0.05 THEN 'blocked' ELSE 'passed' END;
  END IF;

  IF p_conclusion IS DISTINCT FROM v_expected_conclusion
     OR p_review_quarantined_count < v_final_ordinary_defects + p_mandatory_defect_count THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality conclusion does not match frozen thresholds', DETAIL = 'QUALITY_THRESHOLD_MISMATCH';
  END IF;

  INSERT INTO public.content_quality_review_evidence(
    plan_id, import_batch_id, population_manifest_hash,
    initial_sample_reviewed_count, initial_defect_count,
    expanded_sample_reviewed_count, expanded_defect_count,
    mandatory_reviewed_count, mandatory_defect_count,
    publishable_clean_count, review_quarantined_count,
    conclusion, evidence_ref, recorded_at
  ) VALUES (
    p_plan_id, v_plan.import_batch_id, v_plan.population_manifest_hash,
    p_initial_sample_reviewed_count, p_initial_defect_count,
    p_expanded_sample_reviewed_count, p_expanded_defect_count,
    p_mandatory_reviewed_count, p_mandatory_defect_count,
    p_publishable_clean_count, p_review_quarantined_count,
    p_conclusion, p_evidence_ref, pg_catalog.clock_timestamp()
  ) ON CONFLICT DO NOTHING;

  SELECT evidence.* INTO v_existing
  FROM public.content_quality_review_evidence evidence
  WHERE evidence.plan_id = p_plan_id;
  IF NOT FOUND
     OR v_existing.import_batch_id IS DISTINCT FROM v_plan.import_batch_id
     OR v_existing.population_manifest_hash IS DISTINCT FROM v_plan.population_manifest_hash
     OR v_existing.initial_sample_reviewed_count IS DISTINCT FROM p_initial_sample_reviewed_count
     OR v_existing.initial_defect_count IS DISTINCT FROM p_initial_defect_count
     OR v_existing.expanded_sample_reviewed_count IS DISTINCT FROM p_expanded_sample_reviewed_count
     OR v_existing.expanded_defect_count IS DISTINCT FROM p_expanded_defect_count
     OR v_existing.mandatory_reviewed_count IS DISTINCT FROM p_mandatory_reviewed_count
     OR v_existing.mandatory_defect_count IS DISTINCT FROM p_mandatory_defect_count
     OR v_existing.publishable_clean_count IS DISTINCT FROM p_publishable_clean_count
     OR v_existing.review_quarantined_count IS DISTINCT FROM p_review_quarantined_count
     OR v_existing.conclusion IS DISTINCT FROM p_conclusion
     OR v_existing.evidence_ref IS DISTINCT FROM p_evidence_ref THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'quality evidence was replayed with different inputs', DETAIL = 'IDEMPOTENCY_BODY_MISMATCH';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION record_content_quality_review_evidence(
  TEXT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT
) FROM PUBLIC;

-- Worker completion boundary: staging rows, batch terminal state and outbox completion are one fenced
-- transaction. app_runtime/app_import_worker receive no direct table write privilege for these states.
CREATE OR REPLACE FUNCTION finalize_content_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_import_batch_id TEXT,
  p_final_status TEXT,
  p_staging_rows JSONB DEFAULT '[]'::jsonb,
  p_error_report JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
  v_public_error_report JSONB;
  v_diagnostic_id TEXT;
  v_population_manifest_hash TEXT;
  v_persisted_population_manifest_hash TEXT;
BEGIN
  IF p_final_status IS NULL OR p_final_status NOT IN ('staged', 'failed') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'import validation final status must be staged or failed', DETAIL = 'VALIDATION';
  END IF;
  IF pg_catalog.jsonb_typeof(p_staging_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging_rows must be a JSON array', DETAIL = 'VALIDATION';
  END IF;
  v_population_manifest_hash := public.content_quality_population_manifest_hash(p_staging_rows);
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE item.value ?| ARRAY[
      'review_mode','primary_reviewer_id','primary_reviewer_role','primary_review_evd',
      'secondary_reviewer_id','secondary_reviewer_role','secondary_review_evd',
      'quality_gate_passed'
    ]
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'worker payload cannot self-assert review or quality decisions', DETAIL = 'REVIEW_EVIDENCE_TRUST_BOUNDARY';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
      AND public.content_questions_align_intent(
        item.value -> 'questions_json',
        item.value ->> 'intent_taxonomy_version',
        item.value ->> 'intent_id'
      ) IS DISTINCT FROM TRUE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'question identity or lineage contract is invalid', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_staging_rows) AS item(value)
    WHERE coalesce(item.value ->> 'operation', 'upsert') NOT IN ('upsert','withdraw')
       OR coalesce(item.value ->> 'category', '') NOT IN ('presale','campaign','aftersale','product')
       OR coalesce(item.value ->> 'source_version_id', '') !~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
       OR (
        coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
        AND (
        coalesce(pg_catalog.btrim(item.value ->> 'owner_role'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'review_due_at'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'effective_from'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'intent_taxonomy_version'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'intent_id'), '') = ''
        OR item.value -> 'risk_categories' IS NULL
        OR coalesce(pg_catalog.btrim(item.value ->> 'quality_status'), '') = ''
        OR item.value -> 'quality_issue_codes' IS NULL
        OR coalesce(pg_catalog.btrim(item.value ->> 'questions_grams_text'), '') = ''
        OR
        coalesce(pg_catalog.btrim(item.value ->> 'title_grams_text'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'answer_grams_text'), '') = ''
        OR coalesce(pg_catalog.btrim(item.value ->> 'search_fallback_text'), '') = ''
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row requires a bound source and complete DEC-042 upsert fields', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;

  IF p_final_status = 'failed' AND pg_catalog.jsonb_array_length(p_staging_rows) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'batch-fatal validation must not persist staging rows', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;

  -- Lock order is batch -> outbox, matching cancel_content_import, to avoid a deadlock cycle.
  PERFORM 1
  FROM public.import_batches b
  WHERE b.import_batch_id = p_import_batch_id
    AND b.status = 'validating'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'import batch is not validating', DETAIL = 'CONFLICT';
  END IF;

  PERFORM 1
  FROM public.outbox_jobs j
  WHERE j.job_id = p_job_id
    AND j.job_type = 'import_validate'
    AND j.status = 'running'
    AND j.lease_owner = p_lease_owner
    AND j.lease_version = p_lease_version
    AND j.lease_expires_at > pg_catalog.clock_timestamp()
    AND j.payload ->> 'import_batch_id' = p_import_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM public.import_batch_source_bindings ib
    JOIN public.authoritative_source_versions asv
      ON asv.source_version_id = ib.source_version_id AND asv.domain = ib.domain
    LEFT JOIN public.authoritative_source_suspensions susp
      ON susp.source_version_id = ib.source_version_id
    WHERE ib.import_batch_id = p_import_batch_id
      AND (asv.use_class <> 'canonical' OR susp.source_version_id IS NOT NULL)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'import source became ineligible during validation', DETAIL = 'SOURCE_SUSPENDED';
  END IF;
  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_staging_rows) r(category TEXT, source_version_id TEXT)
    LEFT JOIN public.import_batch_source_bindings ib
      ON ib.import_batch_id = p_import_batch_id
     AND ib.domain = r.category
     AND ib.source_version_id = r.source_version_id
    WHERE ib.import_batch_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row source does not match its import binding', DETAIL = 'SOURCE_DOMAIN_MISMATCH';
  END IF;
  IF p_final_status = 'staged' AND EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_staging_rows) r(
      operation TEXT,
      quality_status TEXT,
      intent_taxonomy_version TEXT,
      intent_id TEXT
    )
    LEFT JOIN public.intent_taxonomy_entries entry
      ON entry.intent_taxonomy_version = r.intent_taxonomy_version
     AND entry.intent_id = r.intent_id
    WHERE coalesce(r.operation, 'upsert') = 'upsert'
      AND r.quality_status = 'clean'
      AND (entry.intent_id IS NULL OR entry.lifecycle <> 'active')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'clean row must bind an active taxonomy entry', DETAIL = 'CONTENT_CONTRACT_INVALID';
  END IF;
  IF p_final_status = 'staged' AND NOT EXISTS (
    SELECT 1
    FROM public.content_quality_review_plans plan
    JOIN public.content_quality_review_evidence evidence ON evidence.plan_id = plan.plan_id
    WHERE plan.import_batch_id = p_import_batch_id
      AND evidence.import_batch_id = p_import_batch_id
      AND evidence.conclusion = 'passed'
      AND plan.population_manifest_hash = v_population_manifest_hash
      AND evidence.population_manifest_hash = v_population_manifest_hash
      AND plan.clean_population_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
      )
      AND plan.mandatory_full_review_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND (
            item.value ->> 'risk_level' = 'high'
            OR item.value ->> 'has_conflict' = 'true'
          )
      )
      AND evidence.publishable_clean_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND item.value ->> 'quality_status' = 'clean'
      )
      AND evidence.review_quarantined_count = (
        SELECT pg_catalog.count(*)::INTEGER
        FROM pg_catalog.jsonb_array_elements(p_staging_rows) item(value)
        WHERE coalesce(item.value ->> 'operation', 'upsert') = 'upsert'
          AND item.value ->> 'quality_status' = 'quarantined'
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'frozen quality plan/evidence is missing, blocked or stale', DETAIL = 'QUALITY_GATE_NOT_PASSED';
  END IF;

  DELETE FROM public.staging_scripts WHERE import_batch_id = p_import_batch_id;

  IF p_final_status = 'staged' THEN
    IF pg_catalog.jsonb_array_length(p_staging_rows) < 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staged import must contain at least one row', DETAIL = 'VALIDATION';
    END IF;

    -- The validator sends normalized 2-gram token streams separately so the database, rather than
    -- an untyped prebuilt tsvector, deterministically applies the frozen A/B/C field weights.
    BEGIN
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
        p_import_batch_id,
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
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN NULL
          WHEN r.risk_level = 'high' OR r.has_conflict THEN 'dual'
          ELSE 'single'
        END,
        lead.reviewer_subject_hash,
        lead.reviewer_role,
        lead.evidence_ref,
        CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN manager.reviewer_subject_hash ELSE NULL END,
        CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN manager.reviewer_role ELSE NULL END,
        CASE WHEN r.risk_level = 'high' OR r.has_conflict THEN manager.evidence_ref ELSE NULL END,
        r.placeholder_keys,
        coalesce(r.questions_json, '[]'::jsonb),
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN NULL
          ELSE
            pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.questions_grams_text, '')),
              'A'
            )
            || pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.title_grams_text, '')),
              'B'
            )
            || pg_catalog.setweight(
              pg_catalog.to_tsvector('simple'::pg_catalog.regconfig, coalesce(r.answer_grams_text, '')),
              'C'
            )
        END,
        r.search_fallback_text,
        TRUE,
        NULL,
        coalesce(r.quality_status, CASE WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN 'clean' ELSE 'quarantined' END),
        coalesce(r.quality_issue_codes, CASE WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN '[]'::jsonb ELSE '["CONTENT_NEEDS_REVIEW"]'::jsonb END),
        CASE
          WHEN coalesce(r.operation, 'upsert') = 'withdraw' THEN TRUE
          ELSE r.quality_status = 'clean'
        END
      FROM pg_catalog.jsonb_to_recordset(p_staging_rows) AS r(
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
        ON ib.import_batch_id = p_import_batch_id
       AND ib.domain = r.category
       AND ib.source_version_id = r.source_version_id
      JOIN public.authoritative_source_versions asv
        ON asv.source_version_id = ib.source_version_id
       AND asv.domain = ib.domain
      LEFT JOIN public.content_review_decisions lead
        ON coalesce(r.operation, 'upsert') = 'upsert'
       AND lead.script_id = r.script_id
       AND lead.content_hash = r.content_hash
       AND lead.reviewer_role = 'ROLE-CONTENT-LEAD'
       AND lead.decision = 'approved'
      LEFT JOIN public.content_review_decisions manager
        ON coalesce(r.operation, 'upsert') = 'upsert'
       AND manager.script_id = r.script_id
       AND manager.content_hash = r.content_hash
       AND manager.reviewer_role = 'ROLE-CS-MANAGER'
       AND manager.decision = 'approved'
      WHERE coalesce(r.operation, 'upsert') = 'withdraw'
         OR (
           lead.decision_id IS NOT NULL
           AND (
             (r.risk_level IN ('low','medium') AND NOT r.has_conflict)
             OR (
               (r.risk_level = 'high' OR r.has_conflict)
               AND manager.decision_id IS NOT NULL
               AND manager.reviewer_subject_key_version = lead.reviewer_subject_key_version
               AND manager.reviewer_subject_hash <> lead.reviewer_subject_hash
             )
           )
         );
      GET DIAGNOSTICS n = ROW_COUNT;
    EXCEPTION
      WHEN data_exception OR integrity_constraint_violation THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid staging row payload', DETAIL = 'VALIDATION';
    END;
    IF n <> pg_catalog.jsonb_array_length(p_staging_rows) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staging row count mismatch', DETAIL = 'VALIDATION';
    END IF;
    v_persisted_population_manifest_hash :=
      public.content_quality_staging_population_manifest_hash(p_import_batch_id);
    IF v_persisted_population_manifest_hash IS DISTINCT FROM v_population_manifest_hash THEN
      RAISE EXCEPTION USING
        ERRCODE = 'ZA001',
        MESSAGE = 'persisted staging population differs from the frozen quality population',
        DETAIL = 'QUALITY_POPULATION_MISMATCH';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.staging_scripts s
      WHERE s.import_batch_id = p_import_batch_id
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
    IF p_error_report IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'staged import must not include error_report', DETAIL = 'VALIDATION';
    END IF;
  ELSE
    IF p_error_report IS NULL OR pg_catalog.jsonb_typeof(p_error_report) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'failed import requires an object error_report', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report - ARRAY['code','row','column','error_count','issue_codes'] <> '{}'::jsonb THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report contains non-public fields', DETAIL = 'VALIDATION';
    END IF;
    IF coalesce(p_error_report ->> 'code', '') NOT IN (
      'VALIDATION_FAILED', 'SOURCE_UNREADABLE', 'HASH_MISMATCH',
      'UNSUPPORTED_FORMAT', 'STORAGE_UNAVAILABLE', 'SOURCE_NOT_ELIGIBLE',
      'SOURCE_SUSPENDED', 'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH',
      'SOURCE_SET_INCOMPLETE', 'CONTENT_CONTRACT_INVALID', 'GOVERNANCE_HASH_MISMATCH'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report code is not allowlisted', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'row'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'row') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'row' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report row is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'column'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'column') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'column' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report column is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'error_count'
       AND (
         pg_catalog.jsonb_typeof(p_error_report -> 'error_count') IS DISTINCT FROM 'number'
         OR p_error_report ->> 'error_count' !~ '^[1-9][0-9]{0,8}$'
       ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report error_count is invalid', DETAIL = 'VALIDATION';
    END IF;
    IF p_error_report ? 'issue_codes' THEN
      IF pg_catalog.jsonb_typeof(p_error_report -> 'issue_codes') IS DISTINCT FROM 'array'
         OR pg_catalog.jsonb_array_length(p_error_report -> 'issue_codes') > 26 THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue_codes is invalid', DETAIL = 'VALIDATION';
      END IF;
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(p_error_report -> 'issue_codes') AS issue(code)
        WHERE issue.code NOT IN (
          'MISSING_REQUIRED_FIELD', 'INVALID_FIELD_TYPE', 'INVALID_VALUE',
          'DUPLICATE_SCRIPT_ID', 'UNKNOWN_SCRIPT_ID', 'INVALID_EFFECTIVE_WINDOW',
          'MISSING_EFFECTIVE_WINDOW', 'HASH_MISMATCH', 'UNSUPPORTED_FORMAT',
          'MACRO_DETECTED', 'EXTERNAL_LINK_DETECTED', 'ROW_LIMIT_EXCEEDED',
          'CONTENT_TOO_LARGE', 'SOURCE_NOT_REGISTERED', 'SOURCE_NOT_CANONICAL',
          'SOURCE_SUSPENDED', 'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH',
          'SOURCE_SET_INCOMPLETE', 'MISSING_PLATFORM_SCOPE', 'INVALID_PRODUCT_SCOPE',
          'INVALID_TAXONOMY_REF', 'INVALID_QUESTION_IDENTITY',
          'INVALID_REVIEW_EVIDENCE', 'INVALID_PLACEHOLDER_TEMPLATE',
          'GOVERNANCE_HASH_MISMATCH'
        )
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue code is not allowlisted', DETAIL = 'VALIDATION';
      END IF;
      IF (
        SELECT pg_catalog.count(*) <> pg_catalog.count(DISTINCT issue.code)
        FROM pg_catalog.jsonb_array_elements_text(p_error_report -> 'issue_codes') AS issue(code)
      ) THEN
        RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'error_report issue codes must be unique', DETAIL = 'VALIDATION';
      END IF;
    END IF;
    -- The database, not the worker payload, creates the public correlation token. This makes the
    -- value opaque and prevents encoded file content, paths or exception text from entering it.
    v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_public_error_report := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'code', p_error_report ->> 'code',
      'diagnostic_id', v_diagnostic_id,
      'row', CASE WHEN p_error_report ? 'row' THEN (p_error_report ->> 'row')::INT ELSE NULL END,
      'column', CASE WHEN p_error_report ? 'column' THEN (p_error_report ->> 'column')::INT ELSE NULL END,
      'error_count', CASE WHEN p_error_report ? 'error_count' THEN (p_error_report ->> 'error_count')::INT ELSE NULL END,
      'issue_codes', CASE WHEN p_error_report ? 'issue_codes' THEN p_error_report -> 'issue_codes' ELSE NULL END
    ));
  END IF;

  UPDATE public.import_batches
  SET status = p_final_status,
      quality_gate_passed = CASE
        WHEN p_final_status = 'staged' THEN EXISTS (
          SELECT 1 FROM public.staging_scripts s
          WHERE s.import_batch_id = p_import_batch_id
            AND s.quality_status = 'clean' AND s.quality_gate_passed
        )
        ELSE FALSE
      END,
      clean_count = CASE WHEN p_final_status = 'staged' THEN (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_import_batch_id AND s.quality_status = 'clean'
      ) ELSE 0 END,
      quarantined_count = CASE WHEN p_final_status = 'staged' THEN (
        SELECT pg_catalog.count(*)::INTEGER FROM public.staging_scripts s
        WHERE s.import_batch_id = p_import_batch_id AND s.quality_status = 'quarantined'
      ) ELSE 0 END,
      error_report = CASE WHEN p_final_status = 'failed' THEN v_public_error_report ELSE NULL END,
      finished_at = now()
  WHERE import_batch_id = p_import_batch_id;

  IF p_final_status = 'failed' THEN
    INSERT INTO public.change_audits(
      change_id, action, actor_role, source, metadata, created_at
    ) VALUES (
      'chg_' || pg_catalog.gen_random_uuid()::text,
      'content_import_validation_failed', 'system', 'finalize_content_import_validation',
      pg_catalog.jsonb_build_object(
        'diagnostic_id', v_diagnostic_id,
        'job_id', p_job_id,
        'import_batch_id', p_import_batch_id,
        'error_code', p_error_report ->> 'code'
      ),
      now()
    );
  END IF;

  UPDATE public.outbox_jobs
  SET status = 'done',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = now(),
      last_error = NULL,
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost before atomic finalize', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION finalize_content_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION finalize_work_order_import_validation(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_import_batch_id TEXT,
  p_final_status TEXT,
  p_records JSONB DEFAULT '[]'::jsonb,
  p_rejected_count INTEGER DEFAULT 0,
  p_error_report JSONB DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INTEGER;
  v_tenant_scope TEXT;
  v_accepted_count INTEGER;
  v_public_error_report JSONB;
  v_diagnostic_id TEXT;
BEGIN
  IF p_final_status NOT IN ('ready','failed')
     OR pg_catalog.jsonb_typeof(p_records) IS DISTINCT FROM 'array'
     OR p_rejected_count IS NULL OR p_rejected_count < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order finalization envelope', DETAIL = 'VALIDATION';
  END IF;

  SELECT tenant_scope INTO v_tenant_scope
  FROM public.work_order_import_batches
  WHERE import_batch_id = p_import_batch_id
    AND status = 'validating'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'work-order import batch is not validating', DETAIL = 'CONFLICT';
  END IF;

  PERFORM 1
  FROM public.outbox_jobs
  WHERE job_id = p_job_id
    AND job_type = 'work_order_import_validate'
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp()
    AND payload ->> 'import_batch_id' = p_import_batch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'work-order outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  IF p_final_status = 'ready' THEN
    IF p_error_report IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'ready work-order import cannot include error_report', DETAIL = 'VALIDATION';
    END IF;
    IF pg_catalog.jsonb_array_length(p_records) < 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'ready work-order import must contain at least one accepted record', DETAIL = 'VALIDATION';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_records) AS item(value)
      WHERE pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'object'
         OR coalesce(item.value ->> 'source_record_hash', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(pg_catalog.btrim(item.value ->> 'normalization_version'), '') = ''
         OR (
           item.value ? 'product_ref_hash'
           AND item.value ->> 'product_ref_hash' IS NOT NULL
           AND item.value ->> 'product_ref_hash' !~ '^[0-9a-f]{64}$'
         )
         OR (
           item.value ? 'quality_tags'
           AND pg_catalog.jsonb_typeof(item.value -> 'quality_tags') IS DISTINCT FROM 'array'
         )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid normalized work-order record', DETAIL = 'VALIDATION';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_records) AS item(value)
      CROSS JOIN LATERAL pg_catalog.jsonb_object_keys(item.value) AS field(key)
      WHERE field.key NOT IN (
        'source_record_hash','category','issue_type','product_ref_hash','channel',
        'record_status','opened_at','closed_at','handling_seconds','error_type',
        'escalated','quality_tags','normalization_version'
      )
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'work-order record contains a non-allowlisted field', DETAIL = 'UNKNOWN_COLUMN';
    END IF;

    INSERT INTO public.work_order_records(
      record_id, import_batch_id, tenant_scope, source_record_hash, category,
      issue_type, product_ref_hash, channel, record_status, opened_at, closed_at,
      handling_seconds, error_type, escalated, quality_tags, normalization_version
    )
    SELECT
      'wor_' || pg_catalog.gen_random_uuid()::text,
      p_import_batch_id,
      v_tenant_scope,
      item.value ->> 'source_record_hash',
      NULLIF(item.value ->> 'category', ''),
      NULLIF(item.value ->> 'issue_type', ''),
      NULLIF(item.value ->> 'product_ref_hash', ''),
      NULLIF(item.value ->> 'channel', ''),
      NULLIF(item.value ->> 'record_status', ''),
      NULLIF(item.value ->> 'opened_at', '')::TIMESTAMPTZ,
      NULLIF(item.value ->> 'closed_at', '')::TIMESTAMPTZ,
      NULLIF(item.value ->> 'handling_seconds', '')::INTEGER,
      NULLIF(item.value ->> 'error_type', ''),
      coalesce((item.value ->> 'escalated')::BOOLEAN, FALSE),
      ARRAY(
        SELECT pg_catalog.jsonb_array_elements_text(
          coalesce(item.value -> 'quality_tags', '[]'::jsonb)
        )
      ),
      item.value ->> 'normalization_version'
    FROM pg_catalog.jsonb_array_elements(p_records) AS item(value);

    v_accepted_count := pg_catalog.jsonb_array_length(p_records);
  ELSE
    IF pg_catalog.jsonb_array_length(p_records) <> 0
       OR p_error_report IS NULL
       OR pg_catalog.jsonb_typeof(p_error_report) IS DISTINCT FROM 'object'
       OR p_error_report ->> 'code' NOT IN (
         'VALIDATION_FAILED','SOURCE_UNREADABLE','HASH_MISMATCH',
         'UNSUPPORTED_FORMAT','STORAGE_UNAVAILABLE','MAX_ATTEMPTS_EXHAUSTED'
       )
       OR NOT public.work_order_issue_codes_are_public(p_error_report -> 'issue_codes') THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order public error report', DETAIL = 'VALIDATION';
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_object_keys(p_error_report) AS field(key)
      WHERE field.key NOT IN ('code','row','column','error_count','issue_codes')
    ) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'work-order error report contains unsafe fields', DETAIL = 'VALIDATION';
    END IF;
    v_diagnostic_id := 'diag_' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
    v_public_error_report := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'code', p_error_report ->> 'code',
      'diagnostic_id', v_diagnostic_id,
      'row', CASE WHEN p_error_report ? 'row' THEN (p_error_report ->> 'row')::INTEGER ELSE NULL END,
      'column', CASE WHEN p_error_report ? 'column' THEN (p_error_report ->> 'column')::INTEGER ELSE NULL END,
      'error_count', CASE WHEN p_error_report ? 'error_count' THEN (p_error_report ->> 'error_count')::INTEGER ELSE NULL END,
      'issue_codes', CASE WHEN p_error_report ? 'issue_codes' THEN p_error_report -> 'issue_codes' ELSE NULL END
    ));
    v_accepted_count := 0;
  END IF;

  UPDATE public.work_order_import_batches
  SET status = p_final_status,
      record_count = v_accepted_count + p_rejected_count,
      accepted_count = v_accepted_count,
      rejected_count = p_rejected_count,
      error_report = CASE WHEN p_final_status = 'failed' THEN v_public_error_report ELSE NULL END,
      completed_at = pg_catalog.clock_timestamp()
  WHERE import_batch_id = p_import_batch_id;

  UPDATE public.outbox_jobs
  SET status = 'done',
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = pg_catalog.clock_timestamp(),
      last_error = NULL,
      updated_at = pg_catalog.clock_timestamp()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'work-order outbox lease lost before finalization', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;

  INSERT INTO public.change_audits(
    change_id, action, actor_role, source, metadata, created_at
  ) VALUES (
    'chg_' || pg_catalog.gen_random_uuid()::text,
    CASE WHEN p_final_status = 'ready' THEN 'work_order_import_ready' ELSE 'work_order_import_failed' END,
    'system',
    'finalize_work_order_import_validation',
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'import_batch_id', p_import_batch_id,
      'accepted_count', v_accepted_count,
      'rejected_count', p_rejected_count,
      'diagnostic_id', v_diagnostic_id
    )),
    pg_catalog.clock_timestamp()
  );
END;
$$;
REVOKE ALL ON FUNCTION finalize_work_order_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,INTEGER,JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION outbox_complete(
  p_job_id TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_final_status TEXT,
  p_last_error TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
BEGIN
  IF p_final_status IS NULL OR p_final_status NOT IN ('done','failed','dead') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid outbox final status', DETAIL = 'VALIDATION';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.outbox_jobs
    WHERE job_id = p_job_id AND job_type IN ('import_validate','work_order_import_validate')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'import validation must use its domain atomic finalizer', DETAIL = 'INV_BYPASS';
  END IF;
  UPDATE public.outbox_jobs
  SET status = p_final_status,
      lease_owner = NULL,
      lease_expires_at = NULL,
      completed_at = now(),
      last_error = CASE WHEN p_final_status = 'done' THEN NULL ELSE p_last_error END,
      updated_at = now()
  WHERE job_id = p_job_id
    AND status = 'running'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'outbox lease lost', DETAIL = 'OUTBOX_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION outbox_complete(TEXT,TEXT,BIGINT,TEXT,TEXT) FROM PUBLIC;

-- Token bucket: returns allowed + retry_after_sec (0 if allowed)
CREATE OR REPLACE FUNCTION rate_limit_take(
  p_bucket_key TEXT,
  p_capacity DOUBLE PRECISION,
  p_refill_per_sec DOUBLE PRECISION,
  p_cost DOUBLE PRECISION DEFAULT 1
) RETURNS TABLE(allowed BOOLEAN, retry_after_sec INT, tokens_left DOUBLE PRECISION)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r public.rate_limit_buckets%ROWTYPE;
  elapsed DOUBLE PRECISION;
  new_tokens DOUBLE PRECISION;
  need DOUBLE PRECISION;
  v_now TIMESTAMPTZ;
BEGIN
  IF p_bucket_key IS NULL OR pg_catalog.btrim(p_bucket_key) = ''
     OR p_capacity IS NULL OR p_refill_per_sec IS NULL OR p_cost IS NULL
     OR p_capacity <= 0 OR p_refill_per_sec <= 0 OR p_cost <= 0 OR p_cost > p_capacity THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid token bucket parameters', DETAIL = 'VALIDATION';
  END IF;
  INSERT INTO public.rate_limit_buckets(bucket_key, tokens, capacity, refill_per_sec, updated_at)
  VALUES (p_bucket_key, p_capacity, p_capacity, p_refill_per_sec, pg_catalog.clock_timestamp())
  ON CONFLICT (bucket_key) DO NOTHING;

  SELECT * INTO r FROM public.rate_limit_buckets WHERE bucket_key = p_bucket_key FOR UPDATE;
  v_now := pg_catalog.clock_timestamp();
  elapsed := greatest(0, EXTRACT(EPOCH FROM (v_now - r.updated_at)));
  new_tokens := LEAST(p_capacity, r.tokens + elapsed * p_refill_per_sec);
  IF new_tokens < p_cost THEN
    UPDATE public.rate_limit_buckets
      SET tokens = new_tokens, updated_at = v_now, capacity = p_capacity, refill_per_sec = p_refill_per_sec
      WHERE bucket_key = p_bucket_key;
    need := p_cost - new_tokens;
    allowed := FALSE;
    retry_after_sec := GREATEST(1, CEIL(need / NULLIF(p_refill_per_sec, 0))::INT);
    tokens_left := new_tokens;
    RETURN NEXT;
    RETURN;
  END IF;
  UPDATE public.rate_limit_buckets
    SET tokens = new_tokens - p_cost, updated_at = v_now, capacity = p_capacity, refill_per_sec = p_refill_per_sec
    WHERE bucket_key = p_bucket_key;
  allowed := TRUE;
  retry_after_sec := 0;
  tokens_left := new_tokens - p_cost;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) FROM PUBLIC;

-- Read-only fast path used before rate limiting. A miss does not reserve the key; claim remains authoritative.
CREATE OR REPLACE FUNCTION idempotency_lookup(
  p_scope TEXT,
  p_idem_key TEXT,
  p_user_id TEXT,
  p_request_hash TEXT,
  p_request_hash_key_version TEXT
) RETURNS TABLE(action TEXT, status_code INT, response_body JSONB, detail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r public.idempotency_keys%ROWTYPE;
BEGIN
  IF p_scope IS NULL OR pg_catalog.btrim(p_scope) = ''
     OR p_idem_key IS NULL OR pg_catalog.btrim(p_idem_key) = ''
     OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_request_hash IS NULL OR pg_catalog.btrim(p_request_hash) = ''
     OR p_request_hash_key_version IS NULL OR pg_catalog.btrim(p_request_hash_key_version) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'idempotency lookup inputs are required', DETAIL = 'VALIDATION';
  END IF;
  SELECT * INTO r
  FROM public.idempotency_keys
  WHERE scope = p_scope AND idem_key = p_idem_key;

  IF NOT FOUND OR r.expires_at <= pg_catalog.clock_timestamp() THEN
    action := 'miss'; status_code := NULL; response_body := NULL; detail := 'not_terminal';
  ELSIF r.user_id IS DISTINCT FROM p_user_id
        OR r.request_hash IS DISTINCT FROM p_request_hash
        OR r.request_hash_key_version IS DISTINCT FROM p_request_hash_key_version THEN
    action := 'conflict'; status_code := 409; response_body := NULL; detail := 'IDEMPOTENCY_BODY_MISMATCH';
  ELSIF r.status IN ('completed','failed') THEN
    action := 'replay'; status_code := r.status_code; response_body := r.response_body; detail := r.status;
  ELSIF r.status = 'pending'
        AND (r.lease_expires_at IS NULL OR r.lease_expires_at <= pg_catalog.clock_timestamp()) THEN
    action := 'miss'; status_code := NULL; response_body := NULL; detail := 'lease_reclaimable';
  ELSE
    action := 'conflict'; status_code := 409; response_body := NULL; detail := 'IDEMPOTENCY_IN_FLIGHT';
  END IF;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION idempotency_lookup(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Allows the API to retain/reselect the correct HMAC key during the 24h idempotency TTL without
-- exposing the stored digest or allowing a different user to probe an existing key.
CREATE OR REPLACE FUNCTION idempotency_request_hash_version(
  p_scope TEXT,
  p_idem_key TEXT,
  p_user_id TEXT
) RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT request_hash_key_version
  FROM public.idempotency_keys
  WHERE scope = p_scope
    AND idem_key = p_idem_key
    AND user_id IS NOT DISTINCT FROM p_user_id
    AND expires_at > pg_catalog.clock_timestamp()
$$;
REVOKE ALL ON FUNCTION idempotency_request_hash_version(TEXT,TEXT,TEXT) FROM PUBLIC;

-- Idempotency atomic claim. Returns action: proceed | replay | conflict plus fencing version.
CREATE OR REPLACE FUNCTION idempotency_claim(
  p_scope TEXT,
  p_idem_key TEXT,
  p_user_id TEXT,
  p_request_hash TEXT,
  p_request_hash_key_version TEXT,
  p_lease_owner TEXT,
  p_lease_seconds INT DEFAULT 60
) RETURNS TABLE(
  action TEXT,           -- proceed | replay | conflict
  status_code INT,
  response_body JSONB,
  detail TEXT,
  lease_version BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  r public.idempotency_keys%ROWTYPE;
  n INT;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds < 5 OR p_lease_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid idempotency lease', DETAIL = 'VALIDATION';
  END IF;
  IF p_request_hash IS NULL OR pg_catalog.btrim(p_request_hash) = ''
     OR p_request_hash_key_version IS NULL OR pg_catalog.btrim(p_request_hash_key_version) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'request hash and version are required', DETAIL = 'VALIDATION';
  END IF;
  IF p_scope IS NULL OR pg_catalog.btrim(p_scope) = ''
     OR p_idem_key IS NULL OR pg_catalog.btrim(p_idem_key) = ''
     OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_lease_owner IS NULL OR pg_catalog.btrim(p_lease_owner) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'idempotency claim identity is required', DETAIL = 'VALIDATION';
  END IF;
  INSERT INTO public.idempotency_keys(
    scope, idem_key, user_id, request_hash, request_hash_key_version, status, lease_owner, lease_version,
    lease_expires_at, created_at, updated_at, expires_at
  ) VALUES (
    p_scope, p_idem_key, p_user_id, p_request_hash, p_request_hash_key_version, 'pending', p_lease_owner, 1,
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '24 hours'
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 1 THEN
    action := 'proceed'; status_code := NULL; response_body := NULL; detail := 'claimed'; lease_version := 1;
    RETURN NEXT; RETURN;
  END IF;

  SELECT * INTO r FROM public.idempotency_keys
  WHERE scope = p_scope AND idem_key = p_idem_key FOR UPDATE;

  -- TTL expiry permits key reuse; lease expiry alone never permits a different body/user.
  IF r.expires_at <= pg_catalog.clock_timestamp() THEN
    UPDATE public.idempotency_keys
    SET user_id = p_user_id,
        request_hash = p_request_hash,
        request_hash_key_version = p_request_hash_key_version,
        status = 'pending',
        status_code = NULL,
        response_body = NULL,
        lease_owner = p_lease_owner,
        lease_version = r.lease_version + 1,
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        created_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp(),
        expires_at = pg_catalog.clock_timestamp() + interval '24 hours'
    WHERE scope = p_scope AND idem_key = p_idem_key;
    action := 'proceed'; status_code := NULL; response_body := NULL; detail := 'ttl_reclaimed';
    lease_version := r.lease_version + 1;
    RETURN NEXT; RETURN;
  END IF;

  IF r.user_id IS DISTINCT FROM p_user_id
     OR r.request_hash IS DISTINCT FROM p_request_hash
     OR r.request_hash_key_version IS DISTINCT FROM p_request_hash_key_version THEN
    action := 'conflict'; status_code := 409; response_body := NULL;
    detail := 'IDEMPOTENCY_BODY_MISMATCH'; lease_version := r.lease_version;
    RETURN NEXT; RETURN;
  END IF;
  IF r.status IN ('completed','failed') THEN
    action := 'replay'; status_code := r.status_code; response_body := r.response_body;
    detail := r.status; lease_version := r.lease_version;
    RETURN NEXT; RETURN;
  END IF;
  IF r.status = 'pending' AND r.lease_expires_at IS NOT NULL
     AND r.lease_expires_at > pg_catalog.clock_timestamp() THEN
    action := 'conflict'; status_code := 409; response_body := NULL;
    detail := 'IDEMPOTENCY_IN_FLIGHT'; lease_version := r.lease_version;
    RETURN NEXT; RETURN;
  END IF;
  -- Steal only an expired pending lease and increment the fencing token.
  UPDATE public.idempotency_keys
    SET status = 'pending',
        lease_owner = p_lease_owner,
        lease_version = r.lease_version + 1,
        lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds),
        updated_at = pg_catalog.clock_timestamp()
    WHERE scope = p_scope AND idem_key = p_idem_key;
  action := 'proceed'; status_code := NULL; response_body := NULL;
  detail := 'lease_reclaimed'; lease_version := r.lease_version + 1;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION idempotency_claim(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION idempotency_complete(
  p_scope TEXT,
  p_idem_key TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_status_code INT,
  p_response_body JSONB,
  p_ok BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
BEGIN
  IF p_scope IS NULL OR pg_catalog.btrim(p_scope) = ''
     OR p_idem_key IS NULL OR pg_catalog.btrim(p_idem_key) = ''
     OR p_lease_owner IS NULL OR pg_catalog.btrim(p_lease_owner) = ''
     OR p_lease_version IS NULL OR p_status_code IS NULL OR p_status_code < 100 OR p_status_code > 599
     OR p_response_body IS NULL OR p_ok IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid idempotency completion', DETAIL = 'VALIDATION';
  END IF;
  UPDATE public.idempotency_keys
    SET status = CASE WHEN p_ok THEN 'completed' ELSE 'failed' END,
        status_code = p_status_code,
        response_body = p_response_body,
        lease_expires_at = NULL,
        updated_at = pg_catalog.clock_timestamp()
  WHERE scope = p_scope
    AND idem_key = p_idem_key
    AND status = 'pending'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'idempotency lease lost', DETAIL = 'IDEMPOTENCY_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION idempotency_complete(TEXT,TEXT,TEXT,BIGINT,INT,JSONB,BOOLEAN) FROM PUBLIC;

CREATE OR REPLACE FUNCTION idempotency_heartbeat(
  p_scope TEXT,
  p_idem_key TEXT,
  p_lease_owner TEXT,
  p_lease_version BIGINT,
  p_extend_seconds INT DEFAULT 60
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  n INT;
BEGIN
  IF p_extend_seconds IS NULL OR p_extend_seconds < 5 OR p_extend_seconds > 300 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid heartbeat extension', DETAIL = 'VALIDATION';
  END IF;
  IF p_scope IS NULL OR pg_catalog.btrim(p_scope) = ''
     OR p_idem_key IS NULL OR pg_catalog.btrim(p_idem_key) = ''
     OR p_lease_owner IS NULL OR pg_catalog.btrim(p_lease_owner) = ''
     OR p_lease_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid idempotency heartbeat identity', DETAIL = 'VALIDATION';
  END IF;
  UPDATE public.idempotency_keys
  SET lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_extend_seconds),
      updated_at = pg_catalog.clock_timestamp()
  WHERE scope = p_scope
    AND idem_key = p_idem_key
    AND status = 'pending'
    AND lease_owner = p_lease_owner
    AND lease_version = p_lease_version
    AND lease_expires_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA006', MESSAGE = 'idempotency lease lost', DETAIL = 'IDEMPOTENCY_LEASE_LOST';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION idempotency_heartbeat(TEXT,TEXT,TEXT,BIGINT,INT) FROM PUBLIC;
