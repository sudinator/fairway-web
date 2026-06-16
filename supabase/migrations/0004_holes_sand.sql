-- 0004_holes_sand.sql
-- Per-hole greenside-bunker flag, for tracking sand-save %.
-- Default false. Idempotent and safe to re-run.

alter table holes add column if not exists sand boolean not null default false;
