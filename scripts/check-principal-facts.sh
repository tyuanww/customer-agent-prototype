#!/usr/bin/env bash
# 检查主体事实状态
# 用法: ./check-principal-facts.sh

set -euo pipefail

# 数据库连接参数
DB_HOST="${CUSTOMER_AGENT_DB_HOST:-/Users/hutou/.customer-agent-synthetic-stack/data/pg15-socket}"
DB_PORT="${CUSTOMER_AGENT_DB_PORT:-43199}"
DB_NAME="${CUSTOMER_AGENT_DB_NAME:-customer_agent_synthetic}"
DB_USER="${CUSTOMER_AGENT_DB_USER:-stack_owner}"

PSQL="psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER"

echo "=== 主体事实健康检查 ==="
echo ""

# 1. 总体统计
echo "1. 总体统计"
$PSQL -c "
SELECT
  count(*) AS 总主体数,
  count(*) FILTER (WHERE now() < f.valid_until) AS 有效主体数,
  count(*) FILTER (WHERE now() >= f.valid_until) AS 过期主体数,
  round(100.0 * count(*) FILTER (WHERE now() >= f.valid_until) / count(*), 2) AS 过期率
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version;
"

# 2. 按角色统计
echo ""
echo "2. 按角色统计"
$PSQL -c "
SELECT
  r.role,
  count(*) AS 主体数,
  count(*) FILTER (WHERE now() < f.valid_until) AS 有效数,
  count(*) FILTER (WHERE now() >= f.valid_until) AS 过期数
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
LEFT JOIN content_intake.role_rules r
  ON r.tenant_id = p.tenant_id
  AND r.app_id = p.app_id
  AND r.department_id = ANY(f.department_ids)
  AND r.job_id = f.job_id
GROUP BY r.role
ORDER BY 主体数 DESC;
"

# 3. 即将过期的事实（24 小时内）
echo ""
echo "3. 即将过期的事实（24 小时内）"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  f.job_id,
  f.valid_until AT TIME ZONE 'Asia/Shanghai' AS valid_until_cst,
  extract(epoch from (f.valid_until - now())) / 3600 AS 剩余小时
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE f.valid_until BETWEEN now() AND now() + interval '24 hours'
ORDER BY f.valid_until;
"

# 4. 已过期的事实（需要刷新）
echo ""
echo "4. 已过期的事实（需要刷新）"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  f.job_id,
  f.valid_until AT TIME ZONE 'Asia/Shanghai' AS valid_until_cst,
  extract(epoch from (now() - f.valid_until)) / 3600 AS 过期小时
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE now() >= f.valid_until
ORDER BY f.valid_until;
"

# 5. 缺少角色规则的主体
echo ""
echo "5. 缺少角色规则的主体"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  f.department_ids,
  f.job_id,
  '需要配置角色规则' AS 问题
FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE f.enabled
  AND now() < f.valid_until
  AND NOT EXISTS (
    SELECT 1 FROM content_intake.role_rules r
    WHERE r.tenant_id = p.tenant_id
      AND r.app_id = p.app_id
      AND r.department_id = ANY(f.department_ids)
      AND r.job_id = f.job_id
  );
"

echo ""
echo "=== 检查完成 ==="
