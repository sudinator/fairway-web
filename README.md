# Fairway Card — Web App

A golf score tracker your friends sign into with Google. Tracks scores hole by
hole, computes course handicap and Stableford points, and shows stats (GIR,
fairways hit, putts, penalties) — with each person's rounds private to them.

You don't need to read or edit any of this code. The files below are here so
the app can be deployed. Your job is just the click-through steps your guide
walked you through (GitHub → Google sign-in setup → Vercel).

## What each part does (for the curious — optional)

- `app/page.tsx` — the whole app screen: login, scorecard entry, stats
- `app/auth/callback/route.ts` — handles the moment Google sends a user back after sign-in
- `lib/golf.ts` — the golf math (handicap, Stableford, GIR/fairway/putt stats)
- `lib/courses.ts` — starter list of well-known courses + "add your own course"
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
1. Install Node.js 18+
2. `npm install`
3. Copy `.env.example` to `.env.local` and fill in your two Supabase values
4. `npm run dev`, then open http://localhost:3000

## UI conventions

- **Minimum font size: 10px.** Never use a `fontSize` below 10 anywhere in the app (readability floor). Bump to 10 rather than going smaller; if space is tight, shorten the label instead of shrinking the type.
