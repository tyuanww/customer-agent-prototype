-- 0062_store_set_authority_retention; product overlay (not a frozen contract snapshot slice)

SET LOCAL search_path = public, pg_catalog, pg_temp;

-- An empty readable set is legitimate for a tenant that has never published, but it must not
-- replace a set that still holds members. Every grant stamped on the previous version stops
-- authorizing the moment the current version moves, so promoting an empty version takes
-- upload and publish away in the middle of the operator's work. Returning NULL from a BEFORE
-- UPDATE trigger skips the promotion and leaves the caller on the set it already had, which
-- lets issue_roster_query continue instead of raising through the login path.
CREATE OR REPLACE FUNCTION content_intake.store_set_keep_members() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.version IS NOT DISTINCT FROM OLD.version THEN RETURN NEW; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.store_set_members next
    WHERE next.tenant_id = NEW.tenant_id AND next.app_id = NEW.app_id AND next.version = NEW.version
  ) AND EXISTS (
    SELECT 1 FROM content_intake.store_set_members held
    WHERE held.tenant_id = OLD.tenant_id AND held.app_id = OLD.app_id AND held.version = OLD.version
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS store_set_keep_members ON content_intake.store_set_current;
CREATE TRIGGER store_set_keep_members BEFORE UPDATE OF version ON content_intake.store_set_current
  FOR EACH ROW EXECUTE FUNCTION content_intake.store_set_keep_members();

-- restamp_query_grants used to write revoked_at for a grant whose source left the set. That is
-- irreversible: no later advance clears it, so a republished source never becomes readable
-- again and the operator has to be granted by hand. Membership is already the authority
-- condition, because authorization_deadline compares store_set_version with the current
-- version, so moving the stamp forward for members and leaving everyone else untouched is
-- enough. A source that returns to the set is picked up by the next advance.
CREATE OR REPLACE FUNCTION content_intake.restamp_query_grants() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_policy content_intake.version;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  -- The roster signer is derived from the tenant and app, so it identifies roster-issued rows
  -- structurally. Discriminating on the reason text instead would let an operator type the
  -- reserved sentence and freeze their own grant out of this path forever.
  v_roster_issuer TEXT := left('sys_query_' || encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW.tenant_id || ':' || NEW.app_id, 'UTF8')), 'hex'), 72);
BEGIN
  SELECT version INTO v_policy FROM content_intake.policy_versions
    WHERE tenant_id = NEW.tenant_id AND app_id = NEW.app_id;

  UPDATE content_intake.grants grant_row
  SET version = grant_row.version + 1,
      last_change_reason = '存储集变更。',
      store_set_version = NEW.version,
      policy_version = COALESCE(v_policy, grant_row.policy_version)
  FROM content_intake.grants live
  WHERE grant_row.grant_id = live.grant_id
    AND live.tenant_id = NEW.tenant_id AND live.app_id = NEW.app_id
    AND live.kind = 'business' AND live.action = 'query'
    AND live.revoked_at IS NULL AND live.expires_at > v_now
    AND live.store_set_version IS DISTINCT FROM NEW.version
    AND live.issuer_id IS DISTINCT FROM v_roster_issuer
    AND EXISTS (
      SELECT 1 FROM content_intake.store_set_members member_row
      WHERE member_row.tenant_id = NEW.tenant_id AND member_row.app_id = NEW.app_id
        AND member_row.version = NEW.version
        AND member_row.scope_id = live.scope_id AND member_row.source_id = live.source_id
    );
  RETURN NULL;
END;
$$;
