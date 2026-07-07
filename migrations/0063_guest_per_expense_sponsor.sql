-- 0063_guest_per_expense_sponsor.sql
-- Two related changes to how Money handles guests.

-- (1) Per-expense guest sponsor.
-- The member responsible for a guest is now chosen per expense and stored on the
-- share, instead of being a permanent attribute of the guest. Nullable: member
-- shares leave it null, and legacy guest shares (pre-migration) also leave it null
-- and fall back to the guest's old sponsor in the settle-up math.
alter table public.expense_shares
  add column if not exists sponsor_user_id uuid references auth.users(id) on delete set null;

-- (2) Guests no longer require a permanent sponsor (it's chosen per expense now),
-- so the old fixed sponsor becomes optional. Existing rows keep their value, which
-- is still used as the fallback for any expense shares created before this change.
alter table public.group_guests
  alter column sponsor_user_id drop not null;

-- (3) Retire a guest: hide them from the add-a-guest picker going forward without
-- deleting any history (their past shares stay intact). Optionally record the member
-- they became, purely for a "now a member" label. Balances are never moved.
alter table public.group_guests
  add column if not exists archived boolean not null default false;
alter table public.group_guests
  add column if not exists became_member_id uuid references auth.users(id) on delete set null;
