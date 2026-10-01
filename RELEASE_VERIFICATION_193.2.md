# 193.2 CI-only posting-fixture correction — UNVERIFIED / NOT READY FOR DEPLOYMENT

The GitHub screenshot shows the reset SQL and independent-connection concurrency tests passed, then ci/assert-game-round-manual-handicap.sql failed with BN163. Its scored-player fixture INSERTs lacked the new reset-version context.

Correction: both fixture INSERT sites now call begin_game_score_write(gid,0) for the newly created game while keeping the authenticated primary-device context and all database guards enabled. The isolated runner now loads the actual 0161 posting functions and executes this posting fixture alongside 0162/0163. No application code or migration SQL changed from 193.1.

## Executed evidence

- Reproduced the original fixture failure with SQLSTATE BN163 in PostgreSQL/PGlite, rolled back, then executed the corrected fixture successfully.
- Actual posting SQL: 48 combinations of game/group posting, 9/12/18 holes, manual/derived handicap and four handicap values; actual conflict assignments, repost/date preservation, audit metadata, excluded formats and outsider permissions passed.
- Actual 0163 applied twice; reset/stale-write/RLS matrix and nine/18/back-nine setup round trip passed.
- Full npm run ci passed (exit 0): scoring-device, round-editor and reset/recovery tests, lint, TypeScript, unit/render tests, source guards and production build.
- All migration SQL files byte-compared unchanged from the delivered 193.1 candidate.

Environment: local Node 24.19.0 and cached lockfile-matching dependencies. SQL ran in a real PostgreSQL/PGlite engine over an explicitly MODELLED prerequisite schema; it is not a complete Supabase reconstruction. No browser or live staging validation is claimed. The dependency currency monitor could not reach the registry; it is advisory by the project's existing script.

## Remaining gates

GitHub must rerun the entire fresh Supabase reconstruction, independent-connection tests, remaining SQL fixtures and Node 22 CI against this correction. The previous screenshot proves only the displayed earlier stages. Full PR checks, staging integration and production-readiness gates remain pending. Keep the draft PR targeting staging; do not merge or manually apply SQL yet.

## Apply

Overlay the correction ZIP onto the existing checkout on ci/193.1-reset-protection. Commit and push that same branch to update the existing draft PR. No new branch or PR is needed.

Evidence: verification/193.2/local-ci.log and verification/193.2/isolated-sql.log included in the ZIP. The original failing screenshot was supplied by the user.
