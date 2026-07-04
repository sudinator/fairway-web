-- 0049_expense_payers.sql
-- Multiple payers per expense: who fronted money, and how much each paid.
-- Balances use these rows when present; legacy single-payer expenses (no rows) fall back
-- to expenses.payer_user_id. Idempotent. Run after 0048.

create table if not exists public.expense_payers (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  paid_cents integer not null check (paid_cents > 0),
  constraint expense_payers_uk unique (expense_id, user_id)
);
create index if not exists expense_payers_expense_idx on public.expense_payers(expense_id);

alter table public.expense_payers enable row level security;

-- access through the parent expense's group membership (same pattern as expense_shares)
drop policy if exists money_payers_rw on public.expense_payers;
create policy money_payers_rw on public.expense_payers for all
  using (exists (select 1 from public.expenses e
                 join public.group_members gm on gm.group_id = e.group_id
                 where e.id = expense_payers.expense_id and gm.user_id = auth.uid() and gm.status = 'active'))
  with check (exists (select 1 from public.expenses e
                      join public.group_members gm on gm.group_id = e.group_id
                      where e.id = expense_payers.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));
