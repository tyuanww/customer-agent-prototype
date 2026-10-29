-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0077_manual_identity_grants; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Manual identity and grant boundary.
--
-- A password proves possession. It never proves an administrator role or grants
-- business authority. The production master account is the existing
-- production-admin principal whose synthetic owner binding has a controlled
-- seat_posts row. Feishu admission records identity only; a trusted application
-- home may register a minimum candidate, but login never issues a business grant.
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Automatic roster and Feishu-query grants predate the manual-grant boundary.
-- Match the historical issuer identity or deterministic admission identity as
-- well as the reason. A human-entered reason is not proof of automatic issuance.
UPDATE content_intake.grants AS grant_row
SET version = grant_row.version + 1,
    last_change_reason = '自动查询授权退役。',
    revoked_at = pg_catalog.clock_timestamp()
WHERE grant_row.kind = 'business'
  AND grant_row.action = 'query'
  AND grant_row.revoked_at IS NULL
  AND (
    (grant_row.reason = '职位名单系统签发。'
      AND grant_row.issuer_id = left('sys_query_' || pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(grant_row.tenant_id || ':' || grant_row.app_id, 'UTF8')), 'hex'), 72)
      AND EXISTS (
        SELECT 1 FROM content_intake.principals AS signer
        WHERE signer.principal_id = grant_row.issuer_id
          AND signer.tenant_id = grant_row.tenant_id AND signer.app_id = grant_row.app_id
          AND signer.identity_scope = 'content-intake-system' AND signer.person_key = 'query-signer'))
    OR (grant_row.reason = '飞书登录按来源签发。'
      AND grant_row.parent_grant_id IS NOT NULL AND grant_row.source_id IS NOT NULL
      AND grant_row.roster_job_id IS NOT NULL AND grant_row.steward_id = grant_row.issuer_id
      AND grant_row.grant_id = left('grant_' || pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
        grant_row.recipient_id || ':' || grant_row.scope_id || ':' || grant_row.source_id || ':query:' ||
        grant_row.policy_version::text || ':' || grant_row.store_set_version::text, 'UTF8')), 'hex'), 40)
      AND EXISTS (
        SELECT 1 FROM content_intake.principals AS recipient
        WHERE recipient.principal_id = grant_row.recipient_id
          AND recipient.tenant_id = grant_row.tenant_id AND recipient.app_id = grant_row.app_id
          AND recipient.identity_scope = 'feishu-job-roster'
          AND recipient.person_key ~ '^ou_[A-Za-z0-9]{6,64}$'
          AND recipient.principal_id = 'prin_' || left(pg_catalog.encode(
            pg_catalog.sha256(pg_catalog.convert_to(recipient.person_key, 'UTF8')), 'hex'), 32)))
  );

-- Stale schedulers fail closed until their deployment stops calling the retired
-- issuer. The function remains as audit history; no product capability can run it.
REVOKE EXECUTE ON FUNCTION content_intake.issue_roster_query(TEXT, TEXT, TEXT)
  FROM intake_business;

