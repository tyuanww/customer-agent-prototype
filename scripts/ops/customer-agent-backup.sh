#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
if node "$SCRIPT_DIR/backup-set.mjs" backup; then
  exit 0
else
  status=$?
  if [ "$status" -eq 1 ] && [ -x "$SCRIPT_DIR/send-ops-alert.sh" ]; then
    "$SCRIPT_DIR/send-ops-alert.sh" BACKUP_FAILED || true
  fi
  exit "$status"
fi
