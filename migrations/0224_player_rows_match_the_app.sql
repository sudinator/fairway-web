-- 0224_player_rows_match_the_app.sql
--
-- 212.53 — what a non-organizer can change on a player row, at the SERVER, matches the app (owner, Oct 26: "its fine do a
-- full audit — lets do this the right way"). Table rules let more than any screen offers: "edit own scores" let a player
-- change ANY column of their own row (handicap, course handicap, tee, team, group, no-show, name, guest flag);
-- "join as self" accepted any values; a player could delete their own row; group players could add and remove guests.
-- The app lets a player who isn't the organizer do exactly four things to player rows:
--   1. join a game: their own row, with their name, avatar, the game's tee and an empty card (handicap left to fill in);
--   2. fill in their OWN handicap and tee while it is missing ("Complete your setup") — never change one already set;
--   3. score — their own card, and (owner's "player card" decision) correct their group's entries, incl. guests;
--   4. set their avatar, and the scoring roles (who keeps score, group scorer, finishing a group).
-- Everything else — handicaps, course handicaps, tees, teams, groups, no-show, flights, names, bets, guests, removing a
-- player — is the organizer's (and system admins'). Deleting a WHOLE game (every player, e.g. a Ryder Cup session) stays
-- with the functions that do it and their own permission checks. Maintenance without a signed-in caller is unaffected.
-- (Setup locks once scoring starts / a game ends: 0221, 0222 — unchanged; this is WHO, those are WHEN.)
--
-- AUTHORIZATION: two trigger functions, callable by no one (anon / authenticated revoked). No grants or policies change.
-- TESTS: ci/assert-game-permissions.sql (direct writes section)
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.guard_player_row_by_non_organizer() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.setup_lock_exempt() or exists (select 1 from games g where g.id = new.game_id and g.created_by = auth.uid()) then return new; end if;
  if tg_op = 'INSERT' then
    -- 1. joining: your own row, with nothing the organizer decides already set
    if new.user_id is distinct from auth.uid() or coalesce(new.is_guest, false) then
      raise exception 'Only the organizer can add players or guests to a game.' using errcode = '42501';
    end if;
    if new.team is not null or new.tee_group is not null or new.handicap_index is not null or new.course_handicap is not null
       or coalesce(new.course_handicap_source, 'derived') <> 'derived' or coalesce(new.no_show, false) or new.flight is not null
       or new.guest_of is not null or coalesce(new.is_marker, false) or coalesce(new.group_locked, false) or coalesce(new.bets, true) is not true
       or public.jsonb_has_value(new.scores) or public.jsonb_has_value(new.putts) or public.jsonb_has_value(new.fairways)
       or public.jsonb_has_value(new.penalties) or public.jsonb_has_value(new.sand) then
      raise exception 'When you join a game, the organizer sets your team, group and handicap.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- UPDATE: scores, stats, the scoring roles and your avatar are open to the players the table rules allow; the rest isn't
  if (old.handicap_index, old.course_handicap, old.course_handicap_source, old.course_handicap_set_by, old.course_handicap_set_at,
      old.rating, old.slope, old.tee_name, old.team, old.tee_group, old.no_show, old.flight, old.is_guest, old.guest_of,
      old.user_id, old.game_id, old.display_name, old.bets)
     is not distinct from
     (new.handicap_index, new.course_handicap, new.course_handicap_source, new.course_handicap_set_by, new.course_handicap_set_at,
      new.rating, new.slope, new.tee_name, new.team, new.tee_group, new.no_show, new.flight, new.is_guest, new.guest_of,
      new.user_id, new.game_id, new.display_name, new.bets) then
    return new;
  end if;
  -- 2. "Complete your setup": your OWN row, while your course handicap is missing — handicap and tee only
  if old.user_id = auth.uid() and old.course_handicap is null
     and (old.course_handicap_source, old.course_handicap_set_by, old.course_handicap_set_at, old.team, old.tee_group, old.no_show, old.flight,
          old.is_guest, old.guest_of, old.user_id, old.game_id, old.display_name, old.bets)
         is not distinct from
         (new.course_handicap_source, new.course_handicap_set_by, new.course_handicap_set_at, new.team, new.tee_group, new.no_show, new.flight,
          new.is_guest, new.guest_of, new.user_id, new.game_id, new.display_name, new.bets) then
    return new;
  end if;
  raise exception 'Only the organizer can change a player''s handicap, tee, team, group, name or status.' using errcode = '42501';
end $$;

-- removing a player is the organizer's; deleting a WHOLE game (every player) is judged by the function that does it
create or replace function public.guard_player_removal_by_non_organizer() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if public.setup_lock_exempt() then return null; end if;
  for r in select distinct game_id from removed loop
    if exists (select 1 from games g where g.id = r.game_id and g.created_by = auth.uid()) then continue; end if;
    if not exists (select 1 from game_players p where p.game_id = r.game_id) then continue; end if;   -- the whole game went
    if not exists (select 1 from games g where g.id = r.game_id) then continue; end if;
    raise exception 'Only the organizer can remove players or guests from a game.' using errcode = '42501';
  end loop;
  return null;
end $$;

drop trigger if exists trg_guard_player_row_by_non_organizer on public.game_players;
create trigger trg_guard_player_row_by_non_organizer before insert or update on public.game_players
  for each row execute function public.guard_player_row_by_non_organizer();
drop trigger if exists trg_guard_player_removal_by_non_organizer on public.game_players;
create trigger trg_guard_player_removal_by_non_organizer after delete on public.game_players
  referencing old table as removed for each statement execute function public.guard_player_removal_by_non_organizer();

revoke all on function public.guard_player_row_by_non_organizer(), public.guard_player_removal_by_non_organizer() from public, anon, authenticated;

select public.record_migration('0224_player_rows_match_the_app');

commit;
