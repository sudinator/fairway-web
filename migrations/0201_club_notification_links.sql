-- 0201_club_notification_links.sql
--
-- 210.10 — club notifications open the right club. Two notifications linked to /?tab=manage&manage=groups, a
-- destination the app doesn't understand (it knows ?tab=groups, not a "manage" tab): tapping "Your club … is
-- approved" (0199) or "Your club's report is ready" (0195) went nowhere. Now:
--   * approved → /?tab=groups&club=<id>: the app refreshes the member's clubs, selects that club, opens Clubs;
--   * declined → /?tab=groups;
--   * club report → /?tab=groups&club=<id>;
--   * a held sign-up, to the club's admins (0189 — the same broken /?tab=manage&manage=members) →
--     /?tab=groups&club=<id>, where the held sign-ups are shown;
--   * notifications already sent with the broken link are corrected in place.
--
-- AUTHORIZATION: unchanged (decide_club_request — system admins, checked inside; save_club_report — server only).
--
-- Idempotent; safe to re-run.

begin;

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
      case when p_approve then '/?tab=groups&club=' || g.id::text else '/?tab=groups' end);   -- 210.10: a link the app understands
  end if;
  return v_new;
end $$;
revoke all on function public.decide_club_request(uuid, boolean) from public, anon;
grant execute on function public.decide_club_request(uuid, boolean) to authenticated;

create or replace function public.save_club_report(p_report uuid, p_snapshot jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.round_email_server_session() then raise exception 'club reports are saved by the server' using errcode = '42501'; end if;
  select * into r from club_reports where id = p_report for update;
  if not found then raise exception 'report not found' using errcode = 'P0002'; end if;
  update club_reports set snapshot = p_snapshot, published_at = coalesce(published_at, now()) where id = p_report;
  if r.notified_at is null then
    insert into notifications(user_id, group_id, type, message, link)
    select gm.user_id, r.group_id, 'club_report', 'Your club''s report for ' || r.period_label || ' is ready — tap to see it.', '/?tab=groups&club=' || r.group_id::text
      from group_members gm join profiles p on p.id = gm.user_id
     where gm.group_id = r.group_id and gm.status = 'active' and gm.user_id is not null and p.account_status = 'active';
    update club_reports set notified_at = now() where id = p_report;
  end if;
end $$;
revoke all on function public.save_club_report(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_club_report(uuid, jsonb) to service_role;

create or replace function public.notify_signup_approvers(p_user uuid, p_message text, p_type text)
returns void language plpgsql security definer set search_path = public as $$
declare pr record;
begin
  select * into pr from profiles where id = p_user;
  insert into notifications(user_id, group_id, type, message, link)
  select a.id, null, p_type, p_message, '/?tab=admin&admin=signups' from profiles a
   where coalesce(a.is_admin, false) and a.account_status = 'active'
  union
  select gm.user_id, pr.pending_group, p_type, p_message, '/?tab=groups&club=' || pr.pending_group::text from group_members gm
   where pr.pending_kind = 'possible_duplicate' and pr.pending_group is not null and gm.group_id = pr.pending_group
     and gm.role = 'admin' and gm.status = 'active';
end $$;
revoke all on function public.notify_signup_approvers(uuid, text, text) from public, anon, authenticated;

-- Notifications already sent with the broken link.
update public.notifications
   set link = case when group_id is not null then '/?tab=groups&club=' || group_id::text else '/?tab=groups' end
 where link in ('/?tab=manage&manage=groups', '/?tab=manage&manage=members');

select public.record_migration('0201_club_notification_links');

commit;
