-- Advancing the policy version silently invalidated every manual query grant.
--
-- `authorization_sources` and `authorization_deadline` compare a grant's `policy_version` with
-- the live value. `role_rules` carries `role_history`, which calls `record_policy_history`, which
-- increments `policy_versions.version` on any insert, update or delete. So a change to a role
-- rule — adding a job, adjusting a ceiling, creating a seat — moved the live version and left
-- every already-stamped manual query grant pointing at the old one. Those grants stopped
-- authorizing anything and nothing repaired them: the roster path re-issues only rows it signed
-- itself (`issue_roster_query` revokes on a stamp mismatch and writes its own), so a grant made
-- by an operator through `/v1/intake/grants` stayed dead permanently.
--
-- Measured on production: one inserted role_rules row moved the version from 30 to 31 and
-- dropped the operator's own `authorization_sources` from 2 rows to 0. Because the seat
-- administration gate itself requires a non-empty source set, the first seat created would have
-- locked the operator out of granting anything afterwards.
--
-- The invariant belongs to the policy pointer, not to whoever advances it, exactly as 0059
-- argues for the store set. Enforcing it on the pointer covers every writer: a role rule, a
-- policy admin edit, or a future path that nobody has written yet.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.restamp_query_grants_for_policy() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
  -- Same structural discriminator 0059 uses. Matching on the reason sentence would let an
  -- operator type the reserved wording and freeze their own grant out of this repair forever.
  v_roster_issuer TEXT := left('sys_query_' || encode(
    pg_catalog.sha256(pg_catalog.convert_to(NEW.tenant_id || ':' || NEW.app_id, 'UTF8')), 'hex'), 72);
BEGIN
  -- Only manual grants. The roster path revokes and re-issues its own rows on the next
  -- projection, which runs every four minutes, so repairing them here would fight it and would
  -- also re-stamp rows that projection is about to replace.
  UPDATE content_intake.grants grant_row
     SET version = grant_row.version + 1,
         last_change_reason = '策略版本变更。',
         policy_version = NEW.version
   WHERE grant_row.tenant_id = NEW.tenant_id
     AND grant_row.app_id = NEW.app_id
     AND grant_row.kind = 'business'
     AND grant_row.action = 'query'
     AND grant_row.revoked_at IS NULL
     AND grant_row.expires_at > v_now
     AND grant_row.policy_version IS DISTINCT FROM NEW.version
     AND grant_row.issuer_id IS DISTINCT FROM v_roster_issuer;
  -- `revocation_generation` is deliberately untouched, for the reason 0059 records: a restamp
  -- moves no authority, and bumping the counter would invalidate every issued entitlement lease
  -- through the equality join in `read_sop_release_assets`. `expires_at`, `scope_id`,
  -- `source_id`, `recipient_id` and `issuer_id` stay frozen by `grant_version_guard`, so a
  -- rewritten stamp cannot authorize a source the grant never covered.
  RETURN NULL;
END;
$$;

CREATE TRIGGER restamp_query_grants_for_policy
  AFTER UPDATE OF version ON content_intake.policy_versions
  FOR EACH ROW EXECUTE FUNCTION content_intake.restamp_query_grants_for_policy();

ALTER FUNCTION content_intake.restamp_query_grants_for_policy() OWNER TO cs_ai_definer;
REVOKE ALL ON FUNCTION content_intake.restamp_query_grants_for_policy() FROM PUBLIC;

-- No GRANT block. 0059 already gives cs_ai_definer exactly what this function writes: column
-- UPDATE on the approval stamps, INSERT on grant_history, and SELECT on grants. Repeating them
-- here would be two statements of one rule, and the measured ACL manifest confirmed it: the
-- count stayed at 641 with these lines present, which is how the duplication was found.
