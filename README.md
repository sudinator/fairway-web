## 178.26.260830 — Staging integration reset-count fix

- **NO migration.** Fixes the PR-only real Staging integration harness after the Alternate Shot reset test crashed after 60 successful checks.
- Root cause: Supabase `select(..., { count: "exact", head: true })` intentionally returns `data = null` and exposes `count` on the response object. The test wrapped that response in `expectNoError()`, whose contract returns only `result.data`, so `afterAltReset` became `null` before `.count` was read.
- The reset verification now keeps the full Supabase response, asserts the query itself succeeded, then reads `response.count`. Assertion count is unchanged.
- Added a permanent integration source-contract check preventing this exact response/data confusion from returning.
- Audited the rest of `ci/integration/staging.mjs`: this was the only `head:true/count` query incorrectly passed through `expectNoError`; the cleanup count query already retains the full response correctly.
- No application behavior, scoring logic, database schema, or migration file changed. Production 0140/0141 remain byte-identical to staging.

## 178.25.260830 — Production migration-parity URL hardening

- **NO migration.** CI-only release-candidate hardening after the production PR exposed a malformed PostgREST request (`PGRST125 Invalid path specified`).
- `ci/check_live_migration_parity.mjs` now accepts either a Supabase project base URL or a copied `/rest/v1` endpoint, canonicalizes it to the project origin, strips query/hash fragments, and rejects unrelated paths with a precise configuration error. This prevents accidental `/rest/v1/rest/v1/...` requests while preserving the same service-role authentication and ledger comparison.
- The migration-parity source contract now permanently requires URL canonicalization and canonical REST endpoint construction.
- No application behavior, scoring logic, database schema, or migration file changed. Production 0140/0141 remain byte-identical to staging.

**Current staging candidate:** 178.24.260830 — approved Ryder Cup-style Team Individual Match results: Team A left, THRU/AS centered, Team B right, leader-only UP status, Details opens the net-score progression. Migrations 0140–0141 remain required.

**Prior release:** 178.18.260829 — Environment-contract correction documenting the migration-ledger test fixture; no application, scoring, or database change.

**Current staging candidate:** 178.17.260829 — React hook-order correction for the Alternate Shot side-game suppression plus a permanent pre-lint source guard; no scoring or database change.
**Current staging candidate:** 178.14.260829 — Alternate Shot score entry is team-based (one ball/one side score), team playing handicap is shown/applied, and individual side-game/personal-card surfaces are suppressed.

**Current staging candidate:** 178.13.260829 — no scoring behavior change from 178.12; updates the CI assertion baseline for the expanded Alternate Shot test suites.

# Fairway Card — Web App

A golf score tracker your friends sign into with Google. Tracks scores hole by
hole, computes course handicap and Stableford points, and shows stats (GIR,
fairways hit, putts, penalties) — with each person's rounds private to them.

You don't need to read or edit any of this code. The files below are here so
the app can be deployed. Your job is just the click-through steps your guide
walked you through (GitHub → Google sign-in setup → Vercel).

## Current game-management behavior

The organizer Game Control Center uses one central transition policy for changes after scoring starts. Safe metadata stays editable; score reinterpretations require an explicit confirmation; structural changes that would rewrite who played whom or delete played golf are blocked. Scored-player tee/handicap edits are treated as whole-round corrections and preserve gross scores.


## Create Game convergence (staging development)

Create Game is being converged onto the same five-section mental model as Manage Game: Game → Players → Format → Teams & Groups → Review. The work is staged on the staging branch so the existing production Create Game path remains stable until the full flow is complete and end-to-end validated. Stage 3 now supports draft-time tee inheritance: individual override → flight tee → game default tee, resolved into explicit player tee/rating/slope snapshots at creation.

## What each part does (for the curious — optional)

- `app/page.tsx` — top-level app entry/composition; feature screens live under `components/`
- `app/auth/callback/route.ts` — handles the moment Google sends a user back after sign-in
- `lib/golf.ts` — the golf math (handicap, Stableford, GIR/fairway/putt stats)
- `lib/courses.ts` — course normalization, identity, group-library, and custom-course helpers
- `lib/supabase.ts` — the connection to your database
- `components/ui.tsx` — shared visual pieces (the scorecard, stat tiles)

## The two settings it needs

When you deploy on Vercel, you'll paste in two values (from your Supabase
project) as "Environment Variables":

- `NEXT_PUBLIC_SUPABASE_URL` — your Supabase Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — your Supabase Publishable key

That's it. Everything else is automatic.

## Courses

This version does NOT use GHIN (that requires per-user logins that don't work
for a shared public app). Courses come from a live search of golfcourseapi.com
(~30,000 courses); anyone can also add their own course by copying the
par/rating/slope off the physical scorecard — saved for reuse and shareable
within a group. Always confirm a course's details against the card in your cart;
members can correct a course's pars/rating/stroke index and save the fix.

## Running it on your own PC first (optional)

If you ever want to preview locally before deploying:
1. Install Node.js 20.9+
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in your two Supabase values
4. `npm run dev`, then open http://localhost:3000

## Create Game setup

Create Game uses the Lean Create flow: **Game → Players → Format → Review**. Advanced teams, matchups, foursomes and tee groups are completed in Manage Game after the core game is created. The Create Game format selector uses the same concepts as Manage Game: Match = Individual/Team, Four-ball = 2 v 2 Match/Team vs Team, and Skins = Individual/1:1 Teams/2 v 2 Best-ball.

## UI conventions
- Six-hole segment breakdown reuses the Group Results grid format (Player / Thru / segment columns / Total) for consistency.

- **Minimum font size: 11px.** Never use a `fontSize` below 11 anywhere in the app (readability floor). If space is tight, shorten the label instead of shrinking the type.
