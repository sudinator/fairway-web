-- 0088_power_users.sql
-- Super-admin analytics: top users by a composite engagement score, with every underlying
-- metric exposed individually (client re-sorts) plus friction/churn signals that answer
-- "did engaged users try, hit breakage, and give up?".
--
-- Composite score = completed*4 + games*2 + active_days*1 + opens*0.1
--   completed rounds are the real unit of value; opens are noisy so weighted low.
-- Friction flag: >=3 abandoned/deleted attempts AND completion rate < 60% (kept starting
--   rounds that never finalized — the phantom-round-bug signature).
-- Churn flag: no activity in > 30 days (or never active).
--
-- All metrics honor the window param: p_days null = all-time; e.g. 90 = last 90 days.
-- Real-round definition matches the rest of the app: deleted_at is null AND status<>'in_progress'.
-- Test + deactivated accounts excluded. is_admin() gate returns zero rows to non-admins.
create or replace function public.get_power_users(p_days int default null)
returns table (
  user_id uuid,
  display_name text,
  completed_rounds int,
  unfinished_rounds int,
  deleted_rounds int,
  games_played int,
  active_days int,
  total_opens int,
  completion_pct int,
  last_active date,
  days_since_active int,
  churned boolean,
  friction boolean,
  score numeric
)
language sql security definer set search_path = public as $$
  with base as (
    select p.id, p.display_name, p.last_active
    from profiles p
    where public.is_admin()
      and coalesce(p.is_test, false) = false
      and coalesce(p.deactivated, false) = false
  ),
  rc as (
    select r.user_id,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') <> 'in_progress'
                        and (p_days is null or r.played_at > current_date - p_days))                         as completed,
      count(*) filter (where r.deleted_at is null and coalesce(r.status,'final') = 'in_progress'
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as unfinished,
      count(*) filter (where r.deleted_at is not null
                        and (p_days is null or r.created_at > now() - make_interval(days => p_days)))         as deleted
    from rounds r
    group by r.user_id
  ),
  gp as (
    select gpl.user_id, count(*) as games
    from game_players gpl
    join games g on g.id = gpl.game_id
    where (p_days is null or g.created_at > now() - make_interval(days => p_days))
    group by gpl.user_id
  ),
  da as (
    select user_id, count(*) as active_days, coalesce(sum(opens), 0) as opens
    from daily_active
    where (p_days is null or day > current_date - p_days)
    group by user_id
  )
  select
    b.id,
    b.display_name,
    coalesce(rc.completed, 0)::int,
    coalesce(rc.unfinished, 0)::int,
    coalesce(rc.deleted, 0)::int,
    coalesce(gp.games, 0)::int,
    coalesce(da.active_days, 0)::int,
    coalesce(da.opens, 0)::int,
    case when coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) > 0
         then round(100.0 * coalesce(rc.completed,0)
                    / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)))::int
         else null end,
    b.last_active::date,
    case when b.last_active is null then null else (current_date - b.last_active::date) end,
    case when b.last_active is null then true else (current_date - b.last_active::date) > 30 end,
    (coalesce(rc.unfinished,0) + coalesce(rc.deleted,0) >= 3
      and (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) > 0
      and 100.0 * coalesce(rc.completed,0)
          / (coalesce(rc.completed,0) + coalesce(rc.unfinished,0) + coalesce(rc.deleted,0)) < 60),
    (coalesce(rc.completed,0) * 4 + coalesce(gp.games,0) * 2 + coalesce(da.active_days,0) * 1
      + coalesce(da.opens,0) * 0.1)::numeric as score
  from base b
  left join rc on rc.user_id = b.id
  left join gp on gp.user_id = b.id
  left join da on da.user_id = b.id
  order by score desc nulls last
  limit 25;
$$;
grant execute on function public.get_power_users(int) to authenticated;
