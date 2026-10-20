-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0049_roster_lifecycle; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- The live issuer body in this file is the only body to edit; 0047 and 0048 are applied history.
-- Job changes, missing departments, and departures revoke system query grants.
-- A later eligible login inserts a new grant id. It does not clear revoked_at.
-- The day-one report only reads the current policy and the current store set.
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER TABLE content_intake.grants
  ADD COLUMN roster_job_id content_intake.identifier;

ALTER TABLE content_intake.store_sets
  ADD COLUMN provenance TEXT;

UPDATE content_intake.store_sets
SET provenance = COALESCE(
  (SELECT current_release.current_release_id FROM public.content_current current_release WHERE current_release.id = 1),
  'content-current-lineage')
WHERE provenance IS NULL;

ALTER TABLE content_intake.store_sets
  ALTER COLUMN provenance SET NOT NULL;

CREATE TABLE content_intake.roster_terms (
  principal_id content_intake.identifier PRIMARY KEY REFERENCES content_intake.principals(principal_id),
  term content_intake.version NOT NULL
);

CREATE OR REPLACE FUNCTION content_intake.project_feishu_roster(
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
  v_checked TIMESTAMPTZ;
  v_signer TEXT;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('agent','enabler','lead','supervisor','manager','director','engineer') THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  IF p_department_ids IS NULL OR cardinality(p_department_ids) < 1 OR p_job_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  IF p_actions IS DISTINCT FROM ARRAY['query']::text[] THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id
      AND department_id = ANY(p_department_ids)
      AND job_id = p_job_id AND role = p_role
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM content_intake.principals person
      WHERE person.principal_id = p_principal_id
        AND person.tenant_id = p_tenant_id AND person.app_id = p_app_id
    ) THEN
      RETURN 'policy-pending';
    END IF;
    v_checked := pg_catalog.clock_timestamp();
    v_signer := left('sys_query_' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant_id || ':' || p_app_id, 'UTF8')), 'hex'), 72);
    v_digest := encode(pg_catalog.sha256(pg_catalog.convert_to(p_principal_id || p_job_id || p_role, 'UTF8')), 'hex');
    WITH versioned AS (
      UPDATE content_intake.principals AS person
      SET current_facts_version = person.current_facts_version + 1
      WHERE person.principal_id = p_principal_id
        AND person.tenant_id = p_tenant_id AND person.app_id = p_app_id
      RETURNING person.principal_id, person.current_facts_version
    )
    INSERT INTO content_intake.principal_facts (
      principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
    )
    SELECT versioned.principal_id, versioned.current_facts_version, p_department_ids, p_job_id, true,
      v_checked, v_checked + interval '5 minutes', v_digest
    FROM versioned;
    INSERT INTO content_intake.roster_terms (principal_id, term)
    VALUES (p_principal_id, 2)
    ON CONFLICT (principal_id) DO UPDATE SET term = content_intake.roster_terms.term + 1;
    UPDATE content_intake.grants AS grant_row
    SET version = grant_row.version + 1, last_change_reason = '职位名单变更。', revoked_at = v_checked
    WHERE grant_row.recipient_id = p_principal_id AND grant_row.issuer_id = v_signer
      AND grant_row.kind = 'business' AND grant_row.action = 'query' AND grant_row.revoked_at IS NULL
      AND grant_row.expires_at > v_checked AND grant_row.reason = '职位名单系统签发。';
    RETURN 'policy-pending';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM backend_identity.subject_bindings
    WHERE user_id = p_user_id AND enabled
  ) INTO v_known;
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
  SELECT EXISTS(SELECT 1 FROM written) INTO v_bound;
  IF NOT v_bound THEN
    IF v_known THEN RETURN 'conflict'; END IF;
    RETURN 'missing';
  END IF;
  RETURN 'registered';
END $$;

