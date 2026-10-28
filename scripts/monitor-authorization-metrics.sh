#!/usr/bin/env bash
# 监控 engineer 角色使用情况和通配符授权性能
# 用法: ./monitor-authorization-metrics.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 数据库连接参数
DB_HOST="${CUSTOMER_AGENT_DB_HOST:-/Users/hutou/.customer-agent-synthetic-stack/data/pg15-socket}"
DB_PORT="${CUSTOMER_AGENT_DB_PORT:-43199}"
DB_NAME="${CUSTOMER_AGENT_DB_NAME:-customer_agent_synthetic}"
DB_USER="${CUSTOMER_AGENT_DB_USER:-stack_owner}"

PSQL="psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

section() {
    echo -e "\n${GREEN}=== $* ===${NC}"
}

# 1. engineer 角色使用情况
section "Engineer 角色使用情况"

info "1.1 Engineer 角色的主体数量"
$PSQL -c "
SELECT count(*) AS engineer_principals
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE r.role = 'engineer'
  AND f.enabled
  AND f.checked_at <= now()
  AND now() < f.valid_until;
"

info "1.2 Engineer 角色的有效授权数量（按动作分组）"
$PSQL -c "
SELECT g.action, count(*) AS grant_count
FROM content_intake.grants g
JOIN content_intake.principals p ON p.principal_id = g.recipient_id
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE r.role = 'engineer'
  AND g.kind = 'business'
  AND g.revoked_at IS NULL
  AND now() BETWEEN g.starts_at AND g.expires_at
GROUP BY g.action
ORDER BY grant_count DESC;
"

info "1.3 Engineer 角色的主体列表"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  f.department_ids,
  f.job_id,
  f.valid_until AT TIME ZONE 'Asia/Shanghai' AS valid_until_cst,
  (
    SELECT count(*)
    FROM content_intake.grants g
    WHERE g.recipient_id = p.principal_id
      AND g.kind = 'business'
      AND g.revoked_at IS NULL
      AND now() BETWEEN g.starts_at AND g.expires_at
  ) AS active_grants
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE r.role = 'engineer'
  AND f.enabled
  AND f.checked_at <= now()
  AND now() < f.valid_until;
"

# 2. 通配符授权情况
section "通配符授权情况"

info "2.1 通配符授权记录数量（按角色分组）"
$PSQL -c "
SELECT
  r.role,
  count(*) AS wildcard_grant_count
FROM content_intake.grants g
JOIN content_intake.principals p ON p.principal_id = g.recipient_id
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
WHERE g.source_id IS NULL
  AND g.kind = 'business'
  AND g.revoked_at IS NULL
  AND now() BETWEEN g.starts_at AND g.expires_at
GROUP BY r.role
ORDER BY wildcard_grant_count DESC;
"

info "2.2 通配符授权详情"
$PSQL -c "
SELECT
  g.recipient_id,
  g.action,
  g.scope_id,
  g.starts_at AT TIME ZONE 'Asia/Shanghai' AS starts_at_cst,
  g.expires_at AT TIME ZONE 'Asia/Shanghai' AS expires_at_cst,
  g.reason
FROM content_intake.grants g
WHERE g.source_id IS NULL
  AND g.kind = 'business'
  AND g.revoked_at IS NULL
  AND now() BETWEEN g.starts_at AND g.expires_at
ORDER BY g.recipient_id, g.action, g.scope_id;
"

# 3. 授权判断性能分析
section "授权判断性能分析（EXPLAIN ANALYZE）"

info "3.1 精确 source_id 授权判断"
$PSQL -c "
EXPLAIN (ANALYZE, BUFFERS)
SELECT content_intake.authorization_deadline(
  'prin_0200eee61a1d3f659e1aa69148cd93a9847939f2',
  'query',
  'scope-menokin-product',
  'src-menokin-faq',
  now()
);
" | head -20

info "3.2 通配符 source_id 授权判断（如果有）"
WILDCARD_PRINCIPAL=$($PSQL -t -A -c "
SELECT recipient_id FROM content_intake.grants
WHERE source_id IS NULL
  AND kind = 'business'
  AND revoked_at IS NULL
  AND now() BETWEEN starts_at AND expires_at
LIMIT 1;
")

if [ -n "$WILDCARD_PRINCIPAL" ]; then
    $PSQL -c "
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT content_intake.authorization_deadline(
      '$WILDCARD_PRINCIPAL',
      'query',
      'scope-menokin-product',
      'src-menokin-faq',
      now()
    );
    " | head -20
else
    echo "未找到通配符授权记录，跳过此测试"
fi

# 4. 角色规则缺失检查
section "角色规则缺失检查"

info "4.1 当前所有角色规则"
$PSQL -c "
SELECT
  tenant_id,
  app_id,
  department_id,
  job_id,
  role,
  policy_version
FROM content_intake.role_rules
ORDER BY tenant_id, app_id, department_id, job_id;
"

info "4.2 缺少角色规则的主体（facts 存在但无匹配规则）"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  f.department_ids,
  f.job_id,
  '缺少角色规则' AS issue
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE f.enabled
  AND f.checked_at <= now()
  AND now() < f.valid_until
  AND NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules r
    WHERE r.tenant_id = p.tenant_id
      AND r.app_id = p.app_id
      AND r.department_id = ANY(f.department_ids)
      AND r.job_id = f.job_id
  );
"

# 5. 汇总报告
section "监控汇总"

echo "
监控时间: $(date '+%Y-%m-%d %H:%M:%S %Z')
数据库: $DB_NAME@$DB_HOST:$DB_PORT

1. Engineer 角色
   - 有效主体数量: 见上述输出
   - 有效授权数量: 见上述输出

2. 通配符授权
   - 记录数量: 见上述输出
   - 性能影响: 见 EXPLAIN ANALYZE 输出

3. 角色规则
   - 总数: 见上述输出
   - 缺失情况: 见上述输出

建议:
- 每日运行此脚本，追踪指标变化
- 如果 Engineer 角色主体数量增长快速，考虑性能优化
- 如果发现缺少角色规则的主体，及时补充规则
- 如果授权判断延迟增加，检查索引和执行计划
"

echo -e "\n${GREEN}[完成]${NC} 监控脚本执行完成"
