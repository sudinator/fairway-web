-- 0111_money_audit.sql
-- Durable, immutable, unbypassable audit trail for the Money ledger, plus two
-- integrity fixes. Motivation: the old per-expense history (expense_audit, 0050)
-- is `on delete cascade`, so deleting an expense also erased its own history and
-- the full allocation could no longer be seen. And the allocation detail lived
-- ONLY in the live expense_shares/expense_payers rows (gone on delete) — the
-- group_activity summary kept the "who/what/when" line but never the breakdown.
--
-- This migration:
--   1. Adds `money_audit` — one immutable snapshot per underlying write, NOT
--      cascade-linked to the expense, so a deletion's snapshot OUTLIVES the
--      expense. No update/delete policy → append-only; nobody can doctor it.
--   2. Captures snapshots with DATABASE TRIGGERS, not app code. They fire on
--      EVERY write (app, admin, bet-posting, or a raw API call), so nothing can
--      bypass the trail. The snapshot insert is wrapped in an exception guard so
--      an auditing hiccup can NEVER block the user's actual save/delete.
--      A BEFORE DELETE trigger freezes the full allocation the instant before it
--      cascades away.
--   3. Tightens expense_shares / expense_payers writes to the parent expense's
--      creator or a group admin/owner (previously ANY active member could rewrite
--      another member's split directly via the API). Reads stay open to members.
--      This makes the stated model true: "edit only your own; admins edit anyone,
--      all logged." (0048/0049 left the children editable by any member.)
--   4. Adds a $100,000 ceiling on any single expense (sanity rail).
--
-- Idempotent (create-or-replace / if-not-exists / drop-if-exists). Run once in
-- the Supabase SQL editor after 0110.

-- ============================================================================
-- 1) money_audit — durable, append-only snapshot log
-- ============================================================================
create table if not exists public.money_audit (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null,                 -- plain uuid (NO fk cascade): survives group/expense deletion
  expense_id uuid not null,                 -- plain uuid (NO fk cascade): survives the expense's deletion
  actor_id   uuid,                          -- who caused the change (auth.uid()); null if unknown
  action     text not null check (action in ('created','edited','deleted')),
  snapshot   jsonb,                         -- full frozen picture (expense + payers + shares, names resolved)
  created_at timestamptz not null default now()
);
create index if not exists money_audit_expense_idx on public.money_audit(expense_id, created_at);
create index if not exists money_audit_group_idx   on public.money_audit(group_id, created_at desc);

alter table public.money_audit enable row level security;

-- Read: any active member of the audited group. (Transparency — "visible to all".)
drop policy if exists money_audit_select on public.money_audit;
create policy money_audit_select on public.money_audit for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = money_audit.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

-- NO insert/update/delete policy on purpose: rows are written only by the
-- SECURITY DEFINER triggers below (which bypass RLS), and can never be edited or
-- removed by any client. Append-only + immutable.
grant select on public.money_audit to authenticated;

-- ============================================================================
-- 2) snapshot builder + capture triggers
-- ============================================================================
-- Build the complete frozen picture of one expense, resolving member/guest names
-- so the snapshot still renders after those rows are gone. Returns null if the
-- expense doesn't exist. NOTE: expense_payers are members only (0049), so payer
-- names resolve from profiles; expense_shares may be a member OR a guest (0048).
create or replace function public._money_snapshot(p_expense uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when e.id is null then null else jsonb_build_object(
    'expense_id',      e.id,
    'group_id',        e.group_id,
    'description',     e.description,
    'category',        e.category,
    'amount_cents',    e.amount_cents,
    'currency',        e.currency,
    'split_type',      e.split_type,
    'source_kind',     e.source_kind,
    'created_by',      e.created_by,
    'created_by_name', (select coalesce(p.display_name, 'Player') from profiles p where p.id = e.created_by),
    'payers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',    pr.user_id,
               'name',       coalesce((select display_name from profiles where id = pr.user_id), 'Player'),
               'paid_cents', pr.paid_cents
             ) order by pr.paid_cents desc)
      from expense_payers pr where pr.expense_id = e.id), '[]'::jsonb),
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id',     sh.user_id,
               'guest_id',    sh.guest_id,
               'is_guest',    (sh.guest_id is not null),
               'name',        coalesce((select display_name from profiles where id = sh.user_id),
                                       (select name from group_guests where id = sh.guest_id), 'Player'),
               'share_cents', sh.share_cents
             ) order by sh.share_cents desc)
      from expense_shares sh where sh.expense_id = e.id), '[]'::jsonb)
  ) end
  from (select * from expenses where id = p_expense) e;
$$;

