-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0073_feishu_query_grant; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A new Feishu binding receives query grants for current v2-preview sources.
-- An existing binding is left untouched. principal_facts may last 24 hours.
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER TABLE content_intake.principal_facts DROP CONSTRAINT principal_facts_check;
ALTER TABLE content_intake.principal_facts
  ADD CONSTRAINT principal_facts_check
  CHECK (valid_until > checked_at AND valid_until <= checked_at + INTERVAL '24 hours');

CREATE OR REPLACE FUNCTION backend_identity.admit_feishu_agent(p_open_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE
  v_user TEXT;
  v_principal TEXT;
  v_tenant TEXT;
  v_app TEXT;
  v_policy content_intake.version;
  v_store content_intake.version;
  v_issuer TEXT;
  v_department TEXT;
  v_job TEXT;
  v_checked TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_digest TEXT;
  v_inserted TEXT;
  v_homes INT;
BEGIN
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  v_user := left('usr_' || p_open_id, 128);
  v_principal := 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(p_open_id, 'UTF8')), 'hex'), 32);

  INSERT INTO backend_identity.subject_bindings(
    binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
  ) VALUES (
    p_open_id, 'feishu', 'feishu-tenant', p_open_id, v_user,
    encode(pg_catalog.sha256(pg_catalog.convert_to(p_open_id, 'UTF8')), 'hex'), true, 'agent'
  ) ON CONFLICT (binding_id) DO NOTHING
  RETURNING binding_id INTO v_inserted;
  IF v_inserted IS NULL THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_homes FROM content_intake.store_set_current;
  IF v_homes <> 1 THEN
    RETURN;
  END IF;
  SELECT tenant_id, app_id, version INTO v_tenant, v_app, v_store
    FROM content_intake.store_set_current;
  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = v_tenant AND app_id = v_app;
  IF v_policy IS NULL OR v_store IS NULL THEN
    RETURN;
  END IF;

  SELECT parent.recipient_id, facts.department_ids[1], facts.job_id
    INTO v_issuer, v_department, v_job
    FROM content_intake.grants parent
    JOIN content_intake.principals issuer_row ON issuer_row.principal_id = parent.recipient_id
    JOIN content_intake.principal_facts facts
      ON facts.principal_id = issuer_row.principal_id
     AND facts.facts_version = issuer_row.current_facts_version
   WHERE parent.tenant_id = v_tenant AND parent.app_id = v_app
     AND parent.kind IN ('allocation', 'delegation')
     AND parent.action = 'query'
     AND parent.revoked_at IS NULL
     AND parent.starts_at <= v_checked AND v_checked < parent.expires_at
     AND facts.enabled AND facts.checked_at <= v_checked AND v_checked < facts.valid_until
     AND cardinality(facts.department_ids) >= 1
   ORDER BY parent.expires_at DESC
   LIMIT 1;
  IF v_issuer IS NULL OR v_department IS NULL OR v_job IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM content_intake.store_set_members member
      JOIN content_intake.sources src
        ON src.source_id = member.source_id AND src.scope_id = member.scope_id
       AND src.mode = 'v2-preview'
      WHERE member.tenant_id = v_tenant AND member.app_id = v_app AND member.version = v_store
        AND member.content_valid_until > v_checked
    ) THEN
      RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='FEISHU_GRANT_UNAVAILABLE';
    END IF;
    RETURN;
  END IF;

  INSERT INTO content_intake.principals(
    principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
  ) VALUES (
    v_principal, v_user, v_tenant, v_app, 'feishu-job-roster', p_open_id, 1
  ) ON CONFLICT (principal_id) DO NOTHING;

  v_digest := encode(pg_catalog.sha256(pg_catalog.convert_to(v_principal || v_department || v_job, 'UTF8')), 'hex');
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  ) VALUES (
    v_principal, 1, ARRAY[v_department], v_job, true,
    v_checked, v_checked + interval '24 hours', v_digest
  ) ON CONFLICT (principal_id, facts_version) DO NOTHING;

  INSERT INTO content_intake.grants(
    grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
    starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version, roster_job_id
  )
  SELECT DISTINCT ON (member.scope_id, member.source_id)
    left('grant_' || encode(pg_catalog.sha256(pg_catalog.convert_to(
      v_principal || ':' || member.scope_id || ':' || member.source_id || ':query:' ||
      v_policy::text || ':' || v_store::text, 'UTF8')), 'hex'), 40),
    'business', v_issuer, v_principal, v_tenant, v_app,
    member.scope_id, member.source_id, 'query',
    v_checked,
    LEAST(parent.expires_at, v_checked + interval '1 year', member.content_valid_until),
    '飞书登录按来源签发。', v_issuer, parent.grant_id, v_policy, v_store, v_job
  FROM content_intake.store_set_members member
  JOIN content_intake.sources src
    ON src.source_id = member.source_id AND src.scope_id = member.scope_id
   AND src.mode = 'v2-preview'
  JOIN content_intake.grants parent
    ON parent.recipient_id = v_issuer
   AND parent.tenant_id = v_tenant AND parent.app_id = v_app
   AND parent.kind IN ('allocation', 'delegation')
   AND parent.action = 'query'
   AND parent.scope_id = member.scope_id
   AND (parent.source_id IS NULL OR parent.source_id = member.source_id)
   AND parent.revoked_at IS NULL
   AND parent.starts_at <= v_checked AND v_checked < parent.expires_at
  WHERE member.tenant_id = v_tenant AND member.app_id = v_app AND member.version = v_store
    AND member.content_valid_until > v_checked
  ORDER BY member.scope_id, member.source_id, parent.expires_at DESC;

  IF NOT EXISTS (
    SELECT 1 FROM content_intake.grants g
    WHERE g.recipient_id = v_principal AND g.action = 'query' AND g.kind = 'business'
      AND g.revoked_at IS NULL AND v_checked < g.expires_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='FEISHU_GRANT_UNAVAILABLE';
  END IF;
  RETURN;
END $$;

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
  v_digest TEXT;
  v_checked TIMESTAMPTZ;
  v_signer TEXT;
  v_facts_version content_intake.version;
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
  -- A link to someone else's user_id must not reach the grant update below.
  IF p_person_key ~ '^ou_[A-Za-z0-9]{6,64}$' AND EXISTS (
    SELECT 1
    FROM backend_identity.feishu_login_links AS link
    JOIN backend_identity.subject_bindings AS binding ON binding.binding_id = link.binding_id
    WHERE link.open_id = p_person_key
      AND binding.user_id IS DISTINCT FROM p_user_id
  ) THEN
    RETURN 'bound-elsewhere';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id
      AND department_id = ANY(p_department_ids)
      AND job_id = p_job_id AND role = p_role
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM content_intake.principals person
      JOIN backend_identity.subject_bindings binding
        ON binding.user_id = person.user_id AND binding.enabled
      WHERE person.principal_id = p_principal_id
        AND person.user_id = p_user_id
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
    SELECT versioned.principal_id, versioned.current_facts_version, p_department_ids, p_job_id, false,
      v_checked, v_checked + interval '24 hours', v_digest
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
  v_checked := pg_catalog.clock_timestamp();
  v_facts_version := NULL;
  BEGIN
    INSERT INTO content_intake.principals AS person (
      principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version
    )
    SELECT p_principal_id, known.user_id, p_tenant_id, p_app_id, p_identity_scope, p_person_key, 1
    FROM (
      SELECT user_id FROM backend_identity.subject_bindings
      WHERE user_id = p_user_id AND enabled
      LIMIT 1
    ) AS known
    ON CONFLICT (principal_id) DO UPDATE
    SET current_facts_version = person.current_facts_version + 1
    WHERE person.user_id = EXCLUDED.user_id
      AND person.tenant_id = EXCLUDED.tenant_id AND person.app_id = EXCLUDED.app_id
      AND person.identity_scope = EXCLUDED.identity_scope AND person.person_key = EXCLUDED.person_key
    RETURNING person.current_facts_version INTO v_facts_version;
  EXCEPTION
    WHEN unique_violation THEN
      -- Another principal already owns this user_id or person tuple. Text, not 23505.
      RETURN 'conflict';
  END;
  IF v_facts_version IS NULL THEN
    IF v_known THEN RETURN 'conflict'; END IF;
    RETURN 'missing';
  END IF;
  INSERT INTO content_intake.principal_facts (
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  ) VALUES (
    p_principal_id, v_facts_version, p_department_ids, p_job_id, true,
    v_checked, v_checked + interval '24 hours', v_digest
  );
  RETURN 'registered';
END $$;

CREATE OR REPLACE FUNCTION backend_identity.create_seat(
  p_username TEXT,
  p_display_name TEXT,
  p_post TEXT,
  p_tenant_id TEXT,
  p_app_id TEXT,
  p_department_id TEXT,
  p_assigned_by TEXT
) RETURNS TABLE (
  out_principal_id TEXT,
  out_binding_id TEXT,
  out_user_id TEXT,
  out_job_id TEXT,
  out_role TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_display TEXT;
  v_binding TEXT;
  v_user TEXT;
  v_principal TEXT;
  v_job TEXT;
  v_role TEXT;
  v_session_role TEXT;
  v_policy content_intake.version;
  v_store content_intake.version;
  v_issuer TEXT;
  v_actions TEXT[];
  v_checked TIMESTAMPTZ := pg_catalog.clock_timestamp();
  v_digest TEXT;
BEGIN
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_USERNAME_INVALID';
  END IF;

  IF p_display_name IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_DISPLAY_NAME_INVALID';
  END IF;
  v_display := btrim(p_display_name);
  IF length(v_display) < 1 OR length(v_display) > 256 OR v_display ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_DISPLAY_NAME_INVALID';
  END IF;

  SELECT mapping.out_job_id, mapping.out_role, mapping.out_session_role
    INTO v_job, v_role, v_session_role
    FROM content_intake.seat_post_mapping(p_post) AS mapping;
  IF v_job IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_POST_INVALID';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM content_intake.role_ceiling WHERE role = v_role) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_ROLE_NOT_IN_CEILING';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_app_id IS NULL OR p_app_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_department_id IS NULL OR p_department_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_assigned_by IS NULL OR length(btrim(p_assigned_by)) < 1 OR length(p_assigned_by) > 128 THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_HOME_INVALID';
  END IF;

  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id;
  IF v_policy IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_HOME_UNKNOWN';
  END IF;

  v_binding := 'synthetic_seat_' || p_username;
  v_user := left('usr_seat_' || encode(sha256(convert_to(p_username, 'UTF8')), 'hex'), 40);
  v_principal := 'seat_' || p_username;

  IF EXISTS (SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id = v_binding) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SEAT_EXISTS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM backend_identity.subject_bindings
     WHERE provider = 'synthetic' AND tenant = p_tenant_id AND subject = v_display
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SEAT_DISPLAY_NAME_TAKEN';
  END IF;

  SELECT principal_id INTO v_issuer
    FROM content_intake.principals
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id
      AND (user_id = btrim(p_assigned_by) OR principal_id = btrim(p_assigned_by))
    ORDER BY CASE WHEN user_id = btrim(p_assigned_by) THEN 0 ELSE 1 END
    LIMIT 1;
  IF v_issuer IS NULL OR v_issuer = v_principal THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_GRANT_UNAVAILABLE';
  END IF;

  SELECT cur.version INTO v_store
    FROM content_intake.store_set_current cur
    WHERE cur.tenant_id = p_tenant_id AND cur.app_id = p_app_id;
  IF v_store IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_GRANT_UNAVAILABLE';
  END IF;

  INSERT INTO backend_identity.subject_bindings(
    binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role)
  VALUES (
    v_binding, 'synthetic', p_tenant_id, v_display, v_user,
    encode(sha256(convert_to(v_binding, 'UTF8')), 'hex'), true, v_session_role);

  INSERT INTO content_intake.principals(
    principal_id, user_id, tenant_id, app_id, identity_scope, person_key, current_facts_version)
  VALUES (v_principal, v_user, p_tenant_id, p_app_id, 'confirmed-synthetic', v_principal, 1);

  INSERT INTO content_intake.seat_posts(
    principal_id, tenant_id, app_id, department_id, job_id, assigned_by)
  VALUES (v_principal, p_tenant_id, p_app_id, p_department_id, v_job, btrim(p_assigned_by));

  INSERT INTO content_intake.role_rules(
    tenant_id, app_id, department_id, job_id, policy_version, role)
  VALUES (p_tenant_id, p_app_id, p_department_id, v_job, v_policy, v_role)
  ON CONFLICT (tenant_id, app_id, department_id, job_id) DO NOTHING;

  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id;

  v_digest := encode(sha256(convert_to(v_principal || p_department_id || v_job, 'UTF8')), 'hex');
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
  VALUES (v_principal, 1, ARRAY[p_department_id], v_job, true,
    v_checked, v_checked + interval '24 hours', v_digest);

  v_actions := ARRAY['query'];

  INSERT INTO content_intake.grants(
    grant_id, kind, issuer_id, recipient_id, tenant_id, app_id, scope_id, source_id, action,
    starts_at, expires_at, reason, steward_id, parent_grant_id, policy_version, store_set_version, roster_job_id)
  SELECT DISTINCT ON (member.scope_id, member.source_id, needed.action)
    left('grant_' || encode(sha256(convert_to(
      v_principal || ':' || member.scope_id || ':' || member.source_id || ':' || needed.action || ':'
      || v_policy::text || ':' || v_store::text, 'UTF8')), 'hex'), 40),
    'business', v_issuer, v_principal, p_tenant_id, p_app_id,
    member.scope_id, member.source_id, needed.action,
    v_checked,
    LEAST(parent.expires_at, v_checked + interval '1 year', member.content_valid_until),
    '建席按岗位签发。', v_issuer, parent.grant_id, v_policy, v_store, v_job
  FROM unnest(v_actions) AS needed(action)
  JOIN content_intake.store_set_members member
    ON member.tenant_id = p_tenant_id AND member.app_id = p_app_id AND member.version = v_store
   AND member.content_valid_until > v_checked
  JOIN content_intake.grants parent
    ON parent.recipient_id = v_issuer
   AND parent.tenant_id = p_tenant_id AND parent.app_id = p_app_id
   AND parent.kind IN ('allocation', 'delegation')
   AND parent.action = needed.action
   AND parent.scope_id = member.scope_id
   AND (parent.source_id IS NULL OR parent.source_id = member.source_id)
   AND parent.revoked_at IS NULL
   AND parent.starts_at <= v_checked
   AND v_checked < parent.expires_at
  ORDER BY member.scope_id, member.source_id, needed.action, parent.expires_at DESC;

  IF NOT EXISTS (
    SELECT 1 FROM content_intake.grants g
    WHERE g.recipient_id = v_principal AND g.action = 'query' AND g.kind = 'business'
      AND g.revoked_at IS NULL AND v_checked < g.expires_at
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_GRANT_UNAVAILABLE';
  END IF;

  RETURN QUERY SELECT v_principal, v_binding, v_user, v_job, v_role;
END $$;

CREATE OR REPLACE FUNCTION content_intake.project_seat_login(p_binding_id TEXT) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_principal content_intake.principals%ROWTYPE;
  v_post content_intake.seat_posts%ROWTYPE;
  v_checked TIMESTAMPTZ := clock_timestamp();
  v_digest TEXT;
BEGIN
  IF p_binding_id IS NULL OR p_binding_id !~ '^synthetic_seat_[A-Za-z0-9_-]{1,64}$' THEN
    RETURN 'missing';
  END IF;

  SELECT person.* INTO v_principal
    FROM backend_identity.subject_bindings AS binding
    JOIN content_intake.principals AS person ON person.user_id = binding.user_id
   WHERE binding.binding_id = p_binding_id AND binding.enabled
   LIMIT 1;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  SELECT post.* INTO v_post
    FROM content_intake.seat_posts AS post
   WHERE post.principal_id = v_principal.principal_id
     AND post.tenant_id = v_principal.tenant_id
     AND post.app_id = v_principal.app_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  -- Facts without a matching rule are live rows that authorize nothing, which reads to the
  -- operator as a broken seat. Refuse instead, and name the state.
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules AS rule
     WHERE rule.tenant_id = v_post.tenant_id AND rule.app_id = v_post.app_id
       AND rule.department_id = v_post.department_id AND rule.job_id = v_post.job_id
  ) THEN
    RETURN 'policy-pending';
  END IF;

  v_digest := encode(sha256(convert_to(
    v_principal.principal_id || v_post.department_id || v_post.job_id, 'UTF8')), 'hex');

  WITH versioned AS (
    UPDATE content_intake.principals AS person
       SET current_facts_version = person.current_facts_version + 1
     WHERE person.principal_id = v_principal.principal_id
    RETURNING person.principal_id, person.current_facts_version
  )
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
  SELECT versioned.principal_id, versioned.current_facts_version,
         ARRAY[v_post.department_id], v_post.job_id, true,
         v_checked, v_checked + interval '24 hours', v_digest
    FROM versioned;

  RETURN 'projected';
END $$;

CREATE OR REPLACE FUNCTION content_intake.seat_administration_allowed(p_user_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
      FROM content_intake.principals AS person
      JOIN content_intake.principal_facts AS facts
        ON facts.principal_id = person.principal_id
       AND facts.facts_version = person.current_facts_version
      JOIN backend_identity.subject_bindings AS binding
        ON binding.user_id = person.user_id
     WHERE person.user_id = p_user_id
       AND facts.enabled
       AND binding.enabled
       AND facts.checked_at <= pg_catalog.clock_timestamp()
       AND pg_catalog.clock_timestamp() < facts.valid_until
       AND facts.valid_until <= facts.checked_at + interval '24 hours'
       AND (
         SELECT count(DISTINCT rule.role) = 1
            AND content_intake.role_may_allocate(min(rule.role))
           FROM content_intake.role_rules AS rule
          WHERE rule.tenant_id = person.tenant_id
            AND rule.app_id = person.app_id
            AND rule.department_id = ANY(facts.department_ids)
            AND rule.job_id = facts.job_id
       )
       AND EXISTS (
         SELECT 1
           FROM content_intake.grants AS grant_row
          WHERE grant_row.recipient_id = person.principal_id
            AND grant_row.tenant_id = person.tenant_id
            AND grant_row.app_id = person.app_id
            AND grant_row.kind = 'allocation'
            AND grant_row.revoked_at IS NULL
            AND grant_row.steward_id IS NOT NULL
            AND grant_row.starts_at <= pg_catalog.clock_timestamp()
            AND pg_catalog.clock_timestamp() < grant_row.expires_at
       )
  );
$$;
