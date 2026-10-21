-- 0207_policy_review_fixes.sql
--
-- 211.5 — fixes from the review of every access rule (owner, Oct 21 2026).
--
-- 1. Guests in a game. "members_add_guests" / "members_delete_guests" let ANY member of the game's club add a
--    guest to, or delete a guest (scores and all) from, any of the club's games — even someone not playing in
--    it, even after it had ended. The gap 0194 closed for editing guest scores. Now: only players in the guest's
--    own tee group (any player in the game when the guest has no tee group) — plays_with_guest, 0194 — and never
--    once the game has ended. The organizer keeps "organizer adds players" / "organizer removes players".
-- 2. Badges. "member_badges_own" let a member create, change or delete their own badge rows by a direct request.
--    Badges are awarded by the server when earned (the app never writes them), so members now only READ theirs.
-- 3. The activity log. "insert own activity" accepted any entry naming the writer as actor — so a member could log
--    "approved a club" about themselves. Now an entry is accepted by meaning:
--      * system-admin acts — only from a system admin;
--      * club-admin acts (role changed, member added / removed) — only from that club's admin, or a system admin;
--        adding or removing YOURSELF (joining by invite, leaving) stays yours;
--      * everything else is about the writer's own activity (rounds, games, tee times, expenses, submissions,
--        requests) — theirs to log, as before.
--    A refused entry never breaks the action (the app ignores logging errors).
-- 4. Club deletions are recorded by the database itself (a club no longer exists when the app logs its deletion,
--    so the writer's authority could not be confirmed): who deleted which club, at the moment it happens.
--
-- AUTHORIZATION: policy replacements on game_players, member_badges and activity_log; member write privileges on
-- member_badges revoked; an AFTER DELETE trigger on groups (SECURITY DEFINER, no grants).
-- TESTS: ci/assert-policy-review.sql
--
-- Idempotent; safe to re-run.

begin;

-- 1. guests
drop policy if exists members_add_guests on public.game_players;
drop policy if exists members_delete_guests on public.game_players;
drop policy if exists guests_added_by_players on public.game_players;
drop policy if exists guests_removed_by_players on public.game_players;
create policy guests_added_by_players on public.game_players for insert to authenticated
  with check (is_guest = true and user_id is null and public.plays_with_guest(game_id, tee_group)
              and exists (select 1 from public.games g where g.id = game_id and g.status is distinct from 'ended'));
create policy guests_removed_by_players on public.game_players for delete to authenticated
  using (is_guest = true and public.plays_with_guest(game_id, tee_group)
         and exists (select 1 from public.games g where g.id = game_id and g.status is distinct from 'ended'));

-- 2. badges: read only
drop policy if exists member_badges_own on public.member_badges;
drop policy if exists member_badges_read_own on public.member_badges;
create policy member_badges_read_own on public.member_badges for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.member_badges from authenticated;
drop trigger if exists guard_active_account on public.member_badges;   -- no longer member-writable

-- 3. the activity log, by meaning
drop policy if exists "insert own activity" on public.activity_log;
drop policy if exists activity_log_insert_by_meaning on public.activity_log;
create policy activity_log_insert_by_meaning on public.activity_log for insert to authenticated
  with check (
    actor_id = auth.uid()
    and (action not in ('admin_entered_group', 'admin_exited_group', 'admin_game_repair', 'group_approved', 'group_declined',
                        'group_merged', 'group_set_default', 'group_invites_revoked', 'group_deleted', 'handicap_changed',
                        'player_deactivated', 'player_reactivated', 'approved', 'course_edit_approved_global',
                        'course_edit_kept_group_only', 'course_edit_rejected_removed', 'rejected_removed', 'group_only',
                        'course_api_manual_refresh')
         or public.is_admin())
    and (action not in ('role_changed', 'member_added', 'member_removed')
         or public.is_admin()
         or (group_id is not null and public.is_group_admin(group_id, auth.uid()))
         or (action in ('member_added', 'member_removed') and target_user_id = auth.uid()))
  );

-- 4. club deletions, recorded by the database
create or replace function public.log_club_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    insert into activity_log(actor_id, actor_name, action, summary, group_id)
    values (auth.uid(), public.person_label(auth.uid()), 'club_deleted', 'Deleted the club "' || coalesce(old.name, '') || '" (' || old.id || ')', null);
  end if;
  return old;
end $$;
revoke all on function public.log_club_deleted() from public, anon, authenticated;
drop trigger if exists log_club_deleted on public.groups;
create trigger log_club_deleted after delete on public.groups for each row execute function public.log_club_deleted();

select public.record_migration('0207_policy_review_fixes');

commit;
