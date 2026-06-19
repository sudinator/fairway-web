-- 0017_notifications_lockdown.sql
-- Close the open-notifications hole. Previously ANY signed-in user could insert a
-- notification addressed to anyone (write_check was just `auth.uid() is not null`),
-- enabling in-app spam/impersonation. Now:
--   * direct client inserts are restricted to the user's OWN row, and
--   * cross-user notifications must go through create_notification(), which only
--     allows a sender who has a real relationship to the recipient.
-- This changes enforcement only; it preserves every existing app flow.

create or replace function public.create_notification(
  p_recipient uuid,
  p_message   text,
  p_group_id  uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_sender uuid := auth.uid();
begin
  if v_sender is null then
    raise exception 'not authenticated';
  end if;
  if p_recipient is null or p_message is null then
    raise exception 'recipient and message are required';
  end if;

  -- Allowed only when a real relationship exists between sender and recipient.
  if not (
    -- 0. notifying yourself is always fine
    p_recipient = v_sender
    -- 1. sender is an app admin -> may notify anyone
    or is_admin()
    -- 2. recipient is an app admin -> anyone may notify them (e.g. group requests)
    or exists (select 1 from profiles p where p.id = p_recipient and p.is_admin = true)
    -- 3. sender organizes a game the recipient is playing in -> organizer <-> player
    or exists (
      select 1
      from games g
      join game_players gp on gp.game_id = g.id
      where g.created_by = v_sender
        and gp.user_id = p_recipient
    )
    -- 4. sender is an active admin of a group the recipient belongs to
    or exists (
      select 1
      from group_members ga
      join group_members gm on gm.group_id = ga.group_id
      where ga.user_id = v_sender and ga.role = 'admin' and ga.status = 'active'
        and gm.user_id = p_recipient and gm.status = 'active'
    )
  ) then
    raise exception 'not allowed to notify this user';
  end if;

  insert into notifications (user_id, message, group_id)
  values (p_recipient, p_message, p_group_id);
end;
$function$;

-- Lock direct inserts to the caller's own row. The function above bypasses this
-- (SECURITY DEFINER) for the sanctioned cross-user cases.
alter policy "create notifications" on public.notifications
  with check (user_id = auth.uid());

-- Ensure the RPC is callable by signed-in users (anon callers are rejected inside
-- the function anyway, since they have no auth.uid()).
grant execute on function public.create_notification(uuid, text, uuid) to authenticated;