CREATE OR REPLACE FUNCTION content_intake.issue_roster_query(
  p_principal_id TEXT, p_tenant_id TEXT, p_app_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_signer TEXT;
  v_binding TEXT;
  v_user TEXT;
  v_checked TIMESTAMPTZ;
  v_policy BIGINT;
  v_store BIGINT;
  v_open BOOLEAN;
  v_enabled BOOLEAN;
  v_job TEXT;
  v_departments TEXT[];
  v_term BIGINT;
BEGIN
  v_checked := pg_catalog.clock_timestamp();
  v_signer := left('sys_query_' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant_id || ':' || p_app_id, 'UTF8')), 'hex'), 72);
  v_binding := left('sys-query-binding-' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant_id || ':' || p_app_id, 'UTF8')), 'hex'), 128);
  v_user := left('sys-query-user-' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant_id || ':' || p_app_id, 'UTF8')), 'hex'), 128);
  INSERT INTO backend_identity.subject_bindings(
    binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
  ) VALUES (
    v_binding, 'synthetic', p_tenant_id, left('content-intake-query-signer:' || p_app_id, 256), v_user,
    encode(pg_catalog.sha256(pg_catalog.convert_to(v_user, 'UTF8')), 'hex'), true, 'owner'
  ) ON CONFLICT (binding_id) DO NOTHING;
  INSERT INTO content_intake.principals(
    principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
  ) VALUES (
    v_signer, v_user, p_tenant_id, p_app_id, 'content-intake-system', 'query-signer', 1
  ) ON CONFLICT (principal_id) DO NOTHING;
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  ) VALUES (
    v_signer, 1, ARRAY['system'], 'query-signer', true,
    v_checked, v_checked + interval '5 minutes',
    encode(pg_catalog.sha256(pg_catalog.convert_to(v_signer || ':query-signer', 'UTF8')), 'hex')
  ) ON CONFLICT (principal_id, facts_version) DO NOTHING;
  WITH expired AS (
    UPDATE content_intake.principals AS person
    SET current_facts_version = person.current_facts_version + 1
    WHERE person.principal_id = v_signer
      AND NOT EXISTS (
        SELECT 1 FROM content_intake.principal_facts facts
        WHERE facts.principal_id = person.principal_id
          AND facts.facts_version = person.current_facts_version
          AND facts.enabled AND facts.checked_at <= v_checked AND v_checked < facts.valid_until
      )
    RETURNING person.principal_id, person.current_facts_version
  )
  INSERT INTO content_intake.principal_facts (
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  )
  SELECT principal_id, current_facts_version, ARRAY['system'], 'query-signer', true,
    v_checked, v_checked + interval '5 minutes',
    encode(pg_catalog.sha256(pg_catalog.convert_to(v_signer || ':query-signer', 'UTF8')), 'hex')
  FROM expired;
  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id;
  IF v_policy IS NULL THEN RETURN 'registered'; END IF;
  SELECT facts.enabled, facts.job_id, facts.department_ids
  INTO v_enabled, v_job, v_departments
  FROM content_intake.principals person
  JOIN content_intake.principal_facts facts
    ON facts.principal_id = person.principal_id AND facts.facts_version = person.current_facts_version
  WHERE person.principal_id = p_principal_id
    AND person.tenant_id = p_tenant_id AND person.app_id = p_app_id;
  IF NOT FOUND OR v_enabled IS DISTINCT FROM TRUE OR NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules rule
    WHERE rule.tenant_id = p_tenant_id AND rule.app_id = p_app_id
      AND rule.department_id = ANY(v_departments) AND rule.job_id = v_job
  ) THEN
    UPDATE content_intake.grants AS grant_row
    SET version = grant_row.version + 1, last_change_reason = '职位名单变更。', revoked_at = v_checked
    WHERE grant_row.recipient_id = p_principal_id AND grant_row.issuer_id = v_signer
      AND grant_row.kind = 'business' AND grant_row.action = 'query' AND grant_row.revoked_at IS NULL
      AND grant_row.expires_at > v_checked AND grant_row.reason = '职位名单系统签发。';
    IF EXISTS (
      SELECT 1 FROM content_intake.grants ended
      WHERE ended.recipient_id = p_principal_id AND ended.issuer_id = v_signer
        AND ended.kind = 'business' AND ended.action = 'query' AND ended.reason = '职位名单系统签发。'
        AND ended.revoked_at IS NOT NULL
    ) THEN RETURN 'revoked'; END IF;
    RETURN 'registered';
  END IF;
  SELECT COALESCE((SELECT term FROM content_intake.roster_terms WHERE principal_id = p_principal_id), 1)
  INTO v_term;
  WITH desired AS (
    SELECT scope.scope_id, src.source_id, min(lineage.content_valid_until) AS content_valid_until
    FROM content_intake.sources src
    JOIN content_intake.scopes scope ON scope.scope_id = src.scope_id
    JOIN public.content_current current_release ON current_release.id = 1
    JOIN content_intake.release_lineage lineage
      ON lineage.release_id = current_release.current_release_id AND lineage.source_id = src.source_id
     AND lineage.content_valid_until > v_checked
    WHERE scope.tenant_id = p_tenant_id AND scope.app_id = p_app_id AND src.mode = 'v2-preview'
    GROUP BY scope.scope_id, src.source_id
  ), current_version AS (
    SELECT version FROM content_intake.store_set_current
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id
  ), next_version AS (
    SELECT coalesce((SELECT version FROM current_version), 0) + 1 AS version
    WHERE NOT EXISTS (SELECT 1 FROM current_version)
      OR EXISTS (
        SELECT scope_id, source_id, content_valid_until FROM desired
        EXCEPT
        SELECT member.scope_id, member.source_id, member.content_valid_until
        FROM content_intake.store_set_members member
        JOIN current_version ON member.version = current_version.version
        WHERE member.tenant_id = p_tenant_id AND member.app_id = p_app_id
      )
      OR EXISTS (
        SELECT member.scope_id, member.source_id, member.content_valid_until
        FROM content_intake.store_set_members member
        JOIN current_version ON member.version = current_version.version
        WHERE member.tenant_id = p_tenant_id AND member.app_id = p_app_id
        EXCEPT
        SELECT scope_id, source_id, content_valid_until FROM desired
      )
  ), written_set AS (
    INSERT INTO content_intake.store_sets (tenant_id, app_id, version, approved_at, provenance)
    SELECT p_tenant_id, p_app_id, version, v_checked, COALESCE(
      (SELECT current_release.current_release_id FROM public.content_current current_release WHERE current_release.id = 1),
      'content-current-lineage')
    FROM next_version
    RETURNING version
  ), written_members AS (
    INSERT INTO content_intake.store_set_members (
      tenant_id, app_id, version, scope_id, source_id, content_valid_until
    )
    SELECT p_tenant_id, p_app_id, written_set.version, desired.scope_id, desired.source_id, desired.content_valid_until
    FROM written_set CROSS JOIN desired
    RETURNING version
  )
  INSERT INTO content_intake.store_set_current (tenant_id, app_id, version)
  SELECT p_tenant_id, p_app_id, version FROM written_set
  WHERE (SELECT count(*) FROM written_members) >= 0
  ON CONFLICT (tenant_id, app_id) DO UPDATE SET version = EXCLUDED.version;
  SELECT version INTO v_store FROM content_intake.store_set_current
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id;
  WITH current_source AS (
    SELECT scope_id, source_id, content_valid_until
    FROM content_intake.store_set_members
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id AND version = v_store
  ), revoked AS (
    UPDATE content_intake.grants AS grant_row
    SET version = grant_row.version + 1, last_change_reason = '职位名单变更。', revoked_at = v_checked
    WHERE grant_row.recipient_id = p_principal_id AND grant_row.issuer_id = v_signer
      AND grant_row.kind = 'business' AND grant_row.action = 'query' AND grant_row.revoked_at IS NULL
      AND grant_row.expires_at > v_checked
      AND grant_row.reason = '职位名单系统签发。'
      AND (
        grant_row.roster_job_id IS DISTINCT FROM v_job
        OR grant_row.policy_version IS DISTINCT FROM v_policy
        OR grant_row.store_set_version IS DISTINCT FROM v_store
        OR NOT EXISTS (
          SELECT 1 FROM current_source
          WHERE current_source.source_id = grant_row.source_id AND current_source.scope_id = grant_row.scope_id
        )
      )
    RETURNING grant_row.grant_id
  ), inserted AS (
    INSERT INTO content_intake.grants(
      grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
      starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version, roster_job_id)
    SELECT left('grant_' || encode(pg_catalog.sha256(pg_catalog.convert_to(
        p_principal_id || ':' || current_source.scope_id || ':' || current_source.source_id || ':query:'
        || v_policy::text || ':' || v_store::text || ':' || v_job || ':' || v_term::text, 'UTF8')), 'hex'), 40),
      'business', v_signer, p_principal_id, p_tenant_id, p_app_id,
      current_source.scope_id, current_source.source_id, 'query',
      v_checked, LEAST(v_checked + interval '1 day', current_source.content_valid_until),
      '职位名单系统签发。', NULL, NULL, v_policy, v_store, v_job
    FROM current_source
    WHERE NOT EXISTS (
      SELECT 1 FROM content_intake.grants existing
      WHERE existing.recipient_id = p_principal_id AND existing.issuer_id = v_signer
        AND existing.scope_id = current_source.scope_id AND existing.source_id = current_source.source_id
        AND existing.action = 'query' AND existing.kind = 'business'
        AND existing.reason = '职位名单系统签发。'
        AND existing.policy_version = v_policy AND existing.store_set_version = v_store
        AND existing.roster_job_id = v_job
        AND existing.revoked_at IS NULL AND existing.expires_at > v_checked
        AND existing.grant_id NOT IN (SELECT revoked.grant_id FROM revoked)
    )
    ON CONFLICT (grant_id) DO NOTHING
    RETURNING grant_id
  )
  SELECT EXISTS (
    SELECT 1 FROM inserted
    UNION ALL
    SELECT 1 FROM content_intake.grants live_grant
    JOIN current_source
      ON current_source.source_id = live_grant.source_id AND current_source.scope_id = live_grant.scope_id
    WHERE live_grant.recipient_id = p_principal_id AND live_grant.issuer_id = v_signer
      AND live_grant.kind = 'business' AND live_grant.action = 'query'
      AND live_grant.reason = '职位名单系统签发。'
      AND live_grant.policy_version = v_policy AND live_grant.store_set_version = v_store
      AND live_grant.roster_job_id = v_job
      AND live_grant.revoked_at IS NULL AND live_grant.expires_at > v_checked
      AND live_grant.grant_id NOT IN (SELECT revoked.grant_id FROM revoked)
  ) INTO v_open;
  IF v_open THEN RETURN 'projected'; END IF;
  IF EXISTS (
    SELECT 1 FROM content_intake.grants ended
    WHERE ended.recipient_id = p_principal_id AND ended.issuer_id = v_signer
      AND ended.kind = 'business' AND ended.action = 'query' AND ended.reason = '职位名单系统签发。'
      AND ended.revoked_at IS NOT NULL
  ) THEN RETURN 'revoked'; END IF;
  IF EXISTS (
    SELECT 1 FROM content_intake.grants ended
    WHERE ended.recipient_id = p_principal_id AND ended.issuer_id = v_signer
      AND ended.kind = 'business' AND ended.action = 'query' AND ended.reason = '职位名单系统签发。'
      AND ended.revoked_at IS NULL AND ended.expires_at <= v_checked
  ) THEN RETURN 'expired'; END IF;
  RETURN 'registered';
