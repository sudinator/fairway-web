-- 0003_games_allowance_pct.sql
-- Per-game handicap allowance percentage for team games (match / four-ball).
-- Default 100 (full handicap). Idempotent and safe to re-run.
-- Run in the Supabase SQL editor before/at the deploy that includes the
-- allowance setting. Existing games default to 100 (no behavior change).

alter table games add column if not exists allowance_pct numeric not null default 100;
