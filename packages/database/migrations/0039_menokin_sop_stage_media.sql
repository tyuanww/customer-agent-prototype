-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0039_menokin_sop_stage_media; source Stage SOP image metadata without storing bytes
-- contract_set_id=cs-ai-c11-openapi-1.23.0-schema-1.26-c08bfcadf94d
-- source_git_sha=c08bfcadf94d274d5b871c6f122848919340c769
-- source_schema_sha256=1c0a4e508ea0aab97d40abff4829ea5a0ce65882ad6a044187fc231872bbe39c
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- Record SOP image metadata for an unused candidate row. Image bytes stay out of the database.

CREATE FUNCTION content_intake.stage_sop_candidate_media(
  p_candidate_id content_intake.identifier,
  p_version content_intake.version,
  p_source_id content_intake.identifier,
  p_actor_id content_intake.identifier,
  p_media_object_id content_intake.identifier,
  p_sha256 content_intake.sha256,
  p_bytes bigint,
  p_mime text,
  p_sheet text,
  p_row integer,
  p_column integer,
  p_ordinal integer
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = content_intake, public, pg_temp
AS $$
DECLARE
  v_state text;
  v_row_id text := 'sop:' || p_sheet || ':' || p_row::text;
BEGIN
  SELECT state INTO v_state
  FROM content_intake.candidate_versions
  WHERE candidate_id = p_candidate_id AND version = p_version AND source_id = p_source_id;
  IF NOT FOUND OR v_state IN ('published','publishing') THEN
    RAISE EXCEPTION 'SOP_ROW_IN_USE';
  END IF;
  INSERT INTO content_intake.sop_media_objects (media_object_id, source_id, actor_id, sha256, bytes, mime, state, created_at)
  VALUES (p_media_object_id, p_source_id, p_actor_id, p_sha256, p_bytes, p_mime, 'staged', clock_timestamp())
  ON CONFLICT (media_object_id) DO NOTHING;
  INSERT INTO content_intake.sop_candidate_media (
    candidate_id, candidate_version, source_id, media_object_id, sheet_name, row_number, column_number, row_id, ordinal, sha256, mime, bytes
  ) VALUES (
    p_candidate_id, p_version, p_source_id, p_media_object_id, p_sheet, p_row, p_column, v_row_id, p_ordinal, p_sha256, p_mime, p_bytes
  ) ON CONFLICT (candidate_id, candidate_version, media_object_id, ordinal) DO NOTHING;
END;
$$;

ALTER FUNCTION content_intake.stage_sop_candidate_media(
  content_intake.identifier, content_intake.version, content_intake.identifier, content_intake.identifier,
  content_intake.identifier, content_intake.sha256, bigint, text, text, integer, integer, integer
) OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.stage_sop_candidate_media(
  content_intake.identifier, content_intake.version, content_intake.identifier, content_intake.identifier,
  content_intake.identifier, content_intake.sha256, bigint, text, text, integer, integer, integer
) FROM PUBLIC;
