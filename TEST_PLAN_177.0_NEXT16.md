# QA plan — v177.0: Next.js 16 + React 19 upgrade

## Why this plan matters more than usual
This is a framework MAJOR upgrade (Next 14 → 16, React 18 → 19). Unlike the refactor work, there is
NO differential test that can prove behavior was preserved — automated checks only prove it COMPILES,
BUILDS, and that pure logic still passes. **Your click-through is the only thing that proves the
running app works.** Please run the whole plan before relying on this build. If anything misbehaves,
we can roll back cleanly (previous zip = 176.30).

## What changed under the hood (so you know where to look)
- Next.js 14.2.35 → 16.3.0; React 18.3.1 → 19.2.8; recharts pinned to 2.15.4 (React-19-compatible).
- `cookies()` is now async → touched the API auth client (lib/supabase-route.ts) and the auth callback.
- Dynamic-route `params` is now async → /join/[code], /live/[token], /organize/[gameId] switched to
  the useParams() hook.
- One React-19 ref typing fix in the share-card export.
- 0 npm vulnerabilities; Node pinned to >=20.9 (Next 16 minimum).

## The tests (focus on framework-touching surfaces)

### 1. Auth (the async cookies() change — highest risk)
- [ ] Sign OUT, then sign back IN with Google. EXPECT: lands logged in, lands on your dashboard.
- [ ] Reload the app while logged in → still logged in (session cookie read works).
- [ ] Deliberately break the callback: open the app, let it sit, sign in normally — confirm no
      "auth_error" screen on a valid login. (A bad/expired code now shows /?auth_error=1 by design.)

### 2. The three dynamic routes (the async params change)
- [ ] JOIN link: open a group join link (/join/<6-digit code>) → the code is read, the join flow works.
- [ ] LIVE scorecard: open a live share link (/live/<token>) → the correct game's live scores load.
- [ ] ORGANIZE link: open an organizer link (/organize/<gameId>) → the right game opens.
  (If any of these shows a blank/"not found" where it used to work, the params fix is the suspect —
   tell me which one.)

### 3. API routes (the await createRouteClient change)
- [ ] Course search (in round setup) returns results — exercises /api/courses auth.
- [ ] AI round analysis (if you use the coach feature on a finished round) returns a result —
      exercises /api/analyze-round auth.
- [ ] Push notifications still arrive (e.g., trigger one via a tee-time RSVP or game event).

### 4. Realtime + core gameplay (React 19 behavior)
- [ ] Create a group game, add players, score a few holes on TWO devices → live sync still works
      (one device's scores appear on the other).
- [ ] Take over / release scoring, lock a group → all behaves as before.
- [ ] Finish a game → records to rounds.

### 5. PWA / service worker (Next 16 changes build output/chunking)
- [ ] Installed PWA still launches and works.
- [ ] The update flow still works: after deploying, the app offers the update on next open and applies
      it on confirm (no forced mid-session reload). This is worth extra attention — SW + chunk names
      can shift on a Next major.
- [ ] Offline/again-online behavior is sane (open a scored round with no signal, scores show).

### 6. Charts + image export
- [ ] Dashboard charts render (differentials / trends).
- [ ] Manage screen charts render.
- [ ] Share a scorecard as an image → the PNG generates and looks right (recharts + html-to-image +
      the ref change all live here).

### 7. General smoke (React 19 is stricter)
- [ ] Click through every main tab (dashboard, games, courses, tee times, manage). Watch for anything
      that renders blank, throws, or logs a red console error that wasn't there before.
- [ ] Resume/persistence flows from the last plan still work (round-setup + course-editor reopen).

## Rollback
If something is broken and blocking: redeploy the 176.30 zip (unzip, commit, push). The only DB change
since then is 0125, which is backward-compatible with 176.30's client, so no DB rollback is needed.

## What to send back
PASS/FAIL per section + device/browser. Sections 1, 2, and 5 are the ones most likely to surface a
framework regression — prioritize those. Console errors: copy the exact text.
