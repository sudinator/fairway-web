# Migrations run-ledger

Migrations are applied **by hand** in the Supabase SQL editor, in filename order. There is no
auto-tracking, so this file is the record: **tick a box after you run that migration.**

Regenerate after shipping (adds new files, keeps your ticks):
`python3 ci/gen-migrations-checklist.py`

Each release's DEPLOY_NOTES also flags any migration that must be run for that version.

Total: 85 migrations. Unchecked = not yet confirmed applied.

## Checklist (oldest → newest)

- [x] 0014_round_clock.sql
- [x] 0015_multiuse_group_invites.sql
- [x] 0016_trifecta.sql
- [x] 0017_notifications_lockdown.sql
- [x] 0018_live_scorecard.sql
- [x] 0019_avatars.sql
- [x] 0020_analytics.sql
- [x] 0021_live_teams_stats.sql
- [x] 0022_scorecard_ownership.sql
- [x] 0023_reset_game_scores.sql
- [x] 0024_trifecta_scoring.sql
- [x] 0025_group_roster.sql
- [x] 0026_post_game_rounds.sql
- [x] 0027_admin_group_oversight.sql
- [x] 0028_admin_support_session.sql
- [x] 0029_admin_delete_group.sql
- [x] 0030_default_group.sql
- [x] 0031_admin_game_repair.sql
- [x] 0032_admin_merge_users_groups.sql
- [x] 0033_lock_privileged_profile_columns.sql
- [x] 0034_enforce_ban_in_access.sql
- [x] 0035_stroke_basis.sql
- [x] 0036_skins_mode.sql
- [x] 0037_feedback.sql
- [x] 0038_auth_blocklist.sql
- [x] 0039_support_session_expiry.sql
- [x] 0040_score_validation.sql
- [x] 0041_live_stroke_trifecta.sql
- [x] 0042_score_audit.sql
- [x] 0043_round_game_unique.sql
- [x] 0044_post_game_rounds_fix.sql
- [x] 0045_post_group_rounds.sql
- [x] 0046_structure_stash.sql
- [x] 0047_live_avatar.sql
- [x] 0048_money.sql
- [x] 0049_expense_payers.sql
- [x] 0050_expense_audit.sql
- [x] 0051_group_activity.sql
- [x] 0052_group_pay_roster.sql
- [x] 0053_leg_config.sql
- [x] 0054_money_simplify.sql
- [x] 0055_zelle.sql
- [x] 0056_expense_source.sql
- [x] 0057_tee_times.sql
- [x] 0058_rounds_soft_delete.sql
- [x] 0059_game_players_bets.sql
- [x] 0060_tee_seq.sql
- [x] 0061_guest_sponsor_groups.sql
- [x] 0062_repair_column_defaults.sql
- [x] 0063_guest_per_expense_sponsor.sql
- [x] 0065_bet_guest_payers.sql
- [x] 0066_bet_guest_source_game.sql
- [x] 0067_save_hole_stats.sql
- [x] 0068_analytics_v2.sql
- [x] 0069_push_subscriptions.sql
- [x] 0070_push_events.sql
- [x] 0071_title_case_names.sql
- [x] 0072_profiles_readable_by_comembers.sql
- [x] 0073_push_events_more.sql
- [x] 0074_tee_reminders.sql
- [ ] 0075_tee_time_roles.sql
- [x] 0076_holes_unique.sql
- [x] 0077_holes_upsert.sql
- [x] 0078_admin_engagement.sql
- [x] 0079_achievements.sql
- [x] 0080_player_cards.sql
- [x] 0081_nudges.sql
- [ ] 0082_group_cards_live_rounds.sql
- [x] 0083_ops_autofinish_and_funnel.sql
- [x] 0084_admin_todos.sql
- [x] 0085_admin_list_users_real_rounds.sql
- [x] 0086_admin_group_overview_real_rounds.sql
- [x] 0087_admin_engagement_real_rounds.sql
- [x] 0088_power_users.sql
- [x] 0089_install_capture.sql
- [x] 0090_admin_stat_users.sql
- [x] 0091_admin_extra_stats.sql
- [ ] 0092_friction_ledger.sql
- [ ] 0093_flights_oneoff.sql
- [ ] 0094_clear_notifications.sql
- [ ] 0095_notifications_retention.sql
- [ ] 0096_analytics_eastern_day.sql
- [ ] 0097_power_users_eastern_day.sql
- [ ] 0098_group_cards_show_basics.sql
- [ ] 0099_admin_sandbaggers.sql
