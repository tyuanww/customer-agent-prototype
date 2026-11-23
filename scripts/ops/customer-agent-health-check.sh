#!/usr/bin/env bash
# Health probe for the Hangzhou stack, driven by a systemd timer.
#
# Probes /ready, NOT /health. /health is static and answers 200 even when every
# dependency is down; /ready is the one that turns 503. The documented failure mode
# ("API crash-loops while the unit still reads active, /ready is already 503") is
# invisible to a /health probe, so probing /health would report all-clear forever.
#
# Exit 0 always: a non-zero exit makes the systemd unit read "failed" and hides the
# distinction between "the site is down" and "the alerting itself is broken".
set -u

ENV_FILE="${CUSTOMER_AGENT_MONITOR_ENV:-/srv/customer-agent/monitor.env}"
# PrivateTmp=yes (set in the unit) gives every invocation its own /tmp, so a counter
# there resets to zero every minute and the threshold is never reached. Keep the
# counter somewhere that survives across runs instead.
STATE_FILE="${CUSTOMER_AGENT_HEALTH_STATE:-/var/lib/customer-agent/health-failures}"
ALERTED_FILE="$STATE_FILE.alerted"
DEFAULT_URL="https://agent-auth.jianghua.site/ready"
THRESHOLD=3
CURL_TIMEOUT=10

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Fails loudly (exit 1) rather than silently probing a default. A probe that cannot
# reach its configuration must not look like a healthy probe.
read_env() {
  local key="$1"
  # --soft: a missing file yields an empty value, not a fatal shell error.
  awk -F= -v keys="$key" '
    BEGIN { split(keys, want, ","); for (i in want) w[want[i]] = 1 }
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    { k = $1; gsub(/^[[:space:]]+|[[:space:]]+$/, "", k);
      if (k in w) { sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); v[k] = $0 } }
    END { for (k in w) print k "=" (k in v ? v[k] : "") }
  ' "$ENV_FILE" 2>/dev/null
}

if [ ! -r "$ENV_FILE" ]; then
  log "FATAL monitor env unreadable: $ENV_FILE"
  exit 1
fi

PROBE_URL="$(read_env CUSTOMER_AGENT_HEALTH_URL | cut -d= -f2-)"
WEBHOOK="$(read_env FEISHU_ALERT_WEBHOOK | cut -d= -f2-)"
PROBE_URL="${PROBE_URL:-$DEFAULT_URL}"

if [ -z "$WEBHOOK" ]; then
  log "FATAL FEISHU_ALERT_WEBHOOK is empty in $ENV_FILE"
  exit 1
fi

mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null || true
failures=0
if [ -r "$STATE_FILE" ]; then
  read -r failures < "$STATE_FILE" 2>/dev/null || failures=0
fi
case "$failures" in
  ''|*[!0-9]*) failures=0 ;;
esac

http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$PROBE_URL" 2>/dev/null || true)"

if [ "$http_code" = "200" ] || [ "$failures" -lt "$THRESHOLD" ]; then
  rm -f -- "$ALERTED_FILE" 2>/dev/null || log "WARN cannot clear alert state at $ALERTED_FILE"
fi

if [ "$http_code" = "200" ]; then
  if [ "$failures" -ne 0 ]; then
    log "recovered: $PROBE_URL answered 200 after $failures failure(s)"
    printf '0\n' > "$STATE_FILE" 2>/dev/null || true
  fi
  exit 0
fi

failures=$((failures + 1))
printf '%s\n' "$failures" > "$STATE_FILE" 2>/dev/null || log "WARN cannot persist counter to $STATE_FILE"
log "probe failed ($failures/$THRESHOLD): url=$PROBE_URL http_code=${http_code:-none}"

if [ "$failures" -lt "$THRESHOLD" ] || [ -f "$ALERTED_FILE" ]; then
  exit 0
fi

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
if FEISHU_ALERT_WEBHOOK="$WEBHOOK" "$SCRIPT_DIR/send-ops-alert.sh" --probe "$failures" "$PROBE_URL" "$http_code" 2>&1; then
  touch -- "$ALERTED_FILE" 2>/dev/null || log "WARN cannot persist alert state at $ALERTED_FILE"
  log "alert sent after $failures consecutive probe failures"
fi
exit 0
