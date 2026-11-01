# 212.78.261101 — manual-handicap comparison correction

Status: CANDIDATE — NOT READY FOR PRODUCTION. Prepared November 1, 2026, from `fairway-web-main (2)(1).zip`, version 212.77.261030.

## Problem and behavior

`buildHighlights` read `Number(p.handicap_index)`, so a missing index became scratch. A manually entered course handicap already controlled strokes and net scores, but did not control the index used in differential/field comparisons. This inflated the field reference and changed other players' comparisons.

The new comparison accessor lives in `lib/game-shape.ts` beside the existing handicap accessors. For an 18-hole comparison, a numeric manual course handicap takes precedence: `(manual CH - (saved rating - saved par)) * 113 / saved slope`. This is a game-specific equivalent index, not an official index or a profile update. Without a numeric manual override use a valid recorded game-row index. Missing/invalid values are unavailable, not zero; an explicit zero is valid. A manual override that cannot be inverted because tee/course data are missing is unavailable rather than compared against a conflicting recorded index.

The existing complete-18-hole eligibility, adjusted-gross cap, differential rounding and thresholds remain. If fewer than eight players have usable comparison data, the existing own-handicap basis applies. No nine-hole standout conversion is added. Manual strokes, net scores, match/team playing handicaps, format allowances and results are not changed by this comparison correction.

The shared builder supplies the app recap, share image, newly built emails, club reports and admin Standout watch. Existing sent emails/published report snapshots are not automatically regenerated. No database migration, profile writes or stored-score rewrite.

## Contract review

Inputs: game par/hole count; player's saved course handicap/source, recorded index, rating and slope. Output: nullable comparison index. No state or database side effects. Existing functions in game-shape remain unchanged except for the additive accessor and pure numeric-reader import. Every relevant consumer was traced to the shared highlight builder; server loaders retain complete player rows. The source guard was strengthened to catch the original nested-cast Number expression; no exemption was added to handicap-source guards.

## Executed evidence

- Node 22, actual source execution: new comparison suite has 90 assertions covering Rajat/PJ, null/undefined/blanks/booleans/nonfinite inputs, explicit zero and plus values, manual precedence, missing tee data, inverse round-trips, non-mutation, incomplete/9-hole exclusion, comparison thresholds, and unchanged manual playing handicaps.
- RENDERED (jsdom): corrected comparison appears in app/share recap and newly generated email output. This is not a live phone/staging test.
- DIFFERENTIAL: actual 212.77 and 212.78 highlight builders were run on the same synthetic eight-player scorecards, with the reported Rajat/PJ CH/rating/slope values and assumed par70. Old field gap9.5; corrected6.4. Net scores/top-net rankings agree. `comparison-21278.json` contains the output and its evidence limits.
- Source guard mutation check: strengthened guard rejects the original 212.77 nested-cast coercion.
- Read-only diagnostic SQL was parsed/executed against the full migrated isolated schema. No matching real game exists in that fixture; no live data was accessed.
- Final whole-suite/guard/build results are recorded below once execution finishes.

## Game-specific evidence still required

The upload supplies application source, not a game identifier or saved game dataset. Retrieved discussion reports Rajat CH10, rating72.3/slope133, gross84/differential9.9; PJ CH22, rating70.7/slope132, gross93/differential19.1. Actual saved game par, full hole scores and teams are not available here. The 6.54/18.23 equivalent indices assume par70; they must not be presented as verified production-game outputs.

`diagnostics/latest-rajat-game.sql` is read-only. It retrieves the latest ended game whose saved player name contains Rajat, including game code/date, par, holes, teams and player snapshots. Confirm that returned game is the reported incident before validating its exact team/field totals. No actual production team-total correction is claimed without those data. Existing team-handicap code already uses manual course handicaps; this patch corrects the demonstrated differential-comparison path.

## Remaining release gates

Remote GitHub CI (including its fresh Supabase rebuild), staging deployment/integration, and game-specific regression remain unverified for 212.78. Production 212.77 remains unchanged. No production deployment is authorized by this verification record alone.

## Final local validation results

- PASS: hooks lint and TypeScript `--noEmit`.
- PASS: full `npm test`, including 90 new comparisons/render assertions and all prior unit/differential/simulation suites.
- PASS: all 159 suites with a clock that advances on every read.
- PASS: all lifecycle/source guards and the unmodified Chromium phone-width gallery check. Local browser: Chromium153; this is rendered-code validation, not a signed-in staging/phone test.
- PASS: assertion ratchet440310 across95 suites; only change from the supplied baseline is the90 new assertions.
- PASS: complete production build, including TypeScript/static generation, with placeholder Supabase inputs and the existing public VAPID key. Build output is excluded from the ZIP.
- IMPORTANT: the combined local `npm run ci` command passed tests/clock/guards/browser, then exited at prebuild because its public VAPID environment value was absent. The build was rerun separately with the committed public key supplied and passed; no check was bypassed. Therefore the combined invocation itself is not recorded as green. Remote CI must pass with its configured environment before release.
- PASS: source/contract comparison found all pre-existing game-shape function and variable definitions unchanged. The accessor addition is central, not a rewrite of scoring rules. Every old migration remains byte-identical. Version metadata agree at212.78.261101; changed-file contents/checksums checked; no secrets, dependencies or compiled outputs packaged.

Execution logs and the clearly labelled synthetic before/after result are included under release-verification/212.78/. No production data was changed.
