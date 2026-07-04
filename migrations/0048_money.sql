-- 0048_money.sql
-- Money feature: group expense ledger + splitting. Standalone (not game-tied), USD, integer cents.
-- Guests are sponsored by a member (sponsor_user_id); payers are always members.
-- Idempotent: safe to re-run. Run in the Supabase SQL editor.

-- ============ group_guests: a non-app player, tied to a sponsoring member ============
create table if not exists public.group_guests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  name text not null,
  sponsor_user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists group_guests_group_idx on public.group_guests(group_id);
create index if not exists group_guests_sponsor_idx on public.group_guests(sponsor_user_id);

-- ============ expenses ============
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  payer_user_id uuid not null references auth.users(id) on delete cascade,
  description text not null default '',
  category text not null default 'other',
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD',
  split_type text not null default 'even' check (split_type in ('even','custom')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists expenses_group_idx on public.expenses(group_id);

-- ============ expense_shares: one participant per row (member or guest) ============
create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_id uuid references public.group_guests(id) on delete cascade,
  share_cents integer not null check (share_cents >= 0),
  constraint expense_shares_one_party check ((user_id is not null) <> (guest_id is not null))
);
create unique index if not exists expense_shares_party_uk
  on public.expense_shares(expense_id, coalesce(user_id::text, ''), coalesce(guest_id::text, ''));
create index if not exists expense_shares_expense_idx on public.expense_shares(expense_id);

-- ============ settlements: member-to-member payment record ============
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  from_user_id uuid not null references auth.users(id) on delete cascade,
  to_user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  method text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists settlements_group_idx on public.settlements(group_id);

-- ============ profiles: optional payment handles (members only) ============
alter table public.profiles add column if not exists venmo_handle text;
alter table public.profiles add column if not exists paypal_handle text;
alter table public.profiles add column if not exists phone text;

-- ============ RLS ============
alter table public.group_guests   enable row level security;
alter table public.expenses        enable row level security;
alter table public.expense_shares  enable row level security;
alter table public.settlements     enable row level security;

-- group_guests: any active member manages; sponsor must be an active member of the group
drop policy if exists money_guests_rw on public.group_guests;
create policy money_guests_rw on public.group_guests for all
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = group_guests.group_id and gm.user_id = auth.uid() and gm.status = 'active'))
  with check (
    exists (select 1 from public.group_members gm
            where gm.group_id = group_guests.group_id and gm.user_id = auth.uid() and gm.status = 'active')
    and exists (select 1 from public.group_members gs
                where gs.group_id = group_guests.group_id and gs.user_id = group_guests.sponsor_user_id and gs.status = 'active')
  );

-- expenses: members read/insert; creator or admin update/delete
drop policy if exists money_expenses_select on public.expenses;
create policy money_expenses_select on public.expenses for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = expenses.group_id and gm.user_id = auth.uid() and gm.status = 'active'));
drop policy if exists money_expenses_insert on public.expenses;
create policy money_expenses_insert on public.expenses for insert
  with check (exists (select 1 from public.group_members gm
                      where gm.group_id = expenses.group_id and gm.user_id = auth.uid() and gm.status = 'active'));
drop policy if exists money_expenses_update on public.expenses;
create policy money_expenses_update on public.expenses for update
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = expenses.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));
drop policy if exists money_expenses_delete on public.expenses;
create policy money_expenses_delete on public.expenses for delete
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = expenses.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));

-- expense_shares: access through the parent expense's group membership
drop policy if exists money_shares_rw on public.expense_shares;
create policy money_shares_rw on public.expense_shares for all
  using (exists (select 1 from public.expenses e
                 join public.group_members gm on gm.group_id = e.group_id
                 where e.id = expense_shares.expense_id and gm.user_id = auth.uid() and gm.status = 'active'))
  with check (exists (select 1 from public.expenses e
                      join public.group_members gm on gm.group_id = e.group_id
                      where e.id = expense_shares.expense_id and gm.user_id = auth.uid() and gm.status = 'active'));

-- settlements: members read; a party (or admin) inserts; creator or admin deletes; no update
drop policy if exists money_settle_select on public.settlements;
create policy money_settle_select on public.settlements for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = settlements.group_id and gm.user_id = auth.uid() and gm.status = 'active'));
drop policy if exists money_settle_insert on public.settlements;
create policy money_settle_insert on public.settlements for insert
  with check (
    exists (select 1 from public.group_members gm
            where gm.group_id = settlements.group_id and gm.user_id = auth.uid() and gm.status = 'active')
    and (from_user_id = auth.uid() or to_user_id = auth.uid()
         or exists (select 1 from public.group_members ga
                    where ga.group_id = settlements.group_id and ga.user_id = auth.uid()
                      and ga.status = 'active' and ga.role in ('admin','owner')))
  );
drop policy if exists money_settle_delete on public.settlements;
create policy money_settle_delete on public.settlements for delete
  using (created_by = auth.uid()
         or exists (select 1 from public.group_members gm
                    where gm.group_id = settlements.group_id and gm.user_id = auth.uid()
                      and gm.status = 'active' and gm.role in ('admin','owner')));
