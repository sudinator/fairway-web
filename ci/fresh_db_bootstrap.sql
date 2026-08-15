-- Birdie Num Num fresh-database prerequisites.
--
-- These extensions are required before the numbered migration stream can run
-- from an empty Supabase/Postgres environment. Keep this file intentionally
-- small: extensions that are first declared inside their own numbered migration
-- (for example pg_cron in 0074) do not belong here unless an earlier migration
-- begins depending on them.

create extension if not exists citext;
