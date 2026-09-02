-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0004_import_release_announce; source schema.v1.12 lines 1749-2630
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ─── Multi-user content: Import → Staging → Publish → Announce ───

CREATE TABLE IF NOT EXISTS import_batches (
  import_batch_id  TEXT PRIMARY KEY,
  source_type      TEXT NOT NULL CHECK (source_type IN ('excel','csv','feishu_api','seed','other')),
  source_ref       TEXT, -- restricted upload/object locator; never expose through HTTP responses
  source_sha256    TEXT,
  source_size_bytes BIGINT CHECK (source_size_bytes IS NULL OR source_size_bytes >= 0),
  base_release_id  TEXT,
  source_binding_hash TEXT NOT NULL CHECK (source_binding_hash ~ '^[0-9a-f]{64}$'),
  status           TEXT NOT NULL CHECK (status IN (
    'validating','failed','staged','publishing','published','rolled_back'
  )),
  quality_gate_passed BOOLEAN NOT NULL DEFAULT FALSE,
  clean_count      INTEGER NOT NULL DEFAULT 0 CHECK (clean_count >= 0),
  quarantined_count INTEGER NOT NULL DEFAULT 0 CHECK (quarantined_count >= 0),
  error_report     JSONB,
  actor_user_id    TEXT,
  actor_role       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
);

-- DEC-042 quality sampling is a two-step immutable protocol: freeze the plan before inspecting
-- results, then append exactly one evidence row. High-risk/conflict rows are excluded from the
-- ordinary denominator and reviewed 100% through mandatory_full_review_count.
CREATE TABLE IF NOT EXISTS content_quality_review_plans (
  plan_id                    TEXT PRIMARY KEY CHECK (
    plan_id ~ '^qplan_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  import_batch_id            TEXT NOT NULL UNIQUE REFERENCES import_batches(import_batch_id),
  sampling_policy_version    TEXT NOT NULL CHECK (pg_catalog.btrim(sampling_policy_version) <> ''),
  cutoff_at                  TIMESTAMPTZ NOT NULL,
  clean_population_count     INTEGER NOT NULL CHECK (clean_population_count BETWEEN 0 AND 5000),
  ordinary_population_count  INTEGER NOT NULL CHECK (ordinary_population_count >= 0),
  mandatory_full_review_count INTEGER NOT NULL CHECK (mandatory_full_review_count >= 0),
  initial_sample_target      INTEGER NOT NULL CHECK (initial_sample_target >= 0),
  expanded_sample_target     INTEGER NOT NULL CHECK (expanded_sample_target >= 0),
  selection_seed_hash        TEXT NOT NULL CHECK (selection_seed_hash ~ '^[0-9a-f]{64}$'),
  selection_manifest_hash    TEXT NOT NULL CHECK (selection_manifest_hash ~ '^[0-9a-f]{64}$'),
  population_manifest_hash   TEXT NOT NULL CHECK (population_manifest_hash ~ '^[0-9a-f]{64}$'),
  selection_algorithm        TEXT NOT NULL CHECK (selection_algorithm = 'sha256-ranked-v1'),
  frozen_at                  TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_plan_population_partition CHECK (
    clean_population_count = ordinary_population_count + mandatory_full_review_count
  ),
  CONSTRAINT quality_plan_initial_target CHECK (
    initial_sample_target = CASE
      WHEN ordinary_population_count <= 500 THEN ordinary_population_count
      ELSE LEAST(
        300,
        GREATEST(100, pg_catalog.ceil(ordinary_population_count * 0.10)::INTEGER)
      )
    END
  ),
  CONSTRAINT quality_plan_expanded_target CHECK (
    expanded_sample_target = CASE
      WHEN ordinary_population_count <= 500 THEN ordinary_population_count
      ELSE pg_catalog.ceil(ordinary_population_count * 0.30)::INTEGER
    END
  ),
  CONSTRAINT quality_plan_frozen_after_cutoff CHECK (frozen_at >= cutoff_at),
  CONSTRAINT quality_plan_manifest_identity UNIQUE (
    plan_id, import_batch_id, population_manifest_hash
  )
);

CREATE TABLE IF NOT EXISTS content_quality_review_evidence (
  plan_id                       TEXT PRIMARY KEY REFERENCES content_quality_review_plans(plan_id),
  import_batch_id               TEXT NOT NULL,
  population_manifest_hash      TEXT NOT NULL CHECK (population_manifest_hash ~ '^[0-9a-f]{64}$'),
  initial_sample_reviewed_count INTEGER NOT NULL CHECK (initial_sample_reviewed_count >= 0),
  initial_defect_count          INTEGER NOT NULL CHECK (
    initial_defect_count >= 0 AND initial_defect_count <= initial_sample_reviewed_count
  ),
  expanded_sample_reviewed_count INTEGER,
  expanded_defect_count          INTEGER,
  mandatory_reviewed_count       INTEGER NOT NULL CHECK (mandatory_reviewed_count >= 0),
  mandatory_defect_count         INTEGER NOT NULL CHECK (
    mandatory_defect_count >= 0 AND mandatory_defect_count <= mandatory_reviewed_count
  ),
  publishable_clean_count        INTEGER NOT NULL CHECK (publishable_clean_count >= 0),
  review_quarantined_count       INTEGER NOT NULL CHECK (review_quarantined_count >= 0),
  conclusion                     TEXT NOT NULL CHECK (conclusion IN ('passed','blocked')),
  evidence_ref                   TEXT NOT NULL CHECK (pg_catalog.btrim(evidence_ref) <> ''),
  recorded_at                    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quality_evidence_expansion_pair CHECK (
    (expanded_sample_reviewed_count IS NULL AND expanded_defect_count IS NULL)
    OR (
      expanded_sample_reviewed_count IS NOT NULL AND expanded_sample_reviewed_count >= 0
      AND expanded_defect_count IS NOT NULL AND expanded_defect_count >= 0
      AND expanded_defect_count <= expanded_sample_reviewed_count
    )
  ),
  CONSTRAINT quality_evidence_population_fk
    FOREIGN KEY (plan_id, import_batch_id, population_manifest_hash)
    REFERENCES content_quality_review_plans(plan_id, import_batch_id, population_manifest_hash)
);

-- v1.12 upgrade closure. There are no Ddev consumers; any legacy non-empty plan without an exact
-- population identity must fail this migration instead of being silently grandfathered.
ALTER TABLE content_quality_review_plans
  ADD COLUMN IF NOT EXISTS population_manifest_hash TEXT;
ALTER TABLE content_quality_review_plans
  ALTER COLUMN population_manifest_hash SET NOT NULL;
ALTER TABLE content_quality_review_evidence
  ADD COLUMN IF NOT EXISTS import_batch_id TEXT;
ALTER TABLE content_quality_review_evidence
  ALTER COLUMN import_batch_id SET NOT NULL;
ALTER TABLE content_quality_review_evidence
  ADD COLUMN IF NOT EXISTS population_manifest_hash TEXT;
ALTER TABLE content_quality_review_evidence
  ALTER COLUMN population_manifest_hash SET NOT NULL;
DO $quality_population_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.content_quality_review_plans'::pg_catalog.regclass
      AND conname = 'quality_plan_population_manifest_shape'
  ) THEN
    ALTER TABLE content_quality_review_plans
      ADD CONSTRAINT quality_plan_population_manifest_shape
      CHECK (population_manifest_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.content_quality_review_evidence'::pg_catalog.regclass
      AND conname = 'quality_evidence_population_manifest_shape'
  ) THEN
    ALTER TABLE content_quality_review_evidence
      ADD CONSTRAINT quality_evidence_population_manifest_shape
      CHECK (population_manifest_hash ~ '^[0-9a-f]{64}$');
  END IF;
  ALTER TABLE content_quality_review_evidence
    DROP CONSTRAINT IF EXISTS quality_evidence_population_fk;
  ALTER TABLE content_quality_review_plans
    DROP CONSTRAINT IF EXISTS quality_plan_manifest_identity;
  ALTER TABLE content_quality_review_plans
    ADD CONSTRAINT quality_plan_manifest_identity UNIQUE (
      plan_id, import_batch_id, population_manifest_hash
    );
  ALTER TABLE content_quality_review_evidence
    ADD CONSTRAINT quality_evidence_population_fk
    FOREIGN KEY (plan_id, import_batch_id, population_manifest_hash)
    REFERENCES content_quality_review_plans(plan_id, import_batch_id, population_manifest_hash);
