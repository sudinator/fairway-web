-- 0107_admin_wipe_group.sql
-- System-admin reset of a TEST group's data. HARD-GUARDED to is_test groups so a real club can never
-- be wiped. Clears the group's transactional data — games + game_players, any rounds + holes tagged to
-- the group, the money ledger (expenses + expense_shares, group_guests, settlements), group_activity,
-- tee_times + rsvps, and the group's notifications — while KEEPING the group and its members (phantom
-- test users stay). Also resets player_cards / member_badges for the group's TEST members only, so
-- phantom users start clean without touching any real member's card. Returns a status string.
create or replace function public.admin_wipe_group(p_group uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_test boolean;
begin
  if not public.is_admin() then return 'forbidden'; end if;
  select is_test into v_test from groups where id = p_group;
  if not found then return 'not_found'; end if;
  if not coalesce(v_test, false) then return 'not_test'; end if;  -- refuse on any real club

  -- rounds + their holes (any tagged to this group)
  delete from holes where round_id in (select id from rounds where group_id = p_group);
  delete from rounds where group_id = p_group;

  -- games + their players
  delete from game_players where game_id in (select id from games where group_id = p_group);
  delete from games where group_id = p_group;

  -- money ledger
  delete from expense_shares where expense_id in (select id from expenses where group_id = p_group);
  delete from expenses     where group_id = p_group;
  delete from group_guests where group_id = p_group;   -- cascades any remaining expense_shares by guest_id
  delete from settlements  where group_id = p_group;

  -- activity, tee times, notifications
  delete from group_activity where group_id = p_group;
  delete from tee_time_rsvps where tee_time_id in (select id from tee_times where group_id = p_group);
  delete from tee_times      where group_id = p_group;
  delete from notifications  where group_id = p_group;

  -- reset cards/badges for TEST members only (phantom users), never a real member
  delete from player_cards  where user_id in (
    select gm.user_id from group_members gm join profiles pr on pr.id = gm.user_id
    where gm.group_id = p_group and coalesce(pr.is_test, false) = true);
  delete from member_badges where user_id in (
    select gm.user_id from group_members gm join profiles pr on pr.id = gm.user_id
    where gm.group_id = p_group and coalesce(pr.is_test, false) = true);

  return 'wiped';
end;
$$;
grant execute on function public.admin_wipe_group(uuid) to authenticated;
