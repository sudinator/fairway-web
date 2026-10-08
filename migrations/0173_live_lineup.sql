-- 0173_live_lineup.sql
--
-- A LIVE line-up link, for the WhatsApp chat.
--
-- The line-up card as an image stops working past one foursome: twenty players make an 1,800px
-- image that WhatsApp shrinks to a thumbnail, and it is wrong forever the moment the organizer
-- swaps a pairing. get_live_lineup(token) serves the same facts as a page that is always current
-- and dies with the game: while the game is in setup or active it returns the players, their
-- handicap inputs, tees, teams, pairings, foursomes and the course's tees (rating/slope); once the
-- game is ENDED it returns {ended:true} and nothing else — the chat link goes dark, by design.
--
-- It uses the game's existing share_token (0018) and the organizer's existing set_game_share
-- toggle, so there is one switch for "this game has a public link" and /live and /lineup share it.
-- Compared with get_live_scorecard it exposes LESS: no scores, no putts, no money — only what
-- appears on a line-up card. The client computes playing handicaps and strokes with lib/lineup.ts,
-- the same arithmetic the scorecard uses.
--
-- AUTHORIZATION: SECURITY DEFINER, granted to anon and authenticated, keyed solely by the
-- unguessable token (gen_random_uuid-derived, 0018). Returns null for an unknown token. The games
-- table itself stays private. Course tees are resolved as the app does: the club's linked course
-- by name first (group_courses), else the global library by exact name.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.get_live_lineup(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g record;
  v_players jsonb;
  v_tees jsonb;
begin
  if p_token is null or length(p_token) < 8 then return null; end if;
  select * into g from games where share_token = p_token;
  if g.id is null then return null; end if;
  if g.status = 'ended' then
    return jsonb_build_object('ended', true, 'name', g.name, 'course', g.course, 'code', g.code);
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

  -- The course's tees, the way the app finds them: the club's linked course by name, else the
  -- global library by exact name. Rating and slope are what the page shows.
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
    'played_at',     to_char(g.created_at at time zone 'America/New_York', 'Dy Mon FMDD'),
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

select public.record_migration('0173_live_lineup');

commit;