END
$quality_population_constraints$;

-- Review decisions are server-side evidence, never normalized upload fields. `reviewer_subject_hash`
-- is a versioned HMAC/pseudonymous subject, not a real name or account ID. A high/conflict target must
-- have two approved rows with distinct subjects; the finalizer resolves them by (script_id,content_hash).
CREATE TABLE IF NOT EXISTS content_review_decisions (
  decision_id                 TEXT PRIMARY KEY CHECK (
    decision_id ~ '^crd_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  script_id                   TEXT NOT NULL CHECK (pg_catalog.btrim(script_id) <> ''),
  content_hash                TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  reviewer_role               TEXT NOT NULL CHECK (
    reviewer_role IN ('ROLE-CONTENT-LEAD','ROLE-CS-MANAGER')
  ),
  reviewer_subject_hash       TEXT NOT NULL CHECK (reviewer_subject_hash ~ '^[0-9a-f]{64}$'),
  reviewer_subject_key_version TEXT NOT NULL CHECK (
    reviewer_subject_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  evidence_ref                TEXT NOT NULL CHECK (pg_catalog.btrim(evidence_ref) <> ''),
  decision                    TEXT NOT NULL CHECK (decision IN ('approved','rejected')),
  decided_at                  TIMESTAMPTZ NOT NULL,
  recorded_at                 TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT content_review_role_once UNIQUE (script_id, content_hash, reviewer_role)
);

-- Defense in depth for the JSONB CHECK below. Authorized writers already validate this list in the
-- fenced finalizer; the immutable helper also closes JSONB duplicate/null/type gaps for privileged DML.
CREATE OR REPLACE FUNCTION public.import_issue_codes_are_public(
  p_codes JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_codes IS NULL THEN TRUE
    WHEN pg_catalog.jsonb_typeof(p_codes) IS DISTINCT FROM 'array' THEN FALSE
    ELSE
      pg_catalog.jsonb_array_length(p_codes) <= 26
      AND p_codes <@ '[
        "MISSING_REQUIRED_FIELD", "INVALID_FIELD_TYPE", "INVALID_VALUE",
        "DUPLICATE_SCRIPT_ID", "UNKNOWN_SCRIPT_ID", "INVALID_EFFECTIVE_WINDOW",
        "MISSING_EFFECTIVE_WINDOW", "HASH_MISMATCH", "UNSUPPORTED_FORMAT",
        "MACRO_DETECTED", "EXTERNAL_LINK_DETECTED", "ROW_LIMIT_EXCEEDED",
        "CONTENT_TOO_LARGE", "SOURCE_NOT_REGISTERED", "SOURCE_NOT_CANONICAL",
        "SOURCE_SUSPENDED", "SOURCE_DOMAIN_MISMATCH", "SOURCE_SNAPSHOT_MISMATCH",
        "SOURCE_SET_INCOMPLETE", "MISSING_PLATFORM_SCOPE", "INVALID_PRODUCT_SCOPE",
        "INVALID_TAXONOMY_REF", "INVALID_QUESTION_IDENTITY",
        "INVALID_REVIEW_EVIDENCE", "INVALID_PLACEHOLDER_TEMPLATE",
        "GOVERNANCE_HASH_MISMATCH"
      ]'::jsonb
      AND (
        SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT issue.code)
        FROM pg_catalog.jsonb_array_elements_text(p_codes) AS issue(code)
      )
  END
$$;
REVOKE ALL ON FUNCTION public.import_issue_codes_are_public(JSONB) FROM PUBLIC;

-- Row-quality issues are safe to expose in import preview. They never convert a malformed,
-- unsafe or unbound row into a quarantined row; those failures remain batch-fatal above.
CREATE OR REPLACE FUNCTION public.content_quality_issue_codes_are_public(
  p_codes JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN pg_catalog.jsonb_typeof(p_codes) IS DISTINCT FROM 'array' THEN FALSE
    ELSE
      pg_catalog.jsonb_array_length(p_codes) <= 8
      AND p_codes <@ '[
        "UNKNOWN_INTENT", "INTENT_MAPPING_REQUIRED", "UNRESOLVED_CONFLICT",
        "REVIEW_EVIDENCE_MISSING", "QUESTION_DUPLICATE",
        "QUESTION_HASH_MISMATCH", "QUESTION_ORIGIN_UNVERIFIED",
        "CONTENT_NEEDS_REVIEW"
      ]'::jsonb
      AND (
        SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT issue.code)
        FROM pg_catalog.jsonb_array_elements_text(p_codes) AS issue(code)
      )
  END
