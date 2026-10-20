-- Query grants are issued by one system principal, never by copying a human allocation.
-- A role rule without a business grant does not allow the action.
SET LOCAL search_path = public, pg_catalog, pg_temp;

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
      SELECT count(DISTINCT r.role) = 1 AND min(r.role) IN ('director','manager','engineer') INTO allowed
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

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
  SELECT least(f.valid_until, max(g.expires_at))
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
  JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
  JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
    AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
    AND (g.source_id IS NULL OR g.source_id=p_source) AND g.starts_at<=p_at AND p_at<g.expires_at
  JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
    AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
  WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
    AND EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.source_id=p_source AND src.scope_id=s.scope_id)
  GROUP BY f.valid_until
  HAVING count(DISTINCT r.role)=1
    AND (min(r.role) IN ('director','manager','supervisor','lead','engineer')
      OR (min(r.role) IN ('agent','enabler') AND p_action='query'))
$$;

CREATE FUNCTION content_intake.issue_roster_query(
  p_principal_id TEXT, p_tenant_id TEXT, p_app_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_signer TEXT;
  v_binding TEXT;
  v_user TEXT;
BEGIN
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
    pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '5 minutes',
    encode(pg_catalog.sha256(pg_catalog.convert_to(v_signer || ':query-signer', 'UTF8')), 'hex')
  ) ON CONFLICT (principal_id, facts_version) DO NOTHING;
  UPDATE content_intake.grants
  SET version = version + 1, last_change_reason = '职位名单变更。', revoked_at = pg_catalog.clock_timestamp()
  WHERE recipient_id = p_principal_id AND kind = 'business' AND action = 'query' AND revoked_at IS NULL
    AND reason = '职位名单系统签发。'
    AND NOT EXISTS (
      SELECT 1
      FROM content_intake.sources src
      JOIN content_intake.scopes scope ON scope.scope_id = src.scope_id
      JOIN public.content_current current_release ON current_release.id = 1
      JOIN content_intake.release_lineage lineage
        ON lineage.release_id = current_release.current_release_id AND lineage.source_id = src.source_id
       AND lineage.content_valid_until > pg_catalog.clock_timestamp()
      WHERE src.source_id = content_intake.grants.source_id AND scope.scope_id = content_intake.grants.scope_id
        AND scope.tenant_id = p_tenant_id AND scope.app_id = p_app_id AND src.mode = 'v2-preview'
    );
  INSERT INTO content_intake.grants(
    grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
    starts_at, expires_at, reason, steward_id, parent_grant_id)
  SELECT left('grant_' || encode(pg_catalog.sha256(pg_catalog.convert_to(
      p_principal_id || ':' || scope.scope_id || ':' || src.source_id || ':query', 'UTF8')), 'hex'), 40),
    'business', v_signer, p_principal_id, scope.tenant_id, scope.app_id, scope.scope_id, src.source_id, 'query',
    pg_catalog.clock_timestamp(), LEAST(pg_catalog.clock_timestamp() + interval '1 day', lineage.content_valid_until),
    '职位名单系统签发。', NULL, NULL
  FROM content_intake.sources src
  JOIN content_intake.scopes scope ON scope.scope_id = src.scope_id
  JOIN public.content_current current_release ON current_release.id = 1
  JOIN content_intake.release_lineage lineage
    ON lineage.release_id = current_release.current_release_id AND lineage.source_id = src.source_id
   AND lineage.content_valid_until > pg_catalog.clock_timestamp()
  WHERE scope.tenant_id = p_tenant_id AND scope.app_id = p_app_id AND src.mode = 'v2-preview'
    AND NOT EXISTS (
      SELECT 1 FROM content_intake.grants existing
      WHERE existing.recipient_id = p_principal_id AND existing.scope_id = scope.scope_id
        AND existing.source_id = src.source_id AND existing.action = 'query' AND existing.kind = 'business'
        AND existing.revoked_at IS NULL AND existing.expires_at > pg_catalog.clock_timestamp()
    );
  IF EXISTS (
    SELECT 1 FROM content_intake.grants g
    WHERE g.recipient_id = p_principal_id AND g.action = 'query' AND g.kind = 'business'
      AND g.revoked_at IS NULL AND g.expires_at > pg_catalog.clock_timestamp()
  ) THEN
    RETURN 'projected';
  END IF;
  RETURN 'registered';
END $$;

REVOKE ALL ON FUNCTION content_intake.issue_roster_query(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.issue_roster_query(TEXT, TEXT, TEXT) TO intake_business;
