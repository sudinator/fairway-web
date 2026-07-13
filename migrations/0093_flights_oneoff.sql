-- 0093_flights_oneoff.sql
-- Stage 1 of Flights: per-event ("one-off") handicap-band divisions. Purely additive — no
-- existing game, team, foursome or pairing is affected, and flight_mode defaults to off.
--   games.flight_mode : 'off' | 'oneoff' | 'league'   (league arrives with season flights, Stage 2)
--   games.flights      : jsonb array of band defs [{key,name,hi}]  (hi = inclusive upper index, null = open top)
--   game_players.flight: the player's assigned band key (null = unassigned / no index)
alter table public.games        add column if not exists flight_mode text;
alter table public.games        add column if not exists flights     jsonb;
alter table public.game_players add column if not exists flight       text;
