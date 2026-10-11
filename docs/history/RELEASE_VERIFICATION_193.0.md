# BNN 193.0 — One primary scoring device per account

## Result and scope

Personal rounds, own-player game scores/stats, marker writes, Alternate Shot, and games linked to a Ryder Cup share one account-level primary device. Opening another instance does not transfer control; Make this device primary requires online confirmation. Existing RLS and scoring roles still apply. Control does not expire during offline play. An old device's queued writes are fenced at the database, and its pending local work is preserved/downloadable.

Server enforcement uses migration 0162: a private RLS-enabled scoring_devices table, authenticated account-scoped claim RPC, and write triggers on rounds, holes, game_players, game_alt_shot_scores and games (scoring control/status fields). Account advisory locks serialize accepted score mutations with transfer, including SECURITY DEFINER functions. A token alone cannot grant another user's game permissions. Trusted server jobs without end-user auth.uid keep their existing privileges; end-user posting, status/reset and marker changes also require the primary device.

Browser requests capture their runtime token in x-bnn-scoring-device. Normal tab resume rotates the old token and recovers that tab's saved work. A fully closed known mobile installation can reopen offline from its last primary token; an online explicit resume recovers that installation's pending work only if the server confirms its old token was still primary. Pending storage is isolated by token to prevent shared-browser stale outbox contamination. Viewers never reconcile or acknowledge pending game work, and personal viewers refresh the remote card without saving it. A transfer archives old work and reloads from server data; it does not merge conflicting offline scores. Download saved scores provides the JSON recovery archive; automatic archive restore is deliberately not offered.

## Executed local evidence

- Actual controller with independent tab runtimes and simulated claim server: phone-first activation, passive desktop, explicit transfer, offline primary, old-tab fencing, isolated storage, normal/offline reload, archive retention, failed checks.
- Actual React RoundEditor with simulated Supabase: previous atomic Save/Cancel/Discard/recovery tests, untouched primary lifecycle flush denial, disabled viewer controls, current remote score/handicap display, failed-read retention, viewer close without server discard.
- Actual own/group scorecards with DOM clicks: primary opens the picker, viewer cannot open it, revocation removes an already-open picker, and primary/viewer/primary re-entry never resurrects it.
- Actual GameRoom load/send callbacks and shipped helpers with fault-injected reads/writes: prior correction/deletion/stat/reset/queue cases plus viewer remote scores and untouched pending backups/watermarks.
- Actual migration 0162 applied twice in isolated PGlite with authenticated roles/RLS. Real save_personal_round, discard_personal_round, save_hole_stats and save_alt_shot_side_score calls verify old/headerless token rejection, current saves/clears, unchanged stored scores after denial, passive claim, explicit transfer, resume rotation, independent users and private/anonymous grants. Previous personal-round SQL assertions also passed. This fixture is not a full Supabase reconstruction and does not simulate concurrent database connections.
- Full local `npm run ci`: PASS, exit 0 (controller/real card/editor/game recovery tests, hook lint, TypeScript, existing unit/render/navigation tests, lifecycle and source guards, production build). Additional shipped HTTP-adapter test: PASS, preserving auth headers and fencing error response while updating viewing-mode state.

## Remaining gates and limits

GitHub must run the full migration chain on fresh Supabase and the authenticated staging integration suite. The SQL suites and integration accounts now provide the same device headers/claims as the app. Manual phone/PWA/desktop cases in TEST_PLAN_193.0.md remain unexecuted. No staging/production database was accessed from this workspace.

A disconnected old device cannot immediately learn it lost control; the server rejects its writes when it reconnects. Foreground/focus/online checks and a 20-second poll update its UI. Offline duplicate copies may temporarily both accept local input; server token fencing prevents both from persisting after an online resume/transfer. Clearing browser storage or opening another browser requires explicit online takeover.

Apply 0162 and deploy 193.0 together to staging, then reload the phone online first. Old clients without the device header cannot score after the migration. Legacy unscoped drafts are archived for download on first activation rather than auto-uploaded; verify pending scores before upgrade. Production remains deferred until this gate and the remaining audit findings are resolved.

## Sources

Implementation: components/home.tsx, components/scoring-device.tsx, components/round-editor.tsx, components/tournaments.tsx, lib/scoring-device.ts, lib/supabase.ts, lib/draft.ts, migrations/0162_primary_scoring_device.sql.
Tests: ci/test-scoring-device.cjs, ci/test-device-view-cards.cjs, ci/test-personal-round-editor.cjs, ci/test-game-score-recovery.cjs, ci/assert-primary-scoring-device.sql, ci/test_fresh_db_rebuild.sh, ci/integration/staging.mjs.

## Suggested pull request

Title: 193.0 — One primary scoring device across personal rounds and games

A second instance of the same scorer account now stays in viewing mode until an explicit online takeover. Database token guards prevent old/background/offline requests from changing personal scores, game scores/stats, Alternate Shot and scoring control after transfer. Pending work is account/runtime-isolated and preserved; personal viewers refresh saved scores without submitting stale cards.

Validation: full local CI/build passed; actual React/card/controller/HTTP tests passed; authenticated isolated SQL regression passed with 0162 applied twice. Requires migration 0162 and the fresh Supabase/staging integration jobs, plus manual phone/desktop gates. Production remains deferred.
