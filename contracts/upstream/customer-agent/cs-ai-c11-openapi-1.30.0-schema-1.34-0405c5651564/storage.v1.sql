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
