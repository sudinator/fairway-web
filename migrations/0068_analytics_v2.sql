-- 0068_analytics_v2.sql
-- Analytics accuracy pass:
--   * daily_active.opens — raw open counter so we can show TOTAL views alongside UNIQUE users.
--   * profiles.is_test — test/QA accounts are fully functional but excluded from every metric
--     (so feature testing doesn't pollute stats). Admin-set via admin_set_test().
--   * get_admin_analytics rewritten: Rounds count COMPLETED rounds only (status='final'),
--     never deleted (deleted_at is null); a separate started/abandoned figure is exposed.
--     Abandoned% now spans BOTH games and rounds. Total + unique opens for today/7d/30d.
--     Test users excluded throughout. Plus new engagement stats.

alter table public.daily_active add column if not exists opens int not null default 1;
alter table public.profiles     add column if not exists is_test boolean not null default false;

-- Ping on app open now also counts the open (for total views).
create or replace function public.mark_active()
returns void language plpgsql security definer set search_path = public as $function$
begin
  if auth.uid() is null then return; end if;
  insert into daily_active(user_id, day, opens) values (auth.uid(), current_date, 1)
  on conflict (user_id, day) do update set opens = daily_active.opens + 1;
end;
$function$;
grant execute on function public.mark_active() to authenticated;

-- Admin: flag/unflag a user as a test account (excluded from analytics).
create or replace function public.admin_set_test(p_user uuid, p_is_test boolean)
returns void language plpgsql security definer set search_path = public as $function$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update public.profiles set is_test = coalesce(p_is_test, false) where id = p_user;
end;
$function$;
grant execute on function public.admin_set_test(uuid, boolean) to authenticated;

create or replace function public.get_admin_analytics()
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  j jsonb;
  v_dau int; v_wau int; v_mau int; v_a7 numeric; v_a30 numeric;
  v_views_today int; v_views_7d int; v_views_30d int;
  v_created int; v_ended int;
  v_rdone int; v_rstarted int; v_rdone30 int;
  v_churn int;
  v_games_total int; v_rounds_total int; v_abandoned int;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;

  -- Active users (UNIQUE) + opens (TOTAL), test accounts excluded.
  select count(distinct da.user_id) filter (where da.day = current_date),
         count(distinct da.user_id) filter (where da.day > current_date - 7),
         count(distinct da.user_id) filter (where da.day > current_date - 30),
         coalesce(sum(da.opens) filter (where da.day = current_date), 0),
         coalesce(sum(da.opens) filter (where da.day > current_date - 7), 0),
         coalesce(sum(da.opens) filter (where da.day > current_date - 30), 0)
    into v_dau, v_wau, v_mau, v_views_today, v_views_7d, v_views_30d
  from daily_active da join profiles p on p.id = da.user_id
  where coalesce(p.is_test, false) = false;

  select coalesce(count(*)::numeric,0) / 7  into v_a7
    from daily_active da join profiles p on p.id = da.user_id
    where da.day > current_date - 7 and coalesce(p.is_test,false) = false;
  select coalesce(count(*)::numeric,0) / 30 into v_a30
    from daily_active da join profiles p on p.id = da.user_id
    where da.day > current_date - 30 and coalesce(p.is_test,false) = false;

  -- Churn: active 30–60 days ago but NOT in the last 30 days.
  select count(*) into v_churn from (
    select da.user_id
    from daily_active da join profiles p on p.id = da.user_id
    where coalesce(p.is_test,false) = false
    group by da.user_id
    having max(da.day) between current_date - 60 and current_date - 31
  ) t;

  -- Games (test creators excluded).
  select count(*), count(*) filter (where g.status = 'ended')
    into v_created, v_ended
  from games g left join profiles p on p.id = g.created_by
  where coalesce(p.is_test,false) = false;

  -- Rounds: completed only, never deleted; started (non-deleted, not final) tracked apart.
  select count(*) filter (where r.status = 'final'),
         count(*) filter (where r.status <> 'final'),
         count(*) filter (where r.status = 'final' and r.created_at > now() - interval '30 days')
    into v_rdone, v_rstarted, v_rdone30
  from rounds r join profiles p on p.id = r.user_id
  where r.deleted_at is null and coalesce(p.is_test,false) = false;

  -- Abandoned spans games AND rounds: stale (>3d) games with no round + stale started rounds.
  v_games_total := v_created;
  v_rounds_total := v_rdone + v_rstarted;
  v_abandoned :=
      (select count(*) from games g left join profiles p on p.id = g.created_by
        where coalesce(p.is_test,false)=false and g.status='active'
          and g.created_at < now() - interval '3 days'
          and not exists (select 1 from rounds r where r.game_id = g.id and r.deleted_at is null))
    + (select count(*) from rounds r join profiles p on p.id = r.user_id
        where coalesce(p.is_test,false)=false and r.deleted_at is null
          and r.status <> 'final' and r.created_at < now() - interval '3 days');

  j := jsonb_build_object(
    'totals', jsonb_build_object(
      'users',         (select count(*) from profiles where coalesce(deactivated,false)=false and coalesce(is_test,false)=false),
      'users_new_30d', (select count(*) from profiles where created_at > now() - interval '30 days' and coalesce(is_test,false)=false),
      'active_groups', (select count(distinct g.group_id) from games g left join profiles p on p.id=g.created_by where g.created_at > now() - interval '30 days' and g.group_id is not null and coalesce(p.is_test,false)=false),
      'games',         v_created,
      'games_30d',     (select count(*) from games g left join profiles p on p.id=g.created_by where g.created_at > now() - interval '30 days' and coalesce(p.is_test,false)=false),
      'rounds',        v_rdone,          -- completed only, excludes deleted
      'rounds_30d',    v_rdone30,
      'rounds_started', v_rstarted,      -- started but not completed (non-deleted)
      'rounds_per_active_user', case when v_mau > 0 then round(v_rdone30::numeric / v_mau, 1) else 0 end
    ),
    'active', jsonb_build_object(
      'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
      'views_today', v_views_today, 'views_7d', v_views_7d, 'views_30d', v_views_30d,
      'avg7',  round(coalesce(v_a7, 0), 1),
      'avg30', round(coalesce(v_a30, 0), 1),
      'stickiness_pct', case when v_mau > 0 then round(100.0 * v_dau / v_mau) else 0 end,
      'churn_30d', v_churn,
      'series', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::text, 'n', coalesce(c.n, 0)) order by d)
        from generate_series(current_date - 29, current_date, interval '1 day') g(d)
        left join (
          select da.day, count(distinct da.user_id) n from daily_active da
          join profiles p on p.id = da.user_id where coalesce(p.is_test,false)=false
          group by da.day
        ) c on c.day = g.d::date
      ), '[]'::jsonb)
    ),
    'formats', (
      select coalesce(jsonb_object_agg(game_type, n), '{}'::jsonb)
      from (select g.game_type, count(*) n from games g left join profiles p on p.id=g.created_by
            where coalesce(p.is_test,false)=false group by g.game_type) t
    ),
    'engagement', jsonb_build_object(
      'tee_times_30d',    (select count(*) from tee_times where created_at > now() - interval '30 days'),
      'tee_rsvps_30d',    (select count(*) from tee_time_rsvps rr join tee_times tt on tt.id=rr.tee_time_id where tt.created_at > now() - interval '30 days'),
      'bets_posted',      (select count(*) from expenses where source_kind = 'tgc_bet'),
      'bets_30d',         (select count(*) from expenses where source_kind = 'tgc_bet' and created_at > now() - interval '30 days'),
      'settled_cents',    (select coalesce(sum(amount_cents),0) from settlements),
      'invites_created_30d', (select count(*) from group_invites where created_at > now() - interval '30 days'),
      'joins_via_invite',    (select coalesce(sum(use_count),0) from group_invites),
      'group_scoring_pct', case when v_created > 0 then round(100.0 * (
          select count(*) from games g left join profiles p on p.id=g.created_by
          where coalesce(p.is_test,false)=false
            and (g.marker_user_id is not null or exists (select 1 from game_players gp where gp.game_id=g.id and gp.is_marker))
        ) / v_created) else 0 end
    ),
    'features', jsonb_build_object(
      'avatars_set',      (select count(*) from profiles where avatar_url is not null and coalesce(is_test,false)=false),
      'ai_summaries',     (select count(*) from profiles where dashboard_ai is not null and coalesce(is_test,false)=false),
      'live_shared',      (select count(*) from games where share_token is not null),
      'courses_added_30d',(select count(*) from favorite_courses where created_at > now() - interval '30 days' and coalesce(deleted,false)=false)
    ),
    'health', jsonb_build_object(
      'completion_pct', case when v_created > 0 then round(100.0 * v_ended / v_created) else 0 end,
      'round_completion_pct', case when (v_rdone + v_rstarted) > 0 then round(100.0 * v_rdone / (v_rdone + v_rstarted)) else 0 end,
      'abandoned_pct', case when (v_games_total + v_rounds_total) > 0 then round(100.0 * v_abandoned / (v_games_total + v_rounds_total)) else 0 end,
      'avg_holes', coalesce((
        select round(avg(c), 1) from (
          select (select count(*) from jsonb_array_elements(gp.scores) e where e <> 'null'::jsonb) c
          from game_players gp where jsonb_typeof(gp.scores) = 'array'
        ) t where c > 0
      ), 0),
      'never_joined_group_pct', case when (select count(*) from profiles where coalesce(is_test,false)=false) > 0 then round(100.0 * (
          select count(*) from profiles p where coalesce(p.is_test,false)=false
            and not exists (select 1 from group_members m where m.user_id = p.id and m.status = 'active')
        ) / (select count(*) from profiles where coalesce(is_test,false)=false)) else 0 end,
      'activated_7d_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from rounds r where r.user_id = p.id and r.deleted_at is null
                   and r.status='final' and r.created_at <= p.created_at + interval '7 days'
               )) / nullif(count(*), 0))
        from profiles p where p.created_at > now() - interval '90 days' and coalesce(p.is_test,false)=false
      ), 0),
      'retention_w1_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 1 and f.first_day + 7)) / nullif(count(*), 0))
        from (select da.user_id, min(da.day) first_day from daily_active da join profiles p on p.id=da.user_id where coalesce(p.is_test,false)=false group by da.user_id) f
        where f.first_day between current_date - 37 and current_date - 7
      ), 0),
      'retention_w4_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 22 and f.first_day + 28)) / nullif(count(*), 0))
        from (select da.user_id, min(da.day) first_day from daily_active da join profiles p on p.id=da.user_id where coalesce(p.is_test,false)=false group by da.user_id) f
        where f.first_day between current_date - 58 and current_date - 28
      ), 0)
    )
  );
  return j;
end;
$function$;
grant execute on function public.get_admin_analytics() to authenticated;
