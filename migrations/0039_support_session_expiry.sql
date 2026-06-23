-- 0039: Auto-expire admin support sessions.
-- admin_enter_group inserts a temporary is_support membership; admin_exit_group
-- removes it. If an admin forgets to exit, the support row lingers and members
-- keep seeing the admin in their roster. This timestamps each support session and
-- reaps any older than a window (default 12h) whenever an admin acts.

alter table public.group_members add column if not exists support_started_at timestamptz;

-- Backfill existing support rows so they can age out (use created_at as the start).
update public.group_members
   set support_started_at = created_at
 where is_support = true and support_started_at is null;

-- Delete support memberships older than p_max_hours. Returns how many were reaped.
create or replace function public.expire_support_sessions(p_max_hours int default 12)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with del as (
    delete from group_members
     where is_support = true
       and support_started_at is not null
       and support_started_at < now() - make_interval(hours => p_max_hours)
    returning 1
  )
  select count(*) into n from del;
  return n;
end; $$;
grant execute on function public.expire_support_sessions(int) to authenticated;

-- Enter now stamps the start time and opportunistically reaps stale sessions.
create or replace function public.admin_enter_group(p_group uuid, p_email text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then return; end if;
  perform public.expire_support_sessions(12);
  if exists (
    select 1 from group_members
    where group_id = p_group and user_id = auth.uid() and status = 'active'
  ) then
    return;
  end if;
  insert into group_members (group_id, user_id, email, role, status, is_support, support_started_at)
  values (p_group, auth.uid(), coalesce(lower(p_email), ''), 'admin', 'active', true, now());
end; $$;
grant execute on function public.admin_enter_group(uuid, text) to authenticated;
