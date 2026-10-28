#!/usr/bin/env bash
# 监控 engineer 角色使用情况和通配符授权性能，并发送告警
# 用法: ./monitor-and-alert.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 配置
DB_HOST="${CUSTOMER_AGENT_DB_HOST:-/Users/hutou/.customer-agent-synthetic-stack/data/pg15-socket}"
DB_PORT="${CUSTOMER_AGENT_DB_PORT:-43199}"
DB_NAME="${CUSTOMER_AGENT_DB_NAME:-customer_agent_synthetic}"
DB_USER="${CUSTOMER_AGENT_DB_USER:-stack_owner}"

PSQL="psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER"

# 告警阈值
THRESHOLD_AUTH_SUCCESS_RATE=95  # 授权成功率低于 95% 告警
THRESHOLD_P99_LATENCY_MS=50     # P99 延迟超过 50ms 告警
THRESHOLD_FACT_EXPIRY_RATE=5    # 事实过期率超过 5% 告警
THRESHOLD_POLICY_PENDING_RATE=1 # policy-pending 率超过 1% 告警

# 通知配置
EMAIL_TO="5DJgDkyjvPY1E@shinemage.cn"
FEISHU_GROUP="customer-agent-health"
LOG_DIR="${CUSTOMER_AGENT_LOG_DIR:-$PROJECT_ROOT/logs}"
METRICS_FILE="$LOG_DIR/auth-metrics-$(date +%Y%m%d).json"

# 确保日志目录存在
mkdir -p "$LOG_DIR" 2>/dev/null || {
    # 回退到临时目录
    LOG_DIR="/tmp/customer-agent-logs"
    mkdir -p "$LOG_DIR"
    warn "无法创建日志目录，回退到: $LOG_DIR"
}

# 颜色输出
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

info() {
    echo -e "${GREEN}[INFO]${NC} $*"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $*"
}

error() {
    echo -e "${RED}[ERROR]${NC} $*"
}

# 发送邮件告警
send_email_alert() {
    local subject="$1"
    local body="$2"

    echo "$body" | mail -s "[授权监控告警] $subject" "$EMAIL_TO" || {
        error "邮件发送失败"
        return 1
    }
    info "邮件告警已发送: $subject"
}

# 发送飞书告警
send_feishu_alert() {
    local title="$1"
    local content="$2"

    # 使用 lark-cli 发送消息到群聊
    lark-cli im message send \
        --chat-title "$FEISHU_GROUP" \
        --text "【授权监控告警】
$title

$content

时间: $(date '+%Y-%m-%d %H:%M:%S')
数据库: $DB_NAME@$DB_HOST:$DB_PORT" || {
        error "飞书消息发送失败"
        return 1
    }
    info "飞书告警已发送: $title"
}

# 1. 收集指标
info "开始收集授权指标..."

