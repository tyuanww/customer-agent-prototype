-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0034_intake_csv_v1_24; source schema.v1.24 CSV input format
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.24-adbc7b1ce251
-- source_git_sha=adbc7b1ce251816fc02957a0042742ae2d053f9a
-- source_schema_sha256=c4ceffa961728423b755b00d551b9ab67fbf33ffe1dd87d8e671f6d151f744c5
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- DRAFT schema.v1.24: exact source-format binding; no grants, registration or activation.
-- Existing immutable mappings/objects/candidates remain unchanged and are not reinterpreted.
ALTER TABLE content_intake.objects DROP CONSTRAINT objects_mime_check;
ALTER TABLE content_intake.objects DROP CONSTRAINT objects_check1;
ALTER TABLE content_intake.objects ADD CONSTRAINT objects_mime_check
  CHECK (mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv','application/pdf','application/json'));
ALTER TABLE content_intake.objects ADD CONSTRAINT objects_input_format_check
  CHECK ((purpose='input' AND bytes<=10485760 AND mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'))
    OR (purpose<>'input' AND mime<>'text/csv'));

CREATE FUNCTION content_intake.input_format_matches(p_template text,p_rule text,p_mapping text,p_structure text,p_mime text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(
    (p_template='faq-p1.1' AND p_rule='intake-p1.1' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND length(p_mapping) BETWEEN 1 AND 64 AND p_structure ~ '^[0-9a-f]{64}$')
    OR (p_template='faq-csv-v1' AND p_rule='intake-csv-v1' AND p_mapping='faq-csv-columns-v1'
      AND p_structure='daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165' AND p_mime='text/csv'),false);
$$;
CREATE FUNCTION content_intake.source_format_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT (content_intake.input_format_matches(NEW.template_version,NEW.rule_version,NEW.mapping_version,NEW.structure_digest,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    OR content_intake.input_format_matches(NEW.template_version,NEW.rule_version,NEW.mapping_version,NEW.structure_digest,'text/csv')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_FORMAT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_format BEFORE INSERT ON content_intake.source_mappings
  FOR EACH ROW EXECUTE FUNCTION content_intake.source_format_guard();

CREATE FUNCTION content_intake.input_object_format_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.purpose='input' AND NOT EXISTS (
    SELECT 1 FROM content_intake.sources s JOIN content_intake.source_mappings m
      ON m.source_id=s.source_id AND m.version=s.current_mapping_version
    WHERE s.source_id=NEW.source_id AND content_intake.input_format_matches(m.template_version,m.rule_version,m.mapping_version,m.structure_digest,NEW.mime)
  ) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_FORMAT_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER input_object_format BEFORE INSERT ON content_intake.objects
  FOR EACH ROW EXECUTE FUNCTION content_intake.input_object_format_guard();

-- Bind the captured source_version, not its later current version, so old XLSX jobs can finish.
CREATE FUNCTION content_intake.parse_format_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM content_intake.source_mappings m JOIN content_intake.objects o
    ON o.source_id=m.source_id AND o.object_id=NEW.object_id AND o.purpose='input'
    WHERE m.source_id=NEW.source_id AND m.version=NEW.source_version
      AND content_intake.input_format_matches(m.template_version,m.rule_version,m.mapping_version,m.structure_digest,o.mime)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_FORMAT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER parse_format BEFORE INSERT ON content_intake.parse_jobs
  FOR EACH ROW EXECUTE FUNCTION content_intake.parse_format_guard();

CREATE FUNCTION content_intake.candidate_format_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE m content_intake.source_mappings; o content_intake.objects;
BEGIN
  SELECT * INTO STRICT m FROM content_intake.source_mappings WHERE source_id=NEW.source_id AND version=NEW.source_version;
  SELECT * INTO STRICT o FROM content_intake.objects WHERE object_id=NEW.object_id;
  IF o.source_id IS DISTINCT FROM NEW.source_id OR o.purpose<>'input'
    OR NOT content_intake.input_format_matches(m.template_version,m.rule_version,m.mapping_version,m.structure_digest,o.mime)
    OR NEW.material->>'templateVersion' IS DISTINCT FROM m.template_version
    OR NEW.material->>'ruleVersion' IS DISTINCT FROM m.rule_version
    OR NEW.material->>'mappingVersion' IS DISTINCT FROM m.mapping_version
    OR NEW.material->>'sourceVersion' IS DISTINCT FROM m.version::text
    OR NEW.material#>>'{object,sourceId}' IS DISTINCT FROM o.source_id::text
    OR NEW.material#>>'{object,mime}' IS DISTINCT FROM o.mime
    OR NEW.material#>>'{object,bytes}' IS DISTINCT FROM o.bytes::text
    OR NEW.material->'selectedSheets' IS DISTINCT FROM (CASE WHEN o.mime='text/csv' THEN '["CSV"]'::jsonb ELSE '["来源","FAQ","相似问法"]'::jsonb END)
  THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_FORMAT_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER candidate_format BEFORE INSERT ON content_intake.candidate_versions
  FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_format_guard();
