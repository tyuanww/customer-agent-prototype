-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0085_sop_unified_lifecycle; source verified SOP lifecycle implementation; overlay_sha256=e76859e42aea66744005295b4baaf7e4872914e6b1ba2f162d46d2b0c1b16924
-- contract_set_id=cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f
-- source_git_sha=812a2e80584f08675fab8b7401ce8b4cd3ab5bca
-- source_schema_sha256=2ed15384fd2e1d0a4993dfebc40e68980b4ef8f4f1effe172b656f3c3c63cd12
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Normal intake owns the transaction, authority, receipts and current pointer.
-- These private participants own the immutable task graph and its projections.
ALTER TABLE content_intake.source_mappings ADD COLUMN graph_mapping jsonb;
ALTER TABLE content_intake.source_mappings ADD CONSTRAINT source_graph_mapping_shape
  CHECK (graph_mapping IS NULL OR jsonb_typeof(graph_mapping)='object');
ALTER TABLE content_intake.parse_jobs ADD COLUMN contract_view text NOT NULL DEFAULT 'legacy'
  CHECK (contract_view IN ('legacy','graph'));
ALTER TABLE content_intake.entitlements ADD COLUMN contract_view text NOT NULL DEFAULT 'legacy'
  CHECK (contract_view IN ('legacy','graph'));
ALTER TABLE backend_review.receipts ADD COLUMN contract_view text NOT NULL DEFAULT 'legacy'
  CHECK (contract_view IN ('legacy','graph'));
ALTER TABLE content_intake.release_catalogs ADD COLUMN graph_parent_release_id text REFERENCES content_intake.release_catalogs;
ALTER TABLE content_intake.candidate_versions DROP CONSTRAINT candidate_versions_canonical_encoding_check;
ALTER TABLE content_intake.candidate_versions ADD CONSTRAINT candidate_versions_canonical_encoding_check
  CHECK (canonical_encoding IN ('candidate-p1.1','candidate-sop-task-graph-v2'));
