## 178.25.260830 — no migration
CI-only production migration-parity URL hardening. 0140/0141 are unchanged.

> **178.18.260829:** No migration. Environment-contract documentation only; database contract unchanged.

> **178.17.260829:** No migration. React hook-order correction and source guard only; database contract unchanged.
> **178.16.260829:** No migration. TypeScript-only correction to the Alternate Shot individual-card exclusion; database contract unchanged.

> **178.15.260829:** No migration. Release infrastructure now mechanically verifies the live staging/Production `schema_migrations` ledgers against the committed migration chain and fails if this checklist is stale.
> **178.14.260829:** No migration. Alternate Shot team-card/side-game presentation correction only.
> **178.13.260829:** No migration. CI assertion-baseline/documentation-only correction; Alternate Shot scoring code is unchanged from 178.12.

# Migrations run-ledger

Migrations are applied **by hand** in the Supabase SQL editor, in filename order. From migration 0113 onward, `public.schema_migrations` is the database source of truth; this file remains the human checklist and release notes.

Regenerate after shipping (adds new files, keeps ticks and the notes block):
`python3 ci/gen-migrations-checklist.py`

Confirm database-applied state with:
`select id, applied_at from public.schema_migrations order by id;`

Total: 128 migrations. Unchecked = not yet confirmed applied in this checklist.

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
- [x] 0075_tee_time_roles.sql
- [x] 0076_holes_unique.sql
- [x] 0077_holes_upsert.sql
- [x] 0078_admin_engagement.sql
- [x] 0079_achievements.sql
- [x] 0080_player_cards.sql
- [x] 0081_nudges.sql
- [x] 0082_group_cards_live_rounds.sql
- [x] 0083_ops_autofinish_and_funnel.sql
- [x] 0084_admin_todos.sql
- [x] 0085_admin_list_users_real_rounds.sql
- [x] 0086_admin_group_overview_real_rounds.sql
- [x] 0087_admin_engagement_real_rounds.sql
- [x] 0088_power_users.sql
- [x] 0089_install_capture.sql
- [x] 0090_admin_stat_users.sql
- [x] 0091_admin_extra_stats.sql
- [x] 0092_friction_ledger.sql
- [x] 0093_flights_oneoff.sql
- [x] 0094_clear_notifications.sql
- [x] 0095_notifications_retention.sql
- [x] 0096_analytics_eastern_day.sql
- [x] 0097_power_users_eastern_day.sql
- [x] 0098_group_cards_show_basics.sql
- [x] 0099_admin_sandbaggers.sql
- [x] 0100_admin_sandbaggers_club.sql
- [x] 0101_admin_sandbaggers_system_only.sql
- [x] 0102_owner_system_admins.sql
- [x] 0103_game_autocomplete.sql
- [x] 0104_admin_stale_games.sql
- [x] 0105_admin_delete_stale_game.sql
- [x] 0106_test_groups.sql
- [x] 0107_admin_wipe_group.sql
- [x] 0108_admin_stat_users_avatars.sql
- [x] 0109_play_date_when_scored.sql
- [x] 0110_games_always_scored_date.sql
- [x] 0111_money_audit.sql
- [x] 0112_events.sql
- [x] 0113_migration_ledger.sql
- [x] 0114_settlement_events.sql
- [x] 0115_settlement_frozen_event.sql
- [x] 0116_money_permissions.sql
- [x] 0117_settlement_dedup.sql
- [x] 0118_settlement_allocations.sql
- [x] 0119_expenses_soft_delete.sql
- [x] 0120_teetimes_realtime.sql
- [x] 0121_money_clean_slate.sql
- [x] 0122_side_contests.sql
- [x] 0123_api_hardening.sql
- [x] 0124_course_freshness.sql
- [x] 0125_course_freshness_authorization.sql
- [x] 0126_course_freshness_use_canonical_auth.sql
- [x] 0127_system_function_lockdown.sql
- [x] 0128_rate_limit.sql
- [x] 0130_workflow_atomicity.sql
- [x] 0131_workflow_retry_and_review_atomicity.sql
- [x] 0132_course_schema_reconciliation_and_privilege_hardening.sql
- [x] 0133_testing_and_money_atomicity.sql
- [x] 0134_fix_bet_rpc_ambiguous_id.sql
- [x] 0135_ledger_backfill.sql
- [x] 0136_core_rls_helpers.sql
- [x] 0137_core_rls_baseline.sql
- [x] 0138_change_game_course_before_scoring.sql
- [x] 0139_nine_hole_round_basis.sql
- [x] 0140_alt_shot_side_scores.sql
- [x] 0141_alt_shot_clear_tombstones.sql
- [x] 0142_team_competitions.sql
- [x] 0143_competition_schedule_contract.sql

