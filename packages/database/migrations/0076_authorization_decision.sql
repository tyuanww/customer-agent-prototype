-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0076_authorization_decision; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- The effective source set owns authorization. A single-source deadline projects it
-- so role, source and revocation rules cannot drift between the two entry points.
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
    -- Delegation keeps its row after its allocation is revoked. Every ancestor must
    -- remain live; the insert guard alone only proves authority at issuance time.
    AND (g.parent_grant_id IS NULL OR (g.steward_id IS NOT NULL AND EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT parent.*, ARRAY[g.grant_id::text, parent.grant_id::text] AS visited,
          parent.grant_id = g.grant_id AS cycle
        FROM content_intake.grants parent
        WHERE parent.grant_id = g.parent_grant_id
        UNION ALL
        SELECT parent.*, ancestor.visited || parent.grant_id::text,
          parent.grant_id::text = ANY(ancestor.visited)
        FROM ancestors ancestor
        JOIN content_intake.grants parent ON parent.grant_id = ancestor.parent_grant_id
        WHERE NOT ancestor.cycle
      )
      SELECT true FROM ancestors ancestor
      HAVING bool_and(
        NOT ancestor.cycle AND ancestor.revoked_at IS NULL
        AND ancestor.starts_at <= p_at AND p_at < ancestor.expires_at
        AND ancestor.tenant_id = g.tenant_id AND ancestor.app_id = g.app_id
        AND ancestor.scope_id = g.scope_id AND ancestor.action = g.action
        AND (ancestor.source_id IS NULL OR ancestor.source_id IS NOT DISTINCT FROM g.source_id)
      ) AND bool_or(ancestor.parent_grant_id IS NULL)
    )))
    AND g.starts_at <= p_at
    AND p_at < g.expires_at
  JOIN content_intake.scopes s
    ON s.scope_id = g.scope_id
    AND s.tenant_id = p.tenant_id
    AND s.app_id = p.app_id
  JOIN LATERAL (
    SELECT g.source_id AS source_id
    WHERE p_action = 'query'
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
          AND member.source_id = g.source_id
      )

    UNION ALL

    SELECT src.source_id
    FROM content_intake.sources src
    WHERE p_action <> 'query'
      AND src.scope_id = s.scope_id
      AND (g.source_id IS NULL OR g.source_id = src.source_id)
  ) expanded ON TRUE
  WHERE p.principal_id = p_principal
    AND f.enabled
    AND f.checked_at <= p_at
    AND p_at < f.valid_until
    AND (
      SELECT count(DISTINCT r.role) = 1
        AND content_intake.role_allows(min(r.role), p_action)
      FROM content_intake.role_rules r
      WHERE r.tenant_id = p.tenant_id
        AND r.app_id = p.app_id
        AND r.department_id = ANY(f.department_ids)
        AND r.job_id = f.job_id
    )
$$;

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT max(allowed.valid_until)
  FROM content_intake.authorization_sources(p_principal, p_action, p_at) allowed
  WHERE allowed.scope_id = p_scope AND allowed.source_id = p_source
$$;

GRANT EXECUTE ON FUNCTION content_intake.authorization_sources(TEXT, TEXT, TIMESTAMPTZ)
  TO intake_directory_fn_owner;
