-- 0112_events.sql
-- Events: group an event's expenses into their own island (e.g. "Ireland Trip", or a game).
-- One member creates an event (name + optional free-form date); anyone can attach expenses to an
-- OPEN event. An admin CLOSES a settled event, which seals it — no more expenses, no edits to its
-- expenses — while keeping it fully viewable. Admin can reopen. Settlement stays group-wide; an
-- event is a reporting/reconciliation lens, not a separate ledger.
--
-- Enforcement is at the DB layer (triggers), not just the UI, consistent with the audit work:
--   * a closed event's expenses can't be edited/deleted, and nothing can be added/moved into it;
--   * event status only changes via set_event_closed (admin-only, logged);
--   * a game-linked event's name/date are owned by the game.
--
-- The 0111 audit trigger already snapshots expenses, so attaching/moving/closing is traced for free.
-- Idempotent. Run once in the Supabase SQL editor after 0111.

-- ============================================================================
-- 1) group_events + expenses.event_id
-- ============================================================================
create table if not exists public.group_events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.groups(id) on delete cascade,
  name           text not null,
  event_date     date,                                   -- optional; free-form (manual) or the game's date
  event_type     text not null default 'manual' check (event_type in ('manual','game')),
  source_game_id uuid references public.games(id) on delete set null,
  status         text not null default 'open' check (status in ('open','closed')),
  closed_by      uuid,
  closed_at      timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index if not exists group_events_group_idx on public.group_events(group_id, status);
-- one event per game
create unique index if not exists group_events_one_per_game
  on public.group_events(source_game_id) where source_game_id is not null;

alter table public.expenses add column if not exists event_id uuid
  references public.group_events(id) on delete set null;   -- deleting an event never deletes its expenses
create index if not exists expenses_event_idx on public.expenses(event_id);

-- ============================================================================
-- 2) RLS on group_events
-- ============================================================================
alter table public.group_events enable row level security;
grant select, insert, update, delete on public.group_events to authenticated;

-- read: any active member of the group
drop policy if exists group_events_select on public.group_events;
create policy group_events_select on public.group_events for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = group_events.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

-- create: any active member; created_by must be self
drop policy if exists group_events_insert on public.group_events;
create policy group_events_insert on public.group_events for insert
  with check (created_by = auth.uid()
              and exists (select 1 from public.group_members gm
                          where gm.group_id = group_events.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

-- direct update (rename / re-date): creator or admin/owner, and only while OPEN.
-- (status + closed_* are protected by the trigger below and only change via set_event_closed.)
drop policy if exists group_events_update on public.group_events;
create policy group_events_update on public.group_events for update
  using (status = 'open'
         and (created_by = auth.uid()
              or exists (select 1 from public.group_members gm
                         where gm.group_id = group_events.group_id and gm.user_id = auth.uid()
                           and gm.status = 'active' and gm.role in ('admin','owner'))))
  with check (created_by = auth.uid()
              or exists (select 1 from public.group_members gm
                         where gm.group_id = group_events.group_id and gm.user_id = auth.uid()
                           and gm.status = 'active' and gm.role in ('admin','owner')));

-- delete: creator or admin/owner, and only while OPEN (a closed event is a sealed record).
drop policy if exists group_events_delete on public.group_events;
create policy group_events_delete on public.group_events for delete
  using (status = 'open'
         and (created_by = auth.uid()
              or exists (select 1 from public.group_members gm
                         where gm.group_id = group_events.group_id and gm.user_id = auth.uid()
                           and gm.status = 'active' and gm.role in ('admin','owner'))));

-- ============================================================================
-- 3) Guard trigger on group_events: status only via the RPC; game name/date owned by the game.
-- ============================================================================
create or replace function public._guard_group_events()
returns trigger language plpgsql set search_path = public as $$
begin
  if (new.status is distinct from old.status
      or new.closed_by is distinct from old.closed_by
      or new.closed_at is distinct from old.closed_at)
     and coalesce(current_setting('bnn.event_admin', true), '') <> '1' then
    raise exception 'event status can only be changed via set_event_closed()';
  end if;
  if old.event_type = 'game'
     and (new.name is distinct from old.name or new.event_date is distinct from old.event_date)
     and coalesce(current_setting('bnn.event_gamelink', true), '') <> '1' then
    raise exception 'a game event''s name and date come from the game';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_group_events on public.group_events;
create trigger trg_guard_group_events before update on public.group_events
  for each row execute function public._guard_group_events();

-- ============================================================================
-- 4) Freeze enforcement on expenses: closed event = sealed.
-- ============================================================================
create or replace function public._guard_expense_frozen_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_closed boolean;
begin
  -- Block edits/deletes of an expense that currently sits in a CLOSED event.
  if tg_op in ('UPDATE','DELETE') and old.event_id is not null then
    select (status = 'closed') into v_closed from group_events where id = old.event_id;
    if coalesce(v_closed, false) then
      raise exception 'this expense is in a closed event — reopen the event to change it';
    end if;
  end if;
  -- Block adding/moving an expense INTO a closed or cross-group event.
  if tg_op in ('INSERT','UPDATE') and new.event_id is not null then
    select (status = 'closed') into v_closed from group_events
      where id = new.event_id and group_id = new.group_id;
    if not found then
      raise exception 'event not found for this group';
    end if;
    if coalesce(v_closed, false) then
      raise exception 'cannot add or move an expense into a closed event — reopen it first';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trg_guard_expense_frozen on public.expenses;
