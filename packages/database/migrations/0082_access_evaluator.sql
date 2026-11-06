-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0082_access_evaluator; source verified ACL authorization projection source
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- ACL-01: one server-side authorization snapshot for route admission and
-- projection. The snapshot reuses the existing grant predicates; it does not
-- replace transaction-time checks in content-intake.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.access_snapshot(
  p_user_id TEXT,
  p_at TIMESTAMPTZ,
  p_actions TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH
  requested_actions(action) AS (
    SELECT requested.action
    FROM unnest(COALESCE(
      p_actions,
      ARRAY['query','content-manage','import','source-confirm',
        'review','publish','candidate-cancel','rollback']::TEXT[]
    )) requested(action)
    WHERE requested.action = ANY(
      ARRAY['query','content-manage','import','source-confirm',
        'review','publish','candidate-cancel','rollback']::TEXT[]
    )
  ),
  person AS MATERIALIZED (
    SELECT p.principal_id,
      p.user_id,
      p.tenant_id,
      p.app_id,
      p.current_facts_version AS facts_version,
      p.revocation_generation,
      f.enabled,
      f.checked_at,
      f.valid_until,
      f.department_ids,
      f.job_id
    FROM content_intake.principals p
    LEFT JOIN content_intake.principal_facts f
      ON f.principal_id = p.principal_id
     AND f.facts_version = p.current_facts_version
    WHERE p.user_id = p_user_id
  ),
  state AS MATERIALIZED (
    SELECT person.*,
      (SELECT version FROM content_intake.policy_versions policy
        WHERE policy.tenant_id = person.tenant_id AND policy.app_id = person.app_id) AS policy_version,
      (SELECT version FROM content_intake.store_set_current store
        WHERE store.tenant_id = person.tenant_id AND store.app_id = person.app_id) AS store_set_version,
      ARRAY(
        SELECT DISTINCT rule.role
        FROM content_intake.role_rules rule
        WHERE rule.tenant_id = person.tenant_id
          AND rule.app_id = person.app_id
          AND rule.department_id = ANY(person.department_ids)
          AND rule.job_id = person.job_id
        ORDER BY rule.role
      ) AS roles
    FROM person
  ),
  actor_state AS MATERIALIZED (
    SELECT state.*,
      CASE WHEN cardinality(roles) = 1 THEN roles[1] ELSE NULL END AS role
    FROM state
  ),
  allowed AS MATERIALIZED (
    SELECT actor_state.principal_id,
      action.action,
      s.tenant_id,
      s.app_id,
      s.brand_id,
      s.shop_id,
      s.domain,
      src.source_id,
      allowed.valid_until
    FROM actor_state
    CROSS JOIN requested_actions action
    CROSS JOIN LATERAL content_intake.authorization_sources(
      actor_state.principal_id,
      action.action,
      p_at
    ) allowed
    JOIN content_intake.sources src ON src.source_id = allowed.source_id
    JOIN content_intake.scopes s ON s.scope_id = src.scope_id
    WHERE actor_state.principal_id IS NOT NULL
  ),
  allocation_sources AS MATERIALIZED (
    SELECT actor_state.principal_id,
      s.tenant_id,
      s.app_id,
      s.brand_id,
      s.shop_id,
      s.domain,
      src.source_id,
      grant_row.version,
      grant_row.expires_at
    FROM actor_state
    JOIN content_intake.grants grant_row
      ON grant_row.recipient_id = actor_state.principal_id
     AND grant_row.kind = 'allocation'
     AND grant_row.action <> 'review'
     AND grant_row.revoked_at IS NULL
     AND grant_row.steward_id IS NOT NULL
     AND grant_row.starts_at <= p_at
     AND p_at < grant_row.expires_at
    JOIN content_intake.sources src
      ON src.scope_id = grant_row.scope_id
     AND (grant_row.source_id IS NULL OR grant_row.source_id = src.source_id)
    JOIN content_intake.scopes s ON s.scope_id = src.scope_id
    WHERE actor_state.principal_id IS NOT NULL
      AND actor_state.role IS NOT NULL
      AND content_intake.role_may_allocate(actor_state.role)
  ),
  account_state AS MATERIALIZED (
    SELECT actor_state.principal_id,
      COALESCE(
        actor_state.role IS NOT NULL
        AND actor_state.enabled
        AND actor_state.checked_at <= p_at
        AND p_at < actor_state.valid_until
        AND content_intake.role_may_allocate(actor_state.role)
        AND content_intake.seat_administration_allowed(p_user_id),
        false
      ) AS allowed,
      (
        SELECT min(grant_row.expires_at)
        FROM content_intake.grants grant_row
        WHERE grant_row.recipient_id = actor_state.principal_id
          AND grant_row.kind = 'allocation'
          AND grant_row.revoked_at IS NULL
          AND grant_row.steward_id IS NOT NULL
          AND grant_row.starts_at <= p_at
          AND p_at < grant_row.expires_at
      ) AS allocation_until
    FROM actor_state
  ),
  evidence AS MATERIALIZED (
    SELECT actor_state.principal_id,
      EXISTS (
        SELECT 1
        FROM content_intake.grants grant_row
        WHERE grant_row.recipient_id = actor_state.principal_id
          AND grant_row.kind = 'business'
          AND grant_row.revoked_at IS NOT NULL
      ) AS revoked_grant,
      EXISTS (
        SELECT 1
        FROM content_intake.grants grant_row
        WHERE grant_row.recipient_id = actor_state.principal_id
          AND grant_row.kind = 'business'
          AND grant_row.revoked_at IS NULL
          AND grant_row.expires_at <= p_at
      ) AS expired_grant,
      EXISTS (
        SELECT 1
        FROM content_intake.grants grant_row
        WHERE grant_row.recipient_id = actor_state.principal_id
          AND grant_row.kind = 'business'
          AND grant_row.action = 'query'
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= p_at
          AND p_at < grant_row.expires_at
          AND (
            grant_row.policy_version IS DISTINCT FROM actor_state.policy_version
            OR grant_row.store_set_version IS DISTINCT FROM actor_state.store_set_version
          )
      ) AS store_set_changed,
      EXISTS (
        SELECT 1
        FROM content_intake.grants grant_row
        WHERE grant_row.recipient_id = actor_state.principal_id
          AND grant_row.kind = 'business'
          AND grant_row.action = 'query'
          AND grant_row.revoked_at IS NULL
          AND grant_row.starts_at <= p_at
          AND p_at < grant_row.expires_at
          AND grant_row.policy_version IS NOT DISTINCT FROM actor_state.policy_version
          AND grant_row.store_set_version IS NOT DISTINCT FROM actor_state.store_set_version
          AND NOT EXISTS (
            SELECT 1
            FROM content_intake.store_set_members member
            WHERE member.tenant_id = actor_state.tenant_id
              AND member.app_id = actor_state.app_id
              AND member.version = grant_row.store_set_version
              AND member.source_id = grant_row.source_id
          )
      ) AS source_outside_set
    FROM actor_state
  ),
  revision_seed AS MATERIALIZED (
    SELECT encode(sha256(convert_to(COALESCE(jsonb_agg(jsonb_build_array(
      grant_row.grant_id,
      grant_row.kind,
      grant_row.action,
      grant_row.version,
      grant_row.scope_id,
      grant_row.source_id,
      grant_row.starts_at,
      grant_row.expires_at,
      grant_row.revoked_at,
      grant_row.steward_id,
      grant_row.parent_grant_id,
      grant_row.policy_version,
      grant_row.store_set_version
    ) ORDER BY grant_row.grant_id), '[]'::jsonb)::TEXT, 'UTF8')), 'hex') AS value
    FROM content_intake.grants grant_row
    JOIN actor_state ON actor_state.principal_id = grant_row.recipient_id
  )
  SELECT jsonb_build_object(
    'present', EXISTS (SELECT 1 FROM actor_state),
    'principalId', (SELECT principal_id FROM actor_state),
    'tenantId', (SELECT tenant_id FROM actor_state),
    'appId', (SELECT app_id FROM actor_state),
    'factsVersion', (SELECT facts_version FROM actor_state),
    'revocationGeneration', COALESCE((SELECT revocation_generation FROM actor_state), 0),
    'policyVersion', (SELECT policy_version FROM actor_state),
    'storeSetVersion', (SELECT store_set_version FROM actor_state),
    'facts', CASE WHEN EXISTS (
      SELECT 1 FROM actor_state WHERE enabled IS NOT NULL
    ) THEN jsonb_build_object(
      'enabled', (SELECT enabled FROM actor_state),
      'checkedAt', (SELECT checked_at FROM actor_state),
      'validUntil', (SELECT valid_until FROM actor_state)
    ) ELSE NULL END,
    'roles', COALESCE((SELECT to_jsonb(roles) FROM actor_state), '[]'::jsonb),
    'roleActions', COALESCE((
      SELECT to_jsonb(ceiling.business_actions)
      FROM actor_state
      JOIN content_intake.role_ceiling ceiling ON ceiling.role = actor_state.role
    ), '[]'::jsonb),
    'mayAllocate', COALESCE((
      SELECT content_intake.role_may_allocate(actor_state.role)
      FROM actor_state
    ), false),
    'accountsManage', jsonb_build_object(
      'allowed', COALESCE((SELECT allowed FROM account_state), false),
      'validUntil', (
        SELECT CASE WHEN account_state.allowed
          THEN least(actor_state.valid_until, account_state.allocation_until)
          ELSE NULL END
        FROM actor_state CROSS JOIN account_state
      )
    ),
    'allowedSources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'scope', jsonb_build_object(
          'kind', 'source',
          'tenantId', allowed.tenant_id,
          'appId', allowed.app_id,
          'brandId', allowed.brand_id,
          'shopId', allowed.shop_id,
          'domain', allowed.domain,
          'sourceId', allowed.source_id
        ),
        'action', allowed.action,
        'validUntil', allowed.valid_until
      ) ORDER BY allowed.source_id, allowed.action)
      FROM allowed
    ), '[]'::jsonb),
    'allocationSources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'scope', jsonb_build_object(
          'kind', 'source',
          'tenantId', allocation.tenant_id,
          'appId', allocation.app_id,
          'brandId', allocation.brand_id,
          'shopId', allocation.shop_id,
          'domain', allocation.domain,
          'sourceId', allocation.source_id
        ),
        'grantVersion', allocation.version,
        'validUntil', allocation.expires_at
      ) ORDER BY allocation.source_id, allocation.version)
      FROM allocation_sources allocation
    ), '[]'::jsonb),
    'evidence', jsonb_build_object(
      'revokedGrant', COALESCE((SELECT revoked_grant FROM evidence), false),
      'expiredGrant', COALESCE((SELECT expired_grant FROM evidence), false),
      'sourceOutsideSet', COALESCE((SELECT source_outside_set FROM evidence), false),
      'storeSetChanged', COALESCE((SELECT store_set_changed FROM evidence), false)
    ),
    'revisionSeed', COALESCE((SELECT value FROM revision_seed), encode(sha256(''::BYTEA), 'hex')),
    'resolvedAt', p_at
  )
$$;

REVOKE ALL ON FUNCTION content_intake.access_snapshot(TEXT, TIMESTAMPTZ, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.access_snapshot(TEXT, TIMESTAMPTZ, TEXT[]) TO intake_business;
