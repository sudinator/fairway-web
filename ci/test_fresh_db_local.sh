#!/usr/bin/env bash
# Replay the ENTIRE committed migration chain on a plain PostgreSQL 16 (with pg_cron) and run the
# same assertion files ci/test_fresh_db_rebuild.sh runs, in the same order. No Docker, no Supabase
# CLI: about 90 seconds. This is what should run before any drop that adds a migration or an
# assertion file. The GitHub fresh-Supabase rebuild is still the final gate; this catches what it
# would catch, locally, first.
#
#   BNN_SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres bash ci/test_fresh_db_local.sh
#
# Requires: postgresql-16, postgresql-16-cron with shared_preload_libraries='pg_cron' and
# cron.database_name set to the scratch database name below (bnn_local_chain).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Run from a scratch directory exactly as ci/test_fresh_db_rebuild.sh does (cd "$TMP"), so anything
# that silently depends on the working directory fails HERE, not in GitHub. 196.0's freshness sync
# did exactly that.
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT; cd "$TMP"
ADMIN_URL="${BNN_SCRATCH_DATABASE_URL:?set BNN_SCRATCH_DATABASE_URL to a superuser connection on a scratch server}"
DB="bnn_local_chain"
# pg_cron's launcher keeps a session on cron.database_name; end it so the drop can proceed (it reconnects).
psql "$ADMIN_URL" -X -q -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid();" >/dev/null
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "drop database if exists $DB with (force)" -c "create database $DB"
DB_URL="${ADMIN_URL%/*}/$DB"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/ci/local_supabase_shim.sql" >/dev/null
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/ci/fresh_db_bootstrap.sql" >/dev/null
n=0
for m in $(python3 "$ROOT/ci/list_ordered_migrations.py" "$ROOT"); do
  n=$((n+1))
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$m" >/dev/null 2>/tmp/bnn_local_chain.err || { echo "FAILED at migration #$n $(basename "$m")"; grep -v NOTICE /tmp/bnn_local_chain.err | head; exit 1; }
done
echo "applied $n migrations"
# Same files, same order as ci/test_fresh_db_rebuild.sh (the concurrency test needs the CLI stack and is skipped).
for f in assert-historical-baseline-columns assert-core-rls-live assert-core-rls-behavior assert-profile-privileges \
         assert-personal-round-persistence assert-primary-scoring-device assert-notifications assert-game-reset-fencing \
         assert-game-round-manual-handicap assert-match-length-roundtrip assert-course-api-checks; do
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/ci/$f.sql" >/dev/null 2>/tmp/bnn_local_chain.err || { echo "FAILED $f.sql"; grep -i "ERROR\|DETAIL\|CONTEXT" /tmp/bnn_local_chain.err | head -5; exit 1; }
  echo "ok   $f.sql"
done
for mode_and_exit in ok:0 midquota:2 drift:1 ledgerdown:2 freshness:0; do
  HARNESS_DB_URL="$DB_URL" HARNESS_MODE="${mode_and_exit%%:*}" HARNESS_EXPECT_EXIT="${mode_and_exit##*:}" COURSE_CHECK_BUDGET=5 \
    node "$ROOT/ci/external/contract-harness.mjs" >/dev/null || { echo "FAILED harness $mode_and_exit"; exit 1; }
  echo "ok   harness $mode_and_exit"
  psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "update public.course_api_checks set last_success_at = last_success_at - interval '8 days', last_checked_at = last_checked_at - interval '8 days', last_status = case when last_status = 'claimed' then 'error' else last_status end;"
done
echo "PASS: full migration chain + rebuild assertions on local PostgreSQL"
