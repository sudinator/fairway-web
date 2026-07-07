#!/usr/bin/env bash
# ci/schema-check.sh — read-only guard against the bug class that hit `bets`.
# Connects to $DATABASE_URL and hard-fails if a NOT-NULL "state" column the app
# relies on a DB default for is missing that default. 100% read-only — safe to
# point at production. Skips (does not fail) when no DATABASE_URL is configured.
set -euo pipefail
if [ -z "${DATABASE_URL:-}" ]; then
  echo "No DATABASE_URL — skipping DB schema guard. Add the SUPABASE_DB_URL repo secret to enable it."
  exit 0
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "== NOT-NULL columns with no default (informational) =="
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$ROOT/ci/audit-nulls.sql"
echo "== state-column default guard (hard gate) =="
psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$ROOT/ci/assert-defaults.sql"
echo "== schema guard PASSED =="
