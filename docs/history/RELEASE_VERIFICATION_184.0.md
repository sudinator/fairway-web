# BNN 184.0.260906 — Staging verification

## Outcome

The public share page keeps its own display but no longer its own arithmetic. Its matchup scoring lives in `lib/live-scoring.ts`, and CI holds that module against the app's own answers for every format the page renders.

## Database

No migration. 0150 remains current.

## What the extraction corrected

| Case | Live page before | Now |
|---|---|---|
| Nine-hole singles match | raw 18-hole handicap (~double strokes) | halved, matching chBasis |
| Nine-hole four-ball | raw 18-hole handicap | halved |
| Decided singles / four-ball | count-based, margin kept moving past close-out | frozen at the close-out |

## Executed checks on the patched tree

- `lib/live-parity.diff.test.ts` — 56 field comparisons across 8 real-data fixtures, 0 mismatches; fence detects the pre-184.0 behaviour on 4 of 5 non-Trifecta fixtures.
- `ci/check_live_parity_coverage.py` and `ci/check_trifecta_one_singles_source.py` — pass; both negative-tested.
- `npm test`, `tsc --noEmit`, `eslint --max-warnings=0`, full `npm run guards` — green.

## Manual Staging check

1. Share a Trifecta (641032): singles read "won 4 & 2" / "lost 4 & 3" as in 183.1; nothing regressed.
2. Create and share a NINE-hole singles match with two test players. Strokes given on the share page must equal the app's, and the margin must match Results. This is the case that was wrong before 184.0.
3. Create and share a NINE-hole four-ball. Same comparison.
4. Play a match past its close-out (e.g. 4 & 2 on the 16th, then score 17 and 18). The share page must still read 4 & 2.

## Known not covered

Alternate shot (no live branch), skins (separate path), guest players (dropped by the RPC), and the leaderboard/Stableford side of the page. Listed in BACKLOG; not claimed by this release.

## Release gate

- TypeScript
- Unit, differential and rendered interaction tests
- Live/app parity harness and coverage guard
- Security/RLS guards
- Display-scale, contrast and mobile-fit guards
- Production build
