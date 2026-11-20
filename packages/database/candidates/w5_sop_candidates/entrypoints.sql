ALTER SCHEMA w5_sop_candidate_draft OWNER TO intake_runtime_fn_owner;
ALTER TABLE w5_sop_candidate_draft.discovery OWNER TO intake_runtime_fn_owner;
ALTER TABLE w5_sop_candidate_draft.candidate OWNER TO intake_runtime_fn_owner;
ALTER DOMAIN w5_sop_candidate_draft.sha256_hex OWNER TO intake_runtime_fn_owner;
ALTER TYPE w5_sop_candidate_draft.verified_authority OWNER TO intake_runtime_fn_owner;
ALTER TYPE w5_sop_candidate_draft.candidate_input OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION w5_sop_candidate_draft.authority_is_current(w5_sop_candidate_draft.verified_authority,timestamptz)
  OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION w5_sop_candidate_draft.discovery_matches_authority(w5_sop_candidate_draft.discovery,
  w5_sop_candidate_draft.verified_authority,timestamptz) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION w5_sop_candidate_draft.record_discovery(w5_sop_candidate_draft.verified_authority,uuid,
  w5_sop_candidate_draft.sha256_hex,text,text,timestamptz,w5_sop_candidate_draft.candidate_input[])
  OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION w5_sop_candidate_draft.resolve_candidate(w5_sop_candidate_draft.verified_authority,uuid,text)
  OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON DOMAIN w5_sop_candidate_draft.sha256_hex FROM PUBLIC;

CREATE SCHEMA w5_sop_candidates AUTHORIZATION intake_runtime_fn_owner;
REVOKE ALL ON SCHEMA w5_sop_candidates FROM PUBLIC;
GRANT USAGE ON SCHEMA w5_sop_candidates TO intake_usage;

CREATE FUNCTION w5_sop_candidates.record_discovery(
  p_authority jsonb, p_request_id uuid, p_request_hash text, p_context_generation text,
  p_status text, p_decision_expires_at timestamptz, p_candidates jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authority w5_sop_candidate_draft.verified_authority;
  decision jsonb;
BEGIN
  authority := jsonb_populate_record(NULL::w5_sop_candidate_draft.verified_authority, p_authority);
  IF NOT w5_sop_candidate_draft.authority_is_current(authority, clock_timestamp()) THEN
    RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Discovery authority is stale';
  END IF;

  -- The replay-only probe and a first successful decision serialize on the
  -- same key until the surrounding qualification transaction commits.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'w5_sop_candidates.record_discovery:' || authority.session_hash || ':' || p_request_id::text, 0
  ));
  IF p_status IS NULL AND NOT EXISTS (
    SELECT FROM w5_sop_candidate_draft.discovery AS saved
    WHERE saved.session_hash = authority.session_hash AND saved.request_id = p_request_id
  ) THEN
    RETURN NULL;
  END IF;

  decision := w5_sop_candidate_draft.record_discovery(
    authority, p_request_id, p_request_hash, p_context_generation, p_status, p_decision_expires_at,
    CASE WHEN p_candidates IS NOT NULL THEN ARRAY(
      SELECT jsonb_populate_record(NULL::w5_sop_candidate_draft.candidate_input, element.value)
      FROM jsonb_array_elements(p_candidates) WITH ORDINALITY AS element(value, position)
      ORDER BY element.position
    ) END
  );

  IF p_status IS NOT NULL THEN
    DELETE FROM w5_sop_candidate_draft.discovery AS saved
    USING (
      SELECT expired.session_hash, expired.request_id
      FROM w5_sop_candidate_draft.discovery AS expired
      WHERE expired.session_expires_at <= clock_timestamp()
      ORDER BY expired.session_expires_at, expired.session_hash, expired.request_id
      LIMIT 100 FOR UPDATE SKIP LOCKED
    ) AS expired_sessions
    WHERE saved.session_hash = expired_sessions.session_hash AND saved.request_id = expired_sessions.request_id;
  END IF;
  RETURN decision;
END
$function$;

CREATE FUNCTION w5_sop_candidates.resolve_candidate(
  p_authority jsonb, p_request_id uuid, p_candidate_ref text
) RETURNS TABLE (
  sop_group text, source_id text, flow_id text, graph_digest text, candidate_id text,
  candidate_version bigint, facts_version bigint, context_generation text, expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $function$
DECLARE
  authority w5_sop_candidate_draft.verified_authority;
BEGIN
  authority := jsonb_populate_record(NULL::w5_sop_candidate_draft.verified_authority, p_authority);
  RETURN QUERY
  SELECT resolved.sop_group, resolved.source_id, resolved.flow_id, resolved.graph_digest::text,
    resolved.candidate_id, resolved.candidate_version, resolved.facts_version,
    saved.context_generation, saved.expires_at
  FROM w5_sop_candidate_draft.resolve_candidate(authority, p_request_id, p_candidate_ref) AS resolved
  JOIN w5_sop_candidate_draft.discovery AS saved
    ON saved.session_hash = authority.session_hash AND saved.request_id = p_request_id;
  IF FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT FROM w5_sop_candidate_draft.discovery AS original_discovery
    JOIN w5_sop_candidate_draft.candidate AS candidate
      ON candidate.session_hash = original_discovery.session_hash AND candidate.discovery_request_id = original_discovery.request_id
    WHERE original_discovery.session_hash = authority.session_hash AND original_discovery.request_id = p_request_id
      AND original_discovery.principal_id = authority.principal_id
      AND original_discovery.entitlement_hash = authority.entitlement_hash AND original_discovery.release_id = authority.release_id
      AND original_discovery.authority_binding = authority.authority_binding
      AND original_discovery.session_expires_at = authority.session_expires_at
      AND candidate.candidate_ref = p_candidate_ref
      AND original_discovery.expires_at <= clock_timestamp()
  ) THEN
    RAISE EXCEPTION SQLSTATE 'W5002' USING MESSAGE = 'Candidate discovery expired';
  END IF;
END
$function$;

ALTER FUNCTION w5_sop_candidates.record_discovery(jsonb,uuid,text,text,text,timestamptz,jsonb)
  OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION w5_sop_candidates.resolve_candidate(jsonb,uuid,text) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA w5_sop_candidates FROM PUBLIC;
GRANT EXECUTE ON FUNCTION w5_sop_candidates.record_discovery(jsonb,uuid,text,text,text,timestamptz,jsonb) TO intake_usage;
GRANT EXECUTE ON FUNCTION w5_sop_candidates.resolve_candidate(jsonb,uuid,text) TO intake_usage;
