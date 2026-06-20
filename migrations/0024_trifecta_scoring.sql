-- 0024_trifecta_scoring.sql
-- Trifecta can now be scored two ways: per-hole (1 point per hole in each of the
-- 3 matches, the original behaviour) or Ryder-Cup "match" scoring (each of the 3
-- matches in a foursome is worth 1 point over 18, ½ each if halved). Existing
-- games default to per-hole so nothing changes underneath them.

alter table games add column if not exists trifecta_scoring text default 'per_hole';
