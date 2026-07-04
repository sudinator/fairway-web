-- 0050_expense_audit.sql
-- Per-expense edit history: a compact snapshot logged on create/edit.
-- Cascades away with its expense (per-expense history only). Idempotent. Run after 0049.

create table if not exists public.expense_audit (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  action text not null,                                   -- 'created' | 'edited'
  actor_user_id uuid references auth.users(id) on delete set null,
  snapshot jsonb,                                         -- { description, amount_cents, category, split_type, payers, participants }
  created_at timestamptz not null default now()
);
create index if not exists expense_audit_expense_idx on public.expense_audit(expense_id);

alter table public.expense_audit enable row level security;

-- read/insert for active members of the parent expense's group (same pattern as expense_shares)
drop policy if exists money_audit_select on public.expense_audit;
create policy money_audit_select on public.expense_audit for select
  using (exists (select 1 from public.expenses e
                 join public.group_members gm on gm.group_id = e.group_id
                 where e.id = expense_audit.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));
drop policy if exists money_audit_insert on public.expense_audit;
create policy money_audit_insert on public.expense_audit for insert
  with check (exists (select 1 from public.expenses e
                      join public.group_members gm on gm.group_id = e.group_id
                      where e.id = expense_audit.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));
