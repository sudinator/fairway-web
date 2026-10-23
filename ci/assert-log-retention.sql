-- 0217 (212.30): logs are ARCHIVED, then removed — notifications after 90 days, activity / email logs after a year.
begin;
do $$
declare u uuid := '21700000-0000-0000-0000-000000000001'; r jsonb; n int;
begin
  insert into auth.users(id, email) values (u, 'ret@test.test');
  insert into profiles(id, display_name, email, account_status) values (u, 'Ret', 'ret@test.test', 'active');
  insert into notifications(user_id, message, created_at) values (u, 'old', now() - interval '100 days'), (u, 'recent', now() - interval '10 days');
  insert into activity_log(action, summary, created_at) values ('t', 'old', now() - interval '400 days'), ('t', 'recent', now() - interval '100 days');
  r := public.run_log_retention();
  if exists (select 1 from notifications where user_id = u and message = 'old') or not exists (select 1 from notifications where user_id = u and message = 'recent') then
    raise exception 'notifications: the 100-day-old one should be gone, the 10-day-old one kept';
  end if;
  if not exists (select 1 from archive.notifications where user_id = u and message = 'old' and archived_at is not null) then raise exception 'the old notification was not archived'; end if;
  if exists (select 1 from activity_log where summary = 'old' and action = 't') or not exists (select 1 from activity_log where summary = 'recent' and action = 't') then
    raise exception 'activity log: over a year should go, 100 days should stay';
  end if;
  if not exists (select 1 from archive.activity_log where summary = 'old') then raise exception 'the old activity entry was not archived'; end if;
  if has_schema_privilege('authenticated', 'archive', 'usage') or has_schema_privilege('anon', 'archive', 'usage') then raise exception 'app users can reach the archive'; end if;
  if has_function_privilege('authenticated', 'public.run_log_retention()', 'execute') then raise exception 'app users can run the retention job'; end if;
  if not exists (select 1 from cron.job where jobname = 'log-retention') or exists (select 1 from cron.job where jobname = 'purge-old-notifications') then raise exception 'the nightly job should be log-retention, replacing purge-old-notifications'; end if;
  raise notice 'LOG_RETENTION_PASS notifications archived after 90 days, activity/email logs after a year; the archive and the job are server-only; nightly job replaced';
end $$;
rollback;
