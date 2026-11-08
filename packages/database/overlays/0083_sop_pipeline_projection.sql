-- Hand-authored SOP source. INT-SCHEMA owns ordering and generated manifest/catalogue.
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE TABLE content_intake.sop_release_scenes (
  release_id TEXT NOT NULL REFERENCES public.content_releases,
  sop_id content_intake.identifier NOT NULL,
  scene_id content_intake.identifier NOT NULL,
  group_id TEXT NOT NULL CHECK (group_id IN (
    'allergy',
    'acne',
    'quality-after-sale',
    'minor-error-broken',
    'tax'
  )),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 512),
  entry_step_id content_intake.identifier NOT NULL,
  PRIMARY KEY (release_id, sop_id),
  UNIQUE (release_id, scene_id)
);

CREATE TABLE content_intake.sop_release_steps (
  release_id TEXT NOT NULL,
  sop_id content_intake.identifier NOT NULL,
  step_id content_intake.identifier NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('ordered','decision','execution','jump','terminal')),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  parent_step_id content_intake.identifier,
  next_step_id content_intake.identifier,
  target_step_id content_intake.identifier,
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 512),
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_id, sop_id, step_id),
  UNIQUE (release_id, sop_id, sequence),
  FOREIGN KEY (release_id, sop_id)
    REFERENCES content_intake.sop_release_scenes(release_id, sop_id)
);

