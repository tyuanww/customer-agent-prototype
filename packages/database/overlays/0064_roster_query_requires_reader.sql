-- 0064_roster_query_requires_reader; product overlay (not a frozen contract snapshot slice)

SET LOCAL search_path = public, pg_catalog, pg_temp;

-- issue_roster_query promoted a new store-set version whenever its desired set differed from
-- the current members, and an empty desired set counts as a difference. The result was a
-- version with no members: the pointer update that 0062 blocks, plus a row that the next call
-- then tries to insert again and fails on. Empty is the normal state before the first
-- publication, so the guard belongs here, where the decision to advance is made.
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
  ) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (
    SELECT 1 FROM backend_identity.subject_bindings existing
    WHERE existing.binding_id = v_binding AND existing.user_id = v_user AND existing.enabled
      AND existing.provider = 'synthetic' AND existing.tenant = p_tenant_id
      AND existing.subject = left('content-intake-query-signer:' || p_app_id, 256)
  ) THEN
    RETURN 'registered';
  END IF;
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
    HAVING count(DISTINCT rule.role) = 1
      AND (min(rule.role) IN ('director','manager','supervisor','lead','engineer')
        OR min(rule.role) IN ('agent','enabler'))
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
    -- No readable source means there is nothing to promote. Advancing anyway would insert a
    -- version with no members, which every grant stamped on the previous version stops
    -- matching, and the next call would collide on that unused version's primary key.
    -- The parentheses are load-bearing: AND binds tighter than OR, so an unparenthesised guard
    -- would leave the two difference branches able to promote an empty set on their own.
    SELECT coalesce((SELECT version FROM current_version), 0) + 1 AS version
    WHERE EXISTS (SELECT 1 FROM desired)
      AND (
        NOT EXISTS (SELECT 1 FROM current_version)
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