$$;
REVOKE ALL ON FUNCTION public.content_quality_issue_codes_are_public(JSONB) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.work_order_issue_codes_are_public(
  p_codes JSONB
) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT CASE
    WHEN p_codes IS NULL THEN TRUE
    WHEN pg_catalog.jsonb_typeof(p_codes) IS DISTINCT FROM 'array' THEN FALSE
    ELSE
      pg_catalog.jsonb_array_length(p_codes) <= 13
      AND p_codes <@ '[
        "MISSING_REQUIRED_FIELD", "INVALID_FIELD_TYPE", "INVALID_VALUE",
        "DUPLICATE_SOURCE_RECORD", "UNKNOWN_COLUMN", "SENSITIVE_COLUMN",
        "INVALID_DATE", "INVALID_DURATION", "HASH_MISMATCH",
        "UNSUPPORTED_FORMAT", "FORMULA_DETECTED", "ROW_LIMIT_EXCEEDED",
        "FILE_TOO_LARGE"
      ]'::jsonb
      AND (
        SELECT pg_catalog.count(*) = pg_catalog.count(DISTINCT issue.code)
        FROM pg_catalog.jsonb_array_elements_text(p_codes) AS issue(code)
      )
  END
$$;
REVOKE ALL ON FUNCTION public.work_order_issue_codes_are_public(JSONB) FROM PUBLIC;

-- Requested source bindings are an immutable input to one import. base_release_id lives on the batch;
-- publish later compares it with content_current before it may switch the four-domain source set.
CREATE TABLE IF NOT EXISTS import_batch_source_bindings (
  import_batch_id    TEXT NOT NULL REFERENCES import_batches(import_batch_id),
  domain             TEXT NOT NULL CHECK (domain IN ('presale','campaign','aftersale','product')),
  source_version_id  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (import_batch_id, domain),
  CONSTRAINT import_batch_source_binding_triple_unique
    UNIQUE (import_batch_id, domain, source_version_id),
  CONSTRAINT import_batch_source_version_fk
    FOREIGN KEY (source_version_id, domain)
    REFERENCES authoritative_source_versions(source_version_id, domain)
);

