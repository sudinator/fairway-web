# BNN 183.0.260906 — Staging verification

## Outcome

Trifecta has one rule: two genuine 1-v-1 singles plus a four-ball, one point each, decided as matches. The per-hole variant is removed from the engine, the create form, the in-game setup, the setup policy and the public live page. Migration 0150 pins the column to that rule.

## Database

Migration 0150 (`0150_trifecta_single_rule.sql`): default 'match', backfill of non-'match' rows (production query on Sep 6 returned none), CHECK constraint. Idempotent. Run before deploying the app: with the old default 'per_hole' the new client never reads the column's value, but the Ryder Cup trigger (0146) rejects 'per_hole' rows.

## Real-data verification (engine, patched tree)

| Game | Single | Result | Regression fence (old per-hole number) |
|---|---|---|---|
| Architects Jul 5 | Sachin v BK | 5 UP (4 & 2); 2UP thru 14 | not 4UP / 1UP |
| Architects Jul 5 | Karan v Ashutosh | 3 & 1 | — |
| FB 6/21 | Gaurav v Masud | 5 DN (4 & 3) | not 4DN |
| FB 6/21 | Karan v Amit | 4 & 2 | — |

## Executed checks on the patched tree

- `npm test` — all suites green, including scoring matrix (3,698), competition (16), trifecta fixtures (15), rendered Trifecta card (8), screen render (67 / 25 / 18).
- `tsc --noEmit`, `eslint --max-warnings=0`, full `npm run guards` (incl. new `check_trifecta_single_rule.py`) — green.
- Guard negative tests: an 8-argument `computeTrifecta` call, an 8-parameter declaration, and a `per_hole` token in production source each FAIL the guard.

## Manual Staging check

1. Apply migration 0150; confirm `select trifecta_scoring, count(*) from games group by 1` shows only 'match' and null.
2. Create a Trifecta game: the format step shows a single scoring description and no "1 hole = 1 pt / 1 match = 1 pt" toggle. Save; `games.trifecta_scoring` = 'match'.
3. Open an existing Trifecta (557495 Architects replay): Setup → Format shows no "Trifecta scoring" block; Results unchanged — R.K. v Lex 5 UP / 4 & 2, Marcus v T.J. 3 & 1, team leg 1 UP.
4. Ryder Cup: seed a Trifecta session; creation succeeds (trigger requires 'match', which is now the only value).
5. Public live share of a Trifecta: standings footer reads "N matches still out" / "All matches in"; no "points" wording.

## Release gate

- TypeScript
- Unit and rendered interaction tests
- Trifecta single-rule guard
- Migration ledger / manifest / immutability guards
- Security/RLS guards
- Display-scale and mobile-fit guards
- Production build
