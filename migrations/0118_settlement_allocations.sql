-- 0118_settlement_allocations.sql   (STAGE 1 — foundation; ships with the app wiring, do not run alone)
-- Record payments at the expense level: a settlement (payment header) gains allocation lines tying it to
-- the specific expenses it clears. OVERALL BALANCES ARE UNAFFECTED — they are still computed from payment
-- totals; allocations only add per-expense/per-event attribution (moves carry coverage; disputes are
-- traceable). Idempotent. Run after 0117 (paired with the app change).

-- 1) sub-ledger table
create table if not exists public.settlement_allocations (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,   -- denormalized for RLS
  expense_id uuid references public.expenses(id) on delete set null,        -- null = general/unattributed
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);
create index if not exists settle_alloc_settlement_idx on public.settlement_allocations(settlement_id);
create index if not exists settle_alloc_expense_idx on public.settlement_allocations(expense_id);

alter table public.settlement_allocations enable row level security;
drop policy if exists settle_alloc_select on public.settlement_allocations;
create policy settle_alloc_select on public.settlement_allocations for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = settlement_allocations.group_id and gm.user_id = auth.uid() and gm.status = 'active'));
-- writes happen only via the record_settlement RPC (security definer) or ON DELETE CASCADE; no direct
-- insert/update/delete policy is granted.

-- 2) atomic settle: one payment header + its allocation lines, in a single transaction.
-- Client passes p_allocs = jsonb array of {expense_id (uuid|null), amount_cents (int)}. Sum must equal
-- p_amount. Caller must be a party (payer/payee) or a club admin. The settlements INSERT triggers
-- (closed-event freeze 0115, dedup 0117) still fire. Returns the new settlement id.
create or replace function public.record_settlement(
  p_group uuid, p_from uuid, p_to uuid, p_amount integer, p_method text,
  p_event uuid, p_status text, p_dedup text, p_allocs jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare s_id uuid; alloc_sum integer; rec jsonb;
begin
  if not (p_from = auth.uid() or p_to = auth.uid()
          or exists (select 1 from group_members gm where gm.group_id = p_group and gm.user_id = auth.uid()
                     and gm.status = 'active' and gm.role in ('admin','owner'))) then
    raise exception 'not allowed to record this payment';
  end if;

  select coalesce(sum((e->>'amount_cents')::int), 0) into alloc_sum
    from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) e;
  if alloc_sum <> p_amount then
    raise exception 'allocations (%) must sum to the payment amount (%)', alloc_sum, p_amount;
  end if;

  insert into settlements (group_id, from_user_id, to_user_id, amount_cents, method, event_id, status, dedup_key, created_by)
    values (p_group, p_from, p_to, p_amount, p_method, p_event, coalesce(p_status, 'confirmed'), p_dedup, auth.uid())
    returning id into s_id;

  for rec in select * from jsonb_array_elements(coalesce(p_allocs, '[]'::jsonb)) loop
    insert into settlement_allocations (settlement_id, group_id, expense_id, amount_cents)
      values (s_id, p_group, nullif(rec->>'expense_id','')::uuid, (rec->>'amount_cents')::int);
  end loop;

  return s_id;
end $$;
grant execute on function public.record_settlement(uuid,uuid,uuid,integer,text,uuid,text,text,jsonb) to authenticated;

-- 3) backfill existing settlements. History becomes a single general (null-expense) allocation — this is
-- balance-safe (overall balances never read allocations) and keeps historical per-event display on the
-- existing global-square path. NEW settlements (via the RPC) get true FIFO per-expense allocations. With
-- little history, reconstructing old per-expense splits isn't worth the risk; overall numbers are identical.
insert into public.settlement_allocations (settlement_id, group_id, expense_id, amount_cents)
select s.id, s.group_id, null, s.amount_cents
  from public.settlements s
 where not exists (select 1 from public.settlement_allocations a where a.settlement_id = s.id);

-- 4) reconciliation gate: every settlement's allocations must sum to its amount, or abort.
do $$
declare bad integer;
begin
  select count(*) into bad from (
    select s.id
      from public.settlements s
      left join public.settlement_allocations a on a.settlement_id = s.id
     group by s.id, s.amount_cents
    having coalesce(sum(a.amount_cents), 0) <> s.amount_cents
  ) x;
  if bad > 0 then
    raise exception 'RECONCILIATION FAILED: % settlement(s) whose allocations do not sum to the payment', bad;
  end if;
end $$;

select record_migration('0118_settlement_allocations');
