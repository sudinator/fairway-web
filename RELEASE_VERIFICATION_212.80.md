# 212.80.261101 — update feedback and dismissal

Status: full clean local CI PASS; ready for staging review. No production deployment/merge performed. GitHub CI and staging checks remain required.

## Defect and change
212.79 posted SKIP_WAITING and reset its button after six seconds without an outcome, leaving a persistent banner. It provided only a generic Settings pause sentence. This release adds explicit worker acceptance/refusal with reasons, timeout/download/restart failures, per-release dismissal and a shared update controller across Settings and banner.
Success is reported only when the installed APP_VERSION equals the requested target after reload. Accepted worker activation is only a reloading state, not success. A reload into a different version reports the actual installed version without claiming success.

## Protection and diagnostics
- Existing active-session/pending-score protection remains. Dismiss changes display preference only, never scores, drafts or protection records.
- Current local blockers are live and name known game name/code, course/date, pending player rows and hole counts. Other-tab reasons are labelled as results from the last attempt and rechecked on Update.
- Checklist instructions preserve data: continue playing; organizer finishes after play; resume/save or deliberately discard an unwanted personal round; Sync now for pending edits; organizer reopens ended games for corrections; finish/sync and close legacy/nonresponding tabs. No force-update or clear-storage button.
- Unavailable details are labelled honestly; unknown/stale records are never silently deleted to make an update pass.
- Shared Settings/banner activation rechecks safety after download. Waiting-worker installation errors do not fall through into a navigation reload.

## Baseline and scope
Available 212.79 candidate source. No fresh remote checkout is available here; compare with synchronized GitHub branches before applying and preserve newer unrelated changes. Full source delivery. No SQL migration, scoring-rule change or obsolete-file cleanup.

## Executed evidence
- EXECUTED: clean final `npm run ci` exited 0 on Node 22, including hooks lint, typecheck, device/editor/recovery checks, unit/render tests, changing-clock runner, lifecycle/source/style guards, gallery overflow and production build.
- EXECUTED: 440,386 assertions across 97 reported suites; 38 new update-feedback assertions and the retained 38 update-safety assertions. All 161 suites passed changing-clock execution.
- EXECUTED: real RegisterSW controls through refusal -> specific visible reason -> Details -> Dismiss -> passive and manual same-release checks -> new-release announcement. Settings retains the result after dismissal. Tests cover failed communication, network/download stalls, accepted-vs-installed distinction, reload mismatch, verified installed success, late unconfirmed activation receipt and data preservation.
- EXECUTED: diagnostic names/codes, round dates, player/count, metadata backfill, sync resolution, deliberate-discard wording and no score/draft removal.
- EXECUTED: real Chromium using actual worker/policy/responder across two releases/tabs: active-game veto with returned reason, nonresponding-tab veto with returned reason, accepted safe activation and unchanged scores. These are local fixtures, not authenticated live scoring.
- EXECUTED: available, paused, installed and checklist components rendered from current source at 390px phone width and visually reviewed. No internal screenshots included.
- EXECUTED: all 231 SQL files unchanged; game-highlights, game-shape, player-scoring and game-results unchanged. No migration or scoring-rule change.
- Two design-scale padding exceptions and one hardcoded off-palette use were removed; the existing ratchets were lowered to preserve those improvements, not loosened.
- Evidence: release-verification/212.80/local-ci.log and unit-render.log. Earlier diagnostic attempts are not release evidence.

## Required external checks
- GitHub CI and branch parity.
- Staging: tap Update with a nonresponding older tab and verify specific refusal and recovery text; resolve then retry.
- Dismiss banner, reopen/focus same release: stays dismissed. Settings remains usable. Newer release may notify again.
- Active game/personal round and pending scores: no passive update banner; Settings identifies known items and instructions. Completing or syncing clears current local checklist items. No data is removed.
- Successful update: reload into target version, explicit installed confirmation; mismatch/unconfirmed restart cannot report success.
- Phone width, long labels, Details scrolling/close, and scoring recovery smoke.

## First transition
Already-loaded old builds cannot retroactively receive the new controls/messages. For the presently stuck old banner, finish and sync scores, close every BNN tab/window, reopen, and verify version 212.80 under Help → App version & updates. Do not clear browser data or uninstall to force an update. A transition initiated by an old build without the new attempt marker may not show the new success notice; the installed version in Settings is the verification for that one-time transition. New 212.80-originated update attempts have the explicit confirmation path.

## Delivery
Full source ZIP: fairway-web-212_80_261101.zip, with current verification and logs. No secrets, dependencies, build caches, generated test output or internal screenshots. Historical source/CI/migrations retained.
