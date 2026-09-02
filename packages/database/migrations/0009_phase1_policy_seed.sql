-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0009_phase1_policy_seed; source schema.v1.12 lines 2631-2650, 7658-7660
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

INSERT INTO policy_flags (flag_key, flag_value) VALUES
  ('rewrite', FALSE),
  ('auto_send', FALSE),
  ('autofill_adapter', FALSE),
  ('llm_ranker', FALSE),
  ('metrics_experimental_kpi', FALSE)
ON CONFLICT (flag_key) DO NOTHING;

-- Upgrade safety is fail-closed: a legacy/customized database must not retain dangerous phase1 flags.
-- This UPDATE is intentionally unconditional and is an executable migration invariant, not a default only.
UPDATE policy_flags
SET flag_value = FALSE,
    updated_at = now(),
    updated_by = 'schema.v1.3.phase1-hard-off'
WHERE flag_key IN ('rewrite', 'auto_send')
  AND flag_value IS DISTINCT FROM FALSE;

-- AUTH_MODE is deployment config, not a mutable policy flag. Remove legacy ambiguity.
DELETE FROM policy_flags WHERE flag_key = 'mock_auth';

COMMENT ON SCHEMA public IS
  'CS-AI-C11 schema.v1.12; CR-004 immutable four-domain authoritative-source gate; DEC-042 postfix closure for scoped reads, question identity/tombstone, dual review and population-bound quality evidence; reference DDL local-preflight status is recorded only by external EVD (not this DDL); immutable migration/N/N-1/application runtime/managed PostgreSQL/backup-restore/concurrency/production remain NOT_CERTIFIED; Phase1 rewrite/auto_send/training hard-off';
