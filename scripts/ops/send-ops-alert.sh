#!/usr/bin/env bash
set -u

CODE="${1:-}"
case "$CODE" in
  LEASE_REFRESH_FAILED|BACKUP_FAILED) ;;
  *) exit 2 ;;
esac

ENV_FILE="${CUSTOMER_AGENT_MONITOR_ENV:-/srv/customer-agent/monitor.env}"
WEBHOOK="${FEISHU_ALERT_WEBHOOK:-}"
if [ -z "$WEBHOOK" ] && [ -r "$ENV_FILE" ]; then
  WEBHOOK="$(awk -F= -v key=FEISHU_ALERT_WEBHOOK '
    BEGIN { value = "" }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    { k = $1; gsub(/^[[:space:]]+|[[:space:]]+$/, "", k);
      if (k == key) { sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); value = $0 } }
    END { print value }
  ' "$ENV_FILE")"
fi
if [ -z "$WEBHOOK" ]; then
  exit 0
fi
case "$WEBHOOK" in
  http://*|https://*) ;;
  *) printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "WARN alert webhook is not http" >&2
     exit 0 ;;
esac

payload="$(printf '{"diagnostic":"%s","text":"backup failed"}' "$CODE")"
if curl -s -o /dev/null --max-time 10 \
  -H 'Content-Type: application/json' -d "$payload" "$WEBHOOK"; then
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "alert sent diagnostic=$CODE"
  exit 0
fi
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "WARN alert delivery failed" >&2
exit 0
