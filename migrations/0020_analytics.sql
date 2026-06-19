-- 0020_analytics.sql
-- Admin utilization analytics. Adds a tiny per-user-per-day activity table (the
-- only new instrumentation), a created_at on profiles (backfilled from earliest
-- known activity so "new users" is meaningful for existing accounts), a cheap
-- mark_active() the client calls on app open, and one admin-only aggregator that
-- returns every metric as JSON so the client never needs broad table reads.

-- 1) Per-user-per-day activity. One row per user per active day; rows are tiny.
create table if not exists public.daily_active (
  user_id uuid not null references auth.users(id) on delete cascade,
  day     date not null default current_date,
  primary key (user_id, day)
);
alter table public.daily_active enable row level security;
drop policy if exists "daily_active insert self" on public.daily_active;
create policy "daily_active insert self" on public.daily_active
  for insert with check (user_id = auth.uid());
-- No SELECT policy needed: reads happen only through the admin aggregator below
-- (SECURITY DEFINER), keeping per-user activity private.

-- 2) Signup date for cohort/new-user metrics. profiles had no created_at; add one
-- and backfill existing rows from the earliest evidence we have of each user.
alter table public.profiles add column if not exists created_at timestamptz default now();
update public.profiles p set created_at = e.first_seen
from (
  select u.id,
         least(
           coalesce((select min(created_at) from group_members where user_id = u.id), now()),
           coalesce((select min(created_at) from rounds        where user_id = u.id), now()),
           coalesce((select min(created_at) from activity_log  where actor_id = u.id), now())
         ) as first_seen
  from profiles u
) e
where p.id = e.id and e.first_seen < p.created_at;

-- 3) Cheap activity ping — called on app open. Only ever writes the caller's row.
create or replace function public.mark_active()
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.uid() is null then return; end if;
  insert into daily_active(user_id, day) values (auth.uid(), current_date)
  on conflict do nothing;
end;
$function$;
grant execute on function public.mark_active() to authenticated;

-- 4) Admin-only aggregator. Returns all analytics as one JSON payload. Gated by
-- is_admin(); SECURITY DEFINER so it can count across tables without the client
-- holding broad read access.
create or replace function public.get_admin_analytics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  j           jsonb;
  v_dau int; v_wau int; v_mau int; v_a7 numeric; v_a30 numeric;
  v_created int; v_ended int;
begin
  if not public.is_admin() then
    raise exception 'admins only';
  end if;

  select count(*) filter (where day = current_date),
         count(distinct user_id) filter (where day > current_date - 7),
         count(distinct user_id) filter (where day > current_date - 30)
    into v_dau, v_wau, v_mau
  from daily_active;

  select count(*)::numeric / 7  into v_a7  from daily_active where day > current_date - 7;
  select count(*)::numeric / 30 into v_a30 from daily_active where day > current_date - 30;

  select count(*) filter (where true),
         count(*) filter (where status = 'ended')
    into v_created, v_ended
  from games;

  j := jsonb_build_object(
    'totals', jsonb_build_object(
      'users',         (select count(*) from profiles where coalesce(deactivated, false) = false),
      'users_new_30d', (select count(*) from profiles where created_at > now() - interval '30 days'),
      'active_groups', (select count(distinct group_id) from games where created_at > now() - interval '30 days' and group_id is not null),
      'games',         v_created,
      'games_30d',     (select count(*) from games where created_at > now() - interval '30 days'),
      'rounds',        (select count(*) from rounds),
      'rounds_30d',    (select count(*) from rounds where created_at > now() - interval '30 days')
    ),
    'active', jsonb_build_object(
      'dau', v_dau, 'wau', v_wau, 'mau', v_mau,
      'avg7',  round(coalesce(v_a7, 0), 1),
      'avg30', round(coalesce(v_a30, 0), 1),
      'stickiness_pct', case when v_mau > 0 then round(100.0 * v_dau / v_mau) else 0 end,
      'series', coalesce((
        select jsonb_agg(jsonb_build_object('day', d::text, 'n', coalesce(c.n, 0)) order by d)
        from generate_series(current_date - 29, current_date, interval '1 day') g(d)
        left join (select day, count(*) n from daily_active group by day) c on c.day = g.d::date
      ), '[]'::jsonb)
    ),
    'formats', (
      select coalesce(jsonb_object_agg(game_type, n), '{}'::jsonb)
      from (select game_type, count(*) n from games group by game_type) t
    ),
    'features', jsonb_build_object(
      'avatars_set',      (select count(*) from profiles where avatar_url is not null),
      'ai_summaries',     (select count(*) from profiles where dashboard_ai is not null),
      'live_shared',      (select count(*) from games where share_token is not null),
      'courses_added_30d',(select count(*) from favorite_courses where created_at > now() - interval '30 days' and coalesce(deleted, false) = false)
    ),
    'health', jsonb_build_object(
      'completion_pct', case when v_created > 0 then round(100.0 * v_ended / v_created) else 0 end,
      'abandoned_pct', case when v_created > 0 then round(100.0 * (
          select count(*) from games g
          where g.status = 'active' and g.created_at < now() - interval '3 days'
            and not exists (select 1 from rounds r where r.game_id = g.id)
        ) / v_created) else 0 end,
      'avg_holes', coalesce((
        select round(avg(c), 1) from (
          select (select count(*) from jsonb_array_elements(gp.scores) e where e <> 'null'::jsonb) c
          from game_players gp
          where jsonb_typeof(gp.scores) = 'array'
        ) t where c > 0
      ), 0),
      'never_joined_group_pct', case when (select count(*) from profiles) > 0 then round(100.0 * (
          select count(*) from profiles p
          where not exists (select 1 from group_members m where m.user_id = p.id and m.status = 'active')
        ) / (select count(*) from profiles)) else 0 end,
      'activated_7d_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from rounds r where r.user_id = p.id and r.created_at <= p.created_at + interval '7 days'
               )) / nullif(count(*), 0))
        from profiles p
        where p.created_at > now() - interval '90 days'
      ), 0),
      -- Retention accrues once daily_active has history; sparse for the first weeks.
      'retention_w1_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 1 and f.first_day + 7)) / nullif(count(*), 0))
        from (select user_id, min(day) first_day from daily_active group by user_id) f
        where f.first_day between current_date - 37 and current_date - 7
      ), 0),
      'retention_w4_pct', coalesce((
        select round(100.0 * count(*) filter (where exists (
                 select 1 from daily_active d2 where d2.user_id = f.user_id
                   and d2.day between f.first_day + 22 and f.first_day + 28)) / nullif(count(*), 0))
        from (select user_id, min(day) first_day from daily_active group by user_id) f
        where f.first_day between current_date - 58 and current_date - 28
      ), 0)
    )
  );
  return j;
end;
$function$;
grant execute on function public.get_admin_analytics() to authenticated;
