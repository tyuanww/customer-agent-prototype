-- 演示 engineer 角色授权功能
-- 用法: psql ... -f demo-engineer-authorization.sql

BEGIN;

-- 1. 刷新 synthetic_owner 的事实（24 小时有效期）
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
  'synthetic_owner',
  (SELECT COALESCE(MAX(facts_version), 0) + 1 FROM content_intake.principal_facts WHERE principal_id = 'synthetic_owner'),
  ARRAY['od-5f8aac16ee49b767696d78fdde09399b', 'od-e80fbf119d641cc1824233f6ef2f3804'],
  '8r1b50z37av37ga',
  true,
  now(),
  now() + interval '23 hours 59 minutes',
  encode(sha256(convert_to('synthetic_owner' || 'od-5f8aac16ee49b767696d78fdde09399b' || '8r1b50z37av37ga', 'UTF8')), 'hex')
);

-- 2. 更新主体的当前事实版本指针
UPDATE content_intake.principals
SET current_facts_version = (
  SELECT MAX(facts_version)
  FROM content_intake.principal_facts
  WHERE principal_id = 'synthetic_owner'
)
WHERE principal_id = 'synthetic_owner';

-- 3. 签发 query 授权（7 天有效期）
-- 注意: business 类授权要求 issuer_id != recipient_id，使用 synthetic_coach 作为签发者
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
  'grant_demo_engineer_query_' || left(encode(sha256(convert_to(now()::text, 'UTF8')), 'hex'), 24),
  'business',
  'synthetic_coach',
  'synthetic_owner',
  'tenant-menokin',
  'app-customer-agent',
  'scope-menokin-product',
  'src-menokin-faq',
  'query',
  now(),
  now() + interval '7 days',
  '演示 engineer 角色授权',
  'synthetic_coach',
  3,
  NULL
)
ON CONFLICT (grant_id) DO NOTHING;

COMMIT;

-- 4. 验证授权判断
\echo ''
\echo '=== 授权判断测试 ==='
\echo ''

SELECT
  content_intake.authorization_deadline(
    'synthetic_owner',
    'query',
    'scope-menokin-product',
    'src-menokin-faq',
    now()
  ) AT TIME ZONE 'Asia/Shanghai' AS 授权截止时间_CST,
  CASE
    WHEN content_intake.authorization_deadline(
      'synthetic_owner',
      'query',
      'scope-menokin-product',
      'src-menokin-faq',
      now()
    ) IS NOT NULL THEN '✅ 通过'
    ELSE '❌ 拒绝'
  END AS 判定结果;

\echo ''
\echo '=== 当前事实状态 ==='
\echo ''

SELECT
  p.principal_id,
  f.facts_version,
  f.job_id,
  f.enabled,
  f.valid_until AT TIME ZONE 'Asia/Shanghai' AS valid_until_cst,
  CASE
    WHEN now() < f.valid_until THEN '✓ 有效'
    ELSE '✗ 已过期'
  END AS 状态
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE p.principal_id = 'synthetic_owner';

\echo ''
\echo '=== 当前授权状态 ==='
\echo ''

SELECT
  g.action,
  g.scope_id,
  g.source_id,
  g.starts_at AT TIME ZONE 'Asia/Shanghai' AS starts_at_cst,
  g.expires_at AT TIME ZONE 'Asia/Shanghai' AS expires_at_cst,
  CASE
    WHEN g.revoked_at IS NOT NULL THEN '✗ 已撤销'
    WHEN now() < g.starts_at THEN '⊙ 未生效'
    WHEN now() >= g.expires_at THEN '✗ 已过期'
    ELSE '✓ 有效'
  END AS 状态
FROM content_intake.grants g
WHERE g.recipient_id = 'synthetic_owner'
  AND g.action = 'query'
ORDER BY g.expires_at DESC
LIMIT 3;

\echo ''
\echo '=== 测试完成 ==='
\echo '详细说明: docs/guides/grant-engineer-permissions.md'
\echo ''
