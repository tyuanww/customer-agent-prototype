-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0031_intake_direct_v1_22; source schema.v1.22 lines 12797-12897
-- contract_set_id=cs-ai-c11-openapi-1.20.0-schema-1.22-6f318d448929
-- source_git_sha=6f318d448929d1a87c5dc9e725ea4f90c48a4b97
-- source_schema_sha256=c5e4896e8ed1ff587e23a70723bd9d81c056ba65561cd9d94963aa6b5f1ae3ce
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- DRAFT direct-publication storage. Existing rows retain approval-v1 forever.
-- No application grants or runtime activation; product transaction/reader overlays
-- must be upgraded together before direct-v1 can be used.
SET search_path = public, pg_catalog;
ALTER TABLE content_intake.candidate_versions
  ADD COLUMN publication_policy TEXT NOT NULL DEFAULT 'approval-v1'
    CHECK (publication_policy IN ('approval-v1','direct-v1')),
  ADD UNIQUE(candidate_id,version,publication_policy);
ALTER TABLE content_intake.write_attempts
  ADD COLUMN publication_policy TEXT NOT NULL DEFAULT 'approval-v1'
    CHECK (publication_policy IN ('approval-v1','direct-v1')),
  ADD UNIQUE(actor_id,action,operation_id,publication_policy),
  ADD FOREIGN KEY(candidate_id,candidate_version,publication_policy)
    REFERENCES content_intake.candidate_versions(candidate_id,version,publication_policy);
-- The frozen predecessor used unnamed constraints. Resolve the unique approval
-- gate by its definition and fail closed if the predecessor no longer matches.
DO $$
DECLARE t TEXT; names TEXT[];
BEGIN
  FOREACH t IN ARRAY ARRAY['candidate_versions','write_attempts'] LOOP
    SELECT array_agg(conname) INTO names FROM pg_constraint
      WHERE conrelid=format('content_intake.%I',t)::regclass AND contype='c'
        AND pg_get_constraintdef(oid) LIKE '%approval_evidence_version%';
    IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Unexpected predecessor approval constraint: %',t; END IF;
    EXECUTE format('ALTER TABLE content_intake.%I DROP CONSTRAINT %I',t,names[1]);
  END LOOP;
END;
$$;
ALTER TABLE content_intake.candidate_versions
  ADD CONSTRAINT candidate_publication_readiness CHECK (
    (publication_policy<>'direct-v1' OR approval_evidence_version=0)
    AND (state NOT IN ('ready','publishing','published') OR
      (source_evidence_version>0 AND (publication_policy='direct-v1' OR approval_evidence_version>0))));
ALTER TABLE content_intake.write_attempts
  ADD CONSTRAINT attempt_publication_evidence CHECK (
    (action='cancel' AND source_evidence_version IS NULL AND approval_evidence_version IS NULL AND import_batch_id IS NULL)
    OR (action IN ('publish','rollback')
      AND ((action='publish' AND source_evidence_version IS NOT NULL)
        OR (action='rollback' AND source_evidence_version IS NULL AND import_batch_id IS NULL))
      AND ((publication_policy='approval-v1' AND approval_evidence_version IS NOT NULL)
        OR (publication_policy='direct-v1' AND approval_evidence_version IS NULL))));
ALTER TABLE content_intake.commit_tickets
  ADD COLUMN publication_policy TEXT NOT NULL DEFAULT 'approval-v1'
    CHECK (publication_policy IN ('approval-v1','direct-v1')),
  ALTER COLUMN reviewer_facts_version DROP NOT NULL,
  ALTER COLUMN reviewer_generation DROP NOT NULL,
  ALTER COLUMN approval_facts_version DROP NOT NULL,
  ALTER COLUMN approval_generation DROP NOT NULL,
  ADD FOREIGN KEY(actor_id,action,operation_id,publication_policy)
    REFERENCES content_intake.write_attempts(actor_id,action,operation_id,publication_policy),
  ADD CONSTRAINT ticket_publication_evidence CHECK (
    (publication_policy='approval-v1' AND reviewer_facts_version IS NOT NULL AND reviewer_generation IS NOT NULL
      AND approval_facts_version IS NOT NULL AND approval_generation IS NOT NULL)
    OR (publication_policy='direct-v1' AND reviewer_facts_version IS NULL AND reviewer_generation IS NULL
      AND approval_facts_version IS NULL AND approval_generation IS NULL));
ALTER TABLE content_intake.publications
  ADD COLUMN publication_policy TEXT NOT NULL DEFAULT 'approval-v1'
    CHECK (publication_policy IN ('approval-v1','direct-v1')),
  ADD COLUMN confirmed_at TIMESTAMPTZ,
  ADD FOREIGN KEY(actor_id,action,operation_id,publication_policy)
    REFERENCES content_intake.write_attempts(actor_id,action,operation_id,publication_policy),
  ADD FOREIGN KEY(candidate_id,candidate_version,publication_policy)
    REFERENCES content_intake.candidate_versions(candidate_id,version,publication_policy),
  ADD CONSTRAINT publication_confirmation CHECK (
    (publication_policy='approval-v1' AND confirmed_at IS NULL)
    OR (publication_policy='direct-v1' AND confirmed_at IS NOT NULL AND isfinite(confirmed_at)));
ALTER TABLE content_intake.release_lineage
  ADD COLUMN publication_policy TEXT NOT NULL DEFAULT 'approval-v1'
    CHECK (publication_policy IN ('approval-v1','direct-v1')),
  ALTER COLUMN review_request_id DROP NOT NULL,
  ADD FOREIGN KEY(candidate_id,candidate_version,publication_policy)
    REFERENCES content_intake.candidate_versions(candidate_id,version,publication_policy),
  ADD CONSTRAINT lineage_publication_evidence CHECK (
    (publication_policy='approval-v1' AND review_request_id IS NOT NULL)
    OR (publication_policy='direct-v1' AND review_request_id IS NULL));
-- Existing candidate/attempt/publication/lineage mutation guards include these
-- new columns in their immutable projections. No historical policy is rewritten.
RESET search_path;

-- 不删除历史 grant。enabler/agent 的旧非 query 授权不再放行新业务操作。
-- 本函数不授予应用角色，也不证明分配凭证。旧 grant 与旧 approval-v1 行不改写成 direct-v1。
-- 分配谓词没有对应函数：不在这里新造，也不新增审批表。兼容规则见 17 号规范。
CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
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
  HAVING count(DISTINCT r.role)=1
    AND (min(r.role) IN ('director','manager','supervisor','lead')
      OR (min(r.role) IN ('agent','enabler') AND p_action='query'))
$$;
