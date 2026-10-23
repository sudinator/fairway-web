-- 0217_log_retention.sql
--
-- 212.30 — keep the logs lean (owner, Oct 23): notifications, the activity log and the email logs are ARCHIVED and
-- removed from the live tables — notifications after 90 days (as members see today; 0095 deleted them outright),
-- the activity log and email logs (round, team-round, club-report) after 1 year. Rounds, scores, games and the money
-- audit are never touched. The archive is a separate schema the app's API does not expose; kept for history.
--   * schema archive: one table per log (the live table's columns + archived_at);
--   * run_log_retention(): moves rows past their age into the archive, returns counts — nightly via pg_cron;
--   * the old "purge-old-notifications" job (delete after 90 days, no archive) is replaced by "log-retention".
--
-- AUTHORIZATION: run_log_retention() — SECURITY DEFINER, revoked from public / anon / authenticated (the scheduler
-- runs it). Schema archive: no privileges for anon / authenticated. No grants.
-- TESTS: ci/assert-log-retention.sql
--
-- Idempotent; safe to re-run.

begin;

create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.notifications (like public.notifications);
create table if not exists archive.activity_log (like public.activity_log);
create table if not exists archive.round_email_log (like public.round_email_log);
create table if not exists archive.team_round_email_log (like public.team_round_email_log);
create table if not exists archive.club_report_email_log (like public.club_report_email_log);
alter table archive.notifications add column if not exists archived_at timestamptz not null default now();
alter table archive.activity_log add column if not exists archived_at timestamptz not null default now();
alter table archive.round_email_log add column if not exists archived_at timestamptz not null default now();
alter table archive.team_round_email_log add column if not exists archived_at timestamptz not null default now();
alter table archive.club_report_email_log add column if not exists archived_at timestamptz not null default now();
revoke all on all tables in schema archive from public, anon, authenticated;

create or replace function public.run_log_retention()
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_notif int; n_act int; n_round int; n_team int; n_club int;
begin
  with m as (delete from public.notifications where created_at < now() - interval '90 days' returning *)
    insert into archive.notifications select m.*, now() from m;
  get diagnostics n_notif = row_count;
  with m as (delete from public.activity_log where created_at < now() - interval '1 year' returning *)
    insert into archive.activity_log select m.*, now() from m;
  get diagnostics n_act = row_count;
  with m as (delete from public.round_email_log where at < now() - interval '1 year' returning *)
    insert into archive.round_email_log select m.*, now() from m;
  get diagnostics n_round = row_count;
  with m as (delete from public.team_round_email_log where at < now() - interval '1 year' returning *)
    insert into archive.team_round_email_log select m.*, now() from m;
  get diagnostics n_team = row_count;
  with m as (delete from public.club_report_email_log where at < now() - interval '1 year' returning *)
    insert into archive.club_report_email_log select m.*, now() from m;
  get diagnostics n_club = row_count;
  return jsonb_build_object('notifications', n_notif, 'activity_log', n_act, 'round_email_log', n_round, 'team_round_email_log', n_team, 'club_report_email_log', n_club);
end $$;
revoke all on function public.run_log_retention() from public, anon, authenticated;

-- replace the delete-only notification purge with the archiving job
do $$ begin
  if exists (select 1 from cron.job where jobname = 'purge-old-notifications') then perform cron.unschedule('purge-old-notifications'); end if;
  if exists (select 1 from cron.job where jobname = 'log-retention') then perform cron.unschedule('log-retention'); end if;
  perform cron.schedule('log-retention', '23 4 * * *', 'select public.run_log_retention();');
end $$;

select public.record_migration('0217_log_retention');

commit;
