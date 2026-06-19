-- 0022_scorecard_ownership.sql
-- Per-player scorecard OWNERSHIP so a group marker can never overwrite someone
-- who has chosen to keep their own score.
--
-- Model: every game_players row has scored_by = the user responsible for entering
-- that row. Default = the player themselves (self-scoring). When a marker takes the
-- group card, players default to JOINED (scored_by = the marker). A player can opt
-- back to self at any time; only they can change their own row (consent).
--
-- This migration is ADDITIVE: it adds a column and new functions only. It does not
-- alter existing RLS, so applying it does NOT change current behaviour. The app is
-- wired to these functions in a follow-up release.

-- 1) The owner column. Backfill real players to themselves; guests stay null
--    (a guest has no login, so the responsible group marker scores them).
alter table game_players add column if not exists scored_by uuid;
update game_players set scored_by = user_id where scored_by is null and user_id is not null;

-- 2) THE WRITE CHOKEPOINT. All score writes go through here. It refuses to write a
--    row unless the caller owns it (scored_by), or it's an unassigned/guest row and
--    the caller is the responsible (tee-)group / game marker. Because the app will
--    only ever write scores via this function, a marker physically cannot overwrite
--    a self-scorer's card.
create or replace function save_hole_scores(
  p_player    uuid,
  p_scores    jsonb default null,
  p_putts     jsonb default null,
  p_fairways  jsonb default null,
  p_penalties jsonb default null,
  p_sand      jsonb default null,
  p_clock_start timestamptz default null,
  p_clock_end   timestamptz default null
) returns void language plpgsql security definer set search_path = public as $$
declare r game_players%rowtype; uid uuid := auth.uid(); allowed boolean := false;
begin
  select * into r from game_players where id = p_player;
  if r.id is null then raise exception 'no such player'; end if;

  if r.scored_by is not null and r.scored_by = uid then
    allowed := true;                                   -- the row's owner
  elsif r.scored_by is null then                       -- guest / unassigned
    if exists (select 1 from game_players gp
                 where gp.game_id = r.game_id and gp.is_marker and gp.user_id = uid
                   and (r.tee_group is null or gp.tee_group = r.tee_group))
       or exists (select 1 from games g where g.id = r.game_id and g.marker_user_id = uid)
    then allowed := true; end if;
  end if;

  if not allowed then raise exception 'not allowed to score this player'; end if;

  update game_players set
      scores      = coalesce(p_scores,    scores),
      putts       = coalesce(p_putts,     putts),
      fairways    = coalesce(p_fairways,  fairways),
      penalties   = coalesce(p_penalties, penalties),
      sand        = coalesce(p_sand,      sand),
      clock_start = coalesce(clock_start, p_clock_start),  -- set once, never cleared here
      clock_end   = coalesce(p_clock_end, clock_end)
   where id = p_player;
end $$;
grant execute on function save_hole_scores(uuid,jsonb,jsonb,jsonb,jsonb,jsonb,timestamptz,timestamptz) to authenticated;

-- 3) A player chooses who keeps THEIR card. Only they can change their own row.
--    p_to_marker = true  -> join the group card (scored_by = the group's marker)
--    p_to_marker = false -> keep my own  (scored_by = me)
create or replace function set_my_scorer(p_game uuid, p_to_marker boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid; my_tee smallint; mk uuid;
begin
  select id, tee_group into me, my_tee from game_players
    where game_id = p_game and user_id = auth.uid();
  if me is null then raise exception 'not in this game'; end if;
  if p_to_marker then
    select coalesce(
      (select gp.user_id from game_players gp
         where gp.game_id = p_game and gp.is_marker
           and (my_tee is null or gp.tee_group = my_tee) limit 1),
      (select g.marker_user_id from games g where g.id = p_game)
    ) into mk;
    update game_players set scored_by = coalesce(mk, auth.uid()) where id = me;
  else
    update game_players set scored_by = auth.uid() where id = me;
  end if;
end $$;
grant execute on function set_my_scorer(uuid, boolean) to authenticated;

-- 4) Marker pulls the (tee) group onto their card — default JOINED for everyone.
--    Players who want their own card opt out afterwards via set_my_scorer(false).
create or replace function join_group_to_marker(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
declare mk uuid; mk_tee smallint;
begin
  select user_id, tee_group into mk, mk_tee from game_players
    where game_id = p_game and is_marker and user_id = auth.uid();
  if mk is not null then
    update game_players set scored_by = mk
      where game_id = p_game and (mk_tee is null or tee_group = mk_tee);
  elsif exists (select 1 from games g where g.id = p_game and g.marker_user_id = auth.uid()) then
    update game_players set scored_by = auth.uid() where game_id = p_game;
  else
    raise exception 'only the group marker can do this';
  end if;
end $$;
grant execute on function join_group_to_marker(uuid) to authenticated;

-- 5) "Everyone scores their own" — disband group scoring for the whole game.
--    Marker or organizer only. Resets every row to self and clears the marker.
create or replace function disband_group_scoring(p_game uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from games g where g.id = p_game and (g.marker_user_id = auth.uid() or g.created_by = auth.uid()))
     and not exists (select 1 from game_players gp where gp.game_id = p_game and gp.is_marker and gp.user_id = auth.uid())
  then raise exception 'only the marker or organizer can disband group scoring'; end if;
  update game_players set scored_by = user_id where game_id = p_game and user_id is not null;
  update game_players set is_marker = false where game_id = p_game;
  update games set marker_user_id = null where id = p_game;
end $$;
grant execute on function disband_group_scoring(uuid) to authenticated;
