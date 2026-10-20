-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0046_project_feishu_roster; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Login registers one matched person and fresh facts.
-- Role rules and grants already exist or are issued elsewhere.
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

REVOKE ALL ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_feishu_roster(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT, TEXT[]
) TO intake_business;
