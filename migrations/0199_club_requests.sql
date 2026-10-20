-- 0199_club_requests.sql
--
-- 210.8 — club requests, fixed and enforced (owner, Oct 20 2026: "I want to approve the club from the app").
--
-- The bug: a club can only be SEEN by its members or its creator (groups_select_member) — with no exception for
-- system admins — so Admin's "Club requests" list could never show anyone else's request. A request from
-- Jigar Shukla ("PA-NJ golfers") sat pending, invisible to the owner.
--
--   * admin_club_requests() — system admins: every pending request, with the requester and their note.
--   * decide_club_request(group, approve) — system admins: approve (→ active) or decline (→ declined); the
--     requester is notified either way.
--   * groups: a club created by anyone other than a system admin ALWAYS starts pending (whatever the request
--     says), and only system admins change a club's status — the app's approval can't be skipped by a direct
--     request. Server functions (e.g. admin_set_group_status) are unaffected.
--   * group_invites: a club that isn't active can't create invites — a pending club can't grow before approval.
--
-- AUTHORIZATION: admin_club_requests / decide_club_request — authenticated, checked inside (is_admin()).
-- The visibility rule for clubs is unchanged for everyone else.
--
-- Idempotent; safe to re-run.

begin;

create or replace function public.admin_club_requests()
returns table (id uuid, name text, request_note text, created_at timestamptz, requester_id uuid, requester_name text, requester_email text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'system admins only' using errcode = '42501'; end if;
  return query
  select g.id, g.name, g.request_note, g.created_at, g.created_by, p.display_name, p.email
    from groups g left join profiles p on p.id = g.created_by
   where g.status = 'pending'
   order by g.created_at, g.id;
end $$;
revoke all on function public.admin_club_requests() from public, anon;
grant execute on function public.admin_club_requests() to authenticated;

create or replace function public.decide_club_request(p_group uuid, p_approve boolean)
returns text language plpgsql security definer set search_path = public as $$
declare g record; v_new text;
begin
  if not public.is_admin() then raise exception 'system admins only' using errcode = '42501'; end if;
  select id, name, status, created_by into g from groups where id = p_group for update;
  if not found then raise exception 'club not found' using errcode = 'P0002'; end if;
  if g.status is distinct from 'pending' then raise exception 'this club isn''t waiting for approval (it is %)', coalesce(g.status, 'active') using errcode = '22023'; end if;
  v_new := case when p_approve then 'active' else 'declined' end;
  update groups set status = v_new where id = p_group;
  if g.created_by is not null then
    insert into notifications(user_id, group_id, type, message, link)
    values (g.created_by, case when p_approve then g.id end, 'club_decision',
      case when p_approve then 'Your club "' || g.name || '" is approved — it''s ready. Invite your group from the Clubs page.'
           else 'Your club request "' || g.name || '" wasn''t approved.' end,
      '/?tab=manage&manage=groups');
  end if;
  return v_new;
end $$;
revoke all on function public.decide_club_request(uuid, boolean) from public, anon;
grant execute on function public.decide_club_request(uuid, boolean) to authenticated;

-- A club's status is set by system admins only; new clubs from anyone else start pending.
create or replace function public.guard_group_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or public.is_admin() then return new; end if;   -- server functions, system admins
  if tg_op = 'INSERT' then
    new.status := 'pending';
  elsif new.status is distinct from old.status then
    raise exception 'only a system admin can change a club''s status' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_group_status on public.groups;
create trigger guard_group_status before insert or update on public.groups
  for each row execute function public.guard_group_status();

-- A club that isn't active can't create invites.
create or replace function public.guard_invite_active_club()
returns trigger language plpgsql set search_path = public as $$
declare st text;
begin
  select status into st from public.groups where id = new.group_id;
  if coalesce(st, 'active') <> 'active' then
    raise exception 'this club is waiting for approval — invites open once it''s approved' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists guard_invite_active_club on public.group_invites;
create trigger guard_invite_active_club before insert on public.group_invites
  for each row execute function public.guard_invite_active_club();

select public.record_migration('0199_club_requests');

commit;
