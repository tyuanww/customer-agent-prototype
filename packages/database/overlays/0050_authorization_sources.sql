-- One row per live business grant source. The role ceiling stays, without folding
-- several grants into one timestamp.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.authorization_sources(
  p_principal TEXT,
  p_action TEXT,
  p_at TIMESTAMPTZ
) RETURNS TABLE (
  scope_id content_intake.identifier,
  source_id content_intake.identifier,
  policy_version content_intake.version,
  store_set_version content_intake.version,
  valid_until TIMESTAMPTZ
)
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT s.scope_id,
    expanded.source_id,
    g.policy_version,
    g.store_set_version,
    least(f.valid_until, g.expires_at)
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
  JOIN content_intake.grants g
    ON g.recipient_id = p.principal_id
    AND g.action = p_action
    AND g.kind = 'business'
    AND g.revoked_at IS NULL
    AND g.starts_at <= p_at
    AND p_at < g.expires_at
  JOIN content_intake.scopes s
    ON s.scope_id = g.scope_id
    AND s.tenant_id = p.tenant_id
    AND s.app_id = p.app_id
  JOIN LATERAL (
    SELECT src.source_id
    FROM content_intake.sources src
    WHERE src.scope_id = s.scope_id
      AND (
        (p_action = 'query'
          AND g.source_id = src.source_id
          AND g.policy_version = (
            SELECT pol.version FROM content_intake.policy_versions pol
            WHERE pol.tenant_id = p.tenant_id AND pol.app_id = p.app_id
          )
          AND g.store_set_version = (
            SELECT cur.version FROM content_intake.store_set_current cur
            WHERE cur.tenant_id = p.tenant_id AND cur.app_id = p.app_id
          )
          AND EXISTS (
            SELECT 1 FROM content_intake.store_set_members member
            WHERE member.tenant_id = p.tenant_id
              AND member.app_id = p.app_id
              AND member.version = g.store_set_version
              AND member.scope_id = s.scope_id
              AND member.source_id = src.source_id
          ))
        OR (p_action <> 'query' AND (g.source_id IS NULL OR g.source_id = src.source_id))
      )
  ) expanded ON TRUE
  WHERE p.principal_id = p_principal
    AND f.enabled
    AND f.checked_at <= p_at
    AND p_at < f.valid_until
    AND (
      SELECT count(DISTINCT r.role) = 1
        AND (
          min(r.role) IN ('director', 'manager', 'supervisor', 'lead', 'engineer')
          OR (min(r.role) IN ('agent', 'enabler') AND p_action = 'query')
        )
      FROM content_intake.role_rules r
      WHERE r.tenant_id = p.tenant_id
        AND r.app_id = p.app_id
        AND r.department_id = ANY(f.department_ids)
        AND r.job_id = f.job_id
    )
$$;

ALTER FUNCTION content_intake.authorization_sources(TEXT, TEXT, TIMESTAMPTZ) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.authorization_sources(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.authorization_sources(TEXT, TEXT, TIMESTAMPTZ)
  TO intake_usage, intake_business, intake_runtime_fn_owner, app_content_admin;
GRANT SELECT ON
  content_intake.principals,
  content_intake.principal_facts,
  content_intake.grants,
  content_intake.scopes,
  content_intake.sources,
  content_intake.policy_versions,
  content_intake.store_set_current,
  content_intake.store_set_members,
  content_intake.role_rules
  TO cs_ai_definer;

-- authorization_deadline runs with caller rights and reads the current store set for every
-- query grant. 0048 granted those reads only to intake_business, so the usage pool that serves
-- /v1/intake/authorization and discovery failed with "permission denied for table
-- store_set_current" as soon as a query grant carried a policy version.
GRANT SELECT ON
  content_intake.store_sets,
  content_intake.store_set_members,
  content_intake.store_set_current
  TO intake_usage, intake_worker, intake_org_writer;

-- authorization_deadline runs with caller rights. SECURITY DEFINER functions owned by
-- intake_runtime_fn_owner (for example read_sop_inherited_assets) call it, so that owner
-- needs the same reads the definer role has; without them the call fails closed with a
-- "permission denied for table policy_versions" instead of a decision.
GRANT SELECT ON
  content_intake.principals,
  content_intake.principal_facts,
  content_intake.grants,
  content_intake.scopes,
  content_intake.sources,
  content_intake.policy_versions,
  content_intake.store_set_current,
  content_intake.store_set_members,
  content_intake.role_rules
  TO intake_runtime_fn_owner;
