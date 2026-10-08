-- Install as a single transaction AFTER the exact product implementation overlays.
-- Missing implementation must abort before any partial grants are applied.
DO $$
DECLARE signature TEXT;
BEGIN
  FOREACH signature IN ARRAY ARRAY['content_intake.publish_candidate(text,jsonb,jsonb)',
    'content_intake.preview_rollback(text,text,text)','content_intake.execute_rollback(text,jsonb,jsonb)',
    'content_intake.quality_state(text,bigint)','content_intake.assert_family_catalog(text)'] LOOP
    IF to_regprocedure(signature) IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='INTAKE_RUNTIME_IMPLEMENTATION_REQUIRED',DETAIL=signature;
    END IF;
  END LOOP;
END $$;
-- DRAFT trusted-service capability ACL. Capability roles are NOLOGIN; environment sessions SET ROLE explicitly.
-- No per-user SQL row isolation: authenticated principal/grants remain the service owners' responsibility.
GRANT USAGE ON SCHEMA intake_runtime, content_intake, backend_review, public
  TO intake_usage, intake_business, intake_worker, intake_org_writer, intake_runtime_fn_owner;
GRANT USAGE ON SCHEMA backend_identity TO intake_usage, intake_business, intake_runtime_fn_owner;

-- Identity locks stay inside the NOLOGIN owner. LOGIN roles never receive these columns.
GRANT SELECT ON backend_identity.sessions, backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT UPDATE (revoked_at) ON backend_identity.sessions TO intake_runtime_fn_owner;
GRANT UPDATE (enabled) ON backend_identity.subject_bindings TO intake_runtime_fn_owner;
GRANT SELECT (user_id, enabled) ON backend_identity.subject_bindings TO intake_usage, intake_business;

