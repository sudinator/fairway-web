-- 0073_push_events_more.sql
-- Four more event notifications (fan-out via SECURITY DEFINER triggers, like 0070).
-- Defaults (client + route DEFAULT_DELIVERY) are in-app for all four, so they only
-- buzz a phone if the user opts that type up to Push.

-- 1) New tee time posted -> notify all active club members except the creator.
create or replace function public.notify_tee_new() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, 'New tee time posted — tap to RSVP.', new.group_id, 'tee_new', '/?tt=' || new.id::text
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.created_by;
  return new;
end $fn$;
drop trigger if exists trg_notify_tee_new on public.tee_times;
create trigger trg_notify_tee_new after insert on public.tee_times
  for each row execute function public.notify_tee_new();

-- 2) A bet was posted -> notify the game's players (not the poster). De-duped per
--    user+club per 6h so bet re-posts (delete+reinsert) don't spam.
create or replace function public.notify_bet_posted() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.source_kind is distinct from 'tgc_bet' or new.source_game_id is null then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  select gp.user_id, 'A bet was posted in your game — see the Money tab.', new.group_id, 'bet_posted', '/?tab=money'
  from game_players gp
  where gp.game_id = new.source_game_id and gp.user_id is not null
    and gp.user_id is distinct from new.created_by
    and not exists (
      select 1 from notifications n
      where n.user_id = gp.user_id and n.type = 'bet_posted'
        and n.group_id is not distinct from new.group_id
        and n.created_at > now() - interval '6 hours'
    );
  return new;
end $fn$;
drop trigger if exists trg_notify_bet_posted on public.expenses;
create trigger trg_notify_bet_posted after insert on public.expenses
  for each row execute function public.notify_bet_posted();

-- 3) Game finished -> notify the game's players when status flips to 'ended'.
create or replace function public.notify_game_finished() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  if new.status is distinct from 'ended' or old.status is not distinct from 'ended' then return new; end if;
  insert into notifications (user_id, message, group_id, type, link)
  select gp.user_id, 'Your game is final — see the results.', new.group_id, 'game_finished', '/?tab=games'
  from game_players gp
  where gp.game_id = new.id and gp.user_id is not null;
  return new;
end $fn$;
drop trigger if exists trg_notify_game_finished on public.games;
create trigger trg_notify_game_finished after update on public.games
  for each row execute function public.notify_game_finished();

-- 4) New member joins a club -> notify the OTHER active members. Fires when a row
--    becomes active (insert active, or invited->active), not on the club's first member.
create or replace function public.notify_group_member() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare nm text; cn text;
begin
  if new.user_id is null or new.status is distinct from 'active' then return new; end if;
  if tg_op = 'UPDATE' and old.status is not distinct from 'active' then return new; end if;
  select coalesce(nullif(display_name, ''), 'A new golfer') into nm from profiles where id = new.user_id;
  select name into cn from groups where id = new.group_id;
  insert into notifications (user_id, message, group_id, type, link)
  select gm.user_id, coalesce(nm, 'A new golfer') || ' joined ' || coalesce(cn, 'your club') || '.', new.group_id, 'group_member', '/?tab=groups'
  from group_members gm
  where gm.group_id = new.group_id and gm.status = 'active' and gm.user_id is not null
    and gm.user_id is distinct from new.user_id;
  return new;
end $fn$;
drop trigger if exists trg_notify_group_member on public.group_members;
create trigger trg_notify_group_member after insert or update on public.group_members
  for each row execute function public.notify_group_member();
