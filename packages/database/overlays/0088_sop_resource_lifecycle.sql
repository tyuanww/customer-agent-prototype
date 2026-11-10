-- Normal resource lifecycle implementation over the immutable 0087 prefix.
-- schema.v1.34 resource-disable storage delta after the verified product prefix.
-- Technical candidate approved. PG15 installation and product88 verification pending.
-- The existing candidate/quality/publication owners own all transactional writes.

CREATE UNIQUE INDEX sop_resource_disable_release_sequence_parent
  ON public.content_releases(release_id,release_seq);
CREATE UNIQUE INDEX sop_resource_disable_publication_parent
  ON content_intake.publications(release_id,candidate_id,candidate_version);

CREATE TABLE content_intake.sop_resource_disables (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  resource_id content_intake.identifier NOT NULL,
  canonical_disable text NOT NULL CHECK (octet_length(canonical_disable) BETWEEN 2 AND 524288),
  disable_payload jsonb NOT NULL CHECK (jsonb_typeof(disable_payload) = 'object'),
  disable_digest text GENERATED ALWAYS AS (encode(public.digest(canonical_disable,'sha256'),'hex')) STORED,
  PRIMARY KEY (candidate_id,candidate_version,source_id,resource_id),
  UNIQUE (candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest),
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  CHECK (canonical_disable::jsonb = disable_payload),
  CHECK ((disable_payload->>'operation' = 'disable') IS TRUE),
  CHECK ((disable_payload->'key'->>'sourceId' = source_id::text) IS TRUE),
  CHECK ((disable_payload->'key'->>'resourceId' = resource_id::text) IS TRUE)
);

CREATE TABLE content_intake.sop_resource_disable_quality_targets (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  resource_id content_intake.identifier NOT NULL,
  disable_digest content_intake.sha256 NOT NULL,
  policy_version text NOT NULL CHECK (policy_version = 'sop-resource-disable-quality-v1'),
  PRIMARY KEY (candidate_id,candidate_version,source_id,resource_id),
  UNIQUE (candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest),
  FOREIGN KEY (candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest)
    REFERENCES content_intake.sop_resource_disables(candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest)
);

CREATE TABLE content_intake.sop_resource_disable_quality_checks (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  resource_id content_intake.identifier NOT NULL,
  disable_digest content_intake.sha256 NOT NULL,
  phase text NOT NULL CHECK (phase IN ('initial','expanded')),
  reviewer_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  facts_version content_intake.version NOT NULL,
  defect boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) <= 2000),
  checked_at timestamptz NOT NULL CHECK (isfinite(checked_at)),
  PRIMARY KEY (candidate_id,candidate_version,source_id,resource_id,phase),
  FOREIGN KEY (candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest)
    REFERENCES content_intake.sop_resource_disable_quality_targets(candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest),
  CHECK (NOT defect OR reason ~ '\S')
);

-- This adds the source-level projection that a resource-only publication needs.
-- It uses the original publication even when no graph in current changes.
CREATE TABLE content_intake.sop_resource_disable_publications (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  base_release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  base_release_seq bigint NOT NULL CHECK (base_release_seq BETWEEN 1 AND 9007199254740991),
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  source_version content_intake.version NOT NULL,
  object_sha256 content_intake.sha256 NOT NULL,
  mapping_digest content_intake.sha256 NOT NULL,
  source_evidence_version content_intake.version NOT NULL,
  resource_disable_set_digest content_intake.sha256 NOT NULL,
  resource_disable_count integer NOT NULL CHECK (resource_disable_count BETWEEN 1 AND 100),
  targets_digest content_intake.sha256 NOT NULL,
  publication_policy text NOT NULL CHECK (publication_policy IN ('direct-v1','approval-v1')),
  review_request_id content_intake.identifier,
  PRIMARY KEY (release_id,source_id),
  UNIQUE (release_id,source_id,candidate_id,candidate_version,material_digest),
  FOREIGN KEY (release_id,candidate_id,candidate_version)
    REFERENCES content_intake.publications(release_id,candidate_id,candidate_version) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (base_release_id,base_release_seq)
    REFERENCES public.content_releases(release_id,release_seq) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,publication_policy)
    REFERENCES content_intake.candidate_versions(candidate_id,version,publication_policy) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (review_request_id,candidate_id,candidate_version)
    REFERENCES content_intake.review_bindings(review_request_id,candidate_id,candidate_version) DEFERRABLE INITIALLY DEFERRED,
  CHECK ((publication_policy = 'direct-v1' AND review_request_id IS NULL)
      OR (publication_policy = 'approval-v1' AND review_request_id IS NOT NULL)),
  CHECK (release_id <> base_release_id)
);

-- The original generic event is the only permanent disable event.
-- This FK projection proves its reviewed material and publication provenance.
CREATE TABLE content_intake.sop_resource_disable_event_lineage (
  release_id text NOT NULL,
  source_id content_intake.identifier NOT NULL,
  resource_id content_intake.identifier NOT NULL,
  target_kind text GENERATED ALWAYS AS ('resource'::text) STORED,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  disable_digest content_intake.sha256 NOT NULL,
  PRIMARY KEY (release_id,source_id,resource_id),
  FOREIGN KEY (release_id,source_id,target_kind,resource_id)
    REFERENCES content_intake.sop_graph_disable_events(release_id,source_id,target_kind,target_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (release_id,source_id,candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.sop_resource_disable_publications(release_id,source_id,candidate_id,candidate_version,material_digest) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest)
    REFERENCES content_intake.sop_resource_disable_quality_targets(candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest) DEFERRABLE INITIALLY DEFERRED
);

DO $ownership$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'sop_resource_disables','sop_resource_disable_quality_targets',
    'sop_resource_disable_quality_checks','sop_resource_disable_publications',
    'sop_resource_disable_event_lineage'
  ] LOOP
    EXECUTE format('ALTER TABLE content_intake.%I OWNER TO intake_runtime_fn_owner',name);
    EXECUTE format('REVOKE ALL ON TABLE content_intake.%I FROM PUBLIC, app_runtime, intake_business, intake_worker',name);
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.%I FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable()',name);
  END LOOP;
END $ownership$;

-- Required in the existing restricted owners before a product migration exists.
-- * Parse exact schemas and JCS, then verify payload/canonical bytes/hash equality.
-- * Validate all historical references at the locked base release, including text
--   resourceBinding and every media owner. Enforce source scope and all budgets.
-- * Freeze exactly one resource target per explicit disable. Existing quality
--   records own plan attribution, set/count/digest, phase and complete checks.
-- * Source confirmation binds the same candidate, object, mapping and disable set.

