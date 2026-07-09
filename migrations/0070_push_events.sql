-- 0070_push_events.sql
-- Create notification rows for the key events, so the phase-2 webhook can push them.
-- These run as triggers (SECURITY DEFINER, owner privileges) so they insert regardless
-- of who performed the action and without the create_notification relationship checks.
-- The webhook + each user's per-type preference decide whether a row is actually pushed.

-- 1) Added to a game — fires once per player row at game creation / when added later.
create or replace function public.notify_game_added() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare creator uuid; grp uuid;
begin
  if new.user_id is null then return new; end if;                -- guests have no account
  select created_by, group_id into creator, grp from games where id = new.game_id;
  if creator is not null and new.user_id = creator then return new; end if;  -- don't ping the organizer about themselves
  insert into notifications (user_id, message, group_id, type, link)
  values (new.user_id, 'You''ve been added to a new game.', grp, 'game_added', '/?tab=games');
  return new;
end $fn$;
drop trigger if exists trg_notify_game_added on public.game_players;
create trigger trg_notify_game_added after insert on public.game_players
  for each row execute function public.notify_game_added();

-- 2) You owe money — fires when an expense share lands against a real user who isn't the
--    payer. De-duped to at most one per user+group per 6h so bet re-posts don't spam.
create or replace function public.notify_money_owed() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare payer uuid; grp uuid;
begin
  if new.user_id is null then return new; end if;               -- guest share
  if new.share_cents <= 0 then return new; end if;
  select payer_user_id, group_id into payer, grp from expenses where id = new.expense_id;
  if payer is not null and new.user_id = payer then return new; end if;   -- the payer isn't owing themselves
  if exists (
    select 1 from notifications n
    where n.user_id = new.user_id and n.type = 'money_owed'
      and n.group_id is not distinct from grp
      and n.created_at > now() - interval '6 hours'
  ) then return new; end if;                                     -- already told them recently
  insert into notifications (user_id, message, group_id, type, link)
  values (new.user_id,
          'New charge: you owe $' || to_char(new.share_cents / 100.0, 'FM999990.00') || '. Tap to open Money.',
          grp, 'money_owed', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg_notify_money_owed on public.expense_shares;
create trigger trg_notify_money_owed after insert on public.expense_shares
  for each row execute function public.notify_money_owed();

-- 3) You got paid — fires when a settlement is recorded; notifies the payee.
create or replace function public.notify_money_paid() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.to_user_id is null then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  values (new.to_user_id,
          'You''ve been paid $' || to_char(new.amount_cents / 100.0, 'FM999990.00') || '.',
          new.group_id, 'money_paid', '/?tab=money');
  return new;
end $fn$;
drop trigger if exists trg_notify_money_paid on public.settlements;
create trigger trg_notify_money_paid after insert on public.settlements
  for each row execute function public.notify_money_paid();
