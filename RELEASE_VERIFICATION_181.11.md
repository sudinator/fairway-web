# Release verification — 181.11.260903

## Scope

This release fixes Ryder Cup Trifecta match results that continued counting holes after mathematical close-out and displayed impossible final margins such as `5 DN` or `8 DN`.

- One shared match close-out model now supplies the official result, lead and thru value.
- Trifecta Singles and Best-Ball contest rows render the official close-out result.
- Expanded Trifecta progression stops at the official close-out hole.
- Later gross scores remain stored for the player's round and are not deleted or rewritten.
- Ryder Cup aggregation now consumes the same shared close-out model instead of a private duplicate.
- No database migration is required. Migration 0148 remains current.

## Exact game 645502 regression

The permanent fixture reproduces the inspected Staging game:

- Francis Byrne Golf Course, nine holes.
- Three complete 2-v-2 groups.
- Cross Singles pairing in every group.
- Twelve real test-player names and their inspected handicap indexes.
- Full handicap allowance and Best-Ball team contests.
- Par entered for every player on every hole.

The model asserts all nine official results and the session total:

| Group | Contest | Expected result |
| --- | --- | --- |
| 1 | A.J. Patel vs R. K. Srinivasan | Burgundy 3 & 2 |
| 1 | Bo Li vs Amit Sud | Burgundy 5 & 3 |
| 1 | Best Ball | Burgundy 4 & 3 |
| 2 | Christopher Alexander Reed vs DeShawn Brooks Jr. | Violet 5 & 4 |
| 2 | Lex Rivera-Santos vs Chris O'Neal | Violet 5 & 3 |
| 2 | Best Ball | Violet 5 & 4 |
| 3 | Michael Van Der Meer vs T.J. Wu | Violet 5 & 4 |
| 3 | Sebastian Montgomery vs Marcus Johnson | Violet 4 & 3 |
| 3 | Best Ball | Violet 5 & 4 |

Expected session total: **Violet 6 – Burgundy 3**.

The real rendered `FourballView` additionally asserts that `3 & 2`, `5 & 3`, and `4 & 3` are visible and that `5 DN` and `8 DN` are absent.

## Automated verification

- Game 645502 scoring-model regression: **passed**.
- Game 645502 real-component rendering assertions: **5/5 passed**.
- Competition suite: **16/16 passed**.
- Screen-render suite: **67/67 passed**.
- Full test baseline: **189,953 assertions across 43 suites passed**.
- TypeScript, lint, lifecycle, security/RLS, fresh-database migration, design-scale and mobile-fit gates: **passed**.
- Production build: **passed** with placeholder local Supabase values and the documented `VAPID_CHECK_OPTIONAL=1` local-build opt-out. Staging must supply its real environment values.

## Staging acceptance

1. Install 181.11 on Staging; do not run a migration.
2. Open game 645502 and refresh once so the new client is active.
3. Confirm Group 1 shows `3 & 2`, `5 & 3`, and `4 & 3` rather than `5 DN` or `8 DN`.
4. Confirm the other six results match the table above.
5. Confirm the Ryder Cup session total is Violet 6 – Burgundy 3.
6. Expand a completed contest and confirm progression stops at its mathematical close-out.
7. Confirm each player's complete nine-hole gross score remains present.

