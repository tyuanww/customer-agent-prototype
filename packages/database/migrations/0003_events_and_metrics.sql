-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0003_events_and_metrics; source schema.v1.12 lines 982-1748
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ─── Events ───
CREATE TABLE IF NOT EXISTS query_events (
  query_id            TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL,
  parent_query_id     TEXT REFERENCES query_events(query_id),
  interaction_reason  TEXT NOT NULL DEFAULT 'original' CHECK (
    interaction_reason IN ('original','reselection')
  ),
  request_hash        TEXT NOT NULL,
  request_hash_key_version TEXT NOT NULL,
  query_text_redacted TEXT,
  query_text_hash     TEXT,
  hash_key_version    TEXT NOT NULL,
  text_storage_status TEXT NOT NULL CHECK (text_storage_status IN ('stored','suppressed')),
  collection_mode     TEXT NOT NULL CHECK (
    collection_mode IN ('synthetic','approved_redacted','pilot_recorded')
  ),
  detected_category   TEXT,
  detected_platform   TEXT CHECK (
    detected_platform IS NULL OR detected_platform IN ('qianniu','douyin','unknown')
  ),
  platform            TEXT CHECK (platform IS NULL OR platform IN ('qianniu','douyin','unknown')),
  platform_source     TEXT NOT NULL CHECK (
    platform_source IN ('manual','foreground_process','native_integration','unknown')
  ),
  product_context_type TEXT CHECK (
    product_context_type IS NULL OR product_context_type IN ('category','sku')
  ),
  product_context_ref_hash TEXT CHECK (
    product_context_ref_hash IS NULL OR product_context_ref_hash ~ '^[0-9a-f]{64}$'
  ),
  product_context_hash_key_version TEXT,
  redaction_policy_version TEXT NOT NULL CHECK (pg_catalog.btrim(redaction_policy_version) <> ''),
  hit_status          TEXT NOT NULL CHECK (hit_status IN ('hit','no_hit')),
  latency_ms          INTEGER,
  release_id          TEXT NOT NULL,  -- exact immutable content release used by this operation
  text_expires_at     TIMESTAMPTZ,
  event_expires_at    TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT query_text_storage_shape CHECK (
    (
      text_storage_status = 'stored'
      AND query_text_redacted IS NOT NULL
      AND pg_catalog.btrim(query_text_redacted) <> ''
      AND query_text_hash IS NOT NULL
      AND query_text_hash ~ '^[0-9a-f]{64}$'
    )
    OR (
      text_storage_status = 'suppressed'
      AND query_text_redacted IS NULL
      AND query_text_hash IS NULL
    )
  ),
  CONSTRAINT query_expiry_shape CHECK (
    (text_expires_at IS NULL OR text_expires_at >= created_at)
    AND (event_expires_at IS NULL OR event_expires_at >= created_at)
    AND (
      text_expires_at IS NULL OR event_expires_at IS NULL OR text_expires_at <= event_expires_at
    )
  ),
  CONSTRAINT query_interaction_shape CHECK (
    (interaction_reason = 'original' AND parent_query_id IS NULL)
    OR (interaction_reason = 'reselection' AND parent_query_id IS NOT NULL)
  ),
  CONSTRAINT query_platform_provenance_shape CHECK (
    platform_source IN ('manual','native_integration')
    OR (
      platform_source = 'foreground_process'
      AND detected_platform IS NOT NULL
      AND platform IS NOT NULL
      AND detected_platform IN ('qianniu','douyin')
      AND platform = detected_platform
    )
    OR (
      platform_source = 'unknown'
      AND (platform IS NULL OR platform = 'unknown')
    )
  ),
  CONSTRAINT query_product_context_shape CHECK (
    (
      product_context_type IS NULL
      AND product_context_ref_hash IS NULL
      AND product_context_hash_key_version IS NULL
    ) OR (
      product_context_type IN ('category','sku')
      AND product_context_ref_hash IS NOT NULL
      AND product_context_hash_key_version IS NOT NULL
      AND pg_catalog.btrim(product_context_hash_key_version) <> ''
    )
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_query_user ON query_events(query_id, user_id);
CREATE INDEX IF NOT EXISTS idx_query_parent ON query_events(parent_query_id)
  WHERE parent_query_id IS NOT NULL;

-- Semantic-source indirection keeps a from_log query FK only while the asset is active. Retirement
-- is a one-way, controlled tombstone: the query FK may then be released for retention, while the
-- separately keyed origin HMAC and promotion/retirement evidence remain non-PII lineage.
CREATE TABLE IF NOT EXISTS semantic_source_assets (
  source_asset_id TEXT PRIMARY KEY CHECK (
    source_asset_id ~ '^sa_[A-Za-z0-9][A-Za-z0-9._-]{0,126}$'
  ),
  source TEXT NOT NULL CHECK (source IN ('manual','from_log','import')),
  origin_fingerprint TEXT NOT NULL CHECK (origin_fingerprint ~ '^[0-9a-f]{64}$'),
  origin_fingerprint_key_version TEXT NOT NULL CHECK (
    origin_fingerprint_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  source_query_id TEXT REFERENCES query_events(query_id) ON DELETE RESTRICT,
  promotion_review_ref TEXT,
  promoted_by_role TEXT,
  promoted_at TIMESTAMPTZ,
  lifecycle TEXT NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','retired')),
  retirement_evd TEXT,
  retired_by_subject_hash TEXT,
  retired_by_subject_key_version TEXT,
  retired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT semantic_source_asset_identity_unique UNIQUE (
    source_asset_id, source, origin_fingerprint_key_version, origin_fingerprint
  ),
  CONSTRAINT semantic_source_asset_origin_shape CHECK (
    (
      source = 'from_log'
      AND promotion_review_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'
      AND promoted_by_role IS NOT NULL AND pg_catalog.btrim(promoted_by_role) <> ''
      AND promoted_at IS NOT NULL
      AND (
        (lifecycle = 'active' AND source_query_id IS NOT NULL)
        OR (lifecycle = 'retired' AND source_query_id IS NULL)
      )
    ) OR (
      source IN ('manual','import')
      AND source_query_id IS NULL
      AND promotion_review_ref IS NULL
      AND promoted_by_role IS NULL
      AND promoted_at IS NULL
    )
  ),
  CONSTRAINT semantic_source_asset_retirement_shape CHECK (
    (
      lifecycle = 'active'
      AND retirement_evd IS NULL
      AND retired_by_subject_hash IS NULL
      AND retired_by_subject_key_version IS NULL
      AND retired_at IS NULL
    ) OR (
      lifecycle = 'retired'
      AND retirement_evd ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,254}$'
      AND retired_by_subject_hash ~ '^[0-9a-f]{64}$'
      AND retired_by_subject_key_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      AND retired_at IS NOT NULL AND retired_at >= created_at
    )
  )
);
CREATE INDEX IF NOT EXISTS idx_semantic_source_assets_query
  ON semantic_source_assets(source_query_id) WHERE source_query_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_semantic_source_assets_lifecycle
  ON semantic_source_assets(lifecycle, source_asset_id);

-- Upgrade migration: one asset id must already mean one canonical origin. Ambiguity fails closed;
-- the migration never picks an arbitrary query or promotion record.
DO $semantic_asset_legacy_conflict$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.script_questions question
    GROUP BY question.source_asset_id
    HAVING pg_catalog.count(DISTINCT ROW(
      question.source,
      question.origin_fingerprint_key_version,
      question.origin_fingerprint,
      question.source_query_id,
      question.promotion_review_ref,
      question.promoted_by_role,
      question.promoted_at
    )) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA001',
      MESSAGE = 'legacy semantic source asset id has conflicting lineage',
      DETAIL = 'SEMANTIC_ASSET_MIGRATION_CONFLICT';
  END IF;
END
$semantic_asset_legacy_conflict$;

INSERT INTO public.semantic_source_assets(
  source_asset_id, source, origin_fingerprint, origin_fingerprint_key_version,
  source_query_id, promotion_review_ref, promoted_by_role, promoted_at,
  lifecycle, created_at
)
SELECT DISTINCT ON (question.source_asset_id)
  question.source_asset_id,
  question.source,
  question.origin_fingerprint,
  question.origin_fingerprint_key_version,
  question.source_query_id,
  question.promotion_review_ref,
  question.promoted_by_role,
  question.promoted_at,
  'active',
  question.created_at
FROM public.script_questions question
WHERE NOT EXISTS (
  SELECT 1 FROM public.semantic_source_assets asset
  WHERE asset.source_asset_id = question.source_asset_id
)
ORDER BY question.source_asset_id, question.question_id, question.question_version;

DO $semantic_asset_legacy_identity$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.script_questions question
    JOIN public.semantic_source_assets asset
      ON asset.source_asset_id = question.source_asset_id
    WHERE asset.source IS DISTINCT FROM question.source
       OR asset.origin_fingerprint_key_version IS DISTINCT FROM question.origin_fingerprint_key_version
       OR asset.origin_fingerprint IS DISTINCT FROM question.origin_fingerprint
       OR (
         question.source_query_id IS NOT NULL
         AND asset.source_query_id IS DISTINCT FROM question.source_query_id
       )
       OR asset.promotion_review_ref IS DISTINCT FROM question.promotion_review_ref
       OR asset.promoted_by_role IS DISTINCT FROM question.promoted_by_role
       OR asset.promoted_at IS DISTINCT FROM question.promoted_at
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'ZA001',
      MESSAGE = 'legacy question lineage differs from semantic source asset',
      DETAIL = 'SEMANTIC_ASSET_MIGRATION_CONFLICT';
  END IF;
END
$semantic_asset_legacy_identity$;

-- The query FK now lives only on semantic_source_assets. Immutable question versions bind the
-- stable asset/HMAC identity and intentionally retain no direct query pointer.
ALTER TABLE script_questions DROP CONSTRAINT IF EXISTS script_question_promotion_shape;
-- A v1.11 database already has the immutable trigger. Drop and recreate it inside this transaction
-- so the one migration-only pointer move is executable; rollback restores the old trigger atomically.
DROP TRIGGER IF EXISTS script_questions_immutable ON script_questions;
UPDATE script_questions SET source_query_id = NULL WHERE source_query_id IS NOT NULL;
ALTER TABLE script_questions
  ADD CONSTRAINT script_question_promotion_shape CHECK (
    source_query_id IS NULL
    AND (
      (
        source = 'from_log'
        AND promotion_review_ref IS NOT NULL AND pg_catalog.btrim(promotion_review_ref) <> ''
        AND promoted_by_role IS NOT NULL AND pg_catalog.btrim(promoted_by_role) <> ''
        AND promoted_at IS NOT NULL
      ) OR (
        source <> 'from_log'
        AND promotion_review_ref IS NULL
        AND promoted_by_role IS NULL
        AND promoted_at IS NULL
      )
    )
  );

CREATE TABLE IF NOT EXISTS candidate_impressions (
  query_id        TEXT NOT NULL REFERENCES query_events(query_id),
  rank            INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  release_id      TEXT NOT NULL,
  script_id       TEXT NOT NULL,
  script_version  INTEGER NOT NULL,
  content_hash    TEXT NOT NULL,
  score           DOUBLE PRECISION,
  PRIMARY KEY (query_id, rank)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_candidate_query_rank_script
  ON candidate_impressions(query_id, rank, script_id);

CREATE TABLE IF NOT EXISTS adoption_events (
  query_id          TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  outcome           TEXT NOT NULL CHECK (outcome IN ('adopted','dismissed','no_hit_exit','timeout')),
  chosen_rank       INTEGER CHECK (chosen_rank IS NULL OR chosen_rank BETWEEN 1 AND 3),
  chosen_script_id  TEXT,
  push_method       TEXT CHECK (push_method IS NULL OR push_method IN ('clipboard','autofill','failed','pending')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Honesty: adopted means a successful copy/push into the client input carrier, never "sent".
  -- clipboard is the Phase1 primary path; autofill is retained as a compatible successful push value.
  CONSTRAINT adoption_adopted_requires_success CHECK (
    outcome <> 'adopted'
    OR (push_method IS NOT NULL AND push_method IN ('clipboard','autofill'))
  ),
  CONSTRAINT adoption_choice_shape CHECK (
    (outcome = 'adopted' AND chosen_rank IS NOT NULL AND chosen_script_id IS NOT NULL)
    OR
    (outcome <> 'adopted' AND chosen_rank IS NULL AND chosen_script_id IS NULL)
  ),
  CONSTRAINT adoption_query_owner_fk
    FOREIGN KEY (query_id, user_id) REFERENCES query_events(query_id, user_id),
  CONSTRAINT adoption_candidate_fk
    FOREIGN KEY (query_id, chosen_rank, chosen_script_id)
    REFERENCES candidate_impressions(query_id, rank, script_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_adoption_copy_provenance
  ON adoption_events(query_id, user_id, outcome, push_method);

CREATE TABLE IF NOT EXISTS escalate_actions (
  escalate_id  TEXT PRIMARY KEY,
  query_id     TEXT NOT NULL REFERENCES query_events(query_id),
  action       TEXT NOT NULL CHECK (action IN ('open_feishu','copy_contact','other')),
  user_id      TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT escalate_query_action_unique UNIQUE (query_id, action)
);

-- Reselection is a new search operation linked to one terminal parent operation. It is never an
-- in-place mutation. The trigger makes same-user ownership and append-only, acyclic lineage executable.
CREATE OR REPLACE FUNCTION trg_query_lineage_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_parent_user_id TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.query_id IS DISTINCT FROM OLD.query_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.parent_query_id IS DISTINCT FROM OLD.parent_query_id
    OR NEW.interaction_reason IS DISTINCT FROM OLD.interaction_reason
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'query lineage is append-only', DETAIL = 'INV_BYPASS';
  END IF;

  IF NEW.interaction_reason = 'original' THEN
    IF NEW.parent_query_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'original query cannot have parent_query_id', DETAIL = 'VALIDATION';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.parent_query_id IS NULL OR NEW.parent_query_id = NEW.query_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'reselection requires a different parent query', DETAIL = 'VALIDATION';
  END IF;

  SELECT q.user_id INTO v_parent_user_id
  FROM public.query_events q
  WHERE q.query_id = NEW.parent_query_id;

  IF v_parent_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'parent query not found', DETAIL = 'NOT_FOUND';
  END IF;
  IF v_parent_user_id <> NEW.user_id THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'parent query belongs to another user', DETAIL = 'FORBIDDEN';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.adoption_events a WHERE a.query_id = NEW.parent_query_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'parent query is not terminal', DETAIL = 'CONFLICT';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors(query_id, parent_query_id) AS (
      SELECT q.query_id, q.parent_query_id
      FROM public.query_events q
      WHERE q.query_id = NEW.parent_query_id
      UNION ALL
      SELECT q.query_id, q.parent_query_id
      FROM public.query_events q
      JOIN ancestors a ON q.query_id = a.parent_query_id
    )
    SELECT 1 FROM ancestors WHERE query_id = NEW.query_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'query lineage cycle detected', DETAIL = 'CONFLICT';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trg_query_lineage_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS query_lineage_guard ON query_events;
CREATE TRIGGER query_lineage_guard
  BEFORE INSERT OR UPDATE ON query_events
  FOR EACH ROW EXECUTE FUNCTION trg_query_lineage_guard();

-- Internal quality workflow only. This is NOT a business work-order record.
CREATE TABLE IF NOT EXISTS iteration_tasks (
  task_id               TEXT PRIMARY KEY,
  signal_id             TEXT NOT NULL,
  cluster_key           TEXT NOT NULL,
  sample_query_ids      TEXT[] NOT NULL DEFAULT '{}',
  suspected_cause       TEXT NOT NULL CHECK (
    suspected_cause IN ('content_gap','ranking','stale','mixed')
  ),
  suggested_script_ids  TEXT[] NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'open' CHECK (
    status IN ('open','in_progress','resolved','wont_fix')
  ),
  resolution            TEXT CHECK (resolution IN ('resolved','wont_fix')),
  resolution_note       TEXT,
  assignee_role         TEXT,
  version               INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  CONSTRAINT iteration_task_initial_and_terminal_shape CHECK (
    (
      status IN ('open','in_progress')
      AND resolution IS NULL
      AND resolution_note IS NULL
      AND resolved_at IS NULL
    )
    OR (
      status IN ('resolved','wont_fix')
      AND resolution = status
      AND resolution_note IS NOT NULL
      AND pg_catalog.btrim(resolution_note) <> ''
      AND pg_catalog.length(resolution_note) <= 2000
      AND resolved_at IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS iteration_task_status_audits (
  audit_id        TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES iteration_tasks(task_id),
  before_status   TEXT,
  after_status    TEXT NOT NULL,
  actor_user_id   TEXT,
  actor_role      TEXT,
  resolution      TEXT,
  resolution_note TEXT,
  version         INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION trg_iteration_task_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'open' OR NEW.version <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'iteration task must start open at version 1', DETAIL = 'VALIDATION';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status IN ('resolved', 'wont_fix') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'terminal iteration task is immutable', DETAIL = 'INV_BYPASS';
  END IF;
  IF NOT (
    (OLD.status = 'open' AND NEW.status = 'in_progress')
    OR (OLD.status = 'in_progress' AND NEW.status IN ('resolved', 'wont_fix'))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid iteration task transition', DETAIL = 'VALIDATION';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'iteration task version mismatch', DETAIL = 'VERSION_MISMATCH';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trg_iteration_task_guard() FROM PUBLIC;

CREATE OR REPLACE FUNCTION trg_iteration_task_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  INSERT INTO public.iteration_task_status_audits(
    audit_id, task_id, before_status, after_status, actor_user_id, actor_role,
    resolution, resolution_note, version, created_at
  ) VALUES (
    'ita_' || pg_catalog.gen_random_uuid()::text,
    NEW.task_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END,
    NEW.status,
    pg_catalog.current_setting('app.actor_user_id', true),
    pg_catalog.current_setting('app.actor_role', true),
    NEW.resolution,
    NEW.resolution_note,
    NEW.version,
    pg_catalog.clock_timestamp()
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION trg_iteration_task_audit() FROM PUBLIC;

DROP TRIGGER IF EXISTS iteration_task_guard ON iteration_tasks;
CREATE TRIGGER iteration_task_guard
  BEFORE INSERT OR UPDATE ON iteration_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_iteration_task_guard();

DROP TRIGGER IF EXISTS iteration_task_audit ON iteration_tasks;
CREATE TRIGGER iteration_task_audit
  AFTER INSERT OR UPDATE ON iteration_tasks
  FOR EACH ROW EXECUTE FUNCTION trg_iteration_task_audit();

CREATE OR REPLACE FUNCTION start_iteration_task(
  p_task_id TEXT,
  p_expected_version INTEGER,
  p_actor_user_id TEXT,
  p_actor_role TEXT
)
RETURNS iteration_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result public.iteration_tasks;
BEGIN
  IF p_actor_role NOT IN ('coach','owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'iteration task role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = '' OR p_expected_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid iteration task actor or version', DETAIL = 'VALIDATION';
  END IF;

  PERFORM pg_catalog.set_config('app.actor_user_id', p_actor_user_id, true);
  PERFORM pg_catalog.set_config('app.actor_role', p_actor_role, true);

  UPDATE public.iteration_tasks
  SET status = 'in_progress',
      version = version + 1
  WHERE task_id = p_task_id
    AND status = 'open'
    AND version = p_expected_version
  RETURNING * INTO result;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.iteration_tasks WHERE task_id = p_task_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'iteration task not found', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'iteration task transition conflict', DETAIL = 'VERSION_OR_STATUS_CONFLICT';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION start_iteration_task(TEXT,INTEGER,TEXT,TEXT) FROM PUBLIC;

CREATE OR REPLACE FUNCTION close_iteration_task(
  p_task_id TEXT,
  p_expected_version INTEGER,
  p_status TEXT,
  p_resolution_note TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT
)
RETURNS iteration_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  result public.iteration_tasks;
BEGIN
  IF p_actor_role NOT IN ('coach','owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'iteration task role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_status NOT IN ('resolved','wont_fix')
     OR p_resolution_note IS NULL
     OR pg_catalog.btrim(p_resolution_note) = ''
     OR pg_catalog.length(p_resolution_note) > 2000
     OR p_actor_user_id IS NULL
     OR pg_catalog.btrim(p_actor_user_id) = ''
     OR p_expected_version IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid iteration task closure', DETAIL = 'VALIDATION';
  END IF;

  PERFORM pg_catalog.set_config('app.actor_user_id', p_actor_user_id, true);
  PERFORM pg_catalog.set_config('app.actor_role', p_actor_role, true);

  UPDATE public.iteration_tasks
  SET status = p_status,
      resolution = p_status,
      resolution_note = p_resolution_note,
      resolved_at = pg_catalog.clock_timestamp(),
      version = version + 1
  WHERE task_id = p_task_id
    AND status = 'in_progress'
    AND version = p_expected_version
  RETURNING * INTO result;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.iteration_tasks WHERE task_id = p_task_id) THEN
      RAISE EXCEPTION USING ERRCODE = 'ZA002', MESSAGE = 'iteration task not found', DETAIL = 'NOT_FOUND';
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'iteration task transition conflict', DETAIL = 'VERSION_OR_STATUS_CONFLICT';
  END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION close_iteration_task(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;

-- Business work-order analysis. Only normalized allowlisted fields are persisted here.
-- There is intentionally no raw_payload/raw_row/external_writeback column.
CREATE TABLE IF NOT EXISTS work_order_import_batches (
  import_batch_id       TEXT PRIMARY KEY,
  tenant_scope          TEXT NOT NULL,
  source_system         TEXT NOT NULL,
  source_ref            TEXT,
  source_file_name_safe TEXT,
  source_sha256         TEXT NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_size_bytes     BIGINT NOT NULL CHECK (source_size_bytes >= 0),
  mapping_version       TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'validating' CHECK (
    status IN ('received','validating','ready','failed')
  ),
  record_count          INTEGER NOT NULL DEFAULT 0 CHECK (record_count >= 0),
  accepted_count        INTEGER NOT NULL DEFAULT 0 CHECK (accepted_count >= 0),
  rejected_count        INTEGER NOT NULL DEFAULT 0 CHECK (rejected_count >= 0),
  data_from             TIMESTAMPTZ,
  data_to               TIMESTAMPTZ,
  error_report          JSONB,
  actor_user_id         TEXT NOT NULL,
  actor_role            TEXT NOT NULL CHECK (actor_role IN ('coach','owner')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  CONSTRAINT work_order_import_counts CHECK (
    status NOT IN ('ready','failed') OR record_count = accepted_count + rejected_count
  ),
  CONSTRAINT work_order_import_dates CHECK (
    data_from IS NULL OR data_to IS NULL OR data_to >= data_from
  ),
  CONSTRAINT work_order_import_terminal_shape CHECK (
    (status IN ('received','validating') AND completed_at IS NULL)
    OR (status = 'ready' AND completed_at IS NOT NULL AND error_report IS NULL)
    OR (status = 'failed' AND completed_at IS NOT NULL AND error_report IS NOT NULL)
  ),
  CONSTRAINT work_order_import_source_unique UNIQUE (
    tenant_scope, source_sha256, mapping_version
  )
);

CREATE TABLE IF NOT EXISTS work_order_records (
  record_id             TEXT PRIMARY KEY,
  import_batch_id       TEXT NOT NULL REFERENCES work_order_import_batches(import_batch_id),
  tenant_scope          TEXT NOT NULL,
  source_record_hash    TEXT NOT NULL CHECK (source_record_hash ~ '^[0-9a-f]{64}$'),
  category              TEXT,
  issue_type            TEXT,
  product_ref_hash      TEXT CHECK (product_ref_hash IS NULL OR product_ref_hash ~ '^[0-9a-f]{64}$'),
  channel               TEXT,
  record_status         TEXT,
  opened_at             TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  handling_seconds      INTEGER CHECK (handling_seconds IS NULL OR handling_seconds >= 0),
  error_type            TEXT,
  escalated             BOOLEAN NOT NULL DEFAULT FALSE,
  quality_tags          TEXT[] NOT NULL DEFAULT '{}',
  normalization_version TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_order_record_times CHECK (
    opened_at IS NULL OR closed_at IS NULL OR closed_at >= opened_at
  ),
  CONSTRAINT work_order_record_source_unique UNIQUE (import_batch_id, source_record_hash)
);

CREATE TABLE IF NOT EXISTS work_order_export_audits (
  export_id       TEXT PRIMARY KEY,
  tenant_scope    TEXT NOT NULL,
  actor_user_id   TEXT NOT NULL,
  actor_role      TEXT NOT NULL CHECK (actor_role IN ('coach','owner')),
  filter_hash     TEXT NOT NULL CHECK (filter_hash ~ '^[0-9a-f]{64}$'),
  field_set       TEXT[] NOT NULL,
  row_count       INTEGER NOT NULL CHECK (row_count >= 0),
  result          TEXT NOT NULL CHECK (result IN ('succeeded','denied','failed')),
  diagnostic_id   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_order_export_diagnostic_shape CHECK (
    (result = 'succeeded' AND diagnostic_id IS NULL)
    OR (result IN ('denied','failed') AND diagnostic_id ~ '^diag_[0-9a-f]{32}$')
  )
);

CREATE INDEX IF NOT EXISTS idx_iteration_tasks_status_created
  ON iteration_tasks(status, created_at DESC, task_id DESC);
CREATE INDEX IF NOT EXISTS idx_iteration_tasks_signal
  ON iteration_tasks(signal_id, status);
CREATE INDEX IF NOT EXISTS idx_work_order_batches_scope_created
  ON work_order_import_batches(tenant_scope, created_at DESC, import_batch_id DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_records_scope_opened
  ON work_order_records(tenant_scope, opened_at DESC, record_id DESC);
CREATE INDEX IF NOT EXISTS idx_work_order_records_batch
  ON work_order_records(import_batch_id, record_id);
CREATE INDEX IF NOT EXISTS idx_work_order_records_dimensions
  ON work_order_records(tenant_scope, channel, category, issue_type, record_status, error_type);
CREATE INDEX IF NOT EXISTS idx_work_order_export_audits_actor_created
  ON work_order_export_audits(actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION record_work_order_export(
  p_tenant_scope TEXT,
  p_actor_user_id TEXT,
  p_actor_role TEXT,
  p_filter_hash TEXT,
  p_field_set TEXT[],
  p_row_count INTEGER,
  p_result TEXT,
  p_diagnostic_id TEXT DEFAULT NULL
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_export_id TEXT;
  v_allowed_fields CONSTANT TEXT[] := ARRAY[
    'record_id','category','issue_type','product_ref_hash','channel','record_status',
    'opened_at','closed_at','handling_seconds','error_type','escalated','quality_tags',
    'normalization_version','import_batch_id'
  ];
BEGIN
  IF p_actor_role NOT IN ('coach','owner') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA005', MESSAGE = 'work-order export role denied', DETAIL = 'FORBIDDEN';
  END IF;
  IF p_tenant_scope IS NULL OR pg_catalog.btrim(p_tenant_scope) = ''
     OR p_actor_user_id IS NULL OR pg_catalog.btrim(p_actor_user_id) = ''
     OR p_filter_hash IS NULL OR p_filter_hash !~ '^[0-9a-f]{64}$'
     OR p_field_set IS NULL OR pg_catalog.cardinality(p_field_set) = 0
     OR NOT p_field_set <@ v_allowed_fields
     OR p_row_count IS NULL OR p_row_count < 0
     OR p_result NOT IN ('succeeded','denied','failed')
     OR (p_result = 'succeeded' AND p_diagnostic_id IS NOT NULL)
     OR (p_result IN ('denied','failed') AND coalesce(p_diagnostic_id, '') !~ '^diag_[0-9a-f]{32}$') THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'invalid work-order export audit', DETAIL = 'VALIDATION';
  END IF;

  v_export_id := 'wox_' || pg_catalog.gen_random_uuid()::text;
  INSERT INTO public.work_order_export_audits(
    export_id, tenant_scope, actor_user_id, actor_role, filter_hash, field_set,
    row_count, result, diagnostic_id, created_at
  ) VALUES (
    v_export_id, p_tenant_scope, p_actor_user_id, p_actor_role, p_filter_hash,
    p_field_set, p_row_count, p_result, p_diagnostic_id, pg_catalog.clock_timestamp()
  );
  RETURN v_export_id;
END;
$$;
REVOKE ALL ON FUNCTION record_work_order_export(TEXT,TEXT,TEXT,TEXT,TEXT[],INTEGER,TEXT,TEXT) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS change_audits (
  change_id    TEXT PRIMARY KEY,
  script_id    TEXT,
  action       TEXT NOT NULL,
  before_hash  TEXT,
  after_hash   TEXT,
  actor_role   TEXT,
  actor_user_id TEXT,
  source       TEXT,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_query_created ON query_events(created_at);
CREATE INDEX IF NOT EXISTS idx_query_hit ON query_events(hit_status);
CREATE INDEX IF NOT EXISTS idx_query_user ON query_events(user_id);
CREATE INDEX IF NOT EXISTS idx_query_text_expiry
  ON query_events(text_expires_at) WHERE text_expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_query_event_expiry
  ON query_events(event_expires_at) WHERE event_expires_at IS NOT NULL;
DROP INDEX IF EXISTS idx_script_questions_source_query;
CREATE INDEX IF NOT EXISTS idx_script_questions_source_asset
  ON script_questions(source_asset_id);