END $$;

CREATE FUNCTION content_intake.withdraw_roster_query(
  p_principal_id TEXT, p_tenant_id TEXT, p_app_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_checked TIMESTAMPTZ;
  v_signer TEXT;
  v_version BIGINT;
  v_departments TEXT[];
  v_job TEXT;
  v_digest TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.principals person
    WHERE person.principal_id = p_principal_id
      AND person.tenant_id = p_tenant_id AND person.app_id = p_app_id
  ) THEN
    RETURN 'absent';
  END IF;
  v_checked := pg_catalog.clock_timestamp();
  v_signer := left('sys_query_' || encode(pg_catalog.sha256(pg_catalog.convert_to(p_tenant_id || ':' || p_app_id, 'UTF8')), 'hex'), 72);
  SELECT facts.department_ids, facts.job_id
  INTO v_departments, v_job
  FROM content_intake.principals person
  JOIN content_intake.principal_facts facts
    ON facts.principal_id = person.principal_id AND facts.facts_version = person.current_facts_version
  WHERE person.principal_id = p_principal_id;
  v_digest := encode(pg_catalog.sha256(pg_catalog.convert_to(p_principal_id || COALESCE(v_job, '') || ':left', 'UTF8')), 'hex');
  UPDATE content_intake.principals AS person
  SET current_facts_version = person.current_facts_version + 1
  WHERE person.principal_id = p_principal_id
  RETURNING person.current_facts_version INTO v_version;
  INSERT INTO content_intake.principal_facts (
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  ) VALUES (
    p_principal_id, v_version, COALESCE(v_departments, ARRAY['left']), COALESCE(v_job, 'left'), false,
    v_checked, v_checked + interval '5 minutes', v_digest
  );
  INSERT INTO content_intake.roster_terms (principal_id, term)
  VALUES (p_principal_id, 2)
  ON CONFLICT (principal_id) DO UPDATE SET term = content_intake.roster_terms.term + 1;
  UPDATE content_intake.grants AS grant_row
  SET version = grant_row.version + 1, last_change_reason = '职位名单变更。', revoked_at = v_checked
  WHERE grant_row.recipient_id = p_principal_id AND grant_row.issuer_id = v_signer
    AND grant_row.kind = 'business' AND grant_row.action = 'query' AND grant_row.revoked_at IS NULL
    AND grant_row.expires_at > v_checked AND grant_row.reason = '职位名单系统签发。';
  RETURN 'revoked';
