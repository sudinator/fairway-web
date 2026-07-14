-- 0104_admin_stale_games.sql
-- System-admin, app-wide, READ-ONLY. Every game not marked 'ended' and older than 24h, with per-player
-- scoring completeness (same read of game_players.scores as post_game_rounds / sweep_stale_games: a
-- 0-based jsonb array, hole scored when its element > 0, hole count = jsonb_array_length(holes_meta)).
-- Feeds the Operations panel so an admin can gauge how much stale/abandoned game data is awaiting
-- cleanup. Writes nothing.
--   verdict: 'fully_scored' — every player who started is done, none mid-round (auto-completes if <30d)
--            'in_progress'  — at least one player still has holes to enter
--            'no_scores'    — players attached but nobody entered anything
--            'empty'        — no players attached
create or replace function public.admin_stale_games()
returns table (
  game_id uuid, name text, course text, club text, organizer text, holes int,
  created_at timestamptz, age_days numeric, players int,
  complete int, partial int, not_started int, verdict text, rounds_posted int
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;

  return query
  with ag as (
    select g.id, g.name, g.course, g.created_by, g.group_id, g.created_at,
           jsonb_array_length(coalesce(g.holes_meta, '[]'::jsonb)) as n
    from games g
    where g.status is distinct from 'ended'
      and g.created_at < now() - interval '24 hours'
  ),
  pp as (
    select ag.id as gid, ag.n,
           (select count(*) from generate_series(0, ag.n - 1) i
              where nullif(gp.scores->>i, '') is not null and (gp.scores->>i)::int > 0) as entered
    from ag join game_players gp on gp.game_id = ag.id
    where gp.user_id is not null and ag.n > 0
  ),
  agg as (
    select gid,
           count(*)::int                                          as players,
           count(*) filter (where entered = n)::int               as complete,
           count(*) filter (where entered > 0 and entered < n)::int as partial,
           count(*) filter (where entered = 0)::int               as not_started
    from pp group by gid
  )
  select
    ag.id,
    coalesce(ag.name, '(unnamed)')::text,
    ag.course::text,
    coalesce(gr.name, ag.group_id::text)::text,
    coalesce(p.display_name, p.email, ag.created_by::text)::text,
    ag.n,
    ag.created_at,
    round(extract(epoch from (now() - ag.created_at)) / 86400.0, 1),
    coalesce(a.players, 0),
    coalesce(a.complete, 0),
    coalesce(a.partial, 0),
    coalesce(a.not_started, 0),
    (case
       when coalesce(a.players, 0) = 0        then 'empty'
       when a.partial = 0 and a.complete >= 1 then 'fully_scored'
       when a.partial > 0                     then 'in_progress'
       else 'no_scores'
     end)::text,
    (select count(*)::int from rounds r where r.game_id = ag.id and r.deleted_at is null)
  from ag
  left join agg a      on a.gid = ag.id
  left join profiles p on p.id  = ag.created_by
  left join groups gr  on gr.id = ag.group_id
  order by
    case when a.partial = 0 and coalesce(a.complete, 0) >= 1 then 0   -- fully scored (cleanable) first
         when coalesce(a.players, 0) = 0 then 1                        -- empty shells
         when a.partial > 0 then 2                                     -- genuinely mid-round
         else 3 end,
    ag.created_at asc;                                                 -- oldest first within a class
end;
$$;
grant execute on function public.admin_stale_games() to authenticated;
