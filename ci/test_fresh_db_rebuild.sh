#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
cleanup() {
  local result=$?
  # Preserve database evidence BEFORE cleanup removes the temporary container.
  # Keep normal successful runs quiet; diagnostics must not mask the test status.
  if [ "$result" -ne 0 ]; then
    echo "::group::Fresh database failure diagnostics"
    local db_project_id=""
    if [ -f "$TMP/supabase/config.toml" ]; then
      db_project_id=$(sed -n 's/^project_id = "\(.*\)"/\1/p' "$TMP/supabase/config.toml")
    fi
    if [ -n "$db_project_id" ] && command -v docker >/dev/null 2>&1; then
      local db_container="supabase_db_$db_project_id"
      docker inspect --format 'Database {{.Name}}: status={{.State.Status}} oom_killed={{.State.OOMKilled}} exit_code={{.State.ExitCode}} error={{.State.Error}}' "$db_container" || true
      docker logs --tail 100 "$db_container" 2>&1 || true
    fi
    echo "::endgroup::"
  fi
  if [ -d "$TMP/supabase" ]; then
    (cd "$TMP" && supabase stop --no-backup >/dev/null 2>&1) || true
  fi
  rm -rf "$TMP"
  return "$result"
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

# Profile insert/update privilege boundary, owner RPC and exactly-once audit.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-profile-privileges.sql"

# Atomic personal-round save/discard, authenticated RLS and rollback proof.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-personal-round-persistence.sql"

# Primary-device gate across personal/game scores, stats and SECURITY DEFINER Alternate Shot.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-primary-scoring-device.sql"

# 0165: every notification writer executed on real rows; exact message text asserted.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-notifications.sql"

# 0167: course review queue (reopen on new diff, cross-club scoping, server-side apply).
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-reviews.sql"

# 0169: Admin course-status view.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-admin-course-status.sql"

# 0170: push device health (failing vs dormant, prune).
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-push-device-health.sql"

# 0173: public live line-up read.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-live-lineup.sql"

# Audit guard: no app-callable RPC with two signatures (PGRST203).
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-no-rpc-overloads.sql"

# 0178: readable live links for the scorecard and competition pages.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-readable-live-links.sql"

# Reset fencing: real SQL outcomes plus separate-connection concurrency barriers.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-game-reset-fencing.sql"
BNN_RESET_TEST_DATABASE_URL="$DB_URL" python3 "$ROOT/ci/test-game-reset-concurrency.py"

# 192.19: game posting preserves manual handicaps on both insert/repost paths.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-game-round-manual-handicap.sql"

# Execute the full configured-game length round trip, score lock and reset/re-entry behavior.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-match-length-roundtrip.sql"

# The daily course-check claim (0156): budget, remainder, idling, ageing, oldest-first, the cap,
# retention of last-known values, and the permission boundary.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-api-checks.sql"

# 0164: the WHOLE monitor script against a PostgREST-shaped ledger stub backed by this database and
# a stub provider. Every exit path must leave a recorded outcome: a clean week, a mid-run daily
# quota (checked courses recorded, unreached ones released), drift, and a dead ledger.
for mode_and_exit in ok:0 midquota:2 drift:1 ledgerdown:2 freshness:0; do
  HARNESS_DB_URL="$DB_URL" HARNESS_MODE="${mode_and_exit%%:*}" HARNESS_EXPECT_EXIT="${mode_and_exit##*:}" COURSE_CHECK_BUDGET=5 \
    node "$ROOT/ci/external/contract-harness.mjs"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "update public.course_api_checks set last_success_at = last_success_at - interval '8 days', last_checked_at = last_checked_at - interval '8 days', last_status = case when last_status = 'claimed' then 'error' else last_status end;"
done
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "delete from public.course_api_checks;"

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
