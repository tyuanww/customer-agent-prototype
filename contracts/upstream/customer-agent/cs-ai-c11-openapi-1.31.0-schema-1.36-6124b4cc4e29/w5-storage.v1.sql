-- W5 review artifact. Verify in a disposable database with PostgreSQL 15.
-- The runtime owner and its transaction entry points are assigned at integration.
CREATE SCHEMA w5_sop_candidate_draft;
REVOKE ALL ON SCHEMA w5_sop_candidate_draft FROM PUBLIC;

CREATE DOMAIN w5_sop_candidate_draft.sha256_hex AS text
  CHECK (VALUE COLLATE "C" ~ '^[0-9a-f]{64}$');

CREATE TABLE w5_sop_candidate_draft.discovery (
  session_hash w5_sop_candidate_draft.sha256_hex NOT NULL,
  request_id uuid NOT NULL,
  principal_id text NOT NULL,
  entitlement_hash w5_sop_candidate_draft.sha256_hex NOT NULL,
  request_hash w5_sop_candidate_draft.sha256_hex NOT NULL,
  authority_binding w5_sop_candidate_draft.sha256_hex NOT NULL,
  release_id text NOT NULL,
  context_generation text NOT NULL CHECK (char_length(context_generation) BETWEEN 1 AND 128),
  status text NOT NULL CHECK (status IN ('candidates', 'ambiguous', 'no_match')),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  session_expires_at timestamptz NOT NULL,
  PRIMARY KEY (session_hash, request_id),
  UNIQUE (session_hash, request_id, status),
  CHECK (issued_at < expires_at AND expires_at <= session_expires_at)
);

CREATE TABLE w5_sop_candidate_draft.candidate (
  session_hash w5_sop_candidate_draft.sha256_hex NOT NULL,
  discovery_request_id uuid NOT NULL,
  discovery_status text NOT NULL DEFAULT 'candidates' CHECK (discovery_status = 'candidates'),
  position smallint NOT NULL CHECK (position BETWEEN 1 AND 5),
  candidate_ref text NOT NULL CHECK (candidate_ref COLLATE "C" ~ '^sdc_[0-9a-f]{64}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 512 AND label ~ '[^[:space:]]'),
  sop_group text NOT NULL CHECK (char_length(sop_group) BETWEEN 1 AND 128),
  source_id text NOT NULL,
  flow_id text NOT NULL,
  graph_digest w5_sop_candidate_draft.sha256_hex NOT NULL,
  candidate_id text NOT NULL,
  candidate_version bigint NOT NULL CHECK (candidate_version > 0),
  facts_version bigint NOT NULL CHECK (facts_version > 0),
  PRIMARY KEY (session_hash, discovery_request_id, candidate_ref),
  UNIQUE (session_hash, discovery_request_id, position),
  UNIQUE (session_hash, discovery_request_id, sop_group),
  FOREIGN KEY (session_hash, discovery_request_id, discovery_status)
    REFERENCES w5_sop_candidate_draft.discovery(session_hash, request_id, status) ON DELETE CASCADE
);

-- Prune from the original session deadline so expired request IDs still conflict.
CREATE INDEX w5_discovery_session_expiry ON w5_sop_candidate_draft.discovery (session_expires_at);
REVOKE ALL ON ALL TABLES IN SCHEMA w5_sop_candidate_draft FROM PUBLIC;

-- Review draft. Load after storage-draft.sql as its owner. The eventual product
-- transaction must reverify ordinary E and hold its current authorization boundary.
-- These invoker functions compare that snapshot with the discovery. They grant no access.
CREATE TYPE w5_sop_candidate_draft.verified_authority AS (
  session_hash w5_sop_candidate_draft.sha256_hex,
  principal_id text,
  entitlement_hash w5_sop_candidate_draft.sha256_hex,
  release_id text,
  authority_binding w5_sop_candidate_draft.sha256_hex,
  valid_until timestamptz,
  session_expires_at timestamptz
);

-- The caller supplies opaque references and candidates in contract order.
CREATE TYPE w5_sop_candidate_draft.candidate_input AS (
  candidate_ref text,
  label text,
  sop_group text,
  source_id text,
  flow_id text,
  graph_digest w5_sop_candidate_draft.sha256_hex,
  candidate_id text,
  candidate_version bigint,
  facts_version bigint
);

CREATE FUNCTION w5_sop_candidate_draft.authority_is_current(
  p_authority w5_sop_candidate_draft.verified_authority,
  p_checked_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    p_authority.session_hash IS NOT NULL
    AND p_authority.principal_id <> ''
    AND p_authority.entitlement_hash IS NOT NULL
    AND p_authority.release_id <> ''
    AND p_authority.authority_binding IS NOT NULL
    AND isfinite(p_authority.valid_until)
    AND isfinite(p_authority.session_expires_at)
    AND p_checked_at < p_authority.valid_until
    AND p_checked_at < p_authority.session_expires_at,
    false
  )
$function$;

CREATE FUNCTION w5_sop_candidate_draft.discovery_matches_authority(
  p_discovery w5_sop_candidate_draft.discovery,
  p_authority w5_sop_candidate_draft.verified_authority,
  p_checked_at timestamptz
) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    w5_sop_candidate_draft.authority_is_current(p_authority, p_checked_at)
    AND p_discovery.session_hash = p_authority.session_hash
    AND p_discovery.principal_id = p_authority.principal_id
    AND p_discovery.entitlement_hash = p_authority.entitlement_hash
    AND p_discovery.release_id = p_authority.release_id
    AND p_discovery.authority_binding = p_authority.authority_binding
    AND p_discovery.session_expires_at = p_authority.session_expires_at
    AND p_discovery.expires_at <= p_authority.valid_until
    AND p_checked_at < p_discovery.expires_at,
    false
  )
