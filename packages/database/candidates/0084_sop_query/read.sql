-- Candidate only. Install exclusively with install.test-only.ts after the verified 0083 prefix.
-- Query annotations are explicit author input absent from the frozen graph shape.
-- They contain no answer text and cannot replace graph or release lineage.
CREATE TABLE content_intake.sop_query_annotations (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  nodes jsonb NOT NULL CHECK (jsonb_typeof(nodes) = 'array'),
  edges jsonb NOT NULL CHECK (jsonb_typeof(edges) = 'array'),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_annotations
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable();
ALTER TABLE content_intake.sop_query_annotations OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_annotations FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE TABLE content_intake.sop_query_requests (
  actor_binding_hash content_intake.sha256 NOT NULL,
  request_id uuid NOT NULL,
  request_hash content_intake.sha256 NOT NULL,
  PRIMARY KEY (actor_binding_hash,request_id)
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_requests
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();
ALTER TABLE content_intake.sop_query_requests OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_requests FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE TABLE content_intake.sop_query_completions (
  actor_binding_hash content_intake.sha256 NOT NULL,
  request_id uuid NOT NULL,
  result jsonb NOT NULL,
  PRIMARY KEY (actor_binding_hash,request_id),
  FOREIGN KEY (actor_binding_hash,request_id) REFERENCES content_intake.sop_query_requests
);
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.sop_query_completions
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();
ALTER TABLE content_intake.sop_query_completions OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON content_intake.sop_query_completions FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE FUNCTION content_intake.complete_sop_query(p_actor text,p_request uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  INSERT INTO content_intake.sop_query_completions VALUES(p_actor,p_request,p_result) ON CONFLICT DO NOTHING;
  RETURN p_result;
END $$;
ALTER FUNCTION content_intake.complete_sop_query(text,uuid,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.complete_sop_query(text,uuid,jsonb) FROM PUBLIC;

-- Leases can only be minted through the authorized query, never by a runtime caller.
REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM app_runtime;

CREATE FUNCTION content_intake.sop_query_closed(p_status text,p_reason text,p_release text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('status',p_status,'release_id',p_release,
    'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code',p_reason)))
$$;
ALTER FUNCTION content_intake.sop_query_closed(text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_closed(text,text,text) FROM PUBLIC;

CREATE FUNCTION content_intake.read_sop_query(
  p_user_id text,p_session_token_hash text,p_sop_group text,p_shop_id text,
  p_product_context_type text,p_product_context_ref text,p_query_text text,
  p_context_generation text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,content_intake,public,pg_temp AS $$
DECLARE
  at_time timestamptz := clock_timestamp();
  deadline timestamptz;
  session_deadline timestamptz;
  actor content_intake.principals;
  graph content_intake.sop_graph_versions;
  annotations content_intake.sop_query_annotations;
  lease content_intake.sop_query_leases;
  release_id_value text;
  flow_id_value text;
  binding_hash text;
  body_hash text;
  old_hash text;
  prior_result jsonb;
  node_value jsonb;
  edge_value jsonb;
  entry_value jsonb;
  meta jsonb;
  nodes jsonb := '[]';
  edges jsonb := '[]';
  messages jsonb := '[]';
  matched boolean;
  match_count integer;
  approval_deadline timestamptz;
  graph_count integer;
  node_count integer;
  visited_count integer;
  output_kind text;
  title_value text;
  text_value text;
BEGIN
  IF p_request_id IS NULL OR p_shop_id IS NULL OR length(p_shop_id) NOT BETWEEN 1 AND 128
    OR p_query_text IS NULL OR length(btrim(p_query_text)) NOT BETWEEN 1 AND 2048
    OR p_context_generation IS NULL OR length(btrim(p_context_generation)) NOT BETWEEN 1 AND 128
    OR NOT ((p_product_context_type IS NULL AND p_product_context_ref IS NULL)
      OR (p_product_context_type IN ('storewide','category','sku') AND length(p_product_context_ref) BETWEEN 1 AND 256)) THEN
    RAISE EXCEPTION 'SOP_BLOCKED' USING ERRCODE='22023';
  END IF;
  flow_id_value := CASE p_sop_group WHEN '过敏流程SOP' THEN 'allergy' WHEN '长痘痘SOP' THEN 'acne'
    WHEN '品质售后SOP' THEN 'quality-after-sale' WHEN '少错破SOP' THEN 'less-breakage' WHEN '税收相关规则' THEN 'tax' END;
  IF flow_id_value IS NULL THEN RAISE EXCEPTION 'SOP_BLOCKED' USING ERRCODE='22023'; END IF;
  PERFORM backend_review.lock_content();
  BEGIN
    session_deadline := intake_runtime.lock_product_session(p_session_token_hash,p_user_id);
  EXCEPTION WHEN SQLSTATE 'ZA003' THEN
    RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005';
  END;
  SELECT * INTO actor FROM content_intake.principals WHERE user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005'; END IF;
  at_time := clock_timestamp();
  SELECT max(least(allowed.valid_until,member.content_valid_until)) INTO deadline
    FROM content_intake.authorization_sources(actor.principal_id,'query',at_time) allowed
    JOIN content_intake.sources src ON src.source_id=allowed.source_id
    JOIN content_intake.scopes scope ON scope.scope_id=allowed.scope_id
    JOIN content_intake.store_set_members member ON member.tenant_id=actor.tenant_id AND member.app_id=actor.app_id
      AND member.version=allowed.store_set_version AND member.source_id=allowed.source_id AND member.scope_id=allowed.scope_id
    WHERE src.source_id='menokin-sop' AND src.mode='v2-preview' AND scope.shop_id=p_shop_id
      AND scope.tenant_id=actor.tenant_id AND scope.app_id=actor.app_id;
  IF deadline IS NULL OR deadline<=at_time THEN RAISE EXCEPTION 'SCOPE_DENIED' USING ERRCODE='ZA005'; END IF;
  deadline := least(deadline,session_deadline,at_time+interval '15 minutes');
  binding_hash := encode(public.digest(p_user_id||':'||p_session_token_hash,'sha256'),'hex');
  body_hash := encode(public.digest(public.jsonb_jcs(jsonb_build_array(p_sop_group,p_shop_id,
    p_product_context_type,p_product_context_ref,p_query_text,p_context_generation)),'sha256'),'hex');
  PERFORM pg_advisory_xact_lock(hashtextextended(binding_hash||p_request_id::text,0));
  INSERT INTO content_intake.sop_query_requests VALUES(binding_hash,p_request_id,body_hash) ON CONFLICT DO NOTHING;
  SELECT request_hash INTO old_hash FROM content_intake.sop_query_requests
    WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF old_hash<>body_hash THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  SELECT current_release_id INTO release_id_value FROM public.content_current WHERE id=1;
  SELECT * INTO lease FROM content_intake.sop_query_leases WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF FOUND THEN
    IF lease.release_id IS DISTINCT FROM release_id_value OR lease.session_epoch<>actor.revocation_generation THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',lease.release_id));
    END IF;
    IF lease.expires_at<=clock_timestamp() THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','LEASE_EXPIRED',lease.release_id)); END IF;
  END IF;
  SELECT result INTO prior_result FROM content_intake.sop_query_completions
    WHERE actor_binding_hash=binding_hash AND request_id=p_request_id;
  IF prior_result->>'status' IN ('blocked','stale') THEN RETURN prior_result; END IF;
  IF release_id_value IS NULL OR NOT EXISTS (SELECT 1 FROM public.content_releases r
    JOIN content_intake.release_catalogs c USING(release_id)
    JOIN public.v_release_source_gate gate USING(release_id)
    WHERE r.release_id=release_id_value AND r.tenant_id=actor.tenant_id AND r.status='published'
      AND gate.source_gate_ready AND public.owner_acceptance_release_content_ready(r.release_id)) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SOURCE_GATE_NOT_READY'));
  END IF;
  IF EXISTS(SELECT 1 FROM content_intake.release_revocations WHERE release_id=release_id_value) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','APPROVAL_REVOKED',release_id_value));
  END IF;
  SELECT count(*) INTO graph_count FROM content_intake.sop_graph_release_lineage
    WHERE release_id=release_id_value AND source_id='menokin-sop' AND flow_id=flow_id_value;
  IF graph_count<>1 THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  SELECT g.* INTO graph FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.sop_graph_versions g USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.candidate_versions c ON c.candidate_id=g.candidate_id AND c.version=g.candidate_version
    JOIN content_intake.sources s ON s.source_id=c.source_id
    WHERE l.release_id=release_id_value AND l.source_id='menokin-sop' AND l.flow_id=flow_id_value
      AND g.operation='upsert' AND c.state='published' AND c.source_version=s.current_mapping_version;
  IF NOT FOUND THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',release_id_value)); END IF;
  IF NOT EXISTS(SELECT 1 FROM content_intake.candidate_versions c
    JOIN content_intake.source_confirmations sc ON sc.candidate_id=c.candidate_id AND sc.candidate_version=c.version
      AND sc.evidence_version=c.source_evidence_version AND sc.candidate_digest=c.digest AND sc.object_sha256=c.file_sha256
    WHERE c.candidate_id=graph.candidate_id AND c.version=graph.candidate_version) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SOURCE_GATE_NOT_READY'));
  END IF;
  SELECT min(f.valid_until) INTO approval_deadline FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.review_bindings r USING(review_request_id)
    JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts f USING(review_request_id,facts_version)
    WHERE l.release_id=release_id_value AND f.state='approved' AND f.checked_at<=at_time AND f.valid_until>at_time
      AND f.package_verified_sha256=r.package_sha256;
  IF approval_deadline IS NULL OR EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.review_bindings r USING(review_request_id)
    LEFT JOIN content_intake.approval_current cur USING(review_request_id)
    LEFT JOIN content_intake.approval_facts f USING(review_request_id,facts_version)
    WHERE l.release_id=release_id_value AND (f.state IS DISTINCT FROM 'approved' OR f.valid_until<=at_time
      OR f.checked_at>at_time OR f.package_verified_sha256 IS DISTINCT FROM r.package_sha256)) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','APPROVAL_REVOKED',release_id_value));
  END IF;
  deadline := least(deadline,approval_deadline);
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') dep
    WHERE dep->>'sourceId' IS DISTINCT FROM graph.source_id::text OR NOT EXISTS(
      SELECT 1 FROM content_intake.release_lineage l
      JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') entry
      WHERE l.release_id=release_id_value AND l.source_id=graph.source_id
        AND l.business_entry_id=dep#>>'{entry,businessEntryId}' AND l.script_version::text=dep#>>'{entry,scriptVersion}'
        AND entry=dep->'entry' AND entry->>'operation'='upsert')) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') n
    WHERE n->'key' IS DISTINCT FROM graph.graph_payload#>'{definition,header,key}')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e
      WHERE e->'key' IS DISTINCT FROM graph.graph_payload#>'{definition,header,key}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') dep
      WHERE dep->>'sourceId'=graph.graph_payload#>>'{definition,header,anchorEntry,sourceId}'
        AND dep#>>'{entry,businessEntryId}'=graph.graph_payload#>>'{definition,header,anchorEntry,businessEntryId}'
        AND dep#>>'{entry,scriptVersion}'=graph.graph_payload#>>'{definition,header,anchorEntry,scriptVersion}')
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') n
      WHERE n#>>'{body,kind}'='message' AND n#>>'{body,entry,sourceId}' IS DISTINCT FROM graph.source_id::text)
    OR (SELECT count(DISTINCT e->>'id') FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e)
      <>jsonb_array_length(graph.graph_payload#>'{definition,edges}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  IF graph.canonical_graph IS DISTINCT FROM public.jsonb_jcs(graph.graph_payload) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  FOR entry_value IN SELECT value->'entry' FROM jsonb_array_elements(graph.graph_payload->'entries') LOOP
    IF (entry_value->>'effectiveFrom')::timestamptz>at_time OR (entry_value->>'effectiveTo')::timestamptz<=at_time THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','STALE_RELEASE',release_id_value));
    END IF;
    deadline := least(deadline,(entry_value->>'effectiveTo')::timestamptz);
    IF jsonb_array_length(entry_value->'productRefs')>0 AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(entry_value->'productRefs') ref WHERE ref->>'id'=p_product_context_ref
        AND p_product_context_type IN ('category','sku')) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SCOPE_DENIED'));
    END IF;
    IF jsonb_array_length(entry_value->'scenarioRefs')>0 THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SCOPE_DENIED'));
    END IF;
  END LOOP;
  -- Missing transport declarations never acquire meaning from array order or answer text.
  SELECT * INTO annotations FROM content_intake.sop_query_annotations
    WHERE candidate_id=graph.candidate_id AND candidate_version=graph.candidate_version
      AND source_id=graph.source_id AND flow_id=graph.flow_id AND graph_digest=graph.graph_digest;
  IF NOT FOUND THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  IF jsonb_array_length(graph.graph_payload->'media')<>0 THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','MEDIA_UNVERIFIED'));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_checks q
    WHERE q.candidate_id=graph.candidate_id AND q.candidate_version=graph.candidate_version
      AND q.source_id=graph.source_id AND q.flow_id=graph.flow_id AND q.graph_digest=graph.graph_digest AND NOT q.defect)
    OR EXISTS(SELECT 1 FROM content_intake.sop_graph_quality_checks q
      WHERE q.candidate_id=graph.candidate_id AND q.candidate_version=graph.candidate_version AND q.defect) THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
  END IF;
  node_count := jsonb_array_length(graph.graph_payload#>'{definition,nodes}');
  IF (SELECT count(DISTINCT e->>'branch_id') FROM jsonb_array_elements(annotations.edges) e)<>jsonb_array_length(annotations.edges)
    OR jsonb_array_length(annotations.nodes)<>node_count
    OR jsonb_array_length(annotations.edges)<>jsonb_array_length(graph.graph_payload#>'{definition,edges}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  FOR node_value IN SELECT value FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') LOOP
    SELECT value INTO meta FROM jsonb_array_elements(annotations.nodes) WHERE value->>'node_id'=node_value->>'id';
    IF meta IS NULL OR jsonb_typeof(meta->'sequence') IS DISTINCT FROM 'number'
      OR COALESCE(meta->>'sequence','') !~ '^[0-9]{1,5}$' OR (meta->>'sequence')::numeric>10000
      OR jsonb_typeof(meta->'source_ref') IS DISTINCT FROM 'string' OR COALESCE(meta->>'source_ref','')=''
      OR (SELECT count(*) FROM jsonb_array_elements(annotations.nodes) WHERE value->>'node_id'=node_value->>'id')<>1 THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    SELECT count(*) INTO graph_count FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id';
    IF (node_value#>>'{body,kind}' IN ('message','internal') AND (graph_count<>1 OR EXISTS(
      SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id' AND e#>>'{action,kind}' IS DISTINCT FROM 'next')))
      OR (node_value#>>'{body,kind}'='decision' AND (graph_count NOT BETWEEN 2 AND 4 OR EXISTS(
        SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id' AND e#>>'{action,kind}' IS DISTINCT FROM 'choice'))) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF node_value#>>'{body,kind}'='decision' AND (
      SELECT array_agg((e#>>'{action,ordinal}')::integer ORDER BY (e#>>'{action,ordinal}')::integer)
      FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') e WHERE e->>'from'=node_value->>'id'
    ) IS DISTINCT FROM ARRAY(SELECT generate_series(1,graph_count)) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    output_kind := CASE node_value#>>'{body,kind}' WHEN 'message' THEN 'instruction' WHEN 'internal' THEN 'instruction'
      WHEN 'decision' THEN 'decision' WHEN 'end' THEN 'terminal' END;
    IF output_kind IS NULL THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
    nodes := nodes||jsonb_build_array(jsonb_build_object('node_id',node_value->>'id','scenario_id',flow_id_value,
      'sequence',meta->'sequence','kind',output_kind,'terminal',output_kind='terminal','source_ref',meta->>'source_ref'));
    IF node_value#>>'{body,kind}'='message' THEN
      SELECT value->'entry' INTO entry_value FROM jsonb_array_elements(graph.graph_payload->'entries')
        WHERE value->>'sourceId'=graph.source_id AND value#>>'{entry,businessEntryId}'=node_value#>>'{body,entry,businessEntryId}'
          AND value#>>'{entry,scriptVersion}'=node_value#>>'{body,entry,scriptVersion}' AND value#>>'{entry,operation}'='upsert';
      IF entry_value IS NULL THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
      title_value := entry_value->>'title'; text_value := entry_value->>'answerText';
    ELSE
      title_value := meta->>'title'; text_value := node_value#>>'{body,text}';
    END IF;
    IF COALESCE(meta->>'message_id','')='' OR COALESCE(title_value,'')='' OR COALESCE(text_value,'')=''
      OR COALESCE(meta->>'risk_level','') NOT IN ('unclassified','low','medium','high','critical')
      OR jsonb_typeof(meta->'copy_allowed') IS DISTINCT FROM 'boolean' THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF meta->>'risk_level'='unclassified' OR (node_value#>>'{body,kind}'<>'message' AND (meta->>'copy_allowed')::boolean) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
    END IF;
    IF (title_value LIKE '%过敏%' OR text_value LIKE '%过敏%') AND (text_value NOT LIKE '%停手%' OR text_value NOT LIKE '%确认%') THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','SAFETY_REVIEW_REQUIRED'));
    END IF;
    messages := messages||jsonb_build_array(jsonb_build_object('message_id',meta->>'message_id','node_id',node_value->>'id',
      'title',title_value,'body',text_value,'risk_level',meta->>'risk_level','copy_allowed',meta->'copy_allowed'));
  END LOOP;
  FOR edge_value IN SELECT value FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') LOOP
    SELECT value INTO meta FROM jsonb_array_elements(annotations.edges) WHERE value->>'branch_id'=edge_value->>'id';
    IF meta IS NULL OR COALESCE(meta->>'option','')='' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'from')
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'to')
      OR (edge_value#>>'{action,kind}'='choice' AND meta->>'option' IS DISTINCT FROM edge_value#>>'{action,label}') THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=edge_value->>'from' AND (value->>'terminal')::boolean) THEN
      RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','TERMINAL_HAS_OUTGOING_EDGE'));
    END IF;
    edges := edges||jsonb_build_array(jsonb_build_object('branch_id',edge_value->>'id','source_node_id',edge_value->>'from',
      'option',meta->>'option','target_node_id',edge_value->>'to','is_unresolved',false));
  END LOOP;
  WITH RECURSIVE reach(a,b) AS (
    SELECT edge->>'source_node_id',edge->>'target_node_id' FROM jsonb_array_elements(edges) edge
    UNION SELECT reach.a,edge->>'target_node_id' FROM reach
      JOIN jsonb_array_elements(edges) edge ON edge->>'source_node_id'=reach.b
  ) SELECT CASE WHEN EXISTS(SELECT 1 FROM reach WHERE a=b) THEN -1 ELSE
      1+(SELECT count(*)::integer FROM reach WHERE a=graph.graph_payload#>>'{definition,header,startNodeId}') END INTO visited_count;
  IF visited_count<>node_count OR (SELECT count(DISTINCT n->>'node_id') FROM jsonb_array_elements(nodes) n)<>node_count
    OR (SELECT count(DISTINCT n->>'sequence') FROM jsonb_array_elements(nodes) n)<>node_count
    OR (SELECT count(DISTINCT m->>'message_id') FROM jsonb_array_elements(messages) m)<>jsonb_array_length(messages)
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(nodes) WHERE value->>'node_id'=graph.graph_payload#>>'{definition,header,startNodeId}') THEN
    RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED'));
  END IF;
  -- Only authored terms participate. Several matches for one target still count once.
  SELECT count(DISTINCT target) INTO match_count FROM (
    SELECT value AS term,graph.graph_payload#>>'{definition,header,startNodeId}' AS target
      FROM jsonb_array_elements_text(graph.graph_payload#>'{definition,header,entryTerms}')
    UNION ALL SELECT term,edge->>'to' FROM jsonb_array_elements(graph.graph_payload#>'{definition,edges}') edge
      CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(edge#>'{action,matchTerms}','[]')) term
  ) terms WHERE length(btrim(term))>0 AND position(content_intake.sop_query_normalize(term) in content_intake.sop_query_normalize(p_query_text))>0;
  IF match_count>1 THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('blocked','GRAPH_UNRESOLVED')); END IF;
  matched := match_count=1;
  IF deadline<=clock_timestamp() THEN RETURN content_intake.complete_sop_query(binding_hash,p_request_id,content_intake.sop_query_closed('stale','LEASE_EXPIRED',release_id_value)); END IF;
  IF lease.lease_id IS NULL THEN
    lease := content_intake.issue_sop_query_lease('sopl_'||encode(public.digest(binding_hash||p_request_id::text,'sha256'),'hex'),
      binding_hash,release_id_value,p_request_id,body_hash,p_context_generation,at_time,deadline,actor.revocation_generation);
  END IF;
  IF lease.expires_at>deadline THEN
    RETURN content_intake.sop_query_closed('stale','LEASE_EXPIRED',release_id_value);
  END IF;
  IF prior_result IS NOT NULL THEN RETURN prior_result; END IF;
  RETURN content_intake.complete_sop_query(binding_hash,p_request_id,jsonb_build_object('status',CASE WHEN matched THEN 'ready' ELSE 'no_match' END,'release_id',release_id_value,
    'lease_expires_at',to_char(least(lease.expires_at,deadline) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reasons','[]'::jsonb,'result',CASE WHEN matched THEN jsonb_build_object('entry_node_id',graph.graph_payload#>>'{definition,header,startNodeId}',
      'nodes',nodes,'branches',edges,'messages',messages,'media_refs','[]'::jsonb)
      ELSE jsonb_build_object('nodes','[]'::jsonb,'branches','[]'::jsonb,'messages','[]'::jsonb,'media_refs','[]'::jsonb) END));
END $$;
ALTER FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_query(text,text,text,text,text,text,text,text,uuid) TO intake_usage;
