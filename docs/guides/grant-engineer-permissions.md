# 授予 Engineer 角色权限

本文档说明如何为 AI 赋能工程师（job-ai-enablement-engineer）授予业务权限。

## 背景

**迁移 0074** 修复了 `authorization_deadline` 函数对 engineer 角色的支持。修复前，该函数硬编码了角色白名单，未包含 engineer，导致 AI 赋能工程师无法通过授权判断。

修复后，函数改用 `role_ceiling` 表的 `business_actions` 字段动态判断，所有在角色上限中定义的角色都能根据其允许的动作通过授权。

## 角色定义

根据 `packages/job-roster/src/index.ts` 和 `content_intake.role_ceiling` 表：

| 岗位 ID | 岗位名称 | 角色 | 允许的业务动作 |
|---------|----------|------|----------------|
| `job-ai-enablement-engineer` | AI赋能工程师 | engineer | query, content-manage, import, source-confirm, review, publish, candidate-cancel, rollback |

## 授权流程

### 1. 确保主体存在

飞书用户通过 `afterLogin` 登录后会自动创建主体和事实：

```sql
-- 查看主体
SELECT 
  p.principal_id,
  p.user_id,
  p.identity_scope,
  f.department_ids,
  f.job_id
FROM content_intake.principals p
JOIN content_intake.principal_facts f 
  ON f.principal_id = p.principal_id 
  AND f.facts_version = p.current_facts_version
WHERE p.user_id LIKE '%ou_5a6b7c%';  -- 替换为实际的 user_id 前缀
```

### 2. 确保角色规则存在

角色规则将部门+岗位映射到角色：

```sql
INSERT INTO content_intake.role_rules (
  tenant_id,
  app_id,
  department_id,
  job_id,
  policy_version,
  role
) VALUES (
  'tenant-menokin',
  'app-customer-agent',
  'dept-hangzhou',
  'job-ai-enablement-engineer',
  1,
  'engineer'
)
ON CONFLICT (tenant_id, app_id, department_id, job_id) DO NOTHING;
```

### 3. 签发授权

授权记录授予主体在特定范围和来源上执行动作的权限：

```sql
INSERT INTO content_intake.grants (
  grant_id,
  kind,
  issuer_id,
  recipient_id,
  tenant_id,
  app_id,
  scope_id,
  source_id,
  action,
  starts_at,
  expires_at,
  reason,
  steward_id,
  policy_version,
  store_set_version
) VALUES (
  'grant_' || encode(sha256(convert_to(
    :recipient_id || ':' || :scope_id || ':' || :source_id || ':' || :action || ':' || now()::text,
    'UTF8'
  )), 'hex'),
  'business',
  'synthetic_owner',           -- 系统管理员签发
  :recipient_id,               -- 替换为实际的 principal_id
  'tenant-menokin',
  'app-customer-agent',
  'scope-menokin-product',
  'src-menokin-faq',          -- 或其他来源
  'query',                     -- 或其他动作
  now(),
  now() + interval '30 days', -- 有效期
  '管理员授权',
  'synthetic_owner',
  1,
  NULL
);
```

**注意：** 授权有效期不能超过事实有效期，否则 `authorization_deadline` 会返回较早的截止时间。

### 4. 验证授权

```sql
SELECT 
  content_intake.authorization_deadline(
    :principal_id,
    'query',
    'scope-menokin-product',
    'src-menokin-faq',
    now()
  ) AT TIME ZONE 'Asia/Shanghai' AS 授权截止时间_CST,
  CASE 
    WHEN content_intake.authorization_deadline(
      :principal_id,
      'query',
      'scope-menokin-product',
      'src-menokin-faq',
      now()
    ) IS NOT NULL THEN '✅ 通过'
    ELSE '❌ 拒绝'
  END AS 判定结果;
```

## 事实刷新

`principal_facts` 有 24 小时有效期限制（约束 `principal_facts_check`）：

```sql
CHECK (valid_until > checked_at AND valid_until <= (checked_at + '24:00:00'::interval))
```

飞书用户每次登录时会刷新事实，创建新版本并更新 `principals.current_facts_version`。如果用户长时间未登录，事实会过期，授权判断会失败。

### 手动刷新事实（仅测试环境）

```sql
BEGIN;

-- 计算新的 facts_digest
\set new_digest `echo "SELECT encode(sha256(convert_to(:principal_id || 'dept-hangzhou' || 'job-ai-enablement-engineer', 'UTF8')), 'hex')" | psql ...`

-- 插入新版本事实
INSERT INTO content_intake.principal_facts (
  principal_id,
  facts_version,
  department_ids,
  job_id,
  enabled,
  checked_at,
  valid_until,
  facts_digest
) VALUES (
  :principal_id,
  (SELECT max(facts_version) + 1 FROM content_intake.principal_facts WHERE principal_id = :principal_id),
  ARRAY['dept-hangzhou'],
  'job-ai-enablement-engineer',
  true,
  now(),
  now() + interval '23 hours 59 minutes',
  :new_digest
);

-- 更新当前版本指针
UPDATE content_intake.principals
SET current_facts_version = (
  SELECT max(facts_version)
  FROM content_intake.principal_facts
  WHERE principal_id = :principal_id
)
WHERE principal_id = :principal_id;

COMMIT;
```

## 常见问题

### Q: 为什么授权判断返回 NULL？

检查以下条件：

1. **事实是否有效：** `f.enabled = true` 且 `f.checked_at <= now() < f.valid_until`
2. **角色规则是否存在：** department_id + job_id 是否匹配
3. **授权是否有效：** `g.revoked_at IS NULL` 且 `g.starts_at <= now() < g.expires_at`
4. **角色是否在上限中：** `role_ceiling.role` 包含该角色且 `business_actions` 包含该动作
5. **角色是否一致：** `count(DISTINCT r.role) = 1`（一个主体只能有一个角色）

### Q: 如何为 engineer 角色授予其他动作？

engineer 角色的 `business_actions` 包括：
- query（查询）
- content-manage（内容管理）
- import（导入）
- source-confirm（来源确认）
- review（审核）
- publish（发布）
- candidate-cancel（候选取消）
- rollback（回滚）

只需在 `grants` 表中插入相应动作的授权记录即可，无需修改函数或迁移。

### Q: 生产环境如何自动签发授权？

当前授权是手动创建的。生产环境建议：

1. **通过管理界面：** 由管理员在权限管理页面为用户分配角色和权限
2. **通过 API：** 调用授权服务的 API 创建授权记录
3. **自动签发：** 根据岗位和部门自动签发基础权限（需要业务逻辑实现）

具体实现需要业务层支持，不在数据库迁移范围内。

## 参考

- 迁移 0074: `packages/database/migrations/0074_authorization_deadline_engineer.sql`
- 角色上限定义: `packages/database/overlays/0030_intake_role_ceiling.sql`
- 岗位定义: `packages/job-roster/src/index.ts`
- 授权判断函数: `content_intake.authorization_deadline`
