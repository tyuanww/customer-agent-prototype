-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0068_seat_lifecycle; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Seat lifecycle as a privileged owner. Replaces the desktop path that connected as the cluster
-- owner to a local synthetic database.
--
-- Why a function and not grants. Production gives INSERT on `backend_identity.subject_bindings`
-- and `content_intake.role_rules` to the cluster owner alone; every capability role holds SELECT.
-- That is deliberate. Granting a capability role those writes would put identity creation in the
-- hands of any session that passes the seat-administration check, and that check reads business
-- grants, not identity authority.
--
-- The shape follows `backend_identity.admit_feishu_agent` (0045), which already creates identity
-- rows in production: a SECURITY DEFINER function, format validation before use, and EXECUTE
-- granted to exactly one role. Two things differ because a seat is chosen rather than discovered:
--
--   * `admit_feishu_agent` hardcodes role 'agent'. A seat has two possible posts, so the post is
--     validated against a closed set here and the role it implies is checked against
--     `content_intake.role_ceiling`, the SQL owner of that boundary.
--   * Every identity field is derived here. The caller supplies a username, a display name and a
--     post; it never supplies a binding id, user id, principal id, session role, business role or
--     job id. That is what keeps the EXECUTE grant narrow.
--
-- Owner stays the cluster owner, matching `admit_feishu_agent`. Owning as `cs_ai_definer` would
-- mean granting that role INSERT on `subject_bindings` and `role_rules`, which would widen every
-- other function it already owns. No other function is owned by the cluster owner, so this is the
-- narrower blast radius.
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- The post a seat was created with, as an assignment rather than a credential claim. Login reads
-- it to write the five-minute facts row, so a seat survives past five minutes without anything
-- ever inferring a job from the password.
--
-- No immutability trigger: a post is current configuration, not history. Changing it must take
-- effect, and it does, at the next login.
CREATE TABLE content_intake.seat_posts (
  principal_id content_intake.identifier PRIMARY KEY,
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  department_id content_intake.identifier NOT NULL,
  job_id content_intake.identifier NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  assigned_by TEXT NOT NULL CHECK (length(assigned_by) BETWEEN 1 AND 128),
  FOREIGN KEY (principal_id, tenant_id, app_id)
    REFERENCES content_intake.principals(principal_id, tenant_id, app_id),
  CHECK (isfinite(assigned_at))
);

REVOKE ALL ON content_intake.seat_posts FROM PUBLIC;

-- The session role is the binding's own vocabulary. The business role is what the ceiling checks.
CREATE FUNCTION content_intake.seat_post_mapping(p_post TEXT)
RETURNS TABLE (out_job_id TEXT, out_role TEXT, out_session_role TEXT)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT mapping.job_id, mapping.business_role, mapping.session_role
  FROM (VALUES
    ('客服', 'job-seat', 'agent', 'agent'),
    ('客服主管', 'job-seat-supervisor', 'supervisor', 'coach')
  ) AS mapping(post, job_id, business_role, session_role)
  WHERE mapping.post = p_post
$$;

REVOKE ALL ON FUNCTION content_intake.seat_post_mapping(TEXT) FROM PUBLIC;