-- Staging rows: not searchable until publish succeeds
CREATE TABLE IF NOT EXISTS staging_scripts (
  staging_id       TEXT PRIMARY KEY,
  import_batch_id  TEXT NOT NULL REFERENCES import_batches(import_batch_id),
  script_id        TEXT NOT NULL,
  operation        TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert','withdraw')),
  category         TEXT NOT NULL CHECK (category IN ('presale','campaign','aftersale','product')),
  title            TEXT,
  answer_text      TEXT,
  content_hash     TEXT,
  source_ref       TEXT NOT NULL CHECK (source_ref ~ '^SRC-[A-Z0-9][A-Z0-9._-]{0,126}$'),
  source_version_id TEXT NOT NULL,
  owner_role       TEXT,
  review_due_at    TIMESTAMPTZ,
  platform_scope   TEXT[],
  product_scope_type TEXT,
  product_scope_refs TEXT[],
  campaign_tag     TEXT,
  effective_from   TIMESTAMPTZ,
  effective_to     TIMESTAMPTZ,
  intent_taxonomy_version TEXT,
  intent_id        TEXT,
  risk_level       TEXT,
  risk_categories  TEXT[],
  has_conflict     BOOLEAN,
  review_mode      TEXT,
  primary_reviewer_id TEXT,
  primary_reviewer_role TEXT,
  primary_review_evd TEXT,
  secondary_reviewer_id TEXT,
  secondary_reviewer_role TEXT,
  secondary_review_evd TEXT,
  placeholder_keys TEXT[],
  questions_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  search_document  TSVECTOR,
  search_fallback_text TEXT,
  validation_ok    BOOLEAN NOT NULL DEFAULT FALSE,
  validation_errors TEXT,
  quality_status   TEXT NOT NULL CHECK (quality_status IN ('clean','quarantined')),
  quality_issue_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  quality_gate_passed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT staging_questions_array CHECK (
    operation = 'withdraw' OR public.content_questions_align_intent(
      questions_json, intent_taxonomy_version, intent_id
    )
  ),
  CONSTRAINT staging_quality_issue_codes CHECK (
    public.content_quality_issue_codes_are_public(quality_issue_codes)
  ),
  CONSTRAINT staging_quality_shape CHECK (
    (
      quality_status = 'clean'
      AND quality_issue_codes = '[]'::jsonb
      AND quality_gate_passed
    ) OR (
      quality_status = 'quarantined'
      AND pg_catalog.jsonb_array_length(quality_issue_codes) > 0
      AND NOT quality_gate_passed
    )
  ),
  CONSTRAINT staging_operation_shape CHECK (
    (
      operation = 'withdraw'
      AND title IS NULL AND answer_text IS NULL AND content_hash IS NULL
      AND owner_role IS NULL AND review_due_at IS NULL
      AND platform_scope IS NULL AND product_scope_type IS NULL AND product_scope_refs IS NULL
      AND campaign_tag IS NULL
      AND effective_from IS NULL AND effective_to IS NULL
      AND intent_taxonomy_version IS NULL AND intent_id IS NULL
      AND risk_level IS NULL AND risk_categories IS NULL
      AND has_conflict IS NULL AND review_mode IS NULL
      AND primary_reviewer_id IS NULL AND primary_reviewer_role IS NULL
      AND primary_review_evd IS NULL
      AND secondary_reviewer_id IS NULL AND secondary_reviewer_role IS NULL
      AND secondary_review_evd IS NULL
      AND placeholder_keys IS NULL
      AND search_document IS NULL AND search_fallback_text IS NULL
      AND pg_catalog.jsonb_array_length(questions_json) = 0
      AND quality_status = 'clean' AND quality_gate_passed
    )
    OR (
      operation = 'upsert'
      AND title IS NOT NULL AND answer_text IS NOT NULL
      AND pg_catalog.btrim(title) <> '' AND pg_catalog.btrim(answer_text) <> ''
      AND owner_role IS NOT NULL AND pg_catalog.btrim(owner_role) <> ''
      AND review_due_at IS NOT NULL
      AND effective_from IS NOT NULL
      AND (effective_to IS NULL OR effective_from < effective_to)
      AND public.content_text_array_is_nonblank_unique(platform_scope)
      AND pg_catalog.cardinality(platform_scope) > 0
      AND platform_scope <@ ARRAY['qianniu','douyin']::TEXT[]
      AND product_scope_type IN ('storewide','category','sku')
      AND public.content_text_array_is_nonblank_unique(product_scope_refs)
      AND (
        (product_scope_type = 'storewide' AND pg_catalog.cardinality(product_scope_refs) = 0)
        OR (product_scope_type IN ('category','sku') AND pg_catalog.cardinality(product_scope_refs) > 0)
      )
      AND intent_taxonomy_version IS NOT NULL AND intent_id IS NOT NULL
      AND risk_level IN ('low','medium','high') AND has_conflict IS NOT NULL
      AND public.content_risk_categories_are_valid(risk_level, risk_categories)
      AND review_mode IN ('single','dual')
      AND primary_reviewer_id ~ '^[0-9a-f]{64}$'
      AND primary_reviewer_role = 'ROLE-CONTENT-LEAD'
      AND primary_review_evd IS NOT NULL AND pg_catalog.btrim(primary_review_evd) <> ''
      AND (
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
          AND secondary_reviewer_id IS NULL AND secondary_reviewer_role IS NULL
          AND secondary_review_evd IS NULL
        )
      )
      AND public.content_template_placeholders_are_valid(answer_text, placeholder_keys)
      AND content_hash ~ '^[0-9a-f]{64}$' AND search_document IS NOT NULL
      AND pg_catalog.length(search_document) > 0
      AND search_fallback_text IS NOT NULL AND pg_catalog.btrim(search_fallback_text) <> ''
    )
  ),
  CONSTRAINT staging_source_version_fk
    FOREIGN KEY (source_version_id, category, source_ref)
    REFERENCES authoritative_source_versions(source_version_id, domain, source_ref),
  CONSTRAINT staging_batch_source_binding_fk
    FOREIGN KEY (import_batch_id, category, source_version_id)
    REFERENCES import_batch_source_bindings(import_batch_id, domain, source_version_id),
  CONSTRAINT staging_batch_script_unique UNIQUE (import_batch_id, script_id)
);

CREATE INDEX IF NOT EXISTS idx_staging_batch ON staging_scripts(import_batch_id);

-- Recompute the quality population identity from rows actually persisted by the fenced finalizer.
-- This is intentionally a safe tuple projection; reviewer subjects, source locators and free text
-- never enter the long-lived quality evidence identity.
CREATE OR REPLACE FUNCTION public.content_quality_staging_population_manifest_hash(
  p_import_batch_id TEXT
) RETURNS TEXT
LANGUAGE sql
STABLE
STRICT
PARALLEL RESTRICTED
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT public.content_quality_population_manifest_hash(
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'staging_id', staged.staging_id,
          'script_id', staged.script_id,
          'operation', staged.operation,
          'content_hash', staged.content_hash,
          'risk_level', staged.risk_level,
          'has_conflict', staged.has_conflict,
          'quality_status', staged.quality_status
        ) ORDER BY staged.staging_id COLLATE "C"
      ),
      '[]'::jsonb
    )
  )
  FROM public.staging_scripts staged
  WHERE staged.import_batch_id = p_import_batch_id