<!-- NOTES:START -->

- **0064 — intentionally documented numbering gap.** No `0064_*.sql` migration exists in the repository history. Do not invent or apply a synthetic 0064 migration; the sequence continues from 0063 to 0065.

- 0122_side_contests.sql — side contests (CTP/long drive/straightest): game_contests + append-only game_contest_entries + RLS (participant read; writes via SECURITY DEFINER RPCs) + can_see_game/is_game_organizer/create|update|delete_game_contest/log_contest_entry/void_contest_entry. Run after 0121.

- 0123_api_hardening.sql — DB-backed AI usage caps (ai_usage_daily/global + bump_ai_usage) for the now-authenticated /api/analyze-round; revoke record_migration from authenticated. Run after 0122.

- 0124_course_freshness.sql — course_freshness cache + record_course_freshness RPC (daily API freshness check, admin flag). Run after 0123.

- 0125_course_freshness_authorization.sql — authorization fixes for the 0124 RPCs + status CHECK (external security review). Run after 0124. REQUIRED with v176.30+ (client calls the new signature).

- 0126_course_freshness_use_canonical_auth.sql — switches the freshness RPCs to is_group_member/is_group_admin (enforces active + non-banned; fixes removed-member bypass) + status-filters the notification query. Run after 0125. REQUIRED (supersedes 0125 function bodies; same signatures, no client change).

- 0127_system_function_lockdown.sql — admin-gates + input-validates expire_support_sessions; revokes app-role EXECUTE on the pg_cron reapers (purge_old_notifications, send_tee_reminders); tightens finish_stale_rounds/sweep_friction grants. Run after 0126.
- 0128_rate_limit.sql — generic per-user rate limiter (api_rate_limits + bump_rate_limit RPC, RLS-locked); wires /api/courses to 120 lookups/hour/user. Run after 0127.

- **0129 — intentionally skipped/reserved.** There is no `0129_workflow_atomicity.sql` in v177.13. Do not create or apply a 0129 migration for this release. The workflow hardening sequence begins at 0130 to avoid collision with a separately-used production 0129 identifier.

- [x] **0130_workflow_atomicity.sql** — atomic Money/game/group/course workflows + collision-safe tee-time RSVP order. REQUIRED before v177.13.
- [x] **0131_workflow_retry_and_review_atomicity.sql** — retry-safe course corrections + atomic admin review. REQUIRED after 0130.
- [x] **0132_course_schema_reconciliation_and_privilege_hardening.sql** — reconciles course-correction schema, ensures the override upsert key, preserves member-readable SELECT policies, and removes direct browser-role mutation privileges. REQUIRED after 0131.

- [ ] **0133_testing_and_money_atomicity.sql** — v177.14 reliability migration. Ensures `group_courses(group_id, course_id)` has the unique conflict key required by course-correction RPCs; aborts clearly instead of silently deduping if historical duplicates exist. Adds organizer/admin-gated atomic TGC bet post/re-post/un-post RPCs. Its original `save_bet_expense_atomic` body has a runtime ambiguity fixed by 0134; always apply 0134 after 0133. REQUIRED before v177.14.
- [ ] **0134_fix_bet_rpc_ambiguous_id.sql** — staging-proven runtime correction for `save_bet_expense_atomic`; qualifies table `id`/`created_at` references that collide with `RETURNS TABLE(id, created_at)` PL/pgSQL output variables. No schema/data changes. REQUIRED before v177.15.
<!-- NOTES:END -->
