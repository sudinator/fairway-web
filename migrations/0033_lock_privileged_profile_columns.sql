-- 0033_lock_privileged_profile_columns.sql
-- CRITICAL hardening. The profiles UPDATE policy is (id = auth.uid() OR is_admin())
-- with no column restriction, so any user could `update profiles set is_admin = true
-- where id = auth.uid()` and self-promote — unlocking every admin RPC. (A banned user
-- could likewise clear their own banned flag.) This trigger blocks any change to
-- is_admin or banned unless the caller is already an admin. SECURITY DEFINER admin
-- functions still work, because auth.uid() inside the trigger is the real (admin)
-- caller. No client code writes these columns directly, so nothing legitimate breaks.
create or replace function public.guard_profile_privileged_cols()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin
      or coalesce(new.banned, false) is distinct from coalesce(old.banned, false))
     and not public.is_admin() then
    raise exception 'changing is_admin/banned is not permitted';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_privileged on public.profiles;
create trigger trg_guard_profile_privileged
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_cols();
