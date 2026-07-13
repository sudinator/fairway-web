-- 0091_admin_extra_stats.sql
-- Summary COUNTS for the new analytics tiles (stage 2). The name-level drill lists come from
-- admin_stat_users (0090); this only supplies the numbers on the tiles. is_admin-gated.
-- push_prefs values are 'push'|'inapp'|'off'; "muted" = 'off'. Notifications-on = the user has
-- an active (non-disabled) push_subscription. Test + deactivated users excluded from people counts.
create or replace function public.get_admin_extra_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare j jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select jsonb_build_object(
    'installed', (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is true),
    'browser',   (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is false),
    'platform_unknown', (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is null),
    'notif_on',  (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)),
    'notif_off', (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and not exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)),
    'failing_subs', (select count(distinct s.user_id) from push_subscriptions s where s.disabled=true or s.fail_count >= 3 or s.last_seen < now() - interval '14 days'),
    'share_on',  (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=true),
    'share_off', (select count(*) from profiles p where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=false),
    'guests',      (select count(*) from game_players where guest_of is not null),
    'guest_hosts', (select count(distinct guest_of) from game_players where guest_of is not null),
    'mutes', (
      select coalesce(jsonb_object_agg(k, c), '{}'::jsonb)
      from (
        select kv.key as k, count(*) c
        from profiles p
        cross join lateral jsonb_each_text(coalesce(p.push_prefs, '{}'::jsonb)) kv
        where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and kv.value = 'off'
        group by kv.key
      ) m
    )
  ) into j;
  return j;
end;
$function$;
grant execute on function public.get_admin_extra_stats() to authenticated;
