-- 0226_organizer_takes_over_group_scoring.sql
--
-- 212.55 — the organizer can take over ANY group's scoring during the round, and hand it back (owner, Oct 27: "allow the
-- organizer to jump in and take over scoring, the existing scorer is notified but doesn't need to give permission, and
-- then I can hand the scoring back to anyone else who is a member of the group and chooses to score").
--
-- A group's scorer is a player IN that group (game_players.is_marker), and the organizer usually isn't in it — so the
-- organizer's hold is recorded on the game: games.organizer_scoring_groups (the groups the organizer is keeping score for).
-- One scorer per group at a time:
--   organizer_take_group_scoring(game, group)    the organizer takes the group's card — its scorer steps down and is
--                                                NOTIFIED (no permission needed); while held, the organizer owns every
--                                                score in that group; its players can still enter their own stats
--   organizer_release_group_scoring(game, group)  the organizer hands it back — the group's players are notified that
--                                                its scoring is open; anyone IN the group may then tap "I'll keep score"
--   claim_group_marker                            refuses while the organizer holds the group
-- Not on an ended game (after the end, the organizer corrects scores directly: 0225).
--
-- AUTHORIZATION: both functions — authenticated, the game's organizer only (checked inside). claim_group_marker unchanged
-- in rights; it gains the refusal above.
-- TESTS: ci/assert-organizer-group-scoring.sql
--
-- Idempotent; safe to re-run.

begin;

alter table public.games add column if not exists organizer_scoring_groups smallint[] not null default '{}';

create or replace function public.organizer_take_group_scoring(p_game uuid, p_group smallint) returns void
language plpgsql security definer set search_path = public as $$
declare g record; v_org text; r record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, status, code, name, group_id, organizer_scoring_groups into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if g.created_by is distinct from auth.uid() then raise exception 'only the organizer can take over a group''s scoring' using errcode = '42501'; end if;
  if g.status = 'ended' then raise exception 'This game has ended — correct its scores directly instead.' using errcode = '55000'; end if;
  if not exists (select 1 from game_players where game_id = p_game and tee_group = p_group) then raise exception 'no such group' using errcode = 'P0002'; end if;
  if p_group = any(g.organizer_scoring_groups) then return; end if;
  v_org := public.person_label(auth.uid());
  -- the group's scorer steps down — and is told (no permission needed)
  for r in select user_id from game_players where game_id = p_game and tee_group = p_group and is_marker and user_id is not null and user_id <> auth.uid() loop
    insert into notifications (user_id, message, group_id, type, link, detail)
    values (r.user_id, v_org || ' took over scoring for Group ' || p_group || ' in "' || coalesce(g.name, 'the game') || '".', g.group_id, 'scoring_taken_over',
            case when g.code is not null then '/?game=' || g.code else '/?tab=games' end, 'You can still enter your own stats. The organizer will hand the card back when they''re done.');
  end loop;
  update game_players set is_marker = false where game_id = p_game and tee_group = p_group and is_marker;
  update games set organizer_scoring_groups = array_append(organizer_scoring_groups, p_group) where id = p_game;
end $$;

create or replace function public.organizer_release_group_scoring(p_game uuid, p_group smallint) returns void
language plpgsql security definer set search_path = public as $$
declare g record; r record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, created_by, code, name, group_id, organizer_scoring_groups into g from games where id = p_game for update;
  if g.id is null then raise exception 'no such game' using errcode = 'P0002'; end if;
  if g.created_by is distinct from auth.uid() then raise exception 'only the organizer can hand a group''s scoring back' using errcode = '42501'; end if;
  if not (p_group = any(g.organizer_scoring_groups)) then return; end if;
  update games set organizer_scoring_groups = array_remove(organizer_scoring_groups, p_group) where id = p_game;
  -- the group's players are told its card is open — anyone in the group may now keep score
  for r in select user_id from game_players where game_id = p_game and tee_group = p_group and user_id is not null and user_id <> auth.uid() loop
    insert into notifications (user_id, message, group_id, type, link, detail)
    values (r.user_id, 'The organizer handed back scoring for Group ' || p_group || ' in "' || coalesce(g.name, 'the game') || '".', g.group_id, 'scoring_handed_back',
            case when g.code is not null then '/?game=' || g.code else '/?tab=games' end, 'Anyone in the group can tap "I''ll keep score" to keep the card.');
  end loop;
end $$;

CREATE OR REPLACE FUNCTION public.claim_group_marker(p_game uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare mine uuid; grp smallint;
begin
  select id, tee_group into mine, grp from game_players
   where game_id = p_game and user_id = auth.uid();
  if mine is null then raise exception 'you are not in this game'; end if;
  if grp  is null then raise exception 'you are not in a tee group yet'; end if;
  -- 0226 (owner, Oct 27): while the organizer keeps this group's score, nobody in it can take the card back — the
  -- organizer hands it back first (organizer_release_group_scoring); then anyone in the group may claim it
  if exists (select 1 from games g where g.id = p_game and grp = any(g.organizer_scoring_groups) and g.created_by is distinct from auth.uid()) then
    raise exception 'The organizer is keeping score for your group right now. They''ll hand it back when they''re done.' using errcode = '55000';
  end if;
  update game_players set is_marker = false where game_id = p_game and tee_group = grp;  -- one marker per group
  update game_players set is_marker = true  where id = mine;
end $function$;

revoke all on function public.organizer_take_group_scoring(uuid, smallint), public.organizer_release_group_scoring(uuid, smallint) from public, anon;
grant execute on function public.organizer_take_group_scoring(uuid, smallint), public.organizer_release_group_scoring(uuid, smallint) to authenticated;

select public.record_migration('0226_organizer_takes_over_group_scoring');

commit;
