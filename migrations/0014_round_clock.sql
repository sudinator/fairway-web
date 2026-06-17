-- 0014: Round clock (pace of play). Two timestamps per player drive a per-group
-- elapsed timer. No new RLS needed: the same row policies that let a player /
-- marker / organizer write scores also let them write these columns.
alter table public.game_players add column if not exists clock_start timestamptz;
alter table public.game_players add column if not exists clock_end   timestamptz;
-- clock_start: set the first time the player's group enters any score.
-- clock_end:   set when the player's last hole is scored, or when the game ends.
