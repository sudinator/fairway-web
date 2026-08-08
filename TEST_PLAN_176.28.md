# Manual test plan — v176.28 (UX arc + course freshness + Stage-2 refactor)

Covers everything shipped since your last confirmed deploy: resume/persistence UX (176.12–176.15),
sticky scorecard header (176.18–176.19), course freshness (176.16–176.17, migration 0124), and the
Stage-2 logic extractions (176.20–176.28, behavior-preserving — verified by ~103k automated
old-vs-new comparisons; section E is the human sanity check on top).

Report each ID as PASS / FAIL with a line on what you saw + device (e.g. "iPhone Safari PWA").
Use the App Testing club and throwaway games/rounds.

## Before you start
- [ ] Migration 0124 has been run in Supabase (course_freshness + RPCs). Everything else is code-only.
- [ ] Deploy 176.28, clean Vercel build, app shows version 176.28.xxxxxx.

### ⚠️ Forcing a real reload (matters for all of section A/B)
A quick lock often does NOT reload the app — the OS keeps it in memory (false PASS). Force a real
reload: fully close the app (swipe away) and reopen, OR background it 2–3 minutes, OR pull-to-refresh.
If it resumes instantly with no loading flash, it didn't reload — retry.

---

## A. Resume & persistence (176.12–176.15)

**A1 — Group card resumes to the LAST SCORED hole**
- [ ] As marker: score holes 1–2 fully, then 3 of 4 players on hole 3. Force a real reload.
- [ ] EXPECT: reopens into the game, landed on hole 3 (not 4), hole number visible below the header.

**A2 — Solo round resumes the same way**
- [ ] Solo round: score 1–3, reload → lands on hole 3, scores intact.

**A3 — Round-setup survives a lock and reopens INTO the editor**
- [ ] New round setup → pick a course → edit a tee rating/yardage → type a correction reason.
- [ ] Force a real reload.
- [ ] EXPECT: app reopens directly INTO round setup — course, edits, and reason all restored (not the dashboard).

**A4 — Courses-tab editor survives a lock and reopens INTO the editor**
- [ ] Manage → Courses → tap an existing course → change rating/slope/a yardage. Force a real reload.
- [ ] EXPECT: app reopens INTO that course's editor with your changes present. (This was the "changes
      lost" bug — the fix has two parts: reopen route + per-course draft.)
- [ ] Then Cancel → reopen the editor → EXPECT the edits are GONE (cancel discards the draft).

**A5 — Drafts clear on completion**
- [ ] Create a round after a setup edit → reopen setup → blank form, no stale restore.
- [ ] Save a course edit in Manage → reopen that course → shows the saved values, no draft prompt.

## B. Sticky scorecard header (176.18–176.19)
- [ ] Solo scorecard: scroll down the front nine. EXPECT: "FRONT NINE" + column headers stay pinned,
      and the pinned bar keeps ROUNDED top corners with GREEN showing in the corner notches (the
      "folds into the green" look you approved in the mockup) — no square cream corners.
- [ ] Keep scrolling into the back nine → header swaps to BACK NINE, same corner behavior.
- [ ] Scores/putts/fairways still enter normally with the header pinned.

## C. Course freshness (176.16–176.17 — needs migration 0124)
Setup to force a diff: Manage → Courses → open a stored course that ORIGINALLY CAME FROM COURSE SEARCH
(has an API id) → change one yardage (e.g. hole 4: 410 → 999) and Save.

**C1 — Admin prompt on picking the course**
- [ ] As you (admin), start a round setup and pick that course from favorites.
- [ ] EXPECT: a sheet appears — "Course data changed at the source" — listing the change PER HOLE
      (hole 4: 999 → 410), with three choices.

**C2 — Play with updated data**
- [ ] Choose "Play this round with the updated data" → the round uses the corrected yardage; the
      STORED course still shows 999 in Manage (library unchanged).

**C3 — Update the stored course**
- [ ] Re-trigger (pick the course again; cached diff shows without a new API call).
- [ ] Choose "Update the stored course" → Manage → Courses now shows the corrected data; picking the
      course again shows NO sheet (flag cleared).

**C4 — Dismiss sticks**
- [ ] Re-create the tweak, pick the course, choose "Keep current — ignore for now".
- [ ] Pick the course again → EXPECT no sheet (your dismissal is remembered; a re-check doesn't nag).

**C5 — Non-admin is silent**
- [ ] With a tweak pending, have a NON-admin (e.g. Jonny Tester) pick the course for a round.
- [ ] EXPECT: no sheet; their scorecard quietly shows the fresh (API) yardages; rating/slope unchanged.

**C6 — Admin notification**
- [ ] When a change is first detected, you (admin) get an in-app notification about the course change.

## D. Regression sweep — core flows (quick)
- [ ] Solo round end-to-end: create, score, finish → appears in Rounds, differential/handicap updates.
- [ ] Course search still returns and picks courses; rating/slope edits still require a reason.
- [ ] PWA update: app updates only after you confirm (no mid-session reload).

## E. Refactor sanity (Stage 2 — logic proven identical by automated diffs; this is the eyeball pass)
One GROUP GAME end-to-end, ideally STABLEFORD with handicaps + a guest:
- [ ] Create game: auto-name looks right ("Stableford / Course / Date"); creator + selected members +
      guest all appear; course handicaps look correct for the tee; ≤4 players land in one tee group.
- [ ] Score a few holes: leaderboard order, points, thru, and rel-to-par all update correctly; ties
      show as T-position; segment cards (Holes 1–6 etc.) show the right leader/"tied" and thru.
- [ ] Finish with a deliberate gap (one player missing hole scores, or putts if tracked).
- [ ] EXPECT: the finish prompt lists exactly what's missing per player ("scores on 5", "putts on 3").
- [ ] End the game → results record to each player's rounds as before.
- [ ] Repeat quickly for a STROKE game (net): leaderboard ranks by net total; segment cards rank by
      fewest strokes vs par.
- [ ] Add a member AND a guest mid-game (from the organizer panel): both get the shared tee, a course
      handicap, and a blank card sized to the course (9 vs 18).

## What to send back
PASS/FAIL per ID + device. Priority order if time is short: A3, A4 (the bugs you reported), C1–C5
(new feature), E (refactor eyeball). Anything odd in E, tell me exactly what looked wrong and in which
game type — the automated diffs say the math is identical, so an E failure would point at wiring, and
I want to know immediately.
