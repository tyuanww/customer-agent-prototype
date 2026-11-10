-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0084_sop_unified_storage; source schema.v1.33 unified SOP storage; storage_sha256=f2dfd7c6d7053d188089f7a171cb108ae2fa613bb5e7f30447acd0e1c4163510
-- contract_set_id=cs-ai-c11-openapi-1.29.1-schema-1.33-812a2e80584f
-- source_git_sha=812a2e80584f08675fab8b7401ce8b4cd3ab5bca
-- source_schema_sha256=2ed15384fd2e1d0a4993dfebc40e68980b4ef8f4f1effe172b656f3c3c63cd12
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Unified task-graph storage candidate, one incremental contract from the actual
-- formal predecessor. Graph-v1 is local frozen evidence, not an installed runtime
-- predecessor. This is a storage contract draft, not a numbered product migration.
-- No independent current pointer, grants system or graph-v1 compatibility tables.
-- jsonb_jcs checks ASCII keys by comparing character and byte lengths, and the
-- digest is over database text bytes; both require UTF-8 for this contract.
DO $$
BEGIN
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION USING ERRCODE='0A000', MESSAGE='SOP_GRAPH_REQUIRES_UTF8';
  END IF;
END $$;
-- CHECK executes as the writer; the restricted owner is the only graph writer.
GRANT EXECUTE ON FUNCTION public.jsonb_jcs(jsonb) TO intake_runtime_fn_owner;
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
  -- Compare bytes, not text under a possibly nondeterministic collation. The
  -- predecessor helper also rejects non-ASCII keys and non-integer numbers.
  CHECK (convert_to(canonical_graph,'UTF8')=convert_to(public.jsonb_jcs(graph_payload),'UTF8')),
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

-- One canonical image association for entry, task or knowledge owners. The same
-- content object or FAQ entry can be referenced by multiple tasks and flows; this
-- table is a derived binding, never a second owner of the body or object bytes.
CREATE TABLE content_intake.sop_graph_media_bindings (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  resource_id content_intake.identifier NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('entry','task','knowledge')),
  owner_id content_intake.identifier NOT NULL,
  entry_script_version content_intake.version,
  object_id content_intake.identifier NOT NULL,
  sha256 content_intake.sha256 NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg','image/gif')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 5242880),
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 100),
  alt text NOT NULL CHECK (char_length(alt) BETWEEN 1 AND 1024 AND alt ~ '\S'),
  required boolean NOT NULL,
  audience text NOT NULL CHECK (audience IN ('agent','coach','customer')),
  product_refs jsonb NOT NULL CHECK (jsonb_typeof(product_refs)='array'),
  scenario_refs jsonb NOT NULL CHECK (jsonb_typeof(scenario_refs)='array'),
  CHECK ((owner_kind='entry' AND entry_script_version IS NOT NULL AND audience='customer')
      OR (owner_kind IN ('task','knowledge') AND entry_script_version IS NULL AND audience IN ('agent','coach'))),
  PRIMARY KEY (candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id),
  UNIQUE (candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,ordinal),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest),
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
  policy_version text NOT NULL CHECK (policy_version='sop-task-graph-quality-v2'),
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

