-- 0153_manual_course_handicap.sql
--
-- Manual course handicaps: the organizer (or a system admin) enters a player's COURSE HANDICAP for
-- a game directly — typically taken from GHIN, which is the source of truth — instead of it being
-- derived from handicap index, slope and rating.
--
-- Semantics, decided with the organizer (Sep 2026) and enforced in lib/game-shape.chBasis:
--   * The entered number IS the course handicap for THIS course and THIS number of holes. On a nine
--     it is the NINE-hole figure and is NOT halved again. The UI labels the field with the game's
--     hole count so the right number is entered; a halving error is invisible in the result, the
--     match simply plays light.
--   * ALLOWANCE still applies (85% four-ball, 90% Trifecta, and so on). Allowance is a property of
--     the format, not of the player, so baking it into the stored value would strand it if the
--     allowance were later changed.
--   * It feeds EVERY basis — the match, the team leg, side games and posting — because GHIN is the
--     source of truth for the player's handicap, not merely a match-day override.
--
-- MATCH LENGTH: 0149 lets an organizer switch an unscored game between 18 and a nine. Manual
-- handicaps entered for one hole count are wrong for the other, and silently so. They are therefore
-- CLEARED on a length change and must be re-entered, rather than scaled — scaling would invent a
-- number nobody typed, and a nine-hole GHIN figure is not always exactly half the 18-hole one.
--
-- AUTHORIZATION: the column is written through normal RLS on game_players (organizer, or the player
-- for their own row, per 0137/0144); the SETUP UI restricts entry to organizer and admin. The
-- function replaced here, change_game_match_length_before_scoring, keeps 0149's contract exactly —
-- authenticated caller, SECURITY DEFINER, games.created_by = auth.uid() — and only adds the clear.
--
-- Idempotent; safe to re-run.

begin;

alter table public.game_players
  add column if not exists course_handicap_source text not null default 'derived';

alter table public.game_players drop constraint if exists game_players_ch_source_chk;
alter table public.game_players
  add constraint game_players_ch_source_chk
  check (course_handicap_source in ('derived', 'manual'));

-- Who set it, and when. These are money games; a handicap change must be attributable.
alter table public.game_players
  add column if not exists course_handicap_set_by uuid references auth.users(id);
alter table public.game_players
  add column if not exists course_handicap_set_at timestamptz;

comment on column public.game_players.course_handicap_source is
  'derived = course_handicap computed from index/slope/rating; manual = entered as the authoritative '
  'course handicap for this game and hole count (not re-derived, not halved for a nine; allowance still applies).';

-- ── Clear manual handicaps when the hole count changes ───────────────────────────────────────────
create or replace function public.change_game_match_length_before_scoring(
  p_game uuid,
  p_holes_meta jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_n integer;
  v_blank jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select * into v_game
    from public.games
   where id = p_game
   for update;

  if not found then raise exception 'Game not found'; end if;
  if v_game.created_by is distinct from auth.uid() then
    raise exception 'Only the game organizer can change the number of holes';
  end if;
  if coalesce(v_game.status, 'active') = 'ended' then
    raise exception 'Ended games cannot change the number of holes';
  end if;

  if p_holes_meta is null
     or jsonb_typeof(p_holes_meta) <> 'array'
     or jsonb_array_length(p_holes_meta) not in (9, 18)
     or exists (
       select 1
         from jsonb_array_elements(p_holes_meta) h
        where jsonb_typeof(h) <> 'object'
           or coalesce((h->>'n')::integer, 0) <= 0
           or coalesce((h->>'par')::integer, 0) <= 0
     )
     or (
       select count(distinct h->>'n')
         from jsonb_array_elements(p_holes_meta) h
     ) <> jsonb_array_length(p_holes_meta) then
    raise exception 'Valid unique metadata for 9 or 18 holes is required';
  end if;

  perform 1 from public.game_players where game_id = p_game for update;

  if v_game.alt_shot_scoring_started_at is not null
     or exists (
       select 1
         from public.game_players gp,
              lateral jsonb_array_elements(coalesce(gp.scores, '[]'::jsonb)) s(value)
        where gp.game_id = p_game
          and s.value <> 'null'::jsonb
     )
     or exists (
       select 1 from public.game_alt_shot_scores ass where ass.game_id = p_game
     ) then
    raise exception 'The number of holes is locked once scoring begins';
  end if;

  v_n := jsonb_array_length(p_holes_meta);
  select coalesce(jsonb_agg(null::jsonb), '[]'::jsonb)
    into v_blank
    from generate_series(1, v_n);

  update public.games
     set holes_meta = p_holes_meta
   where id = p_game;

  update public.game_players
     set scores = v_blank,
         putts = v_blank,
         fairways = v_blank,
         penalties = v_blank,
         sand = v_blank,
         clock_start = null,
         clock_end = null,
         group_locked = false,
         -- A manual course handicap is entered FOR a hole count (0153). Switching between 18 and a
         -- nine makes every stored figure wrong, and wrong invisibly, so they are cleared and must
         -- be re-entered rather than scaled: a nine-hole GHIN figure is not always half the 18.
         course_handicap_source = 'derived',
         course_handicap_set_by = null,
         course_handicap_set_at = null
   where game_id = p_game;
end;
$$;

revoke all on function public.change_game_match_length_before_scoring(uuid,jsonb)
  from public, anon;
grant execute on function public.change_game_match_length_before_scoring(uuid,jsonb)
  to authenticated;

select public.record_migration('0153_manual_course_handicap');

commit;
