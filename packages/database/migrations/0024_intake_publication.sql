-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0024_intake_publication; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa
-- source_git_sha=d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713
-- source_schema_sha256=1418537f66274657f8221896387933b4a00a15c23253993541c3bb0ca8964d41
-- Private native-candidate publisher. No application role is granted access.
-- Legacy rows retain their exact contract; native fields remain in candidate
-- material, addressed by release_lineage under the SAME content_current.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.publish_candidate(p_actor TEXT, p_request JSONB, p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  c content_intake.candidate_versions;
  s content_intake.sources;
  k content_intake.scopes;
  a content_intake.principals;
  reviewer content_intake.principals;
  r content_intake.review_bindings;
  f content_intake.approval_facts;
  confirmation content_intake.source_confirmations;
  v_base TEXT;
  v_deadline TIMESTAMPTZ;
  v_actor_until TIMESTAMPTZ;
  v_reviewer_until TIMESTAMPTZ;
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
  PERFORM backend_review.lock_content();
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  SELECT * INTO c FROM content_intake.candidate_versions
    WHERE candidate_id=p_request#>>'{key,candidateId}' AND version=(p_request#>>'{key,version}')::bigint;
  IF NOT FOUND OR c.digest IS DISTINCT FROM p_request#>>'{key,digest}' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
  END IF;
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
    OR EXISTS (SELECT 1 FROM public.release_items WHERE release_id=v_base AND category=k.domain)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(c.material->'entries') e
      WHERE e->>'familySourceId' IS NOT NULL OR e->>'familyBusinessEntryId' IS NOT NULL) THEN
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
  IF c.approval_evidence_version IS DISTINCT FROM (p_request->>'approvalEvidenceVersion')::bigint THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_CHANGED';
  END IF;
  SELECT * INTO r FROM content_intake.review_bindings WHERE candidate_id=c.candidate_id AND candidate_version=c.version
    AND evidence_version=c.approval_evidence_version;
  IF NOT FOUND OR r.candidate_digest<>c.digest THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='AWAITING_APPROVAL'; END IF;
  SELECT facts.* INTO f FROM content_intake.approval_current cur JOIN content_intake.approval_facts facts
    ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version WHERE cur.review_request_id=r.review_request_id;
  IF NOT FOUND OR f.state<>'approved' OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='AWAITING_APPROVAL';
  END IF;
  -- Exact fresh observation, not any earlier cached APPROVED or GET readiness.
  IF p_observation->>'reviewRequestId' IS DISTINCT FROM r.review_request_id::text
    OR (p_observation->>'checkedAt')::timestamptz IS DISTINCT FROM f.checked_at
    OR (p_observation->>'revocationGeneration')::bigint IS DISTINCT FROM f.revocation_generation THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_CHANGED';
  END IF;
  SELECT * INTO reviewer FROM content_intake.principals WHERE principal_id=f.reviewer_id;
  v_reviewer_until := content_intake.authorization_deadline(f.reviewer_id,'review',c.scope_id,c.source_id,clock_timestamp());
  IF v_reviewer_until IS NULL OR NOT EXISTS (SELECT 1 FROM backend_identity.subject_bindings WHERE user_id=reviewer.user_id AND enabled) THEN
    RAISE EXCEPTION USING ERRCODE='ZA005', MESSAGE='PERMISSION_CHANGED';
  END IF;
  IF c.risk='critical' AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(c.material->'contributors') id
    LEFT JOIN content_intake.principals p ON p.principal_id=id
    WHERE p.principal_id IS NULL OR p.identity_scope<>reviewer.identity_scope OR p.person_key=reviewer.person_key) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='HUMAN_REVIEW_REQUIRED';
  END IF;
  IF content_intake.quality_state(c.candidate_id,c.version)<>'passed' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED', DETAIL='QUALITY_NOT_PASSED';
  END IF;
  -- Whole-catalog inheritance must not revive expired/revoked approval facts.
  SELECT min(facts.valid_until) INTO v_inherited_until FROM content_intake.release_lineage l
    JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts facts ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version
    WHERE l.release_id=v_base AND l.source_id<>c.source_id;
  IF EXISTS (SELECT 1 FROM content_intake.release_lineage l
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts facts ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version
    WHERE l.release_id=v_base AND l.source_id<>c.source_id
      AND (facts.state IS DISTINCT FROM 'approved' OR facts.checked_at>clock_timestamp() OR facts.valid_until<=clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_UNAVAILABLE';
  END IF;
  SELECT min(public.owner_acceptance_instant(accepted.record->'expires_at')) INTO v_owner_until
    FROM public.release_items item JOIN public.owner_acceptance_records accepted
      ON accepted.tenant_id=v_tenant AND accepted.record_sha256=item.owner_acceptance_record_sha256
    WHERE item.release_id=v_base AND item.review_mode='owner_acceptance';
  v_deadline := least(f.checked_at+interval '60 seconds',f.valid_until,v_actor_until,v_reviewer_until,v_inherited_until,v_owner_until);
  IF f.checked_at>clock_timestamp() OR v_deadline<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_EXPIRED';
  END IF;
  INSERT INTO content_intake.write_attempts(actor_id,operation_id,action,candidate_id,candidate_version,candidate_digest,
    payload_digest,base_release_id,source_evidence_version,approval_evidence_version,state,created_at)
    VALUES (p_actor,p_request->>'operationId','publish',c.candidate_id,c.version,c.digest,
      encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'),v_base,c.source_evidence_version,c.approval_evidence_version,'pending',clock_timestamp());
  v_ticket := encode(public.digest(public.gen_random_bytes(32),'sha256'),'hex');
  INSERT INTO content_intake.commit_tickets(ticket_hash,actor_id,action,operation_id,candidate_generation,
    actor_facts_version,actor_generation,reviewer_facts_version,reviewer_generation,approval_facts_version,approval_generation,issued_at,expires_at)
    VALUES (v_ticket,p_actor,'publish',p_request->>'operationId',c.revocation_generation,a.current_facts_version,a.revocation_generation,
      reviewer.current_facts_version,reviewer.revocation_generation,f.facts_version,f.revocation_generation,f.checked_at,v_deadline);
  INSERT INTO content_intake.commit_ticket_sources VALUES (v_ticket,c.source_id,s.revocation_generation,s.mode_version,confirmation.revocation_generation);
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
  INSERT INTO content_intake.release_lineage SELECT v_release,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until FROM content_intake.release_lineage
    WHERE release_id=v_base AND source_id<>c.source_id;
  -- Include explicit disables for immutable version history and later re-enable.
  -- Readers filter operation/time; they must never infer deletion from missing rows.
  INSERT INTO content_intake.release_lineage SELECT v_release,c.source_id,e->>'businessEntryId',(e->>'scriptVersion')::bigint,
    c.candidate_id,c.version,r.review_request_id,coalesce((e->>'effectiveTo')::timestamptz,'infinity'::timestamptz)
    FROM jsonb_array_elements(c.material->'entries') e;
  UPDATE public.content_current SET current_release_id=v_release,updated_at=clock_timestamp() WHERE id=1;
  INSERT INTO public.announcements(announcement_id,release_id,title,summary) VALUES (v_announcement,v_release,p_request->>'title',p_request->>'summary');
  INSERT INTO content_intake.publications(candidate_id,candidate_version,actor_id,action,operation_id,release_id,announcement_id)
    VALUES (c.candidate_id,c.version,p_actor,'publish',p_request->>'operationId',v_release,v_announcement);
  UPDATE content_intake.write_attempts SET state='published' WHERE actor_id=p_actor AND action='publish' AND operation_id=p_request->>'operationId';
  UPDATE content_intake.candidate_versions SET state='published',updated_at=clock_timestamp() WHERE candidate_id=c.candidate_id AND version=c.version;
  UPDATE content_intake.commit_tickets SET consumed_at=clock_timestamp() WHERE ticket_hash=v_ticket;
  v_receipt := jsonb_build_object('operationId',p_request->>'operationId','key',p_request->'key','action','publish',
    'state','published','releaseId',v_release,'announcementId',v_announcement,'reason',NULL);
  RETURN jsonb_build_object('receipt',v_receipt,'validUntil',v_deadline);
END;
$$;
REVOKE ALL ON FUNCTION content_intake.publish_candidate(TEXT,JSONB,JSONB) FROM PUBLIC;
