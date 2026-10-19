-- 0197_active_accounts_and_course_baseline.sql
--
-- 210.3 — two findings from the external review.
--
-- Point 3 · Only approved accounts change data directly. Sixteen tables accept direct writes from app users;
-- their row rules check membership and ownership, but some only check "signed in" (e.g. adding a shared course,
-- recording one's own round). Now a direct change by an account that is new, pending, suspended, merged or
-- removed is refused on all of them, whatever the table's own rule allows. Exceptions, deliberately: profiles
-- (account fields stay locked by guard_account_fields, 0189) and notifications (marking one's own as read).
-- Server functions (SECURITY DEFINER — sign-up, approval, scoring RPCs with their own checks) are unaffected:
-- the rule judges direct writes by the app user.
--
-- Point 1 · Hand corrections keep their protection. A selective apply stored the MERGED course as the provider
-- version, so a correction you kept looked like the provider's value and lost its protection at the next update.
-- Now the provider's own data is saved (course_freshness.provider_baseline) whenever an update is marked applied
-- — by either apply function — and the review compares against it.
--
-- AUTHORIZATION: guard_active_account — trigger (no grants). course_review_detail — unchanged (club admin).
--
-- Idempotent; safe to re-run.

begin;

-- ---------------------------------------------------------------- point 3
create or replace function public.guard_active_account()
returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  -- Direct writes by app users only (their requests run as 'authenticated'); server functions and database
  -- sessions are trusted and have their own checks.
  if current_user not in ('authenticated', 'anon') or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select account_status into st from public.profiles where id = auth.uid();
  if st is null or st in ('new', 'pending', 'suspended', 'merged', 'removed') then
    raise exception 'this account can''t make changes — it is waiting for approval, or has been suspended' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists guard_active_account on public.activity_log;
create trigger guard_active_account before insert or update or delete on public.activity_log
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.competition_players;
create trigger guard_active_account before insert or update or delete on public.competition_players
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.competition_sessions;
create trigger guard_active_account before insert or update or delete on public.competition_sessions
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.competitions;
create trigger guard_active_account before insert or update or delete on public.competitions
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.favorite_courses;
create trigger guard_active_account before insert or update or delete on public.favorite_courses
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.game_players;
create trigger guard_active_account before insert or update or delete on public.game_players
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.games;
create trigger guard_active_account before insert or update or delete on public.games
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.group_courses;
create trigger guard_active_account before insert or update or delete on public.group_courses
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.group_events;
create trigger guard_active_account before insert or update or delete on public.group_events
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.group_invites;
create trigger guard_active_account before insert or update or delete on public.group_invites
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.group_members;
create trigger guard_active_account before insert or update or delete on public.group_members
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.groups;
create trigger guard_active_account before insert or update or delete on public.groups
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.holes;
create trigger guard_active_account before insert or update or delete on public.holes
  for each row execute function public.guard_active_account();
drop trigger if exists guard_active_account on public.rounds;
create trigger guard_active_account before insert or update or delete on public.rounds
  for each row execute function public.guard_active_account();

-- ---------------------------------------------------------------- point 1
alter table public.course_freshness add column if not exists provider_baseline jsonb;

create or replace function public.course_freshness_keep_provider_baseline()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'applied' and old.status is distinct from 'applied' and new.api_data is not null then
    new.provider_baseline := new.api_data;   -- what the PROVIDER said, as applied — not the merged course
  end if;
  return new;
end $$;
drop trigger if exists course_freshness_keep_provider_baseline on public.course_freshness;
create trigger course_freshness_keep_provider_baseline before update on public.course_freshness
  for each row execute function public.course_freshness_keep_provider_baseline();

create or replace function public.course_review_detail(p_course_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_last record; v_out jsonb;
begin
  if not (public.is_admin() or exists (select 1 from public.course_owner_groups(p_course_id) g where public.is_group_admin(g, auth.uid()))) then
    raise exception 'club admin required' using errcode = '42501';
  end if;
  select version, data, created_at into v_last from course_versions
   where course_id = p_course_id and source in ('provider_update', 'initial', 'created') order by version desc limit 1;
  select jsonb_build_object(
           'stored', fc.data, 'api', cf.api_data, 'revision', cf.revision, 'declined', coalesce(cf.declined, '{}'::jsonb),
           -- 210.3 (review point 1): the provider's OWN data as last applied — not the merged course, which keeps
           -- retained corrections and would hide them. Falls back to history for courses applied before 0197.
           'last_provider', coalesce(cf.provider_baseline, v_last.data), 'last_provider_at', coalesce(cf.decided_at, v_last.created_at),
           'corrected_at', (select min(v.created_at) from course_versions v where v.course_id = p_course_id
                              and v.source in ('manual_edit', 'member_correction', 'restore') and v.version > coalesce(v_last.version, 0)))
    into v_out
    from favorite_courses fc left join course_freshness cf on cf.course_id = fc.id
   where fc.id = p_course_id;
  return v_out;
end $$;
revoke all on function public.course_review_detail(uuid) from public, anon;
grant execute on function public.course_review_detail(uuid) to authenticated;

select public.record_migration('0197_active_accounts_and_course_baseline');

commit;
