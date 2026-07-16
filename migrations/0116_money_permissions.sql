-- 0116_money_permissions.sql
-- Permission/lifecycle audit fixes. Idempotent. Run after 0115.

-- 1) settlements UPDATE policy.
-- settlements had SELECT/INSERT/DELETE policies but NO UPDATE policy, so RLS silently blocked the
-- pending -> confirmed transition (confirm-on-return never actually confirmed). Allow a party (payer
-- OR payee) or an admin to update — both parties get to clear a line item ("paid" / "received"), and
-- an admin can too. The closed-event freeze (0115) still governs INSERT/DELETE.
drop policy if exists money_settle_update on public.settlements;
create policy money_settle_update on public.settlements for update
  using (from_user_id = auth.uid() or to_user_id = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = settlements.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')))
  with check (from_user_id = auth.uid() or to_user_id = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = settlements.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));

-- 2) group_guests write permissions.
-- Was: any active member could add/edit/retire ANY guest (money_guests_rw for all). Now: any active
-- member may still ADD a guest, but only the guest's creator or a club admin may edit/retire/delete it.
-- SELECT stays open to active members. Sponsor must remain an active member on writes (as before).
drop policy if exists money_guests_rw on public.group_guests;
drop policy if exists money_guests_select on public.group_guests;
drop policy if exists money_guests_insert on public.group_guests;
drop policy if exists money_guests_update on public.group_guests;
drop policy if exists money_guests_delete on public.group_guests;

create policy money_guests_select on public.group_guests for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = group_guests.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

create policy money_guests_insert on public.group_guests for insert
  with check (
    exists (select 1 from public.group_members gm
            where gm.group_id = group_guests.group_id and gm.user_id = auth.uid() and gm.status = 'active')
    and exists (select 1 from public.group_members gs
                where gs.group_id = group_guests.group_id and gs.user_id = group_guests.sponsor_user_id and gs.status = 'active')
  );

create policy money_guests_update on public.group_guests for update
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = group_guests.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')))
  with check (
    exists (select 1 from public.group_members gs
            where gs.group_id = group_guests.group_id and gs.user_id = group_guests.sponsor_user_id and gs.status = 'active')
  );

create policy money_guests_delete on public.group_guests for delete
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = group_guests.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));

-- 3) A game bet posts to a FRESH event when the game's prior event was closed.
-- Drop the one-event-per-game unique index (a closed game event can now coexist with a new open one),
-- and have ensure_game_event reuse the game's OPEN event or create a new one.
drop index if exists public.group_events_one_per_game;
create index if not exists group_events_game_idx
  on public.group_events(source_game_id) where source_game_id is not null;

create or replace function public.ensure_game_event(p_game uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare g record; ev_id uuid;
begin
  select * into g from games where id = p_game;
  if not found then raise exception 'game not found'; end if;
  if not exists (select 1 from game_players gp where gp.game_id = p_game and gp.user_id = auth.uid())
     and not exists (select 1 from group_members gm where gm.group_id = g.group_id and gm.user_id = auth.uid()
                     and gm.status = 'active' and gm.role in ('admin','owner')) then
    raise exception 'must be a player in this game to link its event';
  end if;

  -- reuse the game's OPEN event if one exists; a closed one stays sealed and we create a fresh event
  select id into ev_id from group_events
    where source_game_id = p_game and status = 'open'
    order by created_at desc limit 1;
  if ev_id is not null then
    perform set_config('bnn.event_gamelink', '1', true);
    update group_events
       set name = coalesce(nullif(g.name, ''), g.course, 'Game'), event_date = g.played_at
     where id = ev_id and status = 'open';
    return ev_id;
  end if;

  insert into group_events (group_id, name, event_date, event_type, source_game_id, status, created_by)
    values (g.group_id, coalesce(nullif(g.name, ''), g.course, 'Game'), g.played_at, 'game', p_game, 'open', auth.uid())
    returning id into ev_id;
  return ev_id;
end $$;
grant execute on function public.ensure_game_event(uuid) to authenticated;

select record_migration('0116_money_permissions');