-- v12 opening query proof. Only narrow immutable references are stored here.
-- The C ready owner retains the original receipt, exact consumed facts and lease.
-- The original full selection resolves through opened_entitlement_hash/context.
-- Logical lease reference: the v11 sop_query_leases contract or its declared
-- actual87 equivalent. No FK targets an unverified or undefined private table.
CREATE FUNCTION content_intake.sop_opening_query_reference_valid(p_proof jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT
SET search_path=pg_catalog AS $reference$
DECLARE
  keys text[] := ARRAY['schema','queryRequestHash','readyReceiptHash','originalSessionHash',
    'selectedContractSetId','factsCandidateId','factsCandidateVersion','factsVersion',
    'selectionBindingHash','queryLeaseExpiresAt'];
  field text;
  expires timestamptz;
BEGIN
  IF jsonb_typeof(p_proof) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (p_proof ?& keys) OR p_proof-keys <> '{}'::jsonb THEN RETURN false; END IF;
  IF p_proof->>'schema' IS DISTINCT FROM 'sop-opening-query-reference-v1' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['queryRequestHash','readyReceiptHash','originalSessionHash','selectionBindingHash'] LOOP
    IF jsonb_typeof(p_proof->field) IS DISTINCT FROM 'string'
      OR (p_proof->>field) !~ '^[0-9a-f]{64}$' THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(p_proof->'selectedContractSetId') IS DISTINCT FROM 'string'
    OR (p_proof->>'selectedContractSetId') !~ '^cs-ai-c11-openapi-1\.30\.0-schema-1\.34-[0-9a-f]{12}$'
    OR jsonb_typeof(p_proof->'factsCandidateId') IS DISTINCT FROM 'string'
    OR (p_proof->>'factsCandidateId') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN RETURN false; END IF;
  FOREACH field IN ARRAY ARRAY['factsCandidateVersion','factsVersion'] LOOP
    IF jsonb_typeof(p_proof->field) IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    IF (p_proof->>field)::numeric < 1 OR (p_proof->>field)::numeric > 9007199254740991
      OR (p_proof->>field)::numeric <> trunc((p_proof->>field)::numeric) THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(p_proof->'queryLeaseExpiresAt') IS DISTINCT FROM 'string'
    OR (p_proof->>'queryLeaseExpiresAt') !~ '^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$'
    THEN RETURN false; END IF;
  BEGIN
    expires := (p_proof->>'queryLeaseExpiresAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    -- A malformed reference is a constraint failure, with no substitute proof.
    RETURN false;
  END;
  RETURN isfinite(expires);
END $reference$;

ALTER TABLE content_intake.sop_active_uses
  ADD COLUMN opening_query_request_id uuid,
  ADD COLUMN opening_query_proof jsonb,
  ADD COLUMN opening_query_proof_hash content_intake.sha256,
  ADD CONSTRAINT sop_active_opening_query_reference CHECK (
    num_nonnulls(opening_query_request_id,opening_query_proof,opening_query_proof_hash) IN (0,3)
    AND (opening_query_proof IS NULL OR (
      content_intake.sop_opening_query_reference_valid(opening_query_proof) IS TRUE
      AND opening_query_proof_hash=encode(public.digest(public.jsonb_jcs(opening_query_proof),'sha256'),'hex')
    ))
  );

CREATE FUNCTION content_intake.sop_active_opening_query_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $opening$
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.opening_query_request_id IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='SOP opening query proof is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF (NEW.opening_query_request_id,NEW.opening_query_proof,NEW.opening_query_proof_hash)
    IS DISTINCT FROM (OLD.opening_query_request_id,OLD.opening_query_proof,OLD.opening_query_proof_hash) THEN
    RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='SOP opening query proof is immutable';
  END IF;
  RETURN NEW;
END $opening$;

CREATE TRIGGER sop_active_opening_query_history
  BEFORE UPDATE OF opening_query_request_id,opening_query_proof,opening_query_proof_hash OR DELETE
  ON content_intake.sop_active_uses FOR EACH ROW
  EXECUTE FUNCTION content_intake.sop_active_opening_query_guard();
ALTER FUNCTION content_intake.sop_opening_query_reference_valid(jsonb) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_active_opening_query_guard() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_opening_query_reference_valid(jsonb),
  content_intake.sop_active_opening_query_guard() FROM PUBLIC,app_runtime,intake_business,intake_worker;

COMMENT ON COLUMN content_intake.sop_active_uses.opening_query_request_id IS
  'v12 original committed C ready request UUID. Required by the restricted v12 first-open owner; legacy rows remain null without inferred backfill.';
COMMENT ON COLUMN content_intake.sop_active_uses.opening_query_proof IS
  'Narrow immutable ready/facts reference only. C retains a durably resolvable original receipt/facts/lease through active replay and lost-ack, beyond query expiry. Original account/entitlement/selection/release/FlowKey/digest remain bound by active and retained entitlement context. Never resolve latest facts or copy another graph/permission payload here.';
COMMENT ON COLUMN content_intake.sop_active_uses.opening_query_proof_hash IS
  'SHA256 of existing JCS reference encoding. Integrity only. The restricted owner validates actor/session/view/E/selection/exact ready/facts and current authority/content before atomic first open. Existing-handle replay preserves original proof while current session may rebind under v11.';
-- * Publication validates both plans and exact zero-defect checks, source evidence,
--   retained history, object availability and current authorization under content
--   lock/CAS. Only this owner writes event plus lineage, current and receipt.
-- * Restrict any new SECURITY DEFINER owner, search_path and EXECUTE separately.
--   No extra caller-controlled freeze argument, generic writer or direct INSERT.
-- * Lock session/active records in the existing continuation owner's canonical
--   order. Commit permanent closure and the event together. Lazy checks scan the
--   same event on every protected read/action and after backup restoration.
-- * Rollback preserves this append-only history. A new disable requires a reviewed
--   corrective candidate. Re-enable never removes an event or reopens old active.
-- * Backfill validates retained immutable source/graph/media evidence. Ambiguous
--   old resource mappings remain blocked. There is no fabricated historical row.

-- release_seq is read from public.content_releases. IDs and timestamps are never sequence evidence.
-- Apply only this delta after the actual verified product prefix, never the cumulative schema.

ALTER TABLE content_intake.parse_jobs DROP CONSTRAINT parse_jobs_contract_view_check;
ALTER TABLE content_intake.parse_jobs ADD CONSTRAINT parse_jobs_contract_view_check
  CHECK (contract_view IN ('legacy','graph','resource-disable'));
ALTER TABLE content_intake.entitlements DROP CONSTRAINT entitlements_contract_view_check;
ALTER TABLE content_intake.entitlements ADD CONSTRAINT entitlements_contract_view_check
  CHECK (contract_view IN ('legacy','graph','resource-disable'));
ALTER TABLE backend_review.receipts DROP CONSTRAINT receipts_contract_view_check;
ALTER TABLE backend_review.receipts ADD CONSTRAINT receipts_contract_view_check
  CHECK (contract_view IN ('legacy','graph','resource-disable'));
REVOKE ALL ON content_intake.sop_resource_disables,content_intake.sop_resource_disable_quality_targets,
  content_intake.sop_resource_disable_quality_checks,content_intake.sop_resource_disable_publications,
  content_intake.sop_resource_disable_event_lineage FROM intake_usage;

-- The inventory includes every retained release through the locked base, including
-- bindings that have disappeared from current. It never trusts client resource IDs.
CREATE FUNCTION content_intake.read_sop_resource_history(p_actor text,p_source text,p_base text,p_action text DEFAULT 'import') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE base_sequence bigint; inventory jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  IF p_action NOT IN ('import','publish') OR NOT EXISTS(SELECT 1 FROM content_intake.sources s WHERE s.source_id=p_source
    AND content_intake.authorization_deadline(p_actor,p_action,s.scope_id,s.source_id,clock_timestamp())>clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  IF p_base IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='BASE_CHANGED';
  END IF;
  SELECT release_seq INTO base_sequence FROM public.content_releases WHERE release_id=p_base;
  WITH graphs AS (
    SELECT l.release_id,r.release_seq,l.source_id,l.flow_id,l.flow_version,l.graph_digest,g.graph_payload
    FROM content_intake.sop_graph_release_lineage l
    JOIN public.content_releases r USING(release_id)
    JOIN content_intake.sop_graph_versions g USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    WHERE l.source_id=p_source AND r.release_seq<=base_sequence
  ), bindings AS (
    SELECT g.release_id,g.release_seq,g.source_id,g.flow_id,g.flow_version,g.graph_digest,
      media->>'resourceId' AS resource_id,
      CASE WHEN media ? 'entry' THEN jsonb_build_object('kind','entry','entry',media->'entry')
        ELSE media->'graphTarget' END AS owner,
      jsonb_build_object('kind','image','objectId',media->'objectId','sha256',media->'sha256',
        'mime',media->'mime','bytes',media->'bytes','alt',media->'alt','required',media->'required','ordinal',media->'ordinal') AS content
    FROM graphs g CROSS JOIN LATERAL jsonb_array_elements(g.graph_payload->'media') media
    WHERE EXISTS(SELECT 1 FROM content_intake.sop_graph_release_media projected
      WHERE projected.release_id=g.release_id AND projected.source_id=g.source_id AND projected.flow_id=g.flow_id
        AND projected.resource_id=media->>'resourceId' AND projected.object_id=media->>'objectId'
        AND projected.owner_kind=CASE WHEN media ? 'entry' THEN 'entry' ELSE media#>>'{graphTarget,kind}' END
        AND projected.owner_id=CASE WHEN media ? 'entry' THEN media#>>'{entry,businessEntryId}' ELSE media#>>'{graphTarget,id}' END)
    UNION ALL
    SELECT g.release_id,g.release_seq,g.source_id,g.flow_id,g.flow_version,g.graph_digest,
      knowledge#>>'{resourceBinding,resourceId}',
      jsonb_build_object('kind',knowledge#>>'{resourceBinding,ownerKind}','id',knowledge#>>'{resourceBinding,ownerId}'),
      jsonb_build_object('kind','knowledge','contentDigest',encode(public.digest(public.jsonb_jcs(knowledge),'sha256'),'hex'),
        'title',knowledge->'title','body',knowledge->'body','audience',knowledge->'audience','nodeId',node->'id')
    FROM graphs g CROSS JOIN LATERAL jsonb_array_elements(g.graph_payload#>'{definition,nodes}') node
    CROSS JOIN LATERAL jsonb_array_elements(node#>'{body,knowledge}') knowledge
    WHERE knowledge->'resourceBinding' IS NOT NULL
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('resourceId',resource_id,'binding',jsonb_build_object(
      'releaseId',release_id,'releaseSeq',release_seq,'flowKey',jsonb_build_object('sourceId',source_id,'flowId',flow_id,'flowVersion',flow_version),
      'graphDigest',graph_digest,'owner',owner,'content',content)) ORDER BY release_seq,release_id COLLATE "C",
      source_id COLLATE "C",flow_id COLLATE "C",flow_version,(owner->>'kind') COLLATE "C",
      coalesce(owner->>'id',owner#>>'{entry,sourceId}') COLLATE "C",
      (owner#>>'{entry,businessEntryId}') COLLATE "C",(owner#>>'{entry,scriptVersion}')::bigint,
      (content->>'kind') COLLATE "C",(content->>'nodeId') COLLATE "C",(content->>'ordinal')::bigint,
      coalesce(content->>'objectId',content->>'contentDigest') COLLATE "C"),'[]'::jsonb)
    INTO inventory FROM bindings;
  RETURN jsonb_build_object('baseReleaseSeq',base_sequence,'bindings',inventory);
END $$;
ALTER FUNCTION content_intake.read_sop_resource_history(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_resource_history(text,text,text,text) FROM PUBLIC,app_runtime,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_resource_history(text,text,text,text) TO intake_business;

ALTER TABLE content_intake.candidate_versions DROP CONSTRAINT candidate_versions_canonical_encoding_check;
ALTER TABLE content_intake.candidate_versions ADD CONSTRAINT candidate_versions_canonical_encoding_check
  CHECK (canonical_encoding IN ('candidate-p1.1','candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1'));
ALTER TABLE content_intake.quality_rounds ADD CONSTRAINT sop_resource_round_attribution
  UNIQUE(candidate_id,candidate_version,phase,checked_by,facts_version,recorded_at);
ALTER TABLE content_intake.sop_resource_disable_quality_checks ADD CONSTRAINT sop_resource_check_attribution
  FOREIGN KEY(candidate_id,candidate_version,phase,reviewer_id,facts_version,checked_at)
  REFERENCES content_intake.quality_rounds(candidate_id,candidate_version,phase,checked_by,facts_version,recorded_at)
  DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION content_intake.read_sop_resource_quality(p_actor text,p_id text,p_version bigint,p_digest text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; disables jsonb; checks jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF c.candidate_id IS NULL OR c.digest<>p_digest OR c.canonical_encoding<>'candidate-sop-resource-disable-v1'
    OR content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(disable_payload ORDER BY source_id,resource_id),'[]'::jsonb) INTO disables
    FROM content_intake.sop_resource_disables WHERE candidate_id=p_id AND candidate_version=p_version AND material_digest=p_digest;
  SELECT coalesce(jsonb_agg(jsonb_build_object('phase',phase,'check',jsonb_build_object('target',
    jsonb_build_object('key',jsonb_build_object('sourceId',source_id,'resourceId',resource_id),'disableDigest',disable_digest),
    'defect',defect,'reason',reason)) ORDER BY phase,source_id,resource_id),'[]'::jsonb) INTO checks
    FROM content_intake.sop_resource_disable_quality_checks WHERE candidate_id=p_id AND candidate_version=p_version AND material_digest=p_digest;
  IF disables IS DISTINCT FROM c.material->'resourceDisables' THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  RETURN jsonb_build_object('disables',disables,'checks',checks);
END $$;

CREATE FUNCTION content_intake.freeze_sop_resource_quality(p_actor text,p_id text,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  PERFORM content_intake.read_sop_resource_quality(p_actor,p_id,p_version,c.digest);
  IF c.state NOT IN ('awaiting-evidence','ready') OR NOT EXISTS(SELECT 1 FROM content_intake.quality_plans
    WHERE candidate_id=p_id AND candidate_version=p_version AND candidate_digest=c.digest) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  INSERT INTO content_intake.sop_resource_disable_quality_targets(candidate_id,candidate_version,material_digest,
    source_id,resource_id,disable_digest,policy_version)
    SELECT candidate_id,candidate_version,material_digest,source_id,resource_id,disable_digest,'sop-resource-disable-quality-v1'
    FROM content_intake.sop_resource_disables WHERE candidate_id=p_id AND candidate_version=p_version
    ON CONFLICT DO NOTHING;
END $$;

CREATE FUNCTION content_intake.check_sop_resource_quality(p_actor text,p_id text,p_version bigint,p_phase text,
  p_checks jsonb,p_at timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; actor_facts bigint;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  PERFORM content_intake.read_sop_resource_quality(p_actor,p_id,p_version,c.digest);
  SELECT current_facts_version INTO actor_facts FROM content_intake.principals WHERE principal_id=p_actor;
  IF c.state NOT IN ('awaiting-evidence','ready') OR p_phase NOT IN ('initial','expanded')
    OR jsonb_typeof(p_checks) IS DISTINCT FROM 'array' OR p_at IS NULL OR NOT isfinite(p_at)
    OR p_at<transaction_timestamp() OR p_at>clock_timestamp()
    OR (SELECT count(*) FROM content_intake.sop_resource_disable_quality_targets
      WHERE candidate_id=p_id AND candidate_version=p_version)<>jsonb_array_length(p_checks)
    OR (SELECT count(DISTINCT x->'target') FROM jsonb_array_elements(p_checks) x)<>jsonb_array_length(p_checks)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_checks) x LEFT JOIN content_intake.sop_resource_disable_quality_targets t
      ON t.candidate_id=p_id AND t.candidate_version=p_version AND t.source_id=x#>>'{target,key,sourceId}'
      AND t.resource_id=x#>>'{target,key,resourceId}' AND t.disable_digest=x#>>'{target,disableDigest}'
      WHERE t.resource_id IS NULL OR x-ARRAY['target','defect','reason']<>'{}'::jsonb
        OR NOT x ?& ARRAY['target','defect','reason'] OR jsonb_typeof(x->'defect') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(x->'reason') IS DISTINCT FROM 'string' OR length(x->>'reason')>2000
        OR ((x->>'defect')::boolean AND btrim(x->>'reason')=''))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_checks) x JOIN content_intake.sop_resource_disable_quality_checks prior
      ON prior.candidate_id=p_id AND prior.candidate_version=p_version AND prior.resource_id=x#>>'{target,key,resourceId}'
      WHERE prior.defect IS DISTINCT FROM (x->>'defect')::boolean OR prior.reason IS DISTINCT FROM x->>'reason') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_GRAPH_INVALID'; END IF;
  INSERT INTO content_intake.sop_resource_disable_quality_checks(candidate_id,candidate_version,material_digest,source_id,
    resource_id,disable_digest,phase,reviewer_id,facts_version,defect,reason,checked_at)
    SELECT p_id,p_version,c.digest,x#>>'{target,key,sourceId}',x#>>'{target,key,resourceId}',x#>>'{target,disableDigest}',
      p_phase,p_actor,actor_facts,(x->>'defect')::boolean,x->>'reason',p_at FROM jsonb_array_elements(p_checks) x;
END $$;

CREATE FUNCTION content_intake.sop_resource_quality_state(p_id text,p_version bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; total bigint; phase_name text;
BEGIN
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  SELECT count(*) INTO total FROM content_intake.sop_resource_disable_quality_targets WHERE candidate_id=p_id AND candidate_version=p_version;
  IF total<>jsonb_array_length(c.material->'resourceDisables') OR total<>(c.material->>'resourceDisableCount')::bigint THEN RETURN 'blocked'; END IF;
  FOR phase_name IN SELECT phase FROM content_intake.quality_rounds WHERE candidate_id=p_id AND candidate_version=p_version LOOP
    IF total<>(SELECT count(*) FROM content_intake.sop_resource_disable_quality_checks
      WHERE candidate_id=p_id AND candidate_version=p_version AND phase=phase_name) THEN RETURN 'blocked'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM content_intake.sop_resource_disable_quality_checks
    WHERE candidate_id=p_id AND candidate_version=p_version AND defect) THEN RETURN 'revision_required'; END IF;
  RETURN 'passed';
END $$;

ALTER FUNCTION content_intake.read_sop_resource_quality(text,text,bigint,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.freeze_sop_resource_quality(text,text,bigint) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.check_sop_resource_quality(text,text,bigint,text,jsonb,timestamptz) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_resource_quality_state(text,bigint) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.read_sop_resource_quality(text,text,bigint,text),
  content_intake.freeze_sop_resource_quality(text,text,bigint),content_intake.check_sop_resource_quality(text,text,bigint,text,jsonb,timestamptz),
  content_intake.sop_resource_quality_state(text,bigint) FROM PUBLIC,app_runtime,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_resource_quality(text,text,bigint,text),
  content_intake.freeze_sop_resource_quality(text,text,bigint),content_intake.check_sop_resource_quality(text,text,bigint,text,jsonb,timestamptz)
  TO intake_business;

CREATE FUNCTION content_intake.assert_sop_resource_material(p_actor text,p_source text,p_base text,p_material jsonb,p_action text DEFAULT 'import') RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE history jsonb; item jsonb; expected jsonb; explicit_count bigint; recent_count bigint;
BEGIN
  history:=content_intake.read_sop_resource_history(p_actor,p_source,p_base,p_action);
  IF p_material->'baseReleaseSeq' IS DISTINCT FROM history->'baseReleaseSeq'
    OR jsonb_typeof(p_material->'resourceDisables') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_material->'resourceDisables')>100
    OR (p_material->>'resourceDisableCount')::bigint<>jsonb_array_length(p_material->'resourceDisables')
    OR p_material->>'resourceDisableSetDigest' IS DISTINCT FROM encode(public.digest(public.jsonb_jcs(p_material->'resourceDisables'),'sha256'),'hex')
    OR p_material->'resourceDisables' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(x ORDER BY x#>>'{key,sourceId}',x#>>'{key,resourceId}'),'[]'::jsonb)
      FROM jsonb_array_elements(p_material->'resourceDisables') x)
    OR (SELECT count(DISTINCT x->'key') FROM jsonb_array_elements(p_material->'resourceDisables') x)<>jsonb_array_length(p_material->'resourceDisables')
    OR (SELECT coalesce(sum(jsonb_array_length(x->'bindings')),0) FROM jsonb_array_elements(p_material->'resourceDisables') x)>5000 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
  FOR item IN SELECT x FROM jsonb_array_elements(p_material->'resourceDisables') x LOOP
    IF item-ARRAY['key','operation','sourceRow','bindings']<>'{}'::jsonb
      OR NOT item ?& ARRAY['key','operation','sourceRow','bindings'] OR item->>'operation' IS DISTINCT FROM 'disable'
      OR item#>>'{key,sourceId}' IS DISTINCT FROM p_source OR item#>>'{key,resourceId}' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      OR item#>>'{sourceRow,sheet}' IS DISTINCT FROM '资源与图片' OR item#>>'{sourceRow,maintenanceState}' IS DISTINCT FROM '停用'
      OR (item#>>'{sourceRow,row}')::bigint NOT BETWEEN 2 AND 1048576
      OR char_length(item#>>'{sourceRow,resourceName}') NOT BETWEEN 1 AND 1024
      OR jsonb_typeof(item->'bindings') IS DISTINCT FROM 'array' OR jsonb_array_length(item->'bindings') NOT BETWEEN 1 AND 500
      OR octet_length(public.jsonb_jcs(jsonb_build_object('disable',item,
        'target',jsonb_build_object('key',item->'key','disableDigest',encode(public.digest(public.jsonb_jcs(item),'sha256'),'hex')),
        'check',jsonb_build_object('target',jsonb_build_object('key',item->'key',
          'disableDigest',encode(public.digest(public.jsonb_jcs(item),'sha256'),'hex')),'defect',true,'reason',repeat('😀',2000)))))>524288 THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_MAPPING_REQUIRED'; END IF;
    SELECT coalesce(jsonb_agg(x->'binding'),'[]'::jsonb) INTO expected
      FROM jsonb_array_elements(history->'bindings') x WHERE x->>'resourceId'=item#>>'{key,resourceId}';
    IF item->'bindings' IS DISTINCT FROM expected
      OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(item->'bindings') x)<>jsonb_array_length(expected) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_DEPENDENCY_INVALID'; END IF;
  END LOOP;
  SELECT (SELECT count(*) FROM jsonb_array_elements(p_material->'differences') x WHERE x->>'change'='disable')
    +(SELECT count(*) FROM jsonb_array_elements(p_material->'sopDifferences') x WHERE x->>'change'='disable')
    +jsonb_array_length(p_material->'resourceDisables') INTO explicit_count;
  SELECT coalesce(sum(c.explicit_disable_count),0) INTO recent_count FROM content_intake.publications p
    JOIN content_intake.candidate_versions c ON c.candidate_id=p.candidate_id AND c.version=p.candidate_version
    JOIN public.content_releases r ON r.release_id=p.release_id WHERE c.source_id=p_source
      AND r.published_at>clock_timestamp()-interval '24 hours' AND r.published_at<=clock_timestamp();
  IF p_material#>>'{risk,policyVersion}' IS DISTINCT FROM 'risk-sop-resource-disable-v1'
    OR (p_material#>>'{risk,explicitDisableCount}')::bigint<>explicit_count
    OR (p_material#>>'{risk,sameSourceDisabledLast24Hours}')::bigint<>recent_count
    OR (explicit_count+recent_count>=2 AND p_material#>>'{risk,level}'<>'critical')
    OR (jsonb_array_length(p_material->'resourceDisables')>0 AND NOT (p_material#>'{risk,reasons}') ? 'SOP_RESOURCE_DISABLE') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
END $$;
ALTER FUNCTION content_intake.assert_sop_resource_material(text,text,text,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.assert_sop_resource_material(text,text,text,jsonb,text)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE OR REPLACE FUNCTION content_intake.freeze_sop_graph_candidate(p_actor text,p_job text,p_material jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE j content_intake.parse_jobs; s content_intake.sources; old content_intake.candidate_versions;
  o content_intake.objects; mapping content_intake.source_mappings; id_new text; version_new bigint;
  flow_value jsonb; graph_value jsonb; media_value jsonb; encoded text; payloads jsonb; v_until timestamptz; mapping_hash text;
  base_graphs jsonb; prior_graph jsonb; before_hash text; after_hash text; ceiling bigint;
  expected_differences jsonb:='[]'::jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO j FROM content_intake.parse_jobs WHERE job_id=p_job FOR UPDATE;
  IF NOT FOUND OR j.actor_id<>p_actor OR j.contract_view NOT IN ('graph','resource-disable') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
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
  IF j.contract_view='resource-disable' THEN
    PERFORM content_intake.assert_sop_resource_material(p_actor,j.source_id,j.base_release_id,p_material);
  END IF;
  encoded:=public.jsonb_jcs(p_material);
  IF j.state='validated' THEN
    SELECT * INTO STRICT old FROM content_intake.candidate_versions WHERE candidate_id=j.result_candidate_id AND version=j.result_candidate_version;
    IF old.canonical_material<>encoded THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
    RETURN jsonb_build_object('candidateId',old.candidate_id,'version',old.version);
  END IF;
  IF j.state<>'parsing' OR p_material->>'canonicalEncodingVersion' IS DISTINCT FROM (CASE WHEN j.contract_view='resource-disable' THEN 'candidate-sop-resource-disable-v1' ELSE 'candidate-sop-task-graph-v2' END)
    OR p_material->>'sourceVersion' IS DISTINCT FROM j.source_version::text
    OR p_material->'baseReleaseId' IS DISTINCT FROM coalesce(to_jsonb(j.base_release_id),'null'::jsonb)
    OR (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(p_material->'contributors') x)
      IS DISTINCT FROM (SELECT jsonb_agg(x ORDER BY x) FROM unnest(j.contributor_ids) x)
    OR jsonb_array_length(p_material->'sopFlows') NOT BETWEEN (CASE WHEN j.contract_view='resource-disable' THEN 0 ELSE 1 END) AND 100
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
    VALUES(id_new,version_new,j.source_id,s.scope_id,j.source_version,o.object_id,o.sha256,p_actor,j.base_release_id,p_material->>'canonicalEncodingVersion',encoded,p_material,
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
  IF j.contract_view='resource-disable' THEN
    INSERT INTO content_intake.sop_resource_disables(candidate_id,candidate_version,material_digest,source_id,resource_id,canonical_disable,disable_payload)
      SELECT id_new,version_new,encode(public.digest(encoded,'sha256'),'hex'),j.source_id,x#>>'{key,resourceId}',public.jsonb_jcs(x),x
      FROM jsonb_array_elements(p_material->'resourceDisables') x;
  END IF;
  UPDATE content_intake.parse_jobs SET state='validated',finished_at=clock_timestamp(),result_candidate_id=id_new,result_candidate_version=version_new WHERE job_id=p_job;
  IF v_until<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  RETURN jsonb_build_object('candidateId',id_new,'version',version_new);
END $$;

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
    OR NEW.material->'selectedSheets' IS DISTINCT FROM (CASE WHEN NEW.canonical_encoding IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') THEN '["场景目录","执行任务","判断分支","客户话术","知识与案例","资源与图片"]'::jsonb WHEN o.mime='text/csv' THEN '["CSV"]'::jsonb ELSE '["来源","FAQ","相似问法"]'::jsonb END)
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
    WHERE c.canonical_encoding NOT IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') AND (s.domain='sop' OR m.template_version='sop-v1' OR m.rule_version='sop-not-imported' OR m.mapping_version='sop-not-imported')
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

CREATE OR REPLACE FUNCTION content_intake.freeze_sop_graph_quality(p_actor text,p_id text,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF c.canonical_encoding NOT IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') THEN RETURN; END IF;
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

CREATE OR REPLACE FUNCTION content_intake.check_sop_graph_quality(p_actor text,p_id text,p_version bigint,p_phase text,p_checks jsonb) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; recorded timestamptz:=clock_timestamp();
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF c.canonical_encoding NOT IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') OR c.state NOT IN ('awaiting-evidence','ready')
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

CREATE OR REPLACE FUNCTION content_intake.read_sop_graph_quality(p_actor text,p_id text,p_version bigint,p_digest text) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION content_intake.sop_graph_publish_media(p_actor text,p_id text,p_version bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; result jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF content_intake.authorization_deadline(p_actor,'publish',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='PERMISSION_CHANGED'; END IF;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('objectId',media.payload_object_id,'sha256',media.sha256,'sizeBytes',media.bytes,'mime',media.mime)),'[]'::jsonb) INTO result
    FROM content_intake.sop_graph_media_bindings b JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id
    WHERE (b.candidate_id=p_id AND b.candidate_version=p_version) OR EXISTS(SELECT 1 FROM content_intake.sop_graph_release_lineage l
      WHERE l.release_id=c.base_release_id AND (l.source_id<>c.source_id OR c.canonical_encoding='candidate-sop-resource-disable-v1') AND l.candidate_id=b.candidate_id AND l.candidate_version=b.candidate_version AND l.flow_id=b.flow_id)
      OR (c.canonical_encoding='candidate-sop-resource-disable-v1' AND EXISTS(
        SELECT 1 FROM content_intake.sop_resource_disables d CROSS JOIN LATERAL jsonb_array_elements(d.disable_payload->'bindings') h
        JOIN content_intake.sop_graph_release_media r ON r.release_id=h->>'releaseId' AND r.source_id=h#>>'{flowKey,sourceId}'
          AND r.flow_id=h#>>'{flowKey,flowId}' AND r.owner_kind=h#>>'{owner,kind}'
          AND r.object_id=h#>>'{content,objectId}' AND r.resource_id=d.resource_id
          AND r.owner_id=coalesce(h#>>'{owner,id}',h#>>'{owner,entry,businessEntryId}')
        WHERE d.candidate_id=p_id AND d.candidate_version=p_version AND h#>>'{content,kind}'='image'
          AND r.candidate_id=b.candidate_id AND r.candidate_version=b.candidate_version AND r.object_id=b.object_id
          AND r.owner_kind=b.owner_kind AND r.owner_id=b.owner_id AND r.resource_id=b.resource_id));
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION content_intake.read_sop_graph_candidate_media(p_actor text,p_id text,p_version bigint,p_digest text,p_binding jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; result jsonb;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_id AND version=p_version;
  IF NOT FOUND OR content_intake.authorization_deadline(p_actor,'review',c.scope_id,c.source_id,clock_timestamp()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED';
  END IF;
  IF c.digest<>p_digest OR c.state NOT IN ('awaiting-evidence','ready') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
  SELECT jsonb_build_object('objectId',media.payload_object_id,'sha256',b.sha256,'sizeBytes',b.bytes,'mime',b.mime,
    'binding',p_binding,'key',jsonb_build_object('candidateId',p_id,'version',p_version,'digest',p_digest)) INTO result
    FROM content_intake.sop_graph_media_bindings b
    JOIN content_intake.sop_media_objects media ON media.media_object_id=b.object_id
    WHERE ((b.candidate_id=p_id AND b.candidate_version=p_version) OR EXISTS(
      SELECT 1 FROM content_intake.sop_resource_disables d CROSS JOIN LATERAL jsonb_array_elements(d.disable_payload->'bindings') h
      JOIN content_intake.sop_graph_release_media r ON r.release_id=h->>'releaseId' AND r.source_id=h#>>'{flowKey,sourceId}'
        AND r.flow_id=h#>>'{flowKey,flowId}' AND r.owner_kind=h#>>'{owner,kind}'
        AND r.object_id=h#>>'{content,objectId}' AND r.resource_id=d.resource_id
          AND r.owner_id=coalesce(h#>>'{owner,id}',h#>>'{owner,entry,businessEntryId}')
      JOIN content_intake.sop_graph_release_lineage l ON l.release_id=r.release_id AND l.source_id=r.source_id AND l.flow_id=r.flow_id
        AND l.flow_version=(h#>>'{flowKey,flowVersion}')::bigint AND l.graph_digest=h->>'graphDigest'
      WHERE d.candidate_id=p_id AND d.candidate_version=p_version AND h#>>'{content,kind}'='image'
        AND r.candidate_id=b.candidate_id AND r.candidate_version=b.candidate_version AND r.object_id=b.object_id
        AND r.owner_kind=b.owner_kind AND r.owner_id=b.owner_id AND r.resource_id=b.resource_id))
      AND b.source_id=p_binding->>'sourceId' AND b.flow_id=p_binding->>'flowId' AND b.flow_version=(p_binding->>'flowVersion')::bigint
      AND b.owner_kind=p_binding->>'ownerKind' AND b.owner_id=p_binding->>'ownerId' AND b.resource_id=p_binding->>'resourceId'
      AND b.object_id=p_binding->>'objectId' AND b.entry_script_version IS NOT DISTINCT FROM (p_binding->>'scriptVersion')::bigint
      AND (b.audience<>'coach' OR EXISTS(SELECT 1 FROM content_intake.principals p
        JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
        JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id AND r.job_id=f.job_id AND r.department_id=ANY(f.department_ids)
        WHERE p.principal_id=p_actor AND r.role IN ('supervisor','manager','director','engineer','enabler','lead')))
    ORDER BY b.candidate_id::text COLLATE "C",b.candidate_version LIMIT 1;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION content_intake.sop_graph_rollback_media(p_actor text,p_plan text) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION content_intake.quality_state(p_candidate text,p_version bigint) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE faq text; c content_intake.candidate_versions; phase_name text; targets bigint; actual bigint;
BEGIN
  faq:=content_intake.sop_graph_faq_quality_state(p_candidate,p_version);
  SELECT * INTO c FROM content_intake.candidate_versions WHERE candidate_id=p_candidate AND version=p_version;
  IF c.canonical_encoding NOT IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') OR faq IN ('not_frozen','initial_required') THEN RETURN faq; END IF;
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
  IF c.canonical_encoding='candidate-sop-resource-disable-v1' THEN
    IF content_intake.sop_resource_quality_state(p_candidate,p_version)<>'passed' THEN
      RETURN content_intake.sop_resource_quality_state(p_candidate,p_version);
    END IF;
  END IF;
  RETURN faq;
END $$;

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
      AND p_structure='3723abe333aec2a745d3fa3a7775b1ad56834b211b5bc744cf1dbb9c38b78c72' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    OR (p_template='sop-manual-authoring-v1.1' AND p_rule='sop-task-graph-resource-disable-v1' AND p_mapping='sop-manual-to-task-graph-resource-disable-v1'
      AND p_structure='3723abe333aec2a745d3fa3a7775b1ad56834b211b5bc744cf1dbb9c38b78c72'
      AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), false);
$$;

CREATE OR REPLACE FUNCTION content_intake.sop_query_publication_facts(p_candidate text,p_version bigint,p_source text,p_flow text,p_digest text) RETURNS jsonb
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
  IF original.release_id IS NULL OR coalesce(original.material->>'canonicalEncodingVersion','') NOT IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1')
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

CREATE FUNCTION content_intake.publish_sop_resource_events(p_next text,p_candidate text,p_version bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c content_intake.candidate_versions; targets text;
BEGIN
  SELECT * INTO STRICT c FROM content_intake.candidate_versions WHERE candidate_id=p_candidate AND version=p_version;
  IF c.canonical_encoding<>'candidate-sop-resource-disable-v1' OR (c.material->>'resourceDisableCount')::integer=0 THEN RETURN; END IF;
  IF c.state<>'publishing' OR current_setting('app.publishing',true) IS DISTINCT FROM 'on'
    OR content_intake.quality_state(p_candidate,p_version)<>'passed' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED'; END IF;
  SELECT encode(public.digest(public.jsonb_jcs(coalesce(jsonb_agg(jsonb_build_object('key',
      jsonb_build_object('sourceId',source_id,'resourceId',resource_id),'disableDigest',disable_digest)
      ORDER BY source_id,resource_id),'[]'::jsonb)),'sha256'),'hex') INTO targets
    FROM content_intake.sop_resource_disable_quality_targets WHERE candidate_id=p_candidate AND candidate_version=p_version;
  INSERT INTO content_intake.sop_resource_disable_publications(release_id,candidate_id,candidate_version,material_digest,
    base_release_id,base_release_seq,source_id,source_version,object_sha256,mapping_digest,source_evidence_version,
    resource_disable_set_digest,resource_disable_count,targets_digest,publication_policy,review_request_id)
    VALUES(p_next,p_candidate,p_version,c.digest,c.base_release_id,(c.material->>'baseReleaseSeq')::bigint,c.source_id,
      c.source_version,c.file_sha256,c.material->>'mappingDigest',c.source_evidence_version,
      c.material->>'resourceDisableSetDigest',(c.material->>'resourceDisableCount')::integer,targets,c.publication_policy,NULL);
  INSERT INTO content_intake.sop_resource_disable_event_lineage(release_id,source_id,resource_id,candidate_id,candidate_version,material_digest,disable_digest)
    SELECT p_next,source_id,resource_id,p_candidate,p_version,c.digest,disable_digest
    FROM content_intake.sop_resource_disables WHERE candidate_id=p_candidate AND candidate_version=p_version;
  INSERT INTO content_intake.sop_graph_disable_events(release_id,source_id,target_kind,target_id)
    SELECT p_next,source_id,'resource',resource_id FROM content_intake.sop_resource_disables
    WHERE candidate_id=p_candidate AND candidate_version=p_version;
END $$;
ALTER FUNCTION content_intake.publish_sop_resource_events(text,text,bigint) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.publish_sop_resource_events(text,text,bigint)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE OR REPLACE FUNCTION content_intake.project_sop_graph_release(p_next text,p_previous text,p_candidate text DEFAULT NULL,p_version bigint DEFAULT NULL) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE own_source text; candidate_material jsonb; resource_format boolean:=false;
BEGIN
  IF p_candidate IS NOT NULL THEN
    SELECT source_id,c.material,c.canonical_encoding='candidate-sop-resource-disable-v1' INTO own_source,candidate_material,resource_format
      FROM content_intake.candidate_versions c WHERE candidate_id=p_candidate AND version=p_version
        AND canonical_encoding IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1');
  END IF;
  INSERT INTO content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,flow_version,graph_digest,candidate_id,candidate_version,publication_policy,review_request_id)
    SELECT p_next,l.source_id,l.flow_id,l.flow_version,l.graph_digest,l.candidate_id,l.candidate_version,l.publication_policy,l.review_request_id
    FROM content_intake.sop_graph_release_lineage l WHERE l.release_id=p_previous AND (own_source IS NULL OR l.source_id<>own_source
      OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidate_material->'sopDifferences') d WHERE d->>'flowId'=l.flow_id)));
  IF p_candidate IS NOT NULL THEN
    INSERT INTO content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,flow_version,graph_digest,candidate_id,candidate_version,publication_policy,review_request_id)
      SELECT p_next,v.source_id,v.flow_id,v.flow_version,v.graph_digest,v.candidate_id,v.candidate_version,c.publication_policy,NULL
      FROM content_intake.sop_graph_versions v JOIN content_intake.candidate_versions c ON c.candidate_id=v.candidate_id AND c.version=v.candidate_version
      WHERE v.candidate_id=p_candidate AND v.candidate_version=p_version AND v.operation='upsert'
        AND (NOT resource_format OR EXISTS(SELECT 1 FROM jsonb_array_elements(candidate_material->'sopDifferences') d WHERE d->>'flowId'=v.flow_id));
    INSERT INTO content_intake.sop_graph_disable_events(release_id,source_id,target_kind,target_id)
      SELECT p_next,own_source,'flow',d->>'flowId' FROM content_intake.candidate_versions c CROSS JOIN LATERAL jsonb_array_elements(c.material->'sopDifferences') d
      WHERE c.candidate_id=p_candidate AND c.version=p_version AND d->>'change'='disable';
    PERFORM content_intake.publish_sop_resource_events(p_next,p_candidate,p_version);
  END IF;
  INSERT INTO content_intake.sop_graph_release_media(release_id,source_id,flow_id,owner_kind,owner_id,resource_id,object_id,candidate_id,candidate_version)
    SELECT p_next,b.source_id,b.flow_id,b.owner_kind,b.owner_id,b.resource_id,b.object_id,b.candidate_id,b.candidate_version
    FROM content_intake.sop_graph_release_lineage l JOIN content_intake.sop_graph_media_bindings b
      USING(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest) WHERE l.release_id=p_next;
  UPDATE content_intake.sop_media_objects media SET state='adopted',adopted_at=clock_timestamp()
    WHERE media.state='staged' AND EXISTS(SELECT 1 FROM content_intake.sop_graph_release_media binding WHERE binding.release_id=p_next AND binding.object_id=media.media_object_id);
  RETURN content_intake.assert_sop_graph_release(p_next,p_candidate);
END $$;

CREATE FUNCTION content_intake.sop_query_contract(p_view text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
  IF p_view='graph' THEN RETURN 'cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f'; END IF;
  IF p_view='resource-disable' THEN RETURN 'cs-ai-c11-openapi-1.30.0-schema-1.34-0405c5651564'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
END $$;
CREATE FUNCTION content_intake.sop_query_actor_binding(p_actor text,p_session text,p_view text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT encode(public.digest(public.jsonb_jcs(jsonb_build_array(p_actor,p_session,content_intake.sop_query_contract(p_view))),'sha256'),'hex');
$$;
CREATE FUNCTION content_intake.sop_query_receipt_key(p_actor text,p_session text,p_view text,p_request uuid) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
  SELECT CASE WHEN p_view='graph' THEN p_request::text
    ELSE content_intake.sop_query_actor_binding(p_actor,p_session,p_view)||':'||p_request::text END;
$$;
ALTER FUNCTION content_intake.sop_query_contract(text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_query_actor_binding(text,text,text) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_query_receipt_key(text,text,text,uuid) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_query_contract(text),content_intake.sop_query_actor_binding(text,text,text),
  content_intake.sop_query_receipt_key(text,text,text,uuid) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.complete_sop_unified_query(p_actor text,p_entitlement text,p_request jsonb,p_authority text,
  p_response jsonb,p_facts jsonb,p_view text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE entitlement record; graph jsonb; facts content_intake.sop_query_fact_versions%ROWTYPE; media jsonb; lease content_intake.sop_query_leases;
  body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex');
  receipt_key text; receipt_operation text; actor_binding text; deadline timestamptz; receipt record; session_hash text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT e.*,context.session_token_hash,l.client_id INTO entitlement FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts context USING(entitlement_hash)
    JOIN public.snapshot_offline_leases l USING(lease_token_hash)
    WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.valid_until>clock_timestamp()
      AND e.sop_continuation_hash IS NULL AND e.contract_view=p_view AND l.expires_at>clock_timestamp();
  IF entitlement.entitlement_hash IS NULL OR entitlement.client_id IS DISTINCT FROM 'intake:'||p_authority
    OR entitlement.shop_id IS DISTINCT FROM p_request->>'shop_id' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED';
  END IF;
  session_hash:=entitlement.session_token_hash;
  IF p_view='resource-disable' AND encode(public.digest(p_request->>'entitlement_id','sha256'),'hex') IS DISTINCT FROM p_entitlement THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  actor_binding:=content_intake.sop_query_actor_binding(p_actor,session_hash,p_view);
  receipt_key:=content_intake.sop_query_receipt_key(p_actor,session_hash,p_view,(p_request->>'request_id')::uuid);
  receipt_operation:=CASE WHEN p_view='graph' THEN 'intake:sop-query-v11' ELSE 'intake:sop-query-v12' END;
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
    AND operation=receipt_operation AND request_key=receipt_key;
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
  INSERT INTO backend_review.receipts(actor_user_id,operation,request_key,request_hash,response,contract_view)
    VALUES(entitlement.user_id,receipt_operation,receipt_key,body_hash,p_response,CASE WHEN p_view='graph' THEN 'legacy' ELSE p_view END);
  RETURN p_response;
END $$;
ALTER FUNCTION content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb,text) FROM PUBLIC,app_runtime,intake_business,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.complete_sop_unified_query(text,text,jsonb,text,jsonb,jsonb,text) TO intake_usage;

CREATE FUNCTION content_intake.replay_sop_unified_query(p_actor text,p_session text,p_request jsonb,p_authority text,p_view text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE who content_intake.principals; receipt backend_review.receipts; lease record; e content_intake.entitlements;
  body_hash text:=encode(public.digest(public.jsonb_jcs(p_request),'sha256'),'hex'); actor_binding text;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  actor_binding:=content_intake.sop_query_actor_binding(p_actor,p_session,p_view);
  SELECT * INTO receipt FROM backend_review.receipts WHERE actor_user_id=who.user_id
    AND operation=CASE WHEN p_view='graph' THEN 'intake:sop-query-v11' ELSE 'intake:sop-query-v12' END
    AND request_key=content_intake.sop_query_receipt_key(p_actor,p_session,p_view,(p_request->>'request_id')::uuid);
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF p_view='resource-disable' THEN
    SELECT ent.* INTO e FROM content_intake.entitlements ent
      JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
      WHERE ent.entitlement_hash=encode(public.digest(p_request->>'entitlement_id','sha256'),'hex')
        AND ent.principal_id=p_actor AND ent.user_id=who.user_id AND ent.contract_view=p_view
        AND ent.sop_continuation_hash IS NULL AND ctx.session_token_hash=p_session;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM content_intake.entitlement_scopes es JOIN content_intake.sources s USING(source_id)
      WHERE es.entitlement_hash=e.entitlement_hash AND content_intake.authorization_deadline(p_actor,'query',s.scope_id,s.source_id,clock_timestamp()) IS NULL)
      OR e.principal_generation<>who.revocation_generation THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  END IF;
  IF receipt.request_hash<>body_hash THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='IDEMPOTENCY_CONFLICT'; END IF;
  IF receipt.response->>'status' IN ('blocked','stale') THEN RETURN receipt.response; END IF;
  SELECT l.*,b.session_hash,b.authority_binding,b.entitlement_hash INTO lease FROM content_intake.sop_query_leases l
    JOIN content_intake.sop_unified_query_bindings b USING(lease_id)
    WHERE b.principal_id=p_actor AND l.actor_binding_hash=actor_binding AND l.request_id=(p_request->>'request_id')::uuid
      AND l.request_hash=body_hash;
  IF lease.lease_id IS NULL OR lease.session_hash IS DISTINCT FROM p_session OR lease.session_epoch<>who.revocation_generation
    OR (p_view='graph' AND lease.authority_binding IS DISTINCT FROM p_authority) THEN
    RETURN jsonb_build_object('status','stale','request_id',p_request->>'request_id','release_id',NULL,
      'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code','SCOPE_DENIED')));
  END IF;
  IF lease.expires_at<=clock_timestamp() OR (p_view='resource-disable' AND e.valid_until<=clock_timestamp()) THEN
    RETURN jsonb_build_object('status','stale','request_id',p_request->>'request_id','release_id',lease.release_id,
      'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code','LEASE_EXPIRED')));
  END IF;
  IF lease.release_id IS DISTINCT FROM (SELECT current_release_id FROM public.content_current WHERE id=1) THEN
    RETURN jsonb_build_object('status','stale','request_id',p_request->>'request_id','release_id',lease.release_id,
      'lease_expires_at',NULL,'result',NULL,'reasons',jsonb_build_array(jsonb_build_object('code','STALE_RELEASE')));
  END IF;
  PERFORM content_intake.read_sop_graph_deadline(p_actor,lease.release_id);
  RETURN receipt.response;
END $$;
ALTER FUNCTION content_intake.replay_sop_unified_query(text,text,jsonb,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.replay_sop_unified_query(text,text,jsonb,text,text) FROM PUBLIC,app_runtime,intake_business,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.replay_sop_unified_query(text,text,jsonb,text,text) TO intake_usage;

CREATE OR REPLACE FUNCTION content_intake.complete_sop_unified_query(p_actor text,p_entitlement text,p_request jsonb,p_authority text,p_response jsonb,p_facts jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.complete_sop_unified_query(p_actor,p_entitlement,p_request,p_authority,p_response,p_facts,'graph');
$$;
CREATE OR REPLACE FUNCTION content_intake.replay_sop_unified_query(p_actor text,p_session text,p_request jsonb,p_authority text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.replay_sop_unified_query(p_actor,p_session,p_request,p_authority,'graph');
$$;
CREATE FUNCTION content_intake.recheck_sop_unified_query(p_actor text,p_session text,p_request uuid,p_view text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE binding record;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT b.*,l.expires_at INTO binding FROM content_intake.sop_unified_query_bindings b
    JOIN content_intake.sop_query_leases l USING(lease_id) WHERE b.principal_id=p_actor AND b.session_hash=p_session
      AND l.request_id=p_request AND l.actor_binding_hash=content_intake.sop_query_actor_binding(p_actor,p_session,p_view);
  IF NOT FOUND OR binding.expires_at<=clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='LEASE_EXPIRED'; END IF;
  RETURN jsonb_build_object('entitlementHash',binding.entitlement_hash,
    'bundle',content_intake.read_sop_unified_query_bundle(p_actor,binding.entitlement_hash,p_request));
END $$;
ALTER FUNCTION content_intake.recheck_sop_unified_query(text,text,uuid,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.recheck_sop_unified_query(text,text,uuid,text) FROM PUBLIC,app_runtime,intake_business,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.recheck_sop_unified_query(text,text,uuid,text) TO intake_usage;
CREATE OR REPLACE FUNCTION content_intake.read_sop_unified_query_bundle(p_actor text,p_entitlement text,p_request uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE target text; projection jsonb;
BEGIN
  SELECT release_id INTO target FROM content_intake.entitlements WHERE entitlement_hash=p_entitlement
    AND principal_id=p_actor AND contract_view IN ('graph','resource-disable');
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SCOPE_DENIED'; END IF;
  projection:=content_intake.read_sop_graph_current(p_actor,p_entitlement);
  RETURN content_intake.project_sop_query_bundle(p_actor,p_entitlement,target,p_request,projection,NULL::bigint);
END $$;

CREATE FUNCTION content_intake.resolve_sop_open_ready_query(p_actor text,p_session text,p_entitlement text,
  p_release text,p_key jsonb,p_digest text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE proof record; receipt backend_review.receipts; reference jsonb;
BEGIN
  SELECT b.*,l.request_hash,l.expires_at,e.shop_id,ctx.product_ids,ctx.scenario_ids INTO proof
    FROM content_intake.sop_unified_query_bindings b JOIN content_intake.sop_query_leases l USING(lease_id)
    JOIN content_intake.entitlements e ON e.entitlement_hash=b.entitlement_hash
    JOIN content_intake.entitlement_contexts ctx ON ctx.entitlement_hash=e.entitlement_hash
    JOIN content_intake.sop_query_fact_versions f USING(candidate_id,candidate_version,source_id,flow_id,facts_version)
    JOIN content_intake.sop_graph_release_lineage original ON original.release_id=l.release_id
      AND original.candidate_id=f.candidate_id AND original.candidate_version=f.candidate_version
      AND original.source_id=f.source_id AND original.flow_id=f.flow_id AND original.graph_digest=f.graph_digest
    JOIN content_intake.principals actor ON actor.principal_id=b.principal_id
    WHERE b.principal_id=p_actor AND b.session_hash=p_session AND b.entitlement_hash=p_entitlement
      AND e.contract_view='resource-disable' AND e.sop_continuation_hash IS NULL AND ctx.session_token_hash=p_session
      AND l.request_id=p_request AND l.actor_binding_hash=content_intake.sop_query_actor_binding(p_actor,p_session,'resource-disable')
      AND l.release_id=p_release AND l.session_epoch=actor.revocation_generation AND l.expires_at>clock_timestamp()
      AND e.valid_until>clock_timestamp() AND e.principal_generation=actor.revocation_generation
      AND f.source_id=p_key->>'sourceId' AND f.flow_id=p_key->>'flowId' AND f.graph_digest=p_digest
      AND original.flow_version=(p_key->>'flowVersion')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  SELECT r.* INTO receipt FROM backend_review.receipts r JOIN content_intake.principals actor ON actor.user_id=r.actor_user_id
    WHERE actor.principal_id=p_actor AND r.operation='intake:sop-query-v12' AND r.contract_view='resource-disable'
      AND r.request_key=content_intake.sop_query_receipt_key(p_actor,p_session,'resource-disable',p_request)
      AND r.request_hash=proof.request_hash;
  IF NOT FOUND OR receipt.response->>'status' IS DISTINCT FROM 'ready'
    OR receipt.response->>'release_id' IS DISTINCT FROM p_release
    OR receipt.response#>'{result,flow,header,key}' IS DISTINCT FROM p_key
    OR receipt.response#>>'{result,graph_digest}' IS DISTINCT FROM p_digest
    OR (receipt.response->>'lease_expires_at')::timestamptz IS DISTINCT FROM proof.expires_at THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  reference:=jsonb_build_object('schema','sop-opening-query-reference-v1','queryRequestHash',proof.request_hash,
    'readyReceiptHash',encode(public.digest(public.jsonb_jcs(receipt.response),'sha256'),'hex'),
    'originalSessionHash',p_session,'selectedContractSetId',content_intake.sop_query_contract('resource-disable'),
    'factsCandidateId',proof.candidate_id,'factsCandidateVersion',proof.candidate_version,'factsVersion',proof.facts_version,
    'selectionBindingHash',encode(public.digest(public.jsonb_jcs(jsonb_build_object('shopId',proof.shop_id,
      'productIds',to_jsonb(proof.product_ids),'scenarioIds',to_jsonb(proof.scenario_ids))),'sha256'),'hex'),
    'queryLeaseExpiresAt',receipt.response->'lease_expires_at');
  RETURN jsonb_build_object('facts',jsonb_build_object('candidateId',proof.candidate_id,
    'candidateVersion',proof.candidate_version,'version',proof.facts_version),'reference',reference);
END $$;
ALTER FUNCTION content_intake.resolve_sop_open_ready_query(text,text,text,text,jsonb,text,uuid) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.resolve_sop_open_ready_query(text,text,text,text,jsonb,text,uuid)
  FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.open_sop_active_use(p_actor text,p_session text,p_hash text,p_entitlement text,
  p_context bigint,p_release text,p_key jsonb,p_digest text,p_node text,p_create boolean,p_open_proof jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active content_intake.sop_active_uses; who content_intake.principals; proof record; graph record; facts jsonb; resolved jsonb; reference jsonb; request_id uuid; required_view text;
BEGIN
  IF p_open_proof->>'kind'='explicit-ready-query' THEN
    required_view:='resource-disable'; request_id:=(p_open_proof->>'queryRequestId')::uuid;
    IF request_id IS NULL OR p_open_proof-ARRAY['kind','queryRequestId']<>'{}'::jsonb THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  ELSIF p_open_proof=jsonb_build_object('kind','legacy-inferred') THEN required_view:='graph';
  ELSE RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  PERFORM backend_review.lock_content();
  SELECT * INTO STRICT who FROM content_intake.principals WHERE principal_id=p_actor;
  PERFORM intake_runtime.lock_product_session(p_session,who.user_id);
  SELECT * INTO active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash;
  IF FOUND THEN
    IF (required_view='resource-disable' AND (active.opening_query_request_id IS DISTINCT FROM request_id
      OR active.opening_query_proof IS NULL)) OR (required_view='graph' AND active.opening_query_request_id IS NOT NULL) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
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
    PERFORM content_intake.assert_sop_opening_query(p_hash);
    RETURN content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,true);
  END IF;
  SELECT e.*,ctx.session_token_hash,ctx.product_ids,ctx.scenario_ids,lease.source_binding_hash INTO proof FROM content_intake.entitlements e
    JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    JOIN public.snapshot_offline_leases lease USING(lease_token_hash)
    WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.user_id=who.user_id
      AND ctx.session_token_hash=p_session AND e.context_generation=p_context AND e.contract_view=required_view
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
  IF required_view='graph' THEN
    facts:=content_intake.resolve_sop_open_facts(p_actor,p_session,p_entitlement,p_release,p_key,p_digest);
  ELSE
    resolved:=content_intake.resolve_sop_open_ready_query(p_actor,p_session,p_entitlement,p_release,p_key,p_digest,request_id);
    facts:=resolved->'facts'; reference:=resolved->'reference';
  END IF;
  IF NOT p_create THEN
    RETURN jsonb_build_object('kind','opening','binding',jsonb_build_object('principal_id',p_actor,'session_hash',p_session,
      'opened_entitlement_hash',p_entitlement,'context_generation',p_context,'release_id',p_release,'source_id',graph.source_id,
      'flow_id',graph.flow_id,'flow_version',graph.flow_version,'graph_digest',graph.graph_digest,
      'opening_query_request_id',request_id,'opening_query_proof',reference,
      'opening_query_proof_hash',CASE WHEN reference IS NULL THEN NULL ELSE encode(public.digest(public.jsonb_jcs(reference),'sha256'),'hex') END,
      'facts_candidate_id',facts->>'candidateId','facts_candidate_version',facts->'candidateVersion','facts_version',facts->'version'),
      'selection',jsonb_build_object('shopId',proof.shop_id,'productIds',proof.product_ids,'scenarioIds',proof.scenario_ids));
  END IF;
  INSERT INTO content_intake.sop_active_uses(continuation_hash,principal_id,session_hash,opened_entitlement_hash,
    context_generation,source_binding_hash,release_id,source_id,flow_id,flow_version,graph_digest,started_at,
    facts_candidate_id,facts_candidate_version,facts_version,opening_query_request_id,opening_query_proof,opening_query_proof_hash)
    VALUES(p_hash,p_actor,p_session,p_entitlement,p_context,proof.source_binding_hash,p_release,
      graph.source_id,graph.flow_id,graph.flow_version,graph.graph_digest,clock_timestamp(),
      facts->>'candidateId',(facts->>'candidateVersion')::bigint,(facts->>'version')::bigint,request_id,reference,
      CASE WHEN reference IS NULL THEN NULL ELSE encode(public.digest(public.jsonb_jcs(reference),'sha256'),'hex') END);
  RETURN content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,false);
END $$;
ALTER FUNCTION content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean,jsonb) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean,jsonb)
  FROM PUBLIC,app_runtime,intake_business,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.open_sop_active_use(text,text,text,text,bigint,text,jsonb,text,text,boolean,jsonb) TO intake_usage;
CREATE OR REPLACE FUNCTION content_intake.open_sop_active_use(p_actor text,p_session text,p_hash text,p_entitlement text,
  p_context bigint,p_release text,p_key jsonb,p_digest text,p_node text,p_create boolean DEFAULT true) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT content_intake.open_sop_active_use(p_actor,p_session,p_hash,p_entitlement,p_context,p_release,p_key,p_digest,p_node,p_create,
    jsonb_build_object('kind','legacy-inferred'));
$$;

CREATE FUNCTION content_intake.authorize_sop_continuation_resource(p_actor text,p_session text,p_address jsonb,p_view text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE actual_view text; entitlement_value text;
BEGIN
  PERFORM content_intake.authorize_sop_continuation_resource(p_actor,p_session,p_address);
  IF p_view NOT IN ('graph','resource-disable') THEN RETURN; END IF;
  SELECT e.contract_view INTO actual_view FROM content_intake.sop_active_uses active
    JOIN content_intake.entitlements e ON e.entitlement_hash=active.opened_entitlement_hash
    WHERE active.continuation_hash=p_address->>'continuation' AND active.principal_id=p_actor;
  IF actual_view IS NULL AND p_address ? 'entitlement' THEN
    entitlement_value:=p_address->>'entitlement';
    IF p_address->>'kind'='media' THEN entitlement_value:=content_intake.resolve_sop_media_entitlement(p_actor,p_session,entitlement_value); END IF;
    SELECT contract_view INTO actual_view FROM content_intake.entitlements
      WHERE entitlement_hash=entitlement_value AND principal_id=p_actor;
  END IF;
  IF actual_view IS DISTINCT FROM p_view THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
END $$;
ALTER FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb,text) FROM PUBLIC,app_runtime,intake_business,intake_worker;
GRANT EXECUTE ON FUNCTION content_intake.authorize_sop_continuation_resource(text,text,jsonb,text) TO intake_usage;

CREATE OR REPLACE FUNCTION content_intake.prepare_sop_action(p_actor text,p_session text,p_hash text,p_open jsonb,
  p_entitlement text,p_context bigint,p_rebind boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE state jsonb; lease record;
BEGIN
  IF p_open IS NOT NULL THEN
    RETURN content_intake.open_sop_active_use(p_actor,p_session,p_hash,p_open->>'entitlement',
      (p_open->>'contextGeneration')::bigint,p_open->>'releaseId',p_open->'key',p_open->>'graphDigest',p_open->>'nodeId',false,coalesce(p_open->'proof',jsonb_build_object('kind','legacy-inferred')));
  END IF;
  state:=content_intake.prepare_sop_continuation(p_actor,p_session,p_hash,p_rebind);
  IF state->>'kind'='closed' THEN RETURN state; END IF;
  IF p_entitlement IS NOT NULL THEN
    SELECT e.*,snapshot.expires_at INTO lease FROM content_intake.entitlements e
      JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
      JOIN public.snapshot_offline_leases snapshot USING(lease_token_hash)
      JOIN content_intake.principals principal ON principal.principal_id=e.principal_id
      WHERE e.entitlement_hash=p_entitlement AND e.principal_id=p_actor AND e.user_id=principal.user_id
        AND e.sop_continuation_hash=p_hash AND e.contract_view IN ('graph','resource-disable') AND ctx.session_token_hash=p_session
        AND e.context_generation=p_context AND e.release_id=state#>>'{binding,release_id}'
        AND e.principal_generation=principal.revocation_generation;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
    IF least(lease.valid_until,lease.expires_at)<=clock_timestamp() THEN RETURN jsonb_build_object('kind','expired'); END IF;
  END IF;
  RETURN state;
END $$;

CREATE OR REPLACE FUNCTION content_intake.read_sop_continuation_media(p_actor text,p_session text,p_entitlement text,
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
      AND ctx.session_token_hash=p_session AND e.contract_view IN ('graph','resource-disable');
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

CREATE OR REPLACE FUNCTION content_intake.sop_continuation_entitlement_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.sop_continuation_hash IS NULL THEN RETURN NULL; END IF;
  IF NEW.contract_view NOT IN ('graph','resource-disable') OR NOT EXISTS(
    SELECT 1 FROM content_intake.sop_active_uses active
    JOIN content_intake.principals principal ON principal.principal_id=active.principal_id
    JOIN content_intake.entitlements opening ON opening.entitlement_hash=active.opened_entitlement_hash
    JOIN content_intake.entitlement_contexts original ON original.entitlement_hash=opening.entitlement_hash
    JOIN content_intake.entitlement_contexts fresh ON fresh.entitlement_hash=NEW.entitlement_hash
    JOIN public.snapshot_offline_leases lease ON lease.lease_token_hash=NEW.lease_token_hash
    WHERE active.continuation_hash=NEW.sop_continuation_hash AND active.closed_at IS NULL
      AND opening.contract_view=NEW.contract_view AND active.principal_id=NEW.principal_id AND principal.user_id=NEW.user_id
      AND active.release_id=NEW.release_id AND lease.source_binding_hash=active.source_binding_hash
      AND fresh.session_token_hash=active.session_hash AND opening.shop_id=NEW.shop_id
      AND fresh.product_ids=original.product_ids AND fresh.scenario_ids=original.scenario_ids
      AND EXISTS(SELECT 1 FROM content_intake.entitlement_scopes scope
        WHERE scope.entitlement_hash=NEW.entitlement_hash AND scope.source_id=active.source_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID';
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION content_intake.resolve_sop_open_facts(p_actor text,p_session text,p_entitlement text,
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
      AND lease.actor_binding_hash=content_intake.sop_query_actor_binding(p_actor,p_session,'graph')
      AND binding.source_id=p_key->>'sourceId' AND binding.flow_id=p_key->>'flowId' AND facts.graph_digest=p_digest
      AND queried.principal_generation=principal.revocation_generation AND queried.shop_id=opening.shop_id
      AND query_context.product_ids=opening_context.product_ids AND query_context.scenario_ids=opening_context.scenario_ids;
  IF jsonb_array_length(matches)<>1 THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  RETURN matches->0;
END $$;

CREATE FUNCTION content_intake.assert_sop_opening_query(p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active content_intake.sop_active_uses; receipt backend_review.receipts; proof record; selection_hash text;
BEGIN
  SELECT * INTO STRICT active FROM content_intake.sop_active_uses WHERE continuation_hash=p_hash;
  IF active.opening_query_request_id IS NULL THEN RETURN; END IF;
  SELECT l.request_hash,b.candidate_id,b.candidate_version,b.facts_version INTO proof
    FROM content_intake.sop_query_leases l JOIN content_intake.sop_unified_query_bindings b USING(lease_id)
    WHERE l.actor_binding_hash=content_intake.sop_query_actor_binding(active.principal_id,
      active.opening_query_proof->>'originalSessionHash','resource-disable')
      AND l.request_id=active.opening_query_request_id AND b.principal_id=active.principal_id
      AND b.entitlement_hash=active.opened_entitlement_hash AND l.release_id=active.release_id
      AND b.source_id=active.source_id AND b.flow_id=active.flow_id;
  IF NOT FOUND OR proof.candidate_id IS DISTINCT FROM active.facts_candidate_id
    OR proof.candidate_version IS DISTINCT FROM active.facts_candidate_version OR proof.facts_version IS DISTINCT FROM active.facts_version
    OR proof.request_hash IS DISTINCT FROM active.opening_query_proof->>'queryRequestHash' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  SELECT r.* INTO receipt FROM backend_review.receipts r JOIN content_intake.principals actor ON actor.user_id=r.actor_user_id
    WHERE actor.principal_id=active.principal_id AND r.operation='intake:sop-query-v12' AND r.contract_view='resource-disable'
      AND r.request_key=content_intake.sop_query_receipt_key(active.principal_id,
        active.opening_query_proof->>'originalSessionHash','resource-disable',active.opening_query_request_id);
  IF NOT FOUND OR receipt.request_hash IS DISTINCT FROM proof.request_hash OR receipt.response->>'status' IS DISTINCT FROM 'ready'
    OR encode(public.digest(public.jsonb_jcs(receipt.response),'sha256'),'hex') IS DISTINCT FROM active.opening_query_proof->>'readyReceiptHash'
    OR active.opening_query_proof->>'selectedContractSetId' IS DISTINCT FROM content_intake.sop_query_contract('resource-disable') THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
  SELECT encode(public.digest(public.jsonb_jcs(jsonb_build_object('shopId',e.shop_id,'productIds',to_jsonb(ctx.product_ids),
    'scenarioIds',to_jsonb(ctx.scenario_ids))),'sha256'),'hex') INTO selection_hash
    FROM content_intake.entitlements e JOIN content_intake.entitlement_contexts ctx USING(entitlement_hash)
    WHERE e.entitlement_hash=active.opened_entitlement_hash AND e.contract_view='resource-disable';
  IF selection_hash IS DISTINCT FROM active.opening_query_proof->>'selectionBindingHash' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='SOP_SNAPSHOT_INVALID'; END IF;
END $$;
ALTER FUNCTION content_intake.assert_sop_opening_query(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.assert_sop_opening_query(text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE OR REPLACE FUNCTION content_intake.lock_sop_active_use(p_actor text,p_session text,p_hash text,p_rebind boolean DEFAULT false)
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
  PERFORM content_intake.assert_sop_opening_query(p_hash);
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


CREATE OR REPLACE FUNCTION content_intake.publish_candidate(p_actor TEXT, p_request JSONB, p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  resource_format boolean;
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
  resource_format:=c.canonical_encoding='candidate-sop-resource-disable-v1';
  IF resource_format THEN PERFORM content_intake.assert_sop_resource_material(p_actor,c.source_id,c.base_release_id,c.material,'publish'); END IF;
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
    WHERE l.release_id=v_base AND (l.source_id<>c.source_id OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=l.business_entry_id))) AND (src.mode<>'v2-preview'
      OR src.current_mapping_version<>prior.source_version OR prior.state<>'published'
      OR sc.candidate_digest IS DISTINCT FROM prior.digest OR sc.object_sha256 IS DISTINCT FROM prior.file_sha256)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_MISMATCH';
  END IF;
  -- Direct rows have no approval. Legacy candidate and corrective-rollback
  -- provenance retain their own current approval, without refreshing it here.
  SELECT min(facts.valid_until) INTO v_inherited_until FROM (
    SELECT review_request_id FROM content_intake.release_lineage
      WHERE release_id=v_base AND (source_id<>c.source_id OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=business_entry_id))) AND publication_policy='approval-v1'
    UNION SELECT review_request_id FROM content_intake.release_rollback_lineage WHERE release_id=v_base
  ) inherited JOIN content_intake.approval_current cur USING(review_request_id)
    JOIN content_intake.approval_facts facts ON facts.review_request_id=cur.review_request_id AND facts.facts_version=cur.facts_version;
  IF EXISTS (SELECT 1 FROM (
    SELECT review_request_id FROM content_intake.release_lineage
      WHERE release_id=v_base AND (source_id<>c.source_id OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=business_entry_id))) AND publication_policy='approval-v1'
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
      WHERE release_id=v_base AND (source_id<>c.source_id OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=business_entry_id))) AND content_valid_until>v_issued_at),
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
    WHERE release_id=v_base AND (source_id<>c.source_id OR (resource_format AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=business_entry_id)));
  -- Include explicit disables for immutable version history and later re-enable.
  -- Readers filter operation/time; they must never infer deletion from missing rows.
  INSERT INTO content_intake.release_lineage(release_id,source_id,business_entry_id,script_version,
    candidate_id,candidate_version,review_request_id,content_valid_until,publication_policy) SELECT v_release,c.source_id,e->>'businessEntryId',(e->>'scriptVersion')::bigint,
    c.candidate_id,c.version,NULL,coalesce((e->>'effectiveTo')::timestamptz,'infinity'::timestamptz),'direct-v1'
    FROM jsonb_array_elements(c.material->'entries') e
    WHERE NOT resource_format OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.material->'differences') d WHERE d->>'businessEntryId'=e->>'businessEntryId');
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
  IF resource_format THEN v_receipt:=v_receipt||jsonb_build_object('resourceDisableLineage',jsonb_build_object(
    'materialDigest',c.digest,'resourceDisableSetDigest',c.material->>'resourceDisableSetDigest',
    'resourceDisableCount',(c.material->>'resourceDisableCount')::integer)); END IF;
  RETURN jsonb_build_object('receipt',v_receipt,'validUntil',v_deadline);
END;
$$;

CREATE FUNCTION content_intake.retained_sop_resource_events(p_release text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT encode(public.digest(public.jsonb_jcs(coalesce(jsonb_agg(jsonb_build_object(
   'releaseId',e.release_id,'releaseSeq',r.release_seq,'sourceId',e.source_id,'resourceId',e.resource_id,
   'candidateId',e.candidate_id,'candidateVersion',e.candidate_version,'materialDigest',e.material_digest,
   'disableDigest',e.disable_digest) ORDER BY r.release_seq,e.source_id::text COLLATE "C",e.resource_id::text COLLATE "C"),'[]'::jsonb)),'sha256'),'hex')
 FROM content_intake.sop_resource_disable_event_lineage e JOIN public.content_releases r USING(release_id)
 WHERE r.release_seq<=(SELECT release_seq FROM public.content_releases WHERE release_id=p_release)
$$;
ALTER FUNCTION content_intake.retained_sop_resource_events(text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.retained_sop_resource_events(text) FROM PUBLIC,app_runtime,intake_business,intake_worker,intake_usage;

CREATE FUNCTION content_intake.preview_rollback(p_actor TEXT,p_base TEXT,p_target TEXT,p_view text)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
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
    UNION ALL
    SELECT coalesce(b.source_id,t.source_id),'resource-publication',to_jsonb(b),to_jsonb(t)
    FROM (SELECT * FROM content_intake.sop_resource_disable_publications WHERE release_id=p_base) b FULL JOIN
      (SELECT * FROM content_intake.sop_resource_disable_publications WHERE release_id=p_target) t USING(source_id)
    WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(t)
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
  IF p_view NOT IN ('legacy','graph','resource-disable') THEN RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='UPGRADE_REQUIRED'; END IF;
  RETURN jsonb_build_object('baseReleaseId',p_base,'targetReleaseId',p_target,'sourceIds',sources,'scopes',scopes,
    'requiresCorrectiveCandidate',denied OR visible<>jsonb_array_length(sources),
    'impactDigest',encode(public.digest(public.jsonb_jcs((jsonb_build_object('baseReleaseId',p_base,'targetReleaseId',p_target,'impact',impact)||CASE WHEN p_view='resource-disable' THEN jsonb_build_object('retainedResourceDisableEventsDigest',content_intake.retained_sop_resource_events(p_base)) ELSE '{}'::jsonb END)),'sha256'),'hex'))
    ||CASE WHEN p_view='resource-disable' THEN jsonb_build_object('retainedResourceDisableEventsDigest',content_intake.retained_sop_resource_events(p_base),'newResourceDisableCount',0) ELSE '{}'::jsonb END;
END $$;
ALTER FUNCTION content_intake.preview_rollback(text,text,text,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.preview_rollback(text,text,text,text) FROM PUBLIC,app_runtime,intake_worker,intake_usage;
GRANT EXECUTE ON FUNCTION content_intake.preview_rollback(text,text,text,text) TO intake_business;
CREATE OR REPLACE FUNCTION content_intake.preview_rollback(p_actor text,p_base text,p_target text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT content_intake.preview_rollback(p_actor,p_base,p_target,'legacy')
$$;

CREATE OR REPLACE FUNCTION content_intake.execute_rollback(p_actor TEXT,p_request JSONB,p_observation JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE plan content_intake.rollback_plans; actor content_intake.principals; preview JSONB;
  deadline TIMESTAMPTZ; inherited_until TIMESTAMPTZ; owner_until TIMESTAMPTZ;
  actor_until TIMESTAMPTZ; issued_at TIMESTAMPTZ := clock_timestamp(); resource_format boolean; ticket TEXT; release_id_new TEXT; announcement_id_new TEXT; seq BIGINT;
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
  resource_format:=p_request ? 'retainedResourceDisableEventsDigest';
  preview:=content_intake.preview_rollback(p_actor,plan.base_release_id,plan.target_release_id,CASE WHEN resource_format THEN 'resource-disable' ELSE 'legacy' END);
  IF resource_format AND p_request->>'retainedResourceDisableEventsDigest' IS DISTINCT FROM preview->>'retainedResourceDisableEventsDigest' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='MATERIAL_CHANGED';
  END IF;
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
    'action','rollback','state','published','releaseId',release_id_new,'announcementId',announcement_id_new,'reason',NULL)
    ||CASE WHEN resource_format THEN jsonb_build_object('retainedResourceDisableEventsDigest',preview->>'retainedResourceDisableEventsDigest') ELSE '{}'::jsonb END,'validUntil',deadline);
END $$;

CREATE OR REPLACE FUNCTION content_intake.read_sop_graph_base(p_actor text,p_source text,p_release text) RETURNS jsonb
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
    WHERE c.source_id=p_source AND c.canonical_encoding IN ('candidate-sop-task-graph-v2','candidate-sop-resource-disable-v1') ORDER BY a.depth LIMIT 1;
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

CREATE OR REPLACE FUNCTION content_intake.resolve_sop_media_entitlement(p_actor text,p_session text,p_presented text) RETURNS text
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
      AND e.principal_id=p_actor AND ctx.session_token_hash=p_session AND e.contract_view IN ('graph','resource-disable') AND e.sop_continuation_hash IS NULL;
  IF result IS NULL THEN RAISE EXCEPTION USING ERRCODE='ZA002',MESSAGE='SCOPE_DENIED'; END IF;
  RETURN result;
END $$;
