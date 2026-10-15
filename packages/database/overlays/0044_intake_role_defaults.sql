-- Default upload and publish authority for the customer-service posts and the engineer lane.
-- Does not delete grant rows. Does not edit the frozen 0030 or 0043 bytes.
-- A business import grant may omit a parent row only when the issuer's single
-- current role is director, manager, or engineer. Supervisor cannot grant.
SET LOCAL search_path = public, pg_catalog, pg_temp;

ALTER TABLE content_intake.role_rules DROP CONSTRAINT role_rules_role_check;
ALTER TABLE content_intake.role_rules ADD CONSTRAINT role_rules_role_check
  CHECK (role IN ('agent','enabler','lead','supervisor','manager','director','engineer'));

DO $$
DECLARE cname text;
BEGIN
  SELECT con.conname INTO cname
  FROM pg_constraint con
  WHERE con.conrelid = 'content_intake.grants'::regclass
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) LIKE '%parent_grant_id IS NOT NULL%';
  IF cname IS NULL THEN
    RAISE EXCEPTION 'parent grant check missing';
  END IF;
  EXECUTE format('ALTER TABLE content_intake.grants DROP CONSTRAINT %I', cname);
END $$;

CREATE OR REPLACE FUNCTION content_intake.grant_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent content_intake.grants;
DECLARE allowed boolean;
BEGIN
  IF NEW.parent_grant_id IS NULL THEN
    IF NEW.kind = 'allocation' THEN RETURN NEW; END IF;
    IF NEW.kind = 'business' AND NEW.action = 'import' THEN
      SELECT count(DISTINCT r.role) = 1 AND min(r.role) IN ('director','manager','engineer') INTO allowed
      FROM content_intake.principals p
      JOIN content_intake.principal_facts f
        ON f.principal_id = p.principal_id AND f.facts_version = p.current_facts_version
      JOIN content_intake.role_rules r
        ON r.tenant_id = p.tenant_id AND r.app_id = p.app_id
       AND r.department_id = ANY(f.department_ids) AND r.job_id = f.job_id
      WHERE p.principal_id = NEW.issuer_id AND f.enabled;
      IF allowed THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  SELECT * INTO STRICT parent FROM content_intake.grants WHERE grant_id=NEW.parent_grant_id;
  IF parent.recipient_id<>NEW.issuer_id OR parent.tenant_id<>NEW.tenant_id OR parent.app_id<>NEW.app_id OR parent.scope_id<>NEW.scope_id
    OR parent.action<>NEW.action OR (parent.source_id IS NOT NULL AND parent.source_id IS DISTINCT FROM NEW.source_id)
    OR parent.starts_at>NEW.starts_at OR parent.expires_at<NEW.expires_at OR parent.revoked_at IS NOT NULL
    OR NOT ((NEW.kind='business' AND parent.kind IN ('allocation','delegation')) OR (NEW.kind='delegation' AND parent.kind='allocation')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
  SELECT COALESCE(
    (SELECT least(f.valid_until, max(g.expires_at))
     FROM content_intake.principals p
     JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
     JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
     JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
       AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
       AND (g.source_id IS NULL OR g.source_id=p_source) AND g.starts_at<=p_at AND p_at<g.expires_at
     JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
       AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
     WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
       AND EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.source_id=p_source AND src.scope_id=s.scope_id)
     GROUP BY f.valid_until
     HAVING count(DISTINCT r.role)=1
       AND (min(r.role) IN ('director','manager','supervisor','lead','engineer')
         OR (min(r.role) IN ('agent','enabler') AND p_action='query'))),
    (SELECT min(f.valid_until)
     FROM content_intake.principals p
     JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
     JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
     JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
       AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
     WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
       AND EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.source_id=p_source AND src.scope_id=s.scope_id)
     GROUP BY p.principal_id
     HAVING count(DISTINCT r.role)=1
       AND ((min(r.role) IN ('director','manager','supervisor') AND p_action IN ('import','publish'))
         OR min(r.role)='engineer'))
  )
$$;
