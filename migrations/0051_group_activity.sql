-- 0051_group_activity.sql
-- Immutable, group-wide money activity log (create/edit/delete expense, settle, add guest).
-- Group-scoped and NOT tied to the expense, so a deletion stays in the record.
-- Visible to all active members; append-only (no update/delete policies => RLS denies them).
-- Idempotent. Run after 0050.

create table if not exists public.group_activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,            -- expense_created | expense_edited | expense_deleted | settlement_added | guest_added
  summary text not null,           -- human-readable one-liner
  meta jsonb,                      -- { expense_id?, amount_cents?, ... }
  created_at timestamptz not null default now()
);
create index if not exists group_activity_group_idx on public.group_activity(group_id, created_at desc);

alter table public.group_activity enable row level security;

-- transparency: any active member of the group can read the whole log
drop policy if exists money_activity_select on public.group_activity;
create policy money_activity_select on public.group_activity for select
  using (exists (select 1 from public.group_members gm
                 where gm.group_id = group_activity.group_id and gm.user_id = auth.uid() and gm.status = 'active'));

-- append-only: a member can add rows attributed to themselves; no update/delete policies exist,
-- so the log cannot be altered or removed by anyone (RLS default-denies update/delete).
drop policy if exists money_activity_insert on public.group_activity;
create policy money_activity_insert on public.group_activity for insert
  with check (actor_user_id = auth.uid()
              and exists (select 1 from public.group_members gm
                          where gm.group_id = group_activity.group_id and gm.user_id = auth.uid() and gm.status = 'active'));
