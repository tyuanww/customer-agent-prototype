#!/usr/bin/env bash
# 刷新主体事实（紧急情况下手动调用）
# 用法: ./refresh-principal-facts.sh <principal_id>

set -euo pipefail

if [ $# -lt 1 ]; then
    echo "用法: $0 <principal_id>"
    exit 1
fi

PRINCIPAL_ID="$1"

# 数据库连接参数
DB_HOST="${CUSTOMER_AGENT_DB_HOST:-/Users/hutou/.customer-agent-synthetic-stack/data/pg15-socket}"
DB_PORT="${CUSTOMER_AGENT_DB_PORT:-43199}"
DB_NAME="${CUSTOMER_AGENT_DB_NAME:-customer_agent_synthetic}"
DB_USER="${CUSTOMER_AGENT_DB_USER:-stack_owner}"

PSQL="psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER"

echo "[INFO] 刷新主体事实: $PRINCIPAL_ID"

# 1. 查询当前事实
echo "[INFO] 当前事实状态:"
$PSQL -c "
SELECT
  p.principal_id,
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

# 2. 创建新版本事实
echo "[INFO] 创建新版本事实..."
$PSQL -c "
DO \$\$
DECLARE
  v_department_ids TEXT[];
  v_job_id TEXT;
  v_new_version INT;
  v_digest TEXT;
BEGIN
  -- 获取当前事实
  SELECT f.department_ids, f.job_id
  INTO v_department_ids, v_job_id
  FROM content_intake.principals p
  JOIN content_intake.principal_facts f
    ON f.principal_id = p.principal_id
    AND f.facts_version = p.current_facts_version
  WHERE p.principal_id = '$PRINCIPAL_ID';

  IF NOT FOUND THEN
    RAISE EXCEPTION '主体不存在: $PRINCIPAL_ID';
  END IF;

  -- 计算新版本号
  SELECT COALESCE(MAX(facts_version), 0) + 1
  INTO v_new_version
  FROM content_intake.principal_facts
  WHERE principal_id = '$PRINCIPAL_ID';

  -- 计算摘要
  v_digest := encode(
    sha256(convert_to('$PRINCIPAL_ID' || array_to_string(v_department_ids, ',') || v_job_id, 'UTF8')),
    'hex'
  );

  -- 插入新事实
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
    '$PRINCIPAL_ID',
    v_new_version,
    v_department_ids,
    v_job_id,
    true,
    now(),
    now() + interval '24 hours',
    v_digest
  );

  -- 更新主体的当前版本
  UPDATE content_intake.principals
  SET current_facts_version = v_new_version
  WHERE principal_id = '$PRINCIPAL_ID';

  RAISE NOTICE '新事实版本: %', v_new_version;
END;
\$\$;
"

# 3. 验证新事实
echo "[INFO] 新事实状态:"
$PSQL -c "
SELECT
  p.principal_id,
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

echo "[INFO] 事实刷新完成"