CREATE TABLE content_intake.sop_graph_release_lineage (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  publication_policy text NOT NULL CHECK (publication_policy IN ('approval-v1','direct-v1')),
  review_request_id content_intake.identifier,
  PRIMARY KEY (release_id,source_id,flow_id),
  UNIQUE (release_id,source_id,flow_id,flow_version,graph_digest),
  UNIQUE (release_id,source_id,flow_id,candidate_id,candidate_version),
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_versions(candidate_id,candidate_version,source_id,flow_id,flow_version,graph_digest)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,publication_policy)
    REFERENCES content_intake.candidate_versions(candidate_id,version,publication_policy)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (review_request_id,candidate_id,candidate_version)
    REFERENCES content_intake.review_bindings(review_request_id,candidate_id,candidate_version)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK ((publication_policy='approval-v1' AND review_request_id IS NOT NULL)
      OR (publication_policy='direct-v1' AND review_request_id IS NULL))
);
-- A single per-release projection of the canonical graph-media bindings.
CREATE TABLE content_intake.sop_graph_release_media (
  release_id text NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  owner_kind text NOT NULL CHECK (owner_kind IN ('entry','task','knowledge')),
  owner_id content_intake.identifier NOT NULL,
  entry_business_entry_id text GENERATED ALWAYS AS (CASE WHEN owner_kind='entry' THEN owner_id::text ELSE NULL END) STORED,
  resource_id content_intake.identifier NOT NULL,
  object_id content_intake.identifier NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  PRIMARY KEY (release_id,source_id,flow_id,owner_kind,owner_id,resource_id,object_id),
  FOREIGN KEY (release_id,source_id,flow_id,candidate_id,candidate_version)
    REFERENCES content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,candidate_id,candidate_version)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (release_id,source_id,entry_business_entry_id)
    REFERENCES content_intake.release_lineage(release_id,source_id,business_entry_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id)
    REFERENCES content_intake.sop_graph_media_bindings(candidate_id,candidate_version,source_id,flow_id,owner_kind,owner_id,resource_id,object_id)
    DEFERRABLE INITIALLY DEFERRED
);
-- Both referenced histories are immutable. Check the existing keys at deferred
-- constraint time instead of adding redundant unique indexes or entry versions
-- to task/knowledge projections. Publication may insert these rows in any order.
GRANT SELECT ON content_intake.release_lineage TO intake_runtime_fn_owner;
CREATE FUNCTION content_intake.sop_graph_release_media_entry_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.sop_graph_media_bindings AS binding
    JOIN content_intake.release_lineage AS lineage
      ON lineage.release_id=NEW.release_id AND lineage.source_id=NEW.source_id
      AND lineage.business_entry_id=NEW.owner_id
      AND lineage.script_version=binding.entry_script_version
    WHERE binding.candidate_id=NEW.candidate_id AND binding.candidate_version=NEW.candidate_version
      AND binding.source_id=NEW.source_id AND binding.flow_id=NEW.flow_id
      AND binding.owner_kind=NEW.owner_kind AND binding.owner_id=NEW.owner_id
      AND binding.resource_id=NEW.resource_id AND binding.object_id=NEW.object_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE='23514', CONSTRAINT='sop_graph_release_media_entry_version',
      MESSAGE='SOP_GRAPH_ENTRY_VERSION_MISMATCH';
  END IF;
  RETURN NULL;
END $$;
ALTER FUNCTION content_intake.sop_graph_release_media_entry_version() OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.sop_graph_release_media_entry_version() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER sop_graph_release_media_entry_version
  AFTER INSERT ON content_intake.sop_graph_release_media DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW WHEN (NEW.owner_kind='entry')
  EXECUTE FUNCTION content_intake.sop_graph_release_media_entry_version();

CREATE TABLE content_intake.sop_active_uses (
  continuation_hash content_intake.sha256 PRIMARY KEY,
  principal_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  session_hash content_intake.sha256 REFERENCES backend_identity.sessions(token_hash),
  opened_entitlement_hash content_intake.sha256 NOT NULL REFERENCES content_intake.entitlements,
  context_generation content_intake.version NOT NULL,
  -- Pins original release integrity, not current authorization.
  source_binding_hash content_intake.sha256 NOT NULL,
  release_id text NOT NULL,
  source_id content_intake.identifier NOT NULL,
  flow_id content_intake.identifier NOT NULL,
  flow_version content_intake.version NOT NULL,
  graph_digest content_intake.sha256 NOT NULL,
  started_at timestamptz NOT NULL CHECK (isfinite(started_at)),
  closed_at timestamptz CHECK (closed_at IS NULL OR (isfinite(closed_at) AND closed_at>=started_at)),
  CONSTRAINT sop_active_session_binding CHECK ((closed_at IS NULL AND session_hash IS NOT NULL) OR (closed_at IS NOT NULL AND session_hash IS NULL)),
  FOREIGN KEY (release_id,source_id,flow_id,flow_version,graph_digest)
    REFERENCES content_intake.sop_graph_release_lineage(release_id,source_id,flow_id,flow_version,graph_digest)
);