$function$;

-- W5001 is a request fingerprint conflict. W5002 is stale authorization or discovery.
-- The producer handles unavailable outcomes outside this completed-decision store.
CREATE FUNCTION w5_sop_candidate_draft.record_discovery(
  p_authority w5_sop_candidate_draft.verified_authority,
  p_request_id uuid,
  p_request_hash w5_sop_candidate_draft.sha256_hex,
  p_context_generation text,
  p_status text,
  p_decision_expires_at timestamptz,
  p_candidates w5_sop_candidate_draft.candidate_input[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
  discovery w5_sop_candidate_draft.discovery;
  checked_at timestamptz;
  expires_at timestamptz;
BEGIN
  IF p_request_id IS NULL OR p_request_hash IS NULL
    OR p_context_generation IS NULL OR char_length(p_context_generation) > 128
    OR p_context_generation !~ '[^[:space:]]'
  THEN
    RAISE EXCEPTION SQLSTATE '22023' USING MESSAGE = 'Invalid discovery request identity';
  END IF;

  IF NOT w5_sop_candidate_draft.authority_is_current(p_authority, clock_timestamp()) THEN
    RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery authority is stale';
  END IF;

  -- The key also serializes first writers, before there is a row to lock.
  -- The full primary key remains the identity even if two lock hashes collide.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'w5_sop_candidate_draft.discovery:' || p_authority.session_hash || ':' || p_request_id::text, 0
  ));

  SELECT stored.* INTO discovery
  FROM w5_sop_candidate_draft.discovery AS stored
  WHERE stored.session_hash = p_authority.session_hash AND stored.request_id = p_request_id
  FOR SHARE;

  checked_at := clock_timestamp();
  IF NOT w5_sop_candidate_draft.authority_is_current(p_authority, checked_at) THEN
    RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery authority is stale';
  END IF;

  IF discovery.request_id IS NOT NULL THEN
    IF discovery.principal_id IS DISTINCT FROM p_authority.principal_id THEN
      RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery authority is stale';
    END IF;

    IF discovery.request_hash IS DISTINCT FROM p_request_hash
      OR discovery.context_generation IS DISTINCT FROM p_context_generation
    THEN
      RAISE EXCEPTION SQLSTATE 'W5001' USING MESSAGE = 'Discovery request fingerprint conflicts';
    END IF;

    IF NOT w5_sop_candidate_draft.discovery_matches_authority(discovery, p_authority, checked_at) THEN
      RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery authority is stale';
    END IF;
  ELSE
    IF p_decision_expires_at IS NULL OR NOT isfinite(p_decision_expires_at) THEN
      RAISE EXCEPTION SQLSTATE '22023' USING MESSAGE = 'Invalid discovery deadline';
    END IF;

    expires_at := least(p_decision_expires_at, p_authority.valid_until, p_authority.session_expires_at);
    IF checked_at >= expires_at THEN
      RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery deadline has passed';
    END IF;

    IF p_status IS NULL OR p_status NOT IN ('candidates', 'ambiguous', 'no_match')
      OR p_candidates IS NULL OR array_ndims(p_candidates) > 1
      OR (p_status = 'candidates' AND cardinality(p_candidates) NOT BETWEEN 1 AND 5)
      OR (p_status <> 'candidates' AND cardinality(p_candidates) <> 0)
    THEN
      RAISE EXCEPTION SQLSTATE '22023' USING MESSAGE = 'Invalid discovery decision';
    END IF;

    INSERT INTO w5_sop_candidate_draft.discovery (
      session_hash, request_id, principal_id, entitlement_hash, request_hash, authority_binding,
      release_id, context_generation, status, issued_at, expires_at, session_expires_at
    ) VALUES (
      p_authority.session_hash, p_request_id, p_authority.principal_id,
      p_authority.entitlement_hash, p_request_hash, p_authority.authority_binding,
      p_authority.release_id, p_context_generation, p_status, checked_at, expires_at,
      p_authority.session_expires_at
    ) RETURNING * INTO discovery;

    INSERT INTO w5_sop_candidate_draft.candidate (
      session_hash, discovery_request_id, position, candidate_ref, label, sop_group,
      source_id, flow_id, graph_digest, candidate_id, candidate_version, facts_version
    )
    SELECT discovery.session_hash, discovery.request_id, supplied.ordinality::smallint,
      supplied.candidate_ref, supplied.label, supplied.sop_group, supplied.source_id,
      supplied.flow_id, supplied.graph_digest, supplied.candidate_id,
      supplied.candidate_version, supplied.facts_version
    FROM unnest(p_candidates) WITH ORDINALITY AS supplied;
  END IF;

  IF discovery.status = 'candidates' THEN
    RETURN jsonb_build_object(
      'status', discovery.status,
      'request_id', discovery.request_id,
      'release_id', discovery.release_id,
      'expires_at', to_char(discovery.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'candidates', (
        SELECT jsonb_agg(jsonb_build_object('candidate_ref', saved.candidate_ref, 'label', saved.label)
          ORDER BY saved.position)
        FROM w5_sop_candidate_draft.candidate AS saved
        WHERE saved.session_hash = discovery.session_hash AND saved.discovery_request_id = discovery.request_id
      )
    );
  END IF;

  RETURN jsonb_build_object('status', discovery.status, 'request_id', discovery.request_id);
END
$function$;

-- Empty means the product must refuse selection. The existing C owner still
-- checks the exact graph and facts again when issuing the selection receipt.
CREATE FUNCTION w5_sop_candidate_draft.resolve_candidate(
  p_authority w5_sop_candidate_draft.verified_authority,
  p_request_id uuid,
  p_candidate_ref text
) RETURNS TABLE (
  sop_group text,
  source_id text,
  flow_id text,
  graph_digest w5_sop_candidate_draft.sha256_hex,
  candidate_id text,
  candidate_version bigint,
  facts_version bigint
)
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog
AS $function$
DECLARE
  discovery w5_sop_candidate_draft.discovery;
BEGIN
  SELECT stored.* INTO discovery
  FROM w5_sop_candidate_draft.discovery AS stored
  WHERE stored.session_hash = p_authority.session_hash AND stored.request_id = p_request_id
  FOR SHARE;

  IF discovery.status IS DISTINCT FROM 'candidates'
    OR NOT w5_sop_candidate_draft.discovery_matches_authority(discovery, p_authority, clock_timestamp())
  THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT saved.sop_group, saved.source_id, saved.flow_id, saved.graph_digest, saved.candidate_id,
    saved.candidate_version, saved.facts_version
  FROM w5_sop_candidate_draft.candidate AS saved
  WHERE saved.session_hash = discovery.session_hash AND saved.discovery_request_id = discovery.request_id
    AND saved.candidate_ref = p_candidate_ref;
END
$function$;

REVOKE ALL ON TYPE w5_sop_candidate_draft.verified_authority, w5_sop_candidate_draft.candidate_input FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA w5_sop_candidate_draft FROM PUBLIC;