ALTER TABLE content_intake.quality_rounds ADD CONSTRAINT sop_graph_round_attribution UNIQUE(candidate_id,candidate_version,phase,checked_by,recorded_at);
ALTER TABLE content_intake.sop_graph_quality_checks ADD CONSTRAINT sop_graph_check_attribution
  FOREIGN KEY(candidate_id,candidate_version,phase,reviewer_id,checked_at)
  REFERENCES content_intake.quality_rounds(candidate_id,candidate_version,phase,checked_by,recorded_at) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION content_intake.assert_sop_graph_payload(p_graph jsonb,p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE definition_value jsonb:=p_graph->'definition'; header_value jsonb:=definition_value->'header'; node_value jsonb; media_value jsonb;
  outbound jsonb; reached text[]; refs jsonb; owner text; expected jsonb;
BEGIN
  IF jsonb_typeof(p_graph) IS DISTINCT FROM 'object' OR p_graph-ARRAY['definition','entries','media']<>'{}'::jsonb
    OR NOT p_graph ?& ARRAY['definition','entries','media']
    OR header_value#>>'{key,sourceId}' IS DISTINCT FROM p_source
    OR jsonb_typeof(definition_value->'nodes') IS DISTINCT FROM 'array' OR jsonb_array_length(definition_value->'nodes') NOT BETWEEN 1 AND 128
    OR jsonb_typeof(definition_value->'edges') IS DISTINCT FROM 'array' OR jsonb_array_length(definition_value->'edges')>512
    OR jsonb_typeof(p_graph->'entries') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_graph->'media') IS DISTINCT FROM 'array'
    OR octet_length(public.jsonb_jcs(definition_value))>524288
    OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(definition_value->'nodes') x)<>jsonb_array_length(definition_value->'nodes')
    OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(definition_value->'edges') x)<>jsonb_array_length(definition_value->'edges') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
  END IF;
  FOR node_value IN SELECT x FROM jsonb_array_elements(definition_value->'nodes') x LOOP
    SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO outbound FROM jsonb_array_elements(definition_value->'edges') x WHERE x->>'from'=node_value->>'id';
    IF node_value->'key' IS DISTINCT FROM header_value->'key' OR node_value#>>'{body,kind}' NOT IN ('action','decision','terminal')
      OR (header_value->>'audience'='agent' AND node_value#>>'{body,audience}' IS DISTINCT FROM 'agent')
      OR (node_value#>>'{body,kind}'='terminal' AND jsonb_array_length(outbound)<>0)
      OR (node_value#>>'{body,kind}'='action' AND (jsonb_array_length(outbound)<>1 OR outbound#>>'{0,action,kind}' IS DISTINCT FROM 'next'))
      OR (node_value#>>'{body,kind}'='decision' AND (jsonb_array_length(outbound) NOT BETWEEN 2 AND 4
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(outbound) x WHERE x#>>'{action,kind}' IS DISTINCT FROM 'choice'
          OR btrim(coalesce(x#>>'{action,criterion}',''))='')
        OR (SELECT count(*) FROM jsonb_array_elements(outbound) x WHERE x#>'{action,unableToDetermine}'='true')<>1
        OR (SELECT count(DISTINCT x#>>'{action,label}') FROM jsonb_array_elements(outbound) x)<>jsonb_array_length(outbound)
        OR (SELECT array_agg((x#>>'{action,ordinal}')::integer ORDER BY (x#>>'{action,ordinal}')::integer) FROM jsonb_array_elements(outbound) x)
          IS DISTINCT FROM ARRAY(SELECT generate_series(1,jsonb_array_length(outbound)))))
      OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(node_value#>'{body,requirements}') x)<>jsonb_array_length(node_value#>'{body,requirements}')
      OR (SELECT coalesce(array_agg((x->>'ordinal')::integer ORDER BY (x->>'ordinal')::integer),'{}') FROM jsonb_array_elements(node_value#>'{body,requirements}') x)
        IS DISTINCT FROM ARRAY(SELECT generate_series(1,jsonb_array_length(node_value#>'{body,requirements}')))
      OR (SELECT count(DISTINCT x->'entry') FROM jsonb_array_elements(node_value#>'{body,scripts}') x)<>jsonb_array_length(node_value#>'{body,scripts}')
      OR (header_value->>'audience'='agent' AND EXISTS(SELECT 1 FROM jsonb_array_elements(node_value#>'{body,knowledge}') x WHERE x->>'audience'<>'agent'))
      OR (((node_value#>>'{body,title}')||(node_value#>>'{body,instruction}')) LIKE '%过敏%'
        AND (node_value#>>'{body,instruction}' NOT LIKE '%停手%' OR node_value#>>'{body,instruction}' NOT LIKE '%确认%')) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
    END IF;
  END LOOP;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') x WHERE x->>'id'=header_value->>'startNodeId')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'edges') edge WHERE edge->'key' IS DISTINCT FROM header_value->'key'
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') task_row WHERE task_row->>'id'=edge->>'from')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') task_row WHERE task_row->>'id'=edge->>'to')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
  END IF;
  IF EXISTS(WITH RECURSIVE reach(origin,id) AS (
    SELECT edge->>'from',edge->>'to' FROM jsonb_array_elements(definition_value->'edges') edge
    UNION SELECT reach.origin,edge->>'to' FROM reach CROSS JOIN LATERAL jsonb_array_elements(definition_value->'edges') edge WHERE edge->>'from'=reach.id)
    SELECT 1 FROM reach WHERE origin=id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
  END IF;
  WITH RECURSIVE nodes(id) AS (SELECT header_value->>'startNodeId' UNION SELECT edge->>'to'
    FROM nodes CROSS JOIN LATERAL jsonb_array_elements(definition_value->'edges') edge WHERE edge->>'from'=nodes.id)
    SELECT array_agg(id) INTO reached FROM nodes;
  IF cardinality(reached)<>jsonb_array_length(definition_value->'nodes') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID'; END IF;
  SELECT coalesce(jsonb_agg(ref ORDER BY ref->>'sourceId' COLLATE "C",ref->>'businessEntryId' COLLATE "C",(ref->>'scriptVersion')::bigint),'[]'::jsonb)
    INTO refs FROM (SELECT DISTINCT x->'entry' ref FROM jsonb_array_elements(definition_value->'nodes') task_row CROSS JOIN LATERAL jsonb_array_elements(task_row#>'{body,scripts}') x
      UNION SELECT header_value->'anchorEntry' WHERE header_value->'anchorEntry'<>'null'::jsonb) unique_refs;
  SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',x->>'sourceId','businessEntryId',x#>>'{entry,businessEntryId}',
    'scriptVersion',(x#>>'{entry,scriptVersion}')::bigint) ORDER BY x->>'sourceId' COLLATE "C",x#>>'{entry,businessEntryId}' COLLATE "C",(x#>>'{entry,scriptVersion}')::bigint),'[]'::jsonb)
    INTO expected FROM jsonb_array_elements(p_graph->'entries') x;
  IF refs IS DISTINCT FROM expected OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_graph->'entries') x
    WHERE x->>'sourceId'<>p_source OR x#>>'{entry,operation}'<>'upsert' OR x->'entry' ?| ARRAY['internalNote','attachmentNote']
      OR NOT content_intake.sop_graph_applicability_within(x->'entry',header_value->'applicability')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') task_row CROSS JOIN LATERAL jsonb_array_elements(task_row#>'{body,knowledge}') k
    GROUP BY k->>'id' HAVING count(DISTINCT k-ARRAY['resourceBinding'])>1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID';
  END IF;
  FOR media_value IN SELECT x FROM jsonb_array_elements(p_graph->'media') x LOOP
    owner:=coalesce(media_value#>>'{entry,businessEntryId}',media_value#>>'{graphTarget,id}');
    IF media_value->'flowKey' IS DISTINCT FROM header_value->'key' OR (header_value->>'audience'='agent' AND media_value->>'audience'='coach')
      OR NOT content_intake.sop_graph_applicability_within(media_value->'applicability',header_value->'applicability')
      OR ((media_value ? 'entry')=(media_value ? 'graphTarget'))
      OR (media_value ? 'entry' AND (media_value->>'audience'<>'customer' OR NOT refs @> jsonb_build_array(media_value->'entry')))
      OR (media_value#>>'{graphTarget,kind}'='task' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') task_row WHERE task_row->>'id'=owner))
      OR (media_value#>>'{graphTarget,kind}'='knowledge' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(definition_value->'nodes') task_row
        CROSS JOIN LATERAL jsonb_array_elements(task_row#>'{body,knowledge}') k WHERE k->>'id'=owner)) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION content_intake.sop_graph_applicability_within(p_child jsonb,p_parent jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT NOT EXISTS(SELECT 1 FROM unnest(ARRAY['productRefs','scenarioRefs']) dimension
    WHERE jsonb_array_length(p_parent->dimension)>0 AND (jsonb_array_length(p_child->dimension)=0
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_child->dimension) ref WHERE NOT (p_parent->dimension) @> jsonb_build_array(ref))));
$$;
ALTER FUNCTION content_intake.sop_graph_applicability_within(jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_graph_applicability_within(jsonb,jsonb) FROM PUBLIC;

CREATE FUNCTION content_intake.freeze_sop_graph_candidate(p_actor text,p_job text,p_material jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; s content_intake.sources; old content_intake.candidate_versions;
  o content_intake.objects; mapping content_intake.source_mappings; id_new text; version_new bigint;
  flow_value jsonb; graph_value jsonb; media_value jsonb; encoded text; payloads jsonb; v_until timestamptz; mapping_hash text;
  base_graphs jsonb; prior_graph jsonb; before_hash text; after_hash text; ceiling bigint;
  expected_differences jsonb:='[]'::jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO j FROM content_intake.parse_jobs WHERE job_id=p_job FOR UPDATE;
  IF NOT FOUND OR j.actor_id<>p_actor OR j.contract_view<>'graph' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT * INTO STRICT s FROM content_intake.sources WHERE source_id=j.source_id;
  SELECT * INTO STRICT mapping FROM content_intake.source_mappings WHERE source_id=j.source_id AND version=j.source_version;
  v_until:=content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp());
  IF v_until IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  IF s.mode<>'v2-preview' OR s.current_mapping_version<>j.source_version OR mapping.graph_mapping IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  IF coalesce(mapping.graph_mapping->>'riskLevel','') NOT IN ('routine','critical')
    OR (mapping.graph_mapping->>'riskLevel'='critical' AND p_material#>>'{risk,level}'<>'critical') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  IF p_material->'scope' IS DISTINCT FROM (SELECT jsonb_build_object('tenantId',k.tenant_id,'appId',k.app_id,'brandId',k.brand_id,
    'shopId',k.shop_id,'domain',k.domain,'sourceId',s.source_id) FROM content_intake.scopes k WHERE k.scope_id=s.scope_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  encoded:=public.jsonb_jcs(p_material);
  IF j.state='validated' THEN
    SELECT * INTO STRICT old FROM content_intake.candidate_versions WHERE candidate_id=j.result_candidate_id AND version=j.result_candidate_version;
    IF old.canonical_material<>encoded THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    RETURN jsonb_build_object('candidateId',old.candidate_id,'version',old.version);
  END IF;
  IF j.state<>'parsing' OR p_material->>'canonicalEncodingVersion' IS DISTINCT FROM 'candidate-sop-task-graph-v2'
    OR p_material->>'sourceVersion' IS DISTINCT FROM j.source_version::text
    OR p_material->'baseReleaseId' IS DISTINCT FROM coalesce(to_jsonb(j.base_release_id),'null'::jsonb)
    OR (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(p_material->'contributors') x)
      IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x) FROM unnest(j.contributor_ids) x)
    OR jsonb_array_length(p_material->'sopFlows') NOT BETWEEN 1 AND 100
    OR octet_length(encoded)>33554432 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT * INTO STRICT o FROM content_intake.objects WHERE object_id=j.object_id AND source_id=j.source_id AND actor_id=p_actor AND purpose='input';
  IF p_material->'object' IS DISTINCT FROM jsonb_build_object('objectId',o.object_id,'sourceId',o.source_id,'sha256',o.sha256,'bytes',o.bytes,'mime',o.mime)
    OR p_material#>>'{sourceClaim,fileSha256}' IS DISTINCT FROM o.sha256 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF ((p_material->'sourceClaim')-'fileSha256') IS DISTINCT FROM mapping.graph_mapping->'sourceClaim' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  SELECT encode(public.digest(public.jsonb_jcs(jsonb_build_object('mappingVersion',p_material->'mappingVersion','sourceVersion',p_material->'sourceVersion',
    'scope',p_material->'scope','objectSha256',o.sha256,'selectedSheets',p_material->'selectedSheets','flows',p_material->'sopFlows',
    'entryRefs',(SELECT coalesce(jsonb_agg(jsonb_build_object('sourceId',j.source_id,'businessEntryId',e->>'businessEntryId','scriptVersion',e->'scriptVersion')
      ORDER BY e->>'businessEntryId' COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements(p_material->'entries') e), 'media',p_material->'media')),'sha256'),'hex') INTO mapping_hash;
  IF mapping_hash IS DISTINCT FROM p_material->>'mappingDigest' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cs_ai_content_publish'));
  IF j.base_release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED'; END IF;
  base_graphs:=content_intake.read_sop_graph_base(p_actor,j.source_id,j.base_release_id)->'graphs';
  IF j.expected_prior_id IS NOT NULL THEN
    SELECT * INTO old FROM content_intake.candidate_versions WHERE candidate_id=j.expected_prior_id AND version=j.expected_prior_version FOR UPDATE;
    IF NOT FOUND OR old.source_id<>j.source_id OR old.digest<>j.expected_prior_digest OR old.state NOT IN ('awaiting-evidence','ready')
      OR EXISTS(SELECT 1 FROM content_intake.write_attempts WHERE candidate_id=old.candidate_id AND candidate_version=old.version AND state IN ('pending','unknown')) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    id_new:=old.candidate_id; version_new:=old.version+1;
    UPDATE content_intake.candidate_versions SET state='invalidated',revocation_generation=revocation_generation+1,updated_at=clock_timestamp()
      WHERE candidate_id=old.candidate_id AND version=old.version;
  ELSE id_new:='candidate_'||gen_random_uuid()::text; version_new:=1; END IF;
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(DISTINCT jsonb_build_object('mediaObjectId',image_record->>'objectId','payloadObjectId',coalesce(b.object_id,existing.payload_object_id),
    'sha256',image_record->>'sha256','bytes',image_record->'bytes','mime',image_record->>'mime')),'[]'::jsonb)) INTO payloads
    FROM jsonb_array_elements(p_material->'media') image_record LEFT JOIN content_intake.sop_payload_bindings b ON b.job_id=p_job AND b.media_object_id=image_record->>'objectId' LEFT JOIN content_intake.sop_media_objects existing ON existing.media_object_id=image_record->>'objectId';
  payloads:=content_intake.adopt_sop_payloads(p_actor,p_job,payloads);
  INSERT INTO content_intake.candidate_versions(candidate_id,version,source_id,scope_id,source_version,object_id,file_sha256,actor_id,base_release_id,
    canonical_encoding,canonical_material,material,risk,explicit_disable_count,created_at,updated_at,publication_policy)
    VALUES(id_new,version_new,j.source_id,s.scope_id,j.source_version,o.object_id,o.sha256,p_actor,j.base_release_id,'candidate-sop-task-graph-v2',encoded,p_material,
      p_material#>>'{risk,level}',(p_material#>>'{risk,explicitDisableCount}')::integer,clock_timestamp(),clock_timestamp(),'direct-v1');
  FOR flow_value IN SELECT x FROM jsonb_array_elements(p_material->'sopFlows') x LOOP
    IF NOT (mapping.graph_mapping->'flows') ? (flow_value#>>'{header,key,flowId}')
      OR flow_value#>>'{header,audience}' IS DISTINCT FROM mapping.graph_mapping#>>ARRAY['flows',flow_value#>>'{header,key,flowId}','audience']
      OR coalesce(flow_value#>'{header,anchorEntry,businessEntryId}','null'::jsonb)
        IS DISTINCT FROM mapping.graph_mapping#>ARRAY['flows',flow_value#>>'{header,key,flowId}','anchorEntry'] THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
    SELECT jsonb_build_object('definition',flow_value,'entries',coalesce(jsonb_agg(jsonb_build_object('sourceId',j.source_id,
      'entry',(e-ARRAY['internalNote','attachmentNote','questions'])||jsonb_build_object('questions',
        coalesce((SELECT jsonb_agg(q ORDER BY q->>'id' COLLATE "C") FROM jsonb_array_elements(e->'questions') q WHERE q->'active'='true'),'[]'::jsonb)))
      ORDER BY e->>'businessEntryId' COLLATE "C"),'[]'::jsonb),'media',coalesce((SELECT jsonb_agg(image_record ORDER BY ord)
        FROM jsonb_array_elements(p_material->'media') WITH ORDINALITY media(image_record,ord) WHERE image_record->'flowKey'=flow_value#>'{header,key}'),'[]'::jsonb)) INTO graph_value
      FROM jsonb_array_elements(p_material->'entries') e WHERE
        flow_value#>'{header,anchorEntry}'=jsonb_build_object('sourceId',j.source_id,'businessEntryId',e->>'businessEntryId','scriptVersion',e->'scriptVersion')
        OR EXISTS(SELECT 1 FROM jsonb_array_elements(flow_value->'nodes') n CROSS JOIN LATERAL jsonb_array_elements(n#>'{body,scripts}') script
          WHERE script->'entry'=jsonb_build_object('sourceId',j.source_id,'businessEntryId',e->>'businessEntryId','scriptVersion',e->'scriptVersion'));
    PERFORM content_intake.assert_sop_graph_payload(graph_value,j.source_id);
    SELECT x INTO prior_graph FROM jsonb_array_elements(base_graphs) x WHERE x#>>'{definition,header,key,flowId}'=flow_value#>>'{header,key,flowId}';
    before_hash:=CASE WHEN prior_graph IS NULL THEN NULL ELSE encode(public.digest(public.jsonb_jcs(prior_graph),'sha256'),'hex') END;
    after_hash:=encode(public.digest(public.jsonb_jcs(graph_value),'sha256'),'hex');
    IF prior_graph IS NULL AND flow_value#>>'{header,operation}'='disable' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID'; END IF;
    IF before_hash IS DISTINCT FROM after_hash THEN
      SELECT greatest(coalesce(max(v.flow_version),0),coalesce((prior_graph#>>'{definition,header,key,flowVersion}')::bigint,0)) INTO ceiling
        FROM content_intake.sop_graph_versions v JOIN content_intake.publications p ON p.candidate_id=v.candidate_id AND p.candidate_version=v.candidate_version
        WHERE v.source_id=j.source_id AND v.flow_id=flow_value#>>'{header,key,flowId}';
      IF (flow_value#>>'{header,key,flowVersion}')::bigint<>ceiling+1 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
      expected_differences:=expected_differences||jsonb_build_array(jsonb_build_object('sourceId',j.source_id,'flowId',flow_value#>>'{header,key,flowId}',
        'change',CASE WHEN prior_graph IS NULL THEN 'add' WHEN flow_value#>>'{header,operation}'='disable' THEN 'disable'
          WHEN prior_graph#>>'{definition,header,operation}'='disable' THEN 'reenable' ELSE 'modify' END,
        'previousVersion',prior_graph#>'{definition,header,key,flowVersion}','nextVersion',flow_value#>'{header,key,flowVersion}',
        'beforeDigest',before_hash,'afterDigest',after_hash));
    END IF;
    INSERT INTO content_intake.sop_graph_versions(candidate_id,candidate_version,material_digest,source_id,flow_id,flow_version,operation,canonical_graph,graph_payload)
      SELECT id_new,version_new,digest,j.source_id,flow_value#>>'{header,key,flowId}',(flow_value#>>'{header,key,flowVersion}')::bigint,flow_value#>>'{header,operation}',public.jsonb_jcs(graph_value),graph_value
      FROM content_intake.candidate_versions WHERE candidate_id=id_new AND version=version_new;
    FOR media_value IN SELECT x FROM jsonb_array_elements(graph_value->'media') x LOOP
      IF NOT EXISTS(SELECT 1 FROM content_intake.sop_media_objects obj WHERE obj.media_object_id=media_value->>'objectId') THEN
        INSERT INTO content_intake.sop_media_objects(media_object_id,payload_object_id,source_id,actor_id,sha256,bytes,mime,state,created_at)
          SELECT media_value->>'objectId',item->>'payloadObjectId',j.source_id,p_actor,media_value->>'sha256',(media_value->>'bytes')::bigint,media_value->>'mime','staged',clock_timestamp()
          FROM jsonb_array_elements(payloads->'items') item WHERE item->>'mediaObjectId'=media_value->>'objectId';
      END IF;
      INSERT INTO content_intake.sop_graph_media_bindings(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest,
        resource_id,owner_kind,owner_id,entry_script_version,object_id,sha256,mime,bytes,ordinal,alt,required,audience,product_refs,scenario_refs)
        SELECT id_new,version_new,j.source_id,v.flow_id,v.flow_version,v.graph_digest,media_value->>'resourceId',
          CASE WHEN media_value ? 'entry' THEN 'entry' ELSE media_value#>>'{graphTarget,kind}' END,coalesce(media_value#>>'{entry,businessEntryId}',media_value#>>'{graphTarget,id}'),
          (media_value#>>'{entry,scriptVersion}')::bigint,media_value->>'objectId',media_value->>'sha256',media_value->>'mime',(media_value->>'bytes')::bigint,(media_value->>'ordinal')::integer,
          media_value->>'alt',(media_value->>'required')::boolean,media_value->>'audience',media_value#>'{applicability,productRefs}',media_value#>'{applicability,scenarioRefs}'
        FROM content_intake.sop_graph_versions v WHERE v.candidate_id=id_new AND v.candidate_version=version_new AND v.flow_id=flow_value#>>'{header,key,flowId}';
    END LOOP;
  END LOOP;
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'flowId' COLLATE "C"),'[]'::jsonb) INTO expected_differences FROM jsonb_array_elements(expected_differences) x;
  IF expected_differences IS DISTINCT FROM p_material->'sopDifferences' OR EXISTS(SELECT 1 FROM jsonb_array_elements(base_graphs) previous
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_material->'sopFlows') next WHERE next#>>'{header,key,flowId}'=previous#>>'{definition,header,key,flowId}')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_material->'entries') e
    WHERE (e-ARRAY['businessEntryId','scriptVersion','operation','title','answerText'])
      IS DISTINCT FROM mapping.graph_mapping#>ARRAY['entries',e->>'businessEntryId'])
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_material->'media') image_record
      WHERE jsonb_build_object('required',image_record->'required','alt',image_record->'alt','ordinal',image_record->'ordinal')
        IS DISTINCT FROM mapping.graph_mapping#>ARRAY['images',image_record->>'resourceId']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l WHERE l.release_id=j.base_release_id AND l.source_id=j.source_id
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_material->'sopFlows') flow_record WHERE flow_record#>>'{header,key,flowId}'=l.flow_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.candidate_vocabulary(candidate_id,candidate_version,vocabulary_id,display_version)
    SELECT DISTINCT id_new,version_new,ref->>'id',(ref->>'displayVersion')::bigint FROM (
      SELECT e->'productRefs' products,e->'scenarioRefs' scenarios FROM jsonb_array_elements(p_material->'entries') e
      UNION ALL SELECT flow_record#>'{header,applicability,productRefs}',flow_record#>'{header,applicability,scenarioRefs}' FROM jsonb_array_elements(p_material->'sopFlows') flow_record
      UNION ALL SELECT image_record#>'{applicability,productRefs}',image_record#>'{applicability,scenarioRefs}' FROM jsonb_array_elements(p_material->'media') image_record
    ) sets CROSS JOIN LATERAL jsonb_array_elements(sets.products||sets.scenarios) ref;
  IF EXISTS(SELECT 1 FROM content_intake.candidate_vocabulary refs JOIN content_intake.vocabulary v USING(vocabulary_id)
    JOIN content_intake.scopes scope ON scope.scope_id=v.scope_id JOIN content_intake.scopes own ON own.scope_id=s.scope_id
    WHERE refs.candidate_id=id_new AND refs.candidate_version=version_new AND (NOT v.active OR scope.tenant_id<>own.tenant_id
      OR scope.app_id<>own.app_id OR scope.brand_id<>own.brand_id OR scope.domain<>own.domain OR (scope.shop_id IS NOT NULL AND scope.shop_id IS DISTINCT FROM own.shop_id))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  IF EXISTS(WITH applicability AS (
    SELECT e AS value FROM jsonb_array_elements(p_material->'entries') e
    UNION ALL SELECT flow_record#>'{header,applicability}' FROM jsonb_array_elements(p_material->'sopFlows') flow_record
    UNION ALL SELECT image_record->'applicability' FROM jsonb_array_elements(p_material->'media') image_record)
    SELECT 1 FROM applicability a CROSS JOIN LATERAL (VALUES ('product',a.value->'productRefs'),('scenario',a.value->'scenarioRefs')) dimension(kind,refs)
    CROSS JOIN LATERAL jsonb_array_elements(dimension.refs) ref
    LEFT JOIN content_intake.vocabulary v ON v.vocabulary_id=ref->>'id' AND v.kind=dimension.kind
    WHERE v.vocabulary_id IS NULL OR (ref->>'displayVersion')::bigint<>(SELECT max(display_version) FROM content_intake.vocabulary_displays WHERE vocabulary_id=v.vocabulary_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  UPDATE content_intake.parse_jobs SET state='validated',finished_at=clock_timestamp(),result_candidate_id=id_new,result_candidate_version=version_new WHERE job_id=p_job;
  IF v_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  RETURN jsonb_build_object('candidateId',id_new,'version',version_new);
END $$;

CREATE FUNCTION content_intake.assert_sop_graph_release(p_release text,p_pending text DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE l record; deadline timestamptz:='infinity'; bound timestamptz; entry jsonb;
BEGIN
  FOR l IN SELECT lineage.*,v.graph_payload,c.digest,c.file_sha256,c.source_version,c.source_evidence_version,c.state,c.scope_id,
    src.mode,src.current_mapping_version,sc.candidate_digest,sc.object_sha256 FROM content_intake.sop_graph_release_lineage lineage
    JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.candidate_versions c ON c.candidate_id=lineage.candidate_id AND c.version=lineage.candidate_version
    JOIN content_intake.sources src ON src.source_id=lineage.source_id
    LEFT JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version AND sc.evidence_version=c.source_evidence_version
    WHERE lineage.release_id=p_release LOOP
    PERFORM content_intake.assert_sop_graph_payload(l.graph_payload,l.source_id);
    IF l.mode<>'v2-preview' OR l.current_mapping_version<>l.source_version
      OR (l.state<>'published' AND NOT(l.candidate_id=p_pending AND l.state='publishing'))
      OR l.candidate_digest IS DISTINCT FROM l.digest OR l.object_sha256 IS DISTINCT FROM l.file_sha256
      OR content_intake.quality_state(l.candidate_id,l.candidate_version)<>'passed' THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
    IF l.publication_policy='approval-v1' THEN
      SELECT facts.valid_until INTO bound FROM content_intake.review_bindings binding
        JOIN content_intake.approval_current current USING(review_request_id)
        JOIN content_intake.approval_facts facts ON facts.review_request_id=current.review_request_id AND facts.facts_version=current.facts_version
        WHERE binding.review_request_id=l.review_request_id AND binding.candidate_id=l.candidate_id AND binding.candidate_version=l.candidate_version
          AND facts.state='approved' AND facts.checked_at<=clock_timestamp() AND clock_timestamp()<facts.valid_until
          AND facts.package_verified_sha256=binding.package_sha256;
      IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_UNAVAILABLE'; END IF;
      deadline:=least(deadline,bound);
    END IF;
    bound:=(l.graph_payload#>>'{definition,header,effectiveTo}')::timestamptz;
    IF bound>clock_timestamp() THEN deadline:=least(deadline,bound); END IF;
    bound:=(l.graph_payload#>>'{definition,header,effectiveFrom}')::timestamptz;
    IF bound>clock_timestamp() THEN deadline:=least(deadline,bound); END IF;
    FOR entry IN SELECT x FROM jsonb_array_elements(l.graph_payload->'entries') x LOOP
      SELECT min(at) INTO bound FROM (VALUES ((entry#>>'{entry,effectiveFrom}')::timestamptz),
        ((entry#>>'{entry,effectiveTo}')::timestamptz)) limits(at) WHERE at>clock_timestamp();
      IF bound IS NOT NULL THEN deadline:=least(deadline,bound); END IF;
      IF NOT EXISTS(SELECT 1 FROM content_intake.release_lineage dep JOIN content_intake.candidate_versions c
        ON c.candidate_id=dep.candidate_id AND c.version=dep.candidate_version
        CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
        WHERE dep.release_id=p_release AND dep.source_id=l.source_id AND dep.business_entry_id=entry#>>'{entry,businessEntryId}'
          AND dep.script_version=(entry#>>'{entry,scriptVersion}')::bigint AND e->>'businessEntryId'=dep.business_entry_id AND e->>'operation'='upsert'
          AND (e-ARRAY['internalNote','attachmentNote','questions'])=((entry->'entry')-'questions')
          AND coalesce((SELECT jsonb_agg(q ORDER BY q->>'id' COLLATE "C") FROM jsonb_array_elements(e->'questions') q WHERE q->'active'='true'),'[]'::jsonb)=entry#>'{entry,questions}') THEN
        RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
    END LOOP;
    IF (SELECT count(*) FROM content_intake.sop_graph_release_media WHERE release_id=p_release AND source_id=l.source_id AND flow_id=l.flow_id)
      <>jsonb_array_length(l.graph_payload->'media') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MEDIA_UNAVAILABLE'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_release_media rm JOIN content_intake.sop_graph_media_bindings b
    USING(candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id)
    JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id
    LEFT JOIN content_intake.objects payload ON payload.object_id=media.payload_object_id
    LEFT JOIN content_intake.object_reservations reservation ON reservation.object_id=payload.object_id
    WHERE rm.release_id=p_release AND (media.state='discarded' OR payload.object_id IS NULL OR reservation.state IS DISTINCT FROM 'adopted'
      OR payload.sha256<>b.sha256 OR payload.bytes<>b.bytes OR payload.mime<>b.mime OR payload.source_id<>b.source_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MEDIA_UNAVAILABLE'; END IF;
  RETURN deadline;
END $$;

CREATE FUNCTION content_intake.project_sop_graph_release(p_next text,p_previous text,p_candidate text DEFAULT NULL,p_version bigint DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE own_source text;
BEGIN
  IF p_candidate IS NOT NULL THEN SELECT CASE WHEN canonical_encoding='candidate-sop-task-graph-v2' THEN source_id END INTO STRICT own_source FROM content_intake.candidate_versions WHERE candidate_id=p_candidate AND version=p_version; END IF;
  INSERT INTO content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,flow_version,graph_digest,candidate_id,candidate_version,publication_policy,review_request_id)
    SELECT p_next,source_id,flow_id,flow_version,graph_digest,candidate_id,candidate_version,publication_policy,review_request_id
      FROM content_intake.sop_graph_release_lineage WHERE release_id=p_previous AND (own_source IS NULL OR source_id<>own_source);
  IF p_candidate IS NOT NULL THEN
    INSERT INTO content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,flow_version,graph_digest,candidate_id,candidate_version,publication_policy,review_request_id)
      SELECT p_next,v.source_id,v.flow_id,v.flow_version,v.graph_digest,v.candidate_id,v.candidate_version,c.publication_policy,NULL
      FROM content_intake.sop_graph_versions v JOIN content_intake.candidate_versions c ON c.candidate_id=v.candidate_id AND c.version=v.candidate_version
      WHERE v.candidate_id=p_candidate AND v.candidate_version=p_version AND v.operation='upsert';
    INSERT INTO content_intake.sop_graph_disable_events(release_id,source_id,target_kind,target_id)
      SELECT p_next,own_source,'flow',d->>'flowId' FROM content_intake.candidate_versions c CROSS JOIN LATERAL jsonb_array_elements(c.material->'sopDifferences') d
      WHERE c.candidate_id=p_candidate AND c.version=p_version AND d->>'change'='disable';
  END IF;
  INSERT INTO content_intake.sop_graph_release_media(release_id,source_id,flow_id,owner_kind,owner_id,resource_id,object_id,candidate_id,candidate_version)
    SELECT p_next,b.source_id,b.flow_id,b.owner_kind,b.owner_id,b.resource_id,b.object_id,b.candidate_id,b.candidate_version
      FROM content_intake.sop_graph_release_lineage l JOIN content_intake.sop_graph_media_bindings b
      USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest) WHERE l.release_id=p_next;
  UPDATE content_intake.sop_media_objects media SET state='adopted',adopted_at=clock_timestamp()
    WHERE media.state='staged' AND EXISTS(SELECT 1 FROM content_intake.sop_graph_release_media binding WHERE binding.release_id=p_next AND binding.object_id=media.media_object_id);
  RETURN content_intake.assert_sop_graph_release(p_next,p_candidate);
END $$;

CREATE FUNCTION content_intake.sop_graph_current_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM content_intake.assert_sop_graph_release(NEW.current_release_id);
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER sop_graph_current_complete AFTER INSERT OR UPDATE ON public.content_current
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_current_guard();

CREATE FUNCTION content_intake.read_sop_graph_current(p_actor text,p_entitlement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lease record; item record; result jsonb:='[]'::jsonb; payload jsonb; until_at timestamptz;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT e.*,ctx.product_ids,ctx.scenario_ids,ctx.session_token_hash INTO lease FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash) WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor
      AND e.valid_until>clock_timestamp() AND e.sop_continuation_hash IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  IF lease.release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_RELEASE_CHANGED'; END IF;
  PERFORM intake_runtime.lock_product_session(lease.session_token_hash,lease.user_id);
  until_at:=content_intake.assert_sop_graph_release(lease.release_id);
  FOR item IN SELECT l.*,v.graph_payload FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.entitlement_scopes scopes ON scopes.source_id=l.source_id AND scopes.entitlement_hash=p_entitlement
    JOIN content_intake.sources s ON s.source_id=l.source_id
    WHERE l.release_id=lease.release_id AND content_intake.authorization_deadline(p_actor,'query',s.scope_id,s.source_id,clock_timestamp()) IS NOT NULL
    ORDER BY l.source_id COLLATE "C",l.flow_id COLLATE "C",l.flow_version LOOP
    payload:=item.graph_payload;
    IF payload#>>'{definition,header,audience}'='coach' AND NOT EXISTS(SELECT 1 FROM content_intake.principals p
      JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
      JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)
      WHERE p.principal_id=p_actor AND r.role IN ('supervisor','manager','director','engineer','enabler','lead')) THEN CONTINUE; END IF;
    IF (payload#>>'{definition,header,effectiveFrom}')::timestamptz>clock_timestamp()
      OR (payload#>>'{definition,header,effectiveTo}')::timestamptz<=clock_timestamp()
      OR NOT content_intake.sop_graph_selection(payload#>'{definition,header,applicability}',lease.product_ids,lease.scenario_ids)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'entries') entry WHERE
        NOT content_intake.sop_graph_selection(entry->'entry',lease.product_ids,lease.scenario_ids)
        OR (entry#>>'{entry,effectiveFrom}')::timestamptz>clock_timestamp() OR (entry#>>'{entry,effectiveTo}')::timestamptz<=clock_timestamp()) THEN CONTINUE; END IF;
    payload:=jsonb_set(payload,'{media}',coalesce((SELECT jsonb_agg(m ORDER BY ordinal) FROM jsonb_array_elements(payload->'media') WITH ORDINALITY media(m,ordinal)
      WHERE content_intake.sop_graph_selection(m->'applicability',lease.product_ids,lease.scenario_ids)),'[]'::jsonb));
    result:=result||jsonb_build_array(jsonb_build_object('graphDigest',item.graph_digest,'payload',payload));
  END LOOP;
  RETURN jsonb_build_object('graphs',result,'validUntil',least(until_at,lease.valid_until));
END $$;

CREATE FUNCTION content_intake.sop_graph_selection(p_applicability jsonb,p_products text[],p_scenarios text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT ((cardinality(p_products)=0 AND jsonb_array_length(p_applicability->'productRefs')=0)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_applicability->'productRefs') ref WHERE ref->>'id'=ANY(p_products)))
    AND ((cardinality(p_scenarios)=0 AND jsonb_array_length(p_applicability->'scenarioRefs')=0)
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_applicability->'scenarioRefs') ref WHERE ref->>'id'=ANY(p_scenarios)));
$$;

CREATE FUNCTION content_intake.read_sop_graph_deadline(p_actor text,p_release text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM backend_review.lock_content();
  IF p_release IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1)
    OR NOT EXISTS(SELECT 1 FROM content_intake.principals p JOIN public.content_releases r ON r.tenant_id=p.tenant_id
      WHERE p.principal_id=p_actor AND r.release_id=p_release)
    OR NOT EXISTS(SELECT 1 FROM content_intake.authorization_sources(p_actor,'query',clock_timestamp())) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  RETURN nullif(content_intake.assert_sop_graph_release(p_release),'infinity'::timestamptz);
END $$;
ALTER FUNCTION content_intake.read_sop_graph_deadline(text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_deadline(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_graph_deadline(text,text) TO intake_usage;

CREATE FUNCTION content_intake.sop_graph_publish_media(p_actor text,p_id text,p_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; result jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF content_intake.authorization_deadline(p_actor,'publish',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('objectId',media.payload_object_id,'sha256',media.sha256,'sizeBytes',media.bytes,'mime',media.mime)),'[]'::jsonb) INTO result
    FROM content_intake.sop_graph_media_bindings b JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id
    WHERE (b.candidate_id=p_id AND b.candidate_version=p_version) OR EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
      WHERE l.release_id=c.base_release_id AND l.source_id<>c.source_id AND l.candidate_id=b.candidate_id AND l.candidate_version=b.candidate_version AND l.flow_id=b.flow_id);
  RETURN result;
END $$;

CREATE FUNCTION content_intake.read_sop_graph_base(p_actor text,p_source text,p_release text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb; full_candidate text; full_version bigint; versions jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  IF NOT EXISTS(SELECT 1 FROM content_intake.sources s WHERE s.source_id=p_source
    AND content_intake.authorization_deadline(p_actor,'import',s.scope_id,s.source_id,clock_timestamp()) IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  IF p_release IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED'; END IF;
  WITH RECURSIVE ancestry(release_id,depth) AS (SELECT p_release,0 UNION ALL
    SELECT c.graph_parent_release_id,a.depth+1 FROM ancestry a JOIN content_intake.release_catalogs c USING(release_id) WHERE c.graph_parent_release_id IS NOT NULL)
    SELECT c.candidate_id,c.version INTO full_candidate,full_version FROM ancestry a JOIN content_intake.publications p USING(release_id)
    JOIN content_intake.candidate_versions c ON c.candidate_id=p.candidate_id AND c.version=p.candidate_version
    WHERE c.source_id=p_source AND c.canonical_encoding='candidate-sop-task-graph-v2' ORDER BY a.depth LIMIT 1;
  IF full_candidate IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(v.graph_payload ORDER BY v.flow_id COLLATE "C"),'[]'::jsonb) INTO result FROM content_intake.sop_graph_versions v
      WHERE v.candidate_id=full_candidate AND v.candidate_version=full_version;
  ELSE
    SELECT coalesce(jsonb_agg(v.graph_payload ORDER BY l.flow_id COLLATE "C"),'[]'::jsonb) INTO result FROM content_intake.sop_graph_release_lineage l
      JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
      WHERE l.release_id=p_release AND l.source_id=p_source;
  END IF;
  SELECT coalesce(jsonb_object_agg(flow_id,version),'{}'::jsonb) INTO versions FROM (
    SELECT v.flow_id,max(v.flow_version) version FROM content_intake.sop_graph_versions v
    JOIN content_intake.publications p ON p.candidate_id=v.candidate_id AND p.candidate_version=v.candidate_version WHERE v.source_id=p_source GROUP BY v.flow_id) latest;
  RETURN jsonb_build_object('graphs',result,'versions',versions);
END $$;

CREATE FUNCTION content_intake.read_sop_graph_quality(p_actor text,p_id text,p_version bigint,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; targets jsonb; checks jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version AND digest=p_digest;
  IF NOT FOUND OR content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('key',v.graph_payload#>'{definition,header,key}','graphDigest',v.graph_digest)
    ORDER BY v.source_id COLLATE "C",v.flow_id COLLATE "C",v.flow_version),'[]'::jsonb) INTO targets FROM content_intake.sop_graph_versions v
    WHERE v.candidate_id=p_id AND v.candidate_version=p_version AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'sopDifferences') d WHERE d->>'flowId'=v.flow_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('phase',phase,'check',jsonb_build_object('key',jsonb_build_object('sourceId',source_id,'flowId',flow_id,'flowVersion',flow_version),
    'graphDigest',graph_digest,'defect',defect,'reason',reason)) ORDER BY source_id COLLATE "C",flow_id COLLATE "C",flow_version),'[]'::jsonb) INTO checks
    FROM content_intake.sop_graph_quality_checks WHERE candidate_id=p_id AND candidate_version=p_version;
  RETURN jsonb_build_object('targets',targets,'checks',checks);
END $$;

CREATE FUNCTION content_intake.read_sop_graph_candidate_media(p_actor text,p_id text,p_version bigint,p_digest text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT jsonb_build_object('objectId',media.payload_object_id,'sha256',b.sha256,'sizeBytes',b.bytes,'mime',b.mime,
    'binding',p_binding,'key',jsonb_build_object('candidateId',p_id,'version',p_version,'digest',p_digest)) INTO result
    FROM content_intake.candidate_versions c JOIN content_intake.sop_graph_media_bindings b ON b.candidate_id=c.candidate_id AND b.candidate_version=c.version
    JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id
    WHERE c.candidate_id=p_id AND c.version=p_version AND c.digest=p_digest AND c.state IN ('awaiting-evidence','ready')
      AND content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NOT NULL
      AND b.source_id=p_binding->>'sourceId' AND b.flow_id=p_binding->>'flowId' AND b.flow_version=(p_binding->>'flowVersion')::bigint
      AND b.owner_kind=p_binding->>'ownerKind' AND b.owner_id=p_binding->>'ownerId' AND b.resource_id=p_binding->>'resourceId'
      AND b.object_id=p_binding->>'objectId' AND b.entry_script_version IS NOT DISTINCT FROM (p_binding->>'scriptVersion')::bigint
      AND (b.audience<>'coach' OR EXISTS(SELECT 1 FROM content_intake.principals p
        JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)
        WHERE p.principal_id=p_actor AND r.role IN ('supervisor','manager','director','engineer','enabler','lead')));
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION content_intake.freeze_sop_graph_quality(p_actor text,p_id text,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF c.canonical_encoding<>'candidate-sop-task-graph-v2' THEN RETURN; END IF;
  IF c.state NOT IN ('awaiting-evidence','ready') OR content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NULL
    OR NOT EXISTS(SELECT 1 FROM content_intake.quality_plans WHERE candidate_id=p_id AND candidate_version=p_version AND candidate_digest=c.digest) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.sop_graph_quality_targets(candidate_id,candidate_version,material_digest,source_id,flow_id,flow_version,graph_digest,policy_version)
    SELECT p_id,p_version,c.digest,v.source_id,v.flow_id,v.flow_version,v.graph_digest,'sop-task-graph-quality-v2'
    FROM content_intake.sop_graph_versions v WHERE v.candidate_id=p_id AND v.candidate_version=p_version
      AND EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'sopDifferences') d WHERE d->>'flowId'=v.flow_id)
    ON CONFLICT DO NOTHING;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_versions v WHERE v.candidate_id=p_id AND v.candidate_version=p_version
    AND v.operation='upsert' AND NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_targets t WHERE t.candidate_id=p_id AND t.candidate_version=p_version AND t.flow_id=v.flow_id)
    AND NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l JOIN content_intake.sop_graph_quality_checks checks
      ON checks.candidate_id=l.candidate_id AND checks.candidate_version=l.candidate_version AND checks.source_id=l.source_id AND checks.flow_id=l.flow_id
      WHERE l.release_id=c.base_release_id AND l.source_id=v.source_id AND l.flow_id=v.flow_id AND l.graph_digest=v.graph_digest AND NOT checks.defect)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
END $$;

CREATE FUNCTION content_intake.check_sop_graph_quality(p_actor text,p_id text,p_version bigint,p_phase text,p_checks jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; recorded timestamptz:=clock_timestamp();
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF c.canonical_encoding<>'candidate-sop-task-graph-v2' OR c.state NOT IN ('awaiting-evidence','ready')
    OR content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NULL
    OR p_phase NOT IN ('initial','expanded') OR jsonb_typeof(p_checks) IS DISTINCT FROM 'array'
    OR (SELECT count(*) FROM content_intake.sop_graph_quality_targets WHERE candidate_id=p_id AND candidate_version=p_version)<>jsonb_array_length(p_checks)
    OR (SELECT count(DISTINCT x->'key') FROM jsonb_array_elements(p_checks) x)<>jsonb_array_length(p_checks)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_checks) x LEFT JOIN content_intake.sop_graph_quality_targets t
      ON t.candidate_id=p_id AND t.candidate_version=p_version AND t.source_id=x#>>'{key,sourceId}' AND t.flow_id=x#>>'{key,flowId}'
      AND t.flow_version=(x#>>'{key,flowVersion}')::bigint AND t.graph_digest=x->>'graphDigest'
      WHERE t.flow_id IS NULL OR x-ARRAY['key','graphDigest','defect','reason']<>'{}'::jsonb
        OR NOT x ?& ARRAY['key','graphDigest','defect','reason'] OR jsonb_typeof(x->'defect') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(x->'reason') IS DISTINCT FROM 'string' OR length(x->>'reason')>2000
        OR ((x->>'defect')::boolean AND btrim(x->>'reason')=''))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_checks) x JOIN content_intake.sop_graph_quality_checks prior
      ON prior.candidate_id=p_id AND prior.candidate_version=p_version AND prior.flow_id=x#>>'{key,flowId}'
      WHERE prior.defect IS DISTINCT FROM (x->>'defect')::boolean OR prior.reason IS DISTINCT FROM x->>'reason') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID'; END IF;
  INSERT INTO content_intake.sop_graph_quality_checks(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest,phase,reviewer_id,defect,reason,checked_at)
    SELECT p_id,p_version,x#>>'{key,sourceId}',x#>>'{key,flowId}',(x#>>'{key,flowVersion}')::bigint,x->>'graphDigest',p_phase,p_actor,
      (x->>'defect')::boolean,x->>'reason',recorded FROM jsonb_array_elements(p_checks) x;
  RETURN recorded;
END $$;
CREATE FUNCTION content_intake.sop_graph_rollback_media(p_actor text,p_plan text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE plan content_intake.rollback_plans; result jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO plan FROM content_intake.rollback_plans WHERE rollback_plan_id=p_plan AND actor_id=p_actor;
  IF NOT FOUND OR plan.base_release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1)
    OR EXISTS(SELECT 1 FROM content_intake.rollback_scopes scopes JOIN content_intake.sources s USING(source_id)
      WHERE scopes.rollback_plan_id=p_plan AND content_intake.authorization_deadline(p_actor,'rollback',s.scope_id,s.source_id,clock_timestamp()) IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('objectId',media.payload_object_id,'sha256',media.sha256,'sizeBytes',media.bytes,'mime',media.mime)),'[]'::jsonb) INTO result
    FROM content_intake.sop_graph_release_media b JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id WHERE b.release_id=plan.target_release_id;
  RETURN result;
END $$;
ALTER FUNCTION content_intake.sop_graph_rollback_media(text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_graph_rollback_media(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.sop_graph_rollback_media(text,text) TO intake_business;

CREATE FUNCTION content_intake.sop_graph_media_history_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_media_bindings WHERE object_id=OLD.media_object_id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
    IF NEW.payload_object_id IS DISTINCT FROM OLD.payload_object_id OR NEW.sha256<>OLD.sha256 OR NEW.bytes<>OLD.bytes
      OR NEW.mime<>OLD.mime OR NEW.source_id<>OLD.source_id OR NEW.state='discarded' THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION content_intake.sop_graph_media_history_guard() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_graph_media_history_guard() FROM PUBLIC;
CREATE TRIGGER sop_graph_media_history BEFORE UPDATE OR DELETE ON content_intake.sop_media_objects
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_media_history_guard();

-- Existing owners extended in place. Their legacy branches retain their original checks.

CREATE OR REPLACE FUNCTION content_intake.input_format_matches(p_template text,p_rule text,p_mapping text,p_structure text,p_mime text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(
    (p_template='faq-p1.1' AND p_rule='intake-p1.1' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND length(p_mapping) BETWEEN 1 AND 64 AND p_structure ~ '^[0-9a-f]{64}$')
    OR (p_template='faq-csv-v1' AND p_rule='intake-csv-v1' AND p_mapping='faq-csv-columns-v1'
      AND p_structure='daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165' AND p_mime='text/csv')
    OR (p_template='sop-v1' AND p_rule='sop-not-imported' AND p_mapping='not-imported'
      AND p_structure='55db62261cb6eee8bb0327ffb4bf8eac1f30a667e6821f640431d4be47c3a925'
      AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    OR (p_template='sop-manual-authoring-v1.1' AND p_rule='sop-task-graph-v2' AND p_mapping='sop-manual-to-task-graph-v2'
      AND p_structure='3723abe333aec2a745d3fa3a7775b1ad56834b211b5bc744cf1dbb9c38b78c72' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    false);
$$;

CREATE OR REPLACE FUNCTION content_intake.candidate_format_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m content_intake.source_mappings; o content_intake.objects;
BEGIN
  SELECT * INTO STRICT m FROM content_intake.source_mappings WHERE source_id=NEW.source_id AND version=NEW.source_version;
  SELECT * INTO STRICT o FROM content_intake.objects WHERE object_id=NEW.object_id;
  IF o.source_id IS DISTINCT FROM NEW.source_id OR o.purpose<>'input'
    OR NOT content_intake.input_format_matches(m.template_version,m.rule_version,m.mapping_version,m.structure_digest,o.mime)
    OR NEW.material->>'templateVersion' IS DISTINCT FROM m.template_version
    OR NEW.material->>'ruleVersion' IS DISTINCT FROM m.rule_version
    OR NEW.material->>'mappingVersion' IS DISTINCT FROM m.mapping_version
    OR NEW.material->>'sourceVersion' IS DISTINCT FROM m.version::text
    OR NEW.material#>>'{object,sourceId}' IS DISTINCT FROM o.source_id::text
    OR NEW.material#>>'{object,mime}' IS DISTINCT FROM o.mime
    OR NEW.material#>>'{object,bytes}' IS DISTINCT FROM o.bytes::text
    OR NEW.material->'selectedSheets' IS DISTINCT FROM (CASE WHEN NEW.canonical_encoding='candidate-sop-task-graph-v2' THEN '["场景目录","执行任务","判断分支","客户话术","知识与案例","资源与图片"]'::jsonb WHEN o.mime='text/csv' THEN '["CSV"]'::jsonb ELSE '["来源","FAQ","相似问法"]'::jsonb END)
  THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_FORMAT_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION content_intake.project_sop_release_media() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  -- Classify against the captured source version, never a newer source mapping.
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.source_mappings m ON m.source_id=c.source_id AND m.version=c.source_version
    JOIN content_intake.scopes s ON s.scope_id=c.scope_id
    WHERE c.canonical_encoding<>'candidate-sop-task-graph-v2' AND (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')
      AND (NOT EXISTS(SELECT 1 FROM content_intake.sop_asset_registrations a WHERE a.candidate_id=c.candidate_id AND a.candidate_version=c.version)
      OR NOT EXISTS(SELECT 1 FROM content_intake.sop_candidate_rows r WHERE r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.source_mappings m ON m.source_id=c.source_id AND m.version=c.source_version JOIN content_intake.scopes s ON s.scope_id=c.scope_id
    WHERE NOT (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')
    AND EXISTS(SELECT 1 FROM content_intake.sop_candidate_media image WHERE image.candidate_id=c.candidate_id AND image.candidate_version=c.version)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Expand each candidate once, then verify all inserted identities in a set.
  IF EXISTS(WITH selected AS (SELECT DISTINCT candidate_id,candidate_version FROM sop_new_lineage), entries AS MATERIALIZED (
    SELECT c.candidate_id,c.version,e FROM selected x JOIN content_intake.candidate_versions c ON c.candidate_id=x.candidate_id AND c.version=x.candidate_version
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e)
    SELECT 1 FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    WHERE NOT EXISTS(SELECT 1 FROM entries WHERE candidate_id=l.candidate_id AND version=l.candidate_version AND e->>'businessEntryId'=l.business_entry_id AND (e->>'scriptVersion')::bigint=l.script_version)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    JOIN content_intake.sop_candidate_media m ON m.candidate_id=r.candidate_id AND m.candidate_version=r.candidate_version AND m.source_id=r.source_id AND m.row_id=r.row_id
    JOIN content_intake.sop_media_objects o ON o.media_object_id=m.media_object_id
    LEFT JOIN content_intake.objects p ON p.object_id=o.payload_object_id
    LEFT JOIN content_intake.object_reservations reservation ON reservation.object_id=p.object_id
    WHERE o.state='discarded' OR p.object_id IS NULL OR p.purpose<>'sop-media' OR reservation.state IS DISTINCT FROM 'adopted'
      OR p.source_id<>m.source_id OR p.sha256<>m.sha256 OR p.bytes<>m.bytes OR p.mime<>m.mime) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.sop_release_media(release_id,candidate_id,candidate_version,source_id,media_object_id,sheet_name,row_number,column_number,row_id,ordinal,sha256,mime,bytes)
    SELECT l.release_id,m.candidate_id,m.candidate_version,m.source_id,m.media_object_id,m.sheet_name,m.row_number,m.column_number,m.row_id,m.ordinal,m.sha256,m.mime,m.bytes
    FROM sop_new_lineage l JOIN content_intake.sop_candidate_rows r ON r.candidate_id=l.candidate_id AND r.candidate_version=l.candidate_version AND r.source_id=l.source_id AND r.business_entry_id=l.business_entry_id
    JOIN content_intake.sop_candidate_media m ON m.candidate_id=r.candidate_id AND m.candidate_version=r.candidate_version AND m.source_id=r.source_id AND m.row_id=r.row_id;
  UPDATE content_intake.sop_media_objects o SET state='adopted',adopted_at=clock_timestamp()
    WHERE o.state='staged' AND EXISTS(SELECT 1 FROM content_intake.sop_release_media m JOIN sop_new_lineage l
      ON l.release_id=m.release_id AND l.candidate_id=m.candidate_id AND l.candidate_version=m.candidate_version AND l.source_id=m.source_id
      WHERE m.media_object_id=o.media_object_id);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION content_intake.sop_graph_faq_quality_state(p_candidate TEXT,p_version BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p JSONB; initial JSONB; expanded JSONB; ordinary INTEGER; target INTEGER;
  initial_defects INTEGER; final_defects INTEGER; mandatory_defects INTEGER;
BEGIN
  SELECT plan INTO p FROM content_intake.quality_plans WHERE candidate_id=p_candidate AND candidate_version=p_version;
  IF NOT FOUND THEN RETURN 'not_frozen'; END IF;
  SELECT checks INTO initial FROM content_intake.quality_rounds WHERE candidate_id=p_candidate AND candidate_version=p_version AND phase='initial';
  IF NOT FOUND THEN RETURN 'initial_required'; END IF;
  SELECT count(*) FILTER (WHERE (c->>'defect')::boolean AND r->>'risk_level'<>'high'),
    count(*) FILTER (WHERE (c->>'defect')::boolean AND r->>'risk_level'='high')
    INTO initial_defects,mandatory_defects
    FROM jsonb_array_elements(initial) c JOIN jsonb_array_elements(p->'population') r ON c->>'scriptId'=r->>'script_id';
  ordinary:=(p->>'ordinaryCount')::integer;
  target:=(p->>'initialTarget')::integer;
  IF mandatory_defects>0 THEN RETURN 'revision_required'; END IF;
  IF initial_defects*20>target THEN RETURN 'blocked'; END IF;
  IF ordinary>500 AND initial_defects*50>target THEN
    SELECT checks INTO expanded FROM content_intake.quality_rounds WHERE candidate_id=p_candidate AND candidate_version=p_version AND phase='expanded';
    IF NOT FOUND THEN RETURN 'expansion_required'; END IF;
    SELECT count(*) INTO final_defects FROM jsonb_array_elements(expanded) c WHERE (c->>'defect')::boolean;
    IF final_defects*20>(p->>'expandedTarget')::integer THEN RETURN 'blocked'; END IF;
    RETURN CASE WHEN final_defects>0 THEN 'revision_required' ELSE 'passed' END;
  END IF;
  RETURN CASE WHEN initial_defects>0 THEN 'revision_required' ELSE 'passed' END;
END $$;

CREATE OR REPLACE FUNCTION content_intake.quality_state(p_candidate text,p_version bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE faq text; c content_intake.candidate_versions; phase_name text; targets bigint; actual bigint;
BEGIN
  faq:=content_intake.sop_graph_faq_quality_state(p_candidate,p_version);
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_candidate AND version=p_version;
  IF c.canonical_encoding<>'candidate-sop-task-graph-v2' OR faq IN ('not_frozen','initial_required') THEN RETURN faq; END IF;
  SELECT count(*) INTO targets FROM content_intake.sop_graph_quality_targets WHERE candidate_id=p_candidate AND candidate_version=p_version;
  IF targets<>jsonb_array_length(c.material->'sopDifferences') THEN RETURN 'blocked'; END IF;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_versions v WHERE v.candidate_id=p_candidate AND v.candidate_version=p_version AND v.operation='upsert'
    AND NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_targets t WHERE t.candidate_id=p_candidate AND t.candidate_version=p_version AND t.flow_id=v.flow_id)
    AND NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
      JOIN content_intake.sop_graph_quality_checks checks ON checks.candidate_id=l.candidate_id AND checks.candidate_version=l.candidate_version AND checks.source_id=l.source_id AND checks.flow_id=l.flow_id
      JOIN content_intake.quality_rounds round ON round.candidate_id=checks.candidate_id AND round.candidate_version=checks.candidate_version AND round.phase=checks.phase AND round.checked_by=checks.reviewer_id AND round.recorded_at=checks.checked_at
      WHERE l.release_id=c.base_release_id AND l.source_id=v.source_id AND l.flow_id=v.flow_id AND l.graph_digest=v.graph_digest AND NOT checks.defect)) THEN RETURN 'blocked'; END IF;

  FOR phase_name IN SELECT phase FROM content_intake.quality_rounds WHERE candidate_id=p_candidate AND candidate_version=p_version LOOP
    SELECT count(*) INTO actual FROM content_intake.sop_graph_quality_checks WHERE candidate_id=p_candidate AND candidate_version=p_version AND phase=phase_name;
    IF actual<>targets THEN RETURN 'blocked'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_checks WHERE candidate_id=p_candidate AND candidate_version=p_version AND defect) THEN RETURN 'revision_required'; END IF;
  RETURN faq;
END $$;

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
  INSERT INTO content_intake.release_catalogs(release_id,format_version,graph_parent_release_id) VALUES (v_release,'intake-v2.1',v_base);
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
  v_deadline:=least(v_deadline,content_intake.project_sop_graph_release(v_release,v_base,c.candidate_id,c.version));
  IF v_deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='TICKET_EXPIRED'; END IF;
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
    UNION ALL
    SELECT coalesce(b.source_id,t.source_id),'flow:'||coalesce(b.flow_id,t.flow_id),
      to_jsonb(b)-'release_id',to_jsonb(t)-'release_id'
    FROM (SELECT * FROM content_intake.sop_graph_release_lineage WHERE release_id=p_base) b FULL JOIN
      (SELECT * FROM content_intake.sop_graph_release_lineage WHERE release_id=p_target) t USING(source_id,flow_id)
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
  PERFORM content_intake.assert_sop_graph_release(p_target);
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
  INSERT INTO content_intake.release_catalogs(release_id,format_version,graph_parent_release_id) VALUES(release_id_new,'intake-v2.1',plan.target_release_id);
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy) SELECT release_id_new,source_id,business_entry_id,script_version,candidate_id,candidate_version,
    review_request_id,content_valid_until,publication_policy FROM content_intake.release_lineage WHERE release_id=plan.target_release_id;
  IF deadline<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='TICKET_EXPIRED'; END IF;
  deadline:=least(deadline,content_intake.project_sop_graph_release(release_id_new,plan.target_release_id));
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
  INSERT INTO content_intake.release_catalogs(release_id,format_version,sop_nodes,sop_edges,media,graph_parent_release_id)
    SELECT p_next,format_version,sop_nodes,sop_edges,media,p_previous FROM content_intake.release_catalogs WHERE release_id=p_previous;
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
      candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy)
    SELECT p_next,source_id,business_entry_id,script_version,candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy
      FROM content_intake.release_lineage WHERE release_id=p_previous;
  PERFORM content_intake.project_sop_graph_release(p_next,p_previous);
END;
$$;


ALTER FUNCTION content_intake.assert_sop_graph_payload(jsonb,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.assert_sop_graph_payload(jsonb,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.assert_sop_graph_payload(jsonb,text) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.assert_sop_graph_payload(jsonb,text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.freeze_sop_graph_candidate(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.freeze_sop_graph_candidate(text,text,jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.freeze_sop_graph_candidate(text,text,jsonb) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.freeze_sop_graph_candidate(text,text,jsonb) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.freeze_sop_graph_quality(text,text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.freeze_sop_graph_quality(text,text,bigint) SECURITY DEFINER;
ALTER FUNCTION content_intake.freeze_sop_graph_quality(text,text,bigint) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.freeze_sop_graph_quality(text,text,bigint) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.check_sop_graph_quality(text,text,bigint,text,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.check_sop_graph_quality(text,text,bigint,text,jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.check_sop_graph_quality(text,text,bigint,text,jsonb) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.check_sop_graph_quality(text,text,bigint,text,jsonb) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.assert_sop_graph_release(text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.assert_sop_graph_release(text,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.assert_sop_graph_release(text,text) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.assert_sop_graph_release(text,text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.project_sop_graph_release(text,text,text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.project_sop_graph_release(text,text,text,bigint) SECURITY DEFINER;
ALTER FUNCTION content_intake.project_sop_graph_release(text,text,text,bigint) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.project_sop_graph_release(text,text,text,bigint) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.sop_graph_current_guard() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_graph_current_guard() SECURITY DEFINER;
ALTER FUNCTION content_intake.sop_graph_current_guard() SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.sop_graph_current_guard() FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.read_sop_graph_current(text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_graph_current(text,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.read_sop_graph_current(text,text) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_current(text,text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.sop_graph_selection(jsonb,text[],text[]) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_graph_selection(jsonb,text[],text[]) SECURITY DEFINER;
ALTER FUNCTION content_intake.sop_graph_selection(jsonb,text[],text[]) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.sop_graph_selection(jsonb,text[],text[]) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.sop_graph_publish_media(text,text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_graph_publish_media(text,text,bigint) SECURITY DEFINER;
ALTER FUNCTION content_intake.sop_graph_publish_media(text,text,bigint) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.sop_graph_publish_media(text,text,bigint) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.read_sop_graph_base(text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_graph_base(text,text,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.read_sop_graph_base(text,text,text) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_base(text,text,text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.read_sop_graph_quality(text,text,bigint,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_graph_quality(text,text,bigint,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.read_sop_graph_quality(text,text,bigint,text) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_quality(text,text,bigint,text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.read_sop_graph_candidate_media(text,text,bigint,text,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_graph_candidate_media(text,text,bigint,text,jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.read_sop_graph_candidate_media(text,text,bigint,text,jsonb) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_candidate_media(text,text,bigint,text,jsonb) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

ALTER FUNCTION content_intake.sop_graph_faq_quality_state(text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_graph_faq_quality_state(text,bigint) SECURITY DEFINER;
ALTER FUNCTION content_intake.sop_graph_faq_quality_state(text,bigint) SET search_path=pg_catalog;
REVOKE ALL ON FUNCTION content_intake.sop_graph_faq_quality_state(text,bigint) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

GRANT EXECUTE ON FUNCTION content_intake.freeze_sop_graph_candidate(text,text,jsonb) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.freeze_sop_graph_quality(text,text,bigint) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.check_sop_graph_quality(text,text,bigint,text,jsonb) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.sop_graph_publish_media(text,text,bigint) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.read_sop_graph_base(text,text,text) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.read_sop_graph_quality(text,text,bigint,text) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.read_sop_graph_candidate_media(text,text,bigint,text,jsonb) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.publish_candidate(text,jsonb,jsonb) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.preview_rollback(text,text,text) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.execute_rollback(text,jsonb,jsonb) TO intake_business;

ALTER FUNCTION content_intake.publish_candidate(text,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.publish_candidate(text,jsonb,jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.publish_candidate(text,jsonb,jsonb) SET search_path=pg_catalog;

ALTER FUNCTION content_intake.preview_rollback(text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.preview_rollback(text,text,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.preview_rollback(text,text,text) SET search_path=pg_catalog;

ALTER FUNCTION content_intake.execute_rollback(text,jsonb,jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.execute_rollback(text,jsonb,jsonb) SECURITY DEFINER;
ALTER FUNCTION content_intake.execute_rollback(text,jsonb,jsonb) SET search_path=pg_catalog;

ALTER FUNCTION content_intake.inherit_legacy_catalog(text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.inherit_legacy_catalog(text,text) SECURITY DEFINER;
ALTER FUNCTION content_intake.inherit_legacy_catalog(text,text) SET search_path=pg_catalog;
GRANT EXECUTE ON FUNCTION content_intake.inherit_legacy_catalog(text,text) TO cs_ai_definer;

ALTER FUNCTION content_intake.quality_state(text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.quality_state(text,bigint) SECURITY DEFINER;
ALTER FUNCTION content_intake.quality_state(text,bigint) SET search_path=pg_catalog;

GRANT EXECUTE ON FUNCTION content_intake.quality_state(text,bigint),content_intake.input_format_matches(text,text,text,text,text) TO intake_business;

GRANT EXECUTE ON FUNCTION content_intake.read_sop_graph_current(text,text) TO intake_usage;
