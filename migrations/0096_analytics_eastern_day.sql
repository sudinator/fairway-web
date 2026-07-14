-- 0096_analytics_eastern_day.sql
-- Anchor the analytics "day" to US Eastern (America/New_York) for everyone, so a new day starts
-- at midnight ET regardless of the viewer's or the user's device timezone. This fixes the
-- discrepancy where the top DAU tile (server UTC day) and the Daily report (browser-local day)
-- counted two different 24-hour windows.
--
-- Mechanism: set the `timezone` config ON each function. Inside a function with this SET clause,
-- `current_date` / `now()::date` evaluate in Eastern, so every calendar-day comparison (daily_active
-- opens, the DAU/WAU/MAU windows, the activity sparkline, the drill-down "today") uses the Eastern
-- day. Rolling windows written as `now() - interval 'N days'` are absolute instants and are NOT
-- affected — they stay true rolling windows. No function body is rewritten.
--
-- mark_active writes daily_active.day with `current_date`; with the Eastern tz it now stamps the
-- Eastern calendar day. FORWARD-ONLY: rows already stamped in UTC cannot be perfectly reclassified
-- (daily_active stores a date, not a timestamp — the intra-day time is gone), so only opens from
-- this migration forward are Eastern-accurate. Historical days are within ~1 of the Eastern day.

alter function public.mark_active(boolean)               set timezone = 'America/New_York';
alter function public.get_admin_analytics()              set timezone = 'America/New_York';
alter function public.admin_stat_users(text, text, date) set timezone = 'America/New_York';
alter function public.get_admin_engagement()             set timezone = 'America/New_York';
