-- 0144_authorization_hardening.sql
-- Closes privilege-escalation paths found in the v179.8 de novo security review.
-- AUTHORIZATION: privileged profile fields are trigger-protected; membership activation is
-- derived from the authenticated JWT email and preserves the inviter-assigned role; game writes
-- remain organizer-owned; internal helpers are denied to browser roles; broad DDL-like table
-- privileges are removed from anon/authenticated.

begin;

-- is_owner was added after the original privileged-column trigger. Protect it separately from
-- is_admin/banned: system admins may manage ordinary admin state, but only the existing owner may
-- transfer the owner marker. The partial index makes the single-owner invariant enforceable.
create or replace function public.guard_profile_privileged_cols()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or coalesce(new.banned, false) is distinct from coalesce(old.banned, false))
     and not public.is_admin() then
    raise exception 'changing is_admin/banned is not permitted';
  end if;

  if coalesce(new.is_owner, false) is distinct from coalesce(old.is_owner, false)
     and not public.is_owner() then
    raise exception 'changing is_owner is not permitted';
  end if;

  return new;
end;
$$;

create unique index if not exists profiles_single_owner_idx
  on public.profiles ((is_owner))
  where is_owner = true;

-- Creating a group is a two-write workflow: the creator may insert only their own active admin
-- membership into the group they just created. Existing group admins/system admins retain normal
-- membership management. A user can no longer self-appoint into an arbitrary known group UUID.
drop policy if exists "group_members_insert_admin_or_self" on public.group_members;
create policy "group_members_insert_admin_or_self"
on public.group_members as permissive for insert to authenticated
with check (
  public.is_admin()
  or public.is_group_admin(group_id, auth.uid())
  or (
    user_id = auth.uid()
    and role = 'admin'
    and status = 'active'
    and exists (
      select 1 from public.groups g
      where g.id = group_id and g.created_by = auth.uid()
    )
  )
);

-- Direct membership updates are administrative. Invitees accept via the RPC below, which updates
-- identity/status only and therefore cannot upgrade an inviter-assigned member role to admin.
drop policy if exists "group_members_update_admin_or_self_invite" on public.group_members;
create policy "group_members_update_admin_or_self_invite"
on public.group_members as permissive for update to authenticated
using (public.is_admin() or public.is_group_admin(group_id, auth.uid()))
with check (public.is_admin() or public.is_group_admin(group_id, auth.uid()));

create or replace function public.accept_group_email_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_count integer;
begin
  if v_uid is null or v_email = '' then
    raise exception 'Authenticated email is required to accept club invitations';
  end if;

  update public.group_members gm
     set user_id = v_uid,
         status = 'active'
   where lower(gm.email::text) = v_email
     and gm.status = 'invited'
     and (gm.user_id is null or gm.user_id = v_uid);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.accept_group_email_invites() from public, anon;
grant execute on function public.accept_group_email_invites() to authenticated;

-- Group membership grants visibility, not ownership. Only the organizer may mutate/delete a game.
drop policy if exists "games_group_member_all" on public.games;

drop policy if exists "create games" on public.games;
create policy "create games" on public.games as permissive for insert to public
with check (
  auth.uid() = created_by
  and (group_id is null or public.is_group_member(group_id, auth.uid()))
);

drop policy if exists "update own games" on public.games;
create policy "update own games" on public.games as permissive for update to public
using (auth.uid() = created_by)
with check (
  auth.uid() = created_by
  and (group_id is null or public.is_group_member(group_id, auth.uid()))
);

-- These are implementation helpers, not public RPCs.
revoke all on function public._money_snapshot(uuid) from public, anon, authenticated;

revoke all on function public.sweep_stale_games() from public, anon;
grant execute on function public.sweep_stale_games() to authenticated;

-- RLS governs row operations; browser roles do not need schema/DDL-like table powers.
revoke references, trigger, truncate on table
  public.activity_log,
  public.favorite_courses,
  public.game_players,
  public.games,
  public.group_courses,
  public.group_invites,
  public.group_members,
  public.groups,
  public.holes,
  public.notifications,
  public.profiles,
  public.rounds
from anon, authenticated;

commit;

select public.record_migration('0144_authorization_hardening');
