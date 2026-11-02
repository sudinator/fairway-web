# 212.83.261101 — correction links and source clubs

Candidate full-source release. No production/staging deployment, database writes or migration performed by this session.

## Behavior
- The update-warning checklist, banner and saved-score difference review show a clickable item title and Club: source name. Game-player pending edits and Alternate Shot team drafts link to their game; tracked personal rounds and edits link to their personal round.
- Game/round metadata comes from authenticated Supabase reads with club-name joins; persisted metadata and matching boot-cache group IDs support names offline. Missing metadata is explicitly unknown, never inferred from the current club. Unaffiliated personal rounds say no club.
- In-app taps resolve the exact database UUID and source club before opening it; TST05/test games work independently of the existing numeric-code links. A copied/opened link resolves on startup before ordinary game/round auto-resume. The update-details sheet closes on the tap. Existing six-digit game links are unchanged.
- Repeated game/editor navigation uses a visit key so React cannot leave the previous item rendered when the same component is already mounted. Cross-club navigation updates the normal active-club preference; no game/round scores are uploaded or discarded by navigation.
- Missing, offline/unreadable or inaccessible items report a clear explanation and preserve data/current view. Opening a different personal round is refused while another personal draft has unconfirmed changes, preventing replacement of its single draft slot. Pending drafts from other scoring identities are not silently imported or deleted.

## Evidence
- EXECUTED navigation suite: 24 assertions covering actual anchor rendering, click-to-event-to-controller-to-state behavior, club identity, player/team outbox targets, rounds, UUID parsing, missing/access failures, A/B round trips, re-entry, stale reads and startup links.
- EXECUTED actual Home correction-adapter object and Tournaments root extracted from shipped source, with MODELLED network and GameRoom/editor views: cross-club route/scorecard target, TST code, A/B/A, Back and re-entry, owned personal-round read/holes and prevention of overwriting another pending personal draft. No game/round write is called. This does not replace live staging testing.
- EXECUTED saved-score verification regression suite now includes actual review club/link rendering alongside212.82 recovery/archiving checks.
- Local fixture render of the actual review component at390px reviewed; internal screenshot is not live-app evidence and is not included as a deliverable.
- EXECUTED final full local CI/build with TZ=UTC: all device/editor/game-recovery checks, lint, typecheck, 440,505 reported assertions across100 suites, 164 moving-clock suites, source/security/lifecycle guards, gallery overflow, actual-worker update/recovery browser tests and production build PASS. See release-verification/212.83/local-ci.log. The host defaults to Asia/Bangkok; an earlier run hit an existing course-date test's hard-coded day wording, so final CI was run in UTC. Course/date application code was not changed.
- Normal manual club switching after a correction link is included in the executed Home/Tournaments regression. It returns to the club's game list; following the same correction link again opens the intended game.
- Link text uses the standard cream with gold underline to preserve readable contrast on the green card. The last styling change was also checked by targeted lint.
- All231 migration SQL files are byte-identical to212.82. No migration required. GitHub/staging integration and the actual affected phone remain external checks.

## Required external checks
Push to staging, require GitHub verify plus staging integration, then validate on the affected iPhone at version212.83.261101. Settings → App version & updates → Verify saved scores should show real club names. Tap a warning for a game in a different club; verify the club picker/banner and named game are correct, including a TST game. Return and tap another warning. Open a pending personal round; Save/Cancel/re-entry must retain existing recovery behavior. Test an unavailable item and confirm the explanation. Current phone backups have not been read directly by this session.

No SQL migration is required. All212.82 verification/recovery and212.81 stat corrections are retained. Automatic stale-game completion policy is unchanged. No unrelated source cleanup.
