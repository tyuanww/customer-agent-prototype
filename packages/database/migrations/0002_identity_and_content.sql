-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0002_identity_and_content; source schema.v1.12 lines 98-981
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ─── Identity (minimal; OAuth ADR may extend) ───
CREATE TABLE IF NOT EXISTS app_users (
  user_id         TEXT PRIMARY KEY,
  feishu_open_id  TEXT UNIQUE,
  display_name    TEXT,
  role            TEXT NOT NULL CHECK (role IN ('agent','coach','owner','system')),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The notice body/version is an auditable product contract. A pilot-recorded search is accepted only
-- after the current authenticated user has accepted the one current notice version.
CREATE TABLE IF NOT EXISTS privacy_notices (
  notice_version   TEXT PRIMARY KEY,
  notice_text      TEXT NOT NULL CHECK (pg_catalog.btrim(notice_text) <> ''),
  content_hash     TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  status           TEXT NOT NULL CHECK (status IN ('draft','current','retired')),
  published_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT privacy_notice_publish_shape CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('current','retired') AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_privacy_notice_current
  ON privacy_notices(status) WHERE status = 'current';

-- One explicit decision per user/version. A changed decision requires a new notice version; the row is
-- append-only to app_runtime because it is the evidence that unlocked pilot_recorded collection.
CREATE TABLE IF NOT EXISTS notice_decisions (
  notice_version   TEXT NOT NULL REFERENCES privacy_notices(notice_version),
  user_id          TEXT NOT NULL,
  decision         TEXT NOT NULL CHECK (decision IN ('accepted','declined')),
  decision_source  TEXT NOT NULL DEFAULT 'first_run_prompt' CHECK (
    decision_source IN ('first_run_prompt','settings')
  ),
  decided_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_version, user_id)
);

-- CR-004 authoritative-source registry. A row is one approved, content-addressed source version;
-- "current" is deliberately NOT stored here. The only current canonical set is derived from
-- content_current -> content_releases -> release_source_bindings, so registry and runtime cannot drift.
-- source_ref is a safe public alias only. Internal URLs, tokens and object-store locators never belong here.
CREATE TABLE IF NOT EXISTS authoritative_source_versions (
  tenant_id          TEXT NOT NULL DEFAULT 'default' CHECK (pg_catalog.btrim(tenant_id) <> ''),
  source_version_id  TEXT PRIMARY KEY CHECK (
    source_version_id ~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  source_ref         TEXT NOT NULL CHECK (
    source_ref ~ '^SRC-[A-Z0-9][A-Z0-9._-]{0,126}$'
  ),
  domain             TEXT NOT NULL CHECK (domain IN ('presale','campaign','aftersale','product')),
  upstream_version   TEXT NOT NULL CHECK (pg_catalog.btrim(upstream_version) <> ''),
  snapshot_sha256    TEXT NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  use_class          TEXT NOT NULL CHECK (use_class IN ('canonical','reference')),
  owner_role         TEXT NOT NULL CHECK (pg_catalog.btrim(owner_role) <> ''),
  approval_evd       TEXT NOT NULL CHECK (pg_catalog.btrim(approval_evd) <> ''),
  approved_by        TEXT NOT NULL CHECK (pg_catalog.btrim(approved_by) <> ''),
  approved_at        TIMESTAMPTZ NOT NULL,
  review_due_at      TIMESTAMPTZ NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT authoritative_source_review_window CHECK (review_due_at >= approved_at),
  CONSTRAINT authoritative_source_alias_version_unique
    UNIQUE (tenant_id, source_ref, upstream_version),
  CONSTRAINT authoritative_source_version_domain_unique
    UNIQUE (source_version_id, domain),
  CONSTRAINT authoritative_source_version_alias_unique
    UNIQUE (source_version_id, domain, source_ref)
);

-- Suspension is permanent evidence for one immutable version. Restoring content requires registering
-- a new source_version_id; UPDATE/DELETE cannot erase the reason the old version stopped being eligible.
CREATE TABLE IF NOT EXISTS authoritative_source_suspensions (
  suspension_id      TEXT PRIMARY KEY CHECK (
    suspension_id ~ '^susp_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  source_version_id  TEXT NOT NULL UNIQUE REFERENCES authoritative_source_versions(source_version_id),
  reason_code        TEXT NOT NULL CHECK (reason_code IN (
    'SOURCE_REVOKED','SOURCE_COMPROMISED','SOURCE_EXPIRED','SOURCE_REPLACED'
  )),
  evidence_ref       TEXT NOT NULL CHECK (pg_catalog.btrim(evidence_ref) <> ''),
  suspended_by       TEXT NOT NULL CHECK (pg_catalog.btrim(suspended_by) <> ''),
  suspended_by_role  TEXT NOT NULL CHECK (suspended_by_role = 'owner'),
  suspended_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DEC-042 taxonomy history is append-only. A new taxonomy release gets a new version; old intent
-- IDs remain addressable and a version-to-version migration is expressed by an explicit mapping.
CREATE TABLE IF NOT EXISTS intent_taxonomy_versions (
  intent_taxonomy_version TEXT PRIMARY KEY CHECK (
    intent_taxonomy_version ~ '^itax_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  approval_evd            TEXT NOT NULL CHECK (pg_catalog.btrim(approval_evd) <> ''),
  approved_by             TEXT NOT NULL CHECK (pg_catalog.btrim(approved_by) <> ''),
  approved_at             TIMESTAMPTZ NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intent_taxonomy_entries (
  intent_taxonomy_version TEXT NOT NULL REFERENCES intent_taxonomy_versions(intent_taxonomy_version),
  intent_id                TEXT NOT NULL CHECK (intent_id ~ '^intent_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'),
  label                    TEXT NOT NULL CHECK (pg_catalog.btrim(label) <> ''),
  lifecycle                TEXT NOT NULL CHECK (lifecycle IN ('active','deprecated')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (intent_taxonomy_version, intent_id)
);

CREATE TABLE IF NOT EXISTS intent_taxonomy_mappings (
  mapping_id                 TEXT PRIMARY KEY CHECK (mapping_id ~ '^itmap_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'),
  from_taxonomy_version      TEXT NOT NULL,
  from_intent_id             TEXT NOT NULL,
  to_taxonomy_version        TEXT NOT NULL,
  to_intent_id               TEXT NOT NULL,
  mapping_type               TEXT NOT NULL CHECK (mapping_type IN ('rename','merge','split','deprecate')),
  approval_evd               TEXT NOT NULL CHECK (pg_catalog.btrim(approval_evd) <> ''),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT intent_taxonomy_mapping_source_fk
    FOREIGN KEY (from_taxonomy_version, from_intent_id)
    REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id),
  CONSTRAINT intent_taxonomy_mapping_target_fk
    FOREIGN KEY (to_taxonomy_version, to_intent_id)
    REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id),
  CONSTRAINT intent_taxonomy_mapping_not_identity CHECK (
    (from_taxonomy_version, from_intent_id) IS DISTINCT FROM
    (to_taxonomy_version, to_intent_id)
  ),
  CONSTRAINT intent_taxonomy_mapping_unique UNIQUE (
    from_taxonomy_version, from_intent_id, to_taxonomy_version, to_intent_id, mapping_type
  )
);

-- Arrays used as business scopes are sets: non-null, no blank member and no duplicate member.
CREATE OR REPLACE FUNCTION public.content_text_array_is_nonblank_unique(
  p_values TEXT[]
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_values IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.unnest(p_values) AS value(item)
      WHERE value.item IS NULL OR pg_catalog.btrim(value.item) = ''
    )
    AND pg_catalog.cardinality(p_values) = (
      SELECT pg_catalog.count(DISTINCT value.item)
      FROM pg_catalog.unnest(p_values) AS value(item)
    )
$$;
REVOKE ALL ON FUNCTION public.content_text_array_is_nonblank_unique(TEXT[]) FROM PUBLIC;

-- Phase 1 templates may contain only the two approved display placeholders. Machine keys are stored;
-- customer/order/date values and rendered answer bodies have no schema column and must never be logged.
CREATE OR REPLACE FUNCTION public.content_template_placeholders_are_valid(
  p_answer_text TEXT,
  p_placeholder_keys TEXT[]
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_answer_text IS NOT NULL
    AND pg_catalog.btrim(p_answer_text) <> ''
    AND public.content_text_array_is_nonblank_unique(p_placeholder_keys)
    AND p_placeholder_keys <@ ARRAY['order_id','date']::TEXT[]
    AND (pg_catalog.strpos(p_answer_text, '{订单号}') > 0) = ('order_id' = ANY(p_placeholder_keys))
    AND (pg_catalog.strpos(p_answer_text, '{日期}') > 0) = ('date' = ANY(p_placeholder_keys))
    AND pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(p_answer_text, '\{订单号\}', '', 'g'),
      '\{日期\}', '', 'g'
    ) !~ '[{}]'
$$;
REVOKE ALL ON FUNCTION public.content_template_placeholders_are_valid(TEXT,TEXT[]) FROM PUBLIC;

-- Search must apply both scope dimensions. Storewide content can match without product context;
-- category/sku content requires an exact typed context and therefore cannot be guessed from sku_hint.
CREATE OR REPLACE FUNCTION public.content_scope_matches(
  p_platform_scope TEXT[],
  p_product_scope_type TEXT,
  p_product_scope_refs TEXT[],
  p_platform TEXT,
  p_product_context_type TEXT,
  p_product_context_ref TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_platform IN ('qianniu','douyin')
    AND p_platform = ANY(p_platform_scope)
    AND (
      p_product_scope_type = 'storewide'
      OR (
        p_product_context_type = p_product_scope_type
        AND p_product_context_type IN ('category','sku')
        AND p_product_context_ref IS NOT NULL
        AND p_product_context_ref = ANY(p_product_scope_refs)
      )
    )
$$;
REVOKE ALL ON FUNCTION public.content_scope_matches(TEXT[],TEXT,TEXT[],TEXT,TEXT,TEXT) FROM PUBLIC;

-- Question identity comes from the normalized source asset, never row_number/ordinality. The array
-- is ordered only when hashing/publishing, after every stable ID and fingerprint has been supplied.
CREATE OR REPLACE FUNCTION public.content_questions_are_valid(
  p_questions JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN FALSE
    WHEN pg_catalog.jsonb_array_length(p_questions) < 1 THEN FALSE
    WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
      WHERE pg_catalog.jsonb_typeof(question.value) IS DISTINCT FROM 'object'
         OR NOT question.value ?& ARRAY[
           'question_id','question_version','question_text','question_hash',
           'semantic_family_id','origin_fingerprint','source_asset_id','source'
         ]
         OR question.value - ARRAY[
           'question_id','question_version','question_text','question_hash',
           'semantic_family_id','origin_fingerprint','source_asset_id','source',
           'source_query_id','promotion_review_ref','promoted_by_role','promoted_at'
         ] <> '{}'::jsonb
         OR coalesce(question.value ->> 'question_id', '') !~ '^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$'
         OR coalesce(question.value ->> 'question_version', '') !~ '^[1-9][0-9]{0,8}$'
         OR coalesce(pg_catalog.btrim(question.value ->> 'question_text'), '') = ''
         OR pg_catalog.length(question.value ->> 'question_text') > 500
         OR coalesce(question.value ->> 'question_hash', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(question.value ->> 'semantic_family_id', '') !~ '^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR coalesce(question.value ->> 'origin_fingerprint', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(question.value ->> 'source_asset_id', '') !~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR coalesce(question.value ->> 'source', '') NOT IN ('manual','from_log','import')
         OR (
           question.value ->> 'source' = 'from_log'
           AND (
             coalesce(pg_catalog.btrim(question.value ->> 'source_query_id'), '') = ''
             OR coalesce(pg_catalog.btrim(question.value ->> 'promotion_review_ref'), '') = ''
             OR coalesce(pg_catalog.btrim(question.value ->> 'promoted_by_role'), '') = ''
             OR coalesce(pg_catalog.btrim(question.value ->> 'promoted_at'), '') = ''
           )
         )
         OR (
           question.value ->> 'source' <> 'from_log'
           AND (
             question.value ->> 'source_query_id' IS NOT NULL
             OR question.value ->> 'promotion_review_ref' IS NOT NULL
             OR question.value ->> 'promoted_by_role' IS NOT NULL
             OR question.value ->> 'promoted_at' IS NOT NULL
           )
         )
    ) THEN FALSE
    WHEN (
      SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT question.value ->> 'question_id')
         AND pg_catalog.count(*) = pg_catalog.count(DISTINCT question.value ->> 'origin_fingerprint')
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
    ) IS DISTINCT FROM TRUE THEN FALSE
    ELSE TRUE
  END
$$;
REVOKE ALL ON FUNCTION public.content_questions_are_valid(JSONB) FROM PUBLIC;

-- DEC-042 fixed ASCII-key JCS subset. This helper is deliberately NOT a general Unicode RFC 8785
-- implementation: governance builders use fixed ASCII member names, C byte-order sorting, arrays,
-- strings, booleans, null and integers only. Arbitrary Unicode keys and numeric forms are rejected.
CREATE OR REPLACE FUNCTION public.jsonb_jcs(
  p_value JSONB
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_type TEXT;
  v_result TEXT;
BEGIN
  v_type := pg_catalog.jsonb_typeof(p_value);
  IF v_type = 'object' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS member(key, value)
      WHERE pg_catalog.octet_length(member.key) <> pg_catalog.length(member.key)
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = 'ZA001',
        MESSAGE = 'DEC-042 JCS subset only accepts fixed ASCII object keys',
        DETAIL = 'DEC042_JCS_SUBSET_INVALID';
    END IF;
    SELECT coalesce(
      '{' || pg_catalog.string_agg(
        pg_catalog.to_jsonb(member.key)::TEXT || ':' || public.jsonb_jcs(member.value),
        ',' ORDER BY member.key COLLATE "C"
      ) || '}',
      '{}'
    ) INTO v_result
    FROM pg_catalog.jsonb_each(p_value) AS member(key, value);
    RETURN v_result;
  ELSIF v_type = 'array' THEN
    SELECT coalesce(
      '[' || pg_catalog.string_agg(
        public.jsonb_jcs(member.value), ',' ORDER BY member.ordinality
      ) || ']',
      '[]'
    ) INTO v_result
    FROM pg_catalog.jsonb_array_elements(p_value) WITH ORDINALITY AS member(value, ordinality);
    RETURN v_result;
  ELSIF v_type = 'number' AND p_value::TEXT !~ '^-?(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA001',
      MESSAGE = 'DEC-042 JCS subset accepts integer numbers only',
      DETAIL = 'DEC042_JCS_SUBSET_INVALID';
  END IF;
  RETURN p_value::TEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.jsonb_jcs(JSONB) FROM PUBLIC;

-- Timestamps participating in a governance hash are serialized as fixed-width UTC strings. Casting a
-- timestamptz directly to JSON is session-TimeZone-sensitive and would produce different hashes for the
-- same instant. Microseconds are retained so this contract is deterministic without rounding.
CREATE OR REPLACE FUNCTION public.content_utc_timestamp_text(
  p_value TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.to_char(
    p_value AT TIME ZONE 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
  )
$$;
REVOKE ALL ON FUNCTION public.content_utc_timestamp_text(TIMESTAMPTZ) FROM PUBLIC;

-- Question hashes bind stable identity, version, redacted text, semantic family, source asset,
-- taxonomy and the separately keyed origin HMAC + key version. The HMAC is computed independently,
-- so including its opaque result is not circular. Promotion time is normalized to UTC again here.
CREATE OR REPLACE FUNCTION public.content_question_hash(
  p_question JSONB
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.encode(public.digest(pg_catalog.convert_to(public.jsonb_jcs(
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'intent_id', p_question ->> 'intent_id',
      'intent_taxonomy_version', p_question ->> 'intent_taxonomy_version',
      'origin_fingerprint', p_question ->> 'origin_fingerprint',
      'origin_fingerprint_key_version', p_question ->> 'origin_fingerprint_key_version',
      'promoted_by_role', p_question ->> 'promoted_by_role',
      'promoted_at', CASE
        WHEN p_question ->> 'promoted_at' IS NULL THEN NULL
        WHEN p_question ->> 'promoted_at' ~
          '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
        THEN public.content_utc_timestamp_text((p_question ->> 'promoted_at')::TIMESTAMPTZ)
        ELSE p_question ->> 'promoted_at'
      END,
      'promotion_review_ref', p_question ->> 'promotion_review_ref',
      'question_id', p_question ->> 'question_id',
      'question_text', p_question ->> 'question_text',
      'question_version', CASE
        WHEN p_question ->> 'question_version' ~ '^[1-9][0-9]{0,8}$'
        THEN (p_question ->> 'question_version')::INTEGER
        ELSE NULL
      END,
      'semantic_family_id', p_question ->> 'semantic_family_id',
      'source', p_question ->> 'source',
      'source_asset_id', p_question ->> 'source_asset_id',
      'source_query_id', p_question ->> 'source_query_id'
    ))
  ), 'UTF8'), 'sha256'), 'hex')
$$;
REVOKE ALL ON FUNCTION public.content_question_hash(JSONB) FROM PUBLIC;

-- Replace the early bootstrap definition with the complete DEC-042 execution contract before any
-- table CHECK consumes it. A question version is immutable and carries its own taxonomy and HMAC-key
-- version; from_log promotion evidence is non-null and UTC-normalized.
CREATE OR REPLACE FUNCTION public.content_questions_are_valid(
  p_questions JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_questions) IS DISTINCT FROM 'array' THEN FALSE
    WHEN pg_catalog.jsonb_array_length(p_questions) < 1 THEN FALSE
    WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
      WHERE pg_catalog.jsonb_typeof(question.value) IS DISTINCT FROM 'object'
         OR NOT question.value ?& ARRAY[
           'question_id','question_version','question_text','question_hash',
           'semantic_family_id','origin_fingerprint','origin_fingerprint_key_version',
           'source_asset_id','source','intent_taxonomy_version','intent_id'
         ]
         OR question.value - ARRAY[
           'question_id','question_version','question_text','question_hash',
           'semantic_family_id','origin_fingerprint','origin_fingerprint_key_version',
           'source_asset_id','source','intent_taxonomy_version','intent_id',
           'source_query_id','promotion_review_ref','promoted_by_role','promoted_at'
         ] <> '{}'::jsonb
         OR pg_catalog.jsonb_typeof(question.value -> 'question_id') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'question_version') IS DISTINCT FROM 'number'
         OR pg_catalog.jsonb_typeof(question.value -> 'question_text') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'question_hash') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'semantic_family_id') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'origin_fingerprint') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'origin_fingerprint_key_version') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'source_asset_id') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'source') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'intent_taxonomy_version') IS DISTINCT FROM 'string'
         OR pg_catalog.jsonb_typeof(question.value -> 'intent_id') IS DISTINCT FROM 'string'
         OR (
           question.value ? 'source_query_id'
           AND pg_catalog.jsonb_typeof(question.value -> 'source_query_id') NOT IN ('string','null')
         )
         OR (
           question.value ? 'promotion_review_ref'
           AND pg_catalog.jsonb_typeof(question.value -> 'promotion_review_ref') NOT IN ('string','null')
         )
         OR (
           question.value ? 'promoted_by_role'
           AND pg_catalog.jsonb_typeof(question.value -> 'promoted_by_role') NOT IN ('string','null')
         )
         OR (
           question.value ? 'promoted_at'
           AND pg_catalog.jsonb_typeof(question.value -> 'promoted_at') NOT IN ('string','null')
         )
         OR coalesce(question.value ->> 'question_id', '') !~ '^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$'
         OR coalesce(question.value ->> 'question_version', '') !~ '^[1-9][0-9]{0,8}$'
         OR coalesce(pg_catalog.btrim(question.value ->> 'question_text'), '') = ''
         OR pg_catalog.length(question.value ->> 'question_text') > 500
         OR coalesce(question.value ->> 'question_hash', '') !~ '^[0-9a-f]{64}$'
         OR question.value ->> 'question_hash' IS DISTINCT FROM public.content_question_hash(question.value)
         OR coalesce(question.value ->> 'semantic_family_id', '') !~ '^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR coalesce(question.value ->> 'origin_fingerprint', '') !~ '^[0-9a-f]{64}$'
         OR coalesce(question.value ->> 'origin_fingerprint_key_version', '') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
         OR coalesce(question.value ->> 'source_asset_id', '') !~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR coalesce(question.value ->> 'source', '') NOT IN ('manual','from_log','import')
         OR coalesce(question.value ->> 'intent_taxonomy_version', '') !~ '^itax_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR coalesce(question.value ->> 'intent_id', '') !~ '^intent_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
         OR (
           question.value ->> 'source' = 'from_log'
           AND (
             coalesce(pg_catalog.btrim(question.value ->> 'source_query_id'), '') = ''
             OR coalesce(pg_catalog.btrim(question.value ->> 'promotion_review_ref'), '') = ''
             OR coalesce(pg_catalog.btrim(question.value ->> 'promoted_by_role'), '') = ''
             OR coalesce(question.value ->> 'promoted_at', '') !~
               '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?Z$'
           )
         )
         OR (
           question.value ->> 'source' <> 'from_log'
           AND (
             question.value ->> 'source_query_id' IS NOT NULL
             OR question.value ->> 'promotion_review_ref' IS NOT NULL
             OR question.value ->> 'promoted_by_role' IS NOT NULL
             OR question.value ->> 'promoted_at' IS NOT NULL
           )
         )
    ) THEN FALSE
    WHEN (
      SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT question.value ->> 'question_id')
         AND pg_catalog.count(*) = pg_catalog.count(DISTINCT (
           question.value ->> 'origin_fingerprint_key_version',
           question.value ->> 'origin_fingerprint'
         ))
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
    ) IS DISTINCT FROM TRUE THEN FALSE
    ELSE TRUE
  END
