-- 0081_nudges.sql
-- Member-to-member "reach out" nudge. create_notification deliberately blocks
-- regular member->member notifications, so this dedicated SECURITY DEFINER RPC
-- gates on shared-club membership, dedupes per (sender, recipient) over 6h, and
-- drops an in-app notification (which the push webhook picks up). No PII shared —
-- the recipient just sees who reached out. Safe to run multiple times.

create table if not exists public.nudges (
  id           uuid primary key default gen_random_uuid(),
  sender_id    uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  group_id     uuid,
  message      text,
  created_at   timestamptz not null default now()
);
create index if not exists nudges_pair_time on public.nudges (sender_id, recipient_id, created_at desc);

alter table public.nudges enable row level security;
-- Inserts happen only through send_nudge (SECURITY DEFINER); clients may read their own.
drop policy if exists nudges_own on public.nudges;
create policy nudges_own on public.nudges
  for select using (sender_id = auth.uid() or recipient_id = auth.uid());

-- Returns 'sent' | 'too_soon'. Raises on bad input / not-in-club.
drop function if exists public.send_nudge(uuid, uuid, text);
create or replace function public.send_nudge(p_recipient uuid, p_group uuid, p_message text default null)
returns text
language plpgsql security definer set search_path = public as $fn$
declare
  v_sender uuid := auth.uid();
  v_name   text;
  v_clean  text;
  v_msg    text;
begin
  if v_sender is null then raise exception 'not authenticated'; end if;
  if p_recipient is null or p_group is null then raise exception 'recipient and club are required'; end if;
  if p_recipient = v_sender then raise exception 'cannot nudge yourself'; end if;

  -- caller must belong to the club; recipient must be an active member of it
  if not public.is_group_member(p_group, v_sender) then raise exception 'not a member of this club'; end if;
  if not exists (
    select 1 from group_members
    where group_id = p_group and user_id = p_recipient and status = 'active'
  ) then raise exception 'that player is not in this club'; end if;

  -- at most one nudge per (sender, recipient) per 6h
  if exists (
    select 1 from nudges n
    where n.sender_id = v_sender and n.recipient_id = p_recipient
      and n.created_at > now() - interval '6 hours'
  ) then return 'too_soon'; end if;

  select coalesce(display_name, 'A club member') into v_name from profiles where id = v_sender;
  v_clean := nullif(btrim(coalesce(p_message, '')), '');
  v_msg := '👋 ' || v_name || ' wants to connect';
  if v_clean is not null then v_msg := v_msg || ': ' || left(v_clean, 140); end if;

  insert into nudges (sender_id, recipient_id, group_id, message)
  values (v_sender, p_recipient, p_group, left(coalesce(v_clean, ''), 140));

  insert into notifications (user_id, message, group_id, type, link)
  values (p_recipient, v_msg, p_group, 'nudge', '/?tab=players');

  return 'sent';
end $fn$;
grant execute on function public.send_nudge(uuid, uuid, text) to authenticated;
