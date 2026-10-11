# 179.6 Staging verification — complete Ryder Cup overlay

## Build correction

1. Confirm GitHub CI/type/test/build is green.
2. Confirm the Vercel Staging deployment is Ready and no longer reports a missing `competitionOutcome` export from `lib/competition.ts`.
3. Confirm the deployed version is `179.6.260902`.

## Combined browser acceptance

1. Repeat every check in `RELEASE_VERIFICATION_179.4.md` against the weighted live Ryder Cup state.
2. Repeat every check in `RELEASE_VERIFICATION_179.5.md`, including one newly created Four-Ball, Alternate Shot, and Singles session game.
3. Confirm ordinary standalone Games retain their prior side-game defaults.
4. Confirm existing Ryder Cups and their linked games still open and score normally.

## Blocking release gates

1. Run `npm run ci`.
2. Run `npm run test:staging` against Staging only.
3. Confirm migration 0143 is present and verified in Production before merging application code that depends on it.
4. Obtain product/legal approval for use of the third-party `Ryder Cup` name in Production branding.
5. Open the `staging` to `main` PR only after all preceding checks pass; required PR verification must be green before merge.

No new migration is included in v179.6.