-- Feishu admission owns only the external identity row. It does not choose a
-- tenant, department, job, business role, facts row or grant. Session linkage
-- receives the binding only after this function records the verified identity.
CREATE OR REPLACE FUNCTION backend_identity.admit_feishu_agent(p_open_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_user TEXT;
BEGIN
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'LOGIN_INVALID';
  END IF;
  v_user := left('usr_' || p_open_id, 128);
  INSERT INTO backend_identity.subject_bindings(
    binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
  ) VALUES (
    p_open_id, 'feishu', 'feishu-tenant', p_open_id, v_user,
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_open_id, 'UTF8')), 'hex'),
    true, 'agent'
  ) ON CONFLICT (binding_id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION backend_identity.admit_feishu_agent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.admit_feishu_agent(TEXT) TO app_backend_auth;

-- A trusted application home supplies one internal candidate department and job.
-- `feishu-candidate` means only that the OAuth subject is registered; it is not
-- a verified HR title. An exact same-open-id binding, or an exact persisted link
-- to an already-registered principal, is required. Repeated fallback preserves
-- the current enabled bit so a disabled/departed state cannot be revived. No
-- grant is written.
CREATE OR REPLACE FUNCTION content_intake.project_feishu_candidate(
  p_user_id TEXT,
  p_tenant_id TEXT,
  p_app_id TEXT,
  p_person_key TEXT,
  p_department_id TEXT,
  p_job_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_binding_id TEXT;
  v_binding_user TEXT;
  v_existing_principal content_intake.principals%ROWTYPE;
  v_enabled BOOLEAN;
  v_facts_version content_intake.version;
  v_checked TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_digest TEXT;
  v_expected_user TEXT;
  v_expected_principal TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_tenant_id IS NULL OR p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_app_id IS NULL OR p_app_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_person_key IS NULL OR p_person_key !~ '^ou_[A-Za-z0-9]{6,64}$'
    OR p_department_id IS NULL OR p_department_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_job_id IS NULL OR p_job_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$' THEN
    RETURN 'invalid';
  END IF;

  SELECT binding.binding_id, binding.user_id INTO v_binding_id, v_binding_user
  FROM backend_identity.subject_bindings AS binding
  WHERE binding.enabled
    AND (
      (binding.provider = 'feishu'
        AND binding.binding_id = p_person_key
        AND binding.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM backend_identity.feishu_login_links AS link
        WHERE link.open_id = p_person_key
          AND link.binding_id = binding.binding_id
      )
    )
  LIMIT 1;
  IF v_binding_id IS NULL THEN RETURN 'missing'; END IF;

  SELECT person.* INTO v_existing_principal
  FROM content_intake.principals AS person
  WHERE person.user_id = v_binding_user
  LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    IF v_existing_principal.tenant_id <> p_tenant_id
      OR v_existing_principal.app_id <> p_app_id
      OR v_existing_principal.person_key <> p_person_key THEN
      RETURN 'conflict';
    END IF;
    IF v_existing_principal.identity_scope = 'feishu-job-roster' THEN
      RETURN 'confirmed';
    END IF;
    IF v_existing_principal.identity_scope <> 'feishu-candidate' THEN
      RETURN 'conflict';
    END IF;
    SELECT facts.enabled INTO v_enabled
    FROM content_intake.principal_facts AS facts
    WHERE facts.principal_id = v_existing_principal.principal_id
      AND facts.facts_version = v_existing_principal.current_facts_version;
    IF v_enabled IS NOT TRUE THEN RETURN 'inactive'; END IF;
  ELSE
    IF v_binding_id <> p_person_key THEN RETURN 'missing-principal'; END IF;
    v_expected_user := left('usr_' || p_person_key, 128);
    v_expected_principal := 'prin_' || left(
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_person_key, 'UTF8')), 'hex'), 32);
    IF p_user_id <> v_expected_user THEN RETURN 'missing-principal'; END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM content_intake.policy_versions AS policy
    WHERE policy.tenant_id = p_tenant_id AND policy.app_id = p_app_id
  ) OR NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules AS rule
    WHERE rule.tenant_id = p_tenant_id
      AND rule.app_id = p_app_id
      AND rule.department_id = p_department_id
      AND rule.job_id = p_job_id
      AND rule.role = 'agent'
  ) THEN
    RETURN 'policy-pending';
  END IF;

  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    COALESCE(v_existing_principal.principal_id, v_expected_principal)
      || p_department_id || p_job_id, 'UTF8')), 'hex');
  IF v_existing_principal.principal_id IS NULL THEN
    INSERT INTO content_intake.principals(
      principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
    ) VALUES (
      v_expected_principal, p_user_id, p_tenant_id, p_app_id,
      'feishu-candidate', p_person_key, 1
    );
    INSERT INTO content_intake.principal_facts(
      principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
    ) VALUES (
      v_expected_principal, 1, ARRAY[p_department_id], p_job_id, true,
      v_checked, v_checked + interval '24 hours', v_digest
    );
  ELSE
    WITH versioned AS (
      UPDATE content_intake.principals AS person
      SET current_facts_version = person.current_facts_version + 1
      WHERE person.principal_id = v_existing_principal.principal_id
      RETURNING person.principal_id, person.current_facts_version
    )
    INSERT INTO content_intake.principal_facts(
      principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
    )
    SELECT versioned.principal_id, versioned.current_facts_version,
      ARRAY[p_department_id], p_job_id, true,
      v_checked, v_checked + interval '24 hours', v_digest
    FROM versioned;
  END IF;
  RETURN 'registered';
