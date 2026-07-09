-- 0075_tee_time_roles.sql
-- Looser tee-time roles:
--   * ANY active group member can create a tee time (was admin/owner only).
--   * The tee-time CREATOR can manage everyone's RSVPs for that tee time
--     (mark in/out, promote from waitlist, remove guests) — "acts as admin" for it.
--   * Captain assignment/reassignment (admin, creator, or current captain) and
--     game linking (the captain who created the game) go through SECURITY DEFINER
--     RPCs so neither grants blanket edit rights over the tee time.
-- Creating/editing/cancelling the tee time itself is unchanged (creator or admin).

-- 1) Any active member can create a tee time (created_by must be the caller, no spoofing).
drop policy if exists tt_insert on public.tee_times;
create policy tt_insert on public.tee_times for insert
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.group_members gm
                where gm.group_id = tee_times.group_id and gm.user_id = auth.uid()
                  and gm.status = 'active'));

-- 2) RSVP writes: the tee-time CREATOR joins admins/owners as an "organizer" who can
--    write anyone's RSVP (members can still write only their own).
drop policy if exists ttr_insert on public.tee_time_rsvps;
create policy ttr_insert on public.tee_time_rsvps for insert
  with check (
    exists (select 1 from public.tee_times t
              join public.group_members gm on gm.group_id = t.group_id
            where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid() and gm.status = 'active')
    and (
      user_id = auth.uid()
      or exists (select 1 from public.tee_times t2
                   join public.group_members gm2 on gm2.group_id = t2.group_id
                 where t2.id = tee_time_rsvps.tee_time_id and gm2.user_id = auth.uid()
                   and gm2.status = 'active' and gm2.role in ('admin','owner'))
      or exists (select 1 from public.tee_times t3
                 where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid())
    ));

drop policy if exists ttr_update on public.tee_time_rsvps;
create policy ttr_update on public.tee_time_rsvps for update
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee_times t3
               where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid()));

drop policy if exists ttr_delete on public.tee_time_rsvps;
create policy ttr_delete on public.tee_time_rsvps for delete
  using (
    user_id = auth.uid()
    or exists (select 1 from public.tee_times t
                 join public.group_members gm on gm.group_id = t.group_id
               where t.id = tee_time_rsvps.tee_time_id and gm.user_id = auth.uid()
                 and gm.status = 'active' and gm.role in ('admin','owner'))
    or exists (select 1 from public.tee_times t3
               where t3.id = tee_time_rsvps.tee_time_id and t3.created_by = auth.uid()));

-- 3) Assign/reassign the captain. Authorized: group admin, tee-time creator, or the
--    current captain. A named captain must be signed up "in" for the round. NULL clears it.
create or replace function public.set_tee_time_captain(p_tee_time_id uuid, p_new_captain uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_group uuid; v_creator uuid; v_captain uuid;
begin
  select group_id, created_by, captain_user_id into v_group, v_creator, v_captain
  from public.tee_times where id = p_tee_time_id;
  if v_group is null then raise exception 'Tee time not found'; end if;
  if not (public.is_group_admin(v_group, v_uid) or v_creator = v_uid or v_captain = v_uid) then
    raise exception 'Not authorized to set the captain';
  end if;
  if p_new_captain is not null and not exists (
       select 1 from public.tee_time_rsvps r
       where r.tee_time_id = p_tee_time_id and r.user_id = p_new_captain and r.choice = 'in') then
    raise exception 'Captain must be signed up as In for this round';
  end if;
  update public.tee_times set captain_user_id = p_new_captain, updated_at = now()
  where id = p_tee_time_id;
end;
$$;
grant execute on function public.set_tee_time_captain(uuid, uuid) to authenticated;

-- 4) Link a created game back to its tee time. Authorized: the caller must have CREATED
--    the game, be in the same group, and be the tee time's captain (or its creator/admin).
create or replace function public.link_tee_time_game(p_tee_time_id uuid, p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); v_tt_group uuid; v_creator uuid; v_captain uuid;
        v_game_group uuid; v_game_creator uuid;
begin
  select group_id, created_by, captain_user_id into v_tt_group, v_creator, v_captain
  from public.tee_times where id = p_tee_time_id;
  if v_tt_group is null then raise exception 'Tee time not found'; end if;
  select group_id, created_by into v_game_group, v_game_creator
  from public.games where id = p_game_id;
  if v_game_group is null then raise exception 'Game not found'; end if;
  if v_game_creator is distinct from v_uid then raise exception 'You can only link a game you created'; end if;
  if v_game_group is distinct from v_tt_group then raise exception 'Game and tee time are in different groups'; end if;
  if not (public.is_group_admin(v_tt_group, v_uid) or v_creator = v_uid or v_captain = v_uid) then
    raise exception 'Not authorized to link this tee time';
  end if;
  update public.tee_times set game_id = p_game_id, updated_at = now()
  where id = p_tee_time_id;
end;
$$;
grant execute on function public.link_tee_time_game(uuid, uuid) to authenticated;
