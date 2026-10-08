-- DRAFT trusted transaction boundary. Global content lock must precede this call.
CREATE SCHEMA intake_runtime;
REVOKE ALL ON SCHEMA intake_runtime FROM PUBLIC;

-- The caller supplies the authenticated module's private session hash and user,
-- never renderer data. No identity rows, token hashes or mutable capabilities are
-- returned. Locks remain held until the caller's transaction ends, serializing
-- session revocation and subject disable with its business transaction.
CREATE FUNCTION intake_runtime.lock_product_session(p_hash TEXT, p_user TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE deadline TIMESTAMPTZ;
BEGIN
  IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
    OR p_user IS NULL OR length(p_user) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SESSION_UNAVAILABLE';
  END IF;
  SELECT s.expires_at INTO deadline
    FROM backend_identity.sessions s
    JOIN backend_identity.subject_bindings b USING(binding_id)
    WHERE s.token_hash=p_hash AND b.user_id=p_user AND b.enabled
      AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
    FOR SHARE OF s,b;
  -- Time can pass while waiting for a row lock. Do not return a stale deadline.
  IF deadline IS NULL OR deadline<=clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SESSION_UNAVAILABLE';
  END IF;
  RETURN deadline;
END
$$;
REVOKE ALL ON FUNCTION intake_runtime.lock_product_session(TEXT,TEXT) FROM PUBLIC;

-- Startup/checkout guard for a dedicated environment LOGIN after SET ROLE.
-- session_user is the connection identity; current_user is exactly one NOLOGIN
-- capability. This is not an authenticated end-user or a complete ACL auditor.
CREATE FUNCTION intake_runtime.assert_purpose(p_purpose TEXT) RETURNS VOID
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE expected TEXT; login_record RECORD; capability_record RECORD;
BEGIN
  expected:=CASE p_purpose WHEN 'usage' THEN 'intake_usage' WHEN 'business' THEN 'intake_business'
    WHEN 'worker' THEN 'intake_worker' WHEN 'organization' THEN 'intake_org_writer'
    WHEN 'directory-key' THEN 'intake_directory_key_operator' ELSE NULL END;
  SELECT * INTO login_record FROM pg_roles WHERE rolname=session_user;
  SELECT * INTO capability_record FROM pg_roles WHERE rolname=expected;
  IF expected IS NULL OR current_user<>expected OR session_user=current_user
    OR NOT login_record.rolcanlogin OR login_record.rolinherit OR login_record.rolsuper OR login_record.rolcreatedb
    OR login_record.rolcreaterole OR login_record.rolbypassrls OR login_record.rolreplication
    OR capability_record.rolcanlogin OR capability_record.rolinherit OR capability_record.rolsuper
    OR capability_record.rolcreatedb OR capability_record.rolcreaterole OR capability_record.rolbypassrls OR capability_record.rolreplication
    OR NOT pg_has_role(session_user,expected,'MEMBER')
    OR EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=login_record.oid
      AND (m.roleid<>capability_record.oid OR m.admin_option))
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=capability_record.oid)
    OR pg_has_role(session_user,'intake_runtime_fn_owner','MEMBER')
    OR pg_has_role(session_user,'intake_directory_fn_owner','MEMBER') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='INTAKE_RUNTIME_ROLE_BOUNDARY';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION intake_runtime.assert_purpose(TEXT) FROM PUBLIC;
GRANT USAGE ON SCHEMA intake_runtime TO intake_usage,intake_business,intake_worker,intake_org_writer,intake_directory_key_operator;
GRANT EXECUTE ON FUNCTION intake_runtime.assert_purpose(TEXT) TO intake_usage,intake_business,intake_worker,intake_org_writer,intake_directory_key_operator;
