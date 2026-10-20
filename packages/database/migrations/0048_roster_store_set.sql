-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0048_roster_store_set; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A contentful shop is a v2-preview source on the current release lineage.
-- Query grants carry the policy version and the store-set version from that moment.
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER TABLE content_intake.grants
  ADD COLUMN policy_version content_intake.version,
  ADD COLUMN store_set_version content_intake.version;

CREATE TABLE content_intake.store_sets (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, app_id, version)
);

CREATE TABLE content_intake.store_set_members (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  scope_id content_intake.identifier NOT NULL,
  source_id content_intake.identifier NOT NULL,
  content_valid_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (tenant_id, app_id, version, scope_id, source_id),
  FOREIGN KEY (tenant_id, app_id, version) REFERENCES content_intake.store_sets(tenant_id, app_id, version),
  FOREIGN KEY (source_id, scope_id) REFERENCES content_intake.sources(source_id, scope_id)
);

CREATE TABLE content_intake.store_set_current (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  PRIMARY KEY (tenant_id, app_id),
  FOREIGN KEY (tenant_id, app_id, version) REFERENCES content_intake.store_sets(tenant_id, app_id, version)
);

GRANT SELECT ON content_intake.store_sets, content_intake.store_set_members, content_intake.store_set_current
  TO intake_business;

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
  SELECT least(f.valid_until, max(g.expires_at))
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
  JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
  JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
    AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
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
    INSERT INTO content_intake.store_sets (tenant_id, app_id, version, approved_at)
    SELECT p_tenant_id, p_app_id, version, v_checked FROM next_version
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
        grant_row.policy_version IS DISTINCT FROM v_policy
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
      starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version)
    SELECT left('grant_' || encode(pg_catalog.sha256(pg_catalog.convert_to(
        p_principal_id || ':' || current_source.scope_id || ':' || current_source.source_id || ':query:'
        || v_policy::text || ':' || v_store::text, 'UTF8')), 'hex'), 40),
      'business', v_signer, p_principal_id, p_tenant_id, p_app_id,
      current_source.scope_id, current_source.source_id, 'query',
      v_checked, LEAST(v_checked + interval '1 day', current_source.content_valid_until),
      '职位名单系统签发。', NULL, NULL, v_policy, v_store
    FROM current_source
    WHERE NOT EXISTS (
      SELECT 1 FROM content_intake.grants existing
      WHERE existing.recipient_id = p_principal_id AND existing.issuer_id = v_signer
        AND existing.scope_id = current_source.scope_id AND existing.source_id = current_source.source_id
        AND existing.action = 'query' AND existing.kind = 'business'
        AND existing.reason = '职位名单系统签发。'
        AND existing.policy_version = v_policy AND existing.store_set_version = v_store
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
