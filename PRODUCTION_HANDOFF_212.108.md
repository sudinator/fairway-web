# 212.101 → 212.108 production handoff

Current status: source candidate; native CI/staging/database checks are required before merge. Production is reported by the owner as 212.101; no deployed checkout or production ledger was read here.

1. Use the cumulative 212.108 ZIP on staging through the established GitHub Desktop workflow. Confirm the native GitHub/Supabase checks pass and Vercel staging is Ready. Apply only migrations missing from the staging ledger, in order, then check the approved filters, partner rates, penalty confirm/retry/remove, ordinary round/game viewing and existing recovery behavior.
2. Before promoting, run the existing read-only docs/sql/check_what_is_applied.sql on production and review all missing rows. It now includes 0233–0236. Also review the existing docs/sql/data_profile.sql result, as required for statistics changes. These queries change nothing. Do not infer SQL state from the app version.
3. For production, prepare only the missing SQL scripts in numeric order. Relative to the 212.101 code baseline, the new candidates are 0234_daily_stale_games.sql, 0235_analytics_quality.sql and 0236_confirmed_penalty_tracking.sql. All are inside migrations/ in the ZIP. Preserve the staged/proven SQL bytes; do not rerun already-applied migrations.
4. After the required database and staging checks, open staging → main. Confirm the required verify check passes, then merge. Confirm Vercel Production reports Ready before calling it deployed.
5. Run a small non-destructive production smoke check: Help/version, Home navigation, existing round/game viewing, Summary filter apply/clear and update/diagnostics visibility. Use staging for destructive/integration scenarios. Do not create/delete production fixture rounds or games.

## What production receives

- 212.102: Organizer tee dropdown and save use the same validated source; actionable failure instead of silent no-op.
- 212.103: Existing yellow recovery panel consolidated, retaining Resume and round-management actions without duplicate banners.
- 212.104: Daily 4 a.m. Eastern maintenance. Eligible empty games delete seven days after the later of creation/game date; complete cards finalize after inactivity; inactive partials notify the organizer. Existing preservation and Test-club rules remain.
- 212.105–106: Fresh-database permission tests corrected, with scheduler operations using supported cron APIs.
- 212.107: Analytics accuracy, coverage, comparisons, admin populations, mature cohorts, lifecycle history and observed feature use.
- 212.108: Approved filter icon/popup, qualified partnership rate, evidence floors and explicit penalty tracking.

## Migration purpose

| Migration | Purpose |
|---|---|
| 0234 | Existing maintenance process made reliable and scheduled, with clocks and run history |
| 0235 | Correct admin reporting, lifecycle provenance and observed feature actions |
| 0236 | Explicit own-round penalty confirmation and invalidation after relevant edits |

Historical penalty zeros are not automatically certified. Existing falsely inferred penalty-free awards reconcile through the current server refresh process. New lifecycle/feature history cannot reconstruct earlier deletions/clicks. Native results and Production Ready are pending external evidence; local verification alone does not authorize a production-ready claim.
