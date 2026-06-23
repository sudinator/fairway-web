-- 0035: Stroke play support.
-- Adds the basis (gross | net) for the new "stroke" game_type. Null for all
-- other formats. Additive and safe to re-run.
alter table games add column if not exists stroke_basis text;
