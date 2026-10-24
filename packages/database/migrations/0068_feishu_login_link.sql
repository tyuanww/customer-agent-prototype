-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0068_feishu_login_link; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- One Feishu open_id points at one existing subject binding.
-- binding_id is not unique: several open ids may share one binding, and that binding still has one user_id.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE TABLE backend_identity.feishu_login_links (
  open_id TEXT PRIMARY KEY CHECK (open_id ~ '^ou_[A-Za-z0-9]{6,64}$'),
  binding_id TEXT NOT NULL REFERENCES backend_identity.subject_bindings(binding_id)
);

REVOKE ALL ON TABLE backend_identity.feishu_login_links FROM PUBLIC;

-- An existing row is never updated. The same binding is idempotent; a different binding conflicts,
-- so a later login cannot retarget an open id that already points somewhere.
CREATE FUNCTION backend_identity.bind_feishu_subject(p_open_id TEXT, p_binding_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_inserted TEXT;
  v_existing TEXT;
BEGIN
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RETURN 'login-invalid';
  END IF;
  INSERT INTO backend_identity.feishu_login_links (open_id, binding_id)
  VALUES (p_open_id, p_binding_id)
  ON CONFLICT (open_id) DO NOTHING
  RETURNING open_id INTO v_inserted;
  IF FOUND THEN
    RETURN 'inserted';
  END IF;
  SELECT link.binding_id INTO v_existing
  FROM backend_identity.feishu_login_links AS link
  WHERE link.open_id = p_open_id;
  IF v_existing IS NOT DISTINCT FROM p_binding_id THEN
    RETURN 'same';
  END IF;
  RETURN 'conflict';
END $$;

CREATE FUNCTION backend_identity.establish_feishu_login(p_login_id TEXT, p_open_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_binding TEXT;
  v_linked TEXT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 2);
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'LOGIN_INVALID';
  END IF;
  SELECT link.binding_id INTO v_binding
  FROM backend_identity.feishu_login_links AS link
  WHERE link.open_id = p_open_id;
  IF FOUND THEN
    PERFORM backend_identity.complete_callback(p_login_id, v_binding);
    RETURN v_binding;
  END IF;
  BEGIN
    PERFORM backend_identity.complete_callback(p_login_id, p_open_id);
  EXCEPTION
    WHEN SQLSTATE 'ZA005' THEN
      IF SQLERRM IS DISTINCT FROM 'CAPABILITY_DENIED' THEN
        RAISE;
      END IF;
      PERFORM backend_identity.admit_feishu_agent(p_open_id);
      PERFORM backend_identity.complete_callback(p_login_id, p_open_id);
  END;
  v_linked := backend_identity.bind_feishu_subject(p_open_id, p_open_id);
  IF v_linked IN ('inserted', 'same') THEN
    RETURN p_open_id;
  END IF;
  IF v_linked = 'conflict' THEN
    RAISE EXCEPTION USING ERRCODE = 'ZA003', MESSAGE = 'LOGIN_INVALID';
  END IF;
  RAISE EXCEPTION USING ERRCODE = 'ZA001', MESSAGE = 'LOGIN_INVALID';
END $$;

CREATE FUNCTION backend_identity.attach_feishu_login(p_open_id TEXT, p_principal_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
  v_binding TEXT;
  v_linked TEXT;
  v_feishu_user TEXT;
  v_feishu_principal TEXT;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(724019, 2);
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RETURN 'login-invalid';
  END IF;
  SELECT binding.binding_id INTO v_binding
  FROM content_intake.principals AS person
  JOIN backend_identity.subject_bindings AS binding ON binding.user_id = person.user_id
  WHERE person.principal_id = p_principal_id;
  IF NOT FOUND THEN
    RETURN 'principal-missing';
  END IF;
  v_feishu_user := left('usr_' || p_open_id, 128);
  v_feishu_principal := 'prin_' || left(encode(pg_catalog.sha256(pg_catalog.convert_to(p_open_id, 'UTF8')), 'hex'), 32);
  IF EXISTS (
    SELECT 1 FROM content_intake.principals AS person
    WHERE person.principal_id IS DISTINCT FROM p_principal_id
      AND (
        person.user_id = v_feishu_user
        OR person.principal_id = v_feishu_principal
        OR (person.identity_scope = 'feishu-job-roster' AND person.person_key = p_open_id)
      )
  ) THEN
    RETURN 'already-split';
  END IF;
  v_linked := backend_identity.bind_feishu_subject(p_open_id, v_binding);
  IF v_linked = 'inserted' THEN RETURN 'attached'; END IF;
  IF v_linked = 'same' THEN RETURN 'already-attached'; END IF;
  IF v_linked = 'conflict' THEN RETURN 'already-split'; END IF;
  RETURN 'login-invalid';
END $$;

REVOKE ALL ON FUNCTION backend_identity.bind_feishu_subject(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION backend_identity.establish_feishu_login(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION backend_identity.attach_feishu_login(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.establish_feishu_login(TEXT, TEXT) TO app_backend_auth;
GRANT EXECUTE ON FUNCTION backend_identity.attach_feishu_login(TEXT, TEXT) TO intake_business;

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
    v_checked, v_checked + interval '5 minutes', v_digest
  );
  RETURN 'registered';
END $$;
