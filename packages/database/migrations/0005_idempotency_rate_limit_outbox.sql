-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0005_idempotency_rate_limit_outbox; source schema.v1.12 lines 2651-2771
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ─── NFR v1.3: architecture-contract invariants (static evidence, not runtime certification) ───

-- Tenant reserve (phase1 always 'default')
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE query_events ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE content_releases ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT 'default';

-- Enrich immutable snapshot (questions + DEC-042 governance frozen at publish)
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS questions_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS platform_scope TEXT[];
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS product_scope_type TEXT;
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS product_scope_refs TEXT[];
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS questions_json JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS search_document TSVECTOR;
ALTER TABLE release_items ADD COLUMN IF NOT EXISTS search_fallback_text TEXT;
ALTER TABLE staging_scripts ADD COLUMN IF NOT EXISTS operation TEXT NOT NULL DEFAULT 'upsert';
ALTER TABLE staging_scripts ADD COLUMN IF NOT EXISTS search_document TSVECTOR;
ALTER TABLE staging_scripts ADD COLUMN IF NOT EXISTS search_fallback_text TEXT;
ALTER TABLE content_releases ADD COLUMN IF NOT EXISTS rollback_of_release_id TEXT REFERENCES content_releases(release_id);
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_sha256 TEXT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS source_size_bytes BIGINT;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS quality_gate_passed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS clean_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE import_batches ADD COLUMN IF NOT EXISTS quarantined_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE change_audits ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE query_events ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE query_events ADD COLUMN IF NOT EXISTS request_hash_key_version TEXT;
ALTER TABLE query_events ADD COLUMN IF NOT EXISTS hash_key_version TEXT;

-- Existing v1 data must be backfilled by the same-version import validator before a follow-up
-- migration applies NOT NULL to search_document/search_fallback_text/request_hash/hash_key_version.
-- Never backfill an empty tsvector merely to make the constraint green.

-- Idempotency concurrent state machine
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope            TEXT NOT NULL,  -- e.g. 'publish'|'/v1/events/adoption'|user-scoped route
  idem_key         TEXT NOT NULL,
  user_id          TEXT,
  request_hash     TEXT NOT NULL,   -- versioned HMAC for PII-capable bodies; SHA-256/JCS otherwise
  request_hash_key_version TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('pending','completed','failed')),
  status_code      INT,
  response_body    JSONB,
  lease_owner      TEXT,           -- instance_id that claimed pending
  lease_version    BIGINT NOT NULL DEFAULT 1,
  lease_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, idem_key)
);
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS lease_version BIGINT NOT NULL DEFAULT 1;
ALTER TABLE idempotency_keys ADD COLUMN IF NOT EXISTS request_hash_key_version TEXT;
CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_idem_status ON idempotency_keys(status);

-- Cross-instance rate limit (token bucket in Postgres; Redis optional later)
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  bucket_key     TEXT PRIMARY KEY,  -- 'global:search' | 'user:{id}:search' | ...
  tokens         DOUBLE PRECISION NOT NULL,
  capacity       DOUBLE PRECISION NOT NULL,
  refill_per_sec DOUBLE PRECISION NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox + rewrite job type
CREATE TABLE IF NOT EXISTS outbox_jobs (
  job_id       TEXT PRIMARY KEY,
  job_type     TEXT NOT NULL CHECK (job_type IN (
    'import_validate','work_order_import_validate','event_upload','announce_fanout','rewrite_candidate','other'
  )),
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL CHECK (status IN (
    'pending','running','done','failed','dead'
  )),
  attempts     INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner  TEXT,
  lease_version BIGINT NOT NULL DEFAULT 0,
  lease_expires_at TIMESTAMPTZ,
  last_error   TEXT,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS lease_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS max_attempts INT NOT NULL DEFAULT 5;
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS available_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE outbox_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_outbox_claim_v13
  ON outbox_jobs(job_type, status, available_at, lease_expires_at, created_at);

DO $outbox_constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.outbox_jobs'::pg_catalog.regclass AND conname = 'outbox_max_attempts_range') THEN
    ALTER TABLE outbox_jobs
      ADD CONSTRAINT outbox_max_attempts_range CHECK (max_attempts BETWEEN 1 AND 20);
  END IF;
END
$outbox_constraints$;

CREATE SEQUENCE IF NOT EXISTS content_release_seq START 1;
DO $release_sequence_alignment$
DECLARE
  v_max_release_seq BIGINT;
  v_sequence_last BIGINT;
  v_sequence_called BOOLEAN;
BEGIN
  SELECT pg_catalog.max(release_seq) INTO v_max_release_seq FROM public.content_releases;
  SELECT last_value, is_called INTO v_sequence_last, v_sequence_called FROM public.content_release_seq;
  IF v_max_release_seq IS NOT NULL
     AND (v_sequence_last < v_max_release_seq OR (v_sequence_last = v_max_release_seq AND NOT v_sequence_called)) THEN
    PERFORM pg_catalog.setval('public.content_release_seq'::pg_catalog.regclass, v_max_release_seq, TRUE);
  END IF;
END
$release_sequence_alignment$;

-- CR-004 history is append-only even inside a publishing transaction. Publish and rollback create a
-- new release; neither path needs UPDATE/DELETE on release_items or source-binding history.
