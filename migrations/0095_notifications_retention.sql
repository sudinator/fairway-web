-- 0095_notifications_retention.sql
-- Notifications are transient — keep 90 days, purge older ones nightly so the table can't grow
-- forever. Removes both read and unread beyond the window.
create or replace function public.purge_old_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.notifications where created_at < now() - interval '90 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create extension if not exists pg_cron;
do $$ begin perform cron.unschedule('purge-old-notifications'); exception when others then null; end $$;
-- daily at 04:23 UTC (off-peak; clear of tee-reminders */15 and friction-sweep 08:17)
select cron.schedule('purge-old-notifications', '23 4 * * *', $$ select public.purge_old_notifications(); $$);