ALTER TABLE content_intake.sop_release_steps
  ADD CONSTRAINT sop_release_parent_step
    FOREIGN KEY (release_id, sop_id, parent_step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT sop_release_next_step
    FOREIGN KEY (release_id, sop_id, next_step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT sop_release_target_step
    FOREIGN KEY (release_id, sop_id, target_step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE content_intake.sop_release_branches (
  release_id TEXT NOT NULL,
  sop_id content_intake.identifier NOT NULL,
  branch_id content_intake.identifier NOT NULL,
  source_step_id content_intake.identifier NOT NULL,
  label TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 256),
  target_step_id content_intake.identifier NOT NULL,
  PRIMARY KEY (release_id, sop_id, branch_id),
  FOREIGN KEY (release_id, sop_id)
    REFERENCES content_intake.sop_release_scenes(release_id, sop_id),
  FOREIGN KEY (release_id, sop_id, source_step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (release_id, sop_id, target_step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE content_intake.sop_release_messages (
  release_id TEXT NOT NULL,
  sop_id content_intake.identifier NOT NULL,
  message_id content_intake.identifier NOT NULL,
  step_id content_intake.identifier NOT NULL,
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 32767),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high')),
  PRIMARY KEY (release_id, sop_id, message_id),
  FOREIGN KEY (release_id, sop_id, step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
);

CREATE TABLE content_intake.sop_release_resources (
  release_id TEXT NOT NULL,
  sop_id content_intake.identifier NOT NULL,
  resource_id content_intake.identifier NOT NULL,
  step_id content_intake.identifier NOT NULL,
  media_id content_intake.identifier NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (release_id, sop_id, resource_id),
  UNIQUE (release_id, sop_id, step_id, ordinal),
  FOREIGN KEY (release_id, sop_id, step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
);

CREATE TABLE content_intake.sop_release_search_entries (
  release_id TEXT NOT NULL,
  sop_id content_intake.identifier NOT NULL,
  entry_id content_intake.identifier NOT NULL,
  step_id content_intake.identifier NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('classify','step')),
  body TEXT NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 32767),
  PRIMARY KEY (release_id, sop_id, entry_id),
  FOREIGN KEY (release_id, sop_id, step_id)
    REFERENCES content_intake.sop_release_steps(release_id, sop_id, step_id)
);

CREATE TABLE content_intake.sop_release_severity (
  release_id TEXT NOT NULL REFERENCES public.content_releases,
  group_id TEXT NOT NULL CHECK (group_id IN (
    'allergy',
    'acne',
    'quality-after-sale',
    'minor-error-broken',
    'tax'
  )),
  rank INTEGER NOT NULL CHECK (rank > 0),
  PRIMARY KEY (release_id, group_id),
  UNIQUE (release_id, rank)
);

CREATE TABLE content_intake.sop_release_projections (
  release_id TEXT PRIMARY KEY REFERENCES public.content_releases,
  schema_version TEXT NOT NULL CHECK (schema_version = 'sop-release-v1'),
  facts_hash content_intake.sha256 NOT NULL,
  index_hash content_intake.sha256 NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  projection JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(created_at)),
  CHECK (projection->>'releaseId' = release_id),
  CHECK (projection->>'schemaVersion' = schema_version),
  CHECK (projection->>'indexHash' = index_hash),
  CHECK ((projection->>'itemCount')::INTEGER = item_count)
);

CREATE FUNCTION content_intake.reject_sop_release_history_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'SOP_RELEASE_IMMUTABLE' USING ERRCODE = 'ZA003';
END
$$;

CREATE TRIGGER sop_release_scenes_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_scenes
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_steps_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_steps
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_branches_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_branches
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_messages_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_messages
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_resources_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_resources
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_search_entries_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_search_entries
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_severity_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_severity
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();
CREATE TRIGGER sop_release_projections_immutable
  BEFORE UPDATE OR DELETE ON content_intake.sop_release_projections
  FOR EACH ROW EXECUTE FUNCTION content_intake.reject_sop_release_history_change();

CREATE FUNCTION content_intake.publish_sop_release_facts(
  p_release_id TEXT,
  p_facts JSONB,
  p_projection JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog, content_intake, pg_temp
AS $$
DECLARE
  existing content_intake.sop_release_projections;
  definition_json JSONB;
  severity JSONB;
  severity_count INTEGER;
  severity_distinct INTEGER;
  expected_item_count INTEGER;
  facts_hash content_intake.sha256;
BEGIN
  IF p_release_id IS NULL
    OR p_release_id <> p_facts->>'releaseId'
    OR p_release_id <> p_projection->>'releaseId'
    OR p_projection->>'schemaVersion' <> 'sop-release-v1'
    OR COALESCE(p_projection->>'indexHash','') !~ '^[0-9a-f]{64}$'
    OR jsonb_typeof(p_facts->'definitions') <> 'array'
    OR jsonb_array_length(p_facts->'definitions') = 0
    OR jsonb_typeof(p_projection->'definitions') <> 'array'
    OR jsonb_typeof(p_projection->'searchEntries') <> 'array' THEN
    RAISE EXCEPTION 'FILE_INVALID' USING ERRCODE = 'ZA001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.content_releases WHERE release_id = p_release_id
  ) THEN
    RAISE EXCEPTION 'UNKNOWN_RELEASE' USING ERRCODE = 'ZA003';
  END IF;
  SELECT
    count(*)::INTEGER
    + COALESCE(sum(jsonb_array_length(item.value->'steps')), 0)::INTEGER
    + COALESCE(sum(jsonb_array_length(item.value->'branches')), 0)::INTEGER
    + COALESCE(sum(jsonb_array_length(item.value->'searchEntries')), 0)::INTEGER
    INTO expected_item_count
  FROM jsonb_array_elements(p_facts->'definitions') AS item(value);
  IF expected_item_count <> (p_projection->>'itemCount')::INTEGER THEN
    RAISE EXCEPTION 'SOP_PROJECTION_INVALID' USING ERRCODE = 'ZA001';
  END IF;
  facts_hash := encode(public.digest(
    pg_catalog.convert_to(public.jsonb_jcs(p_facts), 'UTF8'),
    'sha256'
  ), 'hex');

  SELECT * INTO existing
  FROM content_intake.sop_release_projections
  WHERE release_id = p_release_id;
  IF FOUND THEN
    IF existing.facts_hash = facts_hash
      AND existing.index_hash = p_projection->>'indexHash'
      AND existing.item_count = (p_projection->>'itemCount')::INTEGER
      AND existing.projection = p_projection THEN
      RETURN jsonb_build_object(
        'releaseId', p_release_id,
        'factsHash', existing.facts_hash,
        'indexHash', existing.index_hash,
        'itemCount', existing.item_count,
        'state', 'replayed'
      );
    END IF;
    RAISE EXCEPTION 'SOP_RELEASE_CONFLICT' USING ERRCODE = 'ZA003';
  END IF;

  IF EXISTS (
    SELECT 1 FROM content_intake.sop_release_scenes WHERE release_id = p_release_id
  ) THEN
    RAISE EXCEPTION 'SOP_RELEASE_CONFLICT' USING ERRCODE = 'ZA003';
  END IF;

  severity := p_projection->'severityOrder';
  IF severity IS NOT NULL AND jsonb_typeof(severity) <> 'null' THEN
    IF jsonb_typeof(severity) <> 'array' THEN
      RAISE EXCEPTION 'FILE_INVALID' USING ERRCODE = 'ZA001';
    END IF;
    SELECT count(*), count(DISTINCT value)
      INTO severity_count, severity_distinct
      FROM jsonb_array_elements_text(severity) AS item(value);
    IF severity_count <> 5 OR severity_distinct <> 5 OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(severity) AS item(value)
      WHERE value NOT IN (
        'allergy',
        'acne',
        'quality-after-sale',
        'minor-error-broken',
        'tax'
      )
    ) THEN
      RAISE EXCEPTION 'SOP_SEVERITY_ORDER_INVALID' USING ERRCODE = 'ZA001';
    END IF;
    INSERT INTO content_intake.sop_release_severity(release_id, group_id, rank)
    SELECT p_release_id, value, ordinality::INTEGER
    FROM jsonb_array_elements_text(severity) WITH ORDINALITY AS item(value, ordinality);
  END IF;

  FOR definition_json IN SELECT value FROM jsonb_array_elements(p_facts->'definitions')
  LOOP
    INSERT INTO content_intake.sop_release_scenes(
      release_id, sop_id, scene_id, group_id, title, entry_step_id
    ) VALUES (
      p_release_id,
      definition_json->>'sopId',
      definition_json->>'sceneId',
      definition_json->>'groupId',
      definition_json->>'title',
      definition_json->>'entryStepId'
    );

    INSERT INTO content_intake.sop_release_steps(
      release_id, sop_id, step_id, kind, sequence, parent_step_id,
      next_step_id, target_step_id, title, description
    )
    SELECT
      p_release_id,
      definition_json->>'sopId',
      step->>'stepId',
      step->>'kind',
      (step->>'sequence')::INTEGER,
      NULLIF(step->>'parentStepId',''),
      NULLIF(step->>'nextStepId',''),
      NULLIF(step->>'targetStepId',''),
      step->>'title',
      COALESCE(step->>'description','')
    FROM jsonb_array_elements(definition_json->'steps') AS item(step);

    INSERT INTO content_intake.sop_release_branches(
      release_id, sop_id, branch_id, source_step_id, label, target_step_id
    )
    SELECT
      p_release_id,
      definition_json->>'sopId',
      branch->>'branchId',
      branch->>'sourceStepId',
      branch->>'label',
      branch->>'targetStepId'
    FROM jsonb_array_elements(definition_json->'branches') AS item(branch);

    INSERT INTO content_intake.sop_release_messages(
      release_id, sop_id, message_id, step_id, body, risk_level
    )
    SELECT
      p_release_id,
      definition_json->>'sopId',
      message->>'messageId',
      message->>'stepId',
      message->>'text',
      message->>'riskLevel'
    FROM jsonb_array_elements(definition_json->'messages') AS item(message);

    INSERT INTO content_intake.sop_release_resources(
      release_id, sop_id, resource_id, step_id, media_id, ordinal, description
    )
    SELECT
      p_release_id,
      definition_json->>'sopId',
      resource->>'resourceId',
      resource->>'stepId',
      resource->>'mediaId',
      (resource->>'ordinal')::INTEGER,
      COALESCE(resource->>'description','')
    FROM jsonb_array_elements(definition_json->'resources') AS item(resource);

    INSERT INTO content_intake.sop_release_search_entries(
      release_id, sop_id, entry_id, step_id, purpose, body
    )
    SELECT
      p_release_id,
      definition_json->>'sopId',
      entry->>'entryId',
      entry->>'stepId',
      entry->>'purpose',
      entry->>'text'
    FROM jsonb_array_elements(definition_json->'searchEntries') AS item(entry);
  END LOOP;

  INSERT INTO content_intake.sop_release_projections(
    release_id, schema_version, facts_hash, index_hash, item_count, projection
  ) VALUES (
    p_release_id,
    p_projection->>'schemaVersion',
    facts_hash,
    p_projection->>'indexHash',
    (p_projection->>'itemCount')::INTEGER,
    p_projection
  );

  RETURN jsonb_build_object(
    'releaseId', p_release_id,
    'factsHash', facts_hash,
    'indexHash', p_projection->>'indexHash',
    'itemCount', (p_projection->>'itemCount')::INTEGER,
    'state', 'inserted'
  );
END
$$;

CREATE FUNCTION content_intake.read_sop_release_projection(p_release_id TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog, content_intake, pg_temp
AS $$
  SELECT projection
  FROM content_intake.sop_release_projections
  WHERE release_id = p_release_id
$$;

ALTER TABLE content_intake.sop_release_scenes OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_steps OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_branches OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_messages OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_resources OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_search_entries OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_severity OWNER TO intake_runtime_fn_owner;
ALTER TABLE content_intake.sop_release_projections OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.reject_sop_release_history_change() OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.publish_sop_release_facts(TEXT, JSONB, JSONB) OWNER TO intake_runtime_fn_owner;
ALTER FUNCTION content_intake.read_sop_release_projection(TEXT) OWNER TO intake_runtime_fn_owner;

REVOKE ALL ON TABLE
  content_intake.sop_release_scenes,
  content_intake.sop_release_steps,
  content_intake.sop_release_branches,
  content_intake.sop_release_messages,
  content_intake.sop_release_resources,
  content_intake.sop_release_search_entries,
  content_intake.sop_release_severity,
  content_intake.sop_release_projections
FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.reject_sop_release_history_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.publish_sop_release_facts(TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION content_intake.read_sop_release_projection(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION content_intake.publish_sop_release_facts(TEXT, JSONB, JSONB) TO intake_business;
GRANT EXECUTE ON FUNCTION content_intake.read_sop_release_projection(TEXT) TO intake_usage;

COMMENT ON TABLE content_intake.sop_release_scenes IS
  '发布时冻结的 SOP 场景；严重性顺序只在 sop_release_severity 中出现一次。';
COMMENT ON TABLE content_intake.sop_release_steps IS
  '发布时冻结的有序步骤、决策、执行、跳转和终止节点；D/E 语义必须来自创作者显式字段。';
COMMENT ON TABLE content_intake.sop_release_projections IS
  '发布事务内生成的不可变 SOP 搜索投影；查询只读此 JSON，不重建索引。';
