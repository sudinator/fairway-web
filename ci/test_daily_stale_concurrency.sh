#!/usr/bin/env bash
# Disposable localhost migration-chain database ONLY. Real competing SQL sessions.
set -euo pipefail
DB_URL="${1:?disposable database URL required}"
if [[ "${BNN_DISPOSABLE_DATABASE:-}" != 1 || ! "$DB_URL" =~ @(127\.0\.0\.1|localhost): ]]; then
  echo 'FAIL: stale concurrency tests require an explicitly disposable localhost database' >&2; exit 1
fi
original_active="$(psql "$DB_URL" -X -tA -v ON_ERROR_STOP=1 -c "select active from cron.job where jobname='bnn-daily-stale-games'")"
[[ "$original_active" == t || "$original_active" == f ]] || { echo 'FAIL: daily job missing or ambiguous'; exit 1; }
TMP="$(mktemp -d)"
cleanup() {
  local result=$?
  trap - EXIT
  if ! psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "delete from public.game_players where game_id='23400000-0000-0000-0000-000000000901'; delete from public.games where id='23400000-0000-0000-0000-000000000901'; delete from public.holes where round_id='23400000-0000-0000-0000-000000000904'; delete from public.rounds where id='23400000-0000-0000-0000-000000000904'; delete from public.groups where id='23400000-0000-0000-0000-000000000903'; delete from public.profiles where id='23400000-0000-0000-0000-000000000902'; delete from auth.users where id='23400000-0000-0000-0000-000000000902'; delete from public.stale_game_job_runs; update cron.job set active='$original_active'::boolean where jobname='bnn-daily-stale-games';" >/dev/null; then result=1; fi
  rm -rf "$TMP"
  exit "$result"
}
trap cleanup EXIT
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
update cron.job set active=false where jobname='bnn-daily-stale-games';
insert into auth.users(id) values('23400000-0000-0000-0000-000000000902');
insert into profiles(id,display_name,account_status) values('23400000-0000-0000-0000-000000000902','Concurrency fixture','active');
insert into groups(id,name,is_test) values('23400000-0000-0000-0000-000000000903','Concurrency fixture',false);
insert into games(id,code,name,course,game_type,status,group_id,created_by,created_at,played_at,holes_meta)
select '23400000-0000-0000-0000-000000000901','923401','Concurrency fixture','Course','stroke','active','23400000-0000-0000-0000-000000000903','23400000-0000-0000-0000-000000000902',now()-interval '10 days',current_date-10,jsonb_agg(jsonb_build_object('n',i,'par',4,'si',i)) from generate_series(1,9)i;
insert into game_players(game_id,user_id,display_name,scores,putts,fairways,penalties,sand) values('23400000-0000-0000-0000-000000000901','23400000-0000-0000-0000-000000000902','Concurrency player','[]','[]','[]','[]','[]');
insert into rounds(id,user_id,course,status,group_id,played_at,course_par) values('23400000-0000-0000-0000-000000000904','23400000-0000-0000-0000-000000000902','Concurrency round','in_progress','23400000-0000-0000-0000-000000000903',now()-interval '4 days',36);
insert into holes(round_id,hole_number,par,stroke_index,strokes) select '23400000-0000-0000-0000-000000000904',i,4,i,5 from generate_series(1,9)i;
update rounds set last_score_change_at=now()-interval '3 days' where id='23400000-0000-0000-0000-000000000904';
SQL
# Acquire the same fences as canonical scoring writes BEFORE signalling readiness.
cat > "$TMP/writer.sql" <<SQL
begin;
select pg_advisory_xact_lock(hashtextextended('23400000-0000-0000-0000-000000000901',163));
select pg_advisory_xact_lock(hashtextextended('23400000-0000-0000-0000-000000000904',159));
update game_players set scores='[5]' where game_id='23400000-0000-0000-0000-000000000901';
update holes set strokes=4 where round_id='23400000-0000-0000-0000-000000000904' and hole_number=1;
\! touch $TMP/ready
select pg_sleep(2);
commit;
SQL
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$TMP/writer.sql" > "$TMP/writer.log" 2>&1 &
writer=$!
for i in {1..100}; do [[ -f "$TMP/ready" ]] && break; sleep .05; done
[[ -f "$TMP/ready" ]] || { cat "$TMP/writer.log"; exit 1; }
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c 'select public.run_daily_stale_games();' > "$TMP/job.log"
wait "$writer"
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
do $$begin
 if not exists(select 1 from games where id='23400000-0000-0000-0000-000000000901' and status='active') then raise exception 'FAIL: job deleted/ended game during a score write'; end if;
 if not exists(select 1 from game_players where game_id='23400000-0000-0000-0000-000000000901' and scores='[5]'::jsonb) then raise exception 'FAIL: concurrent score lost'; end if;
 if not exists(select 1 from rounds where id='23400000-0000-0000-0000-000000000904' and status='in_progress') then raise exception 'FAIL: job finalized personal round during a write'; end if;
 if not exists(select 1 from holes where round_id='23400000-0000-0000-0000-000000000904' and hole_number=1 and strokes=4) then raise exception 'FAIL: concurrent personal correction lost'; end if;
end $$;
SQL
# A second job cannot overlap the first job's global transaction lock.
cat > "$TMP/runner.sql" <<SQL
begin;
select pg_advisory_xact_lock(hashtextextended('daily-stale-games',234));
\! touch $TMP/job-ready
select pg_sleep(2);
commit;
SQL
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$TMP/runner.sql" > "$TMP/runner.log" 2>&1 &
runner=$!
for i in {1..100}; do [[ -f "$TMP/job-ready" ]] && break; sleep .05; done
[[ -f "$TMP/job-ready" ]] || exit 1
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -c "do \$\$begin if public.run_daily_stale_games()->>'skipped' is distinct from 'busy' then raise exception 'FAIL: overlapping jobs were allowed'; end if; end \$\$;"
wait "$runner"
echo 'DAILY_STALE_CONCURRENCY_PASS competing game/personal writes preserved; overlapping jobs rejected'