-- Continuation-issued entitlements are never generic historical query access.
ALTER TABLE content_intake.entitlements
  ADD COLUMN sop_continuation_hash content_intake.sha256
  REFERENCES content_intake.sop_active_uses(continuation_hash);

CREATE TABLE content_intake.sop_graph_disable_events (
  release_id text NOT NULL REFERENCES content_intake.release_catalogs DEFERRABLE INITIALLY DEFERRED,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  target_kind text NOT NULL CHECK (target_kind IN ('flow','resource')),
  target_id content_intake.identifier NOT NULL,
  PRIMARY KEY (release_id,source_id,target_kind,target_id)
);
CREATE FUNCTION content_intake.sop_graph_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
END $$;
REVOKE ALL ON FUNCTION content_intake.sop_graph_immutable() FROM PUBLIC;
ALTER FUNCTION content_intake.sop_graph_immutable() OWNER TO intake_runtime_fn_owner;
DO $ownership$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['sop_graph_versions','sop_graph_media_bindings',
    'sop_graph_quality_targets','sop_graph_quality_checks','sop_graph_release_lineage',
    'sop_graph_release_media','sop_graph_disable_events'] LOOP
    EXECUTE format('ALTER TABLE content_intake.%I OWNER TO intake_runtime_fn_owner',name);
    EXECUTE format('REVOKE ALL ON TABLE content_intake.%I FROM PUBLIC, app_runtime, intake_business, intake_worker',name);
    EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON content_intake.%I FOR EACH ROW EXECUTE FUNCTION content_intake.sop_graph_immutable()',name);
  END LOOP;
END $ownership$;
ALTER TABLE content_intake.sop_active_uses OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON TABLE content_intake.sop_active_uses FROM PUBLIC, app_runtime, intake_business, intake_worker;

