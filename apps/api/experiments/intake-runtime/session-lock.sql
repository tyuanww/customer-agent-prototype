-- OFFLINE SYNTHETIC CANDIDATE ONLY. Not a migration, not runtime bootstrap.
-- The test owner installs this into a disposable PG15 database after migrations.
-- Formal adoption needs identity-owner review and a versioned contract intake.
CREATE SCHEMA intake_runtime_probe;
REVOKE ALL ON SCHEMA intake_runtime_probe FROM PUBLIC;

-- The caller supplies the authenticated module's private session hash and user,
-- never renderer data. No identity rows, token hashes or mutable capabilities are
-- returned. Locks remain held until the caller's transaction ends, serializing
-- session revocation and subject disable with its business transaction.
CREATE FUNCTION intake_runtime_probe.lock_product_session(p_hash TEXT, p_user TEXT)
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
REVOKE ALL ON FUNCTION intake_runtime_probe.lock_product_session(TEXT,TEXT) FROM PUBLIC;
