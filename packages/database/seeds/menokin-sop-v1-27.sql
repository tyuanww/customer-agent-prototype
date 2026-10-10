-- Approved schema.v1.27 additive delta. Immutable schema.v1.26 follows unchanged.
-- Adds the sop scope domain and unused-row deletion. No image bytes, no grants, no import.

DO $$
DECLARE constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'content_intake.scopes'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%presale%product%';
  IF constraint_name IS NULL THEN
    RAISE EXCEPTION 'SOP_DOMAIN_CONSTRAINT_MISSING';
  END IF;
  EXECUTE format('ALTER TABLE content_intake.scopes DROP CONSTRAINT %I', constraint_name);
END $$;

ALTER TABLE content_intake.scopes ADD CONSTRAINT scopes_domain_check
  CHECK (domain IN ('presale','campaign','aftersale','product','sop'));

CREATE OR REPLACE FUNCTION content_intake.input_format_matches(p_template text,p_rule text,p_mapping text,p_structure text,p_mime text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(
    (p_template='faq-p1.1' AND p_rule='intake-p1.1' AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      AND length(p_mapping) BETWEEN 1 AND 64 AND p_structure ~ '^[0-9a-f]{64}$')
    OR (p_template='faq-csv-v1' AND p_rule='intake-csv-v1' AND p_mapping='faq-csv-columns-v1'
      AND p_structure='daaa4126d63194f59949c2b6f464b108ed87a430090e4dfe36e255663ab59165' AND p_mime='text/csv')
    OR (p_template='sop-v1' AND p_rule='sop-not-imported' AND p_mapping='not-imported'
      AND p_structure='55db62261cb6eee8bb0327ffb4bf8eac1f30a667e6821f640431d4be47c3a925'
      AND p_mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    false);
$$;

CREATE FUNCTION content_intake.delete_unused_sop_row(
  p_candidate_id content_intake.identifier,
  p_version content_intake.version,
  p_row_id text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = content_intake, public, pg_temp
AS $$
DECLARE
  v_state text;
  v_source content_intake.identifier;
  v_media content_intake.identifier[];
BEGIN
  SELECT state, source_id INTO v_state, v_source
  FROM content_intake.candidate_versions
  WHERE candidate_id = p_candidate_id AND version = p_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SOP_ROW_NOT_FOUND';
  END IF;
  IF v_state IN ('published','publishing') THEN
    RAISE EXCEPTION 'SOP_ROW_IN_USE';
  END IF;
  IF EXISTS (
    SELECT 1 FROM content_intake.sop_release_media
    WHERE candidate_id = p_candidate_id AND candidate_version = p_version AND row_id = p_row_id
  ) OR EXISTS (
    SELECT 1
    FROM content_intake.sop_candidate_media cm
    JOIN content_intake.sop_media_objects o ON o.media_object_id = cm.media_object_id
    WHERE cm.candidate_id = p_candidate_id AND cm.candidate_version = p_version AND cm.row_id = p_row_id
      AND (o.adopted_at IS NOT NULL OR o.state IN ('adopted','released'))
  ) THEN
    RAISE EXCEPTION 'SOP_ROW_IN_USE';
  END IF;
  SELECT coalesce(array_agg(media_object_id), ARRAY[]::content_intake.identifier[]) INTO v_media
  FROM content_intake.sop_candidate_media
  WHERE candidate_id = p_candidate_id AND candidate_version = p_version AND row_id = p_row_id;
  IF coalesce(cardinality(v_media), 0) = 0 THEN
    RAISE EXCEPTION 'SOP_ROW_NOT_FOUND';
  END IF;
  DELETE FROM content_intake.sop_candidate_media
  WHERE candidate_id = p_candidate_id AND candidate_version = p_version AND row_id = p_row_id;
  UPDATE content_intake.sop_media_objects o
  SET state = 'discarded', discarded_at = clock_timestamp()
  WHERE o.media_object_id = ANY(v_media)
    AND o.source_id = v_source
    AND o.adopted_at IS NULL
    AND o.state = 'staged'
    AND NOT EXISTS (SELECT 1 FROM content_intake.sop_candidate_media cm WHERE cm.media_object_id = o.media_object_id)
    AND NOT EXISTS (SELECT 1 FROM content_intake.sop_release_media rm WHERE rm.media_object_id = o.media_object_id);
END;
$$;

ALTER FUNCTION content_intake.delete_unused_sop_row(content_intake.identifier, content_intake.version, text)
  OWNER TO intake_runtime_fn_owner;
REVOKE ALL ON FUNCTION content_intake.delete_unused_sop_row(content_intake.identifier, content_intake.version, text) FROM PUBLIC;

INSERT INTO content_intake.scopes (scope_id, tenant_id, app_id, brand_id, shop_id, domain)
VALUES ('scope-menokin-sop', 'tenant-menokin', 'app-customer-agent', 'brand-menokin', 'shop-menokin', 'sop')
ON CONFLICT (scope_id) DO NOTHING;

INSERT INTO content_intake.sources (source_id, scope_id, current_mapping_version, mode)
VALUES ('src-menokin-sop', 'scope-menokin-sop', 1, 'legacy')
ON CONFLICT (source_id) DO NOTHING;

INSERT INTO content_intake.source_mappings (source_id, version, template_version, rule_version, mapping_version, structure_digest)
VALUES ('src-menokin-sop', 1, 'sop-v1', 'sop-not-imported', 'not-imported', '55db62261cb6eee8bb0327ffb4bf8eac1f30a667e6821f640431d4be47c3a925')
ON CONFLICT (source_id, version) DO NOTHING;
