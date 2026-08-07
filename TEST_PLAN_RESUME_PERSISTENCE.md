# Manual test plan — resume & unsaved-edit protection (v176.13)

Report each test as **PASS** / **FAIL**. For any FAIL, note: what you saw, the device/browser, and the
version shown in-app. Anything that changes data (scores, a created round) is safe on a throwaway game.

## Before you start
- [ ] Deploy **176.13**, confirm a clean Vercel build.
- [ ] Open the app and confirm the version reads **176.13.xxxxxx**.
- [ ] Use the **"App Testing"** club and throwaway games/rounds.

### ⚠️ Important: how to actually trigger a "fresh open"
A *quick* phone lock often does NOT reload the app — the OS may keep it in memory, so scores/edits are still
there even without these features (a false PASS). To really test, force a real reload with ONE of:
- **Best:** fully close the app (swipe it away from the app switcher), then reopen; **or**
- background it (home screen / another app) and wait ~2–3 minutes before returning; **or**
- (quickest) pull-to-refresh / hit reload.
If the app resumes instantly with no loading, it didn't reload — force one and retry.

---

## A. Group scorecard — resume to the LAST SCORED hole (176.12)
Open a group game where **you are the marker/scorer**.

**A1 — Lands on the hole you were working on (the exact case from before)**
- [ ] Score holes 1–2 fully (all players).
- [ ] On hole 3, score **3 of 4** players (leave one blank).
- [ ] Force a real reload.
- [ ] EXPECT: the app returns to this game and lands on **hole 3** (NOT hole 4) — you see your 3 entered
      scores and the one that's still missing, with hole 4 just below.

**A2 — Hole number stays visible**
- [ ] On that same resume, EXPECT: the **"Hole 3" label is visible** (not hidden behind the sticky header at
      the top of the scorecard). Tell me if the gap above it looks too big or too small.

**A3 — Fully-scored progression**
- [ ] Score holes 1–5 fully, force a reload.
- [ ] EXPECT: lands on **hole 5** (your last scored hole), with hole 6 below. (Intentional — shows the last
      hole you completed rather than jumping ahead to the next empty one.)

**A4 — Fresh game isn't disturbed**
- [ ] Open a brand-new group game with nothing scored → sits at **hole 1**, no surprise auto-scroll.

**A5 — Scores are never lost (regression)**
- [ ] After every reload above, confirm all entered scores are present and correct.

---

## B. Solo round editor — resume + sticky section header (176.12 / 176.13)
Start a **solo round** (your own scorecard, not a group game).

**B1 — Lands on the hole you were working on**
- [ ] Score holes 1–3, then start hole 4 but leave it partial/blank as your "last touched".
- [ ] Force a real reload.
- [ ] EXPECT: back in the round, landed on your **last scored hole** (hole 3 here), hole number visible,
      scores intact.

**B2 — Fully-scored progression**
- [ ] Score holes 1–5, force a reload → lands on **hole 5**, with hole 6 below.

**B3 — Fresh solo round** → sits at **hole 1**.

**B4 — Sticky per-section header (NEW in 176.13)**
- [ ] Scroll DOWN through the front 9. EXPECT: the column header (Par / Score / FW / GIR / Putt / Pts) stays
      **pinned at the top** as you scroll.
- [ ] Keep scrolling into the back 9. EXPECT: the header swaps to the **back-9 card's** header and stays pinned
      there. Scroll back up and it should swap back to the front-9 header.
- [ ] Tell me if the pinned header sits at the right spot (not too high/low, not overlapping the app bar).

**B5 — Scores intact after reload** — [ ] confirm no scores lost.

---

## C. Unsaved-changes WARNING on course edits (176.10)
In **round setup**, pick a course, then work with a tee's rating/slope/yardage.

**C1 — Warn on Cancel with unsaved course edits**
- [ ] Pick a course. Edit a tee's **rating** (or slope, or a yardage) to a new value. Tap **Cancel**.
- [ ] EXPECT: an **"Unsaved changes"** sheet appears (NOT a silent leave), offering
      **Save changes / Discard & leave / Keep editing**.

**C2 — Keep editing** → sheet closes, back in setup, edits still there.

**C3 — Discard & leave** → Cancel → sheet → Discard → leaves setup; reopen round setup → **blank**.

**C4 — Save changes** → edit a rating → Cancel → sheet → Save changes → the course-correction save runs (asks
      for / requires a **reason** if needed). Confirm the corrected course saves.

**C5 — No warning when nothing was edited** → pick a course, change nothing, tap Cancel → leaves immediately,
      **no** sheet.

**C6 — Desktop refresh warning (desktop browser only)** → edit a rating, refresh/close the tab → the browser's
      native "Leave site?" prompt appears. (Won't fire on a mobile lock — expected; section D covers that.)

---

## D. Round-setup edits SURVIVE a lock/background AND reopen INTO the editor (176.11 + 176.13) — the critical one
Highest-risk area; please run carefully.

**D1 — Reopens into the course editor with edits restored (STRENGTHENED in 176.13)**
- [ ] New round setup → pick a course → edit a tee's **rating/slope/yardage**.
- [ ] Force a real reload.
- [ ] EXPECT: the app **reopens directly into the round-setup / course editor** (NOT the dashboard), with the
      same course and your edited values intact, AND the **"reason for course correction"** prompt still
      showing. (Previously it opened on the dashboard and the edits looked lost — that's the bug 176.13 fixes.)

**D2 — Whole in-progress setup survives**
- [ ] Pick a course, enter your **handicap index**, set a **play date** (optionally edit a tee).
- [ ] Force a real reload → reopens into setup with course, index, and play date all restored.

**D3 — Correction reason text survives**
- [ ] Edit a rating, type in the **correction reason** box, force a reload → reopens into setup, reason still there.

**D4 — Cleared after you CREATE a round**
- [ ] Set up and actually **start/create** the round → reopen the app / round setup → **blank** form (no stale
      restore, does NOT force you back into setup).

**D5 — Cleared after Discard**
- [ ] Set up with edits → Cancel → **Discard & leave** → reopen the app → lands on dashboard normally; opening
      round setup shows a **blank** form.

**D6 — Cleared after a gross-only round save**
- [ ] Enter a course + gross total, save the gross round → reopen → **blank** setup, no forced return.

**D7 — Fresh open unaffected**
- [ ] With no interrupted setup pending, open the app → normal dashboard; round setup opens as an empty form.

---

## E. Regression sweep (make sure nothing broke)
- [ ] Create a normal round end-to-end (pick course, index, start, score, finish) — works as before.
- [ ] Course **search** still returns results and lets you pick a course.
- [ ] Editing rating/slope still requires a **correction reason** before it will save.
- [ ] No obvious console errors (if you can check).
- [ ] Group scoring, take-over/release, and bet posting still behave (quick sanity).

---

## What to send back
For each ID (A1, B4, D1, …): **PASS** or **FAIL**. For fails, one line on what happened. Also tell me:
device + browser (e.g. "iPhone, Safari PWA" / "Android Chrome" / "desktop Chrome") and the in-app version.
Most important to hear about:
- **A1 / A2** — the group-card resume fix.
- **B4** — the new sticky section header (and whether it sits at the right spot).
- **D1–D7** — round-setup persistence + reopening into the editor (touches round creation; only a real
  click-through can verify it).
