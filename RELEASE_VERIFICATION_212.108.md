# BNN 212.108.261114 — analytics refinements and approved filters

Status: complete local CI and fresh-database verification PASS; hosted staging/production gates remain open. No production-ready claim. No GitHub push, PR, merge, deployment or production database write was performed here.

## Baseline and intended change

Exact source baseline: delivered fairway-web-212_107_261114.zip (SHA-256 fbe0d2fac05fcd330360075b76862b84b43a2b07b0f0baf1ff13d24944f17832). The owner approved the actual Summary preview: three descending horizontal lines on the time-range row, green without filters and yellow after applying course/tee criteria. The remaining analytics corrections are partnership rate, stronger stat-evidence floors and explicit penalty tracking. ANALYTICS_212.108.md records definitions, intentional differences and preserved contracts.

The owner reports production at 212.101. The source release ledger identifies the cumulative 212.102–107 additions; this is not an independent comparison against a fetched production checkout. GitHub CLI has no signed-in account, so hosted workflow status, exact staging-to-main diff and deployments are not observable from this workspace.

## Executed validation

- `npm run ci`: PASS, exit 0 on the final source. This includes hook lint, TypeScript `--noEmit`, the full unit suite, differential tests, moving-clock tests, lifecycle/source/design/security guards, real Chromium checks and complete Next production compile/build.
- Unit assertion guard: PASS — 447,369 assertions across 112 suites, no assertions lost. Moving-clock run: PASS — 173 suites.
- Chart browser: PASS — 1,393 assertions across 324 data/viewport cases. Analytics browser: PASS — 82 scenario assertions using real components and explicitly modelled RPC responses.
- Complete disposable fresh-database replay: PASS — 234 migration scripts and all rebuild assertions, stale-game concurrency and five provider-contract harness outcomes. Security snapshot remains 138 policies, 47 table grants and 216 privileged functions.
- Visual verification: PASS — all 66 gallery screens photographed; changed partner and round-detail screens refreshed from actual components with matched synthetic fixtures. The before/after HTML retains the delivered 212.107 renders.
- Expanded penalty SQL checks: PASS — owner/device/account enforcement, complete nine/eighteen cards, displayed snapshot concurrency, confirmation/removal/re-entry, posted metadata allowed while posted scores remain immutable, unrelated-stat preservation and server-edit invalidation.
- Existing read-only migration-ledger and data-profile queries: PASS on the disposable migrated database. Production results remain pending.
- Code review and package integrity: all 1,351 baseline source entries retained; ten intended new files; earlier numbered migration SQL bytes unchanged; package/version/lock consistent; no new dependencies. Final ZIP is CRC-tested and every entry compared byte-for-byte with candidate source; audit saved beside CI evidence. Runtime dependencies, build outputs and new test artifacts are excluded.

The first complete CI attempt reached build and failed because the local node_modules symlink pointed outside the build root. Replacing that symlink with a local copy of the same installed dependencies fixed the environment; no app-source change was made for that failure. Both the standalone build and subsequent complete CI command exited zero. Exploratory runs are not counted as final release gates.

## Scenarios and adjacent behavior

- Filters: real Summary actions and derived displays, course/tee intersections, hidden tee without course, course switch clears tee, draft edits do not affect results, Apply commits, Cancel/× discards, backdrop cannot dismiss, reopen restores committed scope, Clear/Apply restores all, A→B→A and 320/390/430/768 alignment/overflow. Arrow colour reflects committed filter state, not an unapplied draft. Time range and full-history index behavior remain.
- Partner records: 6/12 versus 3/3, halves, equal-rate larger sample, three-match minimum, malformed records, source immutability, identical table/highlight ordering, and actual HeadToHead loader/render. The existing authoritative match-outcome calculation is not changed.
- Statistical evidence: four/five separate rounds and 49/50 recorded opportunities; large raw counts do not override a sparse-round floor. Complete eighteen-hole putting and scrambling floors remain.
- Penalty data: unknown/default-zero versus confirmed zero, confirmed nine/eighteen cards, partial/negative/deleted/in-progress exclusion; only confirmed cards feed averages/trends/coaching/season comparisons. Penalty-free badges require confirmation. Round emails omit unknown zero claims and label unconfirmed positive totals as recorded lower bounds; cadence, opt-outs and fingerprint remain unchanged.
- Real React confirmation: outgoing displayed snapshot, busy state, no optimistic parent write, failure/retry, acknowledgement updates child and parent, remove reverses both, switching scope resets busy, old A response after A→B→A and late unmount responses cannot update an old view. Actual RoundDetail/browser checks exercise parent callback and header synchronization.
- Real disposable PostgreSQL: default false, snapshot mismatch rejection, same request/re-entry, whole-card nine/eighteen eligibility, partial refusal, own game-posted metadata allowed while posted scores remain immutable, score/penalty changes invalidate, unrelated putts preserve, server correction invalidates, active/primary-device/ownership boundaries, pending/banned refusal, ACL catalogue denial checks, and refusal preserves previous metadata. All fixtures roll back.
- Adjacent complete chain: existing account merge/removal, games, bets, posting, manual/nine-hole handicaps, team canonical scores, stale-game rollback and concurrent scoring, security contract and all provider-contract outcomes remain required.

