-- 0151_live_alt_shot_and_guests.sql
-- Two fixes to the public live-share payload, both required before Alternate Shot can render on the
-- share page and before a Ryder Cup share page can show its Alternate Shot sessions.
--
-- 1. ALTERNATE SHOT SIDE SCORES. Alternate Shot is one ball per SIDE: the canonical score lives in
--    game_alt_shot_scores (0140/0141), keyed (game_id, foursome_id, side, hole_index), NOT on the
--    player rows. get_live_scorecard never returned it, so the share page had no data to draw and
--    the format was simply absent from the public page. `strokes` may be NULL — that is an explicit
--    clear tombstone (0141) and must survive to the client as null, not be dropped, so the client
--    can tell "cleared" from "never entered".
--
-- 2. GUEST PLAYERS. v_umap mapped user_id -> game_players.id and filtered out null user_ids, but a
--    guest HAS no user_id: their key in games.pairings / games.foursomes is the game_players.id
--    itself. So every guest resolved to null and was silently dropped from the matchups on the
--    public page — a guest in a four-ball made the whole side disappear. The map now carries both
--    keys, so a member (looked up by user_id) and a guest (looked up by row id) both resolve.
--
-- AUTHORIZATION: token-scoped public read. The caller is anonymous by design — this powers the
-- public live-share link — so there is no auth.uid() to check. The authorization is the unguessable
-- share_token: the function rejects absent or short tokens, looks the game up BY that token only,
-- and refuses games ended more than three days ago. EXECUTE is revoked from public and granted
-- explicitly to anon and authenticated. It exposes exactly what the share page renders and no
-- cross-game data: every query is filtered by the single game the token resolves to.
--
-- Idempotent; safe to re-run. No schema change — this replaces one function.

begin;

create or replace function public.get_live_scorecard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  g           games%rowtype;
  v_players   jsonb;
  v_umap      jsonb;
  v_pairings  jsonb;
  v_foursomes jsonb;
  v_alt       jsonb;
begin
  if p_token is null or length(p_token) < 16 then
    return null;
  end if;

  select * into g from games where share_token = p_token;
  if g.id is null then
    return null;
  end if;
  if g.status = 'ended' and g.ended_at is not null and g.ended_at < now() - interval '3 days' then
    return null;
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id',              gp.id,
      'display_name',    gp.display_name,
      'avatar_url',      gp.avatar_url,
      'course_handicap', gp.course_handicap,
      'ch', case
              when gp.handicap_index is not null and gp.slope is not null
                   and gp.rating is not null and g.course_par is not null
              then gp.handicap_index * (gp.slope / 113.0) + (gp.rating - g.course_par)
              else coalesce(gp.course_handicap, 0)
            end,
      'team',      gp.team,
      'tee_group', gp.tee_group,
      'no_show',   coalesce(gp.no_show, false),
      'scores',    coalesce(gp.scores,    '[]'::jsonb),
      'putts',     coalesce(gp.putts,     '[]'::jsonb),
      'fairways',  coalesce(gp.fairways,  '[]'::jsonb),
      'penalties', coalesce(gp.penalties, '[]'::jsonb),
      'sand',      coalesce(gp.sand,      '[]'::jsonb)
    ) order by gp.created_at), '[]'::jsonb),
    -- Both keys. A member is referenced by user_id in pairings/foursomes; a GUEST has no user_id and
    -- is referenced by their game_players.id. Mapping only the former dropped every guest (0151).
    coalesce(
      jsonb_object_agg(gp.user_id::text, gp.id::text) filter (where gp.user_id is not null),
      '{}'::jsonb
    ) || coalesce(jsonb_object_agg(gp.id::text, gp.id::text), '{}'::jsonb)
  into v_players, v_umap
  from game_players gp
  where gp.game_id = g.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'a', v_umap ->> (pr ->> 'a'),
           'b', v_umap ->> (pr ->> 'b')
         )), '[]'::jsonb)
  into v_pairings
  from jsonb_array_elements(coalesce(g.pairings, '[]'::jsonb)) pr;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',   f ->> 'id',
           'name', f ->> 'name',
           'swap', coalesce((f ->> 'swap')::boolean, false),
           'a', (select coalesce(jsonb_agg(v_umap ->> uid) filter (where v_umap ->> uid is not null), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'a', '[]'::jsonb)) uid),
           'b', (select coalesce(jsonb_agg(v_umap ->> uid) filter (where v_umap ->> uid is not null), '[]'::jsonb)
                 from jsonb_array_elements_text(coalesce(f -> 'b', '[]'::jsonb)) uid)
         )), '[]'::jsonb)
  into v_foursomes
  from jsonb_array_elements(coalesce(g.foursomes, '[]'::jsonb)) f;

  -- Alternate Shot side scores. One row per (foursome, side, hole). NULL strokes is a deliberate
  -- clear tombstone and is preserved as json null.
  select coalesce(jsonb_agg(jsonb_build_object(
           'foursome_id', s.foursome_id,
           'side',        s.side,
           'hole_index',  s.hole_index,
           'strokes',     s.strokes
         ) order by s.foursome_id, s.side, s.hole_index), '[]'::jsonb)
  into v_alt
  from game_alt_shot_scores s
  where s.game_id = g.id;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'name',             g.name,
      'course',           g.course,
      'course_par',       g.course_par,
      'game_type',        g.game_type,
      'status',           g.status,
      'allowance_pct',    g.allowance_pct,
      'team_score_mode',  g.team_score_mode,
      'trifecta_scoring', g.trifecta_scoring,
      'stroke_basis',     g.stroke_basis,
      'teams',            coalesce(g.teams, '[]'::jsonb),
      'holes_meta',       coalesce(g.holes_meta, '[]'::jsonb),
      'played_at',        g.played_at,
      'ended_at',         g.ended_at
    ),
    'players',         v_players,
    'pairings',        v_pairings,
    'foursomes',       v_foursomes,
    'alt_shot_scores', v_alt
  );
end;
$function$;

revoke all on function public.get_live_scorecard(text) from public;
grant execute on function public.get_live_scorecard(text) to anon, authenticated;

select public.record_migration('0151_live_alt_shot_and_guests');

commit;
