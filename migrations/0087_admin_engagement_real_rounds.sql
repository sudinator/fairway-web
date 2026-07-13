-- 0087_admin_engagement_real_rounds.sql
-- Fix: get_admin_engagement() filtered `deleted_at is null` but never excluded in-progress
-- rounds. Since in-progress rounds carry a played_at (default current_date), they were
-- counted as "rounds played" in WAU/MAU, weekend reach/share, new-vs-returning, and the
-- game/solo split — over-counting engagement. Now every rounds read also requires
-- coalesce(status,'final') <> 'in_progress', matching the real-round definition used by
-- get_admin_analytics and the rest of the app. Pure function fix; no data change.
create or replace function public.get_admin_engagement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  j jsonb;
  v_wau int; v_mau int; v_active28 int; v_rounds28 int;
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;

  select count(distinct user_id) into v_wau      from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 7;
  select count(distinct user_id) into v_mau      from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 30;
  select count(distinct user_id) into v_active28 from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 28;
  select count(*)                into v_rounds28 from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 28;

  j := jsonb_build_object(
    'wau', v_wau,
    'mau', v_mau,
    'wau_mau_pct', case when v_mau > 0 then round(100.0 * v_wau / v_mau) else 0 end,
    'active_28d', v_active28,
    'rounds_28d', v_rounds28,
    'rounds_per_active_mo', case when v_active28 > 0 then round(v_rounds28::numeric / v_active28, 1) else 0 end,
    'weekend_share_pct', coalesce((
      select round(100.0 * count(*) filter (where extract(dow from played_at) in (5,6,0)) / nullif(count(*), 0))
      from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 90), 0),
    'weekend_series', coalesce((
      select jsonb_agg(jsonb_build_object('week', to_char(wk + 5, 'Mon DD'), 'golfers', g, 'rounds', r) order by wk)
      from (
        select date_trunc('week', played_at)::date wk,
               count(distinct user_id) filter (where extract(dow from played_at) in (5,6,0)) g,
               count(*)                filter (where extract(dow from played_at) in (5,6,0)) r
        from rounds
        where deleted_at is null and coalesce(status,'final') <> 'in_progress' and played_at > current_date - 7 * 12
        group by 1
      ) s), '[]'::jsonb),
    'weekly_new_returning', coalesce((
      select jsonb_agg(jsonb_build_object('week', to_char(wk, 'Mon DD'), 'new', nw, 'returning', rt) order by wk)
      from (
        select date_trunc('week', r.played_at)::date wk,
               count(distinct r.user_id) filter (where fr.first_week = date_trunc('week', r.played_at)::date) nw,
               count(distinct r.user_id) filter (where fr.first_week < date_trunc('week', r.played_at)::date) rt
        from rounds r
        join (
          select user_id, date_trunc('week', min(played_at))::date first_week
          from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' group by user_id
        ) fr on fr.user_id = r.user_id
        where r.deleted_at is null and coalesce(r.status,'final') <> 'in_progress' and r.played_at > current_date - 7 * 12
        group by 1
      ) s), '[]'::jsonb),
    'feature', jsonb_build_object(
      'in_game', (select count(*) from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and game_id is not null and played_at > current_date - 90),
      'solo',    (select count(*) from rounds where deleted_at is null and coalesce(status,'final') <> 'in_progress' and game_id is null     and played_at > current_date - 90)
    )
  );
  return j;
end;
$function$;
grant execute on function public.get_admin_engagement() to authenticated;
