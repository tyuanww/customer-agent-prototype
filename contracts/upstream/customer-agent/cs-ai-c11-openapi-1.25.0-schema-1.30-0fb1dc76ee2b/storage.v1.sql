-- schema.v1.30 storage contract candidate, not a product migration.
-- Existing format guards, quality and publish functions remain closed to this new format
-- until the product implements the obligations in installation.candidate.json.
-- No second current pointer, no new authorization domain, no direct runtime table grants.
CREATE TABLE content_intake.sop_graph_versions (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  operation text NOT NULL CHECK (operation IN ('upsert','disable')),
  canonical_graph text NOT NULL CHECK (octet_length(canonical_graph) BETWEEN 2 AND 33554432),
  graph_payload jsonb NOT NULL CHECK (jsonb_typeof(graph_payload)='object'),
  graph_digest text GENERATED ALWAYS AS (encode(public.digest(canonical_graph,'sha256'),'hex')) STORED,
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  UNIQUE (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  CHECK (canonical_graph::jsonb=graph_payload),
  CHECK (graph_payload ?& ARRAY['definition','entries','media']),
  CHECK (graph_payload-ARRAY['definition','entries','media']='{}'::jsonb),
  CHECK (graph_payload#>>'{definition,header,key,sourceId}' IS NOT DISTINCT FROM source_id::text),
  CHECK (graph_payload#>>'{definition,header,key,flowId}' IS NOT DISTINCT FROM flow_id::text),
  CHECK (graph_payload#>>'{definition,header,key,flowVersion}' IS NOT DISTINCT FROM flow_version::text),
  CHECK (graph_payload#>>'{definition,header,operation}' IS NOT DISTINCT FROM operation),
  CHECK (jsonb_typeof(graph_payload#>'{definition,nodes}') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_array_length(graph_payload#>'{definition,nodes}') BETWEEN 1 AND 128),
  CHECK (jsonb_typeof(graph_payload#>'{definition,edges}') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_array_length(graph_payload#>'{definition,edges}') BETWEEN 0 AND 512),
  CHECK (jsonb_typeof(graph_payload->'entries') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_typeof(graph_payload->'media') IS NOT DISTINCT FROM 'array')
);

CREATE TABLE content_intake.sop_graph_media_bindings (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  business_entry_id content_intake.identifier NOT NULL,
  script_version content_intake.version NOT NULL,
  object_id content_intake.identifier NOT NULL,
  sha256 content_intake.sha256 NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  alt text NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 1024 AND alt ~ '\S'),
  required boolean NOT NULL,
  PRIMARY KEY (candidate_id,candidate_version,object_id),
  UNIQUE (candidate_id,candidate_version,source_id,business_entry_id,script_version,ordinal),
  UNIQUE (candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id)
    REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  FOREIGN KEY (object_id,source_id,sha256,bytes,mime)
    REFERENCES content_intake.sop_media_objects(media_object_id,source_id,sha256,bytes,mime)
);

CREATE TABLE content_intake.sop_graph_quality_targets (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  material_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  policy_version text NOT NULL CHECK (policy_version='sop-graph-quality-v1'),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,material_digest)
    REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  UNIQUE (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
);
CREATE TABLE content_intake.sop_graph_quality_checks (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  phase text NOT NULL CHECK (phase IN ('initial','expanded')),
  reviewer_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  defect boolean NOT NULL,
  reason text NOT NULL CHECK (char_length(reason)<=2000),
  checked_at timestamptz NOT NULL CHECK (isfinite(checked_at)),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id,phase),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_quality_targets(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
  CHECK (NOT defect OR reason ~ '\S')
);

-- One source/flow per release. Tombstones stay in the candidate history; only upserts
-- enter this projection. Deferred FKs permit one atomic catalog/lineage/current write.
CREATE TABLE content_intake.sop_graph_release_lineage (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  review_request_id content_intake.identifier NOT NULL,
  PRIMARY KEY (release_id,source_id,flow_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (review_request_id,candidate_id,candidate_version)
    REFERENCES content_intake.review_bindings(review_request_id,candidate_id,candidate_version)
    DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE content_intake.sop_graph_release_media (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL,
  business_entry_id content_intake.identifier NOT NULL,
  script_version content_intake.version NOT NULL,
  object_id content_intake.identifier NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  PRIMARY KEY (release_id,object_id),
  FOREIGN KEY (release_id,source_id,business_entry_id)
    REFERENCES content_intake.release_lineage(release_id,source_id,business_entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id)
    REFERENCES content_intake.sop_graph_media_bindings(candidate_id,candidate_version,source_id,business_entry_id,script_version,object_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE FUNCTION content_intake.sop_graph_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
END $$;
REVOKE ALL ON FUNCTION content_intake.sop_graph_immutable() FROM PUBLIC;
ALTER FUNCTION content_intake.sop_graph_immutable() OWNER TO intake_runtime_fn_owner;
DO $ownership$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['sop_graph_versions','sop_graph_media_bindings',
    'sop_graph_quality_targets','sop_graph_quality_checks','sop_graph_release_lineage','sop_graph_release_media'] LOOP
    EXECUTE format('ALTER TABLE content_intake.%I OWNER TO intake_runtime_fn_owner',relation_name);
    EXECUTE format('REVOKE ALL ON TABLE content_intake.%I FROM PUBLIC, app_runtime, intake_business, intake_worker',relation_name);
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.%I FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable()',relation_name);
  END LOOP;
END $ownership$;
COMMENT ON TABLE content_intake.sop_graph_versions IS 'Immutable complete graph and exact entry/media dependencies. Freeze validates graph reachability, cycles, same-source keys, canonical sorting, digest, diff and media bytes before insertion.';
COMMENT ON TABLE content_intake.sop_graph_quality_targets IS 'Exact changed graph targets frozen with materialDigest. Unchanged graph evidence may only be reused for identical graphDigest with preserved attribution.';
COMMENT ON TABLE content_intake.sop_graph_release_lineage IS 'Derived projection inside the existing publication transaction. No independent current state. Commit must cover all upserts, omit disabled flows, validate all dependencies and quality, then move public.content_current atomically.';
COMMENT ON TABLE content_intake.sop_graph_release_media IS 'Must exactly match the version of the same release entry; never infer binding by title or row number. Backup and rollback preserve referenced media objects.';

-- BEGIN MENOKIN SOP QUERY TRANSPORT
-- schema.v1.30 SOP query transport supplement candidate.
-- Draft only: this is not a product migration and is not installed or activated.
-- The business alias is menokin-sop-query-v1; the formal contract-set id is assigned
-- from the source commit after the candidate is reviewed and exported.
BEGIN;

CREATE TABLE content_intake.sop_query_leases (
  lease_id TEXT PRIMARY KEY CHECK (lease_id ~ '^sopl_[0-9a-f]{64}$'),
  actor_binding_hash TEXT NOT NULL CHECK (actor_binding_hash ~ '^[0-9a-f]{64}$'),
  release_id TEXT NOT NULL REFERENCES public.content_releases(release_id),
  request_id UUID NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  context_generation TEXT NOT NULL CHECK (btrim(context_generation) <> '' AND length(context_generation) <= 128),
  issued_at TIMESTAMPTZ NOT NULL CHECK (isfinite(issued_at)),
  expires_at TIMESTAMPTZ NOT NULL CHECK (isfinite(expires_at) AND expires_at > issued_at),
  session_epoch BIGINT NOT NULL CHECK (session_epoch >= 0),
  UNIQUE (actor_binding_hash, request_id)
);

CREATE INDEX sop_query_leases_expiry_idx
  ON content_intake.sop_query_leases (release_id, expires_at);

CREATE FUNCTION content_intake.sop_query_lease_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'SOP query leases are immutable', DETAIL = 'SOP_QUERY_LEASE_IMMUTABLE';
END;
$$;

CREATE TRIGGER sop_query_leases_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_query_leases
  FOR EACH ROW EXECUTE FUNCTION content_intake.sop_query_lease_immutable();

CREATE FUNCTION content_intake.issue_sop_query_lease(
  p_lease_id TEXT,
  p_actor_binding_hash TEXT,
  p_release_id TEXT,
  p_request_id UUID,
  p_request_hash TEXT,
  p_context_generation TEXT,
  p_issued_at TIMESTAMPTZ,
  p_expires_at TIMESTAMPTZ,
  p_session_epoch BIGINT
) RETURNS content_intake.sop_query_leases
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
DECLARE
  v_existing content_intake.sop_query_leases;
  v_created content_intake.sop_query_leases;
BEGIN
  SELECT * INTO v_existing
  FROM content_intake.sop_query_leases
  WHERE actor_binding_hash = p_actor_binding_hash AND request_id = p_request_id;
  IF FOUND THEN
    IF v_existing.request_hash <> p_request_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'SOP query idempotency conflict', DETAIL = 'IDEMPOTENCY_CONFLICT';
    END IF;
    RETURN v_existing;
  END IF;
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + INTERVAL '15 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SOP query lease window is invalid', DETAIL = 'LEASE_WINDOW_INVALID';
  END IF;
  INSERT INTO content_intake.sop_query_leases (
    lease_id, actor_binding_hash, release_id, request_id, request_hash,
    context_generation, issued_at, expires_at, session_epoch
  ) VALUES (
    p_lease_id, p_actor_binding_hash, p_release_id, p_request_id, p_request_hash,
    p_context_generation, p_issued_at, p_expires_at, p_session_epoch
  ) RETURNING * INTO v_created;
  RETURN v_created;
END;
$$;

CREATE FUNCTION content_intake.validate_sop_query_lease(
  p_lease_id TEXT,
  p_actor_binding_hash TEXT,
  p_release_id TEXT,
  p_request_id UUID,
  p_session_epoch BIGINT
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, content_intake, public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM content_intake.sop_query_leases
    WHERE lease_id = p_lease_id
      AND actor_binding_hash = p_actor_binding_hash
      AND release_id = p_release_id
      AND request_id = p_request_id
      AND session_epoch = p_session_epoch
      AND expires_at > clock_timestamp()
  );
$$;

ALTER TABLE content_intake.sop_query_leases OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.sop_query_lease_immutable() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON TABLE content_intake.sop_query_leases FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.sop_query_lease_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) TO app_runtime;
GRANT EXECUTE ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) TO app_runtime;

COMMENT ON TABLE content_intake.sop_query_leases IS 'Server-owned, release-bound SOP query leases. No raw user id or bearer token is stored; expiry and current access are rechecked at query and response boundaries.';
COMMENT ON COLUMN content_intake.sop_query_leases.actor_binding_hash IS 'Server-derived opaque actor binding hash; never a request field and never reversible identity.';
COMMENT ON COLUMN content_intake.sop_query_leases.request_hash IS 'Canonical hash of the validated request body for same-key idempotency and conflict detection.';
-- END MENOKIN SOP QUERY TRANSPORT
