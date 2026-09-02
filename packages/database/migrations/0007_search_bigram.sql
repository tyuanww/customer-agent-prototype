-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0007_search_bigram; source schema.v1.12 lines 6783-7405
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Runtime gate for current and historical snapshot reads. Services MUST check this view before search,
-- announcement or snapshot output; a false gate means fail closed, never return the remaining domains.
CREATE OR REPLACE VIEW v_release_source_gate AS
SELECT
  cr.release_id,
  cr.release_seq,
  cr.source_binding_hash,
  (
    stats.source_count = 4
    AND NOT stats.has_noncanonical
    AND NOT stats.has_suspension
    AND stats.computed_hash IS NOT DISTINCT FROM cr.source_binding_hash
  ) AS source_gate_ready,
  CASE
    WHEN stats.source_count <> 4 THEN 'SOURCE_SET_INCOMPLETE'
    WHEN stats.has_noncanonical THEN 'SOURCE_NOT_ELIGIBLE'
    WHEN stats.has_suspension THEN 'SOURCE_SUSPENDED'
    WHEN stats.computed_hash IS DISTINCT FROM cr.source_binding_hash THEN 'SOURCE_BINDING_HASH_MISMATCH'
    ELSE NULL
  END AS source_gate_reason,
  CASE
    WHEN stats.source_count = 4
      AND NOT stats.has_noncanonical
      AND NOT stats.has_suspension
      AND stats.computed_hash IS NOT DISTINCT FROM cr.source_binding_hash
    THEN NULL
    ELSE 'SOURCE_GATE_NOT_READY'
  END AS runtime_error_reason
FROM public.content_releases cr
CROSS JOIN LATERAL (
  SELECT
    pg_catalog.count(*)::INT AS source_count,
    coalesce(pg_catalog.bool_or(asv.use_class <> 'canonical'), FALSE) AS has_noncanonical,
    coalesce(pg_catalog.bool_or(susp.source_version_id IS NOT NULL), FALSE) AS has_suspension,
    pg_catalog.encode(public.digest(pg_catalog.convert_to(
      pg_catalog.string_agg(rsb.domain || ':' || rsb.source_version_id, '|' ORDER BY rsb.domain),
      'UTF8'
    ), 'sha256'), 'hex') AS computed_hash
  FROM public.release_source_bindings rsb
  JOIN public.authoritative_source_versions asv
    ON asv.source_version_id = rsb.source_version_id AND asv.domain = rsb.domain
  LEFT JOIN public.authoritative_source_suspensions susp
    ON susp.source_version_id = rsb.source_version_id
  WHERE rsb.release_id = cr.release_id
) stats;

-- Recommendable view: ONLY a source-gated current release (INV-NR). Created after base tables exist.
CREATE OR REPLACE VIEW v_scripts_recommendable AS
SELECT
  ri.script_id,
  ri.category,
  ri.title,
  ri.answer_text,
  ri.script_version AS version,
  ri.content_hash,
  ri.source_ref,
  ri.source_version_id,
  ri.owner_role,
  ri.review_due_at,
  ri.platform_scope,
  ri.product_scope_type,
  ri.product_scope_refs,
  ri.effective_from,
  ri.effective_to,
  ri.intent_taxonomy_version,
  ri.intent_id,
  ri.risk_level,
  ri.risk_categories,
  ri.has_conflict,
  ri.review_mode,
  ri.primary_reviewer_role,
  ri.primary_review_evd,
  ri.secondary_reviewer_role,
  ri.secondary_review_evd,
  ri.placeholder_keys,
  ri.questions_json,
  ri.search_document,
  ri.search_fallback_text,
  cc.current_release_id AS release_id,
  gate.source_binding_hash
FROM content_current cc
JOIN v_release_source_gate gate
  ON gate.release_id = cc.current_release_id AND gate.source_gate_ready
JOIN release_items ri ON ri.release_id = cc.current_release_id
WHERE ri.effective_from <= now()
  AND (ri.effective_to IS NULL OR now() < ri.effective_to)
  AND public.content_questions_source_assets_are_active(ri.questions_json);

