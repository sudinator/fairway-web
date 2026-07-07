-- 0065_bet_guest_payers.sql
-- Mirror of 0063 for the WINNING side of a posted bet: let a guest be their own
-- payer line, resolving to the member sponsoring them. Makes guest handling symmetric
-- (a guest can be booked as their own line whether they win or lose), and both roll
-- up to the sponsor in the settle-up.
alter table public.expense_payers
  add column if not exists guest_id uuid references public.group_guests(id) on delete cascade;
alter table public.expense_payers
  add column if not exists sponsor_user_id uuid references auth.users(id) on delete set null;
alter table public.expense_payers
  alter column user_id drop not null;

-- Replace the member-only uniqueness with a party-based one (member OR guest).
alter table public.expense_payers drop constraint if exists expense_payers_uk;
create unique index if not exists expense_payers_party_uk
  on public.expense_payers(expense_id, coalesce(user_id::text, ''), coalesce(guest_id::text, ''));

-- Exactly one party per payer row (member xor guest).
alter table public.expense_payers drop constraint if exists expense_payers_one_party;
alter table public.expense_payers
  add constraint expense_payers_one_party check ((user_id is not null) <> (guest_id is not null));
