-- 0176_live_lineup_match_date.sql
--
-- The line-up link shows the MATCH date, not the day the game was created.
--
-- 0173 returned played_at as the game's created_at (the author believed games carried no play date).
-- games.played_at is the match date (0110: "stamps the game's MATCH date (games.played_at), not its
-- creation time"), and the in-app card already shows it. A link created today for Saturday's game
-- read as today's game. The read now returns `played_on` — the match date in Eastern as YYYY-MM-DD,
-- formatted on the viewer's device — and keeps `played_at` (same date, pre-formatted) for callers
-- that still read it. Falls back to created_at only when played_at is null.
--
-- AUTHORIZATION: unchanged from 0173 — SECURITY DEFINER, granted to anon and authenticated, keyed solely
-- by the unguessable share token; returns null for an unknown token; no scores, putts or money.
-- Idempotent; safe to re-run.

begin;

create or replace function public.get_live_lineup(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g record;
  v_players jsonb;
  v_tees jsonb;
  v_date date;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select * into g from games where share_token = p_token;
  if g.id is null then return null; end if;
  -- games.played_at is a DATE: use it as it is. Applying `at time zone` to a date in a UTC session
  -- shifts it to the previous evening (2026-10-10 -> 2026-10-09; caught by ci/assert-live-lineup.sql).
  -- Only the created_at fallback (a timestamptz) needs the zone conversion.
  v_date := coalesce(g.played_at, (g.created_at at time zone 'America/New_York')::date);
  if g.status = 'ended' then
    return jsonb_build_object('ended', true, 'name', g.name, 'course', g.course, 'code', g.code, 'played_on', v_date);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',                     gp.id,
      'user_id',                gp.user_id,
      'display_name',           gp.display_name,
      'handicap_index',         gp.handicap_index,
      'course_handicap',        gp.course_handicap,
      'course_handicap_source', gp.course_handicap_source,
      'slope',                  gp.slope,
      'rating',                 gp.rating,
      'tee_name',               gp.tee_name,
      'team',                   gp.team,
      'tee_group',              gp.tee_group,
      'no_show',                coalesce(gp.no_show, false)
    ) order by gp.display_name), '[]'::jsonb)
    into v_players
    from game_players gp where gp.game_id = g.id;

  select coalesce(fc.data -> 'tees', '[]'::jsonb) into v_tees
    from favorite_courses fc
   where coalesce(fc.deleted, false) = false
     and (fc.name = g.course or (fc.data ->> 'name') = g.course)
   order by (exists (select 1 from group_courses gc where gc.course_id = fc.id and gc.group_id = g.group_id)) desc,
            fc.created_at asc
   limit 1;

  return jsonb_build_object(
    'ended',         false,
    'id',            g.id,
    'code',          g.code,
    'name',          g.name,
    'course',        g.course,
    'played_on',     v_date,
    'played_at',     to_char(v_date, 'Dy Mon FMDD'),
    'game_type',     g.game_type,
    'status',        g.status,
    'allowance_pct', g.allowance_pct,
    'course_par',    g.course_par,
    'holes_meta',    coalesce(g.holes_meta, '[]'::jsonb),
    'teams',         g.teams,
    'pairings',      coalesce(g.pairings, '[]'::jsonb),
    'foursomes',     coalesce(g.foursomes, '[]'::jsonb),
    'players',       v_players,
    'course_tees',   coalesce(v_tees, '[]'::jsonb),
    'as_of',         now()
  );
end $$;
revoke all on function public.get_live_lineup(text) from public;
grant execute on function public.get_live_lineup(text) to anon, authenticated;

select public.record_migration('0176_live_lineup_match_date');

commit;
