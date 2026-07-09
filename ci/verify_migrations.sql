-- BNN migration audit — one sentinel object per migration (source of truth: migrations/*.sql).
-- present=false  => that migration is (likely) NOT applied to this database. Open that file and apply it.
with checks(migration, kind, a, b, human) as (values
  ('0014_round_clock.sql','column','game_players','clock_start','column game_players.clock_start'),
  ('0015_multiuse_group_invites.sql','function','create_group_invite_multi','','function create_group_invite_multi()'),
  ('0016_trifecta.sql','column','games','team_score_mode','column games.team_score_mode'),
  ('0017_notifications_lockdown.sql','function','create_notification','','function create_notification()'),
  ('0018_live_scorecard.sql','function','games_stamp_ended_at','','function games_stamp_ended_at()'),
  ('0019_avatars.sql','function','set_my_avatar','','function set_my_avatar()'),
  ('0020_analytics.sql','table','daily_active','','table daily_active'),
  ('0021_live_teams_stats.sql','function','get_live_scorecard','','function get_live_scorecard()'),
  ('0022_scorecard_ownership.sql','function','save_hole_scores','','function save_hole_scores()'),
  ('0023_reset_game_scores.sql','function','reset_game_scores','','function reset_game_scores()'),
  ('0024_trifecta_scoring.sql','column','games','trifecta_scoring','column games.trifecta_scoring'),
  ('0025_group_roster.sql','function','group_roster','','function group_roster()'),
  ('0026_post_game_rounds.sql','function','post_game_rounds','','function post_game_rounds()'),
  ('0027_admin_group_oversight.sql','function','admin_group_overview','','function admin_group_overview()'),
  ('0028_admin_support_session.sql','function','admin_enter_group','','function admin_enter_group()'),
  ('0029_admin_delete_group.sql','function','admin_delete_group','','function admin_delete_group()'),
  ('0030_default_group.sql','function','admin_set_default_group','','function admin_set_default_group()'),
  ('0031_admin_game_repair.sql','function','admin_end_game','','function admin_end_game()'),
  ('0032_admin_merge_users_groups.sql','function','admin_merge_group','','function admin_merge_group()'),
  ('0033_lock_privileged_profile_columns.sql','function','guard_profile_privileged_cols','','function guard_profile_privileged_cols()'),
  ('0034_enforce_ban_in_access.sql','function','is_admin','','function is_admin()'),
  ('0035_stroke_basis.sql','column','games','stroke_basis','column games.stroke_basis'),
  ('0036_skins_mode.sql','column','games','skins_mode','column games.skins_mode'),
  ('0037_feedback.sql','table','feedback','','table feedback'),
  ('0038_auth_blocklist.sql','table','banned_emails','','table banned_emails'),
  ('0039_support_session_expiry.sql','function','expire_support_sessions','','function expire_support_sessions()'),
  ('0040_score_validation.sql','function','_valid_num_array','','function _valid_num_array()'),
  ('0041_live_stroke_trifecta.sql','function','get_live_scorecard','','function get_live_scorecard()'),
  ('0042_score_audit.sql','table','score_audit','','table score_audit'),
  ('0043_round_game_unique.sql','index','rounds_game_user_uniq','','index rounds_game_user_uniq'),
  ('0044_post_game_rounds_fix.sql','function','post_game_rounds','','function post_game_rounds()'),
  ('0045_post_group_rounds.sql','function','post_group_rounds','','function post_group_rounds()'),
  ('0046_structure_stash.sql','column','games','structure_stash','column games.structure_stash'),
  ('0047_live_avatar.sql','function','get_live_scorecard','','function get_live_scorecard()'),
  ('0048_money.sql','table','group_guests','','table group_guests'),
  ('0049_expense_payers.sql','table','expense_payers','','table expense_payers'),
  ('0050_expense_audit.sql','table','expense_audit','','table expense_audit'),
  ('0051_group_activity.sql','table','group_activity','','table group_activity'),
  ('0052_group_pay_roster.sql','function','group_pay_roster','','function group_pay_roster()'),
  ('0053_leg_config.sql','column','games','leg_config','column games.leg_config'),
  ('0054_money_simplify.sql','column','groups','money_simplify','column groups.money_simplify'),
  ('0055_zelle.sql','function','group_pay_roster','','function group_pay_roster()'),
  ('0056_expense_source.sql','column','expenses','source_game_id','column expenses.source_game_id'),
  ('0057_tee_times.sql','table','tee_times','','table tee_times'),
  ('0058_rounds_soft_delete.sql','column','rounds','deleted_at','column rounds.deleted_at'),
  ('0059_game_players_bets.sql','function','set_player_bets','','function set_player_bets()'),
  ('0060_tee_seq.sql','function','assign_tee_seq','','function assign_tee_seq()'),
  ('0061_guest_sponsor_groups.sql','function','set_tee_groups','','function set_tee_groups()'),
  ('0062_repair_column_defaults.sql','has_default','group_invites','multi','default on group_invites.multi'),
  ('0063_guest_per_expense_sponsor.sql','column','expense_shares','sponsor_user_id','column expense_shares.sponsor_user_id'),
  ('0065_bet_guest_payers.sql','column','expense_payers','guest_id','column expense_payers.guest_id'),
  ('0066_bet_guest_source_game.sql','column','group_guests','source_game_id','column group_guests.source_game_id'),
  ('0067_save_hole_stats.sql','function','save_hole_stats','','function save_hole_stats()'),
  ('0068_analytics_v2.sql','function','mark_active','','function mark_active()'),
  ('0069_push_subscriptions.sql','table','push_subscriptions','','table push_subscriptions'),
  ('0070_push_events.sql','function','notify_game_added','','function notify_game_added()'),
  ('0071_title_case_names.sql','function','bnn_title_case','','function bnn_title_case()'),
  ('0072_profiles_readable_by_comembers.sql','function','shares_active_club','','function shares_active_club()'),
  ('0073_push_events_more.sql','function','notify_tee_new','','function notify_tee_new()'),
  ('0074_tee_reminders.sql','function','send_tee_reminders','','function send_tee_reminders()'),
  ('0075_tee_time_roles.sql','function','set_tee_time_captain','','function set_tee_time_captain()'),
  ('0076_holes_unique.sql','index','holes_round_hole_uk','','index holes_round_hole_uk'),
  ('0077_holes_upsert.sql','function','post_game_rounds','','function post_game_rounds()')
)
select migration, human as expected_object,
  case kind
    when 'table'      then (to_regclass('public.'||a) is not null)
    when 'function'   then exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=a)
    when 'column'     then exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=a and c.column_name=b)
    when 'has_default'then exists (select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=a and c.column_name=b and c.column_default is not null)
    when 'policy'     then exists (select 1 from pg_policies pol where pol.schemaname='public' and pol.tablename=a and pol.policyname=b)
    when 'trigger'    then exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname=a)
    when 'index'      then exists (select 1 from pg_indexes i where i.schemaname='public' and i.indexname=a)
    else null
  end as present
from checks order by migration;
