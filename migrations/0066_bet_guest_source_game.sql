-- 0066_bet_guest_source_game.sql
-- Tag guest records that were auto-created for a posted bet with the game they came
-- from. This makes them a per-game/per-appearance throwaway identity (guest + game,
-- which encodes sponsor + date) rather than a reusable Money guest: they're keyed per
-- game (re-posting the same game reuses the record) and are hidden from the deliberate
-- add-a-guest picker and the Retire list. Deliberate Money guests keep source_game_id null.
alter table public.group_guests
  add column if not exists source_game_id uuid references public.games(id) on delete set null;