# 1.1 Engineer 角色主体数量
engineer_principals=$($PSQL -t -A -c "
SELECT count(*) FROM content_intake.principals p
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
" 2>/dev/null || echo "0")

# 1.2 授权记录数量
grant_count=$($PSQL -t -A -c "
SELECT count(*) FROM content_intake.grants
WHERE kind = 'business'
  AND revoked_at IS NULL
  AND now() BETWEEN starts_at AND expires_at;
" 2>/dev/null || echo "0")

# 1.3 授权判断性能（采样 10 次取平均）
info "采样授权判断性能..."
total_ms=0
success_count=0
for i in {1..10}; do
    # 随机选择一个有效主体
    principal=$($PSQL -t -A -c "
    SELECT p.principal_id FROM content_intake.principals p
    JOIN content_intake.principal_facts f
      ON f.principal_id = p.principal_id
      AND f.facts_version = p.current_facts_version
    WHERE f.enabled AND now() < f.valid_until
    ORDER BY random() LIMIT 1;
    " 2>/dev/null || echo "")

    if [ -z "$principal" ]; then
        continue
    fi

    # 随机选择一个 scope 和 source
    scope_source=$($PSQL -t -A -c "
    SELECT g.scope_id, COALESCE(g.source_id, src.source_id)
    FROM content_intake.grants g
    JOIN content_intake.sources src ON src.scope_id = g.scope_id
    WHERE g.recipient_id = '$principal'
      AND g.kind = 'business'
      AND g.revoked_at IS NULL
      AND now() BETWEEN g.starts_at AND g.expires_at
    LIMIT 1;
    " 2>/dev/null | tr '\t' ' ' || echo "")

    if [ -z "$scope_source" ]; then
        continue
    fi

    read scope source <<< "$scope_source"

    # 执行授权判断并测量时间
    start_ms=$(date +%s%3N)
    result=$($PSQL -t -A -c "
    SELECT content_intake.authorization_deadline(
      '$principal', 'query', '$scope', '$source', now()
    );
    " 2>/dev/null || echo "")
    end_ms=$(date +%s%3N)

    if [ -n "$result" ] && [ "$result" != "" ]; then
        duration=$((end_ms - start_ms))
        total_ms=$((total_ms + duration))
        success_count=$((success_count + 1))
    fi
done

if [ $success_count -gt 0 ]; then
    avg_latency_ms=$((total_ms / success_count))
else
    avg_latency_ms=0
fi

# 1.4 事实过期情况
total_facts=$($PSQL -t -A -c "
SELECT count(*) FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version;
" 2>/dev/null || echo "0")

expired_facts=$($PSQL -t -A -c "
SELECT count(*) FROM content_intake.principals p
JOIN content_intake.principal_facts f
  ON f.principal_id = p.principal_id
  AND f.facts_version = p.current_facts_version
WHERE now() >= f.valid_until;
" 2>/dev/null || echo "0")

if [ $total_facts -gt 0 ]; then
    fact_expiry_rate=$((expired_facts * 100 / total_facts))
else
    fact_expiry_rate=0
fi

# 1.5 授权成功率（估算：有效授权数 / 总主体数）
if [ $total_facts -gt 0 ]; then
    auth_success_rate=$((grant_count * 100 / total_facts))
else
    auth_success_rate=0
fi

# 2. 保存指标到 JSON
cat > "$METRICS_FILE" <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "database": "$DB_NAME",
  "metrics": {
    "engineer_principals": $engineer_principals,
    "total_principals": $total_facts,
    "active_grants": $grant_count,
    "expired_facts": $expired_facts,
    "fact_expiry_rate_percent": $fact_expiry_rate,
    "auth_success_rate_percent": $auth_success_rate,
    "avg_latency_ms": $avg_latency_ms,
    "latency_samples": $success_count
  },
  "thresholds": {
    "auth_success_rate_min": $THRESHOLD_AUTH_SUCCESS_RATE,
    "p99_latency_max_ms": $THRESHOLD_P99_LATENCY_MS,
    "fact_expiry_rate_max": $THRESHOLD_FACT_EXPIRY_RATE
  }
}
EOF

info "指标已保存到 $METRICS_FILE"

# 3. 检查告警条件
alert_triggered=0
alert_messages=()

# 3.1 检查授权成功率
if [ $auth_success_rate -lt $THRESHOLD_AUTH_SUCCESS_RATE ]; then
    alert_triggered=1
    msg="授权成功率低于阈值: ${auth_success_rate}% < ${THRESHOLD_AUTH_SUCCESS_RATE}%"
    alert_messages+=("$msg")
    error "告警: $msg"
fi

# 3.2 检查授权判断延迟
if [ $avg_latency_ms -gt $THRESHOLD_P99_LATENCY_MS ]; then
    alert_triggered=1
    msg="授权判断延迟超过阈值: ${avg_latency_ms}ms > ${THRESHOLD_P99_LATENCY_MS}ms"
    alert_messages+=("$msg")
    error "告警: $msg"
fi

# 3.3 检查事实过期率
if [ $fact_expiry_rate -gt $THRESHOLD_FACT_EXPIRY_RATE ]; then
    alert_triggered=1
    msg="事实过期率超过阈值: ${fact_expiry_rate}% > ${THRESHOLD_FACT_EXPIRY_RATE}%"
    alert_messages+=("$msg")
    error "告警: $msg"
fi

# 3.4 检查数据库连接
if ! $PSQL -c "SELECT 1" > /dev/null 2>&1; then
    alert_triggered=1
    msg="数据库连接失败"
    alert_messages+=("$msg")
    error "告警: $msg"
fi

# 4. 发送告警
if [ $alert_triggered -eq 1 ]; then
    alert_body="授权监控检测到以下问题:

$(printf '%s\n' "${alert_messages[@]}")

当前指标:
- Engineer 角色主体数: $engineer_principals
- 总主体数: $total_facts
- 有效授权数: $grant_count
- 过期事实数: $expired_facts
- 事实过期率: ${fact_expiry_rate}%
- 授权成功率: ${auth_success_rate}%
- 平均授权判断延迟: ${avg_latency_ms}ms

详细指标: $METRICS_FILE

故障排查指南:
1. 检查数据库状态: psql ... -c \"SELECT count(*) FROM content_intake.principals\"
2. 检查事实有效期: bash $SCRIPT_DIR/check-principal-facts.sh
3. 查看完整监控报告: bash $SCRIPT_DIR/monitor-authorization-metrics.sh
4. 参考文档: $PROJECT_ROOT/docs/authorization-model.md 第七节"故障排查"

时间: $(date '+%Y-%m-%d %H:%M:%S')
数据库: $DB_NAME@$DB_HOST:$DB_PORT"

    # 发送邮件
    send_email_alert "授权监控告警" "$alert_body"

    # 发送飞书
    send_feishu_alert "授权监控告警" "$(printf '%s\n' "${alert_messages[@]}")"
else
    info "所有指标正常，无需告警"

    # 发送每日摘要（仅工作日 09:00）
    if [ "$(date +%H)" = "09" ] && [ "$(date +%u)" -lt 6 ]; then
        summary="授权监控每日摘要

当前指标:
✓ Engineer 角色主体数: $engineer_principals
✓ 总主体数: $total_facts
✓ 有效授权数: $grant_count
✓ 过期事实数: $expired_facts
✓ 事实过期率: ${fact_expiry_rate}% (阈值: ${THRESHOLD_FACT_EXPIRY_RATE}%)
✓ 授权成功率: ${auth_success_rate}% (阈值: ${THRESHOLD_AUTH_SUCCESS_RATE}%)
✓ 平均授权判断延迟: ${avg_latency_ms}ms (阈值: ${THRESHOLD_P99_LATENCY_MS}ms)

所有指标正常。"

        send_feishu_alert "授权监控每日摘要" "$summary"
    fi
fi

# 5. 清理旧日志（保留 30 天）
find "$LOG_DIR" -name "auth-metrics-*.json" -mtime +30 -delete 2>/dev/null || true

info "监控完成"
exit 0
