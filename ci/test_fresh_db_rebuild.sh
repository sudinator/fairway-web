#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
cleanup() {
  if [ -d "$TMP/supabase" ]; then
    (cd "$TMP" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

cd "$TMP"
supabase init >/dev/null

# Start only a clean Supabase Postgres container. `supabase db start` prepares
# the platform database/roles/schemas, but unlike `supabase start` it is not
# relied upon to apply this repository's migrations. We apply the authoritative
# two-tree migration stream ourselves below so execution order is explicit.
supabase db start

DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# The repository intentionally keeps early migrations under supabase/migrations
# and later migrations under migrations/. Never sort full paths: directory names
# would place migrations/0014 before supabase/migrations/0001. The helper below
# parses the numeric filename prefix across both trees, rejects duplicate numbers,
# and emits one globally ordered stream. ON_ERROR_STOP makes the first dependency,
# syntax, authorization, or reconstruction failure fail CI.
mapfile -t MIGRATIONS < <(
  python3 "$ROOT/ci/list_ordered_migrations.py" "$ROOT"
)

if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  echo "Fresh database reconstruction: FAIL - no migrations found" >&2
  exit 1
fi

for migration in "${MIGRATIONS[@]}"; do
  echo "Applying $(basename "$migration")"
  psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

# Compare the rebuilt database with the exact Production-derived core RLS
# contract. This is the reverse/reproducibility check missing from the old
# Production-only schema guard.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-core-rls-live.sql"

# Fresh rebuild must contain the six helper functions used by the core RLS policy
# graph. Their exact source parity is guarded separately by check_core_rls_helpers.py.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare
  missing integer;
begin
  select count(*) into missing
  from (values
    ('public.is_admin()'::text),
    ('public.is_game_member(uuid)'::text),
    ('public.is_group_admin(uuid,uuid)'::text),
    ('public.is_group_member(uuid,uuid)'::text),
    ('public.is_tee_group_marker(uuid,smallint)'::text),
    ('public.shares_active_club(uuid)'::text)
  ) as expected(sig)
  where to_regprocedure(expected.sig) is null;
  if missing <> 0 then
    raise exception 'Fresh rebuild is missing % core RLS helper function(s)', missing;
  end if;
end $$;
SQL

echo "Fresh database reconstruction: PASS (${#MIGRATIONS[@]} migrations applied)"
