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
