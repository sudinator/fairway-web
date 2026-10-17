-- 0189_account_signup_approval.sql
--
-- Sign-up approval and the duplicate check (208.0). Owner decisions, Oct 16 2026:
--   * One Google account per member (no account linking).
--   * Every FIRST sign-in is checked against existing members' names. A match → the account is held
--     (pending · possible duplicate) and the app asks "Is this you?" with the existing member's MASKED email.
--   * A new account WITHOUT a club invite waits (pending · no invite) — only a SYSTEM admin can admit it.
--   * A new account WITH a valid invite joins that club at once — unless it looks like a duplicate; then that
--     club's admins OR a system admin decide.
--   * The automatic default-club join is RETIRED (join_default_group now joins nobody), and a new or pending
--     account can no longer create a club (the app used to make a personal "Main" club for anyone with none).
--   * Existing members are unaffected: every current profile becomes 'active' (or 'suspended' if banned).
--
-- Account status is changed ONLY by the functions here and in 0190 — a trigger refuses any change made
-- directly by an app user, so a pending user cannot mark themselves active from their phone.
--
-- AUTHORIZATION: begin_account / acknowledge_not_duplicate — authenticated, act on the caller only.
-- admit_signup / reject_signup — system admin, or an admin of the club the sign-up is held for (possible
-- duplicates via that club's invite only). admin_pending_signups — system admin. club_pending_signups —
-- that club's admins. end_user_sessions / notify_signup_approvers — internal (no grants).
--
-- Idempotent; safe to re-run.

begin;

-- ---------------------------------------------------------------- status columns
alter table public.profiles add column if not exists account_status text;
alter table public.profiles add column if not exists status_reason text;
alter table public.profiles add column if not exists status_at timestamptz;
alter table public.profiles add column if not exists status_by uuid;
alter table public.profiles add column if not exists merged_into uuid;
alter table public.profiles add column if not exists pending_kind text;
alter table public.profiles add column if not exists pending_group uuid;
alter table public.profiles add column if not exists possible_duplicate_of uuid;
alter table public.profiles add column if not exists duplicate_acknowledged boolean not null default false;
alter table public.profiles add column if not exists pending_since timestamptz;
alter table public.profiles add column if not exists pending_reminded_at timestamptz;

-- Existing members: active (or suspended, if banned). Runs only for rows not yet classified.
update public.profiles set account_status = case when coalesce(banned, false) then 'suspended' else 'active' end
 where account_status is null;
-- Default 'active' for TRUSTED creation only (migrations, tests, the SQL editor). Every sign-up is still 'new':
-- the app's own insert is forced to 'new' by guard_account_fields, and begin_account sets 'new' explicitly.
alter table public.profiles alter column account_status set default 'active';
alter table public.profiles alter column account_status set not null;
alter table public.profiles drop constraint if exists profiles_account_status_chk;
alter table public.profiles add constraint profiles_account_status_chk
  check (account_status in ('new', 'pending', 'active', 'suspended', 'merged', 'removed'));
alter table public.profiles drop constraint if exists profiles_pending_kind_chk;
alter table public.profiles add constraint profiles_pending_kind_chk
  check (pending_kind is null or pending_kind in ('no_invite', 'possible_duplicate'));
create index if not exists profiles_pending_idx on public.profiles(account_status) where account_status = 'pending';

-- ---------------------------------------------------------------- the lock on account fields
-- Only the account functions (which set bnn.account_admin for their transaction) may change account
-- fields. A new profile always starts 'new', whatever the inserting client sends.
create or replace function public.guard_account_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  -- Guards changes made directly by app users (their phone runs as 'authenticated'). The account
  -- functions run as the database owner, as do migrations, tests and the SQL editor — those are trusted.
  -- (No session flag: a transaction-scoped flag can outlive the function that set it.)
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    new.account_status := 'new'; new.status_reason := null; new.status_at := null; new.status_by := null;
    new.merged_into := null; new.pending_kind := null; new.pending_group := null; new.possible_duplicate_of := null;
    new.duplicate_acknowledged := false; new.pending_since := null; new.pending_reminded_at := null;
    return new;
  end if;
  if new.account_status is distinct from old.account_status or new.status_reason is distinct from old.status_reason
     or new.merged_into is distinct from old.merged_into or new.pending_kind is distinct from old.pending_kind
     or new.pending_group is distinct from old.pending_group or new.possible_duplicate_of is distinct from old.possible_duplicate_of
     or new.duplicate_acknowledged is distinct from old.duplicate_acknowledged or new.status_by is distinct from old.status_by then
    raise exception 'account status can only be changed by an admin' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_account_fields on public.profiles;
create trigger guard_account_fields before insert or update on public.profiles
  for each row execute function public.guard_account_fields();

-- New or pending accounts cannot join a club or create one, except through the functions below.
create or replace function public.guard_unapproved_membership()
returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  -- Judged by the ACCOUNT BEING ADDED, never by who runs the statement: the invite functions run as their
  -- owner too, so an owner-based exemption would let a new account skip the duplicate check (0162's rule:
  -- never bypass on current_user). Only true server/migration sessions (no end user) are exempt. The account
  -- functions activate an account before adding it to a club, so they pass this naturally.
  if auth.uid() is null and coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then return new; end if;
  if new.user_id is null or new.status is distinct from 'active' then return new; end if;   -- an unclaimed / invited row
  if tg_op = 'UPDATE' and old.user_id is not distinct from new.user_id and old.status is not distinct from new.status then return new; end if;
  select account_status into st from public.profiles where id = new.user_id;
  if st in ('new', 'pending', 'merged', 'removed') then
    raise exception 'this account is waiting for approval' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_unapproved_membership on public.group_members;
create trigger guard_unapproved_membership before insert or update of user_id, status on public.group_members
  for each row execute function public.guard_unapproved_membership();

create or replace function public.guard_unapproved_group_create()
returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  if auth.uid() is null then return new; end if;   -- server/migration sessions
  select account_status into st from public.profiles where id = auth.uid();
  if st in ('new', 'pending', 'merged', 'removed') then
    raise exception 'this account is waiting for approval' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_unapproved_group_create on public.groups;
create trigger guard_unapproved_group_create before insert on public.groups
  for each row execute function public.guard_unapproved_group_create();

-- ---------------------------------------------------------------- helpers
-- Names compared without case, accents, punctuation or extra spaces.
create or replace function public.normalize_person_name(p text)
returns text language sql immutable as $$
  select nullif(trim(regexp_replace(regexp_replace(lower(translate(coalesce(p, ''),
    'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ', 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn')),
    '[^a-z ]', '', 'g'), '\s+', ' ', 'g')), '')
$$;
-- "Same person?" by name: identical full names, or the same first name where one side gives only a last
-- initial ("Vimal N" ~ "Vimal Narayanan"). Never used to decide alone — it holds the sign-up for a person.
create or replace function public.names_may_match(a text, b text)
returns boolean language sql immutable as $$
  with x as (select public.normalize_person_name(a) na, public.normalize_person_name(b) nb),
       y as (select na, nb, split_part(na, ' ', 1) fa, split_part(nb, ' ', 1) fb,
                    regexp_replace(na, '^.* ', '') la, regexp_replace(nb, '^.* ', '') lb from x)
  select na is not null and nb is not null and position(' ' in na) > 0 and position(' ' in nb) > 0 and (
           na = nb
        or (fa = fb and ((length(la) = 1 and left(lb, 1) = la) or (length(lb) = 1 and left(la, 1) = lb))))
  from y
$$;
-- "v•••••@medtrix•••.com" — enough to recognise, not enough to learn.
create or replace function public.mask_email(e text)
returns text language sql immutable as $$
  select case when e is null or position('@' in e) = 0 then null else
    left(split_part(e, '@', 1), 1) || '•••••@' ||
    case when length(regexp_replace(split_part(e, '@', 2), '\.[^.]*$', '')) > 7
         then left(regexp_replace(split_part(e, '@', 2), '\.[^.]*$', ''), 7) || '•••' else regexp_replace(split_part(e, '@', 2), '\.[^.]*$', '') end
    || coalesce(substring(split_part(e, '@', 2) from '\.[^.]*$'), '') end
$$;

create or replace function public.end_user_sessions(p_user uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  -- Supabase's sign-in tables (both exist on staging/production; the local test shim has neither or one).
  if to_regclass('auth.refresh_tokens') is not null then execute 'delete from auth.refresh_tokens where user_id = $1' using p_user::text; end if;
  if to_regclass('auth.sessions') is not null then execute 'delete from auth.sessions where user_id = $1' using p_user; end if;
end $$;
revoke all on function public.end_user_sessions(uuid) from public, anon, authenticated;

-- Notify whoever may decide: system admins always; that club's admins for a possible duplicate held for it.
create or replace function public.notify_signup_approvers(p_user uuid, p_message text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from profiles where id = p_user;
  insert into notifications(user_id, group_id, type, message, link)
  select a.id, null, p_type, p_message, '/?tab=admin&admin=signups' from profiles a
   where coalesce(a.is_admin, false) and a.account_status = 'active'
  union
  select gm.user_id, pr.pending_group, p_type, p_message, '/?tab=manage&manage=members' from group_members gm
   where pr.pending_kind = 'possible_duplicate' and pr.pending_group is not null and gm.group_id = pr.pending_group
     and gm.role = 'admin' and gm.status = 'active';
end $$;
revoke all on function public.notify_signup_approvers(uuid, text, text) from public, anon, authenticated;

-- The existing member a new account most likely duplicates (null if none).
create or replace function public.find_duplicate_member(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select o.id from profiles me join profiles o on o.id <> me.id
   where me.id = p_user and o.account_status in ('active', 'suspended')
     and public.names_may_match(coalesce(me.display_name, (select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') from auth.users u where u.id = me.id)), o.display_name)
   order by (public.normalize_person_name(o.display_name) = public.normalize_person_name(me.display_name)) desc, o.last_active desc nulls last
   limit 1
$$;
revoke all on function public.find_duplicate_member(uuid) from public, anon, authenticated;

-- A redeemable invite for a code, or null.
create or replace function public.valid_invite(p_code text)
returns public.group_invites language sql stable security definer set search_path = public as $$
  select gi.* from group_invites gi
   where p_code is not null and upper(gi.invite_code) = upper(trim(p_code)) and gi.status = 'active'
     and (gi.expires_at is null or gi.expires_at > now())
     and (coalesce(gi.multi, false) = false or gi.max_uses is null or gi.use_count < gi.max_uses)
   limit 1
$$;
revoke all on function public.valid_invite(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- begin_account
-- Called by the app on every first load and from invite links. Creates the profile if needed (moving that
-- off the browser) and returns what the app should show: {state: active | possible_duplicate | pending | blocked}.
create or replace function public.begin_account(p_invite_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); u record; pr record; inv public.group_invites; dup uuid; dp record; v_name text; v_email_group uuid;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select id, email, raw_user_meta_data into u from auth.users where id = v_uid;
  select * into pr from profiles where id = v_uid;
  if not found then
    v_name := nullif(trim(coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', '')), '');
    insert into profiles(id, display_name, email, last_active, account_status) values (v_uid, v_name, u.email, now(), 'new');
    select * into pr from profiles where id = v_uid;
  end if;
  if coalesce(pr.banned, false) and pr.account_status = 'new' then
    -- a blocklisted email signing in again: never usable
    update profiles set account_status = 'removed', status_reason = coalesce(status_reason, 'Email blocked'), status_at = now() where id = v_uid;
    return jsonb_build_object('state', 'blocked');
  end if;
  if pr.account_status in ('suspended', 'merged', 'removed') then return jsonb_build_object('state', 'blocked'); end if;

  inv := public.valid_invite(p_invite_code);
  -- An email invite (an admin pre-added this address to a club roster) is an invitation too.
  select gm.group_id into v_email_group from group_members gm
   where lower(gm.email::text) = lower(u.email) and gm.status = 'invited' and gm.user_id is null order by gm.created_at limit 1;

  if pr.account_status = 'active' then
    if inv.id is not null and not exists (select 1 from group_members where group_id = inv.group_id and user_id = v_uid and status = 'active') then
      insert into group_members(group_id, user_id, email, role, status) values (inv.group_id, v_uid, lower(u.email), coalesce(inv.role, 'member'), 'active');
      update group_invites set use_count = coalesce(use_count, 0) + 1, used_by = case when coalesce(multi, false) then used_by else v_uid end,
             status = case when coalesce(multi, false) then status else 'used' end where id = inv.id;
    end if;
    return jsonb_build_object('state', 'active', 'group_id', inv.group_id);
  end if;

  -- new, or pending
  if pr.account_status = 'new' then
    dup := public.find_duplicate_member(v_uid);
    if dup is not null then
      update profiles set account_status = 'pending', pending_kind = 'possible_duplicate', pending_group = coalesce(inv.group_id, v_email_group),
             possible_duplicate_of = dup, pending_since = now(), status_at = now() where id = v_uid;
    elsif inv.id is null and v_email_group is not null then
      update profiles set account_status = 'active', status_at = now(), status_reason = 'Joined with an email invite' where id = v_uid;
      update group_members set user_id = v_uid, status = 'active' where lower(email::text) = lower(u.email) and status = 'invited' and (user_id is null or user_id = v_uid);
      return jsonb_build_object('state', 'active', 'group_id', v_email_group);
    elsif inv.id is not null then
      update profiles set account_status = 'active', status_at = now(), status_reason = 'Joined with an invite' where id = v_uid;
      insert into group_members(group_id, user_id, email, role, status) values (inv.group_id, v_uid, lower(u.email), coalesce(inv.role, 'member'), 'active');
      update group_invites set use_count = coalesce(use_count, 0) + 1, used_by = case when coalesce(multi, false) then used_by else v_uid end,
             status = case when coalesce(multi, false) then status else 'used' end where id = inv.id;
      return jsonb_build_object('state', 'active', 'group_id', inv.group_id);
    else
      update profiles set account_status = 'pending', pending_kind = 'no_invite', pending_since = now(), status_at = now() where id = v_uid;
      perform public.notify_signup_approvers(v_uid, 'New sign-up waiting: ' || coalesce(pr.display_name, u.email) || ' (' || u.email || ') — no invite. Tap to review.', 'signup_pending');
    end if;
    select * into pr from profiles where id = v_uid;
  elsif pr.pending_kind = 'no_invite' and inv.id is not null and public.find_duplicate_member(v_uid) is null then
    -- waiting with no invite, then opened a valid invite link: in straight away
    update profiles set account_status = 'active', pending_kind = null, pending_group = null, pending_since = null, status_at = now(),
           status_reason = 'Joined with an invite' where id = v_uid;
    insert into group_members(group_id, user_id, email, role, status) values (inv.group_id, v_uid, lower(u.email), coalesce(inv.role, 'member'), 'active');
    update group_invites set use_count = coalesce(use_count, 0) + 1 where id = inv.id;
    return jsonb_build_object('state', 'active', 'group_id', inv.group_id);
  elsif pr.pending_kind = 'possible_duplicate' and pr.pending_group is null and inv.id is not null then
    update profiles set pending_group = inv.group_id where id = v_uid;
    select * into pr from profiles where id = v_uid;
  end if;

  if pr.pending_kind = 'possible_duplicate' and not pr.duplicate_acknowledged then
    select display_name, email into dp from profiles where id = pr.possible_duplicate_of;
    return jsonb_build_object('state', 'possible_duplicate', 'match_name', dp.display_name, 'match_email', public.mask_email(dp.email),
                              'signed_in_as', u.email);
  end if;
  return jsonb_build_object('state', 'pending', 'kind', pr.pending_kind, 'signed_in_as', u.email,
                            'club', (select name from groups where id = pr.pending_group));
end $$;
revoke all on function public.begin_account(text) from public, anon;
grant execute on function public.begin_account(text) to authenticated;

-- "That's not me": keep waiting, and tell whoever may decide.
create or replace function public.acknowledge_not_duplicate()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); pr record; dp record;
begin
  if v_uid is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into pr from profiles where id = v_uid;
  if pr.account_status <> 'pending' or pr.pending_kind <> 'possible_duplicate' then return jsonb_build_object('state', pr.account_status); end if;
  if not pr.duplicate_acknowledged then
    update profiles set duplicate_acknowledged = true where id = v_uid;
    select display_name into dp from profiles where id = pr.possible_duplicate_of;
    perform public.notify_signup_approvers(v_uid, 'New sign-up waiting: ' || coalesce(pr.display_name, pr.email) || ' (' || pr.email || ') — possible duplicate of '
      || coalesce(dp.display_name, 'an existing member') || '. Tap to review.', 'signup_pending');
  end if;
  return jsonb_build_object('state', 'pending', 'kind', 'possible_duplicate');
end $$;
revoke all on function public.acknowledge_not_duplicate() from public, anon;
grant execute on function public.acknowledge_not_duplicate() to authenticated;

-- ---------------------------------------------------------------- decisions
-- Who may decide on a pending sign-up: a system admin always; that club's admin only for a possible
-- duplicate who came through that club's invite.
create or replace function public.can_decide_signup(p_user uuid, p_group uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from profiles pr where pr.id = p_user and pr.account_status = 'pending' and pr.pending_kind = 'possible_duplicate'
       and pr.pending_group is not null and pr.pending_group = p_group and public.is_group_admin(p_group, auth.uid()))
$$;
revoke all on function public.can_decide_signup(uuid, uuid) from public, anon;

create or replace function public.admit_signup(p_user uuid, p_group uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr record; gname text;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found or pr.account_status <> 'pending' then raise exception 'this sign-up is not waiting for approval' using errcode = '55000'; end if;
  if p_group is null then raise exception 'choose a club' using errcode = '22023'; end if;
  if not public.can_decide_signup(p_user, p_group) then
    raise exception 'only a system admin can admit this sign-up (or that club''s admins, for a possible duplicate who used the club''s invite)' using errcode = '42501';
  end if;
  update profiles set account_status = 'active', pending_kind = null, pending_group = null, possible_duplicate_of = null,
         duplicate_acknowledged = false, pending_since = null, pending_reminded_at = null,
         status_at = now(), status_by = auth.uid(), status_reason = 'Admitted' where id = p_user;
  update group_members set user_id = p_user, status = 'active' where lower(email::text) = lower(pr.email) and status = 'invited' and (user_id is null or user_id = p_user);
  if not exists (select 1 from group_members where group_id = p_group and user_id = p_user) then
    insert into group_members(group_id, user_id, email, role, status) values (p_group, p_user, lower(pr.email), 'member', 'active');
  end if;
  select name into gname from groups where id = p_group;
  insert into notifications(user_id, group_id, type, message, link)
  values (p_user, p_group, 'signup_admitted', 'You''re in! Welcome to ' || coalesce(gname, 'your club') || ' on Birdie Num Num.', '/');
  insert into activity_log(actor_id, action, target_user_id, group_id, summary)
  values (auth.uid(), 'signup_admitted', p_user, p_group, 'Admitted ' || coalesce(pr.display_name, pr.email) || ' to ' || coalesce(gname, 'a club'));
end $$;
revoke all on function public.admit_signup(uuid, uuid) from public, anon;
grant execute on function public.admit_signup(uuid, uuid) to authenticated;

create or replace function public.reject_signup(p_user uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '42501'; end if;
  select * into pr from profiles where id = p_user for update;
  if not found or pr.account_status <> 'pending' then raise exception 'this sign-up is not waiting for approval' using errcode = '55000'; end if;
  if not public.can_decide_signup(p_user, pr.pending_group) then raise exception 'not allowed to decide on this sign-up' using errcode = '42501'; end if;
  -- 'removed' keeps the account out on its own (the app treats it as blocked). The banned flag itself stays a
  -- system-admin-only change (0158), so a club admin's rejection does not touch it.
  update profiles set account_status = 'removed', banned = case when public.is_admin() then true else banned end,
         pending_kind = null, pending_group = null, possible_duplicate_of = null,
         status_at = now(), status_by = auth.uid(), status_reason = coalesce(nullif(trim(p_reason), ''), 'Sign-up rejected') where id = p_user;
  if pr.email is not null then
    insert into banned_emails(email, reason) values (lower(pr.email), coalesce(nullif(trim(p_reason), ''), 'Sign-up rejected')) on conflict (email) do nothing;
  end if;
  perform public.end_user_sessions(p_user);
  insert into activity_log(actor_id, action, target_user_id, summary)
  values (auth.uid(), 'signup_rejected', p_user, 'Rejected sign-up ' || coalesce(pr.display_name, pr.email));
end $$;
revoke all on function public.reject_signup(uuid, text) from public, anon;
grant execute on function public.reject_signup(uuid, text) to authenticated;

-- ---------------------------------------------------------------- the queues
create or replace function public.admin_pending_signups()
returns table (id uuid, display_name text, email text, pending_kind text, pending_since timestamptz, duplicate_acknowledged boolean,
               club_id uuid, club_name text, match_id uuid, match_name text, match_email text, match_clubs text, match_rounds int, match_last_active timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.pending_kind, p.pending_since, p.duplicate_acknowledged, p.pending_group, g.name,
         m.id, m.display_name, public.mask_email(m.email),
         (select string_agg(gg.name, ', ' order by gg.name) from group_members gm join groups gg on gg.id = gm.group_id where gm.user_id = m.id and gm.status = 'active'),
         (select count(*)::int from rounds r where r.user_id = m.id and r.deleted_at is null), m.last_active
    from profiles p left join groups g on g.id = p.pending_group left join profiles m on m.id = p.possible_duplicate_of
   where public.is_admin() and p.account_status = 'pending'
   order by p.pending_since
$$;
revoke all on function public.admin_pending_signups() from public, anon;
grant execute on function public.admin_pending_signups() to authenticated;

create or replace function public.club_pending_signups(p_group uuid)
returns table (id uuid, display_name text, email text, pending_since timestamptz, match_name text, match_email text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.email, p.pending_since, m.display_name, public.mask_email(m.email)
    from profiles p left join profiles m on m.id = p.possible_duplicate_of
   where public.is_group_admin(p_group, auth.uid()) and p.account_status = 'pending' and p.pending_kind = 'possible_duplicate' and p.pending_group = p_group
   order by p.pending_since
$$;
revoke all on function public.club_pending_signups(uuid) from public, anon;
grant execute on function public.club_pending_signups(uuid) to authenticated;

-- ---------------------------------------------------------------- retire the automatic default-club join
create or replace function public.join_default_group(p_email text)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  -- 208.0: retired. New accounts are admitted by an admin (begin_account / admit_signup). Kept, joining
  -- nobody, so older app versions still in someone's browser get a harmless null.
  return null;
end $$;
grant execute on function public.join_default_group(text) to authenticated;

-- ---------------------------------------------------------------- 7-day reminder (once; never auto-approves)
create or replace function public.remind_pending_signups()
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select * from profiles where account_status = 'pending' and pending_since < now() - interval '7 days' and pending_reminded_at is null loop
    perform public.notify_signup_approvers(r.id, coalesce(r.display_name, r.email) || ' has been waiting 7 days for approval. Tap to review.', 'signup_reminder');
    update profiles set pending_reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.remind_pending_signups() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'signup-reminders';
    perform cron.schedule('signup-reminders', '0 13 * * *', 'select public.remind_pending_signups()');
  end if;
end $$;

select public.record_migration('0189_account_signup_approval');

commit;