$$;
REVOKE ALL ON FUNCTION public.content_quality_staging_population_manifest_hash(TEXT) FROM PUBLIC;

-- Immutable publish unit
CREATE TABLE IF NOT EXISTS content_releases (
  release_id       TEXT PRIMARY KEY,
  release_seq      BIGINT NOT NULL UNIQUE,
  title            TEXT,
  summary          TEXT,
  import_batch_id  TEXT REFERENCES import_batches(import_batch_id),
  rollback_of_release_id TEXT REFERENCES content_releases(release_id),
  status           TEXT NOT NULL CHECK (status IN ('published','superseded','rolled_back')),
  source_binding_hash TEXT NOT NULL CHECK (source_binding_hash ~ '^[0-9a-f]{64}$'),
  published_by     TEXT,
  published_by_role TEXT,
  published_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_source_binding_hash
  ON content_releases(release_id, source_binding_hash);

-- One immutable source version per domain, exactly four rows per release. A deferred constraint trigger
-- below checks completeness after the release row, bindings and items have been built in one transaction.
CREATE TABLE IF NOT EXISTS release_source_bindings (
  release_id         TEXT NOT NULL REFERENCES content_releases(release_id),
  domain             TEXT NOT NULL CHECK (domain IN ('presale','campaign','aftersale','product')),
  source_version_id  TEXT NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (release_id, domain),
  CONSTRAINT release_source_binding_triple_unique
    UNIQUE (release_id, domain, source_version_id),
  CONSTRAINT release_source_version_fk
    FOREIGN KEY (source_version_id, domain)
    REFERENCES authoritative_source_versions(source_version_id, domain)
);

-- Snapshot of each script body AT publish time (immutable history)
CREATE TABLE IF NOT EXISTS release_items (
  release_id       TEXT NOT NULL REFERENCES content_releases(release_id),
  script_id        TEXT NOT NULL,
  script_version   INTEGER NOT NULL,
  content_hash     TEXT NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  answer_text      TEXT NOT NULL,  -- frozen copy; phase1 search answers must match SoR or this snapshot
  title            TEXT NOT NULL,
  category         TEXT NOT NULL CHECK (category IN ('presale','campaign','aftersale','product')),
  source_ref       TEXT NOT NULL CHECK (pg_catalog.btrim(source_ref) <> ''),
  source_version_id TEXT NOT NULL,
  owner_role       TEXT NOT NULL CHECK (pg_catalog.btrim(owner_role) <> ''),
  review_due_at    TIMESTAMPTZ NOT NULL,
  effective_from   TIMESTAMPTZ NOT NULL,
  effective_to     TIMESTAMPTZ,
  platform_scope   TEXT[] NOT NULL,
  product_scope_type TEXT NOT NULL CHECK (product_scope_type IN ('storewide','category','sku')),
  product_scope_refs TEXT[] NOT NULL,
  intent_taxonomy_version TEXT NOT NULL,
  intent_id        TEXT NOT NULL,
  risk_level       TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  risk_categories  TEXT[] NOT NULL,
  has_conflict     BOOLEAN NOT NULL,
  review_mode      TEXT NOT NULL CHECK (review_mode IN ('single','dual')),
  primary_reviewer_id TEXT NOT NULL CHECK (primary_reviewer_id ~ '^[0-9a-f]{64}$'),
  primary_reviewer_role TEXT NOT NULL CHECK (primary_reviewer_role = 'ROLE-CONTENT-LEAD'),
  primary_review_evd TEXT NOT NULL CHECK (pg_catalog.btrim(primary_review_evd) <> ''),
  secondary_reviewer_id TEXT,
  secondary_reviewer_role TEXT,
  secondary_review_evd TEXT,
  placeholder_keys TEXT[] NOT NULL,
  questions_json   JSONB NOT NULL,
  search_document  TSVECTOR NOT NULL,
  search_fallback_text TEXT NOT NULL,
  PRIMARY KEY (release_id, script_id),
  CONSTRAINT release_questions_array CHECK (
    public.content_questions_align_intent(questions_json, intent_taxonomy_version, intent_id)
  ),
  CONSTRAINT release_effective_window CHECK (
    effective_to IS NULL OR effective_from < effective_to
  ),
  CONSTRAINT release_platform_scope CHECK (
    public.content_text_array_is_nonblank_unique(platform_scope)
    AND pg_catalog.cardinality(platform_scope) > 0
    AND platform_scope <@ ARRAY['qianniu','douyin']::TEXT[]
  ),
  CONSTRAINT release_product_scope CHECK (
    public.content_text_array_is_nonblank_unique(product_scope_refs)
    AND (
      (product_scope_type = 'storewide' AND pg_catalog.cardinality(product_scope_refs) = 0)
      OR (product_scope_type IN ('category','sku') AND pg_catalog.cardinality(product_scope_refs) > 0)
    )
  ),
  CONSTRAINT release_review_shape CHECK (
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
      AND secondary_reviewer_id IS NULL AND secondary_reviewer_role IS NULL
      AND secondary_review_evd IS NULL
    )
  ),
  CONSTRAINT release_risk_categories CHECK (
    public.content_risk_categories_are_valid(risk_level, risk_categories)
  ),
  CONSTRAINT release_placeholders CHECK (
    public.content_template_placeholders_are_valid(answer_text, placeholder_keys)
  ),
  CONSTRAINT release_text_nonempty CHECK (
    pg_catalog.btrim(title) <> '' AND pg_catalog.btrim(answer_text) <> ''
    AND pg_catalog.btrim(search_fallback_text) <> ''
  ),
  CONSTRAINT release_item_source_version_fk
    FOREIGN KEY (source_version_id, category, source_ref)
    REFERENCES authoritative_source_versions(source_version_id, domain, source_ref),
  CONSTRAINT release_item_source_binding_fk
    FOREIGN KEY (release_id, category, source_version_id)
    REFERENCES release_source_bindings(release_id, domain, source_version_id),
  CONSTRAINT release_item_intent_fk
    FOREIGN KEY (intent_taxonomy_version, intent_id)
    REFERENCES intent_taxonomy_entries(intent_taxonomy_version, intent_id),
  CONSTRAINT release_search_document_nonempty CHECK (pg_catalog.length(search_document) > 0)
);

