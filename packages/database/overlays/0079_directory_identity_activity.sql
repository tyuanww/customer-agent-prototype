SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE FUNCTION content_intake.principal_has_new_identity_activity(p_principal_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  -- Older sessions belong to the reviewed test identities; later activity may be reuse.
  WITH reviewed AS (SELECT TIMESTAMPTZ '2026-10-29 12:32:28+00' AS cutoff)
  SELECT EXISTS (
    SELECT 1
    FROM content_intake.principals person
    JOIN backend_identity.subject_bindings binding ON binding.user_id = person.user_id
    CROSS JOIN reviewed
    WHERE person.principal_id = p_principal_id
      AND (
        EXISTS (SELECT 1 FROM backend_identity.feishu_login_links link WHERE link.binding_id = binding.binding_id)
        OR EXISTS (SELECT 1 FROM backend_identity.sessions session
          WHERE session.binding_id = binding.binding_id
            AND session.issued_at > reviewed.cutoff)
        OR EXISTS (SELECT 1 FROM backend_identity.login_requests login
          WHERE login.binding_id = binding.binding_id AND login.status IN ('ready', 'consumed')
            AND coalesce(login.consumed_at, login.exchange_started_at, login.issued_at) > reviewed.cutoff)
        OR EXISTS (SELECT 1 FROM intake_organization.bindings organization
          WHERE organization.principal_id = person.principal_id)
      )
  );
$$;

REVOKE ALL ON FUNCTION content_intake.principal_has_new_identity_activity(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.principal_has_new_identity_activity(TEXT) TO intake_business;
