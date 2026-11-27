-- 0241_my_data_exports.sql
-- 212.133 (owner, Nov 26, 2026): Profile → "Email me my data". A member asks once; the server emails their rounds, holes
-- and games as CSV files to the address on their account — never an address they type. This table is the ledger that
-- makes it once a day per member (so the mail account cannot be hammered) and lets the member see when it last went.
-- AUTHORIZATION: members can READ their own rows (the Profile shows "last sent"). Only the server writes (service role,
-- app/api/my-data/route.ts, after verifying the signed-in caller). No member insert/update/delete: the request itself
-- is the authenticated API call, and the row is the server's record of it. guard_active_account is not attached because
-- members never write here (the checklist exception list: a server-only ledger, like round_email_log).
-- WORST CASE (SECURITY_CHECKLIST Q3): a signed-in member can make the app's Gmail sender send ONE message a day to their own
-- address, and after a failed attempt nothing for 15 minutes (my_data_export_next_allowed counts every attempt, so a loop
-- against an exhausted mail quota is throttled). The route also refuses any account that is not active (pending,
-- suspended, banned) — the same rule as every other service-role route. No other member's data is reachable: every read
-- is keyed to the caller's id from the session, never from the request.
-- The merge registry (0190): a merged-away account's ledger rows move with the account.
-- Additive. No history rewrite.
-- TESTS: ci/assert-my-data-exports.sql
begin;

create table if not exists public.my_data_exports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  sent_to text,                                   -- the account email at the time, for the member's own record
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),   -- the row is written BEFORE the send, so two taps at once cannot both send
  error text,
  rounds integer, holes integer, games integer    -- what went out, for support
);
create index if not exists my_data_exports_user_idx on public.my_data_exports(user_id, requested_at desc);
alter table public.my_data_exports enable row level security;
drop policy if exists "own data exports" on public.my_data_exports;
create policy "own data exports" on public.my_data_exports as permissive for select to authenticated
  using (user_id = auth.uid());
revoke all on public.my_data_exports from public, anon;
grant select on public.my_data_exports to authenticated;

insert into public.account_reference_columns(table_name, column_name, rule, key_columns, activity, note)
values ('my_data_exports', 'user_id', 'move', null, false, 'my data export ledger')
on conflict (table_name, column_name) do nothing;

-- The once-a-day rule, decided in one place for the route and the Profile: when may this member next request?
-- A send (or one still in flight) holds the day; a failed attempt holds 15 minutes, so retries cannot run in a loop.
create or replace function public.my_data_export_next_allowed(p_user uuid)
returns timestamptz language sql stable security invoker set search_path = public as $$
  select greatest(
    coalesce((select max(requested_at) from public.my_data_exports where user_id = p_user and status in ('sent', 'sending')), timestamptz '1970-01-01') + interval '24 hours',
    coalesce((select max(requested_at) from public.my_data_exports where user_id = p_user and status = 'failed'), timestamptz '1970-01-01') + interval '15 minutes');
$$;
revoke all on function public.my_data_export_next_allowed(uuid) from public, anon;
grant execute on function public.my_data_export_next_allowed(uuid) to authenticated;

select public.record_migration('0241_my_data_exports');

commit;
