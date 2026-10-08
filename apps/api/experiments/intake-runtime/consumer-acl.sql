-- OFFLINE consumer candidate, applied only after purpose-acl.sql in a disposable
-- synthetic database. This is a separate matrix: purpose_gap describes the old
-- probe and deliberately rejects these newly proposed business write rights.
-- Trusted service owns authenticated actor binding; these LOGIN roles are not
-- per-user identities. No identity security columns, root allocation, facts or
-- direct publication writes are exposed to them.
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
-- FOR UPDATE needs one updatable column. The non-authoritative timestamp grants
-- the lock without allowing the login to change current_release_id or id.
GRANT UPDATE (updated_at) ON public.content_current TO intake_business;
GRANT EXECUTE ON FUNCTION backend_review.sample_ids(jsonb,text,integer),
  public.content_quality_population_manifest_hash(jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION public.digest(text,text), public.digest(bytea,text), public.jsonb_jcs(jsonb) TO intake_business;

-- Worker terminal capacity consumes reports, never input/review-package authority.
GRANT INSERT ON content_intake.object_reservations TO intake_worker;
GRANT UPDATE (actual_bytes,sha256) ON content_intake.object_reservations TO intake_worker;

CREATE FUNCTION intake_runtime_probe.consumer_write_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF current_user='intake_business' THEN
    IF TG_TABLE_NAME='grants' AND ((to_jsonb(NEW)->>'kind')='allocation' OR (TG_OP='UPDATE' AND (to_jsonb(OLD)->>'kind')='allocation')) THEN
      RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='ROOT_ALLOCATION_FORBIDDEN';
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
REVOKE ALL ON FUNCTION intake_runtime_probe.consumer_write_guard() FROM PUBLIC;
CREATE TRIGGER consumer_grant BEFORE INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.consumer_write_guard();
CREATE TRIGGER consumer_object BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.consumer_write_guard();
CREATE TRIGGER consumer_reservation BEFORE INSERT OR UPDATE ON content_intake.object_reservations FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.consumer_write_guard();
CREATE TRIGGER consumer_candidate BEFORE INSERT OR UPDATE ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.consumer_write_guard();
CREATE TRIGGER consumer_receipt BEFORE INSERT ON backend_review.receipts FOR EACH ROW EXECUTE FUNCTION intake_runtime_probe.consumer_write_guard();