CREATE FUNCTION backend_identity.create_seat(
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
  -- The bound matches `subject_bindings.subject`; the control-character bound keeps a name from
  -- breaking the operator's list rendering or a log line.
  IF length(v_display) < 1 OR length(v_display) > 256 OR v_display ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_DISPLAY_NAME_INVALID';
  END IF;

  SELECT mapping.out_job_id, mapping.out_role, mapping.out_session_role
    INTO v_job, v_role, v_session_role
    FROM content_intake.seat_post_mapping(p_post) AS mapping;
  IF v_job IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_POST_INVALID';
  END IF;

  -- The ceiling table owns this boundary. Checking it here means a post cannot outlive its role:
  -- if the ceiling row is removed, creation stops rather than writing facts that authorization
  -- will never resolve.
  IF NOT EXISTS (SELECT 1 FROM content_intake.role_ceiling WHERE role = v_role) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_ROLE_NOT_IN_CEILING';
  END IF;

  IF p_tenant_id IS NULL OR p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_app_id IS NULL OR p_app_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_department_id IS NULL OR p_department_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
    OR p_assigned_by IS NULL OR length(btrim(p_assigned_by)) < 1 OR length(p_assigned_by) > 128 THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_HOME_INVALID';
  END IF;

  -- A home without a policy row has no version to stamp, and `role_rules.policy_version` is NOT
  -- NULL. Failing here names the cause instead of surfacing a constraint violation.
  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = p_tenant_id AND app_id = p_app_id;
  IF v_policy IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_HOME_UNKNOWN';
  END IF;

  -- Namespaced away from the built-in synthetic identities. `synthetic_owner` resolves to the
  -- principal holding the root allocations, so a path that could address it by name would be a
  -- path to set that account's password.
  v_binding := 'synthetic_seat_' || p_username;
  v_user := left('usr_seat_' || encode(sha256(convert_to(p_username, 'UTF8')), 'hex'), 40);
  v_principal := 'seat_' || p_username;

  IF EXISTS (SELECT 1 FROM backend_identity.subject_bindings WHERE binding_id = v_binding) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SEAT_EXISTS';
  END IF;
  -- `subject_bindings` is UNIQUE (provider, tenant, subject). Two people with the same name would
  -- otherwise surface as a constraint violation dressed up as an internal error.
  IF EXISTS (
    SELECT 1 FROM backend_identity.subject_bindings
     WHERE provider = 'synthetic' AND tenant = p_tenant_id AND subject = v_display
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SEAT_DISPLAY_NAME_TAKEN';
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

  -- The rule is shared by every seat on the same post, so a conflict is the normal case rather
  -- than an error. This write moves `policy_versions` through `role_history`; 0066 re-stamps the
  -- manual query grants that the move would otherwise silently invalidate.
  INSERT INTO content_intake.role_rules(
    tenant_id, app_id, department_id, job_id, policy_version, role)
  VALUES (p_tenant_id, p_app_id, p_department_id, v_job, v_policy, v_role)
  ON CONFLICT (tenant_id, app_id, department_id, job_id) DO NOTHING;

  -- First facts row, so `principal_current_facts_fk` holds at COMMIT. Derived from the stored
  -- assignment, which is the same source login reads.
  v_digest := encode(sha256(convert_to(v_principal || p_department_id || v_job, 'UTF8')), 'hex');
  INSERT INTO content_intake.principal_facts(
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest)
  VALUES (v_principal, 1, ARRAY[p_department_id], v_job, true,
    v_checked, v_checked + interval '5 minutes', v_digest);

  RETURN QUERY SELECT v_principal, v_binding, v_user, v_job, v_role;
END $$;

REVOKE ALL ON FUNCTION backend_identity.create_seat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.create_seat(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO intake_business;

-- The operator's seat list. A definer read for the same reason as the write: a capability role
-- holds no column grant on `subject`, and adding one would be a grant on `subject_bindings`.
CREATE FUNCTION backend_identity.list_seats(p_tenant_id TEXT, p_app_id TEXT)
RETURNS TABLE (
  out_username TEXT,
  out_display_name TEXT,
  out_post TEXT,
  out_enabled BOOLEAN
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT substring(binding.binding_id FROM length('synthetic_seat_') + 1),
         binding.subject,
         CASE post.job_id
           WHEN 'job-seat' THEN '客服'
           WHEN 'job-seat-supervisor' THEN '客服主管'
         END,
         binding.enabled
    FROM backend_identity.subject_bindings AS binding
    JOIN content_intake.principals AS person
      ON person.user_id = binding.user_id
     AND person.tenant_id = p_tenant_id
     AND person.app_id = p_app_id
    JOIN content_intake.seat_posts AS post
      ON post.principal_id = person.principal_id
   WHERE binding.provider = 'synthetic'
     AND binding.binding_id LIKE 'synthetic_seat_%'
     AND post.job_id IN ('job-seat', 'job-seat-supervisor')
   ORDER BY binding.binding_id
$$;

REVOKE ALL ON FUNCTION backend_identity.list_seats(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.list_seats(TEXT, TEXT) TO intake_business;

-- Disabling keeps the password entry so re-enabling the same seat does not require a reset.
-- `complete_callback` and `exchange` both require an enabled binding, so a disabled seat cannot
-- log in even with a live password.
CREATE FUNCTION backend_identity.disable_seat(
  p_username TEXT,
  p_tenant_id TEXT,
  p_app_id TEXT
) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_binding TEXT := 'synthetic_seat_' || p_username;
BEGIN
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='SEAT_USERNAME_INVALID';
  END IF;

  -- Requiring a `seat_posts` row is what keeps this function from addressing a built-in identity:
  -- only a seat has one, so `synthetic_owner` cannot be disabled through this path.
  UPDATE backend_identity.subject_bindings AS binding
     SET enabled = false
    FROM content_intake.principals AS person
    JOIN content_intake.seat_posts AS post ON post.principal_id = person.principal_id
   WHERE binding.binding_id = v_binding
     AND binding.provider = 'synthetic'
     AND person.user_id = binding.user_id
     AND person.tenant_id = p_tenant_id
     AND person.app_id = p_app_id
     AND binding.enabled;
  IF NOT FOUND THEN
    -- Already disabled is success: the caller's intent is met and a retry is safe. Anything else
    -- is a seat that does not exist in this home, which the operator has to hear about.
    IF EXISTS (
      SELECT 1 FROM backend_identity.subject_bindings AS binding
        JOIN content_intake.principals AS person ON person.user_id = binding.user_id
        JOIN content_intake.seat_posts AS post ON post.principal_id = person.principal_id
       WHERE binding.binding_id = v_binding
         AND person.tenant_id = p_tenant_id AND person.app_id = p_app_id
    ) THEN RETURN; END IF;
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SEAT_NOT_FOUND';
  END IF;
END $$;

REVOKE ALL ON FUNCTION backend_identity.disable_seat(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.disable_seat(TEXT, TEXT, TEXT) TO intake_business;

-- Renews the five-minute window a seat needs, from its stored post. Without this a seat works for
-- five minutes and then stops, which is the defect the desktop path never had to face because it
-- wrote the whole row by hand.
CREATE FUNCTION content_intake.project_seat_login(p_binding_id TEXT) RETURNS TEXT
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
         v_checked, v_checked + interval '5 minutes', v_digest
    FROM versioned;

  RETURN 'projected';
END $$;

REVOKE ALL ON FUNCTION content_intake.project_seat_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_seat_login(TEXT) TO intake_business;

-- Who may call the four seat routes. No new action: every business action a director may
-- hold, a supervisor may hold too, so an action cannot name this boundary. `role_may_allocate`
-- is the ceiling flag that is true only for director, manager and engineer, and a live
-- allocation with a steward is the same proof `parentAuthority` requires before anyone
-- may hand a grant out. `authorization_sources` is the wrong door: it reads business
-- grants, and a seat whose only grant is query would walk through it.
--
-- The API role can execute this and cannot read `grants` itself. The function is the read.
CREATE FUNCTION content_intake.seat_administration_allowed(p_user_id TEXT) RETURNS BOOLEAN
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
       AND facts.valid_until <= facts.checked_at + interval '5 minutes'
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

REVOKE ALL ON FUNCTION content_intake.seat_administration_allowed(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.seat_administration_allowed(TEXT) TO intake_business;
