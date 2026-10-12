-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0032_intake_direct_publication; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929
-- source_git_sha=6f318d448929d1a87c5dc9e725ea4f90c48a4b97
-- source_schema_sha256=c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce
-- Private direct-publication runtime overlay, after frozen schema.v1.22.
-- New writes require explicit confirmation; immutable legacy rows retain their
-- original approval lineage. No application privileges or source activation.
-- The observation argument retains the private signature only; direct writes
-- never consume an approval observation, including a caller-supplied PASS.
-- Full replacements preserve the family/capacity triggers installed by 0028/29.
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
  -- Bootstrap and legacy-domain adoption need their own approved identity map.
  -- This publisher never guesses one or removes legacy rows as an implicit migration.
  IF v_base IS NULL OR NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=v_base)
    OR EXISTS (SELECT 1 FROM public.release_items WHERE release_id=v_base AND category=k.domain) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MODE_CONFLICT';
  END IF;
  IF EXISTS (SELECT 1 FROM content_intake.release_revocations WHERE release_id=v_base) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_REVOKED';
  END IF;
  SELECT cr.source_binding_hash,cr.tenant_id INTO v_hash,v_tenant FROM public.content_releases cr
    JOIN public.v_release_source_gate gate USING(release_id) WHERE cr.release_id=v_base AND gate.source_gate_ready;
  IF NOT FOUND OR v_tenant<>k.tenant_id OR NOT public.owner_acceptance_release_content_ready(v_base) THEN
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

CREATE OR REPLACE FUNCTION content_intake.preview_rollback(p_actor TEXT,p_base TEXT,p_target TEXT)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE current_id TEXT; target_id TEXT; actor content_intake.principals;
  sources JSONB; scopes JSONB; impact JSONB; denied BOOLEAN; visible INTEGER;
