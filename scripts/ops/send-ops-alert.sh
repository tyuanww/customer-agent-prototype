#!/usr/bin/env bash
set -u

CODE="${1:-}"
case "$CODE" in
  LEASE_REFRESH_FAILED|BACKUP_FAILED) message="[customer-agent] $CODE" ;;
  --probe)
    [ "$#" -eq 4 ] || exit 2
    printf -v message '[customer-agent] %s 探针连续失败 %s 次\nURL: %s\nHTTP: %s' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$3" "${4:-none}"
    ;;
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
     exit 1 ;;
esac

payload="$(node -e 'process.stdout.write(JSON.stringify({ msg_type: "text", content: { text: process.argv[1] } }))' -- "$message")" || exit 1
http_code=none
if reply="$(curl -s --max-time 10 --max-filesize 16384 --proto '=http,https' -w '\n%{http_code}' \
  -H 'Content-Type: application/json' -d "$payload" -- "$WEBHOOK")"; then
  http_code="${reply##*$'\n'}"
  if [[ "$http_code" == 2[0-9][0-9] ]] && printf '%s' "${reply%$'\n'*}" | node -e '
    try {
      const reply = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      process.exitCode = (Object.hasOwn(reply, "code") ? reply.code : reply.StatusCode) === 0 ? 0 : 1;
    } catch {
      process.exitCode = 1;
    }
  '; then
    if [ "$CODE" != "--probe" ]; then
      printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "alert sent diagnostic=$CODE"
    fi
    exit 0
  fi
fi
printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "WARN alert delivery failed (http_code=$http_code)" >&2
exit 1
