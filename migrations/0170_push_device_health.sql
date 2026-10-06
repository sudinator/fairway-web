-- 0170_push_device_health.sql
--
-- "Failing / stale devices" counted a dead iPhone endpoint from July as a device with a problem.
--
-- WHAT WAS SEEN (Admin → Analytics → Notifications, 2026-10-05): "1 failing / stale device —
-- Amit Sud, fails 0, last seen Aug 22". push_subscriptions held two iOS endpoints for the same
-- phone: one created Jul 9 and last seen Aug 22, one created Oct 1 and seen daily since. iOS had
-- dropped the first subscription and re-enrolled the phone under a new endpoint; the old row stays
-- until a push to it comes back 410, and no push had been attempted. Nothing was failing.
--
-- THIS MIGRATION separates the two meanings and stops the corpses accumulating:
--   * admin_push_device_stats(): failing = disabled or fail_count >= 3 (real delivery trouble);
--     dormant = not seen for 14+ days with no failures (a device not opening the app, or a
--     superseded endpoint). Counted per endpoint AND per user.
--   * admin_push_devices(kind): the drill-down names the DEVICE — platform, browser/OS from the
--     user agent, created and last-seen dates — instead of only "fails N · last seen".
--   * prune_push_subscriptions(): nightly, deletes endpoints not seen for 60 days (and disabled
--     ones not seen for 60 days). A live device re-enrols itself on its next app open
--     (syncPushSubscription), so a wrongly pruned row heals; a dead one stops inflating the count
--     and stops costing a wasted send on every push.
-- The 0091 tile source and 0108 drill-down are left as they are; the Admin screen reads these.
--
-- AUTHORIZATION: the two admin_* functions are is_admin()-gated SECURITY DEFINER readers over
-- push_subscriptions (which app roles cannot read). prune_push_subscriptions has no grant to app
-- roles and runs from pg_cron only.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.admin_push_device_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then jsonb_build_object(
    'failing_endpoints', (select count(*) from push_subscriptions s where s.disabled or s.fail_count >= 3),
    'failing_users',     (select count(distinct s.user_id) from push_subscriptions s where s.disabled or s.fail_count >= 3),
    'dormant_endpoints', (select count(*) from push_subscriptions s where not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days'),
    'dormant_users',     (select count(distinct s.user_id) from push_subscriptions s where not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days'
                           and not exists (select 1 from push_subscriptions h where h.user_id = s.user_id and not h.disabled and h.fail_count < 3 and h.last_seen >= now() - interval '14 days')),
    'prune_after_days', 60
  ) else '{}'::jsonb end;
$$;
revoke all on function public.admin_push_device_stats() from public, anon;
grant execute on function public.admin_push_device_stats() to authenticated;

-- Same row shape as admin_stat_users so the existing drawer renders it.
create or replace function public.admin_push_devices(p_kind text)
returns table (name text, detail text, tag text, avatar_url text)
language sql stable security definer set search_path = public as $$
  select coalesce(p.display_name, '(no name)'),
         coalesce(s.platform, '?') || ' · ' ||
         case when s.user_agent ~ 'iPhone' then 'iPhone' || coalesce(' iOS ' || replace((regexp_match(s.user_agent, 'OS (\d+_\d+)'))[1], '_', '.'), '')
              when s.user_agent ~ 'Android' then 'Android'
              when s.user_agent ~ 'Macintosh' then 'Mac'
              when s.user_agent ~ 'Windows' then 'Windows'
              else coalesce(left(s.user_agent, 24), 'unknown device') end ||
         ' · enrolled ' || to_char(s.created_at, 'Mon DD') || ' · last seen ' || to_char(s.last_seen, 'Mon DD') ||
         case when s.fail_count > 0 then ' · fails ' || s.fail_count else '' end ||
         case when s.disabled then ' · disabled' else '' end ||
         case when exists (select 1 from push_subscriptions h where h.user_id = s.user_id and h.id <> s.id and not h.disabled and h.last_seen >= now() - interval '14 days')
              then ' · has a current device' else '' end,
         case when p_kind = 'push_failing' then 'failing' else 'dormant' end,
         p.avatar_url
    from push_subscriptions s
    join profiles p on p.id = s.user_id
   where public.is_admin()
     and case when p_kind = 'push_failing' then (s.disabled or s.fail_count >= 3)
              else (not s.disabled and s.fail_count < 3 and s.last_seen < now() - interval '14 days') end
   order by s.last_seen asc;
$$;
revoke all on function public.admin_push_devices(text) from public, anon;
grant execute on function public.admin_push_devices(text) to authenticated;

create or replace function public.prune_push_subscriptions()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  delete from push_subscriptions where last_seen < now() - interval '60 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.prune_push_subscriptions() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'push-subscription-prune';
    perform cron.schedule('push-subscription-prune', '41 8 * * *', $job$ select public.prune_push_subscriptions(); $job$);
  end if;
end $$;

select public.record_migration('0170_push_device_health');

commit;