ALTER FUNCTION intake_runtime.lock_product_session(text, text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION intake_runtime.lock_product_session(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime.lock_product_session(text, text) TO intake_usage, intake_business;

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
GRANT EXECUTE ON FUNCTION content_intake.assert_family_catalog(text) TO intake_usage, intake_runtime_fn_owner;
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
-- Publication hashes JSON text and mints a commit ticket; bytea-only digest is insufficient.
GRANT EXECUTE ON FUNCTION public.digest(text, text), public.gen_random_bytes(integer) TO intake_runtime_fn_owner;
GRANT EXECUTE ON FUNCTION public.jsonb_jcs(jsonb) TO intake_runtime_fn_owner;

GRANT SELECT ON
  content_intake.policy_versions, content_intake.principals, content_intake.principal_facts, content_intake.role_rules,
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

CREATE FUNCTION intake_runtime.worker_object_purpose() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NEW.purpose IS DISTINCT FROM 'report' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_OBJECT_PURPOSE';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION intake_runtime.worker_terminal_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF current_user = 'intake_worker' AND NOT (
    OLD.state IN ('reading', 'parsing') AND NEW.state IN ('failed', 'cancelled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'WORKER_TERMINAL_ONLY';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION intake_runtime.worker_object_purpose(), intake_runtime.worker_terminal_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION intake_runtime.worker_object_purpose(), intake_runtime.worker_terminal_only() TO intake_worker;
CREATE TRIGGER intake_worker_object_purpose BEFORE INSERT ON content_intake.objects
  FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_object_purpose();
CREATE TRIGGER intake_worker_terminal_only BEFORE UPDATE ON content_intake.parse_jobs
  FOR EACH ROW EXECUTE FUNCTION intake_runtime.worker_terminal_only();


GRANT SELECT ON backend_review.receipts TO intake_business;
GRANT INSERT ON backend_review.receipts TO intake_business;
GRANT SELECT ON content_intake.policy_versions, content_intake.objects,
  content_intake.object_reservations, content_intake.parse_jobs, content_intake.candidate_versions,
  content_intake.candidate_vocabulary, content_intake.source_confirmations, content_intake.publications,
  content_intake.write_attempts, content_intake.release_catalogs, content_intake.release_lineage,
  content_intake.release_revocations, content_intake.release_rollback_lineage,
  content_intake.review_bindings, content_intake.approval_current, content_intake.approval_facts,
  content_intake.rollback_plans, content_intake.rollback_scopes,
  content_intake.vocabulary, content_intake.vocabulary_displays,
  public.content_current, public.content_releases TO intake_business;
GRANT INSERT ON content_intake.objects, content_intake.object_reservations,
  content_intake.parse_jobs, content_intake.candidate_versions, content_intake.candidate_vocabulary,
  content_intake.source_confirmations, content_intake.quality_plans, content_intake.quality_rounds,
  content_intake.rollback_plans, content_intake.rollback_scopes, content_intake.grants,
  content_intake.grant_history TO intake_business;
GRANT UPDATE (state,finished_at,result_candidate_id,result_candidate_version) ON content_intake.parse_jobs TO intake_business;
GRANT UPDATE (state,source_evidence_version,revocation_generation,updated_at) ON content_intake.candidate_versions TO intake_business;
GRANT UPDATE (state,actual_bytes,sha256,updated_at) ON content_intake.object_reservations TO intake_business;
GRANT UPDATE (version,last_change_reason,steward_id,revoked_at) ON content_intake.grants TO intake_business;
GRANT UPDATE (revocation_generation) ON content_intake.principals TO intake_business;
GRANT INSERT (actor_id,operation_id,action,candidate_id,candidate_version,candidate_digest,payload_digest,state,created_at,publication_policy) ON content_intake.write_attempts TO intake_business;
GRANT UPDATE (state) ON content_intake.write_attempts TO intake_business;
-- FOR UPDATE needs one updatable column. The non-authoritative timestamp grants
-- the lock without allowing the login to change current_release_id or id.
GRANT UPDATE (updated_at) ON public.content_current TO intake_business;
GRANT EXECUTE ON FUNCTION backend_review.sample_ids(jsonb,text,integer),
  public.content_quality_population_manifest_hash(jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION public.digest(text,text), public.digest(bytea,text), public.jsonb_jcs(jsonb) TO intake_business;

-- Worker terminal capacity consumes reports, never input/review-package authority.
GRANT INSERT ON content_intake.object_reservations TO intake_worker;
GRANT UPDATE (actual_bytes,sha256) ON content_intake.object_reservations TO intake_worker;

CREATE FUNCTION intake_runtime.consumer_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user='intake_business' THEN
    IF TG_TABLE_NAME='grants' AND ((to_jsonb(NEW)->>'kind')='allocation' OR (TG_OP='UPDATE' AND (to_jsonb(OLD)->>'kind')='allocation')) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ROOT_ALLOCATION_FORBIDDEN';
    ELSIF TG_TABLE_NAME='write_attempts' AND (
      (to_jsonb(NEW)->>'action') IS DISTINCT FROM 'cancel'
      OR (TG_OP='INSERT' AND (to_jsonb(NEW)->>'state') IS DISTINCT FROM 'pending')
      OR (TG_OP='UPDATE' AND ((to_jsonb(OLD)->>'state') IS DISTINCT FROM 'pending'
        OR (to_jsonb(NEW)->>'state') IS DISTINCT FROM 'cancelled'
        OR (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state')))) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_CANCEL_ATTEMPT_ONLY';
    ELSIF TG_TABLE_NAME='objects' AND (to_jsonb(NEW)->>'purpose')<>'input' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_OBJECT_PURPOSE';
    ELSIF TG_TABLE_NAME='object_reservations' AND (to_jsonb(NEW)->>'purpose')<>'input' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_RESERVATION_PURPOSE';
    ELSIF TG_TABLE_NAME='candidate_versions' AND (to_jsonb(NEW)->>'state') IN ('publishing','published') THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='BUSINESS_PUBLICATION_STATE';
    ELSIF TG_TABLE_NAME='receipts' AND (to_jsonb(NEW)->>'operation') NOT LIKE 'intake:%' THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='RECEIPT_NAMESPACE';
    END IF;
  ELSIF current_user='intake_worker' AND TG_TABLE_NAME='object_reservations' AND (to_jsonb(NEW)->>'purpose')<>'report' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='WORKER_RESERVATION_PURPOSE';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION intake_runtime.consumer_write_guard() FROM PUBLIC;
CREATE TRIGGER consumer_grant BEFORE INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_object BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_reservation BEFORE INSERT OR UPDATE ON content_intake.object_reservations FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_candidate BEFORE INSERT OR UPDATE ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
CREATE TRIGGER consumer_receipt BEFORE INSERT ON backend_review.receipts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();


CREATE TRIGGER consumer_cancel_attempt BEFORE INSERT OR UPDATE ON content_intake.write_attempts FOR EACH ROW EXECUTE FUNCTION intake_runtime.consumer_write_guard();
