# 192.17.260930 — Personal round Save/Cancel and recovery

Status: CANDIDATE. Production unchanged. Built on the supplied 192.16 security candidate. This package contains only files changed from 192.16 and assumes that baseline is present.

## Resulting behavior

- Completed personal-round edits are local until Save changes. Cancel removes that round's edit draft, closes the editor, and does not write the database. Page-hide, blur and delayed autosave do not persist completed-round edits.
- Explicit Save and live-round backup call one transactional RPC. A hole or metadata failure rolls back the request. The editor reports failure, stays open and retains the recovery draft; success/callback/clearing happen only after confirmed server success.
- Live-round session UUID is assigned before the first network write and stored with the draft. Retry/reload uses that UUID. No course-name adoption or course-wide deletion remains.
- Historical edit recovery uses a separate per-round key; it does not replace an active-round draft or become Home's live-round Resume banner. Home excludes old final-round entries from that banner.
- Live-round Discard atomically deletes only that round and its holes; failures retain the draft and allow retry. Finished/game rounds cannot be discarded through this RPC.
- Finish/Discard stop new backup admission, cancel the timer and await admitted writes. The database also refuses a background request against an already-final round.
- Immediate Finish persists the entered manual handicap and its source. Clearing an override uses the existing historical-correction derivation; scorecard allocation and round summaries use the selected figure. Total-only historical rounds can save date/handicap corrections as well as rating/slope without inventing hole scores or losing gross totals.

## Contract inventory and intentional changes

Inputs: Round (identity, lifecycle, course/tee, club/game, date, rating/slope/par, stored index/handicap/source, gross and all hole fields), onSaved/onCancel, local recovery data, course-library reads and signed-in database role.

Direct state: holes, active-hole resume, date, rating/slope text, handicap override, Save/error/backup messages, course-correction state. Refs: latest holes and round, touched/synthesized flags, stable session ID, timer, background promise chain, Save/Discard completion flags and diagnostic session ID.

Outputs: rendered handicap, allocation, score/stat summaries and Save availability; synchronous recovery writes; transactional round/hole writes; scoped discard; completion activity and parent callbacks. Cancel/re-entry and failed Save/Discard retry are checked below. Controls cannot change the save snapshot while persistence is running.

Dependencies: existing Supabase client, error messages, draft helpers, golf/allocator functions, UI scorecard/date components, activity logging, course library and correction helpers. Props and parent callbacks retain their types. Game-player/game writes, course-library save flow, existing hole course metadata and existing round ownership/club/game/index are preserved. New Round.draft_session_id is client-only and is not a database column.

Intentional changes: historical autosave disabled; Save made atomic; UUID-based draft recovery/creation; scoped atomic discard; no success after partial/zero-row writes; historical handicap/date-only saves enabled for total-only rounds; obsolete diagnostic blind-insert reproduction path removed from this editor. Existing database RLS/grants are retained; new RPCs are SECURITY INVOKER and execute is restricted to authenticated callers.

## EXECUTED evidence

- Node 22.23.3, TypeScript no-emit, full npm test suite (including differential tests and screen/component render tests), hook lint, setup navigation, lifecycle/source guards and production build: see final local CI evidence supplied with the package.
- Actual React RoundEditor mounted in jsdom with a simulated network/database: edit 5→7, wait beyond debounce, page-hide, Cancel, unmount, reopen original 5; same-ID edit/date recovery; same-course different-ID isolation; failed save and retry; manual override clearing and immediate Finish; deliberate score deletion and reopen; failed Discard and retry; held in-flight backup then Finish; gross-only rating and handicap corrections. Permanent test: ci/test-personal-round-editor.cjs, included in npm run ci.
- Actual 0159 applied twice and ci/assert-personal-round-persistence.sql executed in isolated PGlite with authenticated-role RLS and the repository's own-round/own-hole policy definitions: retry identity, no duplicates, mid-save rollback, failed creation rollback, final/background lock, manual value/source preservation, scoped discard/retry, cross-user denial, gross-total preservation and anonymous execution denial. This is a selected-contract fixture, not a full Supabase reconstruction.
- lib/golf.ts transpiled runtime output is byte-identical to 192.16: its only change is the Round type's local draft identity. Existing pure scoring differential suites remain part of npm test.
- Source/change-set review: no private credentials, production mutation, generated test outputs or node_modules included. Package/version, release notes and generated version metadata use 192.17.260930.

## Release gates still outstanding

- Full fresh Supabase migration replay and all existing database behavioral/security gates. Attempted locally; blocked because Supabase CLI/Docker are unavailable. ci/test_fresh_db_rebuild.sh now includes the permanent 0159 behavior test, so GitHub's fresh-database job will execute it with the entire schema.
- GitHub-hosted CI/verify, live staging migration parity, real staging integration, Vercel staging Ready, browser/mobile round-history and draft-recovery checks.
- Production promotion, Ready confirmation and non-destructive smoke test. None performed or requested here. Candidate is NOT deployable until required gates pass.

## Staging validation checklist (after the upstream release gates permit staging)

1. Completed round: change one score and stats; Cancel immediately and after waiting; reopen/reload and confirm original database values.
2. Repeat, Save changes, reopen and confirm score/stat/date/handicap values and summaries. Check a game-posted own-ball round without changing the game result.
3. Simulate failed/blocked save; confirm error, no partial database changes, retained draft and successful retry.
4. New personal round: enter scores; lock/reload/resume; Finish; verify one round, correct holes and no later background write.
5. Two rounds at the same course: recover/discard one and confirm the other is unchanged.
6. Live draft: failed Discard retains data; retry succeeds. Finished rounds remain intact.
7. Manual handicap: immediate Finish, edit, clear override and reopen; verify figure/source/allocation/summary. Include 9-hole and 18-hole fixtures; the separate game-to-round nine-hole posting defect H1 remains pending.
8. Historical total-only round: correct rating/slope, date and handicap; preserve gross total and absence of invented hole scores.

## Deferred scope

Pending-access approval remains deferred. G1 game offline recovery and H1 nine-hole game posting are the next separate candidate. Other audit findings (structural partial operations, club-admin zero-row edits, failed reads, notification retries, stale card/badges) remain open. No remediation of previously stored incorrect production scores is claimed. Local draft durability relies on available browser storage; live mobile testing remains required.

Sources: supplied 192.15 audit/reproductions; supplied 192.16 code and security release; actual changed source, regression tests and local logs for this candidate.