CREATE INDEX IF NOT EXISTS idx_release_items_search_document
  ON release_items USING GIN (search_document);
CREATE INDEX IF NOT EXISTS idx_release_items_search_fallback_trgm
  ON release_items USING GIN (search_fallback_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS content_current (
  id                   INT PRIMARY KEY CHECK (id = 1),
  current_release_id   TEXT NOT NULL REFERENCES content_releases(release_id),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS announcements (
  announcement_id  TEXT PRIMARY KEY,
  release_id       TEXT NOT NULL REFERENCES content_releases(release_id),
  title            TEXT NOT NULL,
  summary          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Short, immutable offline entitlement. Only the SHA-256 of the bearer token is stored; the token
-- returned once by issue_snapshot_offline_lease is bound to one client/user/release/source-set and
-- expires within 15 minutes. ACK records use but can never extend or replace this expiry.
CREATE TABLE IF NOT EXISTS snapshot_offline_leases (
  lease_token_hash    TEXT PRIMARY KEY CHECK (lease_token_hash ~ '^[0-9a-f]{64}$'),
  client_id           TEXT NOT NULL CHECK (pg_catalog.btrim(client_id) <> ''),
  user_id             TEXT NOT NULL CHECK (pg_catalog.btrim(user_id) <> ''),
  release_id          TEXT NOT NULL,
  source_binding_hash TEXT NOT NULL CHECK (source_binding_hash ~ '^[0-9a-f]{64}$'),
  issued_at           TIMESTAMPTZ NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT snapshot_offline_lease_release_fk
    FOREIGN KEY (release_id, source_binding_hash)
    REFERENCES content_releases(release_id, source_binding_hash),
  CONSTRAINT snapshot_offline_lease_window CHECK (
    expires_at > issued_at
    AND expires_at <= issued_at + INTERVAL '15 minutes'
  )
);

-- Rejected source operations are audited only after the rejected business transaction rolls back.
-- This table intentionally contains no raw query, internal source locator, token or stack trace.
CREATE TABLE IF NOT EXISTS source_denial_audits (
  denial_key          TEXT PRIMARY KEY CHECK (denial_key ~ '^sda_[0-9a-f]{64}$'),
  operation           TEXT NOT NULL CHECK (operation IN (
    'content_import','content_publish','content_rollback','search',
    'announce_current','announce_snapshot','announce_ack','source_suspend'
  )),
  reason_code         TEXT NOT NULL CHECK (reason_code IN (
    'SOURCE_NOT_REGISTERED','SOURCE_NOT_ELIGIBLE','SOURCE_SUSPENDED',
    'SOURCE_DOMAIN_MISMATCH','SOURCE_SNAPSHOT_MISMATCH','SOURCE_SET_INCOMPLETE',
    'SOURCE_BASE_RELEASE_STALE','SOURCE_BINDING_HASH_MISMATCH','SOURCE_GATE_NOT_READY',
    'OFFLINE_LEASE_INVALID','OFFLINE_LEASE_EXPIRED','OFFLINE_LEASE_BINDING_MISMATCH'
  )),
  actor_subject_hash  TEXT NOT NULL CHECK (actor_subject_hash ~ '^[0-9a-f]{64}$'),
  hash_key_version    TEXT NOT NULL CHECK (pg_catalog.btrim(hash_key_version) <> ''),
  actor_role          TEXT NOT NULL CHECK (actor_role IN ('agent','coach','owner')),
  release_id          TEXT CHECK (release_id IS NULL OR pg_catalog.btrim(release_id) <> ''),
  source_version_id   TEXT CHECK (
    source_version_id IS NULL OR source_version_id ~ '^srcv_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  source_binding_hash TEXT CHECK (
    source_binding_hash IS NULL OR source_binding_hash ~ '^[0-9a-f]{64}$'
  ),
  diagnostic_id       TEXT NOT NULL CHECK (diagnostic_id ~ '^diag_[0-9a-f]{32}$'),
  committed_at        TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE IF NOT EXISTS client_sync_state (
  client_id              TEXT PRIMARY KEY,
  user_id                TEXT,
  last_seen_release_id   TEXT,
  last_seen_release_seq  BIGINT,
  last_seen_source_binding_hash TEXT,
  last_ack_lease_token_hash TEXT,
  last_ack_at            TIMESTAMPTZ,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE client_sync_state ADD COLUMN IF NOT EXISTS last_seen_source_binding_hash TEXT;
ALTER TABLE client_sync_state ADD COLUMN IF NOT EXISTS last_ack_lease_token_hash TEXT;
-- Legacy ACKs have no cryptographic source-set/lease binding and therefore cannot authorize offline use.
-- Reset only the derived sync cursor; clients must obtain a fresh short lease and ACK again.
UPDATE client_sync_state
SET last_seen_release_id = NULL,
    last_seen_release_seq = NULL,
    last_seen_source_binding_hash = NULL,
    last_ack_lease_token_hash = NULL,
    last_ack_at = NULL,
    updated_at = pg_catalog.clock_timestamp()
WHERE last_seen_release_id IS NOT NULL
  AND (last_seen_source_binding_hash IS NULL OR last_ack_lease_token_hash IS NULL);

CREATE INDEX IF NOT EXISTS idx_announcements_release ON announcements(release_id);
CREATE INDEX IF NOT EXISTS idx_release_seq ON content_releases(release_seq);

-- Provenance closure. Search is disabled until a release exists, therefore every recorded query and
-- candidate must point to the exact immutable snapshot used for that answer.
CREATE UNIQUE INDEX IF NOT EXISTS uq_query_release
  ON query_events(query_id, release_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_id_seq
  ON content_releases(release_id, release_seq);
CREATE UNIQUE INDEX IF NOT EXISTS uq_release_item_provenance
  ON release_items(release_id, script_id, script_version, content_hash);

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.query_events'::pg_catalog.regclass AND conname = 'query_release_fk') THEN
    ALTER TABLE query_events
      ADD CONSTRAINT query_release_fk
      FOREIGN KEY (release_id) REFERENCES content_releases(release_id);
  END IF;
  ALTER TABLE script_questions DROP CONSTRAINT IF EXISTS script_question_source_query_fk;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.script_questions'::pg_catalog.regclass
      AND conname = 'script_question_source_asset_fk'
  ) THEN
    ALTER TABLE script_questions
      ADD CONSTRAINT script_question_source_asset_fk
      FOREIGN KEY (
        source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint
      ) REFERENCES semantic_source_assets(
        source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint
      ) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.candidate_impressions'::pg_catalog.regclass AND conname = 'candidate_query_release_fk') THEN
    ALTER TABLE candidate_impressions
      ADD CONSTRAINT candidate_query_release_fk
      FOREIGN KEY (query_id, release_id) REFERENCES query_events(query_id, release_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.candidate_impressions'::pg_catalog.regclass AND conname = 'candidate_release_item_fk') THEN
    ALTER TABLE candidate_impressions
      ADD CONSTRAINT candidate_release_item_fk
      FOREIGN KEY (release_id, script_id) REFERENCES release_items(release_id, script_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.candidate_impressions'::pg_catalog.regclass AND conname = 'candidate_release_item_provenance_fk') THEN
    ALTER TABLE candidate_impressions
      ADD CONSTRAINT candidate_release_item_provenance_fk
      FOREIGN KEY (release_id, script_id, script_version, content_hash)
      REFERENCES release_items(release_id, script_id, script_version, content_hash);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.escalate_actions'::pg_catalog.regclass AND conname = 'escalate_query_owner_fk') THEN
    ALTER TABLE escalate_actions
      ADD CONSTRAINT escalate_query_owner_fk
      FOREIGN KEY (query_id, user_id) REFERENCES query_events(query_id, user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.client_sync_state'::pg_catalog.regclass AND conname = 'client_sync_release_pair_shape') THEN
    ALTER TABLE client_sync_state
      ADD CONSTRAINT client_sync_release_pair_shape CHECK (
        (last_seen_release_id IS NULL AND last_seen_release_seq IS NULL)
        OR (last_seen_release_id IS NOT NULL AND last_seen_release_seq IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.client_sync_state'::pg_catalog.regclass AND conname = 'client_sync_release_pair_fk') THEN
    ALTER TABLE client_sync_state
      ADD CONSTRAINT client_sync_release_pair_fk
      FOREIGN KEY (last_seen_release_id, last_seen_release_seq)
      REFERENCES content_releases(release_id, release_seq);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.client_sync_state'::pg_catalog.regclass AND conname = 'client_sync_lease_shape') THEN
    ALTER TABLE client_sync_state
      ADD CONSTRAINT client_sync_lease_shape CHECK (
        (
          last_seen_release_id IS NULL
          AND last_seen_release_seq IS NULL
          AND last_seen_source_binding_hash IS NULL
          AND last_ack_lease_token_hash IS NULL
        )
        OR (
          user_id IS NOT NULL
          AND last_seen_release_id IS NOT NULL
          AND last_seen_release_seq IS NOT NULL
          AND last_seen_source_binding_hash ~ '^[0-9a-f]{64}$'
          AND last_ack_lease_token_hash ~ '^[0-9a-f]{64}$'
        )
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.client_sync_state'::pg_catalog.regclass AND conname = 'client_sync_source_binding_fk') THEN
    ALTER TABLE client_sync_state
      ADD CONSTRAINT client_sync_source_binding_fk
      FOREIGN KEY (last_seen_release_id, last_seen_source_binding_hash)
      REFERENCES content_releases(release_id, source_binding_hash);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.client_sync_state'::pg_catalog.regclass AND conname = 'client_sync_lease_token_fk') THEN
    ALTER TABLE client_sync_state
      ADD CONSTRAINT client_sync_lease_token_fk
      FOREIGN KEY (last_ack_lease_token_hash)
      REFERENCES snapshot_offline_leases(lease_token_hash);
  END IF;
  -- v1.12 deliberately replaces the named constraint. IF NOT EXISTS would leave an upgraded
  -- database with the old enum and make valid finalizer failures roll back the whole transaction.
  ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batch_error_report_shape;
  ALTER TABLE import_batches
    ADD CONSTRAINT import_batch_error_report_shape CHECK (
        ((
          status = 'failed'
          AND error_report IS NOT NULL
          AND pg_catalog.jsonb_typeof(error_report) = 'object'
          AND error_report ?& ARRAY['code','diagnostic_id']
          AND error_report ->> 'code' IN (
            'CANCELLED', 'MAX_ATTEMPTS_EXHAUSTED', 'VALIDATION_FAILED',
            'SOURCE_UNREADABLE', 'HASH_MISMATCH', 'UNSUPPORTED_FORMAT',
            'STORAGE_UNAVAILABLE', 'SOURCE_NOT_ELIGIBLE', 'SOURCE_SUSPENDED',
            'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH', 'SOURCE_SET_INCOMPLETE',
            'CONTENT_CONTRACT_INVALID', 'GOVERNANCE_HASH_MISMATCH'
          )
          AND coalesce(error_report ->> 'diagnostic_id', '') ~ '^diag_[0-9a-f]{32}$'
          AND (
            (
              error_report ->> 'code' = 'CANCELLED'
              AND error_report - ARRAY['code','diagnostic_id'] = '{}'::jsonb
            )
            OR (
              error_report ->> 'code' = 'MAX_ATTEMPTS_EXHAUSTED'
              AND error_report ?& ARRAY['attempts','max_attempts']
              AND error_report - ARRAY['code','diagnostic_id','attempts','max_attempts'] = '{}'::jsonb
              AND pg_catalog.jsonb_typeof(error_report -> 'attempts') = 'number'
              AND error_report ->> 'attempts' ~ '^[1-9][0-9]{0,8}$'
              AND pg_catalog.jsonb_typeof(error_report -> 'max_attempts') = 'number'
              AND error_report ->> 'max_attempts' ~ '^[1-9][0-9]{0,8}$'
            )
            OR (
              error_report ->> 'code' IN (
                'VALIDATION_FAILED', 'SOURCE_UNREADABLE', 'HASH_MISMATCH',
                'UNSUPPORTED_FORMAT', 'STORAGE_UNAVAILABLE', 'SOURCE_NOT_ELIGIBLE',
                'SOURCE_SUSPENDED', 'SOURCE_DOMAIN_MISMATCH', 'SOURCE_SNAPSHOT_MISMATCH',
                'SOURCE_SET_INCOMPLETE', 'CONTENT_CONTRACT_INVALID',
                'GOVERNANCE_HASH_MISMATCH'
              )
              AND error_report - ARRAY['code','diagnostic_id','row','column','error_count','issue_codes'] = '{}'::jsonb
              AND CASE WHEN error_report ? 'row' THEN
                pg_catalog.jsonb_typeof(error_report -> 'row') = 'number'
                AND error_report ->> 'row' ~ '^[1-9][0-9]{0,8}$'
              ELSE TRUE END
              AND CASE WHEN error_report ? 'column' THEN
                pg_catalog.jsonb_typeof(error_report -> 'column') = 'number'
                AND error_report ->> 'column' ~ '^[1-9][0-9]{0,8}$'
              ELSE TRUE END
              AND CASE WHEN error_report ? 'error_count' THEN
                pg_catalog.jsonb_typeof(error_report -> 'error_count') = 'number'
                AND error_report ->> 'error_count' ~ '^[1-9][0-9]{0,8}$'
              ELSE TRUE END
              AND public.import_issue_codes_are_public(error_report -> 'issue_codes')
            )
          )
        ) IS TRUE)
        OR ((
          status <> 'failed'
          AND error_report IS NULL
        ) IS TRUE)
    );
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.import_batches'::pg_catalog.regclass AND conname = 'import_batch_base_release_fk') THEN
    ALTER TABLE import_batches
      ADD CONSTRAINT import_batch_base_release_fk
      FOREIGN KEY (base_release_id) REFERENCES content_releases(release_id);
  END IF;
END
$constraints$;

DO $work_order_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.work_order_import_batches'::pg_catalog.regclass
      AND conname = 'work_order_import_error_report_shape'
  ) THEN
    ALTER TABLE work_order_import_batches
      ADD CONSTRAINT work_order_import_error_report_shape CHECK (
        ((
          status = 'failed'
          AND error_report IS NOT NULL
          AND pg_catalog.jsonb_typeof(error_report) = 'object'
          AND error_report ?& ARRAY['code','diagnostic_id']
          AND error_report ->> 'code' IN (
            'VALIDATION_FAILED','SOURCE_UNREADABLE','HASH_MISMATCH',
            'UNSUPPORTED_FORMAT','STORAGE_UNAVAILABLE','MAX_ATTEMPTS_EXHAUSTED'
          )
          AND coalesce(error_report ->> 'diagnostic_id', '') ~ '^diag_[0-9a-f]{32}$'
          AND error_report - ARRAY[
            'code','diagnostic_id','row','column','error_count','issue_codes'
          ] = '{}'::jsonb
          AND CASE WHEN error_report ? 'row' THEN
            pg_catalog.jsonb_typeof(error_report -> 'row') = 'number'
            AND error_report ->> 'row' ~ '^[1-9][0-9]{0,8}$'
          ELSE TRUE END
          AND CASE WHEN error_report ? 'column' THEN
            pg_catalog.jsonb_typeof(error_report -> 'column') = 'number'
            AND error_report ->> 'column' ~ '^[1-9][0-9]{0,8}$'
          ELSE TRUE END
          AND CASE WHEN error_report ? 'error_count' THEN
            pg_catalog.jsonb_typeof(error_report -> 'error_count') = 'number'
            AND error_report ->> 'error_count' ~ '^[1-9][0-9]{0,8}$'
          ELSE TRUE END
          AND public.work_order_issue_codes_are_public(error_report -> 'issue_codes')
        ) IS TRUE)
        OR ((status <> 'failed' AND error_report IS NULL) IS TRUE)
      );
  END IF;
END
$work_order_constraints$;

-- Policy flags (phase plugs). Phase1: rewrite=false, auto_send=false.
CREATE TABLE IF NOT EXISTS policy_flags (
  flag_key     TEXT PRIMARY KEY,
  flag_value   BOOLEAN NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   TEXT
);
