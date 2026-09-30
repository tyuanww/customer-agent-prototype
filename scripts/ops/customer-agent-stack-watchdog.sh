#!/usr/bin/env bash
# Restarts the customer-agent stack's own child processes when they die.
#
# Why this is a separate unit rather than a systemd Restart=: the stack unit is
# Type=oneshot and stack.ts detaches four children (postgres, api, worker,
# identity) itself. systemd therefore does NOT supervise them — when the API dies
# alone the unit still reads `active` while /ready is already 503. There is nothing
# for Restart= to restart.
#
# stack.ts start is idempotent: it checks whether each child is live and starts
# only the missing ones, so calling it against a half-dead stack is safe and does
# not disturb the survivors. That is what makes a watchdog this short possible.
#
# Budget: this is a rescue, not a supervisor. It acts only when /ready is not ok,
# takes a lock so two timers cannot overlap, and logs every action so a restart
# loop is visible rather than silent.
set -u

STACK_ROOT="${CUSTOMER_AGENT_STACK_ROOT:-/srv/customer-agent/stack}"
READY_URL="${CUSTOMER_AGENT_READY_URL:-http://127.0.0.1:43115/ready}"
STACK_ENTRY="${CUSTOMER_AGENT_STACK_ENTRY:-/srv/customer-agent/current/scripts/synthetic-stack/stack.ts}"
LOCK_FILE="${CUSTOMER_AGENT_WATCHDOG_LOCK:-/var/lib/customer-agent/stack-watchdog.lock}"
CURL_TIMEOUT=10

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# Lock via mkdir, which is atomic on POSIX and present everywhere. Deliberately NOT
# flock: it is a util-linux tool, and if it were missing the old check would read
# "lock held" and exit 0 forever — a watchdog that looks healthy and never fires.
# A lock left behind by a SIGKILLed run is cleared once it is older than the grace
# period, so one kill cannot disable the watchdog permanently.
LOCK_DIR="$LOCK_FILE.d"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
    log "clearing a stale lock older than 10 minutes: $LOCK_DIR"
    rmdir "$LOCK_DIR" 2>/dev/null || true
    mkdir "$LOCK_DIR" 2>/dev/null || { log "another watchdog run holds the lock; nothing to do"; exit 0; }
  else
    log "another watchdog run holds the lock; nothing to do"
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT INT TERM

http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$READY_URL" 2>/dev/null || true)"
if [ "$http_code" = "200" ]; then
  exit 0
fi

log "not ready (http_code=${http_code:-none}) url=$READY_URL; running stack start"

# start, not restart: the survivors must not be disturbed. --no-seed matches the
# unit's own ExecStart, so this cannot change what content exists.
if ! command -v node >/dev/null 2>&1; then
  log "FATAL node not on PATH; cannot restart"
  exit 1
fi
if [ ! -f "$STACK_ENTRY" ]; then
  log "FATAL stack entry not found: $STACK_ENTRY"
  exit 1
fi

if out="$(cd "$STACK_ROOT/.." && node "$STACK_ENTRY" start --no-seed 2>&1)"; then
  log "stack start completed"
else
  log "stack start FAILED (exit $?)"
fi
# The child's own lines are the useful part; print them at the same timestamps.
printf '%s\n' "$out" | while IFS= read -r line; do log "  $line"; done

# Re-probe once so the log says whether the rescue worked, rather than leaving the
# next timer tick to discover it.
sleep 5
after="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$CURL_TIMEOUT" "$READY_URL" 2>/dev/null || true)"
log "re-probe after restart: http_code=${after:-none}"
exit 0
