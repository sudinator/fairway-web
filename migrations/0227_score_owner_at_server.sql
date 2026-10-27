-- 0227_score_owner_at_server.sql
--
-- 212.56 — permission audit, part 3 (the scoring roles): WHO may change a player's SCORE matches the app, at the server
-- (owner, Oct 27: in a team match a non-scorer "can also enter their own stats … They cannot edit their score").
--
-- The app locks each row's score to whoever OWNS it (scoreLockedForRow / markerOwnsMyRow): the organizer while they hold
-- the group (0226); else the group's scorer (is_marker in the row's tee group); else the whole-game scorer
-- (games.marker_user_id); else the player keeps their own card. Everyone can always enter their OWN stats. The server only
-- checked table rules — "edit own scores" accepted a non-scorer's own score through the app's own route. Now a change to
-- a row's scores (or clock) is accepted only from the row's owner:
--   organizer's hold → the organizer · group scorer → that scorer · whole-game scorer → that scorer
--   no scorer → the player themself; a guest's card: the players in the guest's group (any player in the game when the
--   guest has no group) — and the organizer
-- Stats (putts, fairways, penalties, sand) are untouched: the player's own, as the table rules allow.
-- Not for scramble / alternate shot: their team-score functions decide who may score a team (and fan a side's score out
-- to its players). Not on an ENDED game: 0222/0225 decide (the organizer corrects; everyone else is refused).
-- Maintenance without a signed-in caller and system admins are unaffected.
--
-- AUTHORIZATION: one trigger function, callable by no one. No grants or policies change.
-- TESTS: ci/assert-score-owner.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.guard_score_owner() returns trigger
language plpgsql security definer set search_path = public as $$
declare g record; v_owner uuid; v_who text; v_ok boolean;
begin
  if (old.scores, old.clock_start, old.clock_end) is not distinct from (new.scores, new.clock_start, new.clock_end) then return new; end if;
  if public.setup_lock_exempt() then return new; end if;
  select created_by, status, game_type, marker_user_id, organizer_scoring_groups into g from games where id = new.game_id;
  if g.created_by is null or g.status = 'ended' or g.game_type in ('alt_shot', 'scramble') then return new; end if;
  if new.tee_group is not null and new.tee_group = any(g.organizer_scoring_groups) then
    v_owner := g.created_by; v_who := 'The organizer is keeping score for this group';
  else
    if new.tee_group is not null then
      select gp.user_id into v_owner from game_players gp
       where gp.game_id = new.game_id and gp.tee_group = new.tee_group and gp.is_marker and gp.user_id is not null limit 1;
    end if;
    if v_owner is not null then v_who := public.person_label(v_owner) || ' is keeping score for this group';
    elsif g.marker_user_id is not null then v_owner := g.marker_user_id; v_who := public.person_label(v_owner) || ' is keeping score for the game';
    end if;
  end if;
  if v_owner is not null then
    if auth.uid() = v_owner then return new; end if;
    raise exception '% — only they can change its scores. You can still enter your own stats%',
      v_who, case when auth.uid() = g.created_by then '; to change scores, take over the group''s scoring first.' else '.' end
      using errcode = '42501';
  end if;
  -- no scorer: your own card (a guest's: the players in the guest's group), or the organizer
  if auth.uid() = g.created_by then return new; end if;
  if new.user_id is not null then v_ok := new.user_id = auth.uid();
  else v_ok := public.plays_with_guest(new.game_id, new.tee_group);
  end if;
  if not v_ok then raise exception 'You can only enter your own scores here.' using errcode = '42501'; end if;
  return new;
end $$;

drop trigger if exists trg_guard_score_owner on public.game_players;
create trigger trg_guard_score_owner before update of scores, clock_start, clock_end on public.game_players
  for each row execute function public.guard_score_owner();

revoke all on function public.guard_score_owner() from public, anon, authenticated;

select public.record_migration('0227_score_owner_at_server');

commit;