$$;
REVOKE ALL ON FUNCTION public.content_questions_are_valid(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.content_questions_align_intent(
  p_questions JSONB,
  p_intent_taxonomy_version TEXT,
  p_intent_id TEXT
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.content_questions_are_valid(p_questions)
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
      WHERE question.value ->> 'intent_taxonomy_version' IS DISTINCT FROM p_intent_taxonomy_version
         OR question.value ->> 'intent_id' IS DISTINCT FROM p_intent_id
    )
$$;
REVOKE ALL ON FUNCTION public.content_questions_align_intent(JSONB,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.content_risk_categories_are_valid(
  p_risk_level TEXT,
  p_risk_categories TEXT[]
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.content_text_array_is_nonblank_unique(p_risk_categories)
    AND p_risk_categories <@ ARRAY[
      'refund_compensation','price_discount','campaign_rules','efficacy_safety_claim',
      'account_privacy','complaint_escalation','legal_commitment'
    ]::TEXT[]
    AND (
      (p_risk_level = 'high' AND pg_catalog.cardinality(p_risk_categories) > 0)
      OR (p_risk_level IN ('low','medium') AND pg_catalog.cardinality(p_risk_categories) = 0)
    )
$$;
REVOKE ALL ON FUNCTION public.content_risk_categories_are_valid(TEXT,TEXT[]) FROM PUBLIC;

-- Immutable identity of the exact quality-review population. Only deterministic, non-PII fields
-- participate; array order and unrelated worker metadata cannot change the hash. Equal counts with a
-- substituted script/content tuple therefore produce a different manifest and fail closed.
CREATE OR REPLACE FUNCTION public.content_quality_population_manifest_hash(
  p_rows JSONB
) RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_manifest JSONB;
BEGIN
  IF pg_catalog.jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality population must be a JSON array', DETAIL = 'QUALITY_POPULATION_INVALID';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_array_elements(p_rows) AS row_item(value)
    WHERE pg_catalog.jsonb_typeof(row_item.value) IS DISTINCT FROM 'object'
       OR (
         row_item.value ? 'operation'
         AND pg_catalog.jsonb_typeof(row_item.value -> 'operation') IS DISTINCT FROM 'string'
       )
       OR (
         coalesce(row_item.value ->> 'operation', 'upsert') = 'upsert'
         AND (
           pg_catalog.jsonb_typeof(row_item.value -> 'staging_id') IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(row_item.value -> 'script_id') IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(row_item.value -> 'content_hash') IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(row_item.value -> 'risk_level') IS DISTINCT FROM 'string'
           OR pg_catalog.jsonb_typeof(row_item.value -> 'has_conflict') IS DISTINCT FROM 'boolean'
           OR pg_catalog.jsonb_typeof(row_item.value -> 'quality_status') IS DISTINCT FROM 'string'
           OR coalesce(pg_catalog.btrim(row_item.value ->> 'staging_id'), '') = ''
           OR coalesce(pg_catalog.btrim(row_item.value ->> 'script_id'), '') = ''
           OR coalesce(row_item.value ->> 'content_hash', '') !~ '^[0-9a-f]{64}$'
           OR coalesce(row_item.value ->> 'risk_level', '') NOT IN ('low','medium','high')
           OR coalesce(row_item.value ->> 'quality_status', '') NOT IN ('clean','quarantined')
         )
       )
       OR coalesce(row_item.value ->> 'operation', 'upsert') NOT IN ('upsert','withdraw')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'quality population tuple is invalid', DETAIL = 'QUALITY_POPULATION_INVALID';
  END IF;

  SELECT coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'content_hash', row_item.value ->> 'content_hash',
        'has_conflict', row_item.value -> 'has_conflict',
        'quality_status', row_item.value ->> 'quality_status',
        'risk_level', row_item.value ->> 'risk_level',
        'script_id', row_item.value ->> 'script_id',
        'staging_id', row_item.value ->> 'staging_id'
      ) ORDER BY
        (row_item.value ->> 'script_id') COLLATE "C",
        (row_item.value ->> 'content_hash') COLLATE "C",
        (row_item.value ->> 'staging_id') COLLATE "C"
    ),
    '[]'::jsonb
  ) INTO v_manifest
  FROM pg_catalog.jsonb_array_elements(p_rows) AS row_item(value)
  WHERE coalesce(row_item.value ->> 'operation', 'upsert') = 'upsert';

  RETURN pg_catalog.encode(public.digest(
    pg_catalog.convert_to(public.jsonb_jcs(v_manifest), 'UTF8'),
    'sha256'
  ), 'hex');
