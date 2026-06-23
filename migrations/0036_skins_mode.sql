-- 0036: Split skins support.
-- Individual (field) skins can now be scored two ways:
--   carryover (default, existing) — a tied hole carries its skin to the next, or
--   split — each hole is its own 1-skin prize and ties share it evenly (no carry).
-- Null = carryover (back-compat for existing games).
alter table games add column if not exists skins_mode text;
