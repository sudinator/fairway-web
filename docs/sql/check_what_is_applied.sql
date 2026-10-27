-- check_what_is_applied.sql — which recent migrations (0185 onward, 0185–0222) a database has recorded.
-- Run in the Supabase SQL editor (read-only). "missing" rows must be applied, in number order, before the matching release.
-- Regenerate when a migration is added (212.36 recreated it: the copy referred to in the handoff was not in the package).
with expected(id) as (values
  ('0185_course_freshness_followups'),
  ('0186_course_versions'),
  ('0187_course_status_view'),
  ('0188_game_recap_announce'),
  ('0189_account_signup_approval'),
  ('0190_account_merge_remove'),
  ('0191_season_wrapped_active_only'),
  ('0192_course_selective_apply'),
  ('0193_round_summary_email'),
  ('0194_guest_scoring_by_group'),
  ('0195_club_reports'),
  ('0196_account_merge_guards'),
  ('0197_active_accounts_and_course_baseline'),
  ('0198_email_and_announcement_hardening'),
  ('0199_club_requests'),
  ('0200_support_visit_notice'),
  ('0201_club_notification_links'),
  ('0202_admin_reads_clubs'),
  ('0203_scramble'),
  ('0204_live_scramble'),
  ('0205_anon_boundary'),
  ('0206_member_privileges'),
  ('0207_policy_review_fixes'),
  ('0208_player_cards_server_only'),
  ('0209_scramble_team_handicap'),
  ('0210_scramble_handicap_methods'),
  ('0211_scramble_lineup_live'),
  ('0212_cup_scramble'),
  ('0213_team_rounds'),
  ('0214_security_contract_state'),
  ('0215_course_field_averages'),
  ('0216_retire_hand_made_functions'),
  ('0217_log_retention'),
  ('0218_live_skins_mode'),
  ('0219_create_game_complete'),
  ('0220_draft_games_private'),
  ('0221_group_changes_after_scores'),
  ('0222_setup_locks_at_server')
)
select e.id, case when m.id is null then 'missing' else 'applied' end as status
from expected e left join public.schema_migrations m on m.id = e.id
order by e.id;
