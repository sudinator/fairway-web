# Release Verification — 178.11.260828

## Scope
Documentation/release-contract correction only on top of the unchanged 178.10 P1 scoring fixes. No scoring logic change and no migration.

## Root cause of failed 178.10 staging verify
`ci/verify_release.py` intentionally reads line 1 of `DEPLOY_NOTES.md` and requires it to begin with the current `## <version>` heading. The pristine 178.9 file followed that contract. The 178.10 package accidentally inserted `# Birdie Num Num — Deploy & Migration Notes` above the release heading, so the version-consistency guard failed even though GitHub reached the guard phase and reported 6,776 test assertions across 40 suites as passing.

## Fix
- Removed the accidentally-added generic title from the top of `DEPLOY_NOTES.md`.
- Added 178.11 as the first release heading.
- Bumped `package.json` and root package-lock metadata to 178.11.260828.
- The two 178.10 scoring fixes and their scoring-contract guard are unchanged.

## Behavior comparison vs 178.10
No application behavior changed. Inputs, outputs, callbacks, state updates, database writes, scoring algorithms, persistence, betting, leaderboard behavior, and round posting are byte-identical to the 178.10 scoring candidate except for release metadata/docs.

## Required validation
Run normal GitHub `npm run ci` on staging. The specific prior blocker is resolved only if `ci/verify_release.py` reports `DEPLOY_NOTES newest entry is 178.11.260828` as PASS. Then the remaining staging integration and Vercel staging gates must pass before production promotion.
