-- 0078_admin_engagement.sql
-- Golf-cadence engagement metrics for the admin analytics panel. Complements the existing
-- get_admin_analytics() (which is DAU/app-open framed). Golf is weekend-skewed and episodic,
-- so these measure the RIGHT unit (the round) on the RIGHT cycle (the week / the golf weekend):
--   * WAU/MAU on rounds (honest stickiness, not DAU/MAU)
--   * weekend reach series (distinct golfers logging Fri-Sun, per ISO week, last 12 weeks)
--   * weekend vs weekday share (validates the Fri-Sun skew)
--   * rounds per active golfer per ~month (28d)
--   * new vs returning golfers per week (based on first-ever round, not app-opens)
--   * feature split: rounds played inside a game vs solo
-- All read only `rounds` (deleted_at is null), server-side, returned as one JSON payload so the
-- client never does broad table reads (free-tier friendly). Postgres dow: Sun=0..Sat=6, so a
-- "golf weekend" is dow in (5,6,0) = Fri/Sat/Sun, all within the same ISO week (Mon-start).

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

  select count(distinct user_id) into v_wau  from rounds where deleted_at is null and played_at > current_date - 7;
  select count(distinct user_id) into v_mau  from rounds where deleted_at is null and played_at > current_date - 30;
  select count(distinct user_id) into v_active28 from rounds where deleted_at is null and played_at > current_date - 28;
  select count(*)                into v_rounds28  from rounds where deleted_at is null and played_at > current_date - 28;

  j := jsonb_build_object(
    'wau', v_wau,
    'mau', v_mau,
    'wau_mau_pct', case when v_mau > 0 then round(100.0 * v_wau / v_mau) else 0 end,
    'active_28d', v_active28,
    'rounds_28d', v_rounds28,
    'rounds_per_active_mo', case when v_active28 > 0 then round(v_rounds28::numeric / v_active28, 1) else 0 end,
    'weekend_share_pct', coalesce((
      select round(100.0 * count(*) filter (where extract(dow from played_at) in (5,6,0)) / nullif(count(*), 0))
      from rounds where deleted_at is null and played_at > current_date - 90), 0),
    'weekend_series', coalesce((
      select jsonb_agg(jsonb_build_object('week', to_char(wk + 5, 'Mon DD'), 'golfers', g, 'rounds', r) order by wk)
      from (
        select date_trunc('week', played_at)::date wk,
               count(distinct user_id) filter (where extract(dow from played_at) in (5,6,0)) g,
               count(*)                filter (where extract(dow from played_at) in (5,6,0)) r
        from rounds
        where deleted_at is null and played_at > current_date - 7 * 12
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
          from rounds where deleted_at is null group by user_id
        ) fr on fr.user_id = r.user_id
        where r.deleted_at is null and r.played_at > current_date - 7 * 12
        group by 1
      ) s), '[]'::jsonb),
    'feature', jsonb_build_object(
      'in_game', (select count(*) from rounds where deleted_at is null and game_id is not null and played_at > current_date - 90),
      'solo',    (select count(*) from rounds where deleted_at is null and game_id is null     and played_at > current_date - 90)
    )
  );
  return j;
end;
$function$;

grant execute on function public.get_admin_engagement() to authenticated;