END $$;

CREATE FUNCTION content_intake.roster_day_one(p_tenant_id TEXT, p_app_id TEXT)
RETURNS TABLE (
  policy_version BIGINT,
  store_set_version BIGINT,
  provenance TEXT,
  grant_id TEXT,
  source_id TEXT,
  roster_job_id TEXT
)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
  SELECT pol.version, cur.version, sets.provenance, live_grant.grant_id, live_grant.source_id, live_grant.roster_job_id
  FROM content_intake.policy_versions pol
  JOIN content_intake.store_set_current cur
    ON cur.tenant_id = pol.tenant_id AND cur.app_id = pol.app_id
  JOIN content_intake.store_sets sets
    ON sets.tenant_id = cur.tenant_id AND sets.app_id = cur.app_id AND sets.version = cur.version
  LEFT JOIN content_intake.grants live_grant
    ON live_grant.tenant_id = pol.tenant_id AND live_grant.app_id = pol.app_id
    AND live_grant.kind = 'business' AND live_grant.action = 'query'
    AND live_grant.reason = '职位名单系统签发。'
    AND live_grant.revoked_at IS NULL AND live_grant.expires_at > pg_catalog.clock_timestamp()
    AND live_grant.policy_version = pol.version AND live_grant.store_set_version = cur.version
  WHERE pol.tenant_id = p_tenant_id AND pol.app_id = p_app_id
