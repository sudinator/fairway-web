-- 0121_money_clean_slate.sql
-- Reset money to a clean slate and lay the foundation for the Bucket model.
--   Bucket = the renamed "event": a self-contained settlement world. Settlement is per-Bucket;
--   the Club is a read-only rollup (each member's net = the sum of their Bucket balances).
-- Approved after confirming the only money data anywhere was disposable test data (App Testing) and
-- two throwaway LEMG rows. TGC and The 19th Hole were already empty.
--
--   Part 1 (ONE-TIME, destructive): wipe ALL money data across every club. Guarded by the migration
--     ledger, so re-running this file never re-wipes real data entered later.
--   Part 2 (idempotent): a "General" Bucket per club + every payment pinned to a Bucket.

-- ---------- Part 1: one-time wipe (guarded by the ledger) ----------
do $$
begin
  if exists (select 1 from public.schema_migrations where id = '0121_money_clean_slate') then
    raise notice '0121 already applied - skipping the one-time wipe.';
  else
    delete from public.settlement_allocations;
    delete from public.settlements;
    delete from public.expense_shares;
    delete from public.expense_payers;
    delete from public.expenses;
    delete from public.group_guests;
    delete from public.group_events;
    -- money-only activity (explicit allow-list); course/game/group/member/admin/tee-time logs untouched
    delete from public.group_activity
     where action in (
       'expense_created','expense_edited','expense_deleted','expense_restored',
       'settlement_added','settlement_removed',
       'guest_added','guest_retired','guest_restored','guest_unretired',
       'event_created','event_closed','event_reopened',
       'bet_posted','bet_reposted','bet_unposted');
    raise notice '0121 wipe complete.';
  end if;
end $$;

-- ---------- Part 2: Bucket foundation (idempotent) ----------

-- Mark the default Bucket without touching the event_type check constraint ('manual','game').
alter table public.group_events add column if not exists is_general boolean not null default false;

-- One "General" Bucket per club (the catch-all home for any expense/payment with no chosen Bucket).
insert into public.group_events (group_id, name, event_type, status, is_general, created_by)
select g.id, 'General', 'manual', 'open', true, null
  from public.groups g
 where not exists (select 1 from public.group_events ev
                    where ev.group_id = g.id and ev.is_general);

-- Every payment now lives in a Bucket (safe: settlements is empty after the wipe).
alter table public.settlements alter column event_id set not null;

select record_migration('0121_money_clean_slate');
