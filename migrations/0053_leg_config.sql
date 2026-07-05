-- 0053_leg_config.sql — organizer config for the "Group results: legs & team points" layer.
-- Idempotent. Stores { scheme, metric, points: { legKey: number } } for team formats.
alter table public.games add column if not exists leg_config jsonb;