-- Trigger on the EXPENSE row. AFTER insert/update (row is settled), BEFORE delete
-- (so the snapshot captures the expense + its children before the cascade removes
-- them). The snapshot write is exception-guarded: logging must never block a save.
create or replace function public._money_audit_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_action text; v_eid uuid; v_gid uuid;
begin
  if tg_op = 'INSERT' then v_action := 'created'; v_eid := new.id; v_gid := new.group_id;
  elsif tg_op = 'UPDATE' then v_action := 'edited'; v_eid := new.id; v_gid := new.group_id;
  else v_action := 'deleted'; v_eid := old.id; v_gid := old.group_id;
  end if;
  begin
    insert into public.money_audit (group_id, expense_id, actor_id, action, snapshot)
      values (v_gid, v_eid, auth.uid(), v_action, public._money_snapshot(v_eid));
  exception when others then
    null;  -- auditing must never block the underlying write
  end;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

-- Trigger on the CHILD rows (shares/payers). Any change to the allocation logs an
-- 'edited' snapshot of the whole parent expense. During an expense delete the
-- cascade removes children AFTER the parent row is gone, so we skip when the
-- parent no longer exists (that case is already captured by the BEFORE DELETE
-- trigger above). Exception-guarded for the same reason.
create or replace function public._money_audit_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_eid uuid; v_gid uuid;
begin
  v_eid := coalesce(new.expense_id, old.expense_id);
  begin
    select group_id into v_gid from public.expenses where id = v_eid;
    if v_gid is not null then
      insert into public.money_audit (group_id, expense_id, actor_id, action, snapshot)
        values (v_gid, v_eid, auth.uid(), 'edited', public._money_snapshot(v_eid));
    end if;
  exception when others then
    null;
  end;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_money_audit_expense     on public.expenses;
create trigger trg_money_audit_expense
  after insert or update on public.expenses
  for each row execute function public._money_audit_expense();

drop trigger if exists trg_money_audit_expense_del on public.expenses;
create trigger trg_money_audit_expense_del
  before delete on public.expenses
  for each row execute function public._money_audit_expense();

drop trigger if exists trg_money_audit_shares on public.expense_shares;
create trigger trg_money_audit_shares
  after insert or update or delete on public.expense_shares
  for each row execute function public._money_audit_child();

drop trigger if exists trg_money_audit_payers on public.expense_payers;
create trigger trg_money_audit_payers
  after insert or update or delete on public.expense_payers
  for each row execute function public._money_audit_child();

-- ============================================================================
-- 3) Lock child-row writes to the expense's creator or a group admin/owner
--    (reads stay open to all active members). Matches the app's existing UI gate
--    (canEdit = created_by || isAdmin) and the parent expense's own update policy.
-- ============================================================================
-- expense_shares
drop policy if exists money_shares_rw     on public.expense_shares;
drop policy if exists money_shares_select on public.expense_shares;
drop policy if exists money_shares_write  on public.expense_shares;
create policy money_shares_select on public.expense_shares for select
  using (exists (select 1 from public.expenses e
                 join public.group_members gm on gm.group_id = e.group_id
                 where e.id = expense_shares.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));
create policy money_shares_write on public.expense_shares for all
  using (exists (select 1 from public.expenses e
                 where e.id = expense_shares.expense_id
                   and (e.created_by = auth.uid()
                        or exists (select 1 from public.group_members gm
                                   where gm.group_id = e.group_id and gm.user_id = auth.uid()
                                     and gm.status = 'active' and gm.role in ('admin','owner')))))
  with check (exists (select 1 from public.expenses e
                 where e.id = expense_shares.expense_id
                   and (e.created_by = auth.uid()
                        or exists (select 1 from public.group_members gm
                                   where gm.group_id = e.group_id and gm.user_id = auth.uid()
                                     and gm.status = 'active' and gm.role in ('admin','owner')))));

-- expense_payers
drop policy if exists money_payers_rw     on public.expense_payers;
drop policy if exists money_payers_select on public.expense_payers;
drop policy if exists money_payers_write  on public.expense_payers;
create policy money_payers_select on public.expense_payers for select
  using (exists (select 1 from public.expenses e
                 join public.group_members gm on gm.group_id = e.group_id
                 where e.id = expense_payers.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));
create policy money_payers_write on public.expense_payers for all
  using (exists (select 1 from public.expenses e
                 where e.id = expense_payers.expense_id
                   and (e.created_by = auth.uid()
                        or exists (select 1 from public.group_members gm
                                   where gm.group_id = e.group_id and gm.user_id = auth.uid()
                                     and gm.status = 'active' and gm.role in ('admin','owner')))))
  with check (exists (select 1 from public.expenses e
                 where e.id = expense_payers.expense_id
                   and (e.created_by = auth.uid()
                        or exists (select 1 from public.group_members gm
                                   where gm.group_id = e.group_id and gm.user_id = auth.uid()
                                     and gm.status = 'active' and gm.role in ('admin','owner')))));

-- ============================================================================
-- 4) $100,000 ceiling on a single expense (sanity rail).
--    If this ALTER errors, an existing row already exceeds $100k — inspect with:
--      select id, description, amount_cents from public.expenses where amount_cents > 10000000;
--    fix it, then re-run. (No such row is expected.)
-- ============================================================================
alter table public.expenses drop constraint if exists expenses_amount_max;
alter table public.expenses add constraint expenses_amount_max check (amount_cents <= 10000000);
