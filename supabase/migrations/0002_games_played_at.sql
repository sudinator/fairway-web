-- 0002_games_played_at.sql
-- Adds a structured match date to games, mirroring rounds.played_at
-- (date NOT NULL default current_date). Idempotent and safe to re-run.
--
-- Run this in the Supabase SQL editor BEFORE (or at) deploy. Until the column
-- exists, the app's played_at write would silently no-op.

-- 1) Add the column nullable so existing rows aren't forced to a default yet.
alter table games add column if not exists played_at date;

-- 2) Backfill existing games from their creation date (only fills blanks, so
--    re-running never clobbers real values).
update games set played_at = created_at::date where played_at is null and created_at is not null;
update games set played_at = current_date where played_at is null;

-- 3) Match the rounds.played_at convention: default today, not null.
alter table games alter column played_at set default current_date;
alter table games alter column played_at set not null;
