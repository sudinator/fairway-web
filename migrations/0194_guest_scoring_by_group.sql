-- 0194_guest_scoring_by_group.sql
--
-- Who may change a GUEST's scores (209.4, owner). Before: any member of the game's club could — even a member
-- not playing in that game, or in a different foursome ("members_update_guests"). Now: the people playing with
-- the guest. Owner decision, Oct 2026.
--
-- A guest's scores may be changed by (each rule on its own, as before for the first three):
--   * the organizer                       — "organizer manages players" (unchanged)
--   * the game's marker                   — "marker_can_update_group_scores" (unchanged)
--   * the guest's tee-group marker        — "tee_group_marker_can_update" (unchanged)
--   * NEW: a player in the guest's own tee group; or, when the guest has no tee group, any player in that game.
-- Alternate shot saves through save_alt_shot_side_score, which already allows only the side's own players and
-- the markers / organizer — unchanged.
--
-- AUTHORIZATION: game_players UPDATE policy. The check runs in a SECURITY DEFINER helper (like
-- is_tee_group_marker), so a policy on game_players doesn't query game_players under its own policies.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.plays_with_guest(p_game uuid, p_tee_group smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from game_players w
     where w.game_id = p_game and w.user_id = auth.uid() and coalesce(w.no_show, false) = false
       and (p_tee_group is null or w.tee_group = p_tee_group)
  );
$$;
revoke all on function public.plays_with_guest(uuid, smallint) from public, anon;
grant execute on function public.plays_with_guest(uuid, smallint) to authenticated;

drop policy if exists members_update_guests on public.game_players;
drop policy if exists guests_scored_by_their_group on public.game_players;
create policy guests_scored_by_their_group on public.game_players for update to authenticated
  using (is_guest = true and public.plays_with_guest(game_id, tee_group))
  with check (is_guest = true and public.plays_with_guest(game_id, tee_group));

select public.record_migration('0194_guest_scoring_by_group');

commit;
