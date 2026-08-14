# Release verification 177.20.260813

Status: **STAGING CANDIDATE ONLY**. Do not promote to Production until all remaining gates below pass.

## Scope
- GolfCourseAPI provider-id migration compatibility across search/detail and every known consumer.
- Weekly external-provider contract monitor with admin GitHub issue alerting.
- Explicit PWA update contract: installed shell remains on current release until the user taps Update.
- Release-note duplicate cleanup promised after the prior merge-conflict resolution.

## Evidence / behavior comparison
- Historical BNN data used numeric GolfCourseAPI ids; live Production searches on 2026-08-13 proved the same 18 courses now use alphanumeric provider ids.
- 176.4 added numeric-only detail validation; 177.20 preserves the security objective but validates provider ids as bounded opaque tokens instead.
- Before 177.20 the service worker was network-first, so a newly deployed app shell could load before the user accepted the waiting worker. 177.20 makes the active shell cache-first and makes release-version mismatch, not worker build-id drift, the visible update contract.

## Local validation completed
- `npm run guards`: PASS, including 50,087 workflow-fault checks, player-tee contract, extraction reachability/hygiene/debt, new course-provider-id source contract, and new PWA update contract.
- `lib/course-provider-id.test.ts`: PASS for all 18 current provider ids, legacy numeric id, normalization, and unsafe-input rejection.
- 177.20 model simulation: PASS for current/legacy/invalid provider ids, passive new-release detection, explicit apply, and same-version rebuild behavior.
- Candidate diff reviewed against 177.19 baseline; no database migration is included.

## Environment-limited / remaining mandatory gates
The local dependency install was incomplete in this environment, so the full dependency-backed suite is NOT claimed as passed here. Staging must complete:
- `npx tsc --noEmit`
- full `npm test` including differential tests
- `npm run build`
- GitHub CI + Robustness
- Vercel staging build
- targeted staging course search/detail smoke test using Francis Byrne (`5wng1nrq`)
- GitHub External API Contracts manual run after adding repository secret `GOLF_API_KEY`
- targeted PWA same-version/update UI checks; the future-release hold behavior is additionally covered by source-contract + model testing because 177.19's already-active network-first worker cannot retroactively pin the transition into 177.20.

## Production smoke after promotion
- Add Course: Francis Byrne search -> detail opens; existing canonical course is reused/no duplicate.
- New Round: course search/detail works with opaque ids.
- Help: Current/Latest are coherent and no same-version false update prompt appears.