END $$;

REVOKE ALL ON FUNCTION content_intake.project_feishu_candidate(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_feishu_candidate(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO intake_business;

-- Confirmed directory data may promote a minimum candidate to the verified roster
-- scope. The same exact binding/link checks apply, and this function still does
-- not issue a grant. Missing policy marks the current facts disabled; a later
-- candidate fallback cannot turn that state back on.
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_binding_id TEXT;
  v_binding_user TEXT;
  v_principal content_intake.principals%ROWTYPE;
  v_principal_id TEXT;
  v_facts_version content_intake.version;
  v_checked TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_digest TEXT;
  v_expected_principal TEXT;
  v_attached_link BOOLEAN;
BEGIN
  IF p_identity_scope <> 'feishu-job-roster'
    OR p_role IS NULL
    OR p_role NOT IN ('agent','enabler','lead','supervisor','manager','director','engineer')
    OR p_department_ids IS NULL OR cardinality(p_department_ids) < 1 OR p_job_id IS NULL
    OR p_actions IS DISTINCT FROM ARRAY['query']::text[] THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'LOGIN_INVALID';
  END IF;

  SELECT binding.binding_id, binding.user_id, binding.binding_id <> p_person_key
    INTO v_binding_id, v_binding_user, v_attached_link
  FROM backend_identity.subject_bindings AS binding
  WHERE binding.enabled
    AND (
      (binding.provider = 'feishu'
        AND binding.binding_id = p_person_key
        AND binding.user_id = p_user_id
        AND p_principal_id = 'prin_' || left(
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_person_key, 'UTF8')), 'hex'), 32))
      OR EXISTS (
        SELECT 1 FROM backend_identity.feishu_login_links AS link
        JOIN content_intake.principals AS linked ON linked.user_id = binding.user_id
        WHERE link.open_id = p_person_key
          AND link.binding_id = binding.binding_id
      )
    )
  LIMIT 1;
  IF v_binding_id IS NULL THEN RETURN 'missing'; END IF;

  SELECT person.* INTO v_principal
  FROM content_intake.principals AS person
  WHERE person.user_id = v_binding_user
  LIMIT 1 FOR UPDATE;
  IF FOUND AND (
    v_principal.tenant_id <> p_tenant_id
    OR v_principal.app_id <> p_app_id
    OR (v_principal.person_key <> p_person_key AND v_attached_link IS NOT TRUE)
    OR (v_principal.identity_scope NOT IN ('feishu-candidate','feishu-job-roster')
      AND v_attached_link IS NOT TRUE)
  ) THEN
    RETURN 'conflict';
  END IF;
  IF v_principal.principal_id IS NOT NULL THEN
    v_principal_id := v_principal.principal_id;
  ELSE
    v_expected_principal := 'prin_' || left(
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_person_key, 'UTF8')), 'hex'), 32);
    IF p_principal_id <> v_expected_principal
      OR p_user_id <> left('usr_' || p_person_key, 128) THEN
      RETURN 'missing';
    END IF;
    v_principal_id := p_principal_id;
  END IF;

  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    v_principal_id || p_job_id || p_role, 'UTF8')), 'hex');
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules AS rule
    WHERE rule.tenant_id = p_tenant_id
      AND rule.app_id = p_app_id
      AND rule.department_id = ANY(p_department_ids)
      AND rule.job_id = p_job_id
      AND rule.role = p_role
  ) THEN
    IF v_principal.principal_id IS NOT NULL THEN
      WITH versioned AS (
        UPDATE content_intake.principals AS person
        SET current_facts_version = person.current_facts_version + 1
        WHERE person.principal_id = v_principal_id
        RETURNING person.principal_id, person.current_facts_version
      )
      INSERT INTO content_intake.principal_facts(
        principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
      )
      SELECT versioned.principal_id, versioned.current_facts_version,
        p_department_ids, p_job_id, false,
        v_checked, v_checked + interval '24 hours', v_digest
      FROM versioned;
    END IF;
    RETURN 'policy-pending';
  END IF;

  IF v_principal.principal_id IS NULL THEN
    INSERT INTO content_intake.principals AS person (
      principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
    ) VALUES (
      v_principal_id, p_user_id, p_tenant_id, p_app_id,
      'feishu-job-roster', p_person_key, 1
    );
    v_facts_version := 1;
  ELSE
    UPDATE content_intake.principals AS person
    SET current_facts_version = person.current_facts_version + 1,
        identity_scope = CASE
          WHEN person.identity_scope = 'feishu-candidate' THEN 'feishu-job-roster'
          ELSE person.identity_scope
        END
    WHERE person.principal_id = v_principal_id
    RETURNING person.current_facts_version INTO v_facts_version;
    IF v_facts_version IS NULL THEN RETURN 'conflict'; END IF;
  END IF;

  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  ) VALUES (
    v_principal_id, v_facts_version, p_department_ids, p_job_id, true,
    v_checked, v_checked + interval '24 hours', v_digest
  );
  RETURN 'registered';
