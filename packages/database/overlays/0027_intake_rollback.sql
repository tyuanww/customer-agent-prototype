-- Private corrective rollback. The frozen wire/storage shapes remain unchanged;
-- this dependency relation records the independent rollback review which cannot
-- inhabit release_lineage's candidate-only foreign key. No application ACL opens.
SET LOCAL search_path = public, pg_catalog, pg_temp;
CREATE TABLE content_intake.release_rollback_lineage (
  release_id TEXT NOT NULL REFERENCES content_intake.release_catalogs,
  review_request_id content_intake.identifier NOT NULL REFERENCES content_intake.review_bindings,
  PRIMARY KEY (release_id,review_request_id)
);
CREATE INDEX release_rollback_lineage_review ON content_intake.release_rollback_lineage(review_request_id,release_id);
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.release_rollback_lineage
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();

-- Both publishers inherit this provenance atomically. A normal publication may
-- not discard the approval which authorized the catalog it inherited.
CREATE FUNCTION content_intake.inherit_rollback_reviews() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE operation content_intake.write_attempts; prior_release TEXT; review_id TEXT;
BEGIN
  SELECT * INTO STRICT operation FROM content_intake.write_attempts
    WHERE actor_id=NEW.actor_id AND action=NEW.action AND operation_id=NEW.operation_id;
  prior_release:=operation.base_release_id;
  IF NEW.action='rollback' THEN
    SELECT target_release_id INTO STRICT prior_release FROM content_intake.rollback_plans WHERE rollback_plan_id=NEW.rollback_plan_id;
    SELECT review_request_id INTO STRICT review_id FROM content_intake.review_bindings
      WHERE rollback_plan_id=NEW.rollback_plan_id AND evidence_version=operation.approval_evidence_version;
    INSERT INTO content_intake.release_rollback_lineage VALUES(NEW.release_id,review_id);
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
CREATE TRIGGER inherit_rollback_reviews AFTER INSERT ON content_intake.publications
  FOR EACH ROW EXECUTE FUNCTION content_intake.inherit_rollback_reviews();

-- Internal result includes the full sourceIds for immutable plan storage. Only
-- authorized scopes may be projected to the wire. A partial operator gets a
-- corrective-candidate hint, never an executable subset of a full rollback.
CREATE FUNCTION content_intake.preview_rollback(p_actor TEXT,p_base TEXT,p_target TEXT)
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
  -- A target's provenance is never refreshed by rollback itself. Independent
  -- review only authorizes the rollback; it cannot revive original approvals.
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
      SELECT review_request_id FROM content_intake.release_lineage WHERE release_id=p_target
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

