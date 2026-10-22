-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0055_grant_steward_required; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A parented business grant authorizes only while it has a steward and its parent is live.
-- A grant issued directly by its issuer has no parent and is unaffected. Both halves are
-- needed: revoking without a successor clears the steward, and revoking with one leaves the
-- steward in place while marking the parent revoked.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.authorization_sources(
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
    -- A parented grant authorizes only while it has a steward and its parent is live.
    -- A directly issued grant has no parent and keeps its authority.
    AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM content_intake.grants parent_grant
      WHERE parent_grant.grant_id = g.parent_grant_id AND parent_grant.revoked_at IS NULL)))
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

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
  SELECT least(f.valid_until, max(g.expires_at))
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
  JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
  JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
    AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
    -- A parented grant authorizes only while it has a steward and its parent is live.
    -- A directly issued grant has no parent and keeps its authority.
    AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM content_intake.grants parent_grant
      WHERE parent_grant.grant_id = g.parent_grant_id AND parent_grant.revoked_at IS NULL)))
    AND g.starts_at<=p_at AND p_at<g.expires_at
    AND (
      (p_action<>'query' AND (g.source_id IS NULL OR g.source_id=p_source)
        AND EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.source_id=p_source AND src.scope_id=s.scope_id))
      OR (p_action='query' AND g.source_id=p_source
        AND g.policy_version=(SELECT pol.version FROM content_intake.policy_versions pol WHERE pol.tenant_id=p.tenant_id AND pol.app_id=p.app_id)
        AND g.store_set_version=(SELECT cur.version FROM content_intake.store_set_current cur WHERE cur.tenant_id=p.tenant_id AND cur.app_id=p.app_id)
        AND EXISTS (
          SELECT 1 FROM content_intake.store_set_members member
          WHERE member.tenant_id=p.tenant_id AND member.app_id=p.app_id AND member.version=g.store_set_version
            AND member.scope_id=s.scope_id AND member.source_id=p_source
        ))
    )
  JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
    AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
  WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
  GROUP BY f.valid_until
  HAVING count(DISTINCT r.role)=1
    AND (min(r.role) IN ('director','manager','supervisor','lead','engineer')
      OR (min(r.role) IN ('agent','enabler') AND p_action='query'))
$$;