END $$;

REVOKE ALL ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]) TO intake_business;

CREATE OR REPLACE FUNCTION content_intake.roster_permission_for_user(p_user_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_principal TEXT;
  v_tenant TEXT;
  v_app TEXT;
  v_enabled BOOLEAN;
  v_checked TIMESTAMPTZ;
  v_until TIMESTAMPTZ;
BEGIN
  SELECT person.principal_id, person.tenant_id, person.app_id,
    facts.enabled, facts.checked_at, facts.valid_until
  INTO v_principal, v_tenant, v_app, v_enabled, v_checked, v_until
  FROM content_intake.principals AS person
  JOIN content_intake.principal_facts AS facts
    ON facts.principal_id = person.principal_id
   AND facts.facts_version = person.current_facts_version
  WHERE person.user_id = p_user_id
    AND person.identity_scope IN ('feishu-candidate','feishu-job-roster');
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_enabled IS NOT TRUE THEN RETURN 'revoked'; END IF;
  IF (v_checked <= v_at AND v_at < v_until) IS NOT TRUE THEN RETURN 'expired'; END IF;
  IF EXISTS (
    SELECT 1
    FROM content_intake.store_set_current AS current_set
    JOIN content_intake.store_set_members AS member
      ON member.tenant_id = current_set.tenant_id
     AND member.app_id = current_set.app_id
     AND member.version = current_set.version
    WHERE current_set.tenant_id = v_tenant
      AND current_set.app_id = v_app
      AND content_intake.authorization_deadline(
        v_principal, 'query', member.scope_id, member.source_id, v_at) IS NOT NULL
  ) THEN RETURN 'ready'; END IF;
  RETURN 'pending';
END $$;

REVOKE ALL ON FUNCTION content_intake.roster_permission_for_user(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.roster_permission_for_user(TEXT) TO intake_business;

-- Configure the already-approved production-admin principal. This creates no
-- principal, binding, password or business grant. The fixed internal job gives
-- password login a current, least-privilege fact source that no caller supplies.
CREATE OR REPLACE FUNCTION backend_identity.configure_production_admin_post(
  p_principal_id TEXT,
  p_department_id TEXT,
  p_assigned_by TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_principal content_intake.principals%ROWTYPE;
  v_policy content_intake.version;
BEGIN
  IF p_principal_id IS NULL OR p_principal_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_department_id IS NULL OR p_department_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_assigned_by IS NULL OR length(btrim(p_assigned_by)) NOT BETWEEN 1 AND 128 THEN
    RETURN 'invalid';
  END IF;

  IF (
    SELECT count(*)
    FROM content_intake.principals AS person
    JOIN backend_identity.subject_bindings AS binding ON binding.user_id = person.user_id
    WHERE person.identity_scope = 'production-admin'
      AND binding.provider = 'synthetic'
      AND binding.role = 'owner'
      AND binding.enabled
  ) <> 1 THEN
    RETURN 'conflict';
  END IF;

  SELECT person.* INTO v_principal
  FROM content_intake.principals AS person
  JOIN backend_identity.subject_bindings AS binding ON binding.user_id = person.user_id
  WHERE person.principal_id = p_principal_id
    AND person.identity_scope = 'production-admin'
    AND binding.provider = 'synthetic'
    AND binding.role = 'owner'
    AND binding.enabled
  LIMIT 1;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  SELECT policy.version INTO v_policy
  FROM content_intake.policy_versions AS policy
  WHERE policy.tenant_id = v_principal.tenant_id
    AND policy.app_id = v_principal.app_id;
  IF v_policy IS NULL THEN RETURN 'policy-pending'; END IF;

  INSERT INTO content_intake.role_rules(
    tenant_id, app_id, department_id, job_id, policy_version, role
  ) VALUES (
    v_principal.tenant_id, v_principal.app_id, p_department_id,
    'job-master-account', v_policy, 'director'
  ) ON CONFLICT (tenant_id, app_id, department_id, job_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules AS rule
    WHERE rule.tenant_id = v_principal.tenant_id
      AND rule.app_id = v_principal.app_id
      AND rule.department_id = p_department_id
      AND rule.job_id = 'job-master-account'
      AND rule.role = 'director'
  ) THEN
    RETURN 'conflict';
  END IF;

  INSERT INTO content_intake.seat_posts(
    principal_id, tenant_id, app_id, department_id, job_id, assigned_by
  ) VALUES (
    v_principal.principal_id, v_principal.tenant_id, v_principal.app_id,
    p_department_id, 'job-master-account', btrim(p_assigned_by)
  )
  ON CONFLICT (principal_id) DO UPDATE
  SET department_id = EXCLUDED.department_id,
      job_id = EXCLUDED.job_id,
      assigned_at = pg_catalog.clock_timestamp(),
      assigned_by = EXCLUDED.assigned_by
  WHERE content_intake.seat_posts.tenant_id = EXCLUDED.tenant_id
    AND content_intake.seat_posts.app_id = EXCLUDED.app_id;

  RETURN 'configured';
END $$;

REVOKE ALL ON FUNCTION backend_identity.configure_production_admin_post(TEXT, TEXT, TEXT)
  FROM PUBLIC;

-- Password server precondition. A private password-file row can select only an
-- enabled synthetic binding that resolves to a controlled post and matching role
-- rule. A production-admin binding additionally requires owner and the fixed
-- master post. Password possession still contributes no authority on its own.
CREATE OR REPLACE FUNCTION content_intake.password_login_allowed(p_binding_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM backend_identity.subject_bindings AS binding
    JOIN content_intake.principals AS person ON person.user_id = binding.user_id
    JOIN content_intake.principal_facts AS facts
      ON facts.principal_id = person.principal_id
     AND facts.facts_version = person.current_facts_version AND facts.enabled
    JOIN content_intake.seat_posts AS post
      ON post.principal_id = person.principal_id
     AND post.tenant_id = person.tenant_id
     AND post.app_id = person.app_id
    JOIN content_intake.role_rules AS rule
      ON rule.tenant_id = post.tenant_id
     AND rule.app_id = post.app_id
     AND rule.department_id = post.department_id
     AND rule.job_id = post.job_id
    WHERE binding.binding_id = p_binding_id
      AND binding.provider = 'synthetic'
      AND binding.enabled
      AND (
        (
          person.identity_scope = 'confirmed-synthetic'
          AND binding.binding_id LIKE 'synthetic_seat_%'
          AND (
            (post.job_id = 'job-seat' AND binding.role = 'agent' AND rule.role = 'agent')
            OR
            (post.job_id = 'job-seat-supervisor' AND binding.role = 'coach' AND rule.role = 'supervisor')
          )
        )
        OR
        (
          person.identity_scope = 'production-admin'
          AND (
            SELECT count(*)
            FROM content_intake.principals AS admin_person
            JOIN backend_identity.subject_bindings AS admin_binding
              ON admin_binding.user_id = admin_person.user_id
            WHERE admin_person.identity_scope = 'production-admin'
              AND admin_binding.provider = 'synthetic'
              AND admin_binding.role = 'owner'
              AND admin_binding.enabled
          ) = 1
          AND binding.role = 'owner'
          AND post.job_id = 'job-master-account'
          AND rule.role = 'director'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION content_intake.password_login_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.password_login_allowed(TEXT) TO intake_business;

-- Password login may renew expired enabled facts, but cannot undo a disable.
-- The principal lock makes that distinction survive a concurrent withdrawal.
CREATE OR REPLACE FUNCTION content_intake.project_seat_login(p_binding_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_principal content_intake.principals%ROWTYPE;
  v_post content_intake.seat_posts%ROWTYPE;
  v_checked TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_digest TEXT;
BEGIN
  IF p_binding_id IS NULL
    OR p_binding_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR NOT content_intake.password_login_allowed(p_binding_id) THEN
    RETURN 'missing';
  END IF;

  SELECT person.* INTO v_principal
  FROM backend_identity.subject_bindings AS binding
  JOIN content_intake.principals AS person ON person.user_id = binding.user_id
  WHERE binding.binding_id = p_binding_id
  LIMIT 1 FOR UPDATE OF person;
  IF NOT FOUND OR NOT content_intake.password_login_allowed(p_binding_id) THEN
    RETURN 'missing';
  END IF;

  SELECT post.* INTO v_post
  FROM content_intake.seat_posts AS post
  WHERE post.principal_id = v_principal.principal_id
    AND post.tenant_id = v_principal.tenant_id
    AND post.app_id = v_principal.app_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  v_digest := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    v_principal.principal_id || v_post.department_id || v_post.job_id, 'UTF8')), 'hex');

  WITH versioned AS (
    UPDATE content_intake.principals AS person
    SET current_facts_version = person.current_facts_version + 1
    WHERE person.principal_id = v_principal.principal_id
    RETURNING person.principal_id, person.current_facts_version
  )
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  )
  SELECT versioned.principal_id, versioned.current_facts_version,
         ARRAY[v_post.department_id], v_post.job_id, true,
         v_checked, v_checked + interval '24 hours', v_digest
  FROM versioned;

  RETURN 'projected';
END $$;

REVOKE ALL ON FUNCTION content_intake.project_seat_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_seat_login(TEXT) TO intake_business;

-- Only the authorized directory reads names. Query and publication do not need
-- app_users privileges to evaluate a principal's authority.
GRANT SELECT (user_id, display_name) ON public.app_users TO intake_business;

-- A verified binding owns the first display row. Later name updates preserve
-- the existing account role and active state, including a disabled account.
CREATE OR REPLACE FUNCTION backend_identity.set_operator_display_name(
  p_binding_id TEXT,
  p_display_name TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_name TEXT := btrim(p_display_name);
  v_user_id TEXT;
  v_role TEXT;
BEGIN
  IF p_binding_id IS NULL OR p_binding_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR v_name IS NULL OR length(v_name) NOT BETWEEN 1 AND 64
    OR v_name ~ '[[:cntrl:]]' THEN
    RETURN 'invalid';
  END IF;
  SELECT binding.user_id, binding.role INTO v_user_id, v_role
  FROM backend_identity.subject_bindings AS binding
  WHERE binding.binding_id = p_binding_id AND binding.enabled;
  IF v_user_id IS NULL THEN RETURN 'missing'; END IF;
  INSERT INTO public.app_users (user_id, display_name, role)
  VALUES (v_user_id, v_name, v_role)
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;
  RETURN 'updated';
END $$;

REVOKE ALL ON FUNCTION backend_identity.set_operator_display_name(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.set_operator_display_name(TEXT, TEXT)
  TO app_backend_auth;

-- Departure uses the same persisted binding as OAuth. A derived open-id principal
-- is not necessarily the account that the person actually used.
CREATE FUNCTION content_intake.withdraw_feishu_roster(
  p_open_id TEXT, p_tenant_id TEXT, p_app_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_binding TEXT;
  v_person content_intake.principals%ROWTYPE;
BEGIN
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$'
    OR p_tenant_id IS NULL OR p_app_id IS NULL THEN RETURN 'invalid'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 2);
  SELECT link.binding_id INTO v_binding
  FROM backend_identity.feishu_login_links AS link WHERE link.open_id = p_open_id;
  SELECT person.* INTO v_person
  FROM backend_identity.subject_bindings AS binding
  JOIN content_intake.principals AS person ON person.user_id = binding.user_id
  WHERE binding.binding_id = COALESCE(v_binding, p_open_id)
    AND (v_binding IS NOT NULL OR (binding.provider = 'feishu' AND binding.subject = p_open_id))
  FOR UPDATE OF person;
  IF NOT FOUND THEN RETURN 'absent'; END IF;
  IF v_person.tenant_id <> p_tenant_id OR v_person.app_id <> p_app_id THEN
    RETURN 'conflict';
  END IF;
  RETURN content_intake.withdraw_roster_query(v_person.principal_id, p_tenant_id, p_app_id);
END $$;
REVOKE ALL ON FUNCTION content_intake.withdraw_feishu_roster(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.withdraw_feishu_roster(TEXT, TEXT, TEXT) TO intake_business;

-- Only the owner-executed directory projection can promote a candidate, and no
-- stable identity key may change along with the classification.
CREATE OR REPLACE FUNCTION content_intake.principal_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  v_promotion BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'IDENTITY_IMMUTABLE';
  END IF;
  v_promotion := OLD.identity_scope = 'feishu-candidate'
    AND NEW.identity_scope = 'feishu-job-roster'
    AND NEW.current_facts_version = OLD.current_facts_version + 1
    AND current_user = (SELECT pg_catalog.pg_get_userbyid(relowner)
      FROM pg_catalog.pg_class WHERE oid = TG_RELID)
    AND (to_jsonb(NEW) - ARRAY['identity_scope','current_facts_version','revocation_generation'])
      IS NOT DISTINCT FROM
      (to_jsonb(OLD) - ARRAY['identity_scope','current_facts_version','revocation_generation']);
  IF (to_jsonb(NEW) - ARRAY['current_facts_version','revocation_generation'])
      IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['current_facts_version','revocation_generation'])
    AND v_promotion IS NOT TRUE THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.current_facts_version < OLD.current_facts_version
    OR NEW.revocation_generation < OLD.revocation_generation THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'VERSION_REGRESSION';
  END IF;
  RETURN NEW;
END $$;
