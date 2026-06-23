# Birdie Num Num — Backlog & Improvements

Running list of things to build or tighten. Newest ideas near the top of each section.

## Games redesign — SHIPPED (v1.44.0 → v1.46.1)
Done: **Stroke play** (gross/net, lowest-total leaderboard) · **net-double cap lifted at entry** for stroke play AND four-ball/trifecta so real triples+ can be recorded (handicap still caps each hole at net double via `adjustedHoleScore`) · standalone **four-ball best-ball/shootout (aggregate)** scoring · **guided two-family chooser UI** (Stroke vs Match → Individual/Team) · new team/match games **open on Setup** with a "finish setup first" prompt on the Scorecard until handicaps/teams/matchups are done.

Still open from the original spec:
- **Split skins (DONE v1.47.0)** — no-carryover variant where tied players share the hole. Only *carryover* exists today; "split" was never built. Useful for big fields where carryovers stall.
- **Optional hard-gate:** block the Scorecard entirely until setup is complete (today it's a prompt, not a lock).

## Feature ideas

### In-app "How do I…" help search (no LLM, no tokens)
A search box in the Help section where players type natural "how do I…" questions and
get answers in a chat-style exchange (their question, then a step-by-step reply).
- **No LLM / no tokens:** a curated FAQ knowledge base bundled in the app + client-side
  search. Keyword + synonym matching, with a lightweight fuzzy-search lib (e.g. Fuse.js)
  to tolerate typos/phrasing. Deterministic retrieval, runs fully in the browser, works
  offline, instant, private.
- Each FAQ entry: the question, keywords/synonyms, and ordered steps that name the in-app
  location (e.g. "Games → Create → share the 6-digit code"). Could deep-link a button that
  jumps the player to the right screen.
- **Coverage caveat:** only answers what's authored; it's smart FAQ search styled as chat,
  not real conversational understanding. Quality scales with the entry set + synonyms.
- **Tie-in:** when there's no good match, offer "Didn't find it? Send a question" → routes
  into the feedback capture below (which also surfaces missing FAQs to add).
- Optional later: LLM fallback *only* on a miss (hybrid) — burns tokens only when local
  search fails. Out of scope for the no-token version.

### Feedback: report a bug / request a feature (wishlist)
Let players report something missing or broken, or suggest a feature, from inside the app.
- Simple form: type (bug | wish) + message. Auto-attach context (app version, active
  group, current screen) so bugs are actionable. Optional screenshot.
- Writes to a Supabase `feedback` table with user id + timestamp + app version.
- Admin review surface (like Oversight/Users): list submissions, set status
  (new / triaged / done), optionally reply or notify the requester.
- No LLM needed.

### Post-round stats completeness reminder
After a round is **completed**, if the player has been recording stats, the scorecard
should flag any holes where stats are missing and help them fill the gaps.
- **Scope:** fairway hit (FIR) and putts only. Ignore sand and penalties.
- **Trigger:** only when the round is complete AND the player has entered *some* stats
  (don't nag players who never track stats).
- **Par-3 handling:** "fairway hit" is N/A on par 3s — exclude par-3 holes from the
  fairway-missing check (still check putts on par 3s).
- **UX:** a clear banner/summary listing the holes with missing FIR/putts, plus a direct
  path to fix them (e.g. "Add my stats" → opens the player's own round in the editor).
- **Marker note:** explain that their score may have been kept by a *marker*, so the gross
  is in but their personal fairways/putts may not be — and that they add those themselves
  on their own round afterward. Make the "where/how" obvious.

## Known weaknesses / hardening (deferred, not urgent)
From the security & structure review. None are emergencies; tackle when convenient.
- **Auth-login disconnect (DONE v1.50.0 / migration 0038):** wipe/merge/ban remove or flag the *profile* but not the
  Supabase auth login, so a removed user can sign back in and get a fresh profile (and,
  with a default group set, auto-join it). Fully retiring an account needs deleting it in
  the Supabase Auth dashboard.
- **Whole-array score writes (NOT a concurrency risk):** `setPlayerHole` rewrites a
  player's entire scores/putts arrays each save. This is safe because the marker model
  guarantees a single writer per row: with no marker each player edits only their own row;
  once a marker is active every other player's entry UI is hidden and `cardCanEdit` grants
  the card to the marker alone. The only residual is the *same* marker on two devices —
  by-design "marker is source of truth, last write wins," not a conflict. Per-hole rows are
  therefore NOT needed.
- **Silent failures:** several paths `catch {}` (recordMyGameRound, logActivity, background
  save). Resilient, but can mask real data-loss errors — surface them somewhere visible.
- **Default-group auto-join hits new signups too:** fine for a closed society; a liability
  if sign-ups ever open beyond invites.
- **Shared course-data blast radius:** one wrong rating/slope/SI on a shared course skews
  handicaps for everyone using it; no guard against a bad edit propagating.
- **Orphaned support sessions:** rely only on the banner to remind the admin to exit;
  consider auto-expiry.
- **No server-side score validation:** clients can write arbitrary values into game_players
  score arrays.
- **No automated tests** for the PL/pgSQL admin RPCs.

## Housekeeping
- **Marketing one-pager:** `marketing/Birdie-Num-Num-overview.pdf`. Regenerate with
  `python3 marketing/make_onepager.py` and keep it current as features ship.
