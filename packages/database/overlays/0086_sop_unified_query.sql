-- FINAL-005-C normal query implementation over the frozen normal 85 chain.
-- Exact transport cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f.
-- No legacy 0084_sop_query candidate objects are installed here.
CREATE TABLE content_intake.sop_query_fact_versions (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  facts_version content_intake.version NOT NULL,
  source_ref text NOT NULL CHECK (source_ref LIKE 'synthetic:%' AND char_length(source_ref)<=512),
  source_version text NOT NULL CHECK (source_version ~ '\S' AND char_length(source_version)<=128),
  source_sha256 content_intake.sha256 NOT NULL,
  sop_group text NOT NULL CHECK (sop_group IN ('过敏流程SOP','长痘痘SOP','品质售后SOP','少错破SOP','税收相关规则')),
  permissions jsonb NOT NULL CHECK (jsonb_typeof(permissions)='array' AND jsonb_array_length(permissions)<=4096),
  publication_facts jsonb NOT NULL CHECK (jsonb_typeof(publication_facts)='object'),
  recorded_by content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id,facts_version),
  UNIQUE (source_ref,source_version),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version)
    REFERENCES content_intake.publications(candidate_id,candidate_version)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_fact_versions
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();

-- The receipt remains in backend_review.receipts. This row only binds its
-- independently issued SOP lease to the original entitlement and fact version.
CREATE TABLE content_intake.sop_unified_query_bindings (
  lease_id text PRIMARY KEY REFERENCES content_intake.sop_query_leases,
  principal_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  session_hash content_intake.sha256 NOT NULL REFERENCES backend_identity.sessions(token_hash),
  entitlement_hash content_intake.sha256 NOT NULL REFERENCES content_intake.entitlements,
  authority_binding content_intake.sha256 NOT NULL,
  candidate_id content_intake.identifier,
  candidate_version content_intake.version,
  source_id content_intake.identifier,
  flow_id content_intake.identifier,
  facts_version content_intake.version,
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,facts_version)
    REFERENCES content_intake.sop_query_fact_versions,
  CHECK ((candidate_id IS NULL AND candidate_version IS NULL AND source_id IS NULL AND flow_id IS NULL AND facts_version IS NULL)
    OR (candidate_id IS NOT NULL AND candidate_version IS NOT NULL AND source_id IS NOT NULL AND flow_id IS NOT NULL AND facts_version IS NOT NULL))
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_unified_query_bindings
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();
CREATE TABLE content_intake.sop_query_previews (
  handle_hash content_intake.sha256 PRIMARY KEY,
  lease_id text NOT NULL REFERENCES content_intake.sop_unified_query_bindings,
  binding jsonb NOT NULL CHECK (jsonb_typeof(binding)='object'),
  expires_at timestamptz NOT NULL CHECK (isfinite(expires_at))
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_previews
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();

-- Private provenance projection shared by annotation write/read. Every origin
-- is taken from the candidate and mapping version of the original publication.
CREATE FUNCTION content_intake.sop_query_publication_facts(p_candidate text,p_version bigint,p_source text,p_flow text,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE original record;
BEGIN
  SELECT c.digest,c.source_version,c.material,c.file_sha256,p.release_id,m.template_version,m.rule_version,
    m.mapping_version,m.structure_digest,m.graph_mapping,
    confirmation.evidence_version,confirmation.version_kind,confirmation.version_value,
    confirmation.acquisition,confirmation.object_sha256 INTO original
    FROM content_intake.sop_graph_versions g
    JOIN content_intake.candidate_versions c ON c.candidate_id=g.candidate_id AND c.version=g.candidate_version
    JOIN content_intake.publications p ON p.candidate_id=c.candidate_id AND p.candidate_version=c.version
    JOIN content_intake.source_mappings m ON m.source_id=c.source_id AND m.version=c.source_version
    JOIN content_intake.source_confirmations confirmation ON confirmation.candidate_id=c.candidate_id
      AND confirmation.candidate_version=c.version AND confirmation.source_id=c.source_id
      AND confirmation.evidence_version=c.source_evidence_version AND confirmation.candidate_digest=c.digest
      AND confirmation.object_sha256=c.file_sha256
    WHERE g.candidate_id=p_candidate AND g.candidate_version=p_version AND g.source_id=p_source
      AND g.flow_id=p_flow AND g.graph_digest=p_digest AND c.state='published';
  IF original.release_id IS NULL OR original.material->>'canonicalEncodingVersion' IS DISTINCT FROM 'candidate-sop-task-graph-v2'
    OR original.material->>'sourceVersion' IS DISTINCT FROM original.source_version::text
    OR original.material->>'mappingVersion' IS DISTINCT FROM original.mapping_version
    OR original.material->>'templateVersion' IS DISTINCT FROM original.template_version
    OR original.material->>'ruleVersion' IS DISTINCT FROM original.rule_version
    OR original.material#>>'{sourceClaim,fileSha256}' IS DISTINCT FROM original.file_sha256
    OR original.material#>>'{sourceClaim,acquisition}' IS DISTINCT FROM original.acquisition
    OR (original.material->'sourceClaim')-'fileSha256' IS DISTINCT FROM original.graph_mapping->'sourceClaim'
    OR coalesce(original.graph_mapping->>'riskLevel','') NOT IN ('routine','critical')
    OR coalesce(original.material#>>'{risk,level}','') NOT IN ('routine','critical')
    OR (original.graph_mapping->>'riskLevel'='critical' AND original.material#>>'{risk,level}'<>'critical')
    OR coalesce(original.material->>'mappingDigest','') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH';
  END IF;
  RETURN jsonb_build_object('publicationReleaseId',original.release_id,'materialDigest',original.digest,
    'sourceVersion',original.source_version,'mappingDigest',original.material->'mappingDigest',
    'mappingSha256',encode(public.digest(public.jsonb_jcs(jsonb_build_object('version',original.source_version,
      'templateVersion',original.template_version,'ruleVersion',original.rule_version,'mappingVersion',original.mapping_version,
      'structureDigest',original.structure_digest,'graphMapping',original.graph_mapping)),'sha256'),'hex'),
    'sourceClaim',original.material->'sourceClaim','risk',original.material->'risk',
    'confirmation',jsonb_build_object('evidenceVersion',original.evidence_version,'versionKind',original.version_kind,
      'versionValue',original.version_value,'acquisition',original.acquisition,'objectSha256',original.object_sha256));
END $$;
ALTER FUNCTION content_intake.sop_query_publication_facts(text,bigint,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_publication_facts(text,bigint,text,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_usage,intake_worker;

CREATE FUNCTION content_intake.write_sop_query_facts(p_actor text,p_operation text,p_request jsonb) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE d jsonb:=p_request->'document'; graph record; who record; prior record; current_version bigint; result_version bigint;
  body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'); permission jsonb; publication_facts jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT p.* INTO who FROM content_intake.principals p JOIN content_intake.principal_facts f
    ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
    WHERE p.principal_id=p_actor AND f.enabled AND f.checked_at<=clock_timestamp() AND f.valid_until>clock_timestamp();
  SELECT g.*,s.scope_id INTO graph FROM content_intake.sop_graph_versions g
    JOIN content_intake.sources s USING(source_id)
    JOIN content_intake.publications p USING(candidate_id,candidate_version)
    WHERE g.candidate_id=d->>'candidateId' AND g.candidate_version=(d->>'candidateVersion')::bigint
      AND g.source_id=d->>'sourceId' AND g.flow_id=d->>'flowId' AND g.graph_digest=d->>'graphDigest';
  IF who.principal_id IS NULL OR graph.candidate_id IS NULL
    OR content_intake.authorization_deadline(p_actor,'import',graph.scope_id,graph.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  publication_facts:=content_intake.sop_query_publication_facts(graph.candidate_id,graph.candidate_version,
    graph.source_id,graph.flow_id,graph.graph_digest);
  SELECT * INTO prior FROM backend_review.receipts WHERE actor_user_id=who.user_id
    AND operation='intake:sop-query-facts' AND request_key=p_operation;
  IF FOUND THEN
    IF prior.request_hash<>body_hash THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    RETURN (prior.response#>>'{}')::bigint;
  END IF;
  IF NOT p_request ?& ARRAY['document','sourceRef','sourceVersion','sourceSha256','expectedVersion']
    OR NOT d ?& ARRAY['candidateId','candidateVersion','sourceId','flowId','graphDigest','sopGroup','permissions']
    OR p_request-ARRAY['document','sourceRef','sourceVersion','sourceSha256','expectedVersion']<>'{}'::jsonb
    OR d-ARRAY['candidateId','candidateVersion','sourceId','flowId','graphDigest','sopGroup','permissions']<>'{}'::jsonb
    OR p_request->>'sourceRef' !~ '^synthetic:[A-Za-z0-9._:-]+$' OR length(p_request->>'sourceRef')>512
    OR p_request->>'sourceVersion' !~ '^[A-Za-z0-9._:-]+$' OR length(p_request->>'sourceVersion')>128
    OR p_request->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(d->'permissions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='FILE_INVALID';
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
      OR permission->>'source_ref' IS DISTINCT FROM (p_request->>'sourceRef')||'@'||(p_request->>'sourceVersion')||'#'||(permission#>>'{entry,businessEntryId}')
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
      p_request->>'sourceRef',p_request->>'sourceVersion',p_request->>'sourceSha256',d->>'sopGroup',d->'permissions',publication_facts,p_actor);
  INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response)
    VALUES(who.user_id,'intake:sop-query-facts',p_operation,body_hash,to_jsonb(result_version));
  RETURN result_version;
END $$;

-- One bundle reader is shared by C. D can reuse the fact and graph integrity
-- helpers after its narrow issuer derives the original release from a locked
-- active row. This current-only entry accepts no caller-selected release.
CREATE FUNCTION content_intake.read_sop_unified_query_bundle(p_actor text,p_entitlement text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_graphs jsonb; result jsonb; pinned content_intake.sop_unified_query_bindings%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement
    AND principal_id=p_actor AND contract_view='graph') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  current_graphs:=content_intake.read_sop_graph_current(p_actor,p_entitlement);
  IF p_request IS NOT NULL THEN
    SELECT b.* INTO pinned FROM content_intake.sop_unified_query_bindings b JOIN content_intake.sop_query_leases l USING(lease_id)
      WHERE b.principal_id=p_actor AND b.entitlement_hash=p_entitlement AND l.request_id=p_request;
    IF pinned.lease_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('graphDigest',item->'graphDigest',
    'payload',original.graph_payload,'selectedMedia',item#>'{payload,media}','facts',
    CASE WHEN facts.facts_version IS NULL THEN NULL ELSE jsonb_build_object(
      'version',facts.facts_version,'sopGroup',facts.sop_group,'permissions',facts.permissions,
      'candidateId',lineage.candidate_id,'candidateVersion',lineage.candidate_version,
      'publicationFacts',CASE WHEN facts.publication_facts=content_intake.sop_query_publication_facts(
        facts.candidate_id,facts.candidate_version,facts.source_id,facts.flow_id,facts.graph_digest)
        THEN facts.publication_facts ELSE NULL END) END)),'[]'::jsonb)
    INTO result FROM jsonb_array_elements(current_graphs->'graphs') item
    JOIN content_intake.sop_graph_release_lineage lineage
      ON lineage.release_id=(SELECT release_id FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement)
      AND lineage.source_id=item#>>'{payload,definition,header,key,sourceId}'
      AND lineage.flow_id=item#>>'{payload,definition,header,key,flowId}' AND lineage.graph_digest=item->>'graphDigest'
    JOIN content_intake.sop_graph_versions original USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    LEFT JOIN LATERAL (SELECT f.* FROM content_intake.sop_query_fact_versions f
      WHERE f.candidate_id=lineage.candidate_id AND f.candidate_version=lineage.candidate_version
        AND f.source_id=lineage.source_id AND f.flow_id=lineage.flow_id AND f.graph_digest=lineage.graph_digest
        AND (p_request IS NULL OR f.facts_version=pinned.facts_version)
      ORDER BY f.facts_version DESC LIMIT 1) facts ON true
    WHERE p_request IS NULL OR (lineage.source_id=pinned.source_id AND lineage.flow_id=pinned.flow_id);
  RETURN jsonb_build_object('graphs',result,'validUntil',current_graphs->'validUntil');
END $$;

CREATE FUNCTION content_intake.replay_sop_unified_query(p_actor text,p_session text,p_request jsonb,p_authority text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who record; receipt record; lease record; body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex');
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  SELECT * INTO receipt FROM backend_review.receipts WHERE actor_user_id=who.user_id
    AND operation='intake:sop-query-v11' AND request_key=(p_request->>'request_id')::uuid::text;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF receipt.request_hash<>body_hash THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
  IF receipt.response->>'status' IN ('blocked','stale') THEN RETURN receipt.response; END IF;
  SELECT l.*,b.session_hash,b.authority_binding INTO lease FROM content_intake.sop_query_leases l
    JOIN content_intake.sop_unified_query_bindings b USING(lease_id)
    WHERE b.principal_id=p_actor AND l.request_id=(p_request->>'request_id')::uuid
      AND l.request_hash=body_hash;
  IF lease.lease_id IS NULL OR lease.session_hash IS DISTINCT FROM p_session
    OR lease.authority_binding IS DISTINCT FROM p_authority
    OR lease.session_epoch<>who.revocation_generation THEN
    RETURN jsonb_build_object('status','stale','request_id',p_request->>'request_id','release_id',NULL,
      'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code','SCOPE_DENIED')));
  END IF;
  IF lease.release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1)
    OR lease.expires_at<=clock_timestamp() THEN
    RETURN jsonb_build_object('status','stale','request_id',p_request->>'request_id','release_id',lease.release_id,
      'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code',
        CASE WHEN lease.expires_at<=clock_timestamp() THEN 'LEASE_EXPIRED' ELSE 'STALE_RELEASE' END)));
  END IF;
  PERFORM content_intake.read_sop_graph_deadline(p_actor,lease.release_id);
  RETURN receipt.response;
END $$;

-- Descriptor resolution grants no authority. C supplies the current entitled
-- release after its scope check. D must derive a historical release from its
-- locked active row and perform its own live-authorization check first.
CREATE FUNCTION content_intake.sop_query_media_descriptor(p_release text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object('objectId',object.payload_object_id) INTO result
    FROM content_intake.sop_graph_release_media projected
    JOIN content_intake.sop_graph_media_bindings binding
      USING(candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id)
    JOIN content_intake.sop_graph_versions graph USING(candidate_id,candidate_version,source_id,flow_id)
    JOIN content_intake.sop_media_objects object ON object.media_object_id=binding.object_id
    JOIN content_intake.objects payload ON payload.object_id=object.payload_object_id
    JOIN content_intake.object_reservations reservation ON reservation.object_id=payload.object_id
    WHERE projected.release_id=p_release AND projected.source_id=p_binding#>>'{flowKey,sourceId}'
      AND projected.flow_id=p_binding#>>'{flowKey,flowId}' AND binding.flow_version=(p_binding#>>'{flowKey,flowVersion}')::bigint
      AND projected.owner_kind=CASE WHEN p_binding ? 'entry' THEN 'entry' ELSE p_binding#>>'{graphTarget,kind}' END
      AND projected.owner_id=CASE WHEN p_binding ? 'entry' THEN p_binding#>>'{entry,businessEntryId}' ELSE p_binding#>>'{graphTarget,id}' END
      AND projected.resource_id=p_binding->>'resourceId' AND projected.object_id=p_binding->>'objectId'
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'media') media WHERE media=p_binding)
      AND object.source_id=projected.source_id AND object.state<>'discarded' AND reservation.state='adopted'
      AND payload.sha256=binding.sha256 AND payload.bytes=binding.bytes AND payload.mime=binding.mime;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MEDIA_UNAVAILABLE'; END IF;
  RETURN result;
END $$;
ALTER FUNCTION content_intake.sop_query_media_descriptor(text,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_media_descriptor(text,jsonb)
  FROM PUBLIC,app_runtime,intake_business,intake_usage,intake_worker;

CREATE FUNCTION content_intake.read_sop_query_media(p_actor text,p_entitlement text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE bundle jsonb; result jsonb;
BEGIN
  bundle:=content_intake.read_sop_graph_current(p_actor,p_entitlement);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(bundle->'graphs') graph
    CROSS JOIN LATERAL jsonb_array_elements(graph#>'{payload,media}') media WHERE media=p_binding) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  result:=content_intake.sop_query_media_descriptor(
    (SELECT release_id FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement),p_binding);
  RETURN result;
END $$;

CREATE FUNCTION content_intake.complete_sop_unified_query(p_actor text,p_entitlement text,p_request jsonb,p_authority text,
  p_response jsonb,p_facts jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entitlement record; graph jsonb; facts content_intake.sop_query_fact_versions%ROWTYPE; media jsonb; lease content_intake.sop_query_leases;
  body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex');
  actor_binding text; deadline timestamptz; receipt record; session_hash text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT e.*,context.session_token_hash,l.client_id INTO entitlement FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts context USING(entitlement_hash)
    JOIN public.snapshot_offline_leases l USING(lease_token_hash)
    WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.valid_until>clock_timestamp()
      AND e.sop_continuation_hash IS NULL AND e.contract_view='graph' AND l.expires_at>clock_timestamp();
  IF entitlement.entitlement_hash IS NULL OR entitlement.client_id IS DISTINCT FROM 'intake:'||p_authority
    OR entitlement.shop_id IS DISTINCT FROM p_request->>'shop_id' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  session_hash:=entitlement.session_token_hash;
  PERFORM intake_runtime.lock_product_session(session_hash,entitlement.user_id);
  graph:=content_intake.read_sop_graph_current(p_actor,p_entitlement);
  IF entitlement.release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_RELEASE_CHANGED';
  END IF;
  IF octet_length(public.jsonb_jcs(p_response))>1048576 OR p_response->>'request_id' IS DISTINCT FROM p_request->>'request_id'
    OR p_response->>'status' NOT IN ('ready','blocked','stale','no_match') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='FILE_INVALID';
  END IF;
  SELECT * INTO receipt FROM backend_review.receipts WHERE actor_user_id=entitlement.user_id
    AND operation='intake:sop-query-v11' AND request_key=(p_request->>'request_id')::uuid::text;
  IF FOUND THEN
    IF receipt.request_hash<>body_hash THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
  IF p_response->>'status' IN ('ready','no_match') THEN
    deadline:=(p_response->>'lease_expires_at')::timestamptz;
    IF p_response->>'release_id' IS DISTINCT FROM entitlement.release_id OR deadline>entitlement.valid_until
      OR deadline>clock_timestamp()+interval '5 minutes' OR deadline<=clock_timestamp()
      OR deadline>(graph->>'validUntil')::timestamptz THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='LEASE_EXPIRED';
    END IF;
    IF p_response->>'status'='ready' THEN
      SELECT value INTO graph FROM jsonb_array_elements(graph->'graphs') WHERE
        value#>'{payload,definition}'=p_response#>'{result,flow}' AND value#>'{payload,entries}'=p_response#>'{result,entries}'
        AND value->>'graphDigest'=p_response#>>'{result,graph_digest}';
      IF graph IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
      SELECT * INTO facts FROM content_intake.sop_query_fact_versions f WHERE
        f.candidate_id=p_facts->>'candidateId' AND f.candidate_version=(p_facts->>'candidateVersion')::bigint
        AND f.source_id=p_response#>>'{result,flow,header,key,sourceId}' AND f.flow_id=p_response#>>'{result,flow,header,key,flowId}'
        AND f.facts_version=(p_facts->>'version')::bigint AND f.graph_digest=p_response#>>'{result,graph_digest}'
        AND f.sop_group=p_request->>'sop_group' AND f.permissions=p_response#>'{result,permissions}'
        AND EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage origin
          WHERE origin.release_id=entitlement.release_id AND origin.source_id=f.source_id AND origin.flow_id=f.flow_id
            AND origin.candidate_id=f.candidate_id AND origin.candidate_version=f.candidate_version AND origin.graph_digest=f.graph_digest);
      IF facts.facts_version IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(facts.permissions) permission
        WHERE permission->>'risk_level'='unclassified' OR jsonb_typeof(permission->'copy_allowed')<>'boolean') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
      IF (SELECT coalesce(jsonb_agg(value->'binding' ORDER BY ordinal),'[]'::jsonb)
        FROM jsonb_array_elements(p_response#>'{result,media}') WITH ORDINALITY items(value,ordinal)) IS DISTINCT FROM graph#>'{payload,media}' THEN
        RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MEDIA_UNAVAILABLE';
      END IF;
    END IF;
    actor_binding:=encode(public.digest(public.jsonb_jcs(jsonb_build_array(p_actor,session_hash,
      'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f')),'sha256'),'hex');
    lease:=content_intake.issue_sop_query_lease('sopl_'||encode(public.digest(actor_binding||(p_request->>'request_id'),'sha256'),'hex'),
      actor_binding,entitlement.release_id,(p_request->>'request_id')::uuid,body_hash,p_request->>'context_generation',
      clock_timestamp(),deadline,entitlement.principal_generation);
    INSERT INTO content_intake.sop_unified_query_bindings(lease_id,principal_id,session_hash,entitlement_hash,authority_binding,
      candidate_id,candidate_version,source_id,flow_id,facts_version)
      VALUES(lease.lease_id,p_actor,session_hash,p_entitlement,p_authority,facts.candidate_id,facts.candidate_version,
        facts.source_id,facts.flow_id,facts.facts_version);
    IF p_response->>'status'='ready' THEN
      FOR media IN SELECT value FROM jsonb_array_elements(p_response#>'{result,media}') LOOP
        IF media->>'preview_handle' !~ '^sqp_[0-9a-f]{64}$' OR (media->>'expires_at')::timestamptz>deadline
          OR (media->>'expires_at')::timestamptz<=clock_timestamp() THEN
          RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MEDIA_UNAVAILABLE';
        END IF;
        INSERT INTO content_intake.sop_query_previews VALUES(encode(public.digest(media->>'preview_handle','sha256'),'hex'),
          lease.lease_id,media->'binding',(media->>'expires_at')::timestamptz);
      END LOOP;
    END IF;
  END IF;
  INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response)
    VALUES(entitlement.user_id,'intake:sop-query-v11',(p_request->>'request_id')::uuid::text,body_hash,p_response);
  RETURN p_response;
END $$;

CREATE FUNCTION content_intake.recheck_sop_unified_query(p_actor text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding record; lease record;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT b.*,l.expires_at,l.release_id INTO binding FROM content_intake.sop_unified_query_bindings b
    JOIN content_intake.sop_query_leases l USING(lease_id) WHERE b.principal_id=p_actor AND l.request_id=p_request;
  IF binding.lease_id IS NULL OR binding.expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='LEASE_EXPIRED'; END IF;
  -- C's original entitlement is current-only. D never calls this as a generic
  -- historical issuer, and owns active-use reauthorization separately.
  RETURN jsonb_build_object('entitlementHash',binding.entitlement_hash,
    'bundle',content_intake.read_sop_unified_query_bundle(p_actor,binding.entitlement_hash,p_request));
END $$;

-- All new table access remains behind the restricted owner.
DO $ownership$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['sop_query_fact_versions','sop_unified_query_bindings','sop_query_previews'] LOOP
    EXECUTE format('ALTER TABLE content_intake.%I OWNER TO intake_runtime_fn_owner',name);
    EXECUTE format('REVOKE ALL ON TABLE content_intake.%I FROM PUBLIC,app_runtime,intake_business,intake_usage,intake_worker',name);
  END LOOP;
END $ownership$;
ALTER FUNCTION content_intake.write_sop_query_facts(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_unified_query_bundle(text,text,uuid) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.replay_sop_unified_query(text,text,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.write_sop_query_facts(text,text,jsonb),
  content_intake.read_sop_unified_query_bundle(text,text,uuid),content_intake.replay_sop_unified_query(text,text,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.write_sop_query_facts(text,text,jsonb) TO intake_business;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_unified_query_bundle(text,text,uuid),
  content_intake.replay_sop_unified_query(text,text,jsonb,text) TO intake_usage;

ALTER FUNCTION content_intake.read_sop_query_media(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.recheck_sop_unified_query(text,uuid) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_query_media(text,text,jsonb),
  content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb),content_intake.recheck_sop_unified_query(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_query_media(text,text,jsonb),
  content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb),content_intake.recheck_sop_unified_query(text,uuid) TO intake_usage;
GRANT SELECT,INSERT ON backend_review.receipts TO intake_runtime_fn_owner;
