-- 0069_push_subscriptions.sql
-- Web Push plumbing (phase 1): store each device's push subscription, add per-type push
-- preferences, and give notifications a type + deep-link so a push can open the right
-- screen. The sender (Vercel route) + webhook come in phase 2; nothing here sends a push.

-- One row per browser/device push endpoint. A user may have several (phone, desktop…).
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  platform    text,
  user_agent  text,
  disabled    boolean not null default false,  -- flipped true by the sender after repeated failures
  fail_count  int not null default 0,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id) where disabled = false;

alter table public.push_subscriptions enable row level security;
-- Users manage ONLY their own subscriptions. The sender reads via the service role,
-- which bypasses RLS, so no broad read policy is needed here.
drop policy if exists push_sub_select on public.push_subscriptions;
drop policy if exists push_sub_insert on public.push_subscriptions;
drop policy if exists push_sub_update on public.push_subscriptions;
drop policy if exists push_sub_delete on public.push_subscriptions;
create policy push_sub_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy push_sub_insert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy push_sub_update on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_sub_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- Per-type push preferences (absent key = ON). A "_master" key of false mutes everything.
alter table public.profiles add column if not exists push_prefs jsonb not null default '{}'::jsonb;

-- Let a notification carry a type + deep link so the push (and the in-app bell) can route.
alter table public.notifications add column if not exists type text;
alter table public.notifications add column if not exists link text;

-- Extend create_notification with optional type + link, preserving existing 2/3-arg calls.
-- Drop the old signatures first so there's a single unambiguous overload.
drop function if exists public.create_notification(uuid, text);
drop function if exists public.create_notification(uuid, text, uuid);
create or replace function public.create_notification(
  p_recipient uuid,
  p_message   text,
  p_group_id  uuid default null,
  p_type      text default null,
  p_link      text default null
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

  if not (
    p_recipient = v_sender
    or is_admin()
    or exists (select 1 from profiles p where p.id = p_recipient and p.is_admin = true)
    or exists (
      select 1 from games g
      join game_players gp on gp.game_id = g.id
      where g.created_by = v_sender and gp.user_id = p_recipient
    )
    or exists (
      select 1 from group_members ga
      join group_members gm on gm.group_id = ga.group_id
      where ga.user_id = v_sender and ga.role = 'admin' and ga.status = 'active'
        and gm.user_id = p_recipient and gm.status = 'active'
    )
  ) then
    raise exception 'not allowed to notify this user';
  end if;

  insert into notifications (user_id, message, group_id, type, link)
  values (p_recipient, p_message, p_group_id, p_type, p_link);
end;
$function$;
grant execute on function public.create_notification(uuid, text, uuid, text, text) to authenticated;
