-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0021_content_intake_v1_20; source schema.v1.20 lines 11909-12730
-- contract_set_id=cs-ai-c11-openapi-1.16.0-schema-1.20-d029cb0908fa
-- source_git_sha=d029cb0908faf9a0d1c1ffc1c8a5fcf39784d713
-- source_schema_sha256=1418537f66274657f8221896387933b4a00a15c23253993541c3bb0ca8964d41
SET LOCAL search_path = public, pg_catalog, pg_temp;

CREATE SCHEMA content_intake;
REVOKE ALL ON SCHEMA content_intake FROM PUBLIC;
CREATE DOMAIN content_intake.identifier AS TEXT
  CHECK (VALUE ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$');
CREATE DOMAIN content_intake.sha256 AS TEXT CHECK (VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN content_intake.version AS BIGINT CHECK (VALUE BETWEEN 1 AND 9007199254740991);
CREATE DOMAIN content_intake.generation AS BIGINT CHECK (VALUE BETWEEN 0 AND 9007199254740991);

-- Identity facts are immutable history; current_facts_version is a fact pointer,
-- never a second content pointer. person_key is confirmed only within identity_scope.
CREATE TABLE content_intake.principals (
  principal_id content_intake.identifier PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES backend_identity.subject_bindings(user_id),
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  identity_scope content_intake.identifier NOT NULL,
  person_key content_intake.identifier NOT NULL,
  current_facts_version content_intake.version NOT NULL,
  revocation_generation content_intake.generation NOT NULL DEFAULT 0,
  UNIQUE (principal_id,tenant_id,app_id),
  UNIQUE (principal_id,user_id),
  UNIQUE (tenant_id,app_id,identity_scope,person_key)
);
CREATE TABLE content_intake.principal_facts (
  principal_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  facts_version content_intake.version NOT NULL,
  department_ids TEXT[] NOT NULL CHECK (cardinality(department_ids) BETWEEN 1 AND 100 AND array_position(department_ids,NULL) IS NULL),
  job_id content_intake.identifier NOT NULL,
  enabled BOOLEAN NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL CHECK (isfinite(checked_at)),
  valid_until TIMESTAMPTZ NOT NULL,
  facts_digest content_intake.sha256 NOT NULL,
  PRIMARY KEY (principal_id,facts_version),
  CHECK (valid_until > checked_at AND valid_until <= checked_at + INTERVAL '5 minutes')
);
ALTER TABLE content_intake.principals ADD CONSTRAINT principal_current_facts_fk
  FOREIGN KEY (principal_id,current_facts_version) REFERENCES content_intake.principal_facts
  DEFERRABLE INITIALLY DEFERRED;
-- Tenant/app policy CAS is independent of per-rule historical versions.
CREATE TABLE content_intake.policy_versions (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  PRIMARY KEY (tenant_id,app_id)
);
CREATE TABLE content_intake.role_rules (
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  department_id content_intake.identifier NOT NULL,
  job_id content_intake.identifier NOT NULL,
  policy_version content_intake.version NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('agent','enabler','lead','supervisor','manager','director')),
  PRIMARY KEY (tenant_id,app_id,department_id,job_id)
);
CREATE TABLE content_intake.scopes (
  scope_id content_intake.identifier PRIMARY KEY,
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  brand_id content_intake.identifier NOT NULL,
  shop_id content_intake.identifier,
  domain TEXT NOT NULL CHECK (domain IN ('presale','campaign','aftersale','product')),
  UNIQUE NULLS NOT DISTINCT (tenant_id,app_id,brand_id,shop_id,domain),
  UNIQUE (scope_id,tenant_id,app_id)
);
CREATE TABLE content_intake.sources (
  source_id content_intake.identifier PRIMARY KEY,
  scope_id content_intake.identifier NOT NULL REFERENCES content_intake.scopes,
  current_mapping_version content_intake.version NOT NULL,
  mode TEXT NOT NULL DEFAULT 'legacy' CHECK (mode IN ('legacy','v2-preview','v2-active')),
  mode_version content_intake.version NOT NULL DEFAULT 1,
  revocation_generation content_intake.generation NOT NULL DEFAULT 0,
  UNIQUE (source_id,scope_id)
);
CREATE TABLE content_intake.source_mappings (
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  version content_intake.version NOT NULL,
  template_version TEXT NOT NULL CHECK (length(template_version) BETWEEN 1 AND 64),
  rule_version TEXT NOT NULL CHECK (length(rule_version) BETWEEN 1 AND 64),
  mapping_version TEXT NOT NULL CHECK (length(mapping_version) BETWEEN 1 AND 64),
  structure_digest content_intake.sha256 NOT NULL,
  PRIMARY KEY (source_id,version)
);
ALTER TABLE content_intake.sources ADD CONSTRAINT source_current_mapping_fk
  FOREIGN KEY (source_id,current_mapping_version) REFERENCES content_intake.source_mappings
  DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE content_intake.grants (
  grant_id content_intake.identifier PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('business','allocation','delegation')),
  issuer_id content_intake.identifier NOT NULL,
  recipient_id content_intake.identifier NOT NULL,
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  scope_id content_intake.identifier NOT NULL,
  source_id content_intake.identifier,
  action TEXT NOT NULL CHECK (action IN ('query','content-manage','import','source-confirm','review','publish','candidate-cancel','rollback')),
  starts_at TIMESTAMPTZ NOT NULL CHECK (isfinite(starts_at)),
  expires_at TIMESTAMPTZ NOT NULL CHECK (isfinite(expires_at) AND expires_at > starts_at),
  revoked_at TIMESTAMPTZ,
  steward_id content_intake.identifier,
  version content_intake.version NOT NULL DEFAULT 1,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 512),
  -- Creation reason is immutable; each later version adds its own request reason.
  last_change_reason TEXT CHECK (last_change_reason IS NULL OR length(btrim(last_change_reason)) BETWEEN 1 AND 512),
  CHECK ((version = 1 AND last_change_reason IS NULL) OR (version > 1 AND last_change_reason IS NOT NULL)),
  parent_grant_id content_intake.identifier REFERENCES content_intake.grants,
  may_redelegate BOOLEAN NOT NULL DEFAULT FALSE CHECK (may_redelegate = FALSE),
  FOREIGN KEY (issuer_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  FOREIGN KEY (steward_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  FOREIGN KEY (recipient_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  FOREIGN KEY (scope_id,tenant_id,app_id) REFERENCES content_intake.scopes(scope_id,tenant_id,app_id),
  FOREIGN KEY (source_id,scope_id) REFERENCES content_intake.sources(source_id,scope_id),
  CHECK (kind = 'allocation' OR issuer_id <> recipient_id),
  CHECK (kind = 'allocation' OR parent_grant_id IS NOT NULL)
);
CREATE INDEX grants_recipient_scope ON content_intake.grants(recipient_id,scope_id,action,expires_at) WHERE revoked_at IS NULL;
CREATE INDEX grants_parent ON content_intake.grants(parent_grant_id);
CREATE FUNCTION content_intake.grant_version_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_HISTORY_REQUIRED'; END IF;
  IF NEW.version<>OLD.version+1 OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (to_jsonb(NEW)-ARRAY['version','revoked_at','steward_id','last_change_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','revoked_at','steward_id','last_change_reason']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_VERSION_OR_IDENTITY_CHANGED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grant_version BEFORE UPDATE OR DELETE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.grant_version_guard();
CREATE TABLE content_intake.grant_history (
  grant_id content_intake.identifier NOT NULL REFERENCES content_intake.grants,
  version content_intake.version NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL CHECK (jsonb_typeof(record)='object'),
  PRIMARY KEY (grant_id,version)
);
CREATE TABLE content_intake.role_rule_history (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at TIMESTAMPTZ NOT NULL,
  before_record JSONB,
  after_record JSONB,
  CHECK (before_record IS NOT NULL OR after_record IS NOT NULL)
);
CREATE FUNCTION content_intake.record_policy_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME='grants' THEN
    INSERT INTO content_intake.grant_history VALUES (NEW.grant_id,NEW.version,clock_timestamp(),to_jsonb(NEW));
  ELSE
    INSERT INTO content_intake.policy_versions VALUES (coalesce(NEW.tenant_id,OLD.tenant_id),coalesce(NEW.app_id,OLD.app_id),1)
      ON CONFLICT (tenant_id,app_id) DO UPDATE SET version=content_intake.policy_versions.version+1;
    INSERT INTO content_intake.role_rule_history(recorded_at,before_record,after_record)
      VALUES (clock_timestamp(),CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER grant_history AFTER INSERT OR UPDATE ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.record_policy_history();
CREATE TRIGGER role_history AFTER INSERT OR UPDATE OR DELETE ON content_intake.role_rules FOR EACH ROW EXECUTE FUNCTION content_intake.record_policy_history();

-- Concrete-source current business authorization only. Grant creation and historical
-- review eligibility are separate transaction obligations, never inferred from this helper.
CREATE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT, p_action TEXT, p_scope TEXT, p_source TEXT, p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ LANGUAGE SQL STABLE SET search_path = pg_catalog AS $$
  SELECT least(f.valid_until,max(g.expires_at))
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f ON f.principal_id=p.principal_id AND f.facts_version=p.current_facts_version
  JOIN content_intake.scopes s ON s.scope_id=p_scope AND s.tenant_id=p.tenant_id AND s.app_id=p.app_id
  JOIN content_intake.grants g ON g.recipient_id=p.principal_id AND g.scope_id=s.scope_id
    AND g.action=p_action AND g.kind='business' AND g.revoked_at IS NULL
    AND (g.source_id IS NULL OR g.source_id=p_source) AND g.starts_at<=p_at AND p_at<g.expires_at
  JOIN content_intake.role_rules r ON r.tenant_id=p.tenant_id AND r.app_id=p.app_id
    AND r.department_id=ANY(f.department_ids) AND r.job_id=f.job_id
  WHERE p.principal_id=p_principal AND f.enabled AND f.checked_at<=p_at AND p_at<f.valid_until
    AND EXISTS (SELECT 1 FROM content_intake.sources src WHERE src.source_id=p_source AND src.scope_id=s.scope_id)
  GROUP BY f.valid_until
  HAVING count(DISTINCT r.role)=1 AND (min(r.role)<>'agent' OR p_action='query')
$$;

CREATE TABLE content_intake.vocabulary (
  vocabulary_id content_intake.identifier PRIMARY KEY,
  scope_id content_intake.identifier NOT NULL REFERENCES content_intake.scopes,
  kind TEXT NOT NULL CHECK (kind IN ('product','scenario')),
  meaning_digest content_intake.sha256 NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (vocabulary_id,scope_id)
);
CREATE TABLE content_intake.vocabulary_displays (
  vocabulary_id content_intake.identifier NOT NULL REFERENCES content_intake.vocabulary,
  display_version content_intake.version NOT NULL,
  display_name TEXT NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 256),
  PRIMARY KEY (vocabulary_id,display_version)
);
CREATE TABLE content_intake.objects (
  object_id content_intake.identifier PRIMARY KEY,
  source_id content_intake.identifier REFERENCES content_intake.sources,
  actor_id content_intake.identifier NOT NULL,
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  object_key TEXT NOT NULL UNIQUE CHECK (object_key ~ '^intake/[A-Za-z0-9._/-]{1,200}$' AND object_key NOT LIKE '%..%'),
  sha256 content_intake.sha256 NOT NULL,
  bytes BIGINT NOT NULL CHECK (bytes BETWEEN 1 AND 52428800),
  mime TEXT NOT NULL CHECK (mime IN ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/json')),
  purpose TEXT NOT NULL CHECK (purpose IN ('input','report','review-package')),
  received_at TIMESTAMPTZ NOT NULL,
  UNIQUE (object_id,source_id,sha256),
  UNIQUE (object_id,source_id),
  UNIQUE (object_id,sha256),
  FOREIGN KEY (actor_id,tenant_id,app_id) REFERENCES content_intake.principals(principal_id,tenant_id,app_id),
  CHECK (source_id IS NOT NULL OR purpose='review-package'),
  CHECK (purpose<>'input' OR (bytes<=10485760 AND mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'))
);
CREATE TABLE content_intake.parse_jobs (
  job_id content_intake.identifier PRIMARY KEY,
  source_version content_intake.version NOT NULL,
  contributor_ids content_intake.identifier[] NOT NULL CHECK (cardinality(contributor_ids) BETWEEN 1 AND 100 AND array_position(contributor_ids,NULL) IS NULL),
  generation content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  object_id content_intake.identifier NOT NULL REFERENCES content_intake.objects,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  state TEXT NOT NULL CHECK (state IN ('reading','parsing','validated','failed','cancelled')),
  base_release_id TEXT REFERENCES public.content_releases,
  report_object_id content_intake.identifier REFERENCES content_intake.objects,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  expected_prior_id content_intake.identifier,
  expected_prior_version content_intake.version,
  expected_prior_digest content_intake.sha256,
  result_candidate_id content_intake.identifier,
  result_candidate_version content_intake.version,
  CHECK ((expected_prior_id IS NULL AND expected_prior_version IS NULL AND expected_prior_digest IS NULL)
    OR (expected_prior_id IS NOT NULL AND expected_prior_version IS NOT NULL AND expected_prior_digest IS NOT NULL)),
  CHECK ((result_candidate_id IS NULL)=(result_candidate_version IS NULL)),
  CHECK ((state='validated')=(result_candidate_id IS NOT NULL)),
  FOREIGN KEY (source_id,source_version) REFERENCES content_intake.source_mappings,
  FOREIGN KEY (object_id,source_id) REFERENCES content_intake.objects(object_id,source_id),
  FOREIGN KEY (report_object_id,source_id) REFERENCES content_intake.objects(object_id,source_id),
  CHECK ((state IN ('validated','failed','cancelled')) = (finished_at IS NOT NULL))
);
CREATE TABLE content_intake.candidate_versions (
  candidate_id content_intake.identifier NOT NULL,
  version content_intake.version NOT NULL,
  source_id content_intake.identifier NOT NULL,
  scope_id content_intake.identifier NOT NULL,
  source_version content_intake.version NOT NULL,
  object_id content_intake.identifier NOT NULL,
  file_sha256 content_intake.sha256 NOT NULL,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  base_release_id TEXT REFERENCES public.content_releases,
  canonical_encoding TEXT NOT NULL CHECK (canonical_encoding='candidate-p1.1'),
  canonical_material TEXT NOT NULL CHECK (octet_length(canonical_material) BETWEEN 2 AND 52428800),
  material JSONB NOT NULL CHECK (jsonb_typeof(material)='object'),
  digest TEXT GENERATED ALWAYS AS (encode(public.digest(canonical_material,'sha256'),'hex')) STORED,
  risk TEXT NOT NULL CHECK (risk IN ('routine','critical')),
  explicit_disable_count INTEGER NOT NULL CHECK (explicit_disable_count BETWEEN 0 AND 5000),
  state TEXT NOT NULL DEFAULT 'awaiting-evidence' CHECK (state IN ('awaiting-evidence','ready','publishing','published','cancelled','invalidated')),
  source_evidence_version content_intake.generation NOT NULL DEFAULT 0,
  approval_evidence_version content_intake.generation NOT NULL DEFAULT 0,
  revocation_generation content_intake.generation NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (candidate_id,version),
  UNIQUE (candidate_id,version,digest),
  UNIQUE (candidate_id,version,source_id),
  UNIQUE (candidate_id,version,file_sha256),
  UNIQUE (candidate_id,version,object_id),
  FOREIGN KEY (source_id,scope_id) REFERENCES content_intake.sources(source_id,scope_id),
  FOREIGN KEY (source_id,source_version) REFERENCES content_intake.source_mappings,
  FOREIGN KEY (object_id,source_id,file_sha256) REFERENCES content_intake.objects(object_id,source_id,sha256),
  CHECK (canonical_material::jsonb=material),
  CHECK (material->>'canonicalEncodingVersion' IS NOT DISTINCT FROM canonical_encoding),
  CHECK (material#>>'{scope,sourceId}' IS NOT DISTINCT FROM source_id::text),
  CHECK (material#>>'{object,objectId}' IS NOT DISTINCT FROM object_id::text),
  CHECK (material#>>'{object,sha256}' IS NOT DISTINCT FROM file_sha256::text),
  CHECK (material#>>'{sourceClaim,fileSha256}' IS NOT DISTINCT FROM file_sha256::text),
  CHECK (jsonb_typeof(material->'contributors') IS NOT DISTINCT FROM 'array'),
  CHECK (jsonb_array_length(material->'contributors') BETWEEN 1 AND 100),
  CHECK (material->>'baseReleaseId' IS NOT DISTINCT FROM base_release_id),
  CHECK (material#>>'{risk,level}' IS NOT DISTINCT FROM risk),
  CHECK (material#>>'{risk,explicitDisableCount}' IS NOT DISTINCT FROM explicit_disable_count::text),
  CHECK (explicit_disable_count<2 OR risk='critical'),
  CHECK (state NOT IN ('ready','publishing','published') OR (source_evidence_version>0 AND approval_evidence_version>0)),
  CHECK (updated_at>=created_at)
);
CREATE UNIQUE INDEX candidate_one_open_version ON content_intake.candidate_versions(candidate_id)
  WHERE state IN ('awaiting-evidence','ready','publishing');
CREATE INDEX candidate_scope_state_updated ON content_intake.candidate_versions(scope_id,state,updated_at DESC,candidate_id,version);
CREATE INDEX candidate_source_state_updated ON content_intake.candidate_versions(source_id,state,updated_at DESC,candidate_id,version);
CREATE INDEX candidate_actor_open ON content_intake.candidate_versions(actor_id) WHERE state IN ('awaiting-evidence','ready','publishing');
ALTER TABLE content_intake.parse_jobs
  ADD FOREIGN KEY (expected_prior_id,expected_prior_version,expected_prior_digest) REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  ADD FOREIGN KEY (expected_prior_id,expected_prior_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  ADD FOREIGN KEY (result_candidate_id,result_candidate_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  ADD FOREIGN KEY (result_candidate_id,result_candidate_version,object_id) REFERENCES content_intake.candidate_versions(candidate_id,version,object_id);
-- The frozen material owns contributors. A derived view cannot diverge from its digest.
CREATE VIEW content_intake.contributors AS
  SELECT candidate_id,version AS candidate_version,
    jsonb_array_elements_text(material->'contributors')::content_intake.identifier AS principal_id
  FROM content_intake.candidate_versions;
CREATE TABLE content_intake.candidate_vocabulary (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  vocabulary_id content_intake.identifier NOT NULL,
  display_version content_intake.version NOT NULL,
  PRIMARY KEY (candidate_id,candidate_version,vocabulary_id),
  FOREIGN KEY (candidate_id,candidate_version) REFERENCES content_intake.candidate_versions,
  FOREIGN KEY (vocabulary_id,display_version) REFERENCES content_intake.vocabulary_displays
);
CREATE TABLE content_intake.source_confirmations (
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  candidate_digest content_intake.sha256 NOT NULL,
  source_id content_intake.identifier NOT NULL,
  evidence_version content_intake.version NOT NULL,
  revocation_generation content_intake.generation NOT NULL DEFAULT 0,
  version_kind TEXT NOT NULL CHECK (version_kind IN ('integer','opaque')),
  version_value TEXT NOT NULL CHECK (length(version_value) BETWEEN 1 AND 128),
  acquisition TEXT NOT NULL CHECK (acquisition IN ('feishu-export','controlled-synthetic-export')),
  confirmed_by content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  confirmed_at TIMESTAMPTZ NOT NULL,
  object_sha256 content_intake.sha256 NOT NULL,
  PRIMARY KEY (candidate_id,candidate_version,evidence_version),
  FOREIGN KEY (candidate_id,candidate_version,candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  FOREIGN KEY (candidate_id,candidate_version,object_sha256) REFERENCES content_intake.candidate_versions(candidate_id,version,file_sha256),
  CHECK (version_kind<>'integer' OR version_value ~ '^(0|[1-9][0-9]{0,18})$')
);
CREATE TABLE content_intake.rollback_plans (
  rollback_plan_id content_intake.identifier PRIMARY KEY,
  base_release_id TEXT NOT NULL REFERENCES public.content_releases,
  target_release_id TEXT NOT NULL REFERENCES public.content_releases,
  impact_digest content_intake.sha256 NOT NULL,
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (rollback_plan_id,impact_digest),
  CHECK (base_release_id<>target_release_id)
);
CREATE TABLE content_intake.rollback_scopes (
  rollback_plan_id content_intake.identifier NOT NULL REFERENCES content_intake.rollback_plans,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  PRIMARY KEY (rollback_plan_id,source_id)
);
CREATE TABLE content_intake.review_bindings (
  review_request_id content_intake.identifier PRIMARY KEY,
  candidate_id content_intake.identifier,
  candidate_version content_intake.version,
  candidate_digest content_intake.sha256,
  rollback_plan_id content_intake.identifier,
  impact_digest content_intake.sha256,
  evidence_version content_intake.version NOT NULL,
  tenant_id content_intake.identifier NOT NULL,
  app_id content_intake.identifier NOT NULL,
  definition_id content_intake.identifier NOT NULL,
  node_id content_intake.identifier NOT NULL,
  create_uuid UUID NOT NULL UNIQUE,
  instance_code content_intake.identifier,
  package_object_id content_intake.identifier NOT NULL REFERENCES content_intake.objects,
  package_sha256 content_intake.sha256 NOT NULL,
  attachment_file_code TEXT CHECK (length(attachment_file_code) BETWEEN 1 AND 512),
  UNIQUE (candidate_id,candidate_version,evidence_version),
  UNIQUE (review_request_id,candidate_id,candidate_version),
  UNIQUE (rollback_plan_id,evidence_version),
  UNIQUE (tenant_id,app_id,instance_code),
  FOREIGN KEY (package_object_id,package_sha256) REFERENCES content_intake.objects(object_id,sha256),
  FOREIGN KEY (candidate_id,candidate_version,candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (rollback_plan_id,impact_digest) REFERENCES content_intake.rollback_plans(rollback_plan_id,impact_digest),
  CHECK ((candidate_id IS NOT NULL AND candidate_version IS NOT NULL AND candidate_digest IS NOT NULL AND rollback_plan_id IS NULL AND impact_digest IS NULL)
    OR (candidate_id IS NULL AND candidate_version IS NULL AND candidate_digest IS NULL AND rollback_plan_id IS NOT NULL AND impact_digest IS NOT NULL))
);
CREATE TABLE content_intake.approval_facts (
  review_request_id content_intake.identifier NOT NULL REFERENCES content_intake.review_bindings,
  facts_version content_intake.version NOT NULL,
  revocation_generation content_intake.generation NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','approved','rejected','revoked')),
  checked_at TIMESTAMPTZ NOT NULL CHECK (isfinite(checked_at)),
  valid_until TIMESTAMPTZ NOT NULL,
  raw_facts_digest content_intake.sha256 NOT NULL,
  package_verified_sha256 content_intake.sha256,
  human_task_id content_intake.identifier,
  reviewer_id content_intake.identifier,
  reviewer_facts_version content_intake.version,
  decided_at TIMESTAMPTZ,
  PRIMARY KEY (review_request_id,facts_version),
  FOREIGN KEY (reviewer_id,reviewer_facts_version) REFERENCES content_intake.principal_facts,
  CHECK (valid_until>checked_at AND valid_until<=checked_at+INTERVAL '5 minutes'),
  CHECK (state<>'approved' OR (human_task_id IS NOT NULL AND reviewer_id IS NOT NULL AND reviewer_facts_version IS NOT NULL AND decided_at IS NOT NULL AND decided_at<=checked_at AND package_verified_sha256 IS NOT NULL))
);
CREATE TABLE content_intake.approval_current (
  review_request_id content_intake.identifier PRIMARY KEY,
  facts_version content_intake.version NOT NULL,
  FOREIGN KEY (review_request_id,facts_version) REFERENCES content_intake.approval_facts
);
-- One durable operation namespace for publish/cancel/rollback, with a typed target.
-- Recovery never depends only on the 24-hour response cache.
CREATE TABLE content_intake.write_attempts (
  actor_id content_intake.identifier NOT NULL REFERENCES content_intake.principals,
  operation_id content_intake.identifier NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish','cancel','rollback')),
  candidate_id content_intake.identifier,
  candidate_version content_intake.version,
  candidate_digest content_intake.sha256,
  rollback_plan_id content_intake.identifier,
  impact_digest content_intake.sha256,
  payload_digest content_intake.sha256 NOT NULL,
  base_release_id TEXT REFERENCES public.content_releases,
  source_evidence_version content_intake.version,
  approval_evidence_version content_intake.version,
  import_batch_id TEXT UNIQUE REFERENCES public.import_batches,
  state TEXT NOT NULL CHECK (state IN ('pending','unknown','published','cancelled','failed')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (actor_id,action,operation_id),
  UNIQUE (actor_id,action,operation_id,candidate_id,candidate_version),
  UNIQUE (actor_id,action,operation_id,rollback_plan_id),
  FOREIGN KEY (candidate_id,candidate_version,candidate_digest) REFERENCES content_intake.candidate_versions(candidate_id,version,digest),
  FOREIGN KEY (candidate_id,candidate_version,source_evidence_version) REFERENCES content_intake.source_confirmations,
  FOREIGN KEY (candidate_id,candidate_version,approval_evidence_version) REFERENCES content_intake.review_bindings(candidate_id,candidate_version,evidence_version),
  FOREIGN KEY (rollback_plan_id,impact_digest) REFERENCES content_intake.rollback_plans(rollback_plan_id,impact_digest),
  FOREIGN KEY (rollback_plan_id,approval_evidence_version) REFERENCES content_intake.review_bindings(rollback_plan_id,evidence_version),
  CHECK ((action IN ('publish','cancel') AND candidate_id IS NOT NULL AND candidate_version IS NOT NULL AND candidate_digest IS NOT NULL AND rollback_plan_id IS NULL AND impact_digest IS NULL)
    OR (action='rollback' AND candidate_id IS NULL AND candidate_version IS NULL AND candidate_digest IS NULL AND rollback_plan_id IS NOT NULL AND impact_digest IS NOT NULL)),
  CHECK ((action='publish' AND source_evidence_version IS NOT NULL AND approval_evidence_version IS NOT NULL)
    OR (action='cancel' AND source_evidence_version IS NULL AND approval_evidence_version IS NULL AND import_batch_id IS NULL)
    OR (action='rollback' AND source_evidence_version IS NULL AND approval_evidence_version IS NOT NULL AND import_batch_id IS NULL))
);
CREATE UNIQUE INDEX candidate_one_uncertain_attempt ON content_intake.write_attempts(candidate_id,candidate_version)
  WHERE action='publish' AND state IN ('pending','unknown');
CREATE UNIQUE INDEX rollback_one_uncertain_attempt ON content_intake.write_attempts(rollback_plan_id)
  WHERE action='rollback' AND state IN ('pending','unknown');
ALTER TABLE public.announcements ADD CONSTRAINT announcement_release_identity UNIQUE (announcement_id,release_id);
-- One permanent publication identity across normal publication and full rollback.
-- Lifetime does not follow idempotency_keys' 24h cache; rows cannot be deleted.
CREATE TABLE content_intake.publications (
  candidate_id content_intake.identifier,
  candidate_version content_intake.version,
  rollback_plan_id content_intake.identifier,
  actor_id content_intake.identifier NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish','rollback')),
  operation_id content_intake.identifier NOT NULL,
  release_id TEXT PRIMARY KEY REFERENCES public.content_releases,
  announcement_id TEXT NOT NULL UNIQUE REFERENCES public.announcements,
  UNIQUE (candidate_id,candidate_version),
  UNIQUE (rollback_plan_id),
  UNIQUE (actor_id,action,operation_id),
  FOREIGN KEY (candidate_id,candidate_version) REFERENCES content_intake.candidate_versions,
  FOREIGN KEY (actor_id,action,operation_id,candidate_id,candidate_version) REFERENCES content_intake.write_attempts(actor_id,action,operation_id,candidate_id,candidate_version),
  FOREIGN KEY (actor_id,action,operation_id,rollback_plan_id) REFERENCES content_intake.write_attempts(actor_id,action,operation_id,rollback_plan_id),
  FOREIGN KEY (announcement_id,release_id) REFERENCES public.announcements(announcement_id,release_id),
  CHECK ((action='publish' AND candidate_id IS NOT NULL AND candidate_version IS NOT NULL AND rollback_plan_id IS NULL)
    OR (action='rollback' AND candidate_id IS NULL AND candidate_version IS NULL AND rollback_plan_id IS NOT NULL))
);
CREATE TABLE content_intake.commit_tickets (
  ticket_hash content_intake.sha256 PRIMARY KEY,
  actor_id content_intake.identifier NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('publish','rollback')),
  operation_id content_intake.identifier NOT NULL,
  candidate_generation content_intake.generation,
  actor_facts_version content_intake.version NOT NULL,
  actor_generation content_intake.generation NOT NULL,
  reviewer_facts_version content_intake.version NOT NULL,
  reviewer_generation content_intake.generation NOT NULL,
  approval_facts_version content_intake.version NOT NULL,
  approval_generation content_intake.generation NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL CHECK (isfinite(issued_at)),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  FOREIGN KEY (actor_id,action,operation_id) REFERENCES content_intake.write_attempts,
  CHECK ((action='publish')=(candidate_generation IS NOT NULL)),
  CHECK (expires_at>issued_at AND expires_at<=issued_at+INTERVAL '60 seconds'),
  CHECK (consumed_at IS NULL OR (consumed_at>=issued_at AND consumed_at<expires_at))
);
-- Exact affected source set (including rollback) is checked under the publication lock.
CREATE TABLE content_intake.commit_ticket_sources (
  ticket_hash content_intake.sha256 NOT NULL REFERENCES content_intake.commit_tickets,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  source_generation content_intake.generation NOT NULL,
  mode_version content_intake.version NOT NULL,
  source_evidence_generation content_intake.generation NOT NULL,
  PRIMARY KEY (ticket_hash,source_id)
);

-- One catalog per existing release; there is no is_current/current_release column here.
-- Material remains in immutable candidate versions; inherited source versions retain
-- their approval lineage and vocabulary display versions. P2 SOP/media are actual empty arrays.
CREATE TABLE content_intake.release_catalogs (
  release_id TEXT PRIMARY KEY REFERENCES public.content_releases,
  format_version TEXT NOT NULL CHECK (format_version='intake-v2.1'),
  sop_nodes JSONB NOT NULL DEFAULT '[]' CHECK (sop_nodes='[]'::jsonb),
  sop_edges JSONB NOT NULL DEFAULT '[]' CHECK (sop_edges='[]'::jsonb),
  media JSONB NOT NULL DEFAULT '[]' CHECK (media='[]'::jsonb)
);
CREATE TABLE content_intake.release_lineage (
  release_id TEXT NOT NULL REFERENCES content_intake.release_catalogs,
  source_id content_intake.identifier NOT NULL,
  business_entry_id content_intake.identifier NOT NULL,
  script_version content_intake.version NOT NULL,
  candidate_id content_intake.identifier NOT NULL,
  candidate_version content_intake.version NOT NULL,
  review_request_id content_intake.identifier NOT NULL REFERENCES content_intake.review_bindings,
  content_valid_until TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (release_id,source_id,business_entry_id),
  FOREIGN KEY (candidate_id,candidate_version,source_id) REFERENCES content_intake.candidate_versions(candidate_id,version,source_id),
  FOREIGN KEY (review_request_id,candidate_id,candidate_version) REFERENCES content_intake.review_bindings(review_request_id,candidate_id,candidate_version)
);
CREATE INDEX release_lineage_review ON content_intake.release_lineage(review_request_id,release_id);
CREATE TABLE content_intake.release_revocations (
  release_id TEXT PRIMARY KEY REFERENCES public.content_releases,
  generation content_intake.version NOT NULL,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 512),
  revoked_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.snapshot_offline_leases ADD CONSTRAINT lease_principal_release_identity UNIQUE (lease_token_hash,user_id,release_id);
CREATE TABLE content_intake.entitlements (
  entitlement_hash content_intake.sha256 PRIMARY KEY,
  principal_id content_intake.identifier NOT NULL,
  user_id TEXT NOT NULL,
  lease_token_hash TEXT NOT NULL UNIQUE REFERENCES public.snapshot_offline_leases,
  release_id TEXT NOT NULL REFERENCES content_intake.release_catalogs,
  shop_id content_intake.identifier NOT NULL,
  context_generation content_intake.version NOT NULL,
  principal_generation content_intake.generation NOT NULL,
  release_generation content_intake.generation NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL CHECK (isfinite(issued_at)),
  valid_until TIMESTAMPTZ NOT NULL,
  FOREIGN KEY (principal_id,user_id) REFERENCES content_intake.principals(principal_id,user_id),
  FOREIGN KEY (lease_token_hash,user_id,release_id) REFERENCES public.snapshot_offline_leases(lease_token_hash,user_id,release_id),
  CHECK (valid_until>issued_at AND valid_until<=issued_at+INTERVAL '5 minutes')
);
CREATE TABLE content_intake.entitlement_scopes (
  entitlement_hash content_intake.sha256 NOT NULL REFERENCES content_intake.entitlements,
  source_id content_intake.identifier NOT NULL REFERENCES content_intake.sources,
  PRIMARY KEY (entitlement_hash,source_id)
);

CREATE FUNCTION content_intake.immutable_history() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='INTAKE_HISTORY_IMMUTABLE';
END;
$$;
CREATE FUNCTION content_intake.candidate_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='CANDIDATE_IMMUTABLE';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['state','source_evidence_version','approval_evidence_version','revocation_generation','updated_at','digest'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','source_evidence_version','approval_evidence_version','revocation_generation','updated_at','digest']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MATERIAL_CHANGED';
  END IF;
  IF NEW.source_evidence_version<OLD.source_evidence_version OR NEW.approval_evidence_version<OLD.approval_evidence_version
    OR NEW.revocation_generation<OLD.revocation_generation OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='VERSION_REGRESSION';
  END IF;
  IF NEW.state<>OLD.state AND NOT (
    (OLD.state='awaiting-evidence' AND NEW.state IN ('ready','cancelled','invalidated')) OR
    (OLD.state='ready' AND NEW.state IN ('awaiting-evidence','publishing','cancelled','invalidated')) OR
    (OLD.state='publishing' AND NEW.state IN ('awaiting-evidence','ready','published','cancelled','invalidated'))
  ) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='CANDIDATE_STATE_TRANSITION'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER candidate_immutable BEFORE UPDATE OR DELETE ON content_intake.candidate_versions
  FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_guard();
CREATE FUNCTION content_intake.candidate_scope_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE s content_intake.scopes; p content_intake.principals;
BEGIN
  IF NEW.state<>'awaiting-evidence' OR NEW.source_evidence_version<>0 OR NEW.approval_evidence_version<>0 OR NEW.revocation_generation<>0 THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='CANDIDATE_INITIAL_STATE';
  END IF;
  SELECT * INTO STRICT s FROM content_intake.scopes WHERE scope_id=NEW.scope_id;
  SELECT * INTO STRICT p FROM content_intake.principals WHERE principal_id=NEW.actor_id;
  IF p.tenant_id<>s.tenant_id OR p.app_id<>s.app_id OR
    NEW.material->'scope' IS DISTINCT FROM jsonb_build_object('tenantId',s.tenant_id,'appId',s.app_id,'brandId',s.brand_id,'shopId',s.shop_id,'domain',s.domain,'sourceId',NEW.source_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_SCOPE_MISMATCH';
  END IF;
  IF NOT (NEW.material->'contributors' ? NEW.actor_id::text)
    OR (SELECT count(*)<>count(DISTINCT value) FROM jsonb_array_elements_text(NEW.material->'contributors'))
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(NEW.material->'contributors') c(value)
      WHERE NOT EXISTS (SELECT 1 FROM content_intake.principals cp WHERE cp.principal_id=c.value AND cp.tenant_id=p.tenant_id AND cp.app_id=p.app_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='CONTRIBUTOR_BINDING';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER candidate_scope BEFORE INSERT ON content_intake.candidate_versions FOR EACH ROW EXECUTE FUNCTION content_intake.candidate_scope_guard();
CREATE FUNCTION content_intake.source_scope_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.source_id<>OLD.source_id OR NEW.scope_id<>OLD.scope_id THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='SOURCE_SCOPE_IMMUTABLE';
  END IF;
  IF NEW.current_mapping_version<OLD.current_mapping_version OR NEW.mode_version<OLD.mode_version OR NEW.revocation_generation<OLD.revocation_generation
    OR (NEW.mode<>OLD.mode AND NEW.mode_version<=OLD.mode_version) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='VERSION_REGRESSION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER source_scope BEFORE UPDATE ON content_intake.sources FOR EACH ROW EXECUTE FUNCTION content_intake.source_scope_guard();
CREATE FUNCTION content_intake.review_binding_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['instance_code','attachment_file_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['instance_code','attachment_file_code'])
    OR (OLD.instance_code IS NOT NULL AND OLD.instance_code IS DISTINCT FROM NEW.instance_code)
    OR (OLD.attachment_file_code IS NOT NULL AND OLD.attachment_file_code IS DISTINCT FROM NEW.attachment_file_code) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_BINDING_IMMUTABLE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_binding_immutable BEFORE UPDATE OR DELETE ON content_intake.review_bindings FOR EACH ROW EXECUTE FUNCTION content_intake.review_binding_guard();
CREATE FUNCTION content_intake.vocabulary_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.vocabulary_id<>OLD.vocabulary_id OR NEW.kind<>OLD.kind OR NEW.scope_id<>OLD.scope_id OR NEW.meaning_digest<>OLD.meaning_digest THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='MEANING_CHANGED';
  END IF;
  IF NOT NEW.active AND EXISTS (SELECT 1 FROM content_intake.candidate_vocabulary WHERE vocabulary_id=OLD.vocabulary_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='VOCABULARY_IN_USE';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vocabulary_semantics BEFORE UPDATE ON content_intake.vocabulary
  FOR EACH ROW EXECUTE FUNCTION content_intake.vocabulary_guard();
CREATE FUNCTION content_intake.principal_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['current_facts_version','revocation_generation']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_facts_version','revocation_generation']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.current_facts_version<OLD.current_facts_version OR NEW.revocation_generation<OLD.revocation_generation THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='VERSION_REGRESSION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER principal_version BEFORE UPDATE OR DELETE ON content_intake.principals FOR EACH ROW EXECUTE FUNCTION content_intake.principal_guard();
CREATE FUNCTION content_intake.approval_current_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE previous content_intake.approval_facts; next_facts content_intake.approval_facts;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_POINTER_IMMUTABLE'; END IF;
  SELECT * INTO STRICT next_facts FROM content_intake.approval_facts WHERE review_request_id=NEW.review_request_id AND facts_version=NEW.facts_version;
  IF TG_OP='UPDATE' THEN
    SELECT * INTO STRICT previous FROM content_intake.approval_facts WHERE review_request_id=OLD.review_request_id AND facts_version=OLD.facts_version;
    IF NEW.review_request_id<>OLD.review_request_id OR NEW.facts_version<OLD.facts_version OR next_facts.revocation_generation<previous.revocation_generation
      OR (previous.state='revoked' AND next_facts.state<>'revoked') THEN
      RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_VERSION_REGRESSION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER approval_pointer BEFORE UPDATE OR DELETE ON content_intake.approval_current FOR EACH ROW EXECUTE FUNCTION content_intake.approval_current_guard();
CREATE FUNCTION content_intake.grant_parent_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE parent content_intake.grants;
BEGIN
  IF NEW.parent_grant_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO STRICT parent FROM content_intake.grants WHERE grant_id=NEW.parent_grant_id;
  IF parent.recipient_id<>NEW.issuer_id OR parent.tenant_id<>NEW.tenant_id OR parent.app_id<>NEW.app_id OR parent.scope_id<>NEW.scope_id
    OR parent.action<>NEW.action OR (parent.source_id IS NOT NULL AND parent.source_id IS DISTINCT FROM NEW.source_id)
    OR parent.starts_at>NEW.starts_at OR parent.expires_at<NEW.expires_at OR parent.revoked_at IS NOT NULL
    OR NOT ((NEW.kind='business' AND parent.kind IN ('allocation','delegation')) OR (NEW.kind='delegation' AND parent.kind='allocation')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='GRANT_PARENT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER grant_parent BEFORE INSERT ON content_intake.grants FOR EACH ROW EXECUTE FUNCTION content_intake.grant_parent_guard();
CREATE FUNCTION content_intake.object_scope_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.source_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM content_intake.sources src JOIN content_intake.scopes s USING(scope_id)
    WHERE src.source_id=NEW.source_id AND s.tenant_id=NEW.tenant_id AND s.app_id=NEW.app_id
  ) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OBJECT_SCOPE_MISMATCH'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER object_scope BEFORE INSERT ON content_intake.objects FOR EACH ROW EXECUTE FUNCTION content_intake.object_scope_guard();
CREATE FUNCTION content_intake.parse_object_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_BINDING_IMMUTABLE'; END IF;
  IF NOT EXISTS (SELECT 1 FROM content_intake.objects WHERE object_id=NEW.object_id AND source_id=NEW.source_id AND actor_id=NEW.actor_id AND purpose='input')
    OR (NEW.report_object_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content_intake.objects WHERE object_id=NEW.report_object_id AND source_id=NEW.source_id AND actor_id=NEW.actor_id AND purpose='report')) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OBJECT_BINDING';
  END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['state','report_object_id','finished_at','result_candidate_id','result_candidate_version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','report_object_id','finished_at','result_candidate_id','result_candidate_version']) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_BINDING_IMMUTABLE';
  END IF;
  IF NOT (NEW.actor_id=ANY(NEW.contributor_ids))
    OR cardinality(NEW.contributor_ids)<>(SELECT count(DISTINCT v) FROM unnest(NEW.contributor_ids) v)
    OR EXISTS (SELECT 1 FROM unnest(NEW.contributor_ids) c(id) WHERE NOT EXISTS (
      SELECT 1 FROM content_intake.principals p JOIN content_intake.principals actor ON actor.principal_id=NEW.actor_id
      WHERE p.principal_id=c.id AND p.tenant_id=actor.tenant_id AND p.app_id=actor.app_id)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_CONTRIBUTOR_BINDING';
  END IF;
  IF NEW.result_candidate_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM content_intake.candidate_versions c WHERE c.candidate_id=NEW.result_candidate_id AND c.version=NEW.result_candidate_version
      AND c.source_version=NEW.source_version AND c.actor_id=NEW.actor_id
      AND (SELECT array_agg(value ORDER BY value) FROM jsonb_array_elements_text(c.material->'contributors'))=
          (SELECT array_agg(v::text ORDER BY v::text) FROM unnest(NEW.contributor_ids) v)
  ) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_RESULT_BINDING'; END IF;
  IF NEW.result_candidate_id IS NOT NULL AND ((NEW.expected_prior_id IS NULL AND NEW.result_candidate_version<>1)
    OR (NEW.expected_prior_id IS NOT NULL AND (NEW.result_candidate_id<>NEW.expected_prior_id OR NEW.result_candidate_version<>NEW.expected_prior_version+1))) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_REVISION_BINDING';
  END IF;
  IF (TG_OP='INSERT' AND NEW.state<>'reading') OR (TG_OP='UPDATE' AND NEW.state<>OLD.state AND NOT (
    (OLD.state='reading' AND NEW.state IN ('parsing','failed','cancelled')) OR
    (OLD.state='parsing' AND NEW.state IN ('validated','failed','cancelled'))
  )) OR (TG_OP='UPDATE' AND OLD.state IN ('validated','failed','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='PARSE_STATE_TRANSITION';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER parse_object BEFORE INSERT OR UPDATE OR DELETE ON content_intake.parse_jobs FOR EACH ROW EXECUTE FUNCTION content_intake.parse_object_guard();
CREATE FUNCTION content_intake.vocabulary_scope_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM content_intake.candidate_versions c JOIN content_intake.scopes cs ON cs.scope_id=c.scope_id
    JOIN content_intake.vocabulary v ON v.vocabulary_id=NEW.vocabulary_id JOIN content_intake.scopes vs ON vs.scope_id=v.scope_id
    WHERE c.candidate_id=NEW.candidate_id AND c.version=NEW.candidate_version AND v.active
      AND (vs.tenant_id,vs.app_id,vs.brand_id,vs.domain)=(cs.tenant_id,cs.app_id,cs.brand_id,cs.domain)
      AND (vs.shop_id IS NULL OR vs.shop_id IS NOT DISTINCT FROM cs.shop_id)
  ) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='VOCABULARY_SCOPE'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vocabulary_scope BEFORE INSERT ON content_intake.candidate_vocabulary FOR EACH ROW EXECUTE FUNCTION content_intake.vocabulary_scope_guard();
CREATE FUNCTION content_intake.review_package_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE obj content_intake.objects;
BEGIN
  SELECT * INTO STRICT obj FROM content_intake.objects WHERE object_id=NEW.package_object_id;
  IF obj.purpose<>'review-package' OR obj.sha256<>NEW.package_sha256 OR obj.tenant_id<>NEW.tenant_id OR obj.app_id<>NEW.app_id THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='REVIEW_PACKAGE_BINDING';
  END IF;
  IF NEW.candidate_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM content_intake.candidate_versions c WHERE c.candidate_id=NEW.candidate_id AND c.version=NEW.candidate_version AND c.source_id=obj.source_id) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='REVIEW_PACKAGE_SOURCE';
  END IF;
  IF NEW.rollback_plan_id IS NOT NULL AND (obj.source_id IS NOT NULL OR NOT EXISTS (
    SELECT 1 FROM content_intake.rollback_plans r JOIN content_intake.principals p ON p.principal_id=r.actor_id
    WHERE r.rollback_plan_id=NEW.rollback_plan_id AND p.tenant_id=NEW.tenant_id AND p.app_id=NEW.app_id
  )) THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='REVIEW_PACKAGE_ROLLBACK'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER review_package BEFORE INSERT ON content_intake.review_bindings FOR EACH ROW EXECUTE FUNCTION content_intake.review_package_guard();
CREATE FUNCTION content_intake.approval_package_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NEW.state='approved' AND NOT EXISTS (SELECT 1 FROM content_intake.review_bindings WHERE review_request_id=NEW.review_request_id AND package_sha256=NEW.package_verified_sha256 AND instance_code IS NOT NULL AND attachment_file_code IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='APPROVAL_PACKAGE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER approval_package BEFORE INSERT ON content_intake.approval_facts FOR EACH ROW EXECUTE FUNCTION content_intake.approval_package_guard();
CREATE FUNCTION content_intake.write_attempt_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OPERATION_IMMUTABLE'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'pending' THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OPERATION_INITIAL_STATE'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['state','import_batch_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','import_batch_id'])
      OR (OLD.import_batch_id IS NOT NULL AND OLD.import_batch_id IS DISTINCT FROM NEW.import_batch_id) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OPERATION_IMMUTABLE';
    END IF;
    IF NEW.state<>OLD.state AND NOT ((OLD.state='pending' AND NEW.state IN ('unknown','published','cancelled','failed')) OR (OLD.state='unknown' AND NEW.state IN ('published','cancelled','failed'))) THEN
      RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='OPERATION_STATE_TRANSITION';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER write_attempt BEFORE INSERT OR UPDATE OR DELETE ON content_intake.write_attempts FOR EACH ROW EXECUTE FUNCTION content_intake.write_attempt_guard();
CREATE FUNCTION content_intake.ticket_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.consumed_at IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_INITIAL_STATE'; END IF;
  ELSIF TG_OP='DELETE' OR (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
    OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_IMMUTABLE_OR_CONSUMED';
  ELSIF clock_timestamp()<NEW.issued_at OR clock_timestamp()>=NEW.expires_at OR NEW.consumed_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='TICKET_EXPIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ticket_once BEFORE INSERT OR UPDATE OR DELETE ON content_intake.commit_tickets FOR EACH ROW EXECUTE FUNCTION content_intake.ticket_guard();
CREATE FUNCTION content_intake.entitlement_lease_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.snapshot_offline_leases WHERE lease_token_hash=NEW.lease_token_hash AND user_id=NEW.user_id AND release_id=NEW.release_id AND NEW.issued_at>=issued_at AND NEW.valid_until<=expires_at) THEN
    RAISE EXCEPTION USING ERRCODE='ZA003', MESSAGE='ENTITLEMENT_LEASE_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER entitlement_lease BEFORE INSERT ON content_intake.entitlements FOR EACH ROW EXECUTE FUNCTION content_intake.entitlement_lease_guard();
DO $$
DECLARE relation TEXT;
BEGIN
  FOREACH relation IN ARRAY ARRAY['scopes','grant_history','role_rule_history','principal_facts','source_mappings','vocabulary_displays','objects',
    'candidate_vocabulary','commit_ticket_sources','source_confirmations','approval_facts','publications','rollback_plans','rollback_scopes','release_catalogs','release_lineage','release_revocations','entitlements','entitlement_scopes'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON content_intake.%I FOR EACH ROW EXECUTE FUNCTION content_intake.immutable_history()',relation);
  END LOOP;
END;
$$;
-- No application role can write half a protocol. The candidate is intentionally sealed
-- until product-side transactions, legacy-write fencing and read gates pass intake tests.
REVOKE ALL ON ALL TABLES IN SCHEMA content_intake FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA content_intake FROM PUBLIC,app_runtime,app_content_admin,app_import_worker,app_backend_auth,app_backend_review,app_backend_worker;
COMMENT ON SCHEMA content_intake IS 'P2 CANDIDATE; storage constraints only; no application grants; runtime/activation/production NOT_CERTIFIED';