BEGIN
  PERFORM backend_review.lock_content();
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  SELECT * INTO actor FROM content_intake.principals WHERE principal_id=p_actor;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM backend_identity.subject_bindings WHERE user_id=actor.user_id AND enabled) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005',MESSAGE='SCOPE_DENIED';
  END IF;
  SELECT current_release_id INTO current_id FROM public.content_current WHERE id=1 FOR UPDATE;
  IF current_id IS DISTINCT FROM p_base THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED'; END IF;
  SELECT release_id INTO target_id FROM public.content_releases WHERE release_seq<(SELECT release_seq FROM public.content_releases WHERE release_id=p_base)
    AND status IN ('published','superseded') ORDER BY release_seq DESC LIMIT 1;
  IF target_id IS NULL OR target_id IS DISTINCT FROM p_target THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED';
  END IF;
  IF (SELECT count(*) FROM content_intake.release_catalogs WHERE release_id IN(p_base,p_target))<>2
    OR EXISTS(SELECT 1 FROM public.content_releases WHERE release_id IN(p_base,p_target) AND tenant_id<>actor.tenant_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MODE_CONFLICT';
  END IF;
  -- Native rollback cannot silently roll back a legacy domain without a source
  -- scope. Legacy rows and source bindings must therefore be identical.
  IF EXISTS(SELECT 1 FROM (
    (SELECT to_jsonb(i)-'release_id' item FROM public.release_items i WHERE release_id=p_base EXCEPT
     SELECT to_jsonb(i)-'release_id' FROM public.release_items i WHERE release_id=p_target)
    UNION ALL
    (SELECT to_jsonb(i)-'release_id' FROM public.release_items i WHERE release_id=p_target EXCEPT
     SELECT to_jsonb(i)-'release_id' FROM public.release_items i WHERE release_id=p_base)) d)
    OR EXISTS(SELECT 1 FROM (
      (SELECT domain,source_version_id FROM public.release_source_bindings WHERE release_id=p_base EXCEPT
       SELECT domain,source_version_id FROM public.release_source_bindings WHERE release_id=p_target)
      UNION ALL
      (SELECT domain,source_version_id FROM public.release_source_bindings WHERE release_id=p_target EXCEPT
       SELECT domain,source_version_id FROM public.release_source_bindings WHERE release_id=p_base)) d) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MODE_CONFLICT';
  END IF;
  WITH delta AS (
    SELECT coalesce(b.source_id,t.source_id) source_id,coalesce(b.business_entry_id,t.business_entry_id) entry_id,
      to_jsonb(b)-'release_id' before_item,to_jsonb(t)-'release_id' after_item
    FROM (SELECT * FROM content_intake.release_lineage WHERE release_id=p_base) b FULL JOIN
      (SELECT * FROM content_intake.release_lineage WHERE release_id=p_target) t USING(source_id,business_entry_id)
    WHERE (to_jsonb(b)-'release_id') IS DISTINCT FROM (to_jsonb(t)-'release_id')
  ) SELECT jsonb_agg(jsonb_build_object('sourceId',source_id,'entryId',entry_id,'before',before_item,'after',after_item)
      ORDER BY source_id COLLATE "C",entry_id COLLATE "C") INTO impact FROM delta;
  IF impact IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT jsonb_agg(id ORDER BY id COLLATE "C") INTO sources FROM (SELECT DISTINCT e->>'sourceId' id FROM jsonb_array_elements(impact) e) ids;
  IF jsonb_array_length(sources)>1000 THEN RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='FILE_LIMIT'; END IF;
  SELECT count(*) FILTER(WHERE permitted),coalesce(bool_or(NOT permitted),true),
    coalesce(jsonb_agg(scope ORDER BY source_id COLLATE "C") FILTER(WHERE permitted),'[]'::jsonb)
    INTO visible,denied,scopes FROM (
      SELECT src.source_id,content_intake.authorization_deadline(p_actor,'rollback',src.scope_id,src.source_id,clock_timestamp()) IS NOT NULL permitted,
        jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',src.source_id) scope
      FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
      WHERE sources ? src.source_id::text AND s.tenant_id=actor.tenant_id AND s.app_id=actor.app_id
    ) rights;
  IF visible=0 THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  -- A target's provenance is never refreshed by rollback itself. Confirmation
  -- records the new intent; it cannot revive original approvals.
  IF EXISTS(SELECT 1 FROM content_intake.release_revocations WHERE release_id=p_target) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_REVOKED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.v_release_source_gate WHERE release_id=p_target AND source_gate_ready)
    OR NOT public.owner_acceptance_release_content_ready(p_target)
    OR EXISTS(SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.candidate_versions c
      ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      JOIN content_intake.sources src ON src.source_id=l.source_id
      LEFT JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version
        AND sc.evidence_version=c.source_evidence_version
      WHERE l.release_id=p_target AND (src.mode<>'v2-preview' OR src.current_mapping_version<>c.source_version
        OR c.state<>'published' OR l.content_valid_until<=clock_timestamp()
        OR sc.candidate_digest IS DISTINCT FROM c.digest OR sc.object_sha256 IS DISTINCT FROM c.file_sha256)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM (
      SELECT review_request_id FROM content_intake.release_lineage WHERE release_id=p_target AND publication_policy='approval-v1'
      UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=p_target
    ) l JOIN content_intake.review_bindings r USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version
    WHERE f.state IS DISTINCT FROM 'approved' OR f.checked_at>clock_timestamp() OR f.valid_until<=clock_timestamp()
      OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_UNAVAILABLE';
  END IF;
  RETURN jsonb_build_object('baseReleaseId',p_base,'targetReleaseId',p_target,'sourceIds',sources,'scopes',scopes,
    'requiresCorrectiveCandidate',denied OR visible<>jsonb_array_length(sources),
    'impactDigest',encode(public.digest(public.jsonb_jcs(jsonb_build_object('baseReleaseId',p_base,'targetReleaseId',p_target,'impact',impact)),'sha256'),'hex'));
END $$;

CREATE OR REPLACE FUNCTION content_intake.execute_rollback(p_actor TEXT,p_request JSONB,p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE plan content_intake.rollback_plans; actor content_intake.principals; preview JSONB;
  deadline TIMESTAMPTZ; inherited_until TIMESTAMPTZ; owner_until TIMESTAMPTZ;
  actor_until TIMESTAMPTZ; issued_at TIMESTAMPTZ := clock_timestamp(); ticket TEXT; release_id_new TEXT; announcement_id_new TEXT; seq BIGINT;
BEGIN
  IF p_request->'confirmed' IS DISTINCT FROM 'true'::jsonb OR p_request ? 'approvalEvidenceVersion' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MODE_CONFLICT';
  END IF;
  PERFORM backend_review.lock_content();
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  SELECT * INTO plan FROM content_intake.rollback_plans WHERE rollback_plan_id=p_request->>'rollbackPlanId';
  IF NOT FOUND OR plan.actor_id<>p_actor OR plan.base_release_id IS DISTINCT FROM p_request->>'baseReleaseId'
    OR plan.target_release_id IS DISTINCT FROM p_request->>'targetReleaseId' OR plan.impact_digest IS DISTINCT FROM p_request->>'impactDigest' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
  IF EXISTS(SELECT 1 FROM content_intake.publications WHERE rollback_plan_id=plan.rollback_plan_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='ALREADY_PUBLISHED';
  END IF;
  preview:=content_intake.preview_rollback(p_actor,plan.base_release_id,plan.target_release_id);
  IF (preview->>'requiresCorrectiveCandidate')::boolean THEN RAISE EXCEPTION USING ERRCODE='ZA005',MESSAGE='SCOPE_DENIED'; END IF;
  IF preview->>'impactDigest' IS DISTINCT FROM plan.impact_digest OR
    (SELECT jsonb_agg(source_id ORDER BY source_id::text COLLATE "C") FROM content_intake.rollback_scopes WHERE rollback_plan_id=plan.rollback_plan_id)
      IS DISTINCT FROM preview->'sourceIds' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT * INTO STRICT actor FROM content_intake.principals WHERE principal_id=p_actor;
  SELECT min(content_intake.authorization_deadline(p_actor,'rollback',s.scope_id,s.source_id,clock_timestamp()))
    INTO actor_until FROM content_intake.rollback_scopes rs JOIN content_intake.sources s USING(source_id)
    WHERE rs.rollback_plan_id=plan.rollback_plan_id;
  IF actor_until IS NULL OR EXISTS(SELECT 1 FROM content_intake.rollback_scopes rs JOIN content_intake.sources s USING(source_id)
    WHERE rs.rollback_plan_id=plan.rollback_plan_id AND content_intake.authorization_deadline(p_actor,'rollback',s.scope_id,s.source_id,clock_timestamp()) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005',MESSAGE='PERMISSION_CHANGED';
  END IF;
  SELECT min(f.valid_until) INTO inherited_until FROM (
    SELECT review_request_id FROM content_intake.release_lineage WHERE release_id=plan.target_release_id AND publication_policy='approval-v1'
    UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=plan.target_release_id
  ) l JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version;
  SELECT min(public.owner_acceptance_instant(a.record->'expires_at')) INTO owner_until FROM public.release_items item
    JOIN public.owner_acceptance_records a ON a.tenant_id=actor.tenant_id AND a.record_sha256=item.owner_acceptance_record_sha256
    WHERE item.release_id=plan.target_release_id AND item.review_mode='owner_acceptance';
  deadline:=least(issued_at+interval '60 seconds',actor_until,inherited_until,owner_until,
    (SELECT min(content_valid_until) FROM content_intake.release_lineage WHERE release_id=plan.target_release_id));
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='TICKET_EXPIRED'; END IF;
  INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,rollback_plan_id,impact_digest,payload_digest,base_release_id,approval_evidence_version,state,created_at,publication_policy)
    VALUES(p_actor,p_request->>'operationId','rollback',plan.rollback_plan_id,plan.impact_digest,
      encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'),plan.base_release_id,NULL,'pending',clock_timestamp(),'direct-v1');
  ticket:=encode(public.digest(public.gen_random_bytes(32),'sha256'),'hex');
  INSERT INTO content_intake.commit_tickets(ticket_hash,actor_id,action,operation_id,actor_facts_version,actor_generation,
    issued_at,expires_at,publication_policy)
    VALUES(ticket,p_actor,'rollback',p_request->>'operationId',actor.current_facts_version,actor.revocation_generation,
      issued_at,deadline,'direct-v1');
  INSERT INTO content_intake.commit_ticket_sources SELECT ticket,s.source_id,s.revocation_generation,s.mode_version,
    coalesce((SELECT max(sc.revocation_generation) FROM content_intake.release_lineage l JOIN content_intake.candidate_versions c
      ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version JOIN content_intake.source_confirmations sc
      ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version AND sc.evidence_version=c.source_evidence_version
      WHERE l.release_id=plan.target_release_id AND l.source_id=s.source_id),0)
    FROM content_intake.rollback_scopes rs JOIN content_intake.sources s USING(source_id) WHERE rs.rollback_plan_id=plan.rollback_plan_id;
  PERFORM set_config('app.publishing','on',true);
  seq:=nextval('public.content_release_seq'); release_id_new:='rel_'||seq; announcement_id_new:='ann_'||seq;
  UPDATE public.content_releases SET status='superseded' WHERE release_id=plan.base_release_id;
  INSERT INTO public.content_releases(release_id,release_seq,title,summary,status,source_binding_hash,published_by,published_by_role,tenant_id)
    SELECT release_id_new,seq,'资料纠正回退','恢复上一发布版本 '||plan.target_release_id,'published',source_binding_hash,
      actor.user_id,(SELECT role FROM backend_identity.subject_bindings WHERE user_id=actor.user_id),tenant_id
    FROM public.content_releases WHERE release_id=plan.target_release_id;
  INSERT INTO public.release_source_bindings SELECT release_id_new,domain,source_version_id FROM public.release_source_bindings WHERE release_id=plan.target_release_id;
  INSERT INTO public.release_items SELECT (jsonb_populate_record(NULL::public.release_items,to_jsonb(i)||jsonb_build_object('release_id',release_id_new))).*
    FROM public.release_items i WHERE release_id=plan.target_release_id;
  INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES(release_id_new,'intake-v2.1');
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy) SELECT release_id_new,source_id,business_entry_id,script_version,candidate_id,candidate_version,
    review_request_id,content_valid_until,publication_policy FROM content_intake.release_lineage WHERE release_id=plan.target_release_id;
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='TICKET_EXPIRED'; END IF;
  UPDATE public.content_current SET current_release_id=release_id_new,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.announcements(announcement_id,release_id,title,summary)
    VALUES(announcement_id_new,release_id_new,'资料纠正回退','恢复上一发布版本 '||plan.target_release_id);
  INSERT INTO content_intake.publications(rollback_plan_id,actor_id,action,operation_id,release_id,announcement_id,publication_policy,confirmed_at)
    VALUES(plan.rollback_plan_id,p_actor,'rollback',p_request->>'operationId',release_id_new,announcement_id_new,'direct-v1',issued_at);
  UPDATE content_intake.write_attempts SET state='published' WHERE actor_id=p_actor AND action='rollback' AND operation_id=p_request->>'operationId';
  UPDATE content_intake.commit_tickets SET consumed_at=clock_timestamp() WHERE ticket_hash=ticket;
  RETURN jsonb_build_object('receipt',jsonb_build_object('operationId',p_request->>'operationId','rollbackPlanId',plan.rollback_plan_id,
    'action','rollback','state','published','releaseId',release_id_new,'announcementId',announcement_id_new,'reason',NULL),'validUntil',deadline);
END $$;

CREATE OR REPLACE FUNCTION content_intake.inherit_rollback_reviews() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE operation content_intake.write_attempts; prior_release TEXT; review_id TEXT;
BEGIN
  SELECT * INTO STRICT operation FROM content_intake.write_attempts
    WHERE actor_id=NEW.actor_id AND action=NEW.action AND operation_id=NEW.operation_id;
  prior_release:=operation.base_release_id;
  IF NEW.action='rollback' THEN
    SELECT target_release_id INTO STRICT prior_release FROM content_intake.rollback_plans WHERE rollback_plan_id=NEW.rollback_plan_id;
    IF NEW.publication_policy='approval-v1' THEN
      SELECT review_request_id INTO STRICT review_id FROM content_intake.review_bindings
        WHERE rollback_plan_id=NEW.rollback_plan_id AND evidence_version=operation.approval_evidence_version;
      INSERT INTO content_intake.release_rollback_lineage VALUES(NEW.release_id,review_id);
    END IF;
  END IF;
  INSERT INTO content_intake.release_rollback_lineage
    SELECT NEW.release_id,review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=prior_release
    ON CONFLICT DO NOTHING;
  IF EXISTS (SELECT 1 FROM content_intake.release_rollback_lineage l
    JOIN content_intake.review_bindings r USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version
    WHERE l.release_id=NEW.release_id AND (f.state IS DISTINCT FROM 'approved' OR f.checked_at>clock_timestamp()
      OR f.valid_until<=clock_timestamp() OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_UNAVAILABLE';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION content_intake.inherit_legacy_catalog(p_previous TEXT, p_next TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- The legacy path has no rollback-review observation or deadline owner.
  -- Refuse inheritance rather than dropping that independent approval.
  IF EXISTS(SELECT 1 FROM content_intake.release_rollback_lineage WHERE release_id=p_previous) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='legacy publisher cannot inherit rollback approval',DETAIL='CONFLICT';
  END IF;
  -- Retain the family fence installed by 0028; legacy writers have no family
  -- validation owner and cannot discard explicit relationships.
  IF EXISTS(SELECT 1 FROM content_intake.candidate_versions c WHERE EXISTS (
      SELECT 1 FROM content_intake.release_lineage l WHERE l.release_id=p_previous
        AND l.candidate_id=c.candidate_id AND l.candidate_version=c.version)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'entries') e
        WHERE e->>'familySourceId' IS NOT NULL OR e->>'familyBusinessEntryId' IS NOT NULL)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='legacy publisher cannot inherit explicit family',DETAIL='CONFLICT';
  END IF;
  -- Called within the publishing transaction, under the guard's content lock.
  -- Recheck actual output bindings before copying, not just declared input scope.
  IF NOT EXISTS (SELECT 1 FROM content_intake.release_catalogs WHERE release_id=p_previous) THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l
    JOIN content_intake.sources s USING(source_id) JOIN content_intake.scopes k USING(scope_id)
    LEFT JOIN public.release_source_bindings old ON old.release_id=p_previous AND old.domain=k.domain
    LEFT JOIN public.release_source_bindings new ON new.release_id=p_next AND new.domain=k.domain
    WHERE l.release_id=p_previous AND (old.source_version_id IS NULL OR new.source_version_id IS DISTINCT FROM old.source_version_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='intake source inheritance cannot be proven', DETAIL='CONFLICT';
  END IF;
  INSERT INTO content_intake.release_catalogs(release_id,format_version,sop_nodes,sop_edges,media)
    SELECT p_next,format_version,sop_nodes,sop_edges,media FROM content_intake.release_catalogs WHERE release_id=p_previous;
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
      candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
    SELECT p_next,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy
      FROM content_intake.release_lineage WHERE release_id=p_previous;
END;
$$;

-- CREATE OR REPLACE retains existing owners, OIDs and ACLs. Reassert the
-- application boundary without granting another runtime path.
REVOKE ALL ON FUNCTION content_intake.publish_candidate(TEXT,JSONB,JSONB),
  content_intake.preview_rollback(TEXT,TEXT,TEXT),content_intake.execute_rollback(TEXT,JSONB,JSONB),
  content_intake.inherit_rollback_reviews(),content_intake.inherit_legacy_catalog(TEXT,TEXT)
  FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
