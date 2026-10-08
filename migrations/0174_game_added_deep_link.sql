-- 0174_game_added_deep_link.sql
--
-- The "added to a game" notification opens THE GAME, not the Games tab.
--
-- 0165 gave the notification its specifics (organizer, course, format, code, tees) but kept the
-- 0070 link '/?tab=games', so tapping it landed on the list and the player typed the code. 201.1
-- adds a game deep link, /?game=<code>, which the app resolves to the game room for a player or club
-- member; the notification now carries it, and its message says so. Recipients unchanged
-- (every player added except the organizer).
--
-- AUTHORIZATION: trigger function, SECURITY DEFINER, no grants to app roles — as 0070/0165.
-- Idempotent; safe to re-run.

begin;

create or replace function public.notify_game_added() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare g record;
begin
  if new.user_id is null then return new; end if;
  select id, name, course, game_type, code, created_by, group_id, created_at into g from games where id = new.game_id;
  if g.id is null then return new; end if;
  if g.created_by is not null and new.user_id = g.created_by then return new; end if;
  insert into notifications (user_id, message, group_id, type, link, detail)
  values (new.user_id,
          public.person_label(g.created_by) || ' added you to "' || coalesce(g.name, 'a game') || '". Tap to open the game.',
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

select public.record_migration('0174_game_added_deep_link');

commit;
