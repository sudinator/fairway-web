# 212.79.261101 — update deferral candidate

Status: full local CI PASS. Ready for staging review; NOT production deployed. Staging and GitHub CI remain required.

## Scope
- Defer banner, Settings activation and controller-change reload while a game/personal-round editor is active, including after navigation away; block while score/stat/deletion outboxes remain pending.
- Persistent sessions use separate keys, avoiding read-modify-write races between tabs. No timeout clears a scoring session.
- Bootstrap fails closed until local protection records have been checked. Server errors/missing rows never prove completion.
- A waiting worker requires an explicit ready acknowledgement from every open window. Missing/old/frozen tabs veto. Ready windows briefly lock new input during the handshake; veto releases input.
- Personal completion/discard and confirmed local game deletion release their session. Games concluded elsewhere are reconciled via bounded reads, retaining score backups.
- No migrations, database writes from the update policy, scoring-rule changes, or obsolete-file cleanup. Preserves 212.78 handicap correction.

## Baseline
Available local 212.77 source plus the exact persisted 212.78 candidate. This environment has no fresh synchronized GitHub checkout. Compare with current main/staging before committing; preserve newer branch work.

## Executed evidence
- EXECUTED: final `npm run ci` exited 0 on Node 22, including hooks lint, typecheck, score-device/editor/recovery tests, complete unit/render suite, lifecycle/source guards and optimized production build.
- EXECUTED: 440,348 assertions across 96 reported suites; 38 new update-safety assertions. 160 suites also passed the changing-clock runner.
- EXECUTED: actual RegisterSW banner and Settings component hide/return/hide through active -> ended -> reopened state. Actual input-lock hook blocks input during activation and restores it on cancellation.
- EXECUTED: real Chromium, actual policy + responder + service worker, two release versions, two tabs: active-game veto, nonresponding legacy-tab timeout veto, successful safe activation and unchanged stored scores. This uses local fixtures, not signed-in live scoring.
- EXECUTED: failed/corrupt storage, other-token pending scores, intentional deletion, alternate-shot drafts, personal-round drafts, navigation away, server-error/missing-row refusal, completion/discard, bootstrap recovery, and stale ended-read vs reopened-session race.
- EXECUTED: current Settings component rendered at 390px phone width and visually reviewed; gallery overflow gate passed. Screenshots were for internal review and are not included.
- EXECUTED: all 231 SQL files in both migration trees match the previous baseline byte-for-byte. No migration to apply.
- EXECUTED: actual setMyHole, setPlayerHole, setAltShotSideHole and pushScores declarations match the baseline; 212.78 game-highlights correction preserved.
- Final evidence: release-verification/212.79/local-ci.log and unit-render.log. Earlier failed/diagnostic runs are not the release evidence.

## Pending external verification
- GitHub branch parity and CI.
- Staging authenticated flow: active game -> no banner/Settings update -> navigate away -> still deferred -> end game -> wait for final save -> update offered; reopen -> hidden again.
- Repeat personal round, marker/group card, alternate shot and offline/reconnect paths on a phone.
- Real app two-tab integration with actual auth/scoring; automated browser proof exercises the actual policy/responder/worker with local fixtures, not a signed-in production session.
- Production smoke only after approved merge.

## First rollout and limitations
Old already-open builds cannot respond to the new worker safety protocol. The new worker therefore refuses forced activation while they remain open. After finishing and syncing the round, close all BNN tabs/windows and reopen. Do not force an update during scoring.
An already-running OLD build cannot be retroactively given the new banner/reload guards. The incoming new worker vetoes worker activation without acknowledgements, but the old build still has its old navigation/reload fallback. For the first rollout, install after finishing/syncing by closing all BNN windows and reopening. The complete guarantees described here apply once 212.79 is loaded.
An unresolved draft, failed storage, failed/missing status read, or sleeping tab can keep updates deferred. No expiry/forced override is supplied. Finish/discard/resume through existing app flows; retain recovery data.
This protects app-initiated updates, not manual browser refresh/close or arbitrary incompatible future database/API changes. Existing local recovery remains in place.

## Delivery
Full source ZIP: fairway-web-212_79_261101.zip. Excludes node_modules, local environments, .next, generated test outputs/caches and screenshots. Historical source/CI/migrations remain included. No deployment or PR creation performed here.
