-- 0114_settlement_events.sql
-- Per-event settling. Settlements gain:
--   * event_id — which event this payment settles (null = the Ungrouped bucket / legacy global).
--   * status   — 'pending' (armed when the user taps "Open Venmo", before they confirm on return)
--                or 'confirmed' (counts toward balances + event settled-state). Legacy rows default
--                'confirmed'. Pending rows are ignored by balances and by event settled-state; they
--                only drive the "confirm your payment" nudge, and they persist so a settle survives an
--                app close (confirm-on-return, no payee verification per Amit).
-- No re-open trigger needed: an event's settled-state is COMPUTED as (confirmed event-tagged coverage
-- >= current within-event owed), so editing an expense re-opens it automatically when coverage falls
-- short (Amit's option (a), computed rather than destructive).
-- Idempotent. Run after 0113.

alter table public.settlements add column if not exists event_id uuid
  references public.group_events(id) on delete set null;
alter table public.settlements add column if not exists status text not null default 'confirmed';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'settlements_status_chk') then
    alter table public.settlements add constraint settlements_status_chk check (status in ('pending','confirmed'));
  end if;
end $$;

create index if not exists settlements_group_status_idx on public.settlements(group_id, status);
create index if not exists settlements_event_idx on public.settlements(event_id) where event_id is not null;

select record_migration('0114_settlement_events');
