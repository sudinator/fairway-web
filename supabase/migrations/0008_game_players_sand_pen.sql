-- 0008_game_players_sand_pen.sql
-- Per-hole penalties and greenside-bunker (sand) tracking for GAME players,
-- so match/four-ball/stableford/skins track the same Sand/Pen data as solo
-- rounds. Arrays align to holes_meta, like scores/putts/fairways.
-- Idempotent and safe to re-run.

alter table game_players add column if not exists penalties jsonb not null default '[]'::jsonb;
alter table game_players add column if not exists sand jsonb not null default '[]'::jsonb;
