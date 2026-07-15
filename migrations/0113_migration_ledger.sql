-- 0113_migration_ledger.sql
-- A logbook of which migrations have been applied, so confirming state is a single
-- query instead of an honor-system checklist. Adds:
--   * schema_migrations — one row per applied migration (id + timestamp)
--   * record_migration(text) — the helper every future migration calls on its last line
-- Backfills a single marker for the pre-ledger era (everything through 0110, which was
-- confirmed applied), then auto-detects whether 0111/0112 are already in by checking for
-- their objects. Run this LAST, after 0111 and 0112. Idempotent.

create table if not exists public.schema_migrations (
  id         text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
grant select on public.schema_migrations to authenticated;

drop policy if exists schema_migrations_select on public.schema_migrations;
create policy schema_migrations_select on public.schema_migrations for select
  using (auth.uid() is not null);
-- no insert/update/delete policy: written only by record_migration() (security definer)

create or replace function public.record_migration(p_id text)
returns void language sql security definer set search_path = public as $$
  insert into public.schema_migrations(id) values (p_id)
  on conflict (id) do nothing;
$$;
grant execute on function public.record_migration(text) to authenticated;

-- backfill
select record_migration('baseline_through_0110');
select record_migration('0111_money_audit')
  where to_regclass('public.money_audit') is not null;
select record_migration('0112_events')
  where to_regclass('public.group_events') is not null;
select record_migration('0113_migration_ledger');

-- show the log
select id, applied_at from public.schema_migrations order by id;
