-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0087_sop_unified_continuation; source verified SOP continuation implementation; overlay_sha256=aa8808e02893abe258d6f8f834b792444a321938fff5c8659f873b5ab338afc8
-- contract_set_id=cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f
-- source_git_sha=812a2e80584f08675fab8b7401ce8b4cd3ab5bca
-- source_schema_sha256=2ed15384fd2e1d0a4993dfebc40e68980b4ef8f4f1effe172b656f3c3c63cd12
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Canonical 005D implementation input. Register after the immutable 0086 query
-- owner is received. This file is not an independently installable migration.

-- Keep one graph-integrity owner. Existing callers retain their whole-release
-- check, while a locked continuation checks only its pinned flow and dependencies.
DO $scoped_guard$
DECLARE body text; patched text;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='content_intake.assert_sop_graph_release(text,text)'::regprocedure;
  IF encode(public.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '08ce2c844d2b5b239c0770e8d17ccf833bed87e0d090da655a770fe2a719150d' THEN
    RAISE EXCEPTION 'Pinned 0085 graph integrity owner differs';
  END IF;
  patched:=replace(body,'WHERE lineage.release_id=p_release LOOP',
    'WHERE lineage.release_id=p_release AND (p_source IS NULL OR lineage.source_id=p_source) AND (p_flow IS NULL OR lineage.flow_id=p_flow) LOOP');
  patched:=replace(patched,'WHERE rm.release_id=p_release AND',
    'WHERE rm.release_id=p_release AND (p_source IS NULL OR rm.source_id=p_source) AND (p_flow IS NULL OR rm.flow_id=p_flow) AND');
  EXECUTE format('CREATE FUNCTION content_intake.assert_sop_graph_scope(p_release text,p_pending text,p_source text,p_flow text)
    RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',patched);
END $scoped_guard$;
ALTER FUNCTION content_intake.assert_sop_graph_scope(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.assert_sop_graph_scope(text,text,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE OR REPLACE FUNCTION content_intake.assert_sop_graph_release(p_release text,p_pending text DEFAULT NULL) RETURNS timestamptz
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.assert_sop_graph_scope(p_release,p_pending,NULL::text,NULL::text);
$$;

DO $scoped_projection$
DECLARE body text; patched text; lease_start integer; projection_start integer;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='content_intake.read_sop_graph_current(text,text)'::regprocedure;
  IF encode(public.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '155528e1cf4ecb1b9558c7d75e6f351e4ff64b3fa3dca2562dc0d64ca0af975a' THEN
    RAISE EXCEPTION 'Pinned 0085 graph projection owner differs';
  END IF;
  lease_start:=strpos(body,'  SELECT e.*,ctx.product_ids');
  projection_start:=strpos(body,'  until_at:=content_intake.assert_sop_graph_release(lease.release_id);');
  IF lease_start=0 OR projection_start<=lease_start THEN RAISE EXCEPTION 'Pinned projection boundaries differ'; END IF;
  patched:=substring(body FROM 1 FOR lease_start-1)||substring(body FROM projection_start);
  patched:=replace(patched,'DECLARE lease record; item record;','DECLARE item record;');
  patched:=replace(patched,'lease.release_id','p_release');
  patched:=replace(patched,'lease.product_ids','p_products');
  patched:=replace(patched,'lease.scenario_ids','p_scenarios');
  patched:=replace(patched,'lease.valid_until','p_until');
  patched:=replace(patched,'until_at:=content_intake.assert_sop_graph_release(p_release);',
    'until_at:=content_intake.assert_sop_graph_scope(p_release,NULL,p_source,p_flow);');
  patched:=replace(patched,'    JOIN content_intake.entitlement_scopes scopes ON scopes.source_id=l.source_id AND scopes.entitlement_hash=p_entitlement'||chr(10),'');
  patched:=replace(patched,'WHERE l.release_id=p_release AND',
    'WHERE l.release_id=p_release AND l.source_id=ANY(p_source_ids) AND (p_source IS NULL OR l.source_id=p_source) AND (p_flow IS NULL OR l.flow_id=p_flow) AND');
  EXECUTE format('CREATE FUNCTION content_intake.project_sop_authorized_graph(p_actor text,p_release text,p_products text[],p_scenarios text[],p_source_ids text[],p_until timestamptz,p_source text,p_flow text)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',patched);
END $scoped_projection$;
ALTER FUNCTION content_intake.project_sop_authorized_graph(text,text,text[],text[],text[],timestamptz,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.project_sop_authorized_graph(text,text,text[],text[],text[],timestamptz,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE FUNCTION content_intake.read_sop_graph_projection(p_actor text,p_entitlement text,p_source text,p_flow text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE lease record; sources text[];
BEGIN
  PERFORM backend_review.lock_content();
  SELECT e.*,ctx.product_ids,ctx.scenario_ids,ctx.session_token_hash INTO lease FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash) WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor
      AND e.valid_until>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  PERFORM intake_runtime.lock_product_session(lease.session_token_hash,lease.user_id);
  SELECT array_agg(source_id) INTO sources FROM content_intake.entitlement_scopes WHERE entitlement_hash=p_entitlement;
  RETURN content_intake.project_sop_authorized_graph(p_actor,lease.release_id,lease.product_ids,lease.scenario_ids,sources,lease.valid_until,p_source,p_flow);
END $$;
ALTER FUNCTION content_intake.read_sop_graph_projection(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_graph_projection(text,text,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE OR REPLACE FUNCTION content_intake.read_sop_graph_current(p_actor text,p_entitlement text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT e.release_id INTO target FROM content_intake.entitlements e WHERE e.entitlement_hash=p_entitlement
    AND e.principal_id=p_actor AND e.valid_until>clock_timestamp() AND e.sop_continuation_hash IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  IF target IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_RELEASE_CHANGED';
  END IF;
  RETURN content_intake.read_sop_graph_projection(p_actor,p_entitlement,NULL::text,NULL::text);
END $$;

DO $query_assembly$
DECLARE body text; patched text;
BEGIN
  SELECT prosrc INTO body FROM pg_proc WHERE oid='content_intake.read_sop_unified_query_bundle(text,text,uuid)'::regprocedure;
  IF encode(public.digest(convert_to(body,'UTF8'),'sha256'),'hex') IS DISTINCT FROM
    '95ae1e86dbc53b83614f66a0bb130b3fed2a0bf922a867e7818c7bf6dc8a3707' THEN
    RAISE EXCEPTION 'Pinned 0086 query assembly owner differs'; END IF;
  patched:=replace(body,$current_proof$  IF NOT EXISTS(SELECT 1 FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement
    AND principal_id=p_actor AND contract_view='graph') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
$current_proof$,'');
  patched:=replace(patched,'current_graphs:=content_intake.read_sop_graph_current(p_actor,p_entitlement);','current_graphs:=p_projection;');
  patched:=replace(patched,'(SELECT release_id FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement)','p_release');
  patched:=replace(patched,'AND (p_request IS NULL OR f.facts_version=pinned.facts_version)',
    'AND (p_request IS NULL OR f.facts_version=pinned.facts_version) AND (p_facts IS NULL OR f.facts_version=p_facts)');
  EXECUTE format('CREATE FUNCTION content_intake.project_sop_query_bundle(p_actor text,p_entitlement text,p_release text,p_request uuid,p_projection jsonb,p_facts bigint)
    RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS %L',patched);
END $query_assembly$;
ALTER FUNCTION content_intake.project_sop_query_bundle(text,text,text,uuid,jsonb,bigint) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.project_sop_query_bundle(text,text,text,uuid,jsonb,bigint)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE OR REPLACE FUNCTION content_intake.read_sop_unified_query_bundle(p_actor text,p_entitlement text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; projection jsonb;
BEGIN
  SELECT release_id INTO target FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement
    AND principal_id=p_actor AND contract_view='graph';
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  projection:=content_intake.read_sop_graph_current(p_actor,p_entitlement);
  RETURN content_intake.project_sop_query_bundle(p_actor,p_entitlement,target,p_request,projection,NULL::bigint);
END $$;

ALTER TABLE content_intake.sop_active_uses ADD COLUMN termination_reason text
  CHECK (termination_reason IN ('finished','logout','content-disabled','source-suspended','content-expired'));
ALTER TABLE content_intake.sop_active_uses ADD CONSTRAINT sop_active_termination_state
  CHECK (closed_at IS NOT NULL OR termination_reason IS NULL);
ALTER TABLE content_intake.sop_active_uses ADD CONSTRAINT sop_active_original_binding
  FOREIGN KEY(release_id,source_binding_hash) REFERENCES public.content_releases(release_id,source_binding_hash);
ALTER TABLE content_intake.sop_active_uses ADD COLUMN facts_candidate_id content_intake.identifier,
  ADD COLUMN facts_candidate_version content_intake.version, ADD COLUMN facts_version content_intake.version;
ALTER TABLE content_intake.sop_active_uses ADD CONSTRAINT sop_active_facts_complete CHECK
  ((facts_candidate_id IS NULL AND facts_candidate_version IS NULL AND facts_version IS NULL)
    OR (facts_candidate_id IS NOT NULL AND facts_candidate_version IS NOT NULL AND facts_version IS NOT NULL));
ALTER TABLE content_intake.sop_active_uses ADD CONSTRAINT sop_active_original_facts
  FOREIGN KEY(facts_candidate_id,facts_candidate_version,source_id,flow_id,facts_version)
    REFERENCES content_intake.sop_query_fact_versions(candidate_id,candidate_version,source_id,flow_id,facts_version);
CREATE INDEX sop_active_session ON content_intake.sop_active_uses(session_hash) WHERE closed_at IS NULL;
CREATE INDEX sop_active_source ON content_intake.sop_active_uses(source_id) WHERE closed_at IS NULL;

CREATE FUNCTION content_intake.sop_active_history_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  IF OLD.closed_at IS NOT NULL OR
    (to_jsonb(NEW)-ARRAY['session_hash','closed_at','termination_reason']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['session_hash','closed_at','termination_reason'])
    OR (NEW.closed_at IS NOT NULL AND NEW.termination_reason IS NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sop_active_history BEFORE UPDATE OR DELETE ON content_intake.sop_active_uses
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_active_history_guard();

CREATE FUNCTION content_intake.terminate_sop_active_uses(p_hashes text[],p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF p_reason IS NULL OR p_reason NOT IN ('finished','logout','content-disabled','source-suspended','content-expired') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  -- Logout and publication can end several flows. Every bulk terminator takes
  -- active rows in the same order before the atomic session-reference cleanup.
  PERFORM 1 FROM content_intake.sop_active_uses WHERE continuation_hash=ANY(p_hashes) AND closed_at IS NULL
    ORDER BY continuation_hash FOR UPDATE;
  UPDATE content_intake.sop_active_uses SET closed_at=greatest(clock_timestamp(),started_at),session_hash=NULL,termination_reason=p_reason
    WHERE continuation_hash=ANY(p_hashes) AND closed_at IS NULL;
END $$;
ALTER FUNCTION content_intake.terminate_sop_active_uses(text[],text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.terminate_sop_active_uses(text[],text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

-- Immutable publication sequence, rather than current or wall-clock time,
-- distinguishes a new opening from a flow that crossed a permanent stop.
CREATE FUNCTION content_intake.sop_active_crossed_stop(p_hash text) RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM content_intake.sop_active_uses active
    JOIN public.content_releases opened ON opened.release_id=active.release_id
    JOIN content_intake.sop_graph_release_lineage original ON original.release_id=active.release_id
      AND original.source_id=active.source_id AND original.flow_id=active.flow_id
    JOIN content_intake.sop_graph_versions graph ON graph.candidate_id=original.candidate_id AND graph.candidate_version=original.candidate_version
      AND graph.source_id=original.source_id AND graph.flow_id=original.flow_id AND graph.flow_version=original.flow_version AND graph.graph_digest=original.graph_digest
    JOIN content_intake.entitlement_contexts ctx ON ctx.entitlement_hash=active.opened_entitlement_hash
    WHERE active.continuation_hash=p_hash AND (
      EXISTS(SELECT 1 FROM content_intake.sop_graph_disable_events stop
        JOIN public.content_releases stopped ON stopped.release_id=stop.release_id
        WHERE stop.source_id=active.source_id AND stopped.release_seq>opened.release_seq AND
          ((stop.target_kind='flow' AND stop.target_id=active.flow_id) OR
           (stop.target_kind='resource' AND (
             EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'media') media
               WHERE media->>'resourceId'=stop.target_id
                 AND content_intake.sop_graph_selection(media->'applicability',ctx.product_ids,ctx.scenario_ids))
             OR EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload#>'{definition,nodes}') node
               CROSS JOIN LATERAL jsonb_array_elements(node#>'{body,knowledge}') knowledge
               WHERE knowledge#>>'{resourceBinding,resourceId}'=stop.target_id)))))
      OR EXISTS(SELECT 1 FROM content_intake.release_lineage tombstone
        JOIN public.content_releases stopped ON stopped.release_id=tombstone.release_id
        JOIN content_intake.candidate_versions candidate ON candidate.candidate_id=tombstone.candidate_id AND candidate.version=tombstone.candidate_version
        CROSS JOIN LATERAL jsonb_array_elements(candidate.material->'entries') entry
        WHERE tombstone.source_id=active.source_id AND stopped.release_seq>opened.release_seq
          AND entry->>'operation'='disable' AND entry->>'businessEntryId'=tombstone.business_entry_id
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(graph.graph_payload->'entries') dependency
            WHERE dependency#>>'{entry,businessEntryId}'=tombstone.business_entry_id))));
$$;
ALTER FUNCTION content_intake.sop_active_crossed_stop(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_active_crossed_stop(text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.lock_sop_active_use(p_actor text,p_session text,p_hash text,p_rebind boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active content_intake.sop_active_uses; who content_intake.principals; previous record; payload jsonb;
  at_now timestamptz:=clock_timestamp(); reason text; observed_session text; actual_template text;
  pinned_candidate text; pinned_version bigint;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  SELECT * INTO active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash;
  IF NOT FOUND OR active.principal_id<>p_actor THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED';
  END IF;
  IF active.closed_at IS NOT NULL THEN
    PERFORM 1 FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash FOR UPDATE;
    RETURN jsonb_build_object('kind','closed');
  END IF;
  observed_session:=active.session_hash;
  -- Logout holds its old session row before its active-row trigger. Acquire that
  -- same session proof before the active lock, then verify the observed binding.
  SELECT s.expires_at,s.revoked_at,b.user_id INTO previous FROM backend_identity.sessions s
    JOIN backend_identity.subject_bindings b USING(binding_id) WHERE s.token_hash=observed_session FOR SHARE OF s,b;
  IF NOT FOUND OR previous.user_id<>who.user_id THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED';
  END IF;
  SELECT * INTO STRICT active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash FOR UPDATE;
  IF active.closed_at IS NOT NULL THEN RETURN jsonb_build_object('kind','closed'); END IF;
  IF active.session_hash IS DISTINCT FROM observed_session THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  at_now:=clock_timestamp();
  IF previous.revoked_at IS NOT NULL THEN reason:='logout'; END IF;
  SELECT v.graph_payload,c.material->>'templateVersion',l.candidate_id,l.candidate_version INTO STRICT payload,actual_template,pinned_candidate,pinned_version FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    WHERE l.release_id=active.release_id AND l.source_id=active.source_id AND l.flow_id=active.flow_id;
  IF actual_template IS DISTINCT FROM 'sop-manual-authoring-v1.1' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID'; END IF;
  IF active.facts_candidate_id IS DISTINCT FROM pinned_candidate OR active.facts_candidate_version IS DISTINCT FROM pinned_version
    OR active.facts_version IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  IF (payload#>>'{definition,header,effectiveTo}')::timestamptz<=at_now
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(payload->'entries') e
      WHERE (e#>>'{entry,effectiveTo}')::timestamptz<=at_now) THEN reason:='content-expired'; END IF;
  IF EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.sources s ON s.source_id=l.source_id
    WHERE l.release_id=active.release_id AND l.source_id=active.source_id AND l.flow_id=active.flow_id
      AND (s.mode<>'v2-preview' OR s.current_mapping_version<>c.source_version)) THEN reason:='source-suspended'; END IF;
  IF content_intake.sop_active_crossed_stop(p_hash) THEN reason:='content-disabled'; END IF;
  IF reason IS NOT NULL THEN
    PERFORM content_intake.terminate_sop_active_uses(ARRAY[p_hash],reason);
    RETURN jsonb_build_object('kind','closed');
  END IF;
  IF active.session_hash<>p_session THEN
    IF NOT p_rebind OR previous.expires_at>at_now THEN
      RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED';
    END IF;
    UPDATE content_intake.sop_active_uses SET session_hash=p_session WHERE continuation_hash=p_hash RETURNING * INTO active;
  END IF;
  RETURN jsonb_build_object('kind','active','binding',to_jsonb(active));
END $$;

-- Open has no query request ID on its frozen wire. Exact same-session,
-- selection and graph proofs must therefore agree on one consumed fact version.
-- Ambiguous observations are blocked; neither recency nor the latest annotation
-- can silently choose the permission set that Main consumed.
CREATE FUNCTION content_intake.resolve_sop_open_facts(p_actor text,p_session text,p_entitlement text,
  p_release text,p_key jsonb,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE matches jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('candidateId',binding.candidate_id,
    'candidateVersion',binding.candidate_version,'version',binding.facts_version)),'[]'::jsonb) INTO matches
    FROM content_intake.sop_unified_query_bindings binding
    JOIN content_intake.sop_query_leases lease USING(lease_id)
    JOIN content_intake.sop_query_fact_versions facts USING(candidate_id,candidate_version,source_id,flow_id,facts_version)
    JOIN content_intake.sop_graph_release_lineage original ON original.release_id=p_release
      AND original.candidate_id=facts.candidate_id AND original.candidate_version=facts.candidate_version
      AND original.source_id=facts.source_id AND original.flow_id=facts.flow_id AND original.graph_digest=facts.graph_digest
    JOIN content_intake.entitlements queried ON queried.entitlement_hash=binding.entitlement_hash
    JOIN content_intake.entitlement_contexts query_context ON query_context.entitlement_hash=queried.entitlement_hash
    JOIN content_intake.entitlements opening ON opening.entitlement_hash=p_entitlement
    JOIN content_intake.entitlement_contexts opening_context ON opening_context.entitlement_hash=opening.entitlement_hash
    JOIN content_intake.principals principal ON principal.principal_id=binding.principal_id
    WHERE binding.principal_id=p_actor AND binding.session_hash=p_session AND lease.release_id=p_release
      AND lease.expires_at>clock_timestamp() AND lease.session_epoch=principal.revocation_generation
      AND binding.source_id=p_key->>'sourceId' AND binding.flow_id=p_key->>'flowId' AND facts.graph_digest=p_digest
      AND queried.principal_generation=principal.revocation_generation AND queried.shop_id=opening.shop_id
      AND query_context.product_ids=opening_context.product_ids AND query_context.scenario_ids=opening_context.scenario_ids;
  IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  RETURN matches->0;
END $$;
ALTER FUNCTION content_intake.resolve_sop_open_facts(text,text,text,text,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.resolve_sop_open_facts(text,text,text,text,jsonb,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.open_sop_active_use(p_actor text,p_session text,p_hash text,p_entitlement text,
  p_context bigint,p_release text,p_key jsonb,p_digest text,p_node text,p_create boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active content_intake.sop_active_uses; who content_intake.principals; proof record; graph record; facts jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  SELECT * INTO active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash;
  IF FOUND THEN
    IF active.principal_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    IF active.opened_entitlement_hash<>p_entitlement OR active.context_generation<>p_context OR active.release_id<>p_release
      OR active.source_id IS DISTINCT FROM p_key->>'sourceId' OR active.flow_id IS DISTINCT FROM p_key->>'flowId'
      OR active.flow_version::text IS DISTINCT FROM p_key->>'flowVersion' OR active.graph_digest<>p_digest THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID';
    END IF;
    IF NOT EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
      JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
      WHERE l.release_id=active.release_id AND l.source_id=active.source_id AND l.flow_id=active.flow_id
        AND v.graph_payload#>>'{definition,header,startNodeId}'=p_node) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
    END IF;
    RETURN content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,true);
  END IF;
  SELECT e.*,ctx.session_token_hash,ctx.product_ids,ctx.scenario_ids,lease.source_binding_hash INTO proof FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    JOIN public.snapshot_offline_leases lease USING(lease_token_hash)
    WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.user_id=who.user_id
      AND ctx.session_token_hash=p_session AND e.context_generation=p_context AND e.contract_view='graph'
      AND e.sop_continuation_hash IS NULL AND e.valid_until>clock_timestamp() AND lease.expires_at>clock_timestamp()
      AND e.principal_generation=who.revocation_generation;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  IF proof.release_id<>p_release OR p_release IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_RELEASE_CHANGED';
  END IF;
  SELECT l.*,v.graph_payload,c.material INTO graph FROM content_intake.sop_graph_release_lineage l
    JOIN content_intake.sop_graph_versions v USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    JOIN content_intake.candidate_versions c ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
    JOIN content_intake.sources s ON s.source_id=l.source_id
    JOIN content_intake.entitlement_scopes es ON es.entitlement_hash=p_entitlement AND es.source_id=l.source_id
    WHERE l.release_id=p_release AND l.source_id=p_key->>'sourceId' AND l.flow_id=p_key->>'flowId'
      AND l.flow_version::text=p_key->>'flowVersion' AND l.graph_digest=p_digest
      AND c.state='published' AND c.source_version=s.current_mapping_version AND s.mode='v2-preview'
      AND content_intake.authorization_deadline(p_actor,'query',s.scope_id,s.source_id,clock_timestamp())>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  IF graph.material->>'templateVersion'<>'sop-manual-authoring-v1.1'
    OR graph.graph_payload#>>'{definition,header,startNodeId}'<>p_node THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID';
  END IF;
  facts:=content_intake.resolve_sop_open_facts(p_actor,p_session,p_entitlement,p_release,p_key,p_digest);
  IF NOT p_create THEN
    RETURN jsonb_build_object('kind','opening','binding',jsonb_build_object('principal_id',p_actor,'session_hash',p_session,
      'opened_entitlement_hash',p_entitlement,'context_generation',p_context,'release_id',p_release,'source_id',graph.source_id,
      'flow_id',graph.flow_id,'flow_version',graph.flow_version,'graph_digest',graph.graph_digest,
      'facts_candidate_id',facts->>'candidateId','facts_candidate_version',facts->'candidateVersion','facts_version',facts->'version'),
      'selection',jsonb_build_object('shopId',proof.shop_id,'productIds',proof.product_ids,'scenarioIds',proof.scenario_ids));
  END IF;
  INSERT INTO content_intake.sop_active_uses(continuation_hash,principal_id,session_hash,opened_entitlement_hash,
    context_generation,source_binding_hash,release_id,source_id,flow_id,flow_version,graph_digest,started_at,
    facts_candidate_id,facts_candidate_version,facts_version)
    VALUES(p_hash,p_actor,p_session,p_entitlement,p_context,proof.source_binding_hash,p_release,
      graph.source_id,graph.flow_id,graph.flow_version,graph.graph_digest,clock_timestamp(),
      facts->>'candidateId',(facts->>'candidateVersion')::bigint,(facts->>'version')::bigint);
  RETURN content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,false);
END $$;

CREATE FUNCTION content_intake.close_sop_active_use(p_actor text,p_session text,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active content_intake.sop_active_uses; user_id text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT p.user_id INTO STRICT user_id FROM content_intake.principals p WHERE p.principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,user_id);
  SELECT * INTO active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR active.principal_id<>p_actor THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  IF active.closed_at IS NULL THEN
    PERFORM content_intake.terminate_sop_active_uses(ARRAY[p_hash],'finished');
  END IF;
END $$;

CREATE FUNCTION content_intake.sop_active_session_revoked() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM content_intake.terminate_sop_active_uses(ARRAY(SELECT continuation_hash FROM content_intake.sop_active_uses
    WHERE session_hash=NEW.token_hash AND closed_at IS NULL),'logout');
  RETURN NULL;
END $$;
CREATE TRIGGER sop_active_logout AFTER UPDATE OF revoked_at ON backend_identity.sessions
  FOR EACH ROW WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION content_intake.sop_active_session_revoked();

CREATE FUNCTION content_intake.sop_active_source_suspended() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM content_intake.terminate_sop_active_uses(ARRAY(SELECT active.continuation_hash FROM content_intake.sop_active_uses active
    WHERE active.source_id=NEW.source_id AND active.closed_at IS NULL AND EXISTS(
      SELECT 1 FROM content_intake.sop_graph_release_lineage l JOIN content_intake.candidate_versions c
        ON c.candidate_id=l.candidate_id AND c.version=l.candidate_version
      WHERE l.release_id=active.release_id AND l.source_id=active.source_id AND l.flow_id=active.flow_id
        AND (NEW.mode<>'v2-preview' OR NEW.current_mapping_version<>c.source_version))),'source-suspended');
  RETURN NULL;
END $$;
CREATE TRIGGER sop_active_source_version AFTER UPDATE OF current_mapping_version,mode ON content_intake.sources
  FOR EACH ROW WHEN (OLD.current_mapping_version IS DISTINCT FROM NEW.current_mapping_version OR OLD.mode IS DISTINCT FROM NEW.mode)
  EXECUTE FUNCTION content_intake.sop_active_source_suspended();

CREATE FUNCTION content_intake.sop_active_graph_disabled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM content_intake.terminate_sop_active_uses(ARRAY(SELECT active.continuation_hash FROM content_intake.sop_active_uses active
    WHERE active.source_id=NEW.source_id AND active.closed_at IS NULL
      AND content_intake.sop_active_crossed_stop(active.continuation_hash)),'content-disabled');
  RETURN NULL;
END $$;
CREATE TRIGGER sop_active_disable AFTER INSERT ON content_intake.sop_graph_disable_events
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_active_graph_disabled();

ALTER FUNCTION content_intake.sop_active_history_guard() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.lock_sop_active_use(text,text,text,boolean) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.close_sop_active_use(text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_active_session_revoked() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_active_source_suspended() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_active_graph_disabled() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_active_history_guard(),content_intake.lock_sop_active_use(text,text,text,boolean),
  content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean),content_intake.close_sop_active_use(text,text,text),
  content_intake.sop_active_session_revoked(),content_intake.sop_active_source_suspended(),content_intake.sop_active_graph_disabled()
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.sop_active_entry_disabled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM content_intake.candidate_versions c CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') e
    WHERE c.candidate_id=NEW.candidate_id AND c.version=NEW.candidate_version
      AND e->>'businessEntryId'=NEW.business_entry_id AND e->>'operation'='disable') THEN
    PERFORM content_intake.terminate_sop_active_uses(ARRAY(SELECT active.continuation_hash FROM content_intake.sop_active_uses active
      WHERE active.source_id=NEW.source_id AND active.closed_at IS NULL
        AND content_intake.sop_active_crossed_stop(active.continuation_hash)),'content-disabled');
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER sop_active_entry_stop AFTER INSERT ON content_intake.release_lineage
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_active_entry_disabled();

ALTER FUNCTION content_intake.sop_active_entry_disabled() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_active_entry_disabled() FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

-- Both values are existing server-issued opaque IDs on the frozen media wire.
-- Resolving a C preview grants only its stored full binding, never the other
-- flows visible through C's private underlying entitlement.
CREATE FUNCTION content_intake.resolve_sop_media_entitlement(p_actor text,p_session text,p_presented text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result text;
BEGIN
  SELECT e.entitlement_hash INTO result FROM content_intake.entitlements e
    JOIN content_intake.principals principal ON principal.principal_id=e.principal_id AND principal.user_id=e.user_id
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    WHERE e.entitlement_hash=p_presented AND e.principal_id=p_actor AND ctx.session_token_hash=p_session;
  IF result IS NOT NULL THEN RETURN result; END IF;
  SELECT e.entitlement_hash INTO result FROM content_intake.sop_query_previews preview
    JOIN content_intake.sop_unified_query_bindings binding USING(lease_id)
    JOIN content_intake.entitlements e ON e.entitlement_hash=binding.entitlement_hash
    JOIN content_intake.entitlement_contexts ctx ON ctx.entitlement_hash=e.entitlement_hash
    WHERE preview.handle_hash=p_presented AND binding.principal_id=p_actor AND binding.session_hash=p_session
      AND e.principal_id=p_actor AND ctx.session_token_hash=p_session AND e.contract_view='graph' AND e.sop_continuation_hash IS NULL;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  RETURN result;
END $$;
ALTER FUNCTION content_intake.resolve_sop_media_entitlement(text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.resolve_sop_media_entitlement(text,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.authorize_sop_continuation_resource(p_actor text,p_session text,p_address jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who content_intake.principals; source_value text; scope_value text; entitlement_value text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO who FROM content_intake.principals WHERE principal_id=p_actor;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  IF p_address->>'kind'='close' THEN
    IF NOT EXISTS(SELECT 1 FROM content_intake.sop_active_uses active WHERE active.continuation_hash=p_address->>'continuation'
      AND active.principal_id=p_actor) THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    RETURN;
  END IF;
  SELECT active.source_id INTO source_value FROM content_intake.sop_active_uses active
    WHERE active.continuation_hash=p_address->>'continuation' AND active.principal_id=p_actor;
  IF source_value IS NULL AND p_address->>'kind' IN ('open','media') THEN
    entitlement_value:=p_address->>'entitlement';
    IF p_address->>'kind'='media' THEN
      entitlement_value:=content_intake.resolve_sop_media_entitlement(p_actor,p_session,entitlement_value); END IF;
    SELECT scopes.source_id INTO source_value FROM content_intake.entitlements e
      JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
      JOIN content_intake.entitlement_scopes scopes USING(entitlement_hash)
      WHERE e.entitlement_hash=entitlement_value AND e.principal_id=p_actor AND e.user_id=who.user_id
        AND ctx.session_token_hash=p_session AND scopes.source_id=p_address->>'sourceId';
  END IF;
  SELECT scope_id INTO scope_value FROM content_intake.sources WHERE source_id=source_value;
  IF scope_value IS NULL OR content_intake.authorization_deadline(p_actor,'query',scope_value,source_value,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED';
  END IF;
END $$;
ALTER FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb),content_intake.close_sop_active_use(text,text,text)
  TO intake_usage;

CREATE FUNCTION content_intake.sop_media_usage_context(p_actor text,p_session text,p_presented text,p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entitlement_value text; result jsonb;
BEGIN
  PERFORM content_intake.authorize_sop_continuation_resource(p_actor,p_session,
    jsonb_build_object('kind','media','entitlement',p_presented,'sourceId',p_source));
  entitlement_value:=content_intake.resolve_sop_media_entitlement(p_actor,p_session,p_presented);
  SELECT jsonb_build_object('shopId',e.shop_id,'contextGeneration',e.context_generation,
      'productIds',ctx.product_ids,'scenarioIds',ctx.scenario_ids) INTO STRICT result
    FROM content_intake.entitlements e JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    WHERE e.entitlement_hash=entitlement_value;
  RETURN result;
END $$;
ALTER FUNCTION content_intake.sop_media_usage_context(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_media_usage_context(text,text,text,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.sop_media_usage_context(text,text,text,text) TO intake_usage;

-- The attachment descriptor is owned by C. This wrapper derives historical
-- release/flow authority only from the locked active row, then projects through
-- B's common graph owner. No URL or caller-provided storage object is accepted.
CREATE FUNCTION content_intake.read_sop_continuation_media(p_actor text,p_session text,p_entitlement text,
  p_release text,p_binding jsonb,p_continuation text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who content_intake.principals; lease record; active_state jsonb; active jsonb; bundle jsonb; media jsonb;
  until_at timestamptz; at_now timestamptz; granted_until timestamptz; entitlement_value text;
  preview content_intake.sop_query_previews; query_until timestamptz;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  entitlement_value:=content_intake.resolve_sop_media_entitlement(p_actor,p_session,p_entitlement);
  SELECT * INTO preview FROM content_intake.sop_query_previews WHERE handle_hash=p_entitlement;
  IF FOUND THEN
    SELECT expires_at INTO query_until FROM content_intake.sop_query_leases WHERE lease_id=preview.lease_id
      AND session_epoch=who.revocation_generation;
    IF query_until IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  END IF;
  SELECT e.*,ctx.session_token_hash,l.expires_at INTO lease FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    JOIN public.snapshot_offline_leases l USING(lease_token_hash)
    WHERE e.entitlement_hash=entitlement_value AND e.principal_id=p_actor AND e.user_id=who.user_id
      AND ctx.session_token_hash=p_session AND e.contract_view='graph';
  IF NOT FOUND OR lease.release_id<>p_release OR lease.principal_generation<>who.revocation_generation THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  IF p_continuation IS NULL THEN
    IF lease.sop_continuation_hash IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    IF lease.release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_RELEASE_CHANGED'; END IF;
  ELSE
    IF lease.sop_continuation_hash IS DISTINCT FROM p_continuation THEN
      RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    active_state:=content_intake.lock_sop_active_use(p_actor,p_session,p_continuation);
    IF active_state->>'kind'='closed' THEN RETURN active_state; END IF;
    active:=active_state->'binding';
    IF active->>'release_id'<>lease.release_id OR active->>'source_id' IS DISTINCT FROM p_binding->>'sourceId'
      OR active->>'flow_id' IS DISTINCT FROM p_binding->>'flowId' THEN
      RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  END IF;
  at_now:=clock_timestamp();
  IF least(lease.valid_until,lease.expires_at,preview.expires_at,query_until)<=at_now THEN RETURN jsonb_build_object('kind','expired'); END IF;
  IF p_continuation IS NULL THEN bundle:=content_intake.read_sop_graph_current(p_actor,entitlement_value);
  ELSE bundle:=content_intake.read_sop_graph_projection(p_actor,entitlement_value,active->>'source_id',active->>'flow_id'); END IF;
  SELECT m INTO media FROM jsonb_array_elements(bundle->'graphs') graph
    CROSS JOIN LATERAL jsonb_array_elements(graph#>'{payload,media}') m
    WHERE m#>>'{flowKey,sourceId}'=p_binding->>'sourceId' AND m#>>'{flowKey,flowId}'=p_binding->>'flowId'
      AND m->>'objectId'=p_binding->>'objectId' AND m->>'resourceId'=p_binding->>'resourceId'
      AND CASE WHEN m ? 'entry' THEN 'entry' ELSE m#>>'{graphTarget,kind}' END=p_binding->>'ownerKind'
      AND CASE WHEN m ? 'entry' THEN m#>>'{entry,businessEntryId}' ELSE m#>>'{graphTarget,id}' END=p_binding->>'ownerId';
  IF media IS NULL OR (preview.handle_hash IS NOT NULL AND preview.binding IS DISTINCT FROM media) THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  granted_until:=content_intake.authorization_deadline(p_actor,'query',
    (SELECT scope_id FROM content_intake.sources WHERE source_id=p_binding->>'sourceId'),p_binding->>'sourceId',clock_timestamp());
  IF granted_until IS NULL OR granted_until<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  until_at:=least(lease.valid_until,lease.expires_at,preview.expires_at,query_until,(bundle->>'validUntil')::timestamptz,granted_until);
  IF until_at<=clock_timestamp() THEN RETURN jsonb_build_object('kind','expired'); END IF;
  RETURN jsonb_build_object('kind','selected','binding',media,'validUntil',until_at,
    'descriptor',content_intake.sop_query_media_descriptor(lease.release_id,media));
END $$;
ALTER FUNCTION content_intake.read_sop_continuation_media(text,text,text,text,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_continuation_media(text,text,text,text,jsonb,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_continuation_media(text,text,text,text,jsonb,text) TO intake_usage;

CREATE FUNCTION content_intake.prepare_sop_continuation(p_actor text,p_session text,p_hash text,p_rebind boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; active jsonb; selection jsonb; granted_until timestamptz;
BEGIN
  state:=content_intake.lock_sop_active_use(p_actor,p_session,p_hash,p_rebind);
  IF state->>'kind'='closed' THEN RETURN state; END IF;
  active:=state->'binding';
  SELECT content_intake.authorization_deadline(p_actor,'query',scope_id,source_id,clock_timestamp()) INTO granted_until
    FROM content_intake.sources WHERE source_id=active->>'source_id';
  IF granted_until IS NULL OR granted_until<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT jsonb_build_object('shopId',e.shop_id,'productIds',ctx.product_ids,'scenarioIds',ctx.scenario_ids)
    INTO STRICT selection FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    WHERE e.entitlement_hash=active->>'opened_entitlement_hash';
  RETURN state||jsonb_build_object('selection',selection);
END $$;
ALTER FUNCTION content_intake.prepare_sop_continuation(text,text,text,boolean) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.prepare_sop_continuation(text,text,text,boolean)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.prepare_sop_continuation(text,text,text,boolean) TO intake_usage;

CREATE FUNCTION content_intake.prepare_sop_action(p_actor text,p_session text,p_hash text,p_open jsonb,
  p_entitlement text,p_context bigint,p_rebind boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; lease record;
BEGIN
  IF p_open IS NOT NULL THEN
    RETURN content_intake.open_sop_active_use(p_actor,p_session,p_hash,p_open->>'entitlement',
      (p_open->>'contextGeneration')::bigint,p_open->>'releaseId',p_open->'key',p_open->>'graphDigest',p_open->>'nodeId',false);
  END IF;
  state:=content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,p_rebind);
  IF state->>'kind'='closed' THEN RETURN state; END IF;
  IF p_entitlement IS NOT NULL THEN
    SELECT e.*,snapshot.expires_at INTO lease FROM content_intake.entitlements e
      JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
      JOIN public.snapshot_offline_leases snapshot USING(lease_token_hash)
      JOIN content_intake.principals principal ON principal.principal_id=e.principal_id
      WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.user_id=principal.user_id
        AND e.sop_continuation_hash=p_hash AND e.contract_view='graph' AND ctx.session_token_hash=p_session
        AND e.context_generation=p_context AND e.release_id=state#>>'{binding,release_id}'
        AND e.principal_generation=principal.revocation_generation;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    IF least(lease.valid_until,lease.expires_at)<=clock_timestamp() THEN RETURN jsonb_build_object('kind','expired'); END IF;
  END IF;
  RETURN state;
END $$;
ALTER FUNCTION content_intake.prepare_sop_action(text,text,text,jsonb,text,bigint,boolean) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.prepare_sop_action(text,text,text,jsonb,text,bigint,boolean)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.prepare_sop_action(text,text,text,jsonb,text,bigint,boolean) TO intake_usage;

CREATE FUNCTION content_intake.read_sop_action_bundle(p_actor text,p_session text,p_hash text,p_open jsonb,
  p_entitlement text,p_context bigint,p_rebind boolean,p_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; active jsonb; selected jsonb; projection jsonb; bundle jsonb; media jsonb;
  session_until timestamptz; granted_until timestamptz; until_at timestamptz; who content_intake.principals;
BEGIN
  state:=content_intake.prepare_sop_action(p_actor,p_session,p_hash,p_open,p_entitlement,p_context,p_rebind);
  IF state->>'kind' IN ('closed','expired') THEN RETURN state; END IF;
  active:=state->'binding'; selected:=state->'selection';
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  session_until:=intake_runtime.lock_product_session(p_session,who.user_id);
  SELECT content_intake.authorization_deadline(p_actor,'query',scope_id,source_id,clock_timestamp()) INTO granted_until
    FROM content_intake.sources WHERE source_id=active->>'source_id';
  IF granted_until IS NULL OR granted_until<=clock_timestamp() OR p_until IS NULL OR NOT isfinite(p_until) THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  until_at:=least(p_until,session_until,granted_until);
  projection:=content_intake.project_sop_authorized_graph(p_actor,active->>'release_id',
    ARRAY(SELECT jsonb_array_elements_text(selected->'productIds')),ARRAY(SELECT jsonb_array_elements_text(selected->'scenarioIds')),
    ARRAY[active->>'source_id'],until_at,active->>'source_id',active->>'flow_id');
  -- C's one private assembly owner restores the full original payload/digest
  -- and exact publication facts. Its extraction is pinned to the received exact
  -- 86 source before registration; no working-draft C SQL is copied here.
  IF active->>'facts_version' IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  bundle:=content_intake.project_sop_query_bundle(p_actor,active->>'opened_entitlement_hash',active->>'release_id',NULL::uuid,projection,(active->>'facts_version')::bigint);
  SELECT coalesce(jsonb_agg(jsonb_build_object('binding',binding,
    'descriptor',content_intake.sop_query_media_descriptor(active->>'release_id',binding))),'[]'::jsonb) INTO media
    FROM jsonb_array_elements(bundle->'graphs') graph CROSS JOIN LATERAL jsonb_array_elements(graph->'selectedMedia') binding;
  RETURN jsonb_build_object('kind','bundle','bundle',bundle,'media',media);
END $$;
ALTER FUNCTION content_intake.read_sop_action_bundle(text,text,text,jsonb,text,bigint,boolean,timestamptz) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_action_bundle(text,text,text,jsonb,text,bigint,boolean,timestamptz)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_action_bundle(text,text,text,jsonb,text,bigint,boolean,timestamptz),
  content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean) TO intake_usage;

-- This owner alone can insert a historical snapshot lease. Its release and
-- original binding come only from the locked active row. Usage supplies the
-- freshly resolved session/selection deadline, never a caller-selected release.
GRANT INSERT ON public.snapshot_offline_leases TO intake_runtime_fn_owner;
CREATE FUNCTION content_intake.issue_sop_continuation_lease(p_actor text,p_session text,p_hash text,p_client text,p_until timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; active jsonb; who content_intake.principals; issued timestamptz; until_at timestamptz;
  granted_until timestamptz; bound timestamptz; token_hash text;
BEGIN
  state:=content_intake.lock_sop_active_use(p_actor,p_session,p_hash);
  IF state->>'kind'='closed' THEN RETURN state; END IF;
  active:=state->'binding';
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  SELECT content_intake.authorization_deadline(p_actor,'query',scope_id,source_id,clock_timestamp()) INTO granted_until
    FROM content_intake.sources WHERE source_id=active->>'source_id';
  IF granted_until IS NULL OR granted_until<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  IF p_client IS NULL OR btrim(p_client)='' OR p_until IS NULL OR NOT isfinite(p_until)
    OR p_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.content_releases WHERE release_id=active->>'release_id'
      AND source_binding_hash=active->>'source_binding_hash' AND tenant_id=who.tenant_id)
    OR EXISTS(SELECT 1 FROM content_intake.release_revocations WHERE release_id=active->>'release_id') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOURCE_MISMATCH'; END IF;
  bound:=content_intake.assert_sop_graph_scope(active->>'release_id',NULL,active->>'source_id',active->>'flow_id');
  -- A corrective rollback's own original approval remains a dependency even
  -- when the copied graph keeps its earlier publication policy and FK.
  IF EXISTS(SELECT 1 FROM content_intake.release_rollback_lineage lineage
    JOIN content_intake.review_bindings binding USING(review_request_id)
    LEFT JOIN content_intake.approval_current current USING(review_request_id)
    LEFT JOIN content_intake.approval_facts facts ON facts.review_request_id=current.review_request_id AND facts.facts_version=current.facts_version
    WHERE lineage.release_id=active->>'release_id' AND (facts.state IS DISTINCT FROM 'approved'
      OR facts.checked_at>clock_timestamp() OR facts.valid_until<=clock_timestamp()
      OR facts.package_verified_sha256 IS DISTINCT FROM binding.package_sha256)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='APPROVAL_UNAVAILABLE'; END IF;
  SELECT least(bound,min(facts.valid_until)) INTO bound FROM content_intake.release_rollback_lineage lineage
    JOIN content_intake.approval_current current USING(review_request_id)
    JOIN content_intake.approval_facts facts ON facts.review_request_id=current.review_request_id AND facts.facts_version=current.facts_version
    WHERE lineage.release_id=active->>'release_id';
  issued:=clock_timestamp();
  until_at:=least(issued+interval '5 minutes',p_until,granted_until,bound);
  IF until_at<=issued THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  token_hash:=encode(public.digest(public.gen_random_bytes(32),'sha256'),'hex');
  INSERT INTO public.snapshot_offline_leases(lease_token_hash,client_id,user_id,release_id,source_binding_hash,issued_at,expires_at,created_at)
    VALUES(token_hash,p_client,who.user_id,active->>'release_id',active->>'source_binding_hash',issued,until_at,issued);
  RETURN jsonb_build_object('kind','issued','leaseHash',token_hash,'releaseId',active->>'release_id','validUntil',until_at);
END $$;
ALTER FUNCTION content_intake.issue_sop_continuation_lease(text,text,text,text,timestamptz) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.issue_sop_continuation_lease(text,text,text,text,timestamptz)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.issue_sop_continuation_lease(text,text,text,text,timestamptz) TO intake_usage;

CREATE FUNCTION content_intake.sop_continuation_entitlement_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.sop_continuation_hash IS NULL THEN RETURN NULL; END IF;
  IF NEW.contract_view<>'graph' OR NOT EXISTS(
    SELECT 1 FROM content_intake.sop_active_uses active
    JOIN content_intake.principals principal ON principal.principal_id=active.principal_id
    JOIN content_intake.entitlements opening ON opening.entitlement_hash=active.opened_entitlement_hash
    JOIN content_intake.entitlement_contexts original ON original.entitlement_hash=opening.entitlement_hash
    JOIN content_intake.entitlement_contexts fresh ON fresh.entitlement_hash=NEW.entitlement_hash
    JOIN public.snapshot_offline_leases lease ON lease.lease_token_hash=NEW.lease_token_hash
    WHERE active.continuation_hash=NEW.sop_continuation_hash AND active.closed_at IS NULL
      AND active.principal_id=NEW.principal_id AND principal.user_id=NEW.user_id
      AND active.release_id=NEW.release_id AND lease.source_binding_hash=active.source_binding_hash
      AND fresh.session_token_hash=active.session_hash AND opening.shop_id=NEW.shop_id
      AND fresh.product_ids=original.product_ids AND fresh.scenario_ids=original.scenario_ids
      AND EXISTS(SELECT 1 FROM content_intake.entitlement_scopes scope
        WHERE scope.entitlement_hash=NEW.entitlement_hash AND scope.source_id=active.source_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID';
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION content_intake.sop_continuation_entitlement_guard() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_continuation_entitlement_guard()
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;
CREATE CONSTRAINT TRIGGER sop_continuation_entitlement AFTER INSERT ON content_intake.entitlements
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION content_intake.sop_continuation_entitlement_guard();
