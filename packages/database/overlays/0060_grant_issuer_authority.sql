-- `grant_parent_guard` compares the child against its parent and nothing else. It trusts that
-- whoever inserted the row went through `createGrants`, which checks that the issuer still
-- holds authority for the action. A writer holding INSERT on `grants` skips that check: anyone
-- who knows a live delegation can insert a child under it and hand out authority the issuer no
-- longer has.
--
-- This is the same shape as the steward rewrite: the product writer enforces a rule that the
-- table itself does not. Moving the rule into the guard closes it for every caller, including
-- the ones that never go through the API.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.grant_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent content_intake.grants;
BEGIN
  IF NEW.parent_grant_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT parent FROM content_intake.grants WHERE grant_id=NEW.parent_grant_id;
  IF parent.recipient_id<>NEW.issuer_id OR parent.tenant_id<>NEW.tenant_id OR parent.app_id<>NEW.app_id OR parent.scope_id<>NEW.scope_id
    OR parent.action<>NEW.action OR (parent.source_id IS NOT NULL AND parent.source_id IS DISTINCT FROM NEW.source_id)
    OR parent.starts_at>NEW.starts_at OR parent.expires_at<NEW.expires_at OR parent.revoked_at IS NOT NULL
    OR NOT ((NEW.kind='business' AND parent.kind IN ('allocation','delegation')) OR (NEW.kind='delegation' AND parent.kind='allocation')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  -- The parent proves the issuer was once given this action in this scope. What the row cannot
  -- show is whether the issuer still qualifies: a facts window that closed, a disable, or a
  -- demotion leaves the parent live while the issuer may no longer decide anything. Checking
  -- qualification here covers every writer, including one that never calls `createGrants`.
  IF NOT EXISTS (
    SELECT 1
    FROM content_intake.principals p
    JOIN content_intake.principal_facts f
      ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
    WHERE p.principal_id = NEW.issuer_id
      AND f.enabled
      AND f.checked_at <= pg_catalog.clock_timestamp()
      AND pg_catalog.clock_timestamp() < f.valid_until
      AND (
        SELECT count(DISTINCT r.role) = 1
          AND content_intake.role_allows(min(r.role), NEW.action)
        FROM content_intake.role_rules r
        WHERE r.tenant_id = NEW.tenant_id
          AND r.app_id = NEW.app_id
          AND r.department_id = ANY(f.department_ids)
          AND r.job_id = f.job_id
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_ISSUER_NOT_AUTHORIZED';
  END IF;
  RETURN NEW;
END;
$$;