$$;

CREATE FUNCTION content_intake.roster_permission_for_user(p_user_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_at TIMESTAMPTZ;
  v_principal TEXT;
  v_tenant TEXT;
  v_app TEXT;
  v_enabled BOOLEAN;
  v_checked TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
BEGIN
  v_at := pg_catalog.clock_timestamp();
  SELECT person.principal_id, person.tenant_id, person.app_id,
    facts.enabled, facts.checked_at, facts.valid_until
  INTO v_principal, v_tenant, v_app, v_enabled, v_checked, v_until
  FROM content_intake.principals person
  JOIN content_intake.principal_facts facts
    ON facts.principal_id = person.principal_id AND facts.facts_version = person.current_facts_version
  WHERE person.user_id = p_user_id AND person.identity_scope = 'feishu-job-roster';
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_enabled IS NOT TRUE THEN RETURN 'revoked'; END IF;
  IF (v_checked <= v_at AND v_at < v_until) IS NOT TRUE THEN RETURN 'expired'; END IF;
  IF EXISTS (
    SELECT 1
    FROM content_intake.store_set_current current_set
    JOIN content_intake.store_set_members member
      ON member.tenant_id = current_set.tenant_id AND member.app_id = current_set.app_id
     AND member.version = current_set.version
    WHERE current_set.tenant_id = v_tenant AND current_set.app_id = v_app
      AND content_intake.authorization_deadline(v_principal, 'query', member.scope_id, member.source_id, v_at) IS NOT NULL
  ) THEN RETURN 'ready'; END IF;
  IF EXISTS (
    SELECT 1 FROM content_intake.grants grant_row
    JOIN content_intake.principals signer ON signer.principal_id = grant_row.issuer_id
    WHERE grant_row.recipient_id = v_principal
      AND signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'
      AND grant_row.kind = 'business' AND grant_row.action = 'query'
      AND grant_row.reason = '职位名单系统签发。' AND grant_row.revoked_at IS NOT NULL
  ) THEN RETURN 'revoked'; END IF;
  IF EXISTS (
    SELECT 1 FROM content_intake.grants grant_row
    JOIN content_intake.principals signer ON signer.principal_id = grant_row.issuer_id
    WHERE grant_row.recipient_id = v_principal
      AND signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'
      AND grant_row.kind = 'business' AND grant_row.action = 'query'
      AND grant_row.reason = '职位名单系统签发。'
      AND grant_row.revoked_at IS NULL AND grant_row.expires_at <= v_at
  ) THEN RETURN 'expired'; END IF;
  RETURN 'pending';
END $$;

REVOKE ALL ON FUNCTION content_intake.withdraw_roster_query(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.withdraw_roster_query(TEXT, TEXT, TEXT) TO intake_business;
REVOKE ALL ON FUNCTION content_intake.roster_day_one(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.roster_day_one(TEXT, TEXT) TO intake_business;
REVOKE ALL ON FUNCTION content_intake.roster_permission_for_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.roster_permission_for_user(TEXT) TO intake_business;
