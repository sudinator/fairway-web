-- 0097_power_users_eastern_day.sql
-- Follow-up to 0096, closing out every remaining UTC calendar-day touchpoint in a LIVE function.
--
-- 1) get_power_users: its activity window and the "days since last active" / churn(>30d) flags
--    computed on the UTC day, out of step with the rest of analytics. Anchor to US Eastern.
--
-- 2) post_game_rounds / post_group_rounds: when recording a game's scores into rounds, the round's
--    played_at is taken from the game's match date (g.played_at) -- the golfer's own day, which is
--    correct and untouched. Only the FALLBACKS for a game with no played_at used the UTC day
--    (coalesce(..., g.created_at::date, current_date)). Anchoring the function to Eastern makes
--    that rare fallback resolve to the ET day instead of UTC. Primary path is unchanged.
--
-- All via ALTER FUNCTION ... SET timezone (no body rewrite). Rolling now()-interval windows stay
-- absolute. After this, no live function decides a calendar day in UTC (the only remaining
-- current_date is a cosmetic 2-digit-year fallback in the tee-code trigger, 0060 -- negligible).
alter function public.get_power_users(integer)          set timezone = 'America/New_York';
alter function public.post_game_rounds(uuid)            set timezone = 'America/New_York';
alter function public.post_group_rounds(uuid, integer)  set timezone = 'America/New_York';