-- REQUIRED TRANSACTION CHANGES, NOT IMPLEMENTED IN THIS DRAFT:
-- * Freeze verifies canonical graph, mappingDigest, exact owner/entry/media
--   projections, audience and source/vocabulary subset; bind all six-table rows
--   and images. For entry media the binding must equal an enabled EntryRef of
--   that flow and the same release_lineage entry/version; tasks/knowledge must
--   belong to that flow. SQL owner checks and FKs do not substitute for this.
-- * Publish/rollback atomically project the single media binding set with graph and entry lineage,
--   retain tombstones, then update public.content_current once.
-- * For open, look up an existing handle before enforcing current-release
--   issuance. Revalidate an exact existing binding with the current account and
--   authority even if its original entitlement has expired or a new release was
--   published. Only first creation requires a CURRENT entitlement and records
--   subject/session/context and release/flow/version/digest under the publish
--   lock. A conflicting binding is rejected; close is explicit.
-- * Open validates the actor through the existing authorization owner and binds
--   the current session, principal, context and immutable published graph. Main
--   generates the opaque handle and retries with the same binding; a recorded
--   opening entitlement proves the open, not future authorization.
-- * The active record is distinct from the five-minute entitlement. Do not set
--   an independent timeout or require heartbeats; keep it while the original
--   application process and flow remain active. Automatic session expiry pauses
--   display/actions; a newly authenticated session for the same account may be
--   rebound after checking the old session expired without explicit revocation.
-- * Resume requires the opaque continuation ID and an authenticated session.
--   Lock the row; reject closed, forged, cross-account, explicit logout, content
--   disabled or truly expired cases. Permit a new same-account session only after
--   proving the previous session expired without revocation; missing proof fails
--   closed. Ask the existing authorization owner for a
--   currently valid query and ancestor grant chain, source, selection and session.
--   A newly granted chain may replace an old one; loss of authorization pauses
--   access instead of permanently destroying otherwise valid flow progress.
--   Recheck retained mapping, approval, content/media deadlines, original graph,
--   exact dependencies and explicit content disable events since opening. Derive
--   historical release ONLY from the locked row, never from caller input. Issue a
--   NEW bounded entitlement and lease after all checks; never revive the old one.
--   A lost response may be retried against the active record and revalidated.
-- * Online finish atomically closes the row and clears its session reference;
--   repeated finish is idempotent. Keep the minimal closed row while immutable
--   entitlement history references it. An
--   offline finish discards the in-memory handle and progress; the server cannot
--   know a close that has not reached it. Application exit closes the session;
--   no cross-restart progress recovery or extra local tombstone is promised.
-- * An explicit null anchor and empty FAQ dependency set are valid for a graph.
--   Preserve the FAQ-only nonempty rule and use source/scope authorization.
-- * Bind graph release lineage to the candidate's actual publication policy;
--   direct-v1 has no review request, approval-v1 requires a genuine one, and
--   both follow their existing source-confirmation and quality checks.
-- * Existing public.issue_snapshot_offline_lease selects current and is unchanged.
--   A narrow continuation issuer must derive release only from the locked active
--   row and share source, approval, object and live-grant validators. Restrict
--   SECURITY DEFINER owner/search_path/EXECUTE; no generic historical issuer.
-- * Scan immutable disable events and entry tombstones after the opening release;
--   re-enablement must never revive an active flow that crossed a disable.
-- * Explicit content disables, authoritative source-version suspension, explicit
--   logout and actual content expiry end the flow. Grant loss, source membership
--   absence or selection mismatch deny protected reads and operations while
--   they persist; a fresh valid authorization may resume an otherwise valid flow.
-- * A continuation-issued entitlement binds to exactly one active use. Validate
--   principal, session, source, flow, release and live authorization when issuing
--   and on every page/action/media read. It can read only that flow and its exact
--   dependencies; reject it for normal search or unrelated flows. Ordinary FAQ
--   entitlements retain their existing bounded post-publication behavior, but
--   cannot read an old SOP graph or its flow-only dependencies.
-- * Restore shop, product and scenario selections from the opening entitlement
--   context, revalidating them against current authorization; use the new
--   Main-supplied context generation only for the newly issued entitlement.
--   Retain the most recently bound session record until the flow ends so a
--   natural expiry can be distinguished from an explicit revocation.
-- * No direct runtime table writes. Audit, retention, concurrency, logout, crash,
--   backup/restore, cleanup and all FK/projection checks belong to product migration.
-- schema.v1.30 SOP query transport supplement candidate.
-- Draft only: this is not a product migration and is not installed or activated.
-- The business alias is menokin-sop-query-v1; the formal contract-set id is assigned
-- from the source commit after the candidate is reviewed and exported.

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
  IF p_expires_at <= p_issued_at OR p_expires_at > p_issued_at + INTERVAL '5 minutes' THEN
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
COMMENT ON COLUMN content_intake.sop_query_leases.request_hash IS 'Canonical hash of the validated request body for same-key idempotency and conflict detection.';-- The candidate, original publication and graph must belong to one history.
-- Inheritance and rollback retain the original candidate and publication.
ALTER TABLE content_intake.sop_graph_release_lineage
  ADD CONSTRAINT sop_graph_original_publication_fk
  FOREIGN KEY (candidate_id,candidate_version)
  REFERENCES content_intake.publications(candidate_id,candidate_version)
  DEFERRABLE INITIALLY DEFERRED;

REVOKE ALL ON FUNCTION content_intake.issue_sop_query_lease(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,BIGINT) FROM app_runtime;
REVOKE ALL ON FUNCTION content_intake.validate_sop_query_lease(TEXT,TEXT,TEXT,UUID,BIGINT) FROM app_runtime;
