-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0043_intake_publish_default_tenant; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Column-default tenant adoption inside the already shipped publish_candidate.
-- Does not edit 0032 or the frozen 0042 bytes. The schema comment stays schema.v1.29.
-- A cataloged base whose tenant_id is still the column default adopts the
-- registered scope tenant inside this function. Two explicit tenants still mismatch.
-- No new role and no new GRANT target.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.publish_candidate(p_actor TEXT, p_request JSONB, p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c content_intake.candidate_versions;
  s content_intake.sources;
  k content_intake.scopes;
  a content_intake.principals;
  confirmation content_intake.source_confirmations;
  v_base TEXT;
  v_deadline TIMESTAMPTZ;
  v_actor_until TIMESTAMPTZ;
  v_issued_at TIMESTAMPTZ := clock_timestamp();
  v_inherited_until TIMESTAMPTZ;
  v_owner_until TIMESTAMPTZ;
  v_ticket TEXT;
  v_release TEXT;
  v_announcement TEXT;
  v_seq BIGINT;
  v_hash TEXT;
  v_tenant TEXT;
  v_receipt JSONB;
BEGIN
  IF p_request->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_request ? 'approvalEvidenceVersion' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT';
  END IF;
  PERFORM backend_review.lock_content();
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  SELECT * INTO c FROM content_intake.candidate_versions
    WHERE candidate_id=p_request#>>'{key,candidateId}' AND version=(p_request#>>'{key,version}')::bigint;
  IF NOT FOUND OR c.digest IS DISTINCT FROM p_request#>>'{key,digest}' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
  END IF;
  IF c.publication_policy<>'direct-v1' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT'; END IF;
  IF c.state='published' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='ALREADY_PUBLISHED'; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT * INTO STRICT s FROM content_intake.sources WHERE source_id=c.source_id;
  SELECT * INTO STRICT k FROM content_intake.scopes WHERE scope_id=c.scope_id;
  SELECT * INTO a FROM content_intake.principals WHERE principal_id=p_actor;
  v_actor_until := content_intake.authorization_deadline(p_actor,'publish',c.scope_id,c.source_id,clock_timestamp());
  IF v_actor_until IS NULL OR NOT EXISTS (SELECT 1 FROM backend_identity.subject_bindings WHERE user_id=a.user_id AND enabled) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005', MESSAGE='SCOPE_DENIED';
  END IF;
  IF s.mode<>'v2-preview' OR s.current_mapping_version<>c.source_version THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT';
  END IF;
  SELECT current_release_id INTO v_base FROM public.content_current WHERE id=1 FOR UPDATE;
  IF c.base_release_id IS DISTINCT FROM v_base OR c.base_release_id IS DISTINCT FROM p_request->>'baseReleaseId' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='BASE_CHANGED';
  END IF;
  -- A missing catalog baseline is still refused. A registered baseline may
  -- already have release_items in the target domain. Those rows are copied
  -- below and are not deleted here. An uncataloged base still gets no identity map.
  IF v_base IS NULL OR NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=v_base) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM content_intake.release_revocations WHERE release_id=v_base) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_REVOKED';
  END IF;
  SELECT cr.source_binding_hash,cr.tenant_id INTO v_hash,v_tenant FROM public.content_releases cr
    JOIN public.v_release_source_gate gate USING(release_id) WHERE cr.release_id=v_base AND gate.source_gate_ready;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  -- Column default is unassigned. Adopt the registered scope before owner
  -- acceptance reads this row. FOUND after the UPDATE is that UPDATE, not the
  -- SELECT above. Two explicit different tenants still mismatch below.
  IF v_tenant='default' AND k.tenant_id IS DISTINCT FROM 'default' THEN
    UPDATE public.content_releases SET tenant_id=k.tenant_id
      WHERE release_id=v_base AND tenant_id='default';
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
    END IF;
    v_tenant := k.tenant_id;
  END IF;
  IF v_tenant<>k.tenant_id OR NOT public.owner_acceptance_release_content_ready(v_base) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  IF c.source_evidence_version IS DISTINCT FROM (p_request->>'sourceEvidenceVersion')::bigint THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  SELECT * INTO confirmation FROM content_intake.source_confirmations WHERE candidate_id=c.candidate_id
    AND candidate_version=c.version AND evidence_version=c.source_evidence_version;
  IF NOT FOUND OR confirmation.candidate_digest<>c.digest OR confirmation.object_sha256<>c.file_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  IF content_intake.quality_state(c.candidate_id,c.version)<>'passed' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED', DETAIL='QUALITY_NOT_PASSED';
  END IF;
  -- Inheriting an unchanged entry still requires its original source/material
  -- binding. A new direct source cannot make stale inherited material current.
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l
    JOIN content_intake.candidate_versions prior ON prior.candidate_id=l.candidate_id AND prior.version=l.candidate_version
    JOIN content_intake.sources src ON src.source_id=l.source_id
    LEFT JOIN content_intake.source_confirmations sc ON sc.candidate_id=prior.candidate_id
      AND sc.candidate_version=prior.version AND sc.evidence_version=prior.source_evidence_version
    WHERE l.release_id=v_base AND l.source_id<>c.source_id AND (src.mode<>'v2-preview'
      OR src.current_mapping_version<>prior.source_version OR prior.state<>'published'
      OR sc.candidate_digest IS DISTINCT FROM prior.digest OR sc.object_sha256 IS DISTINCT FROM prior.file_sha256)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  -- Direct rows have no approval. Legacy candidate and corrective-rollback
  -- provenance retain their own current approval, without refreshing it here.
  SELECT min(facts.valid_until) INTO v_inherited_until FROM (
    SELECT review_request_id FROM content_intake.release_lineage
      WHERE release_id=v_base AND source_id<>c.source_id AND publication_policy='approval-v1'
    UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=v_base
  ) inherited JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts facts ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version;
  IF EXISTS (SELECT 1 FROM (
    SELECT review_request_id FROM content_intake.release_lineage
      WHERE release_id=v_base AND source_id<>c.source_id AND publication_policy='approval-v1'
    UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=v_base
  ) inherited JOIN content_intake.review_bindings binding USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts facts ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version
    WHERE facts.state IS DISTINCT FROM 'approved' OR facts.checked_at>clock_timestamp() OR facts.valid_until<=clock_timestamp()
      OR facts.package_verified_sha256 IS DISTINCT FROM binding.package_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_UNAVAILABLE';
  END IF;
  SELECT min(public.owner_acceptance_instant(accepted.record->'expires_at')) INTO v_owner_until
    FROM public.release_items item JOIN public.owner_acceptance_records accepted
      ON accepted.tenant_id=v_tenant AND accepted.record_sha256=item.owner_acceptance_record_sha256
    WHERE item.release_id=v_base AND item.review_mode='owner_acceptance';
  -- Catalogs preserve expired and future entries; readers apply their original
  -- windows. Copying an already-ended window does not revive it. Only a deadline
  -- still ahead at admission can expire during this commit.
  v_deadline := least(v_issued_at+interval '60 seconds',v_actor_until,v_inherited_until,v_owner_until,
    (SELECT min(content_valid_until) FROM content_intake.release_lineage
      WHERE release_id=v_base AND source_id<>c.source_id AND content_valid_until>v_issued_at),
    (SELECT min((e->>'effectiveTo')::timestamptz) FROM jsonb_array_elements(c.material->'entries') e
      WHERE (e->>'effectiveTo')::timestamptz>v_issued_at));
  IF v_deadline<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_EXPIRED';
  END IF;
  INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,candidate_id,candidate_version,candidate_digest,
    payload_digest,base_release_id,source_evidence_version,approval_evidence_version,state,created_at,publication_policy)
    VALUES (p_actor,p_request->>'operationId','publish',c.candidate_id,c.version,c.digest,
      encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'),v_base,c.source_evidence_version,NULL,'pending',clock_timestamp(),'direct-v1');
  v_ticket := encode(public.digest(public.gen_random_bytes(32),'sha256'),'hex');
  INSERT INTO content_intake.commit_tickets(ticket_hash,actor_id,action,operation_id,candidate_generation,
    actor_facts_version,actor_generation,issued_at,expires_at,publication_policy)
    VALUES (v_ticket,p_actor,'publish',p_request->>'operationId',c.revocation_generation,a.current_facts_version,a.revocation_generation,
      v_issued_at,v_deadline,'direct-v1');
  INSERT INTO content_intake.commit_ticket_sources VALUES (v_ticket,c.source_id,s.revocation_generation,s.mode_version,confirmation.revocation_generation);
  -- Quality may finish after source confirmation. Readiness is projected on
  -- reads; only this final transaction promotes the persisted state after all
  -- gates above passed, preserving the original candidate transition graph.
  UPDATE content_intake.candidate_versions SET state='ready',updated_at=clock_timestamp()
    WHERE candidate_id=c.candidate_id AND version=c.version AND state='awaiting-evidence';
  UPDATE content_intake.candidate_versions SET state='publishing',updated_at=clock_timestamp() WHERE candidate_id=c.candidate_id AND version=c.version;
  PERFORM set_config('app.publishing','on',true);
  v_seq := nextval('public.content_release_seq');
  v_release := 'rel_' || v_seq;
  v_announcement := 'ann_' || v_seq;
  UPDATE public.content_releases SET status='superseded' WHERE release_id=v_base;
  INSERT INTO public.content_releases(release_id,release_seq,title,summary,status,source_binding_hash,published_by,published_by_role,tenant_id)
    VALUES (v_release,v_seq,p_request->>'title',p_request->>'summary','published',v_hash,a.user_id,(SELECT role FROM backend_identity.subject_bindings WHERE user_id=a.user_id),v_tenant);
  INSERT INTO public.release_source_bindings(release_id,domain,source_version_id)
    SELECT v_release,domain,source_version_id FROM public.release_source_bindings WHERE release_id=v_base;
  -- Composite-row copying preserves every legacy field, including owner evidence.
  INSERT INTO public.release_items SELECT (jsonb_populate_record(NULL::public.release_items,to_jsonb(item)||jsonb_build_object('release_id',v_release))).*
    FROM public.release_items item WHERE release_id=v_base;
  IF NOT public.owner_acceptance_release_content_ready(v_release) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES (v_release,'intake-v2.1');
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy) SELECT v_release,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy FROM content_intake.release_lineage
    WHERE release_id=v_base AND source_id<>c.source_id;
  -- Include explicit disables for immutable version history and later re-enable.
  -- Readers filter operation/time; they must never infer deletion from missing rows.
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy) SELECT v_release,c.source_id,e->>'businessEntryId',(e->>'scriptVersion')::bigint,
    c.candidate_id,c.version,NULL,coalesce((e->>'effectiveTo')::timestamptz,'infinity'::timestamptz),'direct-v1'
    FROM jsonb_array_elements(c.material->'entries') e;
  IF v_deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_EXPIRED'; END IF;
  UPDATE public.content_current SET current_release_id=v_release,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.announcements(announcement_id,release_id,title,summary) VALUES (v_announcement,v_release,p_request->>'title',p_request->>'summary');
  INSERT INTO content_intake.publications(candidate_id,candidate_version,actor_id,action,operation_id,release_id,announcement_id,publication_policy,confirmed_at)
    VALUES (c.candidate_id,c.version,p_actor,'publish',p_request->>'operationId',v_release,v_announcement,'direct-v1',v_issued_at);
  UPDATE content_intake.write_attempts SET state='published' WHERE actor_id=p_actor AND action='publish' AND operation_id=p_request->>'operationId';
  UPDATE content_intake.candidate_versions SET state='published',updated_at=clock_timestamp() WHERE candidate_id=c.candidate_id AND version=c.version;
  UPDATE content_intake.commit_tickets SET consumed_at=clock_timestamp() WHERE ticket_hash=v_ticket;
  v_receipt := jsonb_build_object('operationId',p_request->>'operationId','key',p_request->'key','action','publish',
    'state','published','releaseId',v_release,'announcementId',v_announcement,'reason',NULL);
  RETURN jsonb_build_object('receipt',v_receipt,'validUntil',v_deadline);
