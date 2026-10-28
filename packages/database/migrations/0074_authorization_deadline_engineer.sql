-- GENERATED FILE. DO NOT EDIT. Run `pnpm db:migrations:generate` from the repository root.
-- 0074_authorization_deadline_engineer; 修复 authorization_deadline 对 engineer 角色的支持
-- contract_set_id=cs-ai-c11-openapi-1.22.0-schema-1.25-db6ba13d4780
-- source_git_sha=0e826ceee296ce38297dc6a5fdbce84b4bfc782a
-- source_schema_sha256=0620ee58a19543736f58b8dcf54ad5a2d0865cd48a74e24a245bbb384f1b7998
SET LOCAL search_path = public, pg_catalog, pg_temp;

-- 问题：原函数在 HAVING 子句硬编码角色列表 (director, manager, supervisor, lead, agent, enabler)
--      未包含 engineer 角色，导致 AI 赋能工程师（job-ai-enablement-engineer）无法通过授权判断
--
-- 修复：改用 role_ceiling 表的 business_actions 字段动态判断角色权限
--      通过 JOIN role_ceiling 并检查 p_action = ANY(rc.business_actions) 实现通用性
--
-- 影响：所有 role_ceiling 中定义的角色（包括 engineer）现在都能根据其 business_actions 通过授权
--      保留原有的角色一致性检查（count(DISTINCT r.role) = 1）

CREATE OR REPLACE FUNCTION content_intake.authorization_deadline(
  p_principal TEXT,
  p_action TEXT,
  p_scope TEXT,
  p_source TEXT,
  p_at TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE SQL
STABLE
SET search_path = pg_catalog
AS $$
  SELECT least(f.valid_until, max(g.expires_at))
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id
    AND f.facts_version = p.current_facts_version
  JOIN content_intake.scopes s
    ON s.scope_id = p_scope
    AND s.tenant_id = p.tenant_id
    AND s.app_id = p.app_id
  JOIN content_intake.grants g
    ON g.recipient_id = p.principal_id
    AND g.scope_id = s.scope_id
    AND g.action = p_action
    AND g.kind = 'business'
    AND g.revoked_at IS NULL
    AND (g.source_id IS NULL OR g.source_id = p_source)
    AND g.starts_at <= p_at
    AND p_at < g.expires_at
  JOIN content_intake.role_rules r
    ON r.tenant_id = p.tenant_id
    AND r.app_id = p.app_id
    AND r.department_id = ANY(f.department_ids)
    AND r.job_id = f.job_id
  JOIN content_intake.role_ceiling rc
    ON rc.role = r.role
    AND p_action = ANY(rc.business_actions)  -- 动态检查角色是否允许该动作
  WHERE p.principal_id = p_principal
    AND f.enabled
    AND f.checked_at <= p_at
    AND p_at < f.valid_until
    AND EXISTS (
      SELECT 1
      FROM content_intake.sources src
      WHERE src.source_id = p_source
        AND src.scope_id = s.scope_id
    )
  GROUP BY f.valid_until
  HAVING count(DISTINCT r.role) = 1  -- 仍要求角色一致性：一个主体只能有一个角色
$$;
