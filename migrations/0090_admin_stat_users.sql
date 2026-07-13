-- 0090_admin_stat_users.sql
-- The drill-down engine: one is_admin-gated RPC that, given a stat key (and optional arg/date),
-- returns the UNIFORM list of users behind that number: (name, detail, tag). Every analytics
-- stat — existing and new — routes through here so drill-down is consistent and any new stat
-- gets it for free. Real-round definition matches the app: deleted_at is null AND
-- status <> 'in_progress'. Test + deactivated accounts excluded from user-population stats.
create or replace function public.admin_stat_users(
  p_stat text,
  p_arg text default null,
  p_date date default null
)
returns table(name text, detail text, tag text)
language plpgsql
security definer
set search_path = public
as $function$
declare
  d date := coalesce(p_date, current_date);
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  -- ===== population / activity =====
  if p_stat = 'users_total' then
    return query
      select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), null::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
      order by p.display_name nulls last;

  elsif p_stat = 'users_new_30d' then
    return query
      select coalesce(p.display_name,'(no name)'), 'first seen '||to_char(fa.first_day,'Mon DD'), 'new'::text
      from profiles p
      join (select user_id, min(day) first_day from daily_active group by user_id) fa on fa.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and fa.first_day > current_date - 30
      order by fa.first_day desc;

  elsif p_stat = 'active_dau' then
    return query
      select coalesce(p.display_name,'(no name)'), da.opens||' opens today', null::text
      from profiles p join daily_active da on da.user_id=p.id and da.day=current_date
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
      order by da.opens desc;

  elsif p_stat in ('active_wau','active_mau') then
    return query
      select coalesce(p.display_name,'(no name)'), sum(da.opens)::text||' opens', null::text
      from profiles p join daily_active da on da.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and da.day > current_date - (case p_stat when 'active_wau' then 7 else 30 end)
      group by p.id, p.display_name
      order by sum(da.opens) desc;

  elsif p_stat = 'lapsed' then
    return query
      select coalesce(p.display_name,'(no name)'), 'last seen '||to_char(mx.last_day,'Mon DD'), 'lapsed'::text
      from profiles p
      join (select user_id, max(day) last_day from daily_active group by user_id) mx on mx.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and mx.last_day <= current_date - 30 and mx.last_day > current_date - 60
      order by mx.last_day desc;

  elsif p_stat = 'never_joined_group' then
    return query
      select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'no club'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and not exists (select 1 from group_members gm where gm.user_id=p.id and gm.status='active')
      order by p.display_name nulls last;

  -- ===== rounds =====
  elsif p_stat = 'rounds_done' then
    return query
      select coalesce(p.display_name,'(no name)'), count(*)::text||' completed', null::text
      from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and r.deleted_at is null and coalesce(r.status,'final')<>'in_progress'
      group by p.id, p.display_name order by count(*) desc;

  elsif p_stat = 'rounds_started' then
    return query
      select coalesce(p.display_name,'(no name)'), count(*)::text||' in progress', 'open'::text
      from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and r.deleted_at is null and coalesce(r.status,'final')='in_progress'
      group by p.id, p.display_name order by count(*) desc;

  elsif p_stat in ('abandoned','unfinished') then
    return query
      select coalesce(p.display_name,'(no name)'),
             count(*) filter (where r.deleted_at is null and coalesce(r.status,'final')='in_progress')::text||' unfinished'
               || case when count(*) filter (where r.deleted_at is not null) > 0
                       then ' · '||count(*) filter (where r.deleted_at is not null)::text||' deleted' else '' end,
             'friction'::text
      from profiles p join rounds r on r.user_id=p.id
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and (
          (r.deleted_at is null and coalesce(r.status,'final')='in_progress' and r.created_at < now() - interval '24 hours')
          or r.deleted_at is not null
        )
      group by p.id, p.display_name
      having count(*) filter (where r.deleted_at is null and coalesce(r.status,'final')='in_progress') > 0
          or count(*) filter (where r.deleted_at is not null) >= 3
      order by count(*) desc;

  elsif p_stat = 'rounds_day' then
    return query
      select coalesce(p.display_name,'(no name)')||' · '||coalesce(r.course,'course'),
             (select count(*) from holes h where h.round_id=r.id and h.strokes is not null)::text||' holes'
               || case when r.gross_score is not null then ' · gross '||r.gross_score::text else '' end,
             case when r.deleted_at is not null then 'deleted'
                  when coalesce(r.status,'final')='in_progress' then 'in progress'
                  when r.finished_by='system:auto' then 'auto-finished'
                  else 'completed' end
      from rounds r join profiles p on p.id=r.user_id
      where r.played_at = d
      order by r.created_at;

  elsif p_stat = 'active_day' then
    return query
      select coalesce(p.display_name,'(no name)'), da.opens||' opens', null::text
      from daily_active da join profiles p on p.id=da.user_id
      where da.day = d and coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
      order by da.opens desc;

  -- ===== platform (install vs browser) =====
  elsif p_stat = 'installed' then
    return query
      select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'installed'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is true
      order by p.display_name nulls last;

  elsif p_stat = 'browser' then
    return query
      select coalesce(p.display_name,'(no name)'), coalesce(p.email,''), 'browser'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and p.last_standalone is false
      order by p.display_name nulls last;

  -- ===== notifications =====
  elsif p_stat = 'notif_on' then
    return query
      select coalesce(p.display_name,'(no name)'), 'push enabled', 'on'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and coalesce(p.push_prefs->>'_master','true') <> 'false'
        and exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false)
      order by p.display_name nulls last;

  elsif p_stat = 'notif_off' then
    return query
      select coalesce(p.display_name,'(no name)'),
             case when coalesce(p.push_prefs->>'_master','true')='false' then 'master muted'
                  else 'no active device' end,
             'off'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and (coalesce(p.push_prefs->>'_master','true')='false'
             or not exists (select 1 from push_subscriptions s where s.user_id=p.id and s.disabled=false))
      order by p.display_name nulls last;

  elsif p_stat = 'failing_subs' then
    return query
      select coalesce(p.display_name,'(no name)'),
             'fails '||max(s.fail_count)::text||' · last seen '||to_char(max(s.last_seen),'Mon DD'),
             'stale'::text
      from push_subscriptions s join profiles p on p.id=s.user_id
      where s.disabled=true or s.fail_count >= 3 or s.last_seen < now() - interval '14 days'
      group by p.id, p.display_name
      order by max(s.fail_count) desc nulls last;

  elsif p_stat = 'mute' and p_arg is not null then
    return query
      select coalesce(p.display_name,'(no name)'), 'muted '||p_arg, 'muted'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and coalesce(p.push_prefs->>p_arg,'true')='false'
      order by p.display_name nulls last;

  -- ===== profile sharing =====
  elsif p_stat = 'share_on' then
    return query
      select coalesce(p.display_name,'(no name)'), 'card visible', 'on'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=true
      order by p.display_name nulls last;

  elsif p_stat = 'share_off' then
    return query
      select coalesce(p.display_name,'(no name)'), 'opted out', 'off'::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false and coalesce(p.show_card,true)=false
      order by p.display_name nulls last;

  -- ===== guests (hosted by members) =====
  elsif p_stat = 'guests' then
    return query
      select coalesce(host.display_name,'(no name)'), count(*)::text||' guest rounds hosted', 'host'::text
      from game_players gp join profiles host on host.id = gp.guest_of
      where gp.guest_of is not null
      group by host.id, host.display_name
      order by count(*) desc;

  -- ===== feature usage =====
  elsif p_stat = 'avatars_set' then
    return query
      select coalesce(p.display_name,'(no name)'), 'has avatar', null::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and p.avatar_url is not null and p.avatar_url <> ''
      order by p.display_name nulls last;

  elsif p_stat = 'ai_summaries' then
    return query
      select coalesce(p.display_name,'(no name)'), 'has AI summary', null::text
      from profiles p
      where coalesce(p.is_test,false)=false and coalesce(p.deactivated,false)=false
        and p.dashboard_ai is not null
      order by p.display_name nulls last;

  end if;
  return;
end;
$function$;
grant execute on function public.admin_stat_users(text, text, date) to authenticated;