create trigger trg_guard_expense_frozen before insert or update or delete on public.expenses
  for each row execute function public._guard_expense_frozen_event();

-- ============================================================================
-- 5) RPCs
-- ============================================================================
-- Close / reopen an event. Admin/owner of the event's group only. Logged to the money activity feed.
create or replace function public.set_event_closed(p_event uuid, p_closed boolean)
returns void language plpgsql security definer set search_path = public as $$
declare ev record; v_actor text;
begin
  select * into ev from group_events where id = p_event;
  if not found then raise exception 'event not found'; end if;
  if not exists (select 1 from group_members gm
                 where gm.group_id = ev.group_id and gm.user_id = auth.uid()
                   and gm.status = 'active' and gm.role in ('admin','owner')) then
    raise exception 'only a club admin can open or close an event';
  end if;

  perform set_config('bnn.event_admin', '1', true);   -- authorize the status change for the guard trigger
  update group_events set
    status    = case when p_closed then 'closed' else 'open' end,
    closed_by = case when p_closed then auth.uid() else null end,
    closed_at = case when p_closed then now() else null end
  where id = p_event;

  select coalesce(display_name, email) into v_actor from profiles where id = auth.uid();
  insert into group_activity (group_id, actor_user_id, action, summary, meta)
    values (ev.group_id, auth.uid(),
            case when p_closed then 'event_closed' else 'event_reopened' end,
            (case when p_closed then 'closed event ' else 'reopened event ' end) || coalesce(ev.name, ''),
            jsonb_build_object('event_id', p_event));
end $$;
grant execute on function public.set_event_closed(uuid, boolean) to authenticated;

-- Move an expense to another OPEN event (or p_event = null to Ungroup). Expense creator or admin only.
create or replace function public.move_expense_event(p_expense uuid, p_event uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare ex record; is_adm boolean; tgt record; v_actor text;
begin
  select * into ex from expenses where id = p_expense;
  if not found then raise exception 'expense not found'; end if;
  is_adm := exists (select 1 from group_members gm
                    where gm.group_id = ex.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner'));
  if not (ex.created_by = auth.uid() or is_adm) then
    raise exception 'only the person who entered this expense or a club admin can move it';
  end if;

  -- Can't move an expense that is currently sealed in a closed event.
  if ex.event_id is not null and exists (select 1 from group_events e where e.id = ex.event_id and e.status = 'closed') then
    raise exception 'this expense is in a closed event — reopen that event first';
  end if;

  if p_event is not null then
    select * into tgt from group_events where id = p_event;
    if not found or tgt.group_id <> ex.group_id then raise exception 'target event not in this group'; end if;
    if tgt.status <> 'open' then raise exception 'target event is closed'; end if;
  end if;

  update expenses set event_id = p_event, updated_at = now() where id = p_expense;

  select coalesce(display_name, email) into v_actor from profiles where id = auth.uid();
  insert into group_activity (group_id, actor_user_id, action, summary, meta)
    values (ex.group_id, auth.uid(), 'expense_moved',
            'moved "' || coalesce(ex.description, 'expense') || '" to ' ||
              coalesce((select name from group_events where id = p_event), 'Ungrouped'),
            jsonb_build_object('expense_id', p_expense, 'event_id', p_event));
end $$;
grant execute on function public.move_expense_event(uuid, uuid) to authenticated;

-- Ensure a game has an event (create on first bet-post), returning its id. Player-in-game or admin.
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

  select id into ev_id from group_events where source_game_id = p_game;
  if ev_id is not null then
    -- keep the event's name/date in step with the game (authorized via the gamelink flag)
    perform set_config('bnn.event_gamelink', '1', true);
    update group_events
       set name = coalesce(nullif(g.name, ''), g.course, 'Game'),
           event_date = g.played_at
     where id = ev_id and status = 'open';
    return ev_id;
  end if;

  insert into group_events (group_id, name, event_date, event_type, source_game_id, status, created_by)
    values (g.group_id, coalesce(nullif(g.name, ''), g.course, 'Game'), g.played_at, 'game', p_game, 'open', auth.uid())
    returning id into ev_id;
  return ev_id;
end $$;
grant execute on function public.ensure_game_event(uuid) to authenticated;
