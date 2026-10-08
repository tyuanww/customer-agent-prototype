-- OFFLINE SYNTHETIC CANDIDATE ONLY. Not a migration, not runtime bootstrap.
-- The test owner installs this into a disposable PG15 database after session-lock.sql.
-- Formal adoption needs a versioned governance freeze, export and intake.
-- No LOGIN role receives GRANT ALL, identity security-column UPDATE, or membership
-- in intake_runtime_fn_owner. Callers keep EXECUTE on a few existing functions.

CREATE ROLE intake_runtime_fn_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE intake_usage LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE intake_business LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE intake_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
CREATE ROLE intake_org_writer LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO intake_usage, intake_business, intake_worker, intake_org_writer', current_database());
END $$;

GRANT USAGE ON SCHEMA intake_runtime_probe, content_intake, backend_review, public
  TO intake_usage, intake_business, intake_worker, intake_org_writer, intake_runtime_fn_owner;
GRANT USAGE ON SCHEMA backend_identity TO intake_usage, intake_business, intake_runtime_fn_owner;

-- Identity locks stay inside the NOLOGIN owner. LOGIN roles never receive these columns.
GRANT SELECT ON backend_identity.sessions, backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT UPDATE (revoked_at) ON backend_identity.sessions TO intake_runtime_fn_owner;
GRANT UPDATE (enabled) ON backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT SELECT (user_id, enabled) ON backend_identity.subject_bindings TO intake_usage, intake_business;

ALTER FUNCTION intake_runtime_probe.lock_product_session(text, text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION intake_runtime_probe.lock_product_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime_probe.lock_product_session(text, text) TO intake_usage, intake_business;

-- The context trigger takes FOR SHARE on the same security columns. DEFINER keeps
-- that UPDATE off every LOGIN role. The body is already schema-qualified.
ALTER FUNCTION content_intake.entitlement_context_guard() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.entitlement_context_guard() SECURITY DEFINER;
ALTER FUNCTION content_intake.entitlement_context_guard() SET search_path = pg_catalog;
REVOKE ALL ON FUNCTION content_intake.entitlement_context_guard()
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_backend_auth, app_backend_review, app_backend_worker;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_context_guard() TO intake_usage;

-- Direct publish/rollback keep their original bodies and search_path. Only the
-- NOLOGIN owner holds the table rights those bodies need past the first denial.
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) SECURITY DEFINER;
ALTER FUNCTION content_intake.preview_rollback(text, text, text) SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.execute_rollback(text, jsonb, jsonb) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION
  content_intake.publish_candidate(text, jsonb, jsonb),
  content_intake.preview_rollback(text, text, text),
  content_intake.execute_rollback(text, jsonb, jsonb)
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_backend_auth, app_backend_review, app_backend_worker;
GRANT EXECUTE ON FUNCTION
  content_intake.publish_candidate(text, jsonb, jsonb),
  content_intake.preview_rollback(text, text, text),
  content_intake.execute_rollback(text, jsonb, jsonb)
  TO intake_business;

GRANT EXECUTE ON FUNCTION backend_review.lock_content()
  TO intake_usage, intake_business, intake_worker, intake_org_writer, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.authorization_deadline(text, text, text, text, timestamptz)
  TO intake_usage, intake_business, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.quality_state(text, bigint) TO intake_business, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION content_intake.assert_family_catalog(text) TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_context_required() TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.entitlement_lease_guard() TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.selection_ids_valid(text[]) TO intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.object_scope_guard() TO intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.parse_object_guard() TO intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.principal_guard() TO intake_org_writer;
GRANT EXECUTE ON FUNCTION public.issue_snapshot_offline_lease(text, text, integer) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_content_ready(text) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_ready(text) TO intake_usage;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_instant(jsonb) TO intake_usage;
-- PUBLIC execute was revoked. Hashing stays in the issuing statement; the token column is not selected.
GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO intake_usage, intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.jsonb_jcs(jsonb) TO intake_runtime_fn_owner;

