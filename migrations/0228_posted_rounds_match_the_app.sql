-- 0228_posted_rounds_match_the_app.sql
--
-- 212.57 — permission audit, part 4 (outside games): a round POSTED FROM A GAME can't be changed or deleted directly by
-- its player (owner, Oct 26: "its fine do a full audit — lets do this the right way").
--
-- Found: the rounds and holes table rules let a player update ANY column of their own rounds and holes directly —
-- including the hole-by-hole scores, totals and course handicap of rounds posted from games, which feed their stats,
-- trend and handicap index. The app never offers that: a posted round is corrected through its game (0225); the app's
-- only direct writes to a player's own rounds are logging one, soft-deleting one (deleted_at) and saving its analysis.
-- Now, for a round with a game behind it (rounds.game_id):
--   its player may change deleted_at and ai_analysis directly, nothing else, and may not delete it; its holes are read-only
--   a club admin keeps the round editing Manage offers them; system admins and maintenance are unaffected
--   server functions are unaffected (posting, re-posting, personal-round saves run as the database owner, not as
--   the signed-in role) — this rule is about DIRECT writes by a signed-in member
-- Personal rounds (no game) are untouched: the player entered them.
--
-- AUTHORIZATION: two trigger functions (SECURITY INVOKER — they run as the writer, which is how a direct write by the
-- signed-in role is told apart from a server function), callable by no one. No grants or policies change.
-- TESTS: ci/assert-posted-rounds.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.guard_posted_round() returns trigger
language plpgsql security invoker set search_path = public as $$   -- INVOKER: runs as the writer, so a direct write is seen as one
declare r public.rounds%rowtype;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if current_user <> 'authenticated' or auth.uid() is null or public.is_admin() then return r; end if;   -- not a direct write by a member
  if old.game_id is null then return r; end if;                                                             -- a personal round
  if old.group_id is not null and public.is_group_admin(old.group_id, auth.uid()) then return r; end if;   -- Manage's round editing
  if tg_op = 'DELETE' then
    raise exception 'A round posted from a game can''t be deleted — it''s corrected through the game.' using errcode = '42501';
  end if;
  if (old.user_id, old.course, old.tee_name, old.rating, old.slope, old.course_par, old.handicap_index, old.course_handicap, old.group_id, old.played_at,
      old.game_id, old.status, old.gross_score, old.finished_by, old.finished_at, old.course_handicap_source, old.course_handicap_set_by, old.course_handicap_set_at)
     is distinct from
     (new.user_id, new.course, new.tee_name, new.rating, new.slope, new.course_par, new.handicap_index, new.course_handicap, new.group_id, new.played_at,
      new.game_id, new.status, new.gross_score, new.finished_by, new.finished_at, new.course_handicap_source, new.course_handicap_set_by, new.course_handicap_set_at) then
    raise exception 'A round posted from a game can''t be changed here — ask the organizer to correct the score in the game.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.guard_posted_round_holes() returns trigger
language plpgsql security invoker set search_path = public as $$   -- INVOKER: runs as the writer, so a direct write is seen as one
declare v_round uuid; v_game uuid; v_group uuid;
begin
  if current_user <> 'authenticated' or auth.uid() is null or public.is_admin() then return coalesce(new, old); end if;
  v_round := case when tg_op = 'DELETE' then old.round_id else new.round_id end;
  select game_id, group_id into v_game, v_group from rounds where id = v_round;
  if v_game is null then return coalesce(new, old); end if;
  if v_group is not null and public.is_group_admin(v_group, auth.uid()) then return coalesce(new, old); end if;
  raise exception 'A round posted from a game can''t be changed here — ask the organizer to correct the score in the game.' using errcode = '42501';
end $$;

drop trigger if exists trg_guard_posted_round on public.rounds;
create trigger trg_guard_posted_round before update or delete on public.rounds for each row execute function public.guard_posted_round();
drop trigger if exists trg_guard_posted_round_holes on public.holes;
create trigger trg_guard_posted_round_holes before insert or update or delete on public.holes for each row execute function public.guard_posted_round_holes();

revoke all on function public.guard_posted_round(), public.guard_posted_round_holes() from public, anon, authenticated;

select public.record_migration('0228_posted_rounds_match_the_app');

commit;