END;
$$;

ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) SET search_path = pg_catalog, public, pg_temp;
REVOKE ALL ON FUNCTION content_intake.publish_candidate(text, jsonb, jsonb)
  FROM PUBLIC, app_runtime, app_content_admin, app_import_worker, app_backend_auth, app_backend_review, app_backend_worker;
GRANT EXECUTE ON FUNCTION content_intake.publish_candidate(text, jsonb, jsonb) TO intake_business;

DO $occupied$
BEGIN
  IF position('release_id=v_base AND category=k.domain' IN (
    SELECT prosrc FROM pg_catalog.pg_proc
    WHERE oid = 'content_intake.publish_candidate(text,jsonb,jsonb)'::pg_catalog.regprocedure
  )) > 0 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='OCCUPIED_DOMAIN_GATE_REMAINS';
  END IF;
  IF position('v_tenant=''default'' AND k.tenant_id IS DISTINCT FROM ''default''' IN (
    SELECT prosrc FROM pg_catalog.pg_proc
    WHERE oid = 'content_intake.publish_candidate(text,jsonb,jsonb)'::pg_catalog.regprocedure
  )) = 0 THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DEFAULT_TENANT_ADOPTION_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_roles owner_role ON owner_role.oid = procedure.proowner
    WHERE procedure.oid = 'content_intake.publish_candidate(text,jsonb,jsonb)'::pg_catalog.regprocedure
      AND owner_role.rolname = 'intake_runtime_fn_owner'
      AND procedure.prosecdef
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='PUBLISH_CANDIDATE_OWNER_REQUIRED';
  END IF;
END
$occupied$;
