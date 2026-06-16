-- 0005_holes_yardage.sql
-- Per-hole yardage for the played tee (solo rounds). Games carry yardage in
-- their holes_meta JSON, so no column is needed there.
-- Nullable; existing rows and manually-entered courses simply have no yardage.
-- Idempotent and safe to re-run.

alter table holes add column if not exists yardage integer;
