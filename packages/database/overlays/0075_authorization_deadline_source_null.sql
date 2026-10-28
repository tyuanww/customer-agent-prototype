-- 问题：authorization_deadline 函数无法处理 source_id IS NULL 的授权记录
--      当授权记录的 source_id 为 NULL 时，表示"允许该 scope 的任意 source"
--      但原函数的 EXISTS 子句要求精确匹配 source_id，导致 NULL 授权无法生效
--
-- 修复：调整 EXISTS 子句逻辑，当 g.source_id IS NULL 时跳过 source 存在性检查
--      允许"通配符" source 授权按预期工作
--
-- 影响：source_id IS NULL 的授权记录现在可以通过判断
--      明确指定 source_id 的授权行为保持不变
SET LOCAL search_path = public, pg_catalog, pg_temp;

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
    AND p_action = ANY(rc.business_actions)
  WHERE p.principal_id = p_principal
    AND f.enabled
    AND f.checked_at <= p_at
    AND p_at < f.valid_until
    AND (
      g.source_id IS NULL  -- 允许该 scope 的任意 source（通配符授权）
      OR EXISTS (
        SELECT 1
        FROM content_intake.sources src
        WHERE src.source_id = p_source
          AND src.scope_id = s.scope_id
      )
    )
  GROUP BY f.valid_until
  HAVING count(DISTINCT r.role) = 1
$$;
