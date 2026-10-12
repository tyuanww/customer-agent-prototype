-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0023_intake_quality; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa
-- source_git_sha=d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713
-- source_schema_sha256=1418537f66274657f8221896387933b4a00a15c23253993541c3bb0ca8964d41
-- Internal candidate quality storage. No wire contract, legacy evidence, release
-- authority or application ACL is changed. All commands share lock_content.
CREATE TABLE content_intake.quality_plans (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  candidate_digest content_intake.sha256 NOT NULL,
  policy_version TEXT NOT NULL CHECK (policy_version='intake-quality-v1'),
  plan JSONB NOT NULL CHECK (jsonb_typeof(plan)='object' AND octet_length(plan::text)<=5242880),
  frozen_by content_intake.identifier NOT NULL,
  facts_version content_intake.version NOT NULL,
  frozen_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (candidate_id,candidate_version),
  UNIQUE (candidate_id,candidate_version,candidate_digest),
  FOREIGN KEY (candidate_id,candidate_version,candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (frozen_by,facts_version) REFERENCES content_intake.principal_facts(principal_id,facts_version)
);

-- Each phase is one atomic, immutable set of individual human checks. Counts and
-- conclusions are derived from these inputs, never accepted from the caller.
CREATE TABLE content_intake.quality_rounds (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  candidate_digest content_intake.sha256 NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('initial','expanded')),
  checks JSONB NOT NULL CHECK (jsonb_typeof(checks)='array' AND jsonb_array_length(checks)<=5000 AND octet_length(checks::text)<=8388608),
  checked_by content_intake.identifier NOT NULL,
  facts_version content_intake.version NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (candidate_id,candidate_version,phase),
  FOREIGN KEY (candidate_id,candidate_version,candidate_digest) REFERENCES content_intake.quality_plans(candidate_id,candidate_version,candidate_digest),
  FOREIGN KEY (checked_by,facts_version) REFERENCES content_intake.principal_facts(principal_id,facts_version)
);