CREATE FUNCTION content_intake.execute_rollback(p_actor TEXT,p_request JSONB,p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE plan content_intake.rollback_plans; actor content_intake.principals; reviewer content_intake.principals;
  review content_intake.review_bindings; facts content_intake.approval_facts; preview JSONB;
  deadline TIMESTAMPTZ; inherited_until TIMESTAMPTZ; owner_until TIMESTAMPTZ;
  actor_until TIMESTAMPTZ; reviewer_until TIMESTAMPTZ; ticket TEXT; release_id_new TEXT; announcement_id_new TEXT; seq BIGINT;
BEGIN
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
  SELECT * INTO review FROM content_intake.review_bindings WHERE rollback_plan_id=plan.rollback_plan_id
    AND evidence_version=(p_request->>'approvalEvidenceVersion')::bigint;
  IF NOT FOUND OR review.impact_digest<>plan.impact_digest OR review.evidence_version<>(SELECT max(evidence_version)
    FROM content_intake.review_bindings WHERE rollback_plan_id=plan.rollback_plan_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_CHANGED';
  END IF;
  SELECT f.* INTO facts FROM content_intake.approval_current cur JOIN content_intake.approval_facts f
    ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version WHERE cur.review_request_id=review.review_request_id;
  IF NOT FOUND OR facts.state<>'approved' OR facts.package_verified_sha256 IS DISTINCT FROM review.package_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='AWAITING_APPROVAL';
  END IF;
  IF p_observation->>'reviewRequestId' IS DISTINCT FROM review.review_request_id::text
    OR (p_observation->>'checkedAt')::timestamptz IS DISTINCT FROM facts.checked_at
    OR (p_observation->>'revocationGeneration')::bigint IS DISTINCT FROM facts.revocation_generation THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_CHANGED';
  END IF;
  SELECT * INTO reviewer FROM content_intake.principals WHERE principal_id=facts.reviewer_id;
  IF NOT FOUND OR reviewer.tenant_id<>actor.tenant_id OR reviewer.app_id<>actor.app_id
    OR NOT EXISTS(SELECT 1 FROM backend_identity.subject_bindings WHERE user_id=reviewer.user_id AND enabled) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005',MESSAGE='PERMISSION_CHANGED';
  END IF;
  IF actor.identity_scope<>reviewer.identity_scope OR actor.person_key=reviewer.person_key
    OR EXISTS(SELECT 1 FROM content_intake.release_lineage l JOIN content_intake.contributors c
      ON c.candidate_id=l.candidate_id AND c.candidate_version=l.candidate_version
      JOIN content_intake.principals p ON p.principal_id=c.principal_id
      WHERE l.release_id IN(plan.base_release_id,plan.target_release_id) AND (preview->'sourceIds') ? l.source_id::text
        AND (p.identity_scope<>reviewer.identity_scope OR p.person_key=reviewer.person_key))
    OR facts.decided_at<(SELECT received_at FROM content_intake.objects WHERE object_id=review.package_object_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='HUMAN_REVIEW_REQUIRED';
  END IF;
  IF EXISTS(SELECT 1 FROM content_intake.rollback_scopes rs JOIN content_intake.sources s USING(source_id)
    WHERE rs.rollback_plan_id=plan.rollback_plan_id AND content_intake.authorization_deadline(reviewer.principal_id,'review',s.scope_id,s.source_id,clock_timestamp()) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005',MESSAGE='PERMISSION_CHANGED';
  END IF;
  SELECT min(content_intake.authorization_deadline(p_actor,'rollback',s.scope_id,s.source_id,clock_timestamp())),
    min(content_intake.authorization_deadline(reviewer.principal_id,'review',s.scope_id,s.source_id,clock_timestamp()))
    INTO actor_until,reviewer_until FROM content_intake.rollback_scopes rs JOIN content_intake.sources s USING(source_id) WHERE rs.rollback_plan_id=plan.rollback_plan_id;
  SELECT min(f.valid_until) INTO inherited_until FROM (
    SELECT review_request_id FROM content_intake.release_lineage WHERE release_id=plan.target_release_id
    UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=plan.target_release_id
  ) l JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts f ON f.review_request_id=cur.review_request_id AND f.facts_version=cur.facts_version;
  SELECT min(public.owner_acceptance_instant(a.record->'expires_at')) INTO owner_until FROM public.release_items item
    JOIN public.owner_acceptance_records a ON a.tenant_id=actor.tenant_id AND a.record_sha256=item.owner_acceptance_record_sha256
    WHERE item.release_id=plan.target_release_id AND item.review_mode='owner_acceptance';
  deadline:=least(facts.checked_at+interval '60 seconds',facts.valid_until,actor_until,reviewer_until,inherited_until,owner_until,
    (SELECT min(content_valid_until) FROM content_intake.release_lineage WHERE release_id=plan.target_release_id));
  IF facts.checked_at>clock_timestamp() OR deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='TICKET_EXPIRED'; END IF;
  INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,rollback_plan_id,impact_digest,payload_digest,base_release_id,approval_evidence_version,state,created_at)
    VALUES(p_actor,p_request->>'operationId','rollback',plan.rollback_plan_id,plan.impact_digest,
      encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'),plan.base_release_id,review.evidence_version,'pending',clock_timestamp());
  ticket:=encode(public.digest(public.gen_random_bytes(32),'sha256'),'hex');
  INSERT INTO content_intake.commit_tickets(ticket_hash,actor_id,action,operation_id,actor_facts_version,actor_generation,
    reviewer_facts_version,reviewer_generation,approval_facts_version,approval_generation,issued_at,expires_at)
    VALUES(ticket,p_actor,'rollback',p_request->>'operationId',actor.current_facts_version,actor.revocation_generation,
      reviewer.current_facts_version,reviewer.revocation_generation,facts.facts_version,facts.revocation_generation,facts.checked_at,deadline);
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
    SELECT release_id_new,seq,'资料纠正回退','恢复已审核的上一发布版本 '||plan.target_release_id,'published',source_binding_hash,
      actor.user_id,(SELECT role FROM backend_identity.subject_bindings WHERE user_id=actor.user_id),tenant_id
    FROM public.content_releases WHERE release_id=plan.target_release_id;
  INSERT INTO public.release_source_bindings SELECT release_id_new,domain,source_version_id FROM public.release_source_bindings WHERE release_id=plan.target_release_id;
  INSERT INTO public.release_items SELECT (jsonb_populate_record(NULL::public.release_items,to_jsonb(i)||jsonb_build_object('release_id',release_id_new))).*
    FROM public.release_items i WHERE release_id=plan.target_release_id;
  INSERT INTO content_intake.release_catalogs(release_id,format_version) VALUES(release_id_new,'intake-v2.1');
  INSERT INTO content_intake.release_lineage SELECT release_id_new,source_id,business_entry_id,script_version,candidate_id,candidate_version,
    review_request_id,content_valid_until FROM content_intake.release_lineage WHERE release_id=plan.target_release_id;
  UPDATE public.content_current SET current_release_id=release_id_new,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.announcements(announcement_id,release_id,title,summary)
    VALUES(announcement_id_new,release_id_new,'资料纠正回退','恢复已审核的上一发布版本 '||plan.target_release_id);
  INSERT INTO content_intake.publications(rollback_plan_id,actor_id,action,operation_id,release_id,announcement_id)
    VALUES(plan.rollback_plan_id,p_actor,'rollback',p_request->>'operationId',release_id_new,announcement_id_new);
  UPDATE content_intake.write_attempts SET state='published' WHERE actor_id=p_actor AND action='rollback' AND operation_id=p_request->>'operationId';
  UPDATE content_intake.commit_tickets SET consumed_at=clock_timestamp() WHERE ticket_hash=ticket;
  RETURN jsonb_build_object('receipt',jsonb_build_object('operationId',p_request->>'operationId','rollbackPlanId',plan.rollback_plan_id,
    'action','rollback','state','published','releaseId',release_id_new,'announcementId',announcement_id_new,'reason',NULL),'validUntil',deadline);
END $$;
REVOKE ALL ON content_intake.release_rollback_lineage FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
REVOKE ALL ON FUNCTION content_intake.inherit_rollback_reviews(),content_intake.preview_rollback(TEXT,TEXT,TEXT),content_intake.execute_rollback(TEXT,JSONB,JSONB)
  FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;

-- Existing non-login legacy definer receives only this narrow read needed to
-- close an old publisher path; no application role receives any new access.
GRANT SELECT ON content_intake.release_rollback_lineage TO cs_ai_definer;
CREATE OR REPLACE FUNCTION content_intake.inherit_legacy_catalog(p_previous TEXT, p_next TEXT) RETURNS VOID
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
  -- The legacy path has no rollback-review observation or deadline owner.
  -- Refuse inheritance rather than dropping that independent approval.
  IF EXISTS(SELECT 1 FROM content_intake.release_rollback_lineage WHERE release_id=p_previous) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='legacy publisher cannot inherit rollback approval',DETAIL='CONFLICT';
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
      candidate_id,candidate_version,review_request_id,content_valid_until)
    SELECT p_next,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until
      FROM content_intake.release_lineage WHERE release_id=p_previous;
END;
$$;
