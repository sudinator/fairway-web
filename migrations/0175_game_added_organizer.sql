-- 0175_game_added_organizer.sql
--
-- Everyone in a game gets the "you're in" notification — the organizer included.
--
-- 0070 skipped the organizer (it was their own action) and 0165/0174 kept that. The owner's view:
-- the organizer is a player too, and receiving the same notification as everyone else is how they
-- know it went out. Same link (/?game=<code>), same detail line; only the opening words differ,
-- because "Amit added you" is nonsense to Amit: the organizer reads
--   You set up "Saturday Fourball". Tap to open the game.
--
-- AUTHORIZATION: trigger function, SECURITY DEFINER, no grants to app roles — as 0070/0165/0174.
-- Idempotent; safe to re-run.

begin;

create or replace function public.notify_game_added() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare g record; v_self boolean;
begin
  if new.user_id is null then return new; end if;
  select id, name, course, game_type, code, created_by, group_id, created_at into g from games where id = new.game_id;
  if g.id is null then return new; end if;
  v_self := g.created_by is not null and new.user_id = g.created_by;
  insert into notifications (user_id, message, group_id, type, link, detail)
  values (new.user_id,
          case when v_self
               then 'You set up "' || coalesce(g.name, 'a game') || '". Tap to open the game.'
               else public.person_label(g.created_by) || ' added you to "' || coalesce(g.name, 'a game') || '". Tap to open the game.' end,
          g.group_id, 'game_added',
          case when g.code is not null then '/?game=' || g.code else '/?tab=games' end,
          coalesce(g.course, '') ||
          case when g.course is not null then ' · ' else '' end ||
          'set up ' || to_char(g.created_at at time zone 'America/New_York', 'Dy Mon FMDD') ||
          ' · ' || replace(coalesce(g.game_type, 'game'), '_', ' ') ||
          case when g.code is not null then ' · code ' || g.code else '' end ||
          case when new.tee_name is not null then ' · you play the ' || new.tee_name || ' tees' else '' end ||
          case when new.course_handicap is not null then ' (CH ' || new.course_handicap || ')' else '' end);
  return new;
end $fn$;

select public.record_migration('0175_game_added_organizer');

commit;
