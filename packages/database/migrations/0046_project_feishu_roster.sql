-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0046_project_feishu_roster; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- One roster login writes the principal, the role rule, and the business grants together.
-- intake_business may call it. The body runs as the migration owner.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.project_feishu_roster(
  p_principal_id TEXT,
  p_user_id TEXT,
  p_tenant_id TEXT,
  p_app_id TEXT,
  p_identity_scope TEXT,
  p_person_key TEXT,
  p_department_ids TEXT[],
  p_job_id TEXT,
  p_role TEXT,
  p_actions TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_known BOOLEAN;
  v_bound BOOLEAN;
  v_digest TEXT;
  v_actions TEXT[];
  v_issuer TEXT;
  v_stewards INTEGER;
  v_inserted INTEGER;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('agent','enabler','lead','supervisor','manager','director','engineer') THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  IF p_actions IS NULL OR EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_actions) AS action(name)
    WHERE action.name NOT IN ('query','publish','import')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  v_digest := encode(pg_catalog.sha256(pg_catalog.convert_to(p_principal_id || p_job_id || p_role, 'UTF8')), 'hex');
  WITH known AS (
    SELECT user_id FROM backend_identity.subject_bindings
    WHERE user_id = p_user_id AND enabled
    LIMIT 1
  ), stamp AS (
    SELECT pg_catalog.clock_timestamp() AS checked_at
  ), versioned AS (
    INSERT INTO content_intake.principals AS person (
      principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
    )
    SELECT p_principal_id, known.user_id, p_tenant_id, p_app_id, p_identity_scope, p_person_key, 1
    FROM known
    ON CONFLICT (principal_id) DO UPDATE
    SET current_facts_version = person.current_facts_version + 1
    WHERE person.user_id = EXCLUDED.user_id
      AND person.tenant_id = EXCLUDED.tenant_id AND person.app_id = EXCLUDED.app_id
      AND person.identity_scope = EXCLUDED.identity_scope AND person.person_key = EXCLUDED.person_key
    RETURNING principal_id, current_facts_version
  ), written AS (
    INSERT INTO content_intake.principal_facts (
      principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
    )
    SELECT versioned.principal_id, versioned.current_facts_version, p_department_ids, p_job_id, true,
      stamp.checked_at, stamp.checked_at + interval '5 minutes', v_digest
    FROM versioned CROSS JOIN stamp
    RETURNING principal_id
  )
  SELECT EXISTS(SELECT 1 FROM known), EXISTS(SELECT 1 FROM written)
  INTO v_known, v_bound;
  IF NOT v_bound THEN
    IF v_known THEN RETURN 'conflict'; END IF;
    RETURN 'missing';
  END IF;
  INSERT INTO content_intake.role_rules (tenant_id, app_id, department_id, job_id, policy_version, role)
  SELECT p_tenant_id, p_app_id, department_id, p_job_id, 1, p_role
  FROM pg_catalog.unnest(p_department_ids) AS department(department_id)
  ON CONFLICT (tenant_id, app_id, department_id, job_id) DO NOTHING;
  SELECT COALESCE(array_agg(action.name), ARRAY[]::text[]) INTO v_actions
  FROM (
    SELECT action.name
    FROM pg_catalog.unnest(p_actions) AS action(name)
    WHERE action.name IN ('query','publish','import')
      AND (p_role NOT IN ('agent','enabler') OR action.name = 'query')
  ) action;
  UPDATE content_intake.grants
  SET version = version + 1,
      last_change_reason = '职位名单变更。',
      revoked_at = pg_catalog.clock_timestamp()
  WHERE recipient_id = p_principal_id AND kind = 'business' AND revoked_at IS NULL
    AND reason = '职位名单投影。' AND NOT (action = ANY(v_actions));
  IF cardinality(v_actions) = 0 THEN RETURN 'projected'; END IF;
  SELECT count(*)::int INTO v_stewards FROM (
    SELECT g.recipient_id
    FROM content_intake.grants g
    WHERE g.tenant_id = p_tenant_id AND g.app_id = p_app_id
      AND g.kind IN ('allocation','delegation') AND g.revoked_at IS NULL
      AND g.starts_at <= pg_catalog.clock_timestamp() AND g.expires_at > pg_catalog.clock_timestamp()
      AND g.action = ANY(v_actions) AND g.recipient_id <> p_principal_id
      AND g.steward_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM content_intake.principals issuer
        JOIN content_intake.principal_facts facts
          ON facts.principal_id = issuer.principal_id AND facts.facts_version = issuer.current_facts_version
        WHERE issuer.principal_id = g.recipient_id AND facts.enabled
          AND facts.checked_at <= pg_catalog.clock_timestamp()
          AND pg_catalog.clock_timestamp() < facts.valid_until
      )
    GROUP BY g.recipient_id
    HAVING count(DISTINCT g.action) = cardinality(v_actions)
  ) stewards;
  IF v_stewards <> 1 THEN RETURN 'registered'; END IF;
  SELECT g.recipient_id INTO v_issuer
  FROM content_intake.grants g
  WHERE g.tenant_id = p_tenant_id AND g.app_id = p_app_id
    AND g.kind IN ('allocation','delegation') AND g.revoked_at IS NULL
    AND g.starts_at <= pg_catalog.clock_timestamp() AND g.expires_at > pg_catalog.clock_timestamp()
    AND g.action = ANY(v_actions) AND g.recipient_id <> p_principal_id
    AND g.steward_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM content_intake.principals issuer
      JOIN content_intake.principal_facts facts
        ON facts.principal_id = issuer.principal_id AND facts.facts_version = issuer.current_facts_version
      WHERE issuer.principal_id = g.recipient_id AND facts.enabled
        AND facts.checked_at <= pg_catalog.clock_timestamp()
        AND pg_catalog.clock_timestamp() < facts.valid_until
    )
  GROUP BY g.recipient_id
  HAVING count(DISTINCT g.action) = cardinality(v_actions);
  INSERT INTO content_intake.grants(
    grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
    starts_at, expires_at, reason, steward_id, parent_grant_id)
  SELECT left('grant_' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_principal_id || g.scope_id || g.action, 'UTF8')), 'hex'), 40),
    'business', v_issuer, p_principal_id, g.tenant_id, g.app_id, g.scope_id, g.source_id, g.action,
    pg_catalog.clock_timestamp(), g.expires_at, '职位名单投影。', COALESCE(g.steward_id, v_issuer), g.grant_id
  FROM content_intake.grants g
  WHERE g.recipient_id = v_issuer AND g.tenant_id = p_tenant_id AND g.app_id = p_app_id
    AND g.kind IN ('allocation','delegation') AND g.action = ANY(v_actions)
    AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.clock_timestamp()
    AND g.starts_at <= pg_catalog.clock_timestamp() AND g.steward_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM content_intake.sources s
      JOIN content_intake.scopes scope ON scope.scope_id = s.scope_id
      WHERE s.scope_id = g.scope_id AND scope.tenant_id = g.tenant_id AND scope.app_id = g.app_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM content_intake.grants existing
      WHERE existing.recipient_id = p_principal_id AND existing.scope_id = g.scope_id AND existing.action = g.action
        AND existing.revoked_at IS NULL AND existing.expires_at > pg_catalog.clock_timestamp()
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted > 0 THEN
    UPDATE content_intake.principals
    SET revocation_generation = revocation_generation + 1
    WHERE principal_id = p_principal_id;
  END IF;
  RETURN 'projected';
END $$;

REVOKE ALL ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]
) TO intake_business;