END;
$$;
REVOKE ALL ON FUNCTION public.content_quality_population_manifest_hash(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.content_governance_snapshot(
  p_script_id TEXT,
  p_category TEXT,
  p_title TEXT,
  p_answer_text TEXT,
  p_source_ref TEXT,
  p_source_version_id TEXT,
  p_owner_role TEXT,
  p_review_due_at TIMESTAMPTZ,
  p_platform_scope TEXT[],
  p_product_scope_type TEXT,
  p_product_scope_refs TEXT[],
  p_effective_from TIMESTAMPTZ,
  p_effective_to TIMESTAMPTZ,
  p_intent_taxonomy_version TEXT,
  p_intent_id TEXT,
  p_risk_level TEXT,
  p_risk_categories TEXT[],
  p_has_conflict BOOLEAN,
  p_review_mode TEXT,
  p_primary_reviewer_id TEXT,
  p_primary_reviewer_role TEXT,
  p_primary_review_evd TEXT,
  p_secondary_reviewer_id TEXT,
  p_secondary_reviewer_role TEXT,
  p_secondary_review_evd TEXT,
  p_placeholder_keys TEXT[],
  p_questions JSONB
) RETURNS JSONB
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'answer_text', p_answer_text,
    'category', p_category,
    'effective_from', public.content_utc_timestamp_text(p_effective_from),
    'effective_to', CASE WHEN p_effective_to IS NULL THEN NULL ELSE public.content_utc_timestamp_text(p_effective_to) END,
    'has_conflict', p_has_conflict,
    'intent_id', p_intent_id,
    'intent_taxonomy_version', p_intent_taxonomy_version,
    'owner_role', p_owner_role,
    'placeholder_keys', (
      SELECT coalesce(pg_catalog.jsonb_agg(value.item ORDER BY value.item), '[]'::jsonb)
      FROM pg_catalog.unnest(p_placeholder_keys) AS value(item)
    ),
    'platform_scope', (
      SELECT pg_catalog.jsonb_agg(value.item ORDER BY value.item)
      FROM pg_catalog.unnest(p_platform_scope) AS value(item)
    ),
    'primary_reviewer_id', p_primary_reviewer_id,
    'primary_reviewer_role', p_primary_reviewer_role,
    'primary_review_evd', p_primary_review_evd,
    'product_scope_refs', (
      SELECT coalesce(pg_catalog.jsonb_agg(value.item ORDER BY value.item), '[]'::jsonb)
      FROM pg_catalog.unnest(p_product_scope_refs) AS value(item)
    ),
    'product_scope_type', p_product_scope_type,
    'questions', (
      SELECT pg_catalog.jsonb_agg(question.value ORDER BY question.value ->> 'question_id')
      FROM pg_catalog.jsonb_array_elements(p_questions) AS question(value)
    ),
    'review_due_at', public.content_utc_timestamp_text(p_review_due_at),
    'review_mode', p_review_mode,
    'risk_categories', (
      SELECT coalesce(pg_catalog.jsonb_agg(value.item ORDER BY value.item), '[]'::jsonb)
      FROM pg_catalog.unnest(p_risk_categories) AS value(item)
    ),
    'risk_level', p_risk_level,
    'script_id', p_script_id,
    'secondary_reviewer_id', p_secondary_reviewer_id,
    'secondary_reviewer_role', p_secondary_reviewer_role,
    'secondary_review_evd', p_secondary_review_evd,
    'source_ref', p_source_ref,
    'source_version_id', p_source_version_id,
    'title', p_title
  )
