#!/usr/bin/env bash
# Isolated native-PostgreSQL run of the 0165 notification writers against the MODELLED fixture in
# ci/fixtures/notifications-isolated.sql. The full-chain proof is ci/assert-notifications.sql inside
# ci/test_fresh_db_rebuild.sh; this exists so the writers can be exercised in seconds on any
# PostgreSQL 16 without the Supabase CLI.
#   BNN_SCRATCH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres bash ci/test-notifications-isolated.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ADMIN_URL="${BNN_SCRATCH_DATABASE_URL:?set BNN_SCRATCH_DATABASE_URL to a superuser connection on a scratch server}"
DB="bnn_notif_test_$$"
psql "$ADMIN_URL" -X -q -v ON_ERROR_STOP=1 -c "create database $DB"
trap 'psql "$ADMIN_URL" -X -q -c "drop database if exists $DB" >/dev/null' EXIT
URL="${ADMIN_URL%/*}/$DB"
psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/ci/fixtures/notifications-isolated.sql"
psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/migrations/0165_notification_detail.sql" >/dev/null
# Applying twice proves the rerun contract.
psql "$URL" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/migrations/0165_notification_detail.sql" >/dev/null
psql "$URL" -X -v ON_ERROR_STOP=1 -f "$ROOT/ci/assert-notifications.sql" 2>&1 | grep -E "NOTICE|ERROR"
echo "PASS: 0165 notification writers on isolated PostgreSQL"
