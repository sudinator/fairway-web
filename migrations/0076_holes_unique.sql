-- 0076_holes_unique.sql
-- Enforce one row per (round_id, hole_number). Without this, two concurrent/duplicate
-- posts of the same round could each insert a full set of holes, doubling every total
-- and stat (gross, net, Stableford, scoring buckets) and showing each hole twice.
-- Safe to add when no duplicates exist (the dedup check returns no rows). Run before 0077,
-- which relies on this index for its ON CONFLICT (round_id, hole_number) upsert.
create unique index if not exists holes_round_hole_uk
  on public.holes (round_id, hole_number);
