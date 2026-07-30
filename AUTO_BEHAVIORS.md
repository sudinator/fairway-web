# BNN — things the app does automatically (no explicit tap)

Built by reading the current code at v176.3 (components/, lib/, app/, migrations/). This is a
verified catalogue, not a memory dump; where a behaviour lives in a Postgres function I read the
function body. It is organised by how much it can surprise you: first the things that **change your
data**, then things that **reload/refresh the screen**, then **server-scheduled jobs** and
**database triggers**, and finally a list of things that are explicitly **NOT** automatic.

If any single item here shouldn't be automatic, say so and I'll gate it behind a tap or remove it.

---

## A. Automatically CHANGES your data (highest interest)

**A1 · Auto-finish stale complete rounds** — `finish_stale_rounds()` (migration 0083), called on every
home-screen load (`components/home.tsx`, self-throttled to once/hour server-side). Any *in-progress*
round that is 24h+ old **and has all 18 holes scored** is flipped to `final`, stamped
`finished_by = 'system:auto'`, and from then on counts toward your stats and handicap. Partial rounds
(fewer than 18 holes) are left alone. Rationale: rescue rounds you finished but never tapped "Finish".
Not gated — it just happens when you open the app.

**A2 · Auto-complete stale fully-scored games** — `sweep_stale_games()` (migration 0083), also called on
home load (once/hour). For any non-ended game created in the last 30 days where **every player who has
entered anything has entered all holes**, once it's past the end of its Eastern-time day the game is
auto-ended — which **posts each player's round into their history** (and thus handicap). So a round can
appear in your Rounds tab without you ending the game yourself. Not gated.

**A3 · Auto-record your round when an ended game opens** — `recordMyGameRound()` (components/tournaments.tsx),
run from a `useEffect` when you open a game that's already ended. Writes *your* game scorecard into your
Rounds history (dedup-guarded by `game_id`, so re-opening updates in place rather than duplicating). This
is the normal game→history path; it fires on open, not on a tap.

**A4 · Live round autosave** — components/round-editor.tsx. As you tap each hole it (a) writes a draft to
this device's storage synchronously and (b) schedules a background save to the server, and it re-flushes
on tab-hide / freeze / page-hide (iOS can drop a write on a screen-lock otherwise). This only persists
*your own* entries; it's what lets you lock your phone mid-round and come back to the same card.

**A5 · In-progress round row is created/adopted for you** — components/round-editor.tsx `ensureRoundId()`.
The first score you enter silently creates an `in_progress` round on the server (or adopts an existing
one from the last 12h) so autosave has somewhere to land. In-progress rounds are ignored by all stats and
handicap math until finalized (see A1), so this never affects your numbers on its own.

**A6 · Offline outbox drain** — components/tournaments.tsx, every 20s. Score writes you made while offline
sit in a queue and are flushed to the server automatically when the connection returns. It only completes
writes you already made; it never invents data.

**A7 · Achievement / player-card reconcile** — `syncBadges` / `syncPlayerCard` (components/home.tsx), run
whenever your rounds change. Idempotent recompute of your badges and shared player card; also acts as a
one-time backfill of history. No score or handicap data is changed — only derived badge/card records.

---

## B. Automatically RELOADS or REFRESHES the screen

**B1 · PWA update check** — components/register-sw.tsx. Checks for a new deployment every 30 minutes and
on focus / tab-visible / page-show / load. This only *detects* — it surfaces the "A new version is
available — [Update]" banner. As of v176.3 it never activates a new version on its own.

**B2 · Reload after an applied update** — components/register-sw.tsx `controllerchange` → one reload. This
now only fires *after you tap Update* (in the banner or the Manage card). This was the v176.3 fix: before
it, the Manage "App version & updates" card auto-applied on open. Fixed.

**B3 · Game scorecard auto-refresh** — components/tournaments.tsx. A 60-second poll plus a realtime
subscription (~1s) on the game so you see other players' scores land live. Both are guarded so they never
overwrite a score you're in the middle of entering. Read-only re-fetch; changes nothing.

**B4 · Side-contests realtime** — components/contests-view.tsx (shipped in the recent contests work).
Subscribes to the contest tables and re-fetches when an entry changes, so leaders update live. Read-only.

**B5 · Tee-times realtime** — components/tee-times.tsx. Subscribes and refreshes RSVPs live. Read-only.

**B6 · Public live-leaderboard page** — app/live/[token]/page.tsx, refreshes every 25s. A read-only shared
link; no login, no writes.

**B7 · Club/edition switch reload** — components/groups.tsx. Switching the active club mirror triggers a
full page reload. This one is user-initiated (you tap to switch), listed for completeness.

---

## C. Server-scheduled jobs (pg_cron — run on Supabase, not your device)

**C1 · Tee reminders** — every 15 min (`send_tee_reminders`, migration 0074). Inserts reminder
notifications for upcoming tee times. Only writes notification rows.

**C2 · Friction sweep** — daily 08:17 (`sweep_friction`, migration 0092). Flags data-integrity anomalies
for admin review and auto-resolves any earlier flag whose data has since been cleaned. Admin-facing;
touches only the friction ledger, not your rounds.

**C3 · Purge old notifications** — daily 04:23 (`purge_old_notifications`, migration 0095). Deletes stale
notification rows only.

Note: A1/A2 (auto-finish) are **not** cron — they run opportunistically when someone opens the app, and
are throttled server-side to once/hour. There is no background process finishing your rounds while the app
is closed.

---

## D. Database triggers (fire automatically on data changes)

These run inside Postgres when rows change. They're infrastructure/notification plumbing, not gameplay:
- Notifications auto-created on: being added to a game, money owed, a tee time posted, a bet posted, a
  game finishing, a club-member joining (each de-duped; all default to in-app).
- Audit-log rows written on money and course/handicap changes (`group_activity`, `money_audit`).
- Freeze/guard triggers that *block* edits to closed money events and protect privileged columns.
- Tee-time sequence numbers assigned on insert; expired support sessions cleaned up.

---

## E. NOT automatic — these always require an explicit tap

For contrast, none of the following ever happen on their own: deleting a round (soft-delete, with a
game-linked warning), marking a partial round complete, ending a game, logging a side-contest result,
recording a settlement / marking money paid, creating a game or tee time, changing anyone's handicap,
posting a bet, or posting to GHIN. All are button-driven and confirmable.

---

## Proposed standing rule

Any change that alters existing behaviour — and especially anything in sections A or B above (acts
without a tap, or reloads/refreshes) — gets called out explicitly in chat and in a dedicated
"Behaviour changes" heading in DEPLOY_NOTES, separate from features and fixes. Auto-anything is the
highest-risk category and never gets folded silently into a "reliability improvement" again.
