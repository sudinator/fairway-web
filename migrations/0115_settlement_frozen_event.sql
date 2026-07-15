-- 0115_settlement_frozen_event.sql
-- Closed = sealed, for PAYMENTS too. A settlement tagged to a closed event can't be unmarked (deleted)
-- directly, and a new payment can't be added to a closed event — reopen the event first. Mirrors the
-- expense freeze from 0112 (_guard_expense_frozen_event). UPDATE is intentionally allowed so that a
-- pending settlement armed before the event was closed can still be confirmed (pending -> confirmed).
-- Idempotent. Run after 0114.

create or replace function public._guard_settlement_frozen_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_closed boolean;
begin
  -- block unmark (delete) of a payment sealed in a closed event
  if tg_op = 'DELETE' and old.event_id is not null then
    select (status = 'closed') into v_closed from group_events where id = old.event_id;
    if coalesce(v_closed, false) then
      raise exception 'this payment is in a closed event — reopen the event to unmark it';
    end if;
  end if;
  -- block adding a NEW payment into a closed event
  if tg_op = 'INSERT' and new.event_id is not null then
    select (status = 'closed') into v_closed from group_events where id = new.event_id;
    if coalesce(v_closed, false) then
      raise exception 'cannot record a payment in a closed event — reopen it first';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists trg_guard_settlement_frozen on public.settlements;
create trigger trg_guard_settlement_frozen before insert or delete on public.settlements
  for each row execute function public._guard_settlement_frozen_event();

select record_migration('0115_settlement_frozen_event');
