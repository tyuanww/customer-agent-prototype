-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0008_runtime_acl; source schema.v1.12 lines 7406-7657
-- contract_set_id=cs-ai-c11-openapi-1.11.0-schema-1.12-1d62e2c85c3c
-- source_git_sha=1d62e2c85c3c77dbb7a2fecc1d24a2002cb0ed38
-- source_schema_sha256=47b667958e522a28df1c04d7c79a56c930bfe0ac04598321824b55744ac4a801
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ─── Executable fail-closed ACL ───
-- Login identities are deployment-managed members of exactly one workload capability role per pool.
-- These roles prove service workload identity; p_actor_* values remain server-verified claims, not
-- independent DB auth. app_content_admin credentials must never be loaded by agent/search workers.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM cs_ai_definer, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM cs_ai_definer, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM cs_ai_definer, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;

-- PostgreSQL requires the target owner to have CREATE on the containing schema while ownership is
-- transferred. This grant exists only inside this transaction and is revoked immediately after the
-- functions/views have moved; the committed owner role cannot create arbitrary public objects.
GRANT CREATE ON SCHEMA public TO cs_ai_definer;

ALTER FUNCTION public.set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.suspend_authoritative_source(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_runtime_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_admin_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.retire_semantic_source_asset(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.rollback_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.enqueue_content_import(TEXT,TEXT,TEXT,TEXT,BIGINT,JSONB,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.enqueue_work_order_import(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.cancel_content_import(TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.issue_snapshot_offline_lease(TEXT,TEXT,INTEGER) OWNER TO cs_ai_definer;
ALTER FUNCTION public.validate_snapshot_offline_lease(TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.read_current_announcement_with_lease(TEXT,TEXT,INTEGER) OWNER TO cs_ai_definer;
ALTER FUNCTION public.read_snapshot_page(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) OWNER TO cs_ai_definer;
ALTER FUNCTION public.read_content_import_status(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.read_content_import_preview(TEXT,TEXT,TEXT,TEXT,INTEGER) OWNER TO cs_ai_definer;
ALTER FUNCTION public.ack_client_release(TEXT,TEXT,TEXT,BIGINT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.import_issue_codes_are_public(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_quality_issue_codes_are_public(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.work_order_issue_codes_are_public(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_text_array_is_nonblank_unique(TEXT[]) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_template_placeholders_are_valid(TEXT,TEXT[]) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_scope_matches(TEXT[],TEXT,TEXT[],TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_questions_are_valid(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.jsonb_jcs(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_utc_timestamp_text(TIMESTAMPTZ) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_question_hash(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_questions_align_intent(JSONB,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_risk_categories_are_valid(TEXT,TEXT[]) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_quality_population_manifest_hash(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_quality_staging_population_manifest_hash(TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_questions_source_assets_are_active(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_public_questions(JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_governance_snapshot(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) OWNER TO cs_ai_definer;
ALTER FUNCTION public.content_governance_hash(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) OWNER TO cs_ai_definer;
ALTER FUNCTION public.outbox_claim(TEXT,TEXT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.outbox_heartbeat(TEXT,TEXT,BIGINT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.outbox_retry(TEXT,TEXT,BIGINT,INT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.reconcile_exhausted_content_imports(INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.claim_content_import_validation(TEXT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.heartbeat_content_import_validation(TEXT,TEXT,BIGINT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.retry_content_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_content_review_decision(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT
) OWNER TO cs_ai_definer;
ALTER FUNCTION public.freeze_content_quality_review_plan(
  TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT,JSONB
) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_content_quality_review_evidence(
  TEXT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT
) OWNER TO cs_ai_definer;
ALTER FUNCTION public.finalize_content_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.reconcile_exhausted_work_order_imports(INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.claim_work_order_import_validation(TEXT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.heartbeat_work_order_import_validation(TEXT,TEXT,BIGINT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.retry_work_order_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.finalize_work_order_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,INTEGER,JSONB) OWNER TO cs_ai_definer;
ALTER FUNCTION public.outbox_complete(TEXT,TEXT,BIGINT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) OWNER TO cs_ai_definer;
ALTER FUNCTION public.idempotency_lookup(TEXT,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.idempotency_request_hash_version(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.idempotency_claim(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.idempotency_complete(TEXT,TEXT,TEXT,BIGINT,INT,JSONB,BOOLEAN) OWNER TO cs_ai_definer;
ALTER FUNCTION public.idempotency_heartbeat(TEXT,TEXT,TEXT,BIGINT,INT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_iteration_task_guard() OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_iteration_task_audit() OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_query_lineage_guard() OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_semantic_source_asset_guard() OWNER TO cs_ai_definer;
ALTER FUNCTION public.start_iteration_task(TEXT,INTEGER,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.close_iteration_task(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.record_work_order_export(TEXT,TEXT,TEXT,TEXT,TEXT[],INTEGER,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) OWNER TO cs_ai_definer;
ALTER FUNCTION public.trg_source_gate_search_telemetry_guard() OWNER TO cs_ai_definer;
ALTER VIEW public.v_release_source_gate OWNER TO cs_ai_definer;
ALTER VIEW public.v_scripts_recommendable OWNER TO cs_ai_definer;
REVOKE CREATE ON SCHEMA public FROM cs_ai_definer;

GRANT USAGE ON SCHEMA public TO cs_ai_definer, app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
-- Union of the read/write sets used by the SECURITY DEFINER entry points above. Immutable history is
-- INSERT-only; only mutable state machines receive UPDATE, and no telemetry base-table write is added.
GRANT SELECT ON
  query_events, adoption_events,
  policy_flags, import_batches, staging_scripts, outbox_jobs, scripts, script_questions,
  semantic_source_assets,
  content_releases, release_items, content_current, announcements, client_sync_state,
  rate_limit_buckets, idempotency_keys, iteration_tasks,
  work_order_import_batches, work_order_records,
  authoritative_source_versions, authoritative_source_suspensions,
  intent_taxonomy_versions, intent_taxonomy_entries, intent_taxonomy_mappings,
  import_batch_source_bindings, release_source_bindings,
  snapshot_offline_leases, source_denial_audits,
  content_quality_review_plans, content_quality_review_evidence, content_review_decisions,
  v_release_source_gate, v_scripts_recommendable
TO cs_ai_definer;
GRANT INSERT ON
  policy_flags, change_audits, import_batches, staging_scripts, outbox_jobs, scripts,
  script_questions, semantic_source_assets, content_releases, release_items, content_current, announcements,
  client_sync_state, rate_limit_buckets, idempotency_keys, iteration_task_status_audits,
  work_order_import_batches, work_order_records, work_order_export_audits,
  authoritative_source_suspensions, import_batch_source_bindings, release_source_bindings,
  snapshot_offline_leases, source_denial_audits,
  content_quality_review_plans, content_quality_review_evidence, content_review_decisions
TO cs_ai_definer;
GRANT UPDATE ON
  policy_flags, import_batches, outbox_jobs, scripts, content_releases, content_current,
  client_sync_state, rate_limit_buckets, idempotency_keys, iteration_tasks,
  work_order_import_batches
TO cs_ai_definer;
GRANT UPDATE (
  source_query_id, lifecycle, retirement_evd, retired_by_subject_hash,
  retired_by_subject_key_version, retired_at
) ON semantic_source_assets TO cs_ai_definer;
GRANT DELETE ON staging_scripts, work_order_records TO cs_ai_definer;
GRANT USAGE, SELECT ON SEQUENCE content_release_seq TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.digest(BYTEA,TEXT) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.gen_random_bytes(INTEGER) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.import_issue_codes_are_public(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_quality_issue_codes_are_public(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.work_order_issue_codes_are_public(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_text_array_is_nonblank_unique(TEXT[]) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_template_placeholders_are_valid(TEXT,TEXT[]) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_scope_matches(TEXT[],TEXT,TEXT[],TEXT,TEXT,TEXT) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_questions_are_valid(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.jsonb_jcs(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_utc_timestamp_text(TIMESTAMPTZ) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_question_hash(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_questions_align_intent(JSONB,TEXT,TEXT) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_risk_categories_are_valid(TEXT,TEXT[]) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_quality_population_manifest_hash(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_quality_staging_population_manifest_hash(TEXT) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_questions_source_assets_are_active(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_public_questions(JSONB) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_governance_snapshot(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) TO cs_ai_definer;
GRANT EXECUTE ON FUNCTION public.content_governance_hash(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT[],TEXT,TEXT[],TIMESTAMPTZ,TIMESTAMPTZ,
  TEXT,TEXT,TEXT,TEXT[],BOOLEAN,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[],JSONB
) TO cs_ai_definer;

-- Read paths and ordinary event writes. Sensitive/admin/worker state is writeable only via DEFINER APIs.
GRANT SELECT ON
  app_users, query_events, candidate_impressions, adoption_events,
  escalate_actions, privacy_notices, notice_decisions,
  iteration_tasks, iteration_task_status_audits,
  work_order_import_batches, work_order_records, work_order_export_audits,
  client_sync_state, policy_flags
TO app_runtime;
GRANT SELECT (tenant_id, source_version_id, source_ref, domain, snapshot_sha256, use_class)
  ON authoritative_source_versions TO app_runtime;
GRANT SELECT (source_version_id, reason_code, suspended_at)
  ON authoritative_source_suspensions TO app_runtime;
GRANT INSERT ON query_events, candidate_impressions, adoption_events, escalate_actions,
  notice_decisions TO app_runtime;
GRANT INSERT ON iteration_tasks TO app_runtime;

GRANT SELECT ON import_batches, staging_scripts TO app_import_worker;
GRANT SELECT ON work_order_import_batches TO app_work_order_worker;

REVOKE INSERT, UPDATE, DELETE ON
  scripts, script_questions, semantic_source_assets,
  content_releases, release_items, content_current, announcements,
  policy_flags, change_audits, idempotency_keys, rate_limit_buckets, outbox_jobs,
  import_batches, staging_scripts, client_sync_state, iteration_task_status_audits,
  work_order_import_batches, work_order_records, work_order_export_audits,
  authoritative_source_versions, authoritative_source_suspensions,
  intent_taxonomy_versions, intent_taxonomy_entries, intent_taxonomy_mappings,
  import_batch_source_bindings, release_source_bindings,
  snapshot_offline_leases, source_denial_audits
FROM app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
REVOKE UPDATE, DELETE ON iteration_tasks FROM app_runtime, app_content_admin, app_import_worker, app_work_order_worker;
REVOKE USAGE, UPDATE ON SEQUENCE content_release_seq FROM app_runtime, app_content_admin, app_import_worker, app_work_order_worker;

GRANT EXECUTE ON FUNCTION public.enqueue_content_import(TEXT,TEXT,TEXT,TEXT,BIGINT,JSONB,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.enqueue_work_order_import(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BIGINT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.cancel_content_import(TEXT,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.start_iteration_task(TEXT,INTEGER,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.close_iteration_task(TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_work_order_export(TEXT,TEXT,TEXT,TEXT,TEXT[],INTEGER,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.record_runtime_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.issue_snapshot_offline_lease(TEXT,TEXT,INTEGER) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.validate_snapshot_offline_lease(TEXT,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.read_current_announcement_with_lease(TEXT,TEXT,INTEGER) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.read_snapshot_page(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.read_content_import_status(TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.read_content_import_preview(TEXT,TEXT,TEXT,TEXT,INTEGER) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.search_recommendable_scripts(TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.ack_client_release(TEXT,TEXT,TEXT,BIGINT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.idempotency_lookup(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.idempotency_request_hash_version(TEXT,TEXT,TEXT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.idempotency_claim(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.idempotency_complete(TEXT,TEXT,TEXT,BIGINT,INT,JSONB,BOOLEAN) TO app_runtime;
GRANT EXECUTE ON FUNCTION public.idempotency_heartbeat(TEXT,TEXT,TEXT,BIGINT,INT) TO app_runtime;

-- A separately provisioned admin pool is selected only after server-verified coach/owner authorization.
GRANT EXECUTE ON FUNCTION public.set_policy_flag(TEXT,BOOLEAN,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.suspend_authoritative_source(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.record_admin_source_denial_audit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.retire_semantic_source_asset(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.publish_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.rollback_content_release(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.record_content_review_decision(
  TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TEXT
) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.record_content_quality_review_evidence(
  TEXT,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT
) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.rate_limit_take(TEXT,DOUBLE PRECISION,DOUBLE PRECISION,DOUBLE PRECISION) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.idempotency_lookup(TEXT,TEXT,TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.idempotency_request_hash_version(TEXT,TEXT,TEXT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.idempotency_claim(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INT) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.idempotency_complete(TEXT,TEXT,TEXT,BIGINT,INT,JSONB,BOOLEAN) TO app_content_admin;
GRANT EXECUTE ON FUNCTION public.idempotency_heartbeat(TEXT,TEXT,TEXT,BIGINT,INT) TO app_content_admin;

GRANT EXECUTE ON FUNCTION public.claim_content_import_validation(TEXT,INT) TO app_import_worker;
GRANT EXECUTE ON FUNCTION public.heartbeat_content_import_validation(TEXT,TEXT,BIGINT,INT) TO app_import_worker;
GRANT EXECUTE ON FUNCTION public.retry_content_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) TO app_import_worker;
GRANT EXECUTE ON FUNCTION public.freeze_content_quality_review_plan(
  TEXT,TEXT,BIGINT,TEXT,TEXT,TEXT,TIMESTAMPTZ,INTEGER,INTEGER,INTEGER,TEXT,TEXT,TEXT,JSONB
) TO app_import_worker;
GRANT EXECUTE ON FUNCTION public.finalize_content_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,JSONB) TO app_import_worker;

GRANT EXECUTE ON FUNCTION public.claim_work_order_import_validation(TEXT,INT) TO app_work_order_worker;
GRANT EXECUTE ON FUNCTION public.heartbeat_work_order_import_validation(TEXT,TEXT,BIGINT,INT) TO app_work_order_worker;
GRANT EXECUTE ON FUNCTION public.retry_work_order_import_validation(TEXT,TEXT,BIGINT,INT,TEXT) TO app_work_order_worker;
GRANT EXECUTE ON FUNCTION public.finalize_work_order_import_validation(TEXT,TEXT,BIGINT,TEXT,TEXT,JSONB,INTEGER,JSONB) TO app_work_order_worker;
