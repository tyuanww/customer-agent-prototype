-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0058_grant_steward_no_restore; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
-- `steward_id` is an authorization switch, not metadata. A parented business grant authorizes
-- only while it keeps a steward, so whoever can write that column can switch a grant back on.
-- The version guard already treats revocation as one-way: once `revoked_at` is set it can never
-- be cleared. Clearing a steward is the same kind of decision, and it was the one exception.
--
-- Measured before this migration: as `intake_business`, clearing the steward on a live child
-- dropped `authorization_sources` to 0 rows, and setting it back brought the row back, with no
-- authority check in between. That is a revocation the holder of the column can undo.
--
-- The fix is the existing rule, applied to the second switch: a cleared steward cannot be
-- restored. Re-granting access is a new grant, which is what the operator sees as a new row.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE OR REPLACE FUNCTION content_intake.grant_version_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_HISTORY_REQUIRED'; END IF;
  IF NEW.version<>OLD.version+1 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (to_jsonb(NEW)-ARRAY['version','revoked_at','steward_id','last_change_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','revoked_at','steward_id','last_change_reason']) THEN
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
