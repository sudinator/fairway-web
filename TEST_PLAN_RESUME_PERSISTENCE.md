# Manual test plan — resume & unsaved-edit protection (v176.8–176.11)

Report back per test as **PASS** / **FAIL**. For any FAIL, note: what you saw, the device/browser, and the
version shown in-app. Anything that changes data (scores, a created round) is safe to do on a throwaway game.

## Before you start
- [ ] Deploy **176.11**, confirm a clean Vercel build.
- [ ] Open the app and confirm the version reads **176.11.xxxxxx** (Manage → App version, or wherever you check).
- [ ] Use the **"App Testing"** club and throwaway games/rounds.

### ⚠️ Important: how to actually trigger a "fresh open"
A *quick* phone lock often does NOT reload the app — iOS/Android may keep it in memory, so scores/edits are
still there even without these features (a false PASS). To truly test resume/persistence you must force a
real reload. Use ONE of these to simulate the lock:
- **Best:** fully close the app (swipe it away from the app switcher), then reopen it; **or**
- background it (go to the home screen / another app) and wait ~2–3 minutes before returning; **or**
- (quickest, desktop or mobile browser) pull-to-refresh / hit reload.

If the app just resumes instantly with no loading, it didn't reload — force a real reload and retry.

---

## A. Group scorecard — resume to the right hole (176.8)
Open a group game where **you are the marker/scorer**.

**A1 — Resume to an incomplete hole**
- [ ] Score holes 1–4 fully (all players in the group).
- [ ] On hole 5, enter a score for **one** player only (leave hole 5 incomplete).
- [ ] Force a real reload (see above).
- [ ] EXPECT: app returns to this game and the scorecard is scrolled to **hole 5**. All scores for 1–4 and the
      partial hole 5 are intact.

**A2 — Advance to the next hole when the current one is done**
- [ ] Score holes 1–5 fully (all players).
- [ ] Force a real reload.
- [ ] EXPECT: scrolled to **hole 6** (the next hole needing scores).

**A3 — Fresh game isn't disturbed**
- [ ] Open a brand-new group game with nothing scored.
- [ ] EXPECT: sits at **hole 1** (top). No surprise auto-scroll.

**A4 — Scores are never lost (regression)**
- [ ] After every reload above, confirm all entered scores are present and correct.

---

## B. Solo round editor — resume to the right hole (176.9)
Start a **solo round** (your own scorecard, not a group game).

**B1 — Resume to an incomplete hole**
- [ ] Score holes 1–4.
- [ ] Tap into hole 5 (or partially score it) so it's the hole you were on but not complete.
- [ ] Force a real reload.
- [ ] EXPECT: back in the round, scrolled to **hole 5**; scores 1–4 intact.

**B2 — Advance when complete**
- [ ] Score holes 1–5, force a reload.
- [ ] EXPECT: scrolled to **hole 6**.

**B3 — Fresh solo round**
- [ ] Start a new solo round, nothing scored.
- [ ] EXPECT: sits at **hole 1**.

**B4 — Scores intact after reload** — [ ] confirm no scores lost.

---

## C. Unsaved-changes WARNING on course edits (176.10)
In **round setup**, pick a course, then work with a tee's rating/slope/yardage.

**C1 — Warn on Cancel with unsaved course edits**
- [ ] Pick a course. Edit a tee's **rating** (or slope, or a yardage) to a new value.
- [ ] Tap **Cancel**.
- [ ] EXPECT: an **"Unsaved changes"** sheet appears (it does NOT just silently leave), offering
      **Save changes / Discard & leave / Keep editing**.

**C2 — Keep editing**
- [ ] From that sheet tap **Keep editing**.
- [ ] EXPECT: sheet closes, you're back in setup, your edits still there.

**C3 — Discard & leave**
- [ ] Tap Cancel → sheet → **Discard & leave**.
- [ ] EXPECT: leaves setup (back to home). Reopen round setup → it's **blank** (edits discarded, nothing restored).

**C4 — Save changes**
- [ ] Edit a rating → Cancel → sheet → **Save changes**.
- [ ] EXPECT: the course-correction save runs. If a correction **reason** is required, it should ask for /
      require it. Confirm the corrected course saves.

**C5 — No warning when nothing was edited**
- [ ] Pick a course but do NOT change any rating/slope/yardage. Tap **Cancel**.
- [ ] EXPECT: leaves immediately, **no** sheet.

**C6 — Desktop refresh warning (only if you test in a desktop browser)**
- [ ] Edit a course rating, then refresh or close the tab.
- [ ] EXPECT: the browser's native "Leave site? Changes may not be saved" prompt appears.
- [ ] NOTE: this will NOT fire on a mobile lock — that's expected; section D covers the mobile case.

---

## D. Round-setup edits SURVIVE a lock/background (176.11) — the critical one
This is the highest-risk change; please run it carefully.

**D1 — Course edits survive a real reload**
- [ ] New round setup → pick a course → edit a tee's **rating/slope/yardage**.
- [ ] Force a real reload (fully close & reopen, or background 2–3 min).
- [ ] EXPECT: setup is **restored** — same course, your edited values intact, AND the **"reason for course
      correction"** prompt still shows (this proves the app still knows they're edits).

**D2 — Whole in-progress setup survives**
- [ ] Pick a course, enter your **handicap index**, set a **play date** (optionally edit a tee).
- [ ] Force a real reload.
- [ ] EXPECT: course, index, and play date are all restored.

**D3 — Correction reason text survives**
- [ ] Edit a rating, type something in the **correction reason** box, force a reload.
- [ ] EXPECT: the reason text is still there.

**D4 — Cleared after you CREATE a round**
- [ ] Set up and actually **start/create** the round.
- [ ] Reopen round setup.
- [ ] EXPECT: **blank** form — no leftover restore from the round you just created.

**D5 — Cleared after Discard**
- [ ] Set up with edits → Cancel → **Discard & leave** → reopen setup.
- [ ] EXPECT: **blank** form.

**D6 — Cleared after a gross-only round save**
- [ ] Enter a course + a gross total, save the gross round → reopen setup.
- [ ] EXPECT: **blank** form.

**D7 — Fresh open unaffected**
- [ ] With no interrupted setup pending, open round setup normally.
- [ ] EXPECT: normal empty form (course search works, etc.).

---

## E. Regression sweep (make sure nothing broke)
- [ ] Create a normal round end-to-end (pick course, index, start, score, finish) — works as before.
- [ ] Course **search** still returns results and lets you pick a course.
- [ ] Editing rating/slope still requires a **correction reason** before it will save.
- [ ] No obvious console errors (if you can check).
- [ ] Group scoring, take-over/release, and bet posting still behave (quick sanity, from the earlier plan).

---

## What to send back
For each ID (A1, B2, D1, …): **PASS** or **FAIL**. For fails, one line on what happened. Also tell me:
device + browser (e.g. "iPhone, Safari PWA" / "Android Chrome" / "desktop Chrome") and the in-app version.
The ones I'm most keen to hear about are **D1–D7** (round-setup persistence) since those touch the
round-creation flow and can't be verified without a real click-through.