GRANT SELECT ON
  content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.release_catalogs, content_intake.release_lineage, content_intake.release_revocations,
  content_intake.candidate_versions, content_intake.source_confirmations, content_intake.approval_current,
  content_intake.approval_facts, content_intake.review_bindings, content_intake.release_rollback_lineage,
  content_intake.vocabulary, content_intake.vocabulary_displays, content_intake.entitlements,
  content_intake.entitlement_scopes, content_intake.entitlement_contexts
  TO intake_usage;
GRANT SELECT ON
  public.content_current, public.content_releases, public.release_items, public.v_release_source_gate,
  public.snapshot_offline_leases, public.owner_acceptance_records, public.release_source_bindings
  TO intake_usage;
GRANT INSERT ON content_intake.entitlements, content_intake.entitlement_scopes, content_intake.entitlement_contexts
  TO intake_usage;

GRANT SELECT ON
  content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.quality_plans, content_intake.quality_rounds
  TO intake_business;

GRANT SELECT (principal_id, user_id, tenant_id, app_id) ON content_intake.principals TO intake_worker;
GRANT SELECT ON content_intake.sources, content_intake.scopes TO intake_worker;
GRANT SELECT, INSERT ON content_intake.objects TO intake_worker;
GRANT SELECT ON content_intake.parse_jobs, content_intake.object_reservations TO intake_worker;
GRANT UPDATE (state, finished_at, report_object_id) ON content_intake.parse_jobs TO intake_worker;
GRANT UPDATE (state, updated_at) ON content_intake.object_reservations TO intake_worker;

GRANT SELECT ON content_intake.principals, content_intake.principal_facts TO intake_org_writer;
GRANT INSERT ON content_intake.principal_facts TO intake_org_writer;
GRANT UPDATE (current_facts_version, revocation_generation) ON content_intake.principals TO intake_org_writer;

-- Honest owner rights for a later full publish. LOGIN roles do not receive them.
GRANT SELECT, INSERT, UPDATE ON
  content_intake.write_attempts, content_intake.commit_tickets, content_intake.commit_ticket_sources,
  content_intake.candidate_versions, content_intake.release_catalogs, content_intake.release_lineage,
  content_intake.publications, content_intake.release_rollback_lineage
  TO intake_runtime_fn_owner;
GRANT SELECT ON
  content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
  content_intake.sources, content_intake.scopes, content_intake.source_mappings, content_intake.grants,
  content_intake.rollback_plans, content_intake.rollback_scopes, content_intake.release_revocations,
  content_intake.source_confirmations, content_intake.quality_plans, content_intake.quality_rounds,
  content_intake.approval_current, content_intake.approval_facts, content_intake.review_bindings,
  content_intake.entitlements, content_intake.entitlement_contexts
  TO intake_runtime_fn_owner;
GRANT SELECT, INSERT, UPDATE ON
  public.content_releases, public.release_source_bindings, public.release_items, public.content_current, public.announcements
  TO intake_runtime_fn_owner;
GRANT SELECT ON public.v_release_source_gate, public.owner_acceptance_records, public.snapshot_offline_leases
  TO intake_runtime_fn_owner;
GRANT USAGE, UPDATE ON SEQUENCE public.content_release_seq TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_content_ready(text) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_release_ready(text) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.owner_acceptance_instant(jsonb) TO intake_runtime_fn_owner;

