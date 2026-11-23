-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0091_sop_entry_stop_batch; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=db6ba13d4780a3abb1558e8673e016f7bfb5604e
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
CREATE OR REPLACE FUNCTION content_intake.sop_active_entry_disabled() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE stopped_sources text[];
BEGIN
  -- Inherited lineage can name older candidates. Match each inserted entry
  -- against its own candidate version and expand that material once.
  WITH inserted_candidates AS (
    SELECT DISTINCT candidate_id, candidate_version FROM inserted_lineage
  ), disabled_entries AS MATERIALIZED (
    SELECT c.candidate_id, c.version, entry->>'businessEntryId' AS business_entry_id
    FROM inserted_candidates i
    JOIN content_intake.candidate_versions c ON (c.candidate_id,c.version)=(i.candidate_id,i.candidate_version)
    CROSS JOIN LATERAL jsonb_array_elements(c.material->'entries') entry
    WHERE entry->>'operation'='disable'
  )
  SELECT ARRAY(
    SELECT DISTINCT i.source_id FROM inserted_lineage i
    JOIN disabled_entries d
      ON (i.candidate_id,i.candidate_version,i.business_entry_id)=(d.candidate_id,d.version,d.business_entry_id)
  ) INTO stopped_sources;

  IF cardinality(stopped_sources)>0 THEN
    PERFORM content_intake.terminate_sop_active_uses(ARRAY(
      SELECT continuation_hash FROM content_intake.sop_active_uses
      WHERE source_id=ANY(stopped_sources) AND closed_at IS NULL
        AND content_intake.sop_active_crossed_stop(continuation_hash)
    ),'content-disabled');
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE TRIGGER sop_active_entry_stop AFTER INSERT ON content_intake.release_lineage
  REFERENCING NEW TABLE AS inserted_lineage
  FOR EACH STATEMENT EXECUTE FUNCTION content_intake.sop_active_entry_disabled();
