#!/usr/bin/env bash
# ci/schema-check.sh — read-only live-database guard.
#
# The ordinary state/default checks are always safe to run against the configured
# live database. The Production-derived core RLS equality check is lifecycle-gated:
# it becomes a hard gate only after migration 0137 has been deliberately applied
# and recorded in that environment. Before then, source + disposable-fresh-DB CI
# are the authoritative pre-migration proof, avoiding a circular release gate where
# staging must already be migrated before CI can approve the migration.
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

RLS_BASELINE_APPLIED="$(psql -X -A -t -v ON_ERROR_STOP=1 "$DATABASE_URL" <<'SQL'
select case
  when to_regclass('public.schema_migrations') is not null
   and exists (
     select 1
     from public.schema_migrations
     where id = '0137_core_rls_baseline'
   )
  then 'yes'
  else 'no'
end;
SQL
)"

if [ "$RLS_BASELINE_APPLIED" = "yes" ]; then
  echo "== core RLS live contract (hard gate; 0137 applied) =="
  psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$ROOT/ci/assert-core-rls-live.sql"
else
  echo "== core RLS live contract: PENDING =="
  echo "0137_core_rls_baseline is not recorded in this environment; live equality is intentionally deferred."
  echo "Pre-migration safety is enforced by source-contract guards and disposable fresh-database reconstruction."
fi

echo "== schema guard PASSED =="
