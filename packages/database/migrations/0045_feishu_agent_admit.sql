-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0045_feishu_agent_admit; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A Feishu open id that is not yet bound becomes an agent seat.
-- An existing row, including a disabled row or the owner, is left unchanged.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION backend_identity.admit_feishu_agent(p_open_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog, public, pg_temp AS $$
DECLARE uid TEXT;
BEGIN
  IF p_open_id IS NULL OR p_open_id !~ '^ou_[A-Za-z0-9]{6,64}$' THEN
    RAISE EXCEPTION USING ERRCODE='ZA001', MESSAGE='LOGIN_INVALID';
  END IF;
  uid := left('usr_' || p_open_id, 128);
  INSERT INTO backend_identity.subject_bindings(
    binding_id, provider, tenant, subject, user_id, subject_hash, enabled, role
  ) VALUES (
    p_open_id, 'feishu', 'feishu-tenant', p_open_id, uid,
    encode(sha256(convert_to(p_open_id, 'UTF8')), 'hex'), true, 'agent'
  ) ON CONFLICT (binding_id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION backend_identity.admit_feishu_agent(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION backend_identity.admit_feishu_agent(TEXT) TO app_backend_auth;
