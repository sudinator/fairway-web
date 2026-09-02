## 179.5.260902 staging candidate — Ryder Cup naming and quiet defaults

The multi-session team competition is now called **Ryder Cup** throughout the interface. The Games screen explains the difference between a one-round Game and a multi-session Ryder Cup. Games launched from a Ryder Cup session begin with Group Results, money-game participation, and hole contests off; organizers can opt into them afterward. No migration is required beyond 0143.

## 179.4.260902 staging candidate — weighted Cup outcome clarity

Weighted Cup standings now use golf-style quarter fractions, identify when a team can only share rather than win outright, and state Team Singles clinch requirements in match points. Long Singles matchup names wrap on the running board. No migration is required beyond 0143.

## 179.3.260902 staging candidate — Cup schedule and clinch contract

Cups now plan every session before play: match count, points per match, halved-match split, and the overall tied-Cup rule produce a locked total-points denominator. Standings distinguish projected from secured points, show what each side needs, and declare a clinch only against that locked schedule. Migration `0143_competition_schedule_contract.sql` is required before Staging browser validation.

## 179.1.260901 — Cup staging package correction

The 179.0 staging package omitted the updated shared `lib/game-create.ts` contract. 179.1 restores that file plus its test and adds a guard so Cup session organizer opt-out cannot drift from `tournaments.tsx`. No database change.

## 179.0.260901 staging candidate — Ryder Cup-style Cups
Cup creation is atomic at the database boundary: the event and its persistent A/B roster are created together, with active-club membership and team identity validated before commit.


BNN can now organize a multi-session two-team Cup inside the Games area. A Cup keeps a persistent roster/team assignment, launches ordinary Four-Ball / Alternate Shot / Team Singles games as sessions, and aggregates their live and decided match points into one event score. Migration `0142_team_competitions.sql` is required in Staging before browser validation; this candidate is not Production-deployable until the full release gate passes.

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