-- The only app_runtime-readable search boundary. Scope is a mandatory function argument, so a caller
-- cannot accidentally omit a WHERE clause and broaden platform/category/SKU visibility. app_runtime
-- has neither SELECT on this backing view nor on release_items/content_current.
DROP FUNCTION IF EXISTS search_recommendable_scripts(TEXT,TEXT,TEXT);
CREATE OR REPLACE FUNCTION search_recommendable_scripts(
  p_platform TEXT,
  p_product_context_type TEXT DEFAULT NULL,
  p_product_context_ref TEXT DEFAULT NULL
) RETURNS TABLE(
  script_id TEXT,
  script_version INTEGER,
  content_hash TEXT,
  title TEXT,
  category TEXT,
  answer_text TEXT,
  platform_scope TEXT[],
  product_scope_type TEXT,
  product_scope_refs TEXT[],
  effective_from TIMESTAMPTZ,
  effective_to TIMESTAMPTZ,
  intent_taxonomy_version TEXT,
  intent_id TEXT,
  risk_level TEXT,
  risk_categories TEXT[],
  has_conflict BOOLEAN,
  placeholder_keys TEXT[],
  release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_platform IS NULL OR p_platform NOT IN ('qianniu','douyin') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'a confirmed platform is required for search', DETAIL = 'SEARCH_SCOPE_INVALID';
  END IF;
  IF NOT (
    (p_product_context_type IS NULL AND p_product_context_ref IS NULL)
    OR (
      p_product_context_type IN ('category','sku')
      AND p_product_context_ref IS NOT NULL
      AND pg_catalog.btrim(p_product_context_ref) <> ''
      AND pg_catalog.length(p_product_context_ref) <= 128
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'product context type and ref must be supplied together', DETAIL = 'SEARCH_SCOPE_INVALID';
  END IF;

  RETURN QUERY
  SELECT
    candidate.script_id,
    candidate.version,
    candidate.content_hash,
    candidate.title,
    candidate.category,
    candidate.answer_text,
    candidate.platform_scope,
    candidate.product_scope_type,
    candidate.product_scope_refs,
    candidate.effective_from,
    candidate.effective_to,
    candidate.intent_taxonomy_version,
    candidate.intent_id,
    candidate.risk_level,
    candidate.risk_categories,
    candidate.has_conflict,
    candidate.placeholder_keys,
    candidate.release_id,
    candidate.source_binding_hash
  FROM public.v_scripts_recommendable candidate
  WHERE public.content_scope_matches(
    candidate.platform_scope,
    candidate.product_scope_type,
    candidate.product_scope_refs,
    p_platform,
    p_product_context_type,
    p_product_context_ref
  );
END;
$$;
REVOKE ALL ON FUNCTION search_recommendable_scripts(TEXT,TEXT,TEXT) FROM PUBLIC;

-- Issue one opaque short lease for the source-gated current release. The shared advisory lock is
-- acquired first, matching publish/rollback/suspend lock order, so issuance cannot bind a half-switched
-- release. Only the token hash is persisted; the plaintext token is returned once to the caller.
CREATE OR REPLACE FUNCTION issue_snapshot_offline_lease(
  p_client_id TEXT,
  p_user_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
) RETURNS TABLE(
  offline_lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  release_id TEXT,
  source_binding_hash TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_got BOOLEAN;
  v_release_id TEXT;
  v_source_binding_hash TEXT;
  v_issued_at TIMESTAMPTZ;
  v_token_hash TEXT;
BEGIN
  IF p_client_id IS NULL OR pg_catalog.btrim(p_client_id) = ''
     OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_ttl_seconds IS NULL OR p_ttl_seconds < 60 OR p_ttl_seconds > 900 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'client, user and 60..900 second lease ttl are required', DETAIL = 'VALIDATION';
  END IF;

  v_got := pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('cs_ai_content_publish'));
  IF NOT v_got THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'snapshot lease source lock not acquired', DETAIL = 'CONFLICT';
  END IF;
  SELECT cc.current_release_id, gate.source_binding_hash
  INTO v_release_id, v_source_binding_hash
  FROM public.content_current cc
  JOIN public.v_release_source_gate gate
    ON gate.release_id = cc.current_release_id
   AND gate.source_gate_ready
  WHERE cc.id = 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'current source set is not ready for offline use', DETAIL = 'SOURCE_GATE_NOT_READY';
  END IF;

  v_issued_at := pg_catalog.clock_timestamp();
  offline_lease_token := 'osl_' || pg_catalog.encode(public.gen_random_bytes(32), 'hex');
  lease_expires_at := v_issued_at + pg_catalog.make_interval(secs => p_ttl_seconds);
  release_id := v_release_id;
  source_binding_hash := v_source_binding_hash;
  v_token_hash := pg_catalog.encode(public.digest(
    pg_catalog.convert_to(offline_lease_token, 'UTF8'), 'sha256'
  ), 'hex');

  INSERT INTO public.snapshot_offline_leases(
    lease_token_hash, client_id, user_id, release_id, source_binding_hash,
    issued_at, expires_at, created_at
  ) VALUES (
    v_token_hash, p_client_id, p_user_id, v_release_id, v_source_binding_hash,
    v_issued_at, lease_expires_at, v_issued_at
  );
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION issue_snapshot_offline_lease(TEXT,TEXT,INTEGER) FROM PUBLIC;

-- Every snapshot page and ACK validates the immutable token binding. Validation never extends expiry.
CREATE OR REPLACE FUNCTION validate_snapshot_offline_lease(
  p_offline_lease_token TEXT,
  p_client_id TEXT,
  p_user_id TEXT,
  p_release_id TEXT
) RETURNS TABLE(
  release_id TEXT,
  release_seq BIGINT,
  source_binding_hash TEXT,
  lease_expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_token_hash TEXT;
  v_lease public.snapshot_offline_leases%ROWTYPE;
  v_release_seq BIGINT;
  v_gate_ready BOOLEAN;
BEGIN
  IF p_offline_lease_token IS NULL OR p_offline_lease_token !~ '^osl_[0-9a-f]{64}$'
     OR p_client_id IS NULL OR pg_catalog.btrim(p_client_id) = ''
     OR p_user_id IS NULL OR pg_catalog.btrim(p_user_id) = ''
     OR p_release_id IS NULL OR pg_catalog.btrim(p_release_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'offline lease token is invalid', DETAIL = 'OFFLINE_LEASE_INVALID';
  END IF;
  v_token_hash := pg_catalog.encode(public.digest(
    pg_catalog.convert_to(p_offline_lease_token, 'UTF8'), 'sha256'
  ), 'hex');
  SELECT sol.* INTO v_lease
  FROM public.snapshot_offline_leases sol
  WHERE sol.lease_token_hash = v_token_hash;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'offline lease token is invalid', DETAIL = 'OFFLINE_LEASE_INVALID';
  END IF;
  IF v_lease.client_id IS DISTINCT FROM p_client_id
     OR v_lease.user_id IS DISTINCT FROM p_user_id
     OR v_lease.release_id IS DISTINCT FROM p_release_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'offline lease binding does not match request', DETAIL = 'OFFLINE_LEASE_BINDING_MISMATCH';
  END IF;
  IF v_lease.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'offline lease has expired', DETAIL = 'OFFLINE_LEASE_EXPIRED';
  END IF;

  SELECT cr.release_seq, gate.source_gate_ready
  INTO v_release_seq, v_gate_ready
  FROM public.content_releases cr
  JOIN public.v_release_source_gate gate ON gate.release_id = cr.release_id
  WHERE cr.release_id = v_lease.release_id
    AND cr.source_binding_hash = v_lease.source_binding_hash;
  IF NOT FOUND OR v_gate_ready IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA004', MESSAGE = 'leased source set is no longer ready', DETAIL = 'SOURCE_GATE_NOT_READY';
  END IF;

  release_id := v_lease.release_id;
  release_seq := v_release_seq;
  source_binding_hash := v_lease.source_binding_hash;
  lease_expires_at := v_lease.expires_at;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION validate_snapshot_offline_lease(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Controlled announce/current read. The lease issuance, current/source-gate validation and minimum
-- announcement projection execute behind one DEFINER boundary; app_runtime never reads SoR tables.
CREATE OR REPLACE FUNCTION read_current_announcement_with_lease(
  p_client_id TEXT,
  p_user_id TEXT,
  p_ttl_seconds INTEGER DEFAULT 600
) RETURNS TABLE(
  current_release_id TEXT,
  release_seq BIGINT,
  source_binding_hash TEXT,
  offline_lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  announcement_id TEXT,
  announcement_title TEXT,
  announcement_summary TEXT,
  announcement_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH authorized AS MATERIALIZED (
    SELECT lease.offline_lease_token, lease.lease_expires_at,
           lease.release_id, lease.source_binding_hash
    FROM public.issue_snapshot_offline_lease(p_client_id, p_user_id, p_ttl_seconds) lease
  )
  SELECT
    authorized.release_id,
    cr.release_seq,
    authorized.source_binding_hash,
    authorized.offline_lease_token,
    authorized.lease_expires_at,
    ann.announcement_id,
    ann.title,
    ann.summary,
    ann.created_at
  FROM authorized
  JOIN public.content_releases cr
    ON cr.release_id = authorized.release_id
   AND cr.source_binding_hash = authorized.source_binding_hash
  LEFT JOIN LATERAL (
    SELECT a.announcement_id, a.title, a.summary, a.created_at
    FROM public.announcements a
    WHERE a.release_id = authorized.release_id
    ORDER BY a.created_at DESC, a.announcement_id DESC
    LIMIT 1
  ) ann ON TRUE;
END;
$$;
REVOKE ALL ON FUNCTION read_current_announcement_with_lease(TEXT,TEXT,INTEGER) FROM PUBLIC;

-- Controlled snapshot page read. `authorized` and release_items are consumed by the same RETURN QUERY
-- statement and therefore the same PostgreSQL statement snapshot. The API receives one row even for an
-- empty page; only the wire-approved SnapshotItem fields are projected into items_json.
CREATE OR REPLACE FUNCTION read_snapshot_page(
  p_offline_lease_token TEXT,
  p_client_id TEXT,
  p_user_id TEXT,
  p_release_id TEXT,
  p_cursor TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 200
) RETURNS TABLE(
  release_id TEXT,
  release_seq BIGINT,
  source_binding_hash TEXT,
  lease_expires_at TIMESTAMPTZ,
  items_json JSONB,
  next_cursor TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500
     OR (p_cursor IS NOT NULL AND pg_catalog.btrim(p_cursor) = '') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'snapshot cursor or limit is invalid', DETAIL = 'VALIDATION';
  END IF;

  RETURN QUERY
  WITH authorized AS MATERIALIZED (
    SELECT lease.release_id, lease.release_seq, lease.source_binding_hash, lease.lease_expires_at
    FROM public.validate_snapshot_offline_lease(
      p_offline_lease_token, p_client_id, p_user_id, p_release_id
    ) lease
  ), ordered AS MATERIALIZED (
    SELECT
      ri.script_id,
      ri.script_version,
      ri.content_hash,
      ri.title,
      ri.category,
      ri.answer_text,
      ri.platform_scope,
      ri.product_scope_type,
      ri.product_scope_refs,
      ri.effective_from,
      ri.effective_to,
      ri.intent_taxonomy_version,
      ri.intent_id,
      ri.risk_level,
      ri.risk_categories,
      ri.has_conflict,
      ri.placeholder_keys,
      ri.questions_json
    FROM authorized
    JOIN public.release_items ri ON ri.release_id = authorized.release_id
    WHERE p_cursor IS NULL OR ri.script_id > p_cursor
    ORDER BY ri.script_id
    LIMIT p_limit + 1
  ), page AS MATERIALIZED (
    SELECT * FROM ordered ORDER BY script_id LIMIT p_limit
  )
  SELECT
    authorized.release_id,
    authorized.release_seq,
    authorized.source_binding_hash,
    authorized.lease_expires_at,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'script_id', page.script_id,
          'script_version', page.script_version,
          'content_hash', page.content_hash,
          'title', page.title,
          'category', page.category,
          'answer_text', page.answer_text,
          'platform_scope', pg_catalog.to_jsonb(page.platform_scope),
          'product_scope_type', page.product_scope_type,
          'product_scope_refs', pg_catalog.to_jsonb(page.product_scope_refs),
          'effective_from', page.effective_from,
          'effective_to', page.effective_to,
          'intent_taxonomy_version', page.intent_taxonomy_version,
          'intent_id', page.intent_id,
          'risk_level', page.risk_level,
          'risk_categories', pg_catalog.to_jsonb(page.risk_categories),
          'has_conflict', page.has_conflict,
          'placeholder_keys', pg_catalog.to_jsonb(page.placeholder_keys),
          'questions', public.content_public_questions(page.questions_json)
        ) ORDER BY page.script_id
      ) FILTER (WHERE page.script_id IS NOT NULL),
      '[]'::jsonb
    ),
    CASE
      WHEN (SELECT pg_catalog.count(*) FROM ordered) > p_limit
      THEN (SELECT p.script_id FROM page p ORDER BY p.script_id DESC LIMIT 1)
      ELSE NULL
    END
  FROM authorized
  LEFT JOIN page ON TRUE
  GROUP BY authorized.release_id, authorized.release_seq,
           authorized.source_binding_hash, authorized.lease_expires_at;
END;
$$;
REVOKE ALL ON FUNCTION read_snapshot_page(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;

-- app_runtime receives no raw import/staging SELECT. These actor-gated, closed projections expose
-- status and review preview only, never upload locators, reviewer subjects/EVD or search vectors.
CREATE OR REPLACE FUNCTION read_content_import_status(
  p_import_batch_id TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
) RETURNS TABLE(
  import_batch_id TEXT,
  status TEXT,
  quality_gate_passed BOOLEAN,
  clean_count INTEGER,
  quarantined_count INTEGER,
  error_report JSONB,
  created_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_actor_role NOT IN ('coach','owner')
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = ''
     OR p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'content import status requires coach or owner', DETAIL = 'FORBIDDEN';
  END IF;
  RETURN QUERY
  SELECT
    batch.import_batch_id,
    batch.status,
    batch.quality_gate_passed,
    batch.clean_count,
    batch.quarantined_count,
    batch.error_report,
    batch.created_at,
    batch.finished_at
  FROM public.import_batches batch
  WHERE batch.import_batch_id = p_import_batch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'content import batch not found', DETAIL = 'NOT_FOUND';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION read_content_import_status(TEXT,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION read_content_import_preview(
  p_import_batch_id TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT,
  p_cursor TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 100
) RETURNS TABLE(rows_json JSONB, next_cursor TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF p_actor_role NOT IN ('coach','owner')
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = ''
     OR p_import_batch_id IS NULL OR pg_catalog.btrim(p_import_batch_id) = '' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'content import preview requires coach or owner', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 200
     OR (p_cursor IS NOT NULL AND pg_catalog.btrim(p_cursor) = '') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'content import preview cursor or limit is invalid', DETAIL = 'VALIDATION';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.import_batches batch
    WHERE batch.import_batch_id = p_import_batch_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'content import batch not found', DETAIL = 'NOT_FOUND';
  END IF;

  RETURN QUERY
  WITH ordered AS MATERIALIZED (
    SELECT staged.*
    FROM public.staging_scripts staged
    WHERE staged.import_batch_id = p_import_batch_id
      AND (p_cursor IS NULL OR staged.staging_id > p_cursor)
    ORDER BY staged.staging_id
    LIMIT p_limit + 1
  ), page AS MATERIALIZED (
    SELECT * FROM ordered ORDER BY staging_id LIMIT p_limit
  )
  SELECT
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'staging_id', page.staging_id,
          'script_id', page.script_id,
          'operation', page.operation,
          'category', page.category,
          'title', page.title,
          'answer_text', page.answer_text,
          'content_hash', page.content_hash,
          'platform_scope', pg_catalog.to_jsonb(page.platform_scope),
          'product_scope_type', page.product_scope_type,
          'product_scope_refs', pg_catalog.to_jsonb(page.product_scope_refs),
          'effective_from', page.effective_from,
          'effective_to', page.effective_to,
          'intent_taxonomy_version', page.intent_taxonomy_version,
          'intent_id', page.intent_id,
          'risk_level', page.risk_level,
          'risk_categories', pg_catalog.to_jsonb(page.risk_categories),
          'has_conflict', page.has_conflict,
          'placeholder_keys', pg_catalog.to_jsonb(page.placeholder_keys),
          'questions', public.content_public_questions(page.questions_json),
          'quality_status', page.quality_status,
          'quality_issue_codes', page.quality_issue_codes
        ) ORDER BY page.staging_id
      ) FILTER (WHERE page.staging_id IS NOT NULL),
      '[]'::jsonb
    ),
    CASE
      WHEN (SELECT pg_catalog.count(*) FROM ordered) > p_limit
      THEN (SELECT staged_page.staging_id FROM page staged_page ORDER BY staged_page.staging_id DESC LIMIT 1)
      ELSE NULL
    END
  FROM page;
END;
$$;
REVOKE ALL ON FUNCTION read_content_import_preview(TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;

-- Defense in depth for the search route: an application bug cannot turn a broken source gate into a
-- recorded no-hit. query_events and impressions must be written in one request transaction; either
-- trigger aborts that transaction before any search telemetry can commit.
CREATE OR REPLACE FUNCTION trg_source_gate_search_telemetry_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.content_current cc
    JOIN public.v_release_source_gate gate
      ON gate.release_id = cc.current_release_id
     AND gate.source_gate_ready
    WHERE cc.id = 1
      AND cc.current_release_id = NEW.release_id
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA004',
      MESSAGE = 'search telemetry requires a ready current authoritative source set',
      DETAIL = 'SOURCE_GATE_NOT_READY';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trg_source_gate_search_telemetry_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS query_source_gate_telemetry_guard ON query_events;
CREATE TRIGGER query_source_gate_telemetry_guard
  BEFORE INSERT ON query_events
  FOR EACH ROW EXECUTE FUNCTION trg_source_gate_search_telemetry_guard();
DROP TRIGGER IF EXISTS impression_source_gate_telemetry_guard ON candidate_impressions;
CREATE TRIGGER impression_source_gate_telemetry_guard
  BEFORE INSERT ON candidate_impressions
  FOR EACH ROW EXECUTE FUNCTION trg_source_gate_search_telemetry_guard();
