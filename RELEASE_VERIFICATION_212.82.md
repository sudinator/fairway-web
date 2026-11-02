# 212.82.261101 — saved-score verification and update recovery

Candidate full-source release. No deployment, database writes or migrations performed.

## Result
Settings separates installed-version success from saved-scoring warnings. A new Verify saved scores flow is run on startup/focus/version checks and manually from Settings. It reads player-score rows through the signed-in Supabase client/RLS; it never uploads scores. Pending local copies across device-token scopes are compared with server values for strokes, putts, fairways, penalties and sand. Verified matching copies receive a local sync confirmation without changing their scores. Zero/default penalty and sand values are normalized; missing scores, deletions and trailing values remain meaningful.

Differences show game, player, scheduled scorecard position, field and both values. Keep saved scores leaves pending protection intact and explains correction recovery. Download saved scores exports the original backup. Use database version is offered only for completed games, has a separate confirmation, re-reads current server/local data and requires the same review. No mounted scoring editor and only one service-worker browser window are required. A recovery archive must be saved and read back before the local backup is replaced. It never writes to the database. Recovery copies remain downloadable in Settings; export them before sign-out or clearing website data. Re-entry does not recreate a resolved warning.

Offline, missing/RLS-hidden rows, malformed data, timed-out reads, failed archive writes, reset-version mismatches, reopened games, concurrent edits or unresponsive/multiple browser windows remain protected. Personal-round and Alternate Shot outboxes retain their existing scorecard recovery paths; this release does not silently discard them. Verification is not a merge algorithm and never assumes local or database values are correct when they differ.

## Evidence
- EXECUTED new unit/render suite: 35 assertions, including actual buttons through confirmation, archive, derived blocker removal, rendered recovery, cancellation, re-entry, offline/read rejection, concurrency, resets, malformed data and archive failure.
- EXECUTED real Chromium: existing update activation/legacy-tab safeguards plus actual worker/policy recovery: another window vetoes replacement; one window permits explicit database choice, original differing score remains archived and pending blocker clears.
- EXECUTED local fixture render of the actual review component at 390px: comparison and confirmation reviewed, scroll width390 equals viewport390. This is a local fixture, not live staging/iPhone evidence. Internal screenshot omitted.
- EXECUTED local CI: scoring-device, personal editor, game recovery, lint, typecheck, unit/render, moving-clock runner, lifecycle/source/security guards, assertion baseline, phone-width gallery and real-browser update/recovery checks all PASS. 440,480 reported assertions across99 suites; 163 suites pass the changing-clock runner.
- EXECUTED production build PASS, exit0. The initial CI build stopped because a local dependency symlink pointed outside the build root. Replacing that workspace-only link with hardlinked dependencies fixed the setup; the unchanged application then built successfully. This is not a claim of a single uninterrupted npm run ci exit0. See local-ci.log and production-build.log.
- All231 migration SQL files byte-identical to212.81. No database/security-contract changes.
- Live staging integration was not executed here because staging credentials are unavailable. GitHub verify/staging integration and actual iPhone validation remain required external gates.

## Staging checklist — required before production
1. Push this full source to staging and require GitHub verify plus staging-integration checks to pass. No migration SQL is required.
2. On the affected iPhone, confirm Current version 212.82.261101. A phone still on212.81 does not have this new verification UI; do not clear website data to force it. Finish score entry, allow the update to download, close other BNN windows/app and reopen; confirm the installed version. If it remains on212.81, report it before attempting any data removal.
3. Settings → App version & updates → Verify saved scores. Matching test backups should clear; current/latest matching should say You’re up to date regardless of remaining scoring issues.
4. Review one genuine difference. Keep saved scores/Cancel must preserve it. Download the original. For a completed game, explicitly choose Use database version, confirm, and verify the recovery copy remains downloadable and database scores remain unchanged.
5. Confirm active games, other open windows and offline/unreadable cases remain protected. Check an ordinary real score save and resume on the primary device.

Actual affected-phone backups have not been compared directly with live staging by this session. The earlier empty database audit excludes unfinished server games/rounds, not local score differences. No claim that the supplied TST warnings were all stale confirmations or that any actual phone record has already been repaired.

## Scope
Retains212.81 recap fixes and212.80 update feedback. No stale-game completion policy change, no cleanup of test games and no unrelated source removal. Local full CI evidence and code hashes accompany the full ZIP. GitHub/staging/actual iPhone checks are external gates, not replaced by the local fixtures.