## Consistency and security review

No scoring, score payload, handicap arithmetic, posting, financial or scheduler implementation is rewritten. Existing BottomSheet, match-outcome engine, own-round rules, primary-device trigger and Home/member-stats reconciliation are reused. Inputs/outputs remain compatible: Round adds optional penalties_tracked; AI aggregate adds bounded numeric penaltyRounds and null when unknown; existing Dashboard/round callbacks and AI output schema are preserved. Partner array ordering intentionally changes; the helper returns a new array and preserves record values. Penalty confirmation is only committed on exact acknowledgement.

Migration 0236 adds one NOT NULL DEFAULT false column, an authenticated security-invoker own-round RPC and a private invalidation trigger. It does not add tables, broaden anon access or create a job. The RPC verifies active account, current displayed snapshot, complete scored card, existing ownership and primary device, then verifies one updated row. Trigger invalidation is limited to actual score/penalty/card-membership edits. All earlier numbered migrations remain immutable. The global security snapshot is expected to remain unchanged because the new callable function is an invoker and the definer is a private trigger; the full database contract check verifies actual state.

The existing read-only docs/sql/check_what_is_applied.sql is updated through 0236 instead of adding a second migration checker. Both that query and the existing data_profile.sql compile and execute successfully on the fully migrated disposable database. This does not substitute for reviewing their production results.

## Production handoff and limits

First validate this candidate on staging with green native GitHub/Supabase CI, Vercel Ready and required feature checks. Keep the existing production data-profile review for statistics changes. Before production promotion, verify the actual migration ledger; the reported 212.101 app version does not prove SQL state. Missing migrations 0234, 0235 and 0236 must be applied in numeric order, with staging validation first. Already-applied files must not be rerun. All three scripts are in the cumulative ZIP; only 0236 is new to this version.

The cumulative source includes the 212.102 tee-resolution fix, 212.103 one yellow recovery panel, 212.104 daily stale-game process, 212.105–106 CI permission corrections and 212.107 analytics changes. Migration 0234 activates the agreed daily maintenance, including deletion of eligible empty games seven Eastern days after the later of created/play date. Existing financial/posted/contest/Test safeguards remain. Migration 0235 starts lifecycle/feature observations; earlier deleted drafts/clicks cannot be reconstructed and new return cohorts need 28 days. Migration 0236 treats historical penalty tracking as unknown until explicitly reviewed.

Only after those gates: staging→main PR, required verify check, merge, Vercel Production Ready and a non-destructive smoke test. No destructive test is run on production. Rolling back frontend code does not roll back database migrations/data. The migrations preserve old fields and old-client compatibility.

Local execution uses the repository's real tests, Chromium, PostgreSQL 17.11/pg_cron 1.6.5 and disposable Supabase shim; Node runtime differences from hosted Node 22 remain an external verification limit. Browser data and transport failures are labelled MODELLED; application components, SQL, RLS, actual permission refusals and stale-game concurrency execute normally. No Supabase-hosted runtime or physical iPhone result is inferred from local success.

## Evidence

/workspace/scratch/02068af8b213/analytics108-evidence contains final CI/database logs, read-only query checks, actual before/after renders and packaging audit. Gallery entries reuse real components; async views are photographed after actual fixture loaders resolve. The ZIP excludes dependencies/build/test/runtime outputs and credentials; earlier tracked source/evidence files are preserved from the baseline, and the documented example environment template contains placeholders only.
