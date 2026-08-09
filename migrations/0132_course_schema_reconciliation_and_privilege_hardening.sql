-- 0132_course_schema_reconciliation_and_privilege_hardening.sql
-- Reconciles the course-correction schema with the live database and locks writes behind the
-- transactional SECURITY DEFINER RPCs introduced in 0130/0131.
-- Safe on the current live DB: CREATE TABLE IF NOT EXISTS is a no-op because both tables exist.
-- On a fresh/reconstructed DB, this supplies the schema the app and later migrations expect.
--
-- AUTHORIZATION:
--   group_course_overrides SELECT — active group members and application admins.
--   course_change_requests SELECT — active group members and application admins.
--   Direct app-role writes — revoked. Mutations must use submit_course_correction(...) or
--   review_course_correction(...), which perform their own authorization checks atomically.

create table if not exists public.group_course_overrides (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  course_id uuid not null references public.favorite_courses(id) on delete cascade,
  name text not null,
  location text,
  data jsonb not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (group_id, course_id)
);

create table if not exists public.course_change_requests (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.favorite_courses(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  submitted_by uuid references auth.users(id) on delete set null,
  proposed_name text not null,
  proposed_location text,
  proposed_data jsonb not null,
  status text not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  reason text,
  change_summary text
);

-- Ensure the upsert arbiter required by submit_course_correction exists even if an older/manual
-- table definition omitted it. The live DB already has this constraint.
do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'group_course_overrides'
       and c.contype in ('u','p')
       and (
         select array_agg(a.attname order by k.ord)
           from unnest(c.conkey) with ordinality k(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
       ) = array['group_id','course_id']::name[]
  ) then
    alter table public.group_course_overrides
      add constraint group_course_overrides_group_id_course_id_key unique (group_id, course_id);
  end if;
end $$;

alter table public.group_course_overrides enable row level security;
alter table public.course_change_requests enable row level security;

-- Browser roles do not need table-level mutation privileges. SECURITY DEFINER RPCs own writes.
revoke all privileges on table public.group_course_overrides from anon;
revoke all privileges on table public.group_course_overrides from authenticated;
grant select on table public.group_course_overrides to authenticated;

revoke all privileges on table public.course_change_requests from anon;
revoke all privileges on table public.course_change_requests from authenticated;
grant select on table public.course_change_requests to authenticated;

-- Remove legacy direct-write policies now superseded by transactional RPCs.
drop policy if exists group_course_overrides_insert_member on public.group_course_overrides;
drop policy if exists group_course_overrides_update_member on public.group_course_overrides;
drop policy if exists group_course_overrides_delete_admin on public.group_course_overrides;

drop policy if exists course_change_requests_insert_member on public.course_change_requests;
drop policy if exists course_change_requests_update_admin on public.course_change_requests;

-- Preserve the product decision that every active group member can see that group's corrections.
drop policy if exists group_course_overrides_select_member on public.group_course_overrides;
create policy group_course_overrides_select_member
on public.group_course_overrides
for select
to authenticated
using (
  public.is_group_member(group_id, auth.uid())
  or public.is_admin()
);

drop policy if exists course_change_requests_select_relevant on public.course_change_requests;
create policy course_change_requests_select_relevant
on public.course_change_requests
for select
to authenticated
using (
  public.is_admin()
  or public.is_group_member(group_id, auth.uid())
);

select record_migration('0132_course_schema_reconciliation_and_privilege_hardening');
