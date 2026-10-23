#!/usr/bin/env bash
# Restores a nightly dump into a scratch database and proves it is a usable backup.
#
# This never writes to the production catalog. It creates `customer_agent_restore_drill`,
# restores into it, compares the migration ledger with the live database, then drops the
# scratch database. The live stack's /ready is checked before and after to show the drill
# did not disturb it.
#
# What "usable" means here, and what it does not:
#   - the dump replays without error into an empty database;
#   - the migration ledger has the same row count and the same last migration id;
#   - a table count from the restored catalog matches the live one.
# It does NOT run the migration verifier, the API, or any query path against the
# restored data. Rehearsing the application against a restored catalog is a separate,
# heavier step and is not proven by this script.
#
# Exit 0 = drill passed, 1 = drill failed. The scratch database is dropped either way
# unless CUSTOMER_AGENT_DRILL_KEEP=1, which leaves it for inspection.
set -u

STACK_ROOT="${CUSTOMER_AGENT_STACK_ROOT:-/srv/customer-agent/stack}"
PG_BIN="${CUSTOMER_AGENT_PG15_BIN:-/opt/pg15/usr/lib/postgresql/15/bin}"
BACKUP_ROOT="${CUSTOMER_AGENT_BACKUP_ROOT:-/srv/customer-agent/backups}"
PG_USER="${CUSTOMER_AGENT_BACKUP_USER:-stack_owner}"
PG_PORT="${CUSTOMER_AGENT_BACKUP_PORT:-43199}"
PG_SOCKET="${CUSTOMER_AGENT_BACKUP_SOCKET:-$STACK_ROOT/data/pg15-socket}"
DRILL_DB="${CUSTOMER_AGENT_DRILL_DATABASE:-customer_agent_restore_drill}"
READY_URL="${CUSTOMER_AGENT_READY_URL:-http://127.0.0.1:43115/ready}"
KEEP="${CUSTOMER_AGENT_DRILL_KEEP:-0}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAIL $*"; exit 1; }
pass() { log "PASS $*"; }

psql_db() { "$PG_BIN/psql" -h "$PG_SOCKET" -p "$PG_PORT" -U "$PG_USER" -At -d "$1" -c "$2"; }

[ -x "$PG_BIN/pg_restore" ] || fail "pg_restore not found under $PG_BIN"
[ -S "$PG_SOCKET/.s.PGSQL.$PG_PORT" ] || fail "no PostgreSQL socket at $PG_SOCKET"

# Same source of truth as the backup: content.env, not a hardcoded name.
SOURCE_DB="${CUSTOMER_AGENT_BACKUP_DATABASE:-}"
if [ -z "$SOURCE_DB" ]; then
  CONTENTS="$STACK_ROOT/content.env"
  [ -r "$CONTENTS" ] || fail "content.env unreadable: $CONTENTS"
  SOURCE_DB="$(awk -F= '/^[[:space:]]*DATABASE_NAME[[:space:]]*=/ { sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }' "$CONTENTS")"
fi
[ -n "$SOURCE_DB" ] || fail "no database name resolved"

DUMP="${1:-}"
if [ -z "$DUMP" ]; then
  DUMP="$(find "$BACKUP_ROOT/nightly" -maxdepth 1 -type f -name "$SOURCE_DB-*.dump" 2>/dev/null | sort | tail -n 1)"
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || fail "no dump found under $BACKUP_ROOT/nightly for $SOURCE_DB"
[ -s "$DUMP" ] || fail "dump is empty: $DUMP"
log "drill start dump=$(basename "$DUMP") source=$SOURCE_DB scratch=$DRILL_DB"

READY_BEFORE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$READY_URL" 2>/dev/null || true)"
log "ready before drill: ${READY_BEFORE:-none}"

case "$DRILL_DB" in
  "$SOURCE_DB") fail "scratch database must not be the production database" ;;
esac

# A leftover from an interrupted run would make CREATE DATABASE fail on the next attempt.
psql_db postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DRILL_DB'" >/dev/null 2>&1 || true
psql_db postgres "DROP DATABASE IF EXISTS $DRILL_DB" >/dev/null || fail "cannot drop a stale scratch database"
psql_db postgres "CREATE DATABASE $DRILL_DB" >/dev/null || fail "cannot create scratch database"

