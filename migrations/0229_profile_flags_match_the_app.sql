-- 0229_profile_flags_match_the_app.sql
--
-- 212.58 — permission audit, part 4b (profiles): two flags a member could set on their own profile that no screen offers.
-- The profile guard (guard_profile_privileged_cols) already locks identity, the owner / admin flags and banned, and
-- guard_account_fields the account status; the profile editor's own fields (name, email, phone, handicap, GHIN, payment
-- handles, preferences) stay the member's. Left open were:
--   is_test       marks a test account, excluded from stats and club reports — a member could hide themselves from reports
--   deactivated   set by a system admin in Manage; the join page lets a member REACTIVATE themselves (deactivated = false)
-- Now: is_test changes only by a system admin; deactivated can be set to true only by a system admin (anyone may clear
-- their own). Maintenance without a signed-in caller is unaffected.
--
-- AUTHORIZATION: one trigger function, callable by no one. No grants or policies change.
-- TESTS: ci/assert-profile-flags.sql
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.guard_profile_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.is_test is distinct from old.is_test then
    raise exception 'Only a system admin can mark a test account.' using errcode = '42501';
  end if;
  if coalesce(new.deactivated, false) and not coalesce(old.deactivated, false) then
    raise exception 'Only a system admin can deactivate an account.' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile_flags on public.profiles;
create trigger trg_guard_profile_flags before update of is_test, deactivated on public.profiles
  for each row execute function public.guard_profile_flags();

revoke all on function public.guard_profile_flags() from public, anon, authenticated;

select public.record_migration('0229_profile_flags_match_the_app');

commit;
