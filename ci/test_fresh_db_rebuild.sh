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

# 0179: ending a game closes running clocks without tripping the reset fence.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-finish-game-clocks.sql"

# 0180: Season Wrapped club aggregates and the Dec 31 notification.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-season-wrapped.sql"

# 0182: every public table has RLS; and ci/public_tables.json lists EXACTLY the tables the migrations
# create (the live parity check uses that list to catch tables made by hand on production).
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-security-posture.sql"

# 0183: course freshness — no browser-supplied data; approve an exact revision of an unchanged course.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-freshness-integrity.sql"

# 0184: teams, groups and foursomes apply together or not at all.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-game-structure-atomic.sql"

# 0186: course history and restore.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-versions.sql"

# 0187: the course status view.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-status-view.sql"

# 0188: completion announcements.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-game-recap-announce.sql"

# 0189: sign-up approval and the duplicate check.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-account-signup.sql"

# 0190: merge-then-remove, suspend/restore, empty-only remove; the registry covers every account column.
# 208.2: the database build and extensions, for diagnosing a crash seen at this test on Supabase's image.
psql "$DB_URL" -X -A -t -c "select version()" || true
# 209.1: the exact Supabase database image (17.6.1.111 has the supautils crash; >= 17.6.1.121 is fixed).
if command -v docker >/dev/null 2>&1; then docker ps --format '{{.Image}}' | grep -i 'supabase/postgres\|cli/postgres' | sed 's/^/Supabase database image: /' || true; fi
psql "$DB_URL" -X -A -t -c "select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension" || true
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-account-merge.sql"

# 208.4: server-only functions are unreachable by app roles — checked by privilege, never by calling.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-no-app-call-to-revoked.sql"

# 0191: Season Wrapped to active members only; the dry run.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-season-wrapped-active.sql"

# 0192: apply selected course changes.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-course-selective.sql"

# 0193: round-summary email — who and when.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-round-email.sql"

# 0194: guests are scored by the people playing with them.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-guest-scoring.sql"

# 0195: publishing club reports.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-club-reports.sql"

# 0196: merge and suspend guards.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-merge-guards.sql"

# 0197: approved accounts only; the provider baseline.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-active-accounts.sql"

# 0198: round emails never disappear; announcements can be retried.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-email-announce.sql"

# 0199: club requests.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-club-requests.sql"

# 0200: a support visit is not a join.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-support-visit.sql"

# 0201: every notification link opens a screen the app knows.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-notification-links.sql"

# 0202: system admins read every club and membership.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-admin-reads-clubs.sql"

# 0203: scramble team scores.
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-scramble.sql"
psql "$DB_URL" -X -tA -c "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by 1" > /tmp/bnn_chain_tables.txt
python3 - "$ROOT/ci/public_tables.json" /tmp/bnn_chain_tables.txt <<'PY'
import json, sys
listed = set(json.load(open(sys.argv[1]))["tables"]); chain = {l.strip() for l in open(sys.argv[2]) if l.strip()}
if listed != chain:
    print("ci/public_tables.json out of sync with the migrations:")
    print("  created by migrations, not listed:", sorted(chain - listed)); print("  listed, not created:", sorted(listed - chain)); sys.exit(1)
print(f"public table list: in sync ({len(chain)} tables)")
PY

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
