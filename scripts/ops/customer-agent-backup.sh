#!/usr/bin/env bash
# Nightly logical backup of the production catalog, driven by a systemd timer.
#
# A full (schema + data) custom-format dump, not `--data-only`: a backup has to be
# restorable into an empty database by itself, and the restore drill proves exactly that.
# `--data-only` archives additionally need `--disable-triggers` for the circular foreign
# keys between query_events and content_releases, which is a footgun this avoids.
#
# Retention keeps the most recent CUSTOMER_AGENT_BACKUP_KEEP dumps. Pruning never removes
# the newest dump and never runs after a failed dump, so a bad night cannot leave zero
# backups behind.
#
# Exit codes are part of the contract, and the unit declares them:
#   0  dump written, retention applied, off-site copy done
#   3  dump written, retention applied, off-site copy NOT configured (degraded)
#   1  dump or retention failed
# 3 exists because "no off-site copy" is a real gap that must be visible, while a unit
# reading "failed" every night would train everyone to ignore it.
set -u

STACK_ROOT="${CUSTOMER_AGENT_STACK_ROOT:-/srv/customer-agent/stack}"
PG_BIN="${CUSTOMER_AGENT_PG15_BIN:-/opt/pg15/usr/lib/postgresql/15/bin}"
BACKUP_ROOT="${CUSTOMER_AGENT_BACKUP_ROOT:-/srv/customer-agent/backups}"
KEEP="${CUSTOMER_AGENT_BACKUP_KEEP:-14}"
# Where the copy goes. Empty means "not configured", which is reported as exit 3.
COPY_TO="${CUSTOMER_AGENT_BACKUP_COPY_TO:-}"
DB_NAME="${CUSTOMER_AGENT_BACKUP_DATABASE:-}"
PG_USER="${CUSTOMER_AGENT_BACKUP_USER:-stack_owner}"
PG_PORT="${CUSTOMER_AGENT_BACKUP_PORT:-43199}"
PG_SOCKET="${CUSTOMER_AGENT_BACKUP_SOCKET:-$STACK_ROOT/data/pg15-socket}"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FATAL $*"; exit 1; }

case "$KEEP" in ''|*[!0-9]*) fail "retention must be a positive integer, got '$KEEP'" ;; esac
if [ "$KEEP" -lt 1 ]; then fail "retention must be at least 1"; fi

[ -x "$PG_BIN/pg_dump" ] || fail "pg_dump not found under $PG_BIN"
[ -S "$PG_SOCKET/.s.PGSQL.$PG_PORT" ] || fail "no PostgreSQL socket at $PG_SOCKET/.s.PGSQL.$PG_PORT"

# The database name is read from the stack's own content.env rather than hardcoded: the
# same script must not silently back up the synthetic catalog on a host where the file
# names something else.
if [ -z "$DB_NAME" ]; then
  CONTENTS="$STACK_ROOT/content.env"
  [ -r "$CONTENTS" ] || fail "content.env unreadable: $CONTENTS"
  DB_NAME="$(awk -F= '/^[[:space:]]*DATABASE_NAME[[:space:]]*=/ { sub(/^[^=]*=/, ""); gsub(/^[[:space:]]+|[[:space:]]+$/, ""); print; exit }' "$CONTENTS")"
fi
if [ -z "$DB_NAME" ]; then fail "no database name: set DATABASE_NAME in content.env or CUSTOMER_AGENT_BACKUP_DATABASE"; fi

NIGHTLY="$BACKUP_ROOT/nightly"
mkdir -p "$NIGHTLY" || fail "cannot create $NIGHTLY"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
# Always carry a zero-padded sequence, including the first run of a second. Two runs in the
# same second would otherwise write the same path and the second would silently replace the
# first; with a fixed-width suffix, name order still equals time order, so retention's
# lexical sort stays correct.
SEQ=1
while :; do
  TARGET="$NIGHTLY/$(printf '%s-%s-%03d.dump' "$DB_NAME" "$STAMP" "$SEQ")"
  [ -e "$TARGET" ] || break
  SEQ=$((SEQ + 1))
  if [ "$SEQ" -gt 999 ]; then fail "more than 999 backups in one second"; fi
done
PARTIAL="$TARGET.partial"

log "dump start database=$DB_NAME target=$TARGET"
# Write to a partial name and rename only on success, so retention can treat every
# *.dump file as complete and a killed run leaves no half file that looks restorable.
if ! "$PG_BIN/pg_dump" \
  --format=custom --no-owner --no-privileges --compress=6 \
  -h "$PG_SOCKET" -p "$PG_PORT" -U "$PG_USER" -d "$DB_NAME" \
  -f "$PARTIAL"; then
  rm -f "$PARTIAL"
  fail "pg_dump failed"
fi
if [ ! -s "$PARTIAL" ]; then
  rm -f "$PARTIAL"
  fail "pg_dump produced an empty file"
fi
mv -f "$PARTIAL" "$TARGET" || fail "cannot finalise $TARGET"
BYTES="$(wc -c < "$TARGET" | tr -d ' ')"
log "dump done bytes=$BYTES"

# Keep the newest KEEP dumps for this database. Sort by name: the stamp is
# YYYYMMDDTHHMMSSZ, so name order is time order and does not depend on mtime support.
REMOVED=0
TOTAL="$(find "$NIGHTLY" -maxdepth 1 -type f -name "$DB_NAME-*.dump" | wc -l | tr -d ' ')"
if [ "$TOTAL" -gt "$KEEP" ]; then
  DROP=$((TOTAL - KEEP))
  while IFS= read -r OLD; do
    rm -f "$OLD" && REMOVED=$((REMOVED + 1))
  done <<EOF
$(find "$NIGHTLY" -maxdepth 1 -type f -name "$DB_NAME-*.dump" | sort | head -n "$DROP")
EOF
fi
log "retention keep=$KEEP total_before=$TOTAL removed=$REMOVED"
if [ "$REMOVED" -ne "$((TOTAL > KEEP ? TOTAL - KEEP : 0))" ]; then fail "retention removed $REMOVED of the expected amount"; fi

if [ -z "$COPY_TO" ]; then
  log "offsite copy: NOT CONFIGURED (set CUSTOMER_AGENT_BACKUP_COPY_TO); this backup exists on one disk only"
  exit 3
fi
mkdir -p "$COPY_TO" || fail "cannot create $COPY_TO"
if ! cp -f "$TARGET" "$COPY_TO/"; then fail "offsite copy to $COPY_TO failed"; fi
log "offsite copy done destination=$COPY_TO"
exit 0
