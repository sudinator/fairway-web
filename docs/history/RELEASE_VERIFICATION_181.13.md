# Release verification — 181.13.260903

## Scope

One narrow maintainability correction: `courseHandicapExact` is the single TypeScript implementation of the WHS Course Handicap formula. `courseHandicap` handles display rounding and `chBasis` handles game/nine-hole use by delegating to it.

Version 181.13 restores the 181.11 behavior for offline reconciliation, Team Skins and Ryder Cup aggregation. It replaces the broader 181.12 Staging candidate.

No migration is required. Migration 0148 remains current.

## Required evidence

- Course Handicap source contract passes 5/5.
- Exact and nine-hole equivalence tests pass.
- Full unit/render suite, TypeScript, security, migration, design and mobile gates pass.
- Production build passes with deployment environment variables supplied.

## Staging smoke test

1. Open a known existing game, preferably game 645502.
2. Confirm player Course Handicaps and stroke dots have not changed unexpectedly.
3. Confirm its previously verified Trifecta results and 6–3 Ryder Cup session total remain unchanged.

No special offline, malformed-data or legacy-Trifecta testing is required.
