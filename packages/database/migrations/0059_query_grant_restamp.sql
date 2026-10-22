-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0059_query_grant_restamp; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- A query grant names the policy and store set current when it was written, and
-- `authorization_sources` compares both with the live values. The approved set advances
-- whenever the roster projection sees a different release lineage, so every query grant
-- written before that moment goes stale on a value nobody can see.
--
-- The roster path already repairs its own grants: it revokes the stale rows and inserts fresh
-- ones stamped with the new version. A grant written through the permission page carried an
-- operator reason and a different issuer, so it matched neither half of that filter and was
-- left behind. Measured before this migration: the source stayed approved, the set advanced,
-- and `authorization_sources` returned zero rows while the grant list still showed the grant.
--
-- The invariant belongs to the store set, not to whoever advances it, so it is enforced with a
-- trigger on the pointer. Every live manual query grant is re-stamped when its source is still
-- a member of the new set, and revoked when it is not. Roster-issued grants are skipped
-- because that path owns them and would otherwise be maintained twice.
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- `store_set_version` and `policy_version` are approval stamps, not identity. They may move
-- when the approved set moves; scope, source, action, recipient and issuer stay frozen. This
-- grants no new authority: `authorization_sources` only accepts a stamp whose version really
-- contains the grant's source, so a rewritten stamp still cannot authorize a source that left
-- the set.
CREATE OR REPLACE FUNCTION content_intake.grant_version_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE
  frozen TEXT[] := ARRAY['version', 'revoked_at', 'steward_id', 'last_change_reason'];
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_HISTORY_REQUIRED'; END IF;
  IF NEW.kind='business' AND NEW.action='query' THEN
    frozen := frozen || ARRAY['policy_version', 'store_set_version'];
  END IF;
  IF NEW.version<>OLD.version+1 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (to_jsonb(NEW)-frozen) IS DISTINCT FROM (to_jsonb(OLD)-frozen) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_VERSION_OR_IDENTITY_CHANGED';
  END IF;
  -- A steward that was cleared stays cleared. Without this, any writer holding the column
  -- privilege could undo a delegation revocation by putting the steward back.
  IF OLD.steward_id IS NULL AND NEW.steward_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_STEWARD_RESTORE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;

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

  WITH live AS (
    SELECT grant_row.grant_id, grant_row.recipient_id, grant_row.scope_id, grant_row.source_id
    FROM content_intake.grants grant_row
    WHERE grant_row.tenant_id = NEW.tenant_id AND grant_row.app_id = NEW.app_id
      AND grant_row.kind = 'business' AND grant_row.action = 'query'
      AND grant_row.revoked_at IS NULL AND grant_row.expires_at > v_now
      AND grant_row.store_set_version IS DISTINCT FROM NEW.version
      -- The roster projection revokes and re-issues its own rows. Maintaining them here as well
      -- would fight it on every roster change.
      AND grant_row.issuer_id IS DISTINCT FROM v_roster_issuer
  ), member AS (
    SELECT live.grant_id
    FROM live
    WHERE EXISTS (
      SELECT 1 FROM content_intake.store_set_members member_row
      WHERE member_row.tenant_id = NEW.tenant_id AND member_row.app_id = NEW.app_id
        AND member_row.version = NEW.version
        AND member_row.scope_id = live.scope_id AND member_row.source_id = live.source_id
    )
  ), restamped AS (
    UPDATE content_intake.grants grant_row
    SET version = grant_row.version + 1,
        last_change_reason = '存储集变更。',
        policy_version = COALESCE(v_policy, grant_row.policy_version),
        store_set_version = NEW.version
    FROM member
    WHERE grant_row.grant_id = member.grant_id
    RETURNING grant_row.grant_id
  )
  UPDATE content_intake.grants grant_row
  SET version = grant_row.version + 1,
      last_change_reason = '存储集变更。',
      revoked_at = v_now
  FROM live
  WHERE grant_row.grant_id = live.grant_id
    AND NOT EXISTS (SELECT 1 FROM member WHERE member.grant_id = live.grant_id);
  -- `revocation_generation` is deliberately untouched. A restamp changes no authority, and
  -- bumping the counter would invalidate every issued entitlement lease through the equality
  -- join in `read_sop_release_assets`. A withdrawn grant already fails that function's own
  -- `authorization_deadline` check, so the counter buys nothing here.
  RETURN NULL;
END;
$$;

CREATE TRIGGER restamp_query_grants
  AFTER INSERT OR UPDATE OF version ON content_intake.store_set_current
  FOR EACH ROW EXECUTE FUNCTION content_intake.restamp_query_grants();

ALTER FUNCTION content_intake.restamp_query_grants() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.restamp_query_grants() FROM PUBLIC;
-- The approval stamps are the only columns the guard now lets move, and no login role holds
-- column UPDATE on them: `intake_business` is limited to version, last_change_reason,
-- steward_id and revoked_at. So this grant does not hand a session the ability to restamp; it
-- lets the definer-owned maintenance function do the one write the invariant requires.
GRANT INSERT ON content_intake.grant_history TO cs_ai_definer;
GRANT SELECT ON content_intake.grants, content_intake.store_set_members, content_intake.policy_versions
  TO cs_ai_definer;
GRANT UPDATE (version, last_change_reason, revoked_at, policy_version, store_set_version)
  ON content_intake.grants TO cs_ai_definer;
