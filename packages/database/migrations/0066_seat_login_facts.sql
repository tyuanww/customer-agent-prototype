-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0066_seat_login_facts; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- Seats: the post is a stored assignment, and login materialises facts from it.
--
-- A seat used to be created by the desktop app writing `subject_bindings`, a principal, a
-- facts row and a `role_rules` row. The facts row expires in five minutes and nothing renewed
-- it, so a seat could query for five minutes and then stopped. The roster timer could not help:
-- it re-reads Feishu, and a seat has no Feishu identity.
--
-- The fix records what the operator assigned, not what the credential claims. `seat_posts`
-- holds the department and job chosen when the seat was created, so a password login can write
-- a five-minute facts row from that record. A demoted seat loses its reach at the next login
-- because the record changed, which a credential-derived fact could never express.
SET LOCAL search_path = public, pg_catalog, pg_temp;

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

-- No immutability trigger: a post is current configuration, not history. The operator may
-- change it, and a change must take effect rather than require a migration.
REVOKE ALL ON content_intake.seat_posts FROM PUBLIC;

-- Writes the five-minute facts row a seat needs, from its stored post. Returns the same
-- vocabulary the roster projection uses so callers log one set of reasons.
--
-- `enabled` is true because the assignment exists; a disabled seat is expressed by disabling
-- its subject binding, which this function requires.
CREATE OR REPLACE FUNCTION content_intake.project_seat_login(p_binding_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  v_principal content_intake.principals%ROWTYPE;
  v_post content_intake.seat_posts%ROWTYPE;
  v_checked TIMESTAMPTZ;
  v_digest TEXT;
BEGIN
  IF p_binding_id IS NULL OR length(p_binding_id) < 1 OR length(p_binding_id) > 128 THEN
    RETURN 'missing';
  END IF;

  SELECT person.* INTO v_principal
    FROM backend_identity.subject_bindings binding
    JOIN content_intake.principals person ON person.user_id = binding.user_id
   WHERE binding.binding_id = p_binding_id AND binding.enabled
   LIMIT 1;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  SELECT post.* INTO v_post
    FROM content_intake.seat_posts post
   WHERE post.principal_id = v_principal.principal_id
     AND post.tenant_id = v_principal.tenant_id
     AND post.app_id = v_principal.app_id;
  IF NOT FOUND THEN RETURN 'missing'; END IF;

  -- A post whose role rule was never configured must not produce facts: the facts would be
  -- live while every authorization still resolves to no role, which reads as a broken seat.
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules rule
     WHERE rule.tenant_id = v_post.tenant_id AND rule.app_id = v_post.app_id
       AND rule.department_id = v_post.department_id AND rule.job_id = v_post.job_id
  ) THEN
    RETURN 'policy-pending';
  END IF;

  v_checked := clock_timestamp();
  v_digest := encode(sha256(convert_to(
    v_principal.principal_id || v_post.department_id || v_post.job_id, 'UTF8')), 'hex');

  WITH versioned AS (
    UPDATE content_intake.principals AS person
       SET current_facts_version = person.current_facts_version + 1
     WHERE person.principal_id = v_principal.principal_id
    RETURNING person.principal_id, person.current_facts_version
  )
  INSERT INTO content_intake.principal_facts (
    principal_id, facts_version, department_ids, job_id, enabled, checked_at, valid_until, facts_digest
  )
  SELECT versioned.principal_id, versioned.current_facts_version,
         ARRAY[v_post.department_id], v_post.job_id, true,
         v_checked, v_checked + interval '5 minutes', v_digest
    FROM versioned;

  RETURN 'projected';
END $$;

ALTER FUNCTION content_intake.project_seat_login(TEXT) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.project_seat_login(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.project_seat_login(TEXT) TO app_backend_auth;

-- Who may create, reset and disable a seat.
--
-- Creating a seat without the power to grant it anything produces an account that can log in
-- and do nothing, so seat administration is granted to whoever can hand out `query`: a live
-- root allocation for that action, and at least one source they could actually delegate. Both
-- halves are required because `authorization_sources` reads business grants only, so an
-- allocation alone delegates nothing.
CREATE OR REPLACE FUNCTION content_intake.may_administer_seats(p_principal_id TEXT, p_at TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
      FROM content_intake.principals person
      JOIN content_intake.principal_facts facts
        ON facts.principal_id = person.principal_id
       AND facts.facts_version = person.current_facts_version
     WHERE person.principal_id = p_principal_id
       AND facts.enabled
       AND facts.checked_at <= p_at
       AND p_at < facts.valid_until
       AND EXISTS (
         SELECT 1 FROM content_intake.grants root
          WHERE root.recipient_id = person.principal_id
            AND root.kind = 'allocation'
            AND root.action = 'query'
            AND root.revoked_at IS NULL
            AND root.steward_id IS NOT NULL
            AND root.starts_at <= p_at
            AND p_at < root.expires_at)
       AND EXISTS (
         SELECT 1 FROM content_intake.authorization_sources(person.principal_id, 'query', p_at))
  )
$$;

ALTER FUNCTION content_intake.may_administer_seats(TEXT, TIMESTAMPTZ) OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.may_administer_seats(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.may_administer_seats(TEXT, TIMESTAMPTZ)
  TO intake_business, intake_usage, app_backend_auth;
