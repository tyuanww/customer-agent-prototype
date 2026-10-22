-- One row per role owns every capability boundary the intake decides on.
-- Before this migration the same ceiling was written out in each decision function, in the
-- grant guards and again in TypeScript, so a role change had to be made in four places and a
-- missed one was invisible until a property test happened to disagree.
-- The bands are exact: business_actions is the set of actions a business grant may carry,
-- and the three flags own the remaining boundaries. Everything else asks this table.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE TABLE content_intake.role_ceiling (
  role content_intake.identifier PRIMARY KEY,
  business_actions TEXT[] NOT NULL CHECK (cardinality(business_actions) BETWEEN 1 AND 8),
  may_allocate BOOLEAN NOT NULL,
  may_delegate BOOLEAN NOT NULL,
  may_skip_import_parent BOOLEAN NOT NULL,
  CHECK (NOT may_delegate OR may_allocate)
);

INSERT INTO content_intake.role_ceiling(role, business_actions, may_allocate, may_delegate, may_skip_import_parent) VALUES
  ('director', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true,  true,  true),
  ('manager',  ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true,  true,  true),
  ('engineer', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], true,  true,  true),
  ('supervisor', ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], false, false, false),
  ('lead',       ARRAY['query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback'], false, false, false),
  ('agent',    ARRAY['query'], false, false, false),
  ('enabler',  ARRAY['query'], false, false, false);

-- A null role is "no current role", which never authorizes.
CREATE FUNCTION content_intake.role_allows(p_role TEXT, p_action TEXT) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT p_action = ANY(c.business_actions)
    FROM content_intake.role_ceiling c WHERE c.role = p_role), false)
$$;

CREATE FUNCTION content_intake.role_may_allocate(p_role TEXT) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT c.may_allocate FROM content_intake.role_ceiling c WHERE c.role = p_role), false)
$$;

CREATE FUNCTION content_intake.role_may_delegate(p_role TEXT) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT c.may_delegate FROM content_intake.role_ceiling c WHERE c.role = p_role), false)
$$;

CREATE FUNCTION content_intake.role_may_skip_import_parent(p_role TEXT) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT coalesce((SELECT c.may_skip_import_parent FROM content_intake.role_ceiling c WHERE c.role = p_role), false)
$$;

-- The predicates are reached from SECURITY DEFINER functions, from the grant guard, and from
-- the usage pool, so every role that may execute the decision functions needs the same read.
-- This is the set 0055 already relies on, plus the two definer owners that call it from their
-- own SECURITY DEFINER bodies. Without it the call fails closed with a permission error
-- instead of a decision.
GRANT SELECT ON content_intake.role_ceiling
  TO cs_ai_definer, intake_business, intake_usage, intake_runtime_fn_owner, intake_directory_fn_owner;
-- `CREATE FUNCTION` grants EXECUTE to PUBLIC. The runtime identity must reach these only
-- through the roles named above, or the boundary probe refuses the whole schema.
REVOKE ALL ON FUNCTION
  content_intake.role_allows(TEXT, TEXT),
  content_intake.role_may_allocate(TEXT),
  content_intake.role_may_delegate(TEXT),
  content_intake.role_may_skip_import_parent(TEXT)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  content_intake.role_allows(TEXT, TEXT),
  content_intake.role_may_allocate(TEXT),
  content_intake.role_may_delegate(TEXT),
  content_intake.role_may_skip_import_parent(TEXT)
  TO cs_ai_definer, intake_business, intake_usage, intake_runtime_fn_owner, intake_directory_fn_owner;

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
    AND content_intake.role_allows(min(r.role), p_action)
$$;

CREATE OR REPLACE FUNCTION content_intake.grant_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent content_intake.grants;
DECLARE allowed boolean;
BEGIN
  IF NEW.parent_grant_id IS NULL THEN
    IF NEW.kind = 'allocation' THEN RETURN NEW; END IF;
    IF NEW.kind = 'business' AND NEW.action = 'query' AND EXISTS (
      SELECT 1 FROM content_intake.principals signer
      WHERE signer.principal_id = NEW.issuer_id
        AND signer.tenant_id = NEW.tenant_id AND signer.app_id = NEW.app_id
        AND signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'
    ) THEN
      RETURN NEW;
    END IF;
    IF NEW.kind = 'business' AND NEW.action = 'import' THEN
      SELECT count(DISTINCT r.role) = 1 AND content_intake.role_may_skip_import_parent(min(r.role)) INTO allowed
      FROM content_intake.principals p
      JOIN content_intake.principal_facts f
        ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
      JOIN content_intake.role_rules r
        ON r.tenant_id = p.tenant_id AND r.app_id = p.app_id
       AND r.department_id = ANY(f.department_ids) AND r.job_id = f.job_id
      WHERE p.principal_id = NEW.issuer_id AND f.enabled;
      IF allowed THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  SELECT * INTO STRICT parent FROM content_intake.grants WHERE grant_id=NEW.parent_grant_id;
  IF parent.recipient_id<>NEW.issuer_id OR parent.tenant_id<>NEW.tenant_id OR parent.app_id<>NEW.app_id OR parent.scope_id<>NEW.scope_id
    OR parent.action<>NEW.action OR (parent.source_id IS NOT NULL AND parent.source_id IS DISTINCT FROM NEW.source_id)
    OR parent.starts_at>NEW.starts_at OR parent.expires_at<NEW.expires_at OR parent.revoked_at IS NOT NULL
    OR NOT ((NEW.kind='business' AND parent.kind IN ('allocation','delegation')) OR (NEW.kind='delegation' AND parent.kind='allocation')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
