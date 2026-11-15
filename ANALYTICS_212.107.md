# Analytics cleanup — 212.107.261114

Baseline: user-confirmed green GitHub CI for 212.106. This candidate extends the existing Dashboard, Insights, personal bests and admin panels. It does not introduce a second analytics dashboard.

## Delivered changes and intentional differences

| Area | Before | Now |
|---|---|---|
| Club-report net awards | Missing handicap could become scratch | Existing null-aware statistical handicap helper; gross remains available, unknown net excluded |
| Round putting / three-putts | A partial putt sample could count as a round | Complete scored and putted cards of the selected length; Insights needs five complete 18-hole cards |
| Handicap movement | Provisional first reading compared with current | Established readings only; current WHS index arithmetic unchanged |
| Raw round comparisons | Nine-/eighteen-hole scores could mix | Complete 18-hole default; explicit 9-hole selection uses a separate basis |
| Scope | Time window only | Existing time window plus course, tee and length; course changes clear tee selection |
| Insights comparison | No prior period | Nonoverlapping preceding sample under the same filters; first/last stretches compare against the remaining holes |
| Net Insights evidence | Mixed known/unknown-handicap denominator | Separate known-handicap complete-card denominator and minimum |
| Personal best ties | Could celebrate an equal score as a new record | Matched label; no false new-best recap/email |
| Peer comparisons | Total detailed-round threshold; extrapolated index bands | Evidence for each stat, sample disclosure, 0–20 supported band, explicit approximate-proxy language |
| AI coaching | Career framing regardless of selection | Scope and coverage supplied; saved summaries disclose scope/legacy uncertainty |
| Admin population | Inconsistent account/Test-club filters | Shared eligible-account and qualifying-participation helpers |
| Golf cadence | Roster entries or posted personal records could distort play | Qualifying personal cards plus real ended-game participation; team members count once; no-shows/empty/future/Test excluded |
| Activation / repeat round | Members without full observation opportunity diluted rates | Mature seven-/28-day signup cohorts; visible numerators and denominators |
| App retention | Incomplete observation windows | Mature first-open cohorts; week one days 1–7, week four days 22–28 |
| Game completion | Removing drafts improved historical denominator | Private aggregate lifecycle ledger retains deleted drafts from installation onward |
| Feature adoption | Saved settings inferred as usage | Saved settings labelled accurately; separate observed Insights opens, successful AI generations and live-link enables |
| Repeat use | No repeat club/format view | Clubs with 2+ qualifying games; member repeat participation by format; observed feature repeat use and mature return association |
| Reminders | Sent counts without outcome linkage | Distinct reminded games with subsequent scoring/completion; labelled association, not causality |
| Operational reliability | Failed reads could look empty or disappear | Shared error/retry/freshness state; same-query good data retained with warning; new queries cannot display another scope's data |
| Daily diagnostics | Raw personal round records looked like completed participation | Explicit round-record label; completed participation remains a separate KPI |
| Platform | Last standalone open described as installed base | Last opened as app/browser, with unknowns retained |

## Data and permissions

Migration 0235 is additive to the user-confirmed 0234 baseline. No old migration is edited. It reuses activity_log with a bounded details object, the existing log-retention job, admin RPCs, account-reference registry and stale-game score clocks. It does not add a scheduler or replace scoring/posting functions.

analytics_game_lifecycle contains identifiers, dates, format/status and boolean lifecycle facts. It copies no names, courses, score arrays or financial values. Organizer/group references follow account merge/removal and group deletion. Test provenance remains excluded after deletion. Members cannot write or read global lifecycle history; existing admins may read. Three new analytical helpers are private. The only new member-executable function, record_feature_use, derives auth.uid(), allowlists four actions and requires an organizer/admin with an enabled link for live-share evidence. Direct analytics event forgery is refused. Retry IDs deduplicate the same observation; separate real actions count separately.

Historical deletions and past feature clicks cannot be reconstructed. New feature-return cohorts require 28 days. Retention/feature-return and reminders are observational and do not demonstrate causation. Putting, GIR and scrambling remain proxies based on recorded score/putt data; this does not claim shot-location strokes gained.

## Preserved contracts

Dashboard input props and callbacks are unchanged. Scope is local display state; it does not mutate rounds or saved handicaps. Insights adds evidence fields while retaining existing result fields. AI request keys remain bounded and validated; model output shape is unchanged. Admin readers keep their existing signatures/keys and add cohort/funnel metadata. Power-user result columns and sorting remain compatible. Existing daily cleanup schedule and rules, score writes, bets, tee assignment, posting and handicap arithmetic remain authoritative.

## Required external gates

This is a locally validated staging candidate. Native GitHub/Supabase CI for this version, Vercel staging build and feature checks remain required. The existing HANDOFF requirement to review docs/sql/data_profile.sql from production before shipping statistics changes also remains open. No production database was queried or changed, and no deployment/merge was performed.
