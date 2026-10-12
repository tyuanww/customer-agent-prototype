-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0030_intake_role_ceiling; product overlay (not a frozen contract snapshot slice)
-- contract_set_id=cs-ai-c11-openapi-1.19.0-schema-1.21-240ae98a47d8
-- source_git_sha=240ae98a47d8b9432559c298f60af6fdc9ba8c4e
-- source_schema_sha256=5f958e4f7dcde7e11f9a6d38d8339b96654517209a493776acbfc7c3f5202013
-- 历史 grant 不删除。本函数是当前业务操作的角色上限，没有应用角色授权。
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
  HAVING count(DISTINCT r.role)=1 AND (min(r.role) IN ('director','manager','supervisor','lead') OR (min(r.role) IN ('agent','enabler') AND p_action='query'))
$$;
