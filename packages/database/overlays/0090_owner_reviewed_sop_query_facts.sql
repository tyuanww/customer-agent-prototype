ALTER TABLE content_intake.sop_query_fact_versions
  DROP CONSTRAINT sop_query_fact_versions_source_ref_check;
ALTER TABLE content_intake.sop_query_fact_versions
  ADD CONSTRAINT sop_query_fact_versions_source_ref_check CHECK (
    char_length(source_ref)<=512 AND (source_ref LIKE 'synthetic:%'
      OR source_ref ~ '^owner-reviewed-file:[0-9a-f]{64}$'));

CREATE TABLE content_intake.sop_query_owner_reviews (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  facts_version content_intake.version NOT NULL,
  original_sha256 content_intake.sha256 NOT NULL,
  artifact_sha256 content_intake.sha256 NOT NULL,
  reviewed_by content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  source_text text NOT NULL CHECK (octet_length(source_text) BETWEEN 2 AND 1048576),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id,facts_version),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,facts_version)
    REFERENCES content_intake.sop_query_fact_versions
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_owner_reviews
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();

CREATE FUNCTION content_intake.write_owner_reviewed_sop_query_facts(p_actor text,p_operation text,p_request jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE review jsonb; d jsonb; graph record; who record; prior record; current_version bigint; result_version bigint;
  body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex');
  permission jsonb; publication_facts jsonb; source_ref text;
BEGIN
  PERFORM backend_review.lock_content();
  IF NOT p_request ?& ARRAY['sourceText','sourceVersion','sourceSha256','expectedVersion']
    OR p_request-ARRAY['sourceText','sourceVersion','sourceSha256','expectedVersion']<>'{}'::jsonb
    OR jsonb_typeof(p_request->'sourceText') IS DISTINCT FROM 'string'
    OR octet_length(p_request->>'sourceText') NOT BETWEEN 2 AND 1048576
    OR coalesce(p_request->>'sourceVersion','') !~ '^[A-Za-z0-9._:-]{1,128}$'
    OR coalesce(p_request->>'sourceSha256','') IS DISTINCT FROM encode(public.digest(convert_to(p_request->>'sourceText','UTF8'),'sha256'),'hex')
    OR coalesce(p_request->>'expectedVersion','') !~ '^(0|[1-9][0-9]*)$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='FILE_INVALID';
  END IF;
  review:=(p_request->>'sourceText')::jsonb;
  d:=review->'document';
  IF NOT review ?& ARRAY['kind','originalSha256','artifactSha256','reviewedByPrincipalId','document']
    OR review-ARRAY['kind','originalSha256','artifactSha256','reviewedByPrincipalId','document']<>'{}'::jsonb
    OR review->>'kind' IS DISTINCT FROM 'owner-reviewed-file'
    OR coalesce(review->>'originalSha256','') !~ '^[0-9a-f]{64}$'
    OR coalesce(review->>'artifactSha256','') !~ '^[0-9a-f]{64}$'
    OR review->>'reviewedByPrincipalId' IS DISTINCT FROM p_actor
    OR NOT d ?& ARRAY['candidateId','candidateVersion','sourceId','flowId','graphDigest','sopGroup','permissions']
    OR d-ARRAY['candidateId','candidateVersion','sourceId','flowId','graphDigest','sopGroup','permissions']<>'{}'::jsonb
    OR jsonb_typeof(d->'permissions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='FILE_INVALID';
  END IF;
  source_ref:='owner-reviewed-file:'||(review->>'originalSha256');
  SELECT p.* INTO who FROM content_intake.principals p
    JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
    JOIN backend_identity.subject_bindings b USING(user_id)
    WHERE p.principal_id=p_actor AND f.enabled AND b.enabled
      AND f.checked_at<=clock_timestamp() AND f.valid_until>clock_timestamp()
      AND ARRAY(SELECT DISTINCT r.role FROM content_intake.role_rules r WHERE r.tenant_id=p.tenant_id
        AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids))=ARRAY['director']::text[];
  SELECT g.*,s.scope_id INTO graph FROM content_intake.sop_graph_versions g
    JOIN content_intake.sources s USING(source_id)
    JOIN content_intake.publications p USING(candidate_id,candidate_version)
    WHERE g.candidate_id=d->>'candidateId' AND g.candidate_version=(d->>'candidateVersion')::bigint
      AND g.source_id=d->>'sourceId' AND g.flow_id=d->>'flowId' AND g.graph_digest=d->>'graphDigest';
  IF who.principal_id IS NULL OR graph.candidate_id IS NULL
    OR content_intake.authorization_deadline(p_actor,'import',graph.scope_id,graph.source_id,clock_timestamp()) IS NULL
    OR content_intake.authorization_deadline(p_actor,'source-confirm',graph.scope_id,graph.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  publication_facts:=content_intake.sop_query_publication_facts(graph.candidate_id,graph.candidate_version,
    graph.source_id,graph.flow_id,graph.graph_digest);
  IF publication_facts#>>'{sourceClaim,fileSha256}' IS DISTINCT FROM review->>'artifactSha256'
    OR publication_facts#>>'{confirmation,objectSha256}' IS DISTINCT FROM review->>'artifactSha256' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH';
  END IF;
  SELECT * INTO prior FROM backend_review.receipts WHERE actor_user_id=who.user_id
    AND operation='intake:owner-reviewed-sop-query-facts' AND request_key=p_operation;
  IF FOUND THEN
    IF prior.request_hash<>body_hash THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    RETURN (prior.response#>>'{}')::bigint;
  END IF;
  IF jsonb_array_length(d->'permissions')<>jsonb_array_length(graph.graph_payload->'entries')
    OR (SELECT count(DISTINCT public.jsonb_jcs(value->'entry')) FROM jsonb_array_elements(d->'permissions'))<>jsonb_array_length(d->'permissions') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID';
  END IF;
  FOR permission IN SELECT value FROM jsonb_array_elements(d->'permissions') LOOP
    IF NOT permission ?& ARRAY['entry','risk_level','copy_allowed','source_ref']
      OR permission-ARRAY['entry','risk_level','copy_allowed','source_ref']<>'{}'::jsonb
      OR coalesce(permission->>'risk_level','') NOT IN ('unclassified','low','medium','high','critical')
      OR coalesce(jsonb_typeof(permission->'copy_allowed'),'') NOT IN ('boolean','null')
      OR permission->>'source_ref' IS DISTINCT FROM source_ref||'@'||(p_request->>'sourceVersion')||'#'||(permission#>>'{entry,businessEntryId}')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') entry
        WHERE permission->'entry'=jsonb_build_object('sourceId',entry->>'sourceId',
          'businessEntryId',entry#>>'{entry,businessEntryId}','scriptVersion',entry#>'{entry,scriptVersion}')) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID';
    END IF;
  END LOOP;
  SELECT coalesce(max(facts_version),0) INTO current_version FROM content_intake.sop_query_fact_versions
    WHERE candidate_id=graph.candidate_id AND candidate_version=graph.candidate_version
      AND source_id=graph.source_id AND flow_id=graph.flow_id;
  IF current_version IS DISTINCT FROM (p_request->>'expectedVersion')::bigint THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
  result_version:=current_version+1;
  INSERT INTO content_intake.sop_query_fact_versions(candidate_id,candidate_version,source_id,flow_id,graph_digest,
    facts_version,source_ref,source_version,source_sha256,sop_group,permissions,publication_facts,recorded_by)
    VALUES(graph.candidate_id,graph.candidate_version,graph.source_id,graph.flow_id,graph.graph_digest,result_version,
      source_ref,p_request->>'sourceVersion',p_request->>'sourceSha256',d->>'sopGroup',d->'permissions',publication_facts,p_actor);
  INSERT INTO content_intake.sop_query_owner_reviews(candidate_id,candidate_version,source_id,flow_id,facts_version,
    original_sha256,artifact_sha256,reviewed_by,source_text)
    VALUES(graph.candidate_id,graph.candidate_version,graph.source_id,graph.flow_id,result_version,
      review->>'originalSha256',review->>'artifactSha256',p_actor,p_request->>'sourceText');
  INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response)
    VALUES(who.user_id,'intake:owner-reviewed-sop-query-facts',p_operation,body_hash,to_jsonb(result_version));
  RETURN result_version;
END $$;

ALTER TABLE content_intake.sop_query_owner_reviews OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON TABLE content_intake.sop_query_owner_reviews FROM PUBLIC,app_runtime,intake_business,intake_usage,intake_worker;
ALTER FUNCTION content_intake.write_owner_reviewed_sop_query_facts(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.write_owner_reviewed_sop_query_facts(text,text,jsonb) FROM PUBLIC,app_runtime,intake_usage,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.write_owner_reviewed_sop_query_facts(text,text,jsonb) TO intake_business;
