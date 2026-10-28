#!/usr/bin/env bash
# 测试 engineer 角色授权功能
# 用法: ./test-engineer-authorization.sh <principal_id>

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
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# 检查参数
if [ $# -lt 1 ]; then
    error "用法: $0 <principal_id>"
    echo "示例: $0 prin_0200eee61a1d3f659e1aa69148cd93a9847939f2"
    exit 1
fi

PRINCIPAL_ID="$1"

info "开始测试 engineer 角色授权"
echo "主体 ID: $PRINCIPAL_ID"
echo "数据库: $DB_NAME@$DB_HOST:$DB_PORT"
echo ""

# 1. 检查主体是否存在
info "1. 检查主体是否存在"
PRINCIPAL_EXISTS=$($PSQL -t -A -c "
SELECT EXISTS(
  SELECT 1 FROM content_intake.principals
  WHERE principal_id = '$PRINCIPAL_ID'
)")

if [ "$PRINCIPAL_EXISTS" != "t" ]; then
    error "主体 $PRINCIPAL_ID 不存在"
    exit 1
fi
echo "✓ 主体存在"

# 2. 检查当前事实
info "2. 检查当前事实"
$PSQL -c "
SELECT
  p.principal_id,
  p.user_id,
  p.current_facts_version,
  f.department_ids,
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
WHERE p.principal_id = '$PRINCIPAL_ID';
"

# 3. 检查角色规则
info "3. 检查角色规则"
$PSQL -c "
SELECT
  r.tenant_id,
  r.app_id,
  r.department_id,
  r.job_id,
  r.role,
  r.policy_version
FROM content_intake.role_rules r
WHERE EXISTS (
  SELECT 1 FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id
    AND f.facts_version = p.current_facts_version
  WHERE p.principal_id = '$PRINCIPAL_ID'
    AND r.tenant_id = p.tenant_id
    AND r.app_id = p.app_id
    AND r.department_id = ANY(f.department_ids)
    AND r.job_id = f.job_id
);
"

# 4. 检查角色上限
info "4. 检查角色上限"
$PSQL -c "
SELECT
  rc.role,
  rc.business_actions
FROM content_intake.role_ceiling rc
WHERE EXISTS (
  SELECT 1 FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id
    AND f.facts_version = p.current_facts_version
  JOIN content_intake.role_rules r
    ON r.tenant_id = p.tenant_id
    AND r.app_id = p.app_id
    AND r.department_id = ANY(f.department_ids)
    AND r.job_id = f.job_id
  WHERE p.principal_id = '$PRINCIPAL_ID'
    AND rc.role = r.role
);
"

# 5. 检查授权记录
info "5. 检查授权记录"
$PSQL -c "
SELECT
  g.grant_id,
  g.action,
  g.scope_id,
  g.source_id,
  g.starts_at AT TIME ZONE 'Asia/Shanghai' AS starts_at_cst,
  g.expires_at AT TIME ZONE 'Asia/Shanghai' AS expires_at_cst,
  g.reason,
  CASE
    WHEN g.revoked_at IS NOT NULL THEN '✗ 已撤销'
    WHEN now() < g.starts_at THEN '⊙ 未生效'
    WHEN now() >= g.expires_at THEN '✗ 已过期'
    ELSE '✓ 有效'
  END AS 状态
FROM content_intake.grants g
WHERE g.recipient_id = '$PRINCIPAL_ID'
ORDER BY g.expires_at DESC;
"

# 6. 测试授权判断（query 动作）
info "6. 测试授权判断"

# 查询所有授权的来源
SOURCES=$($PSQL -t -A -c "
SELECT DISTINCT source_id
FROM content_intake.grants
WHERE recipient_id = '$PRINCIPAL_ID'
  AND action = 'query'
  AND revoked_at IS NULL
  AND starts_at <= now()
  AND now() < expires_at
")

if [ -z "$SOURCES" ]; then
    warn "没有找到有效的 query 授权"
else
    for SOURCE in $SOURCES; do
        SCOPE=$($PSQL -t -A -c "
        SELECT DISTINCT scope_id
        FROM content_intake.grants
        WHERE recipient_id = '$PRINCIPAL_ID'
          AND source_id = '$SOURCE'
        LIMIT 1
        ")

        echo "测试: scope=$SCOPE, source=$SOURCE, action=query"
        $PSQL -c "
        SELECT
          content_intake.authorization_deadline(
            '$PRINCIPAL_ID',
            'query',
            '$SCOPE',
            '$SOURCE',
            now()
          ) AT TIME ZONE 'Asia/Shanghai' AS 授权截止时间_CST,
          CASE
            WHEN content_intake.authorization_deadline(
              '$PRINCIPAL_ID',
              'query',
              '$SCOPE',
              '$SOURCE',
              now()
            ) IS NOT NULL THEN '✅ 通过'
            ELSE '❌ 拒绝'
          END AS 判定结果;
        "
        echo ""
    done
fi

# 7. 总结
info "测试完成"
echo ""
echo "如果授权判断返回 NULL，请检查："
echo "  1. 事实是否已过期（valid_until）"
echo "  2. 角色规则是否存在且匹配"
echo "  3. 授权记录是否有效（未撤销且在有效期内）"
echo "  4. 角色是否在 role_ceiling 中且允许该动作"
echo ""
echo "参考文档: docs/guides/grant-engineer-permissions.md"