CREATE FUNCTION intake_runtime_probe.worker_object_purpose() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NEW.purpose IS DISTINCT FROM 'report' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_OBJECT_PURPOSE';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION intake_runtime_probe.worker_terminal_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NOT (
    OLD.state IN ('reading', 'parsing') AND NEW.state IN ('failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_TERMINAL_ONLY';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION intake_runtime_probe.worker_object_purpose(), intake_runtime_probe.worker_terminal_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime_probe.worker_object_purpose(), intake_runtime_probe.worker_terminal_only() TO intake_worker;
CREATE TRIGGER intake_worker_object_purpose BEFORE INSERT ON content_intake.objects
  FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.worker_object_purpose();
CREATE TRIGGER intake_worker_terminal_only BEFORE UPDATE ON content_intake.parse_jobs
  FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.worker_terminal_only();

-- Reports the session role's own gap. DEFINER only resolves catalog names the
-- caller cannot see; every privilege test uses session_user, never the owner.
-- An administrator connection cannot impersonate a purpose.
CREATE FUNCTION intake_runtime_probe.purpose_gap(p_purpose text) RETURNS text[]
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE expected text; who text := session_user; gaps text[] := '{}';
BEGIN
  expected := CASE p_purpose
    WHEN 'usage' THEN 'intake_usage' WHEN 'business' THEN 'intake_business'
    WHEN 'worker' THEN 'intake_worker' WHEN 'organization' THEN 'intake_org_writer' ELSE NULL END;
  IF expected IS NULL OR who <> expected THEN RETURN ARRAY['role_mismatch']; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = who
    AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolbypassrls)) THEN gaps := array_append(gaps, 'superuser_attribute'); END IF;
  IF has_schema_privilege(who, 'content_intake', 'CREATE') THEN gaps := array_append(gaps, 'schema_create'); END IF;
  IF has_table_privilege(who, 'content_intake.grants', 'INSERT')
    OR has_table_privilege(who, 'content_intake.grants', 'UPDATE')
    OR has_table_privilege(who, 'content_intake.grants', 'DELETE') THEN gaps := array_append(gaps, 'grants_write'); END IF;
  IF has_column_privilege(who, 'backend_identity.sessions', 'revoked_at', 'UPDATE')
    OR has_column_privilege(who, 'backend_identity.subject_bindings', 'enabled', 'UPDATE')
    OR has_table_privilege(who, 'backend_identity.subject_bindings', 'INSERT')
    OR has_table_privilege(who, 'backend_identity.subject_bindings', 'UPDATE')
    OR has_table_privilege(who, 'backend_identity.subject_bindings', 'DELETE') THEN
    gaps := array_append(gaps, 'identity_security_update');
  END IF;
  IF pg_has_role(who, 'intake_runtime_fn_owner', 'member') THEN gaps := array_append(gaps, 'fn_owner_member'); END IF;
  IF p_purpose <> 'business' AND has_function_privilege(who, 'content_intake.publish_candidate(text,jsonb,jsonb)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'publish_excess'); END IF;
  IF p_purpose = 'business' AND NOT has_function_privilege(who, 'content_intake.publish_candidate(text,jsonb,jsonb)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'publish'); END IF;
  IF p_purpose IN ('usage', 'business') AND NOT has_function_privilege(who, 'intake_runtime_probe.lock_product_session(text,text)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'session_lock'); END IF;
  IF p_purpose IN ('worker', 'organization') AND has_function_privilege(who, 'intake_runtime_probe.lock_product_session(text,text)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'session_lock_excess'); END IF;
  IF NOT has_function_privilege(who, 'backend_review.lock_content()', 'EXECUTE') THEN gaps := array_append(gaps, 'lock_content'); END IF;
  IF p_purpose <> 'organization' AND has_table_privilege(who, 'content_intake.principal_facts', 'INSERT') THEN
    gaps := array_append(gaps, 'facts_insert_excess'); END IF;
  IF p_purpose = 'organization' AND NOT has_table_privilege(who, 'content_intake.principal_facts', 'INSERT') THEN
    gaps := array_append(gaps, 'facts_insert'); END IF;
  IF p_purpose <> 'organization' AND has_column_privilege(who, 'content_intake.principals', 'current_facts_version', 'UPDATE') THEN
    gaps := array_append(gaps, 'principal_update_excess'); END IF;
  IF p_purpose = 'organization' AND NOT has_column_privilege(who, 'content_intake.principals', 'current_facts_version', 'UPDATE') THEN
    gaps := array_append(gaps, 'principal_version_update'); END IF;
  IF has_table_privilege(who, 'content_intake.quality_plans', 'INSERT') THEN gaps := array_append(gaps, 'quality_insert_excess'); END IF;
  IF p_purpose <> 'usage' AND has_function_privilege(who, 'public.issue_snapshot_offline_lease(text,text,integer)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'lease_excess'); END IF;
  IF p_purpose = 'usage' AND NOT has_function_privilege(who, 'public.issue_snapshot_offline_lease(text,text,integer)', 'EXECUTE') THEN
    gaps := array_append(gaps, 'issue_lease'); END IF;
  IF p_purpose <> 'usage' AND has_table_privilege(who, 'content_intake.entitlements', 'INSERT') THEN
    gaps := array_append(gaps, 'entitlement_excess'); END IF;
  IF p_purpose = 'usage' AND NOT has_table_privilege(who, 'content_intake.entitlements', 'INSERT') THEN
    gaps := array_append(gaps, 'entitlement_insert'); END IF;
  IF p_purpose <> 'worker' AND has_table_privilege(who, 'content_intake.objects', 'INSERT') THEN
    gaps := array_append(gaps, 'object_excess'); END IF;
  IF p_purpose = 'worker' AND NOT has_table_privilege(who, 'content_intake.objects', 'INSERT') THEN
    gaps := array_append(gaps, 'object_insert'); END IF;
  IF p_purpose = 'usage' AND (
    NOT has_function_privilege(who, 'content_intake.authorization_deadline(text,text,text,text,timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.assert_family_catalog(text)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'public.owner_acceptance_release_content_ready(text)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'public.owner_acceptance_release_ready(text)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.entitlement_context_guard()', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.entitlement_lease_guard()', 'EXECUTE')
    OR NOT has_function_privilege(who, 'public.digest(bytea,text)', 'EXECUTE')
    OR NOT has_table_privilege(who, 'content_intake.principals', 'SELECT')
    OR NOT has_column_privilege(who, 'backend_identity.subject_bindings', 'user_id', 'SELECT')
  ) THEN gaps := array_append(gaps, 'usage_read'); END IF;
  IF p_purpose = 'business' AND (
    NOT has_function_privilege(who, 'content_intake.preview_rollback(text,text,text)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.execute_rollback(text,jsonb,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.authorization_deadline(text,text,text,text,timestamptz)', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.quality_state(text,bigint)', 'EXECUTE')
    OR NOT has_table_privilege(who, 'content_intake.quality_plans', 'SELECT')
  ) THEN gaps := array_append(gaps, 'business_read'); END IF;
  IF p_purpose = 'worker' AND (
    NOT has_column_privilege(who, 'content_intake.parse_jobs', 'state', 'UPDATE')
    OR NOT has_column_privilege(who, 'content_intake.object_reservations', 'state', 'UPDATE')
    OR NOT has_function_privilege(who, 'intake_runtime_probe.worker_object_purpose()', 'EXECUTE')
    OR NOT has_function_privilege(who, 'intake_runtime_probe.worker_terminal_only()', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.object_scope_guard()', 'EXECUTE')
    OR NOT has_function_privilege(who, 'content_intake.parse_object_guard()', 'EXECUTE')
  ) THEN gaps := array_append(gaps, 'worker_write'); END IF;
  IF p_purpose = 'organization' AND (
    NOT has_table_privilege(who, 'content_intake.principals', 'SELECT')
    OR NOT has_function_privilege(who, 'content_intake.principal_guard()', 'EXECUTE')
  ) THEN gaps := array_append(gaps, 'organization_read'); END IF;
  RETURN gaps;
END $$;
ALTER FUNCTION intake_runtime_probe.purpose_gap(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION intake_runtime_probe.purpose_gap(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime_probe.purpose_gap(text)
  TO intake_usage, intake_business, intake_worker, intake_org_writer;
