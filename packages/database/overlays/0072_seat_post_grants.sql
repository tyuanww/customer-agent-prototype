SET LOCAL search_path = public, pg_catalog, pg_temp;

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
    v_checked, v_checked + interval '5 minutes', v_digest);

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