-- This stricter P2 conclusion never allows quarantining defects out of a batch.
-- The 2% / 5% expansion policy matches the existing quality gate; any remaining
-- defect requires a new candidate version even when below the legacy threshold.
CREATE FUNCTION content_intake.quality_state(p_candidate TEXT,p_version BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE p JSONB; initial JSONB; expanded JSONB; ordinary INTEGER; target INTEGER;
  initial_defects INTEGER; final_defects INTEGER; mandatory_defects INTEGER;
BEGIN
  SELECT plan INTO p FROM content_intake.quality_plans WHERE candidate_id=p_candidate AND candidate_version=p_version;
  IF NOT FOUND THEN RETURN 'not_frozen'; END IF;
  SELECT checks INTO initial FROM content_intake.quality_rounds WHERE candidate_id=p_candidate AND candidate_version=p_version AND phase='initial';
  IF NOT FOUND THEN RETURN 'initial_required'; END IF;
  SELECT count(*) FILTER (WHERE (c->>'defect')::boolean AND r->>'risk_level'<>'high'),
    count(*) FILTER (WHERE (c->>'defect')::boolean AND r->>'risk_level'='high')
    INTO initial_defects,mandatory_defects
    FROM jsonb_array_elements(initial) c JOIN jsonb_array_elements(p->'population') r ON c->>'scriptId'=r->>'script_id';
  ordinary:=(p->>'ordinaryCount')::integer;
  target:=(p->>'initialTarget')::integer;
  IF mandatory_defects>0 THEN RETURN 'revision_required'; END IF;
  IF initial_defects*20>target THEN RETURN 'blocked'; END IF;
  IF ordinary>500 AND initial_defects*50>target THEN
    SELECT checks INTO expanded FROM content_intake.quality_rounds WHERE candidate_id=p_candidate AND candidate_version=p_version AND phase='expanded';
    IF NOT FOUND THEN RETURN 'expansion_required'; END IF;
    SELECT count(*) INTO final_defects FROM jsonb_array_elements(expanded) c WHERE (c->>'defect')::boolean;
    IF final_defects*20>(p->>'expandedTarget')::integer THEN RETURN 'blocked'; END IF;
    RETURN CASE WHEN final_defects>0 THEN 'revision_required' ELSE 'passed' END;
  END IF;
  RETURN CASE WHEN initial_defects>0 THEN 'revision_required' ELSE 'passed' END;
END $$;

CREATE FUNCTION content_intake.quality_round_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE p JSONB; expected JSONB; prior JSONB;
BEGIN
  PERFORM backend_review.lock_content();
  SELECT plan INTO p FROM content_intake.quality_plans WHERE candidate_id=NEW.candidate_id AND candidate_version=NEW.candidate_version
    AND candidate_digest=NEW.candidate_digest;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM content_intake.candidate_versions WHERE candidate_id=NEW.candidate_id
    AND version=NEW.candidate_version AND digest=NEW.candidate_digest AND state IN ('awaiting-evidence','ready')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='QUALITY_CANDIDATE_STALE';
  END IF;
  IF content_intake.quality_state(NEW.candidate_id,NEW.candidate_version) IS DISTINCT FROM
    (CASE NEW.phase WHEN 'initial' THEN 'initial_required' WHEN 'expanded' THEN 'expansion_required' END) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003',MESSAGE='QUALITY_PHASE_STALE';
  END IF;
  expected:=p->CASE NEW.phase WHEN 'initial' THEN 'initialScriptIds' ELSE 'expandedScriptIds' END;
  IF jsonb_typeof(NEW.checks) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.checks)>5000 THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='QUALITY_CHECK_INVALID';
  END IF;
  IF (SELECT count(DISTINCT x->>'scriptId') FROM jsonb_array_elements(NEW.checks) x)<>jsonb_array_length(NEW.checks)
    OR jsonb_array_length(NEW.checks)<>jsonb_array_length(expected) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='QUALITY_SAMPLE_MISMATCH';
  END IF;
  SELECT checks INTO prior FROM content_intake.quality_rounds WHERE candidate_id=NEW.candidate_id AND candidate_version=NEW.candidate_version AND phase='initial';
  -- Expand each set once. A per-check scan of the 5,000-row population exceeds
  -- the existing 5-second statement budget for a valid critical candidate.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.checks) c(item)
    LEFT JOIN jsonb_array_elements(p->'population') r(item) ON r.item->>'script_id'=c.item->>'scriptId'
    LEFT JOIN jsonb_array_elements_text(expected) selected(id) ON selected.id=c.item->>'scriptId'
    LEFT JOIN jsonb_array_elements(prior) previous(item) ON previous.item->>'scriptId'=c.item->>'scriptId'
    WHERE jsonb_typeof(c.item) IS DISTINCT FROM 'object' OR c.item-ARRAY['scriptId','contentHash','defect','reason']<>'{}'::jsonb
      OR NOT(c.item ?& ARRAY['scriptId','contentHash','defect','reason'])
      OR jsonb_typeof(c.item->'defect') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c.item->'reason') IS DISTINCT FROM 'string'
      OR length(c.item->>'reason')>1000 OR ((c.item->>'defect')::boolean AND btrim(c.item->>'reason')='')
      OR selected.id IS NULL OR r.item IS NULL OR r.item->>'content_hash' IS DISTINCT FROM c.item->>'contentHash'
      OR (previous.item IS NOT NULL AND previous.item IS DISTINCT FROM c.item)
  ) THEN
    RAISE EXCEPTION USING ERRCODE='ZA001',MESSAGE='QUALITY_CHECK_INVALID';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER quality_round_guard BEFORE INSERT ON content_intake.quality_rounds
  FOR EACH ROW EXECUTE FUNCTION content_intake.quality_round_guard();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.quality_plans
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.quality_rounds
  FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history();
REVOKE ALL ON content_intake.quality_plans,content_intake.quality_rounds FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
REVOKE ALL ON FUNCTION content_intake.quality_state(TEXT,BIGINT),content_intake.quality_round_guard() FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