# shellcheck disable=SC2329  # invoked indirectly by the EXIT trap below
cleanup() {
  if [ "$KEEP" = "1" ]; then log "scratch database kept: $DRILL_DB"; return; fi
  psql_db postgres "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DRILL_DB'" >/dev/null 2>&1 || true
  psql_db postgres "DROP DATABASE IF EXISTS $DRILL_DB" >/dev/null 2>&1 || log "WARN could not drop $DRILL_DB"
}
trap cleanup EXIT

RESTORE_LOG="$(mktemp)"
if ! "$PG_BIN/pg_restore" --no-owner --no-privileges --exit-on-error \
  -h "$PG_SOCKET" -p "$PG_PORT" -U "$PG_USER" -d "$DRILL_DB" "$DUMP" >"$RESTORE_LOG" 2>&1; then
  log "pg_restore output:"
  sed -e 's/^/  /' "$RESTORE_LOG" | tail -n 20
  rm -f "$RESTORE_LOG"
  fail "pg_restore reported an error"
fi
rm -f "$RESTORE_LOG"
pass "dump replayed into an empty database"

LEDGER_SQL="SELECT count(*)::text || ' ' || coalesce(max(migration_id), 'none') FROM customer_agent_meta.schema_migrations"
SOURCE_LEDGER="$(psql_db "$SOURCE_DB" "$LEDGER_SQL")" || fail "cannot read the live ledger"
DRILL_LEDGER="$(psql_db "$DRILL_DB" "$LEDGER_SQL")" || fail "cannot read the restored ledger"
log "ledger live='$SOURCE_LEDGER' restored='$DRILL_LEDGER'"
[ "$SOURCE_LEDGER" = "$DRILL_LEDGER" ] || fail "migration ledger differs between live and restored"
pass "migration ledger matches: $DRILL_LEDGER"

TABLES_SQL="SELECT count(*)::text FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"
SOURCE_TABLES="$(psql_db "$SOURCE_DB" "$TABLES_SQL")"
DRILL_TABLES="$(psql_db "$DRILL_DB" "$TABLES_SQL")"
log "table count live=$SOURCE_TABLES restored=$DRILL_TABLES"
[ "$SOURCE_TABLES" = "$DRILL_TABLES" ] || fail "table count differs between live and restored"
pass "table count matches: $SOURCE_TABLES"

# The grant rows are what the whole authorization model reads, so their count is the
# cheapest single number that catches a dump restoring schema but not data.
GRANTS_SQL="SELECT count(*)::text FROM content_intake.grants"
SOURCE_GRANTS="$(psql_db "$SOURCE_DB" "$GRANTS_SQL")"
DRILL_GRANTS="$(psql_db "$DRILL_DB" "$GRANTS_SQL")"
log "grant rows live=$SOURCE_GRANTS restored=$DRILL_GRANTS"
[ "$SOURCE_GRANTS" = "$DRILL_GRANTS" ] || fail "grant row count differs between live and restored"
pass "grant rows match: $DRILL_GRANTS"

READY_AFTER="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$READY_URL" 2>/dev/null || true)"
log "ready after drill: ${READY_AFTER:-none}"
# The drill's own job is the restore. This check exists to prove the drill did not disturb
# a running stack, so it compares before and after instead of assuming 200. Comparing also
# keeps the drill honest where no stack runs (a bare cluster), without turning a pre-existing
# outage into a drill failure or hiding one it caused.
if [ "${READY_BEFORE:-none}" != "${READY_AFTER:-none}" ]; then
  fail "live stack readiness changed during the drill: before='${READY_BEFORE:-none}' after='${READY_AFTER:-none}'"
fi
if [ "${READY_AFTER:-none}" = "200" ]; then pass "live stack still ready (200)"; else log "ready check: no change (${READY_AFTER:-none}); no live stack was expected at that URL"; fi

log "DRILL PASSED dump=$(basename "$DUMP")"
exit 0