$$;
REVOKE ALL ON FUNCTION public.content_governance_snapshot(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.content_governance_hash(
  p_script_id TEXT,
  p_category TEXT,
  p_title TEXT,
  p_answer_text TEXT,
  p_source_ref TEXT,
  p_source_version_id TEXT,
  p_owner_role TEXT,
  p_review_due_at TIMESTAMPTZ,
  p_platform_scope TEXT[],
  p_product_scope_type TEXT,
  p_product_scope_refs TEXT[],
  p_effective_from TIMESTAMPTZ,
  p_effective_to TIMESTAMPTZ,
  p_intent_taxonomy_version TEXT,
  p_intent_id TEXT,
  p_risk_level TEXT,
  p_risk_categories TEXT[],
  p_has_conflict BOOLEAN,
  p_review_mode TEXT,
  p_primary_reviewer_id TEXT,
  p_primary_reviewer_role TEXT,
  p_primary_review_evd TEXT,
  p_secondary_reviewer_id TEXT,
  p_secondary_reviewer_role TEXT,
  p_secondary_review_evd TEXT,
  p_placeholder_keys TEXT[],
  p_questions JSONB
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT pg_catalog.encode(public.digest(pg_catalog.convert_to(public.jsonb_jcs(
    public.content_governance_snapshot(
      p_script_id, p_category, p_title, p_answer_text, p_source_ref, p_source_version_id,
      p_owner_role, p_review_due_at, p_platform_scope, p_product_scope_type,
      p_product_scope_refs, p_effective_from, p_effective_to,
      p_intent_taxonomy_version, p_intent_id, p_risk_level, p_risk_categories, p_has_conflict,
      p_review_mode, p_primary_reviewer_id, p_primary_reviewer_role, p_primary_review_evd,
      p_secondary_reviewer_id, p_secondary_reviewer_role, p_secondary_review_evd,
      p_placeholder_keys, p_questions
    )
  ), 'UTF8'), 'sha256'), 'hex')
$$;
REVOKE ALL ON FUNCTION public.content_governance_hash(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) FROM PUBLIC;

-- ─── Scripts (authoring/latest lineage; active answer SoR = content_current -> release_items) ───
CREATE TABLE IF NOT EXISTS scripts (
  script_id       TEXT PRIMARY KEY,
  category        TEXT NOT NULL CHECK (category IN ('presale','campaign','aftersale','product')),
  title           TEXT NOT NULL,
  answer_text     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('draft','in_review','published','archived')),
  version         INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  content_hash    TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  source_ref      TEXT NOT NULL CHECK (pg_catalog.btrim(source_ref) <> ''),
  source_version_id TEXT NOT NULL,
  platform_scope  TEXT[] NOT NULL,
  product_scope_type TEXT NOT NULL CHECK (product_scope_type IN ('storewide','category','sku')),
  product_scope_refs TEXT[] NOT NULL,
  campaign_tag    TEXT,
  effective_from  TIMESTAMPTZ NOT NULL,
  effective_to    TIMESTAMPTZ,  -- NULL = +infinity
  intent_taxonomy_version TEXT NOT NULL,
  intent_id        TEXT NOT NULL,
  risk_level       TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  risk_categories  TEXT[] NOT NULL,
  has_conflict     BOOLEAN NOT NULL DEFAULT FALSE,
  review_mode      TEXT NOT NULL CHECK (review_mode IN ('single','dual')),
  primary_reviewer_id TEXT NOT NULL CHECK (primary_reviewer_id ~ '^[0-9a-f]{64}$'),
  primary_reviewer_role TEXT NOT NULL CHECK (primary_reviewer_role = 'ROLE-CONTENT-LEAD'),
  primary_review_evd TEXT NOT NULL CHECK (pg_catalog.btrim(primary_review_evd) <> ''),
  secondary_reviewer_id TEXT,
  secondary_reviewer_role TEXT,
  secondary_review_evd TEXT,
  placeholder_keys TEXT[] NOT NULL,
  questions_json  JSONB NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 0,
  owner_role      TEXT NOT NULL CHECK (pg_catalog.btrim(owner_role) <> ''),
  review_due_at   TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at    TIMESTAMPTZ,
  CONSTRAINT scripts_effective_window CHECK (
    effective_to IS NULL OR effective_from < effective_to
  ),
  CONSTRAINT scripts_platform_scope CHECK (
    public.content_text_array_is_nonblank_unique(platform_scope)
    AND pg_catalog.cardinality(platform_scope) > 0
    AND platform_scope <@ ARRAY['qianniu','douyin']::TEXT[]
  ),
  CONSTRAINT scripts_product_scope CHECK (
    public.content_text_array_is_nonblank_unique(product_scope_refs)
    AND (
      (product_scope_type = 'storewide' AND pg_catalog.cardinality(product_scope_refs) = 0)
      OR (product_scope_type IN ('category','sku') AND pg_catalog.cardinality(product_scope_refs) > 0)
    )
  ),
  CONSTRAINT scripts_review_shape CHECK (
    (
      (risk_level = 'high' OR has_conflict)
      AND review_mode = 'dual'
      AND secondary_reviewer_id IS NOT NULL
      AND secondary_reviewer_id ~ '^[0-9a-f]{64}$'
      AND secondary_reviewer_id <> primary_reviewer_id
      AND secondary_reviewer_role = 'ROLE-CS-MANAGER'
      AND secondary_review_evd IS NOT NULL
      AND pg_catalog.btrim(secondary_review_evd) <> ''
    ) OR (
      risk_level IN ('low','medium') AND NOT has_conflict
      AND review_mode = 'single'
      AND secondary_reviewer_id IS NULL
      AND secondary_reviewer_role IS NULL
      AND secondary_review_evd IS NULL
    )
  ),
  CONSTRAINT scripts_risk_categories CHECK (
    public.content_risk_categories_are_valid(risk_level, risk_categories)
  ),
  CONSTRAINT scripts_placeholders CHECK (
    public.content_template_placeholders_are_valid(answer_text, placeholder_keys)
  ),
  CONSTRAINT scripts_questions CHECK (
    public.content_questions_align_intent(questions_json, intent_taxonomy_version, intent_id)
  ),
  CONSTRAINT scripts_intent_fk
    FOREIGN KEY (intent_taxonomy_version, intent_id)
    REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id),
  CONSTRAINT scripts_source_version_fk
    FOREIGN KEY (source_version_id, category, source_ref)
    REFERENCES authoritative_source_versions(source_version_id, domain, source_ref)
);

