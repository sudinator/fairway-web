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
supabase db start
DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/fresh_db_bootstrap.sql" >/dev/null

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

psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-historical-baseline-columns.sql"

# Production-safe structural read-only gate: table RLS state, 60 policy identities/metadata, grants.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-core-rls-live.sql"

# Disposable-only behavioral proof: execute real authorization outcomes under authenticated RLS.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-core-rls-behavior.sql"

# Execute the full configured-game length round trip, score lock and reset/re-entry behavior.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-match-length-roundtrip.sql"

# Fresh rebuild must contain the six helper functions used by the core RLS policy graph.
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

echo "Fresh database reconstruction: PASS (${#MIGRATIONS[@]} migrations applied; structural + behavior RLS gates passed)"