CREATE TABLE IF NOT EXISTS script_questions (
  question_id     TEXT NOT NULL CHECK (question_id ~ '^q_[A-Za-z0-9][A-Za-z0-9_-]{7,126}$'),
  script_id       TEXT NOT NULL REFERENCES scripts(script_id),
  question_version INTEGER NOT NULL CHECK (question_version >= 1),
  question_text   TEXT NOT NULL,
  question_hash   TEXT NOT NULL CHECK (question_hash ~ '^[0-9a-f]{64}$'),
  semantic_family_id TEXT NOT NULL CHECK (semantic_family_id ~ '^sf_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'),
  origin_fingerprint TEXT NOT NULL CHECK (origin_fingerprint ~ '^[0-9a-f]{64}$'),
  origin_fingerprint_key_version TEXT NOT NULL CHECK (
    origin_fingerprint_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  source_asset_id TEXT NOT NULL CHECK (source_asset_id ~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'),
  source          TEXT NOT NULL CHECK (source IN ('manual','from_log','import')),
  intent_taxonomy_version TEXT NOT NULL,
  intent_id        TEXT NOT NULL,
  source_query_id TEXT,
  promotion_review_ref TEXT,
  promoted_by_role TEXT,
  promoted_at     TIMESTAMPTZ,
  status          TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, question_version),
  CONSTRAINT script_question_promotion_shape CHECK (
    (
      source = 'from_log'
      AND source_query_id IS NOT NULL
      AND promotion_review_ref IS NOT NULL
      AND pg_catalog.btrim(promotion_review_ref) <> ''
      AND promoted_by_role IS NOT NULL
      AND pg_catalog.btrim(promoted_by_role) <> ''
      AND promoted_at IS NOT NULL
    )
    OR (
      source <> 'from_log'
      AND source_query_id IS NULL
      AND promotion_review_ref IS NULL
      AND promoted_by_role IS NULL
      AND promoted_at IS NULL
    )
  ),
  CONSTRAINT script_question_intent_fk
    FOREIGN KEY (intent_taxonomy_version, intent_id)
    REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id),
  CONSTRAINT script_question_origin_version_unique
    UNIQUE (origin_fingerprint_key_version, origin_fingerprint, question_version)
);

-- Full-text search (Postgres). Client may rebuild local FTS from release snapshot.
CREATE INDEX IF NOT EXISTS idx_scripts_published ON scripts(status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_scripts_effective ON scripts(effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_questions_script ON script_questions(script_id);

-- v_scripts_recommendable created after release_items / content_current (see end of file).
-- MUST read current release_items only — never raw scripts alone.
