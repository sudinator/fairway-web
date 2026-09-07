# BNN 184.1.260906 — Staging verification

## Outcome

One close-out rule across every surface, the public share page scrolls, and the row that highlights a winner no longer calls them the loser.

## Database

No migration. 0150 remains current.

## Real-data reproduction

| Case | Before 184.1 | Now |
|---|---|---|
| 571157 Group 1 (app four-ball card) | 8 UP at the 9th | 5 & 3, frozen at the 6th |
| 268834 Amit v DeShawn (app match card) | running 5 | 3 & 2, frozen at the 7th |
| Any share link below the fold | unreachable — no scroll container | scrolls |
| 641032 share row, Christopher highlighted | "lost 4 & 3" beside his name | "won 4 & 3" |

Handicaps were never wrong in these cases — the app was showing the running count instead of the decided margin.

## Executed checks

- `lib/closeout-freeze.test.ts` — 16 assertions across both staging games; running counts pinned as a fence.
- `ci/check_live_route_contract.py` — passes; negative-tested for the missing scroll container, a relaxed global lock, and left-player wording.
- Existing parity harness (56 comparisons) and Trifecta fixtures unchanged and green.
- `npm test`, `tsc --noEmit`, `eslint --max-warnings=0`, `npm run guards` — green.

## Manual Staging check

See the v184.1 checklist at the top of BACKLOG.md. The phone scroll test matters most: it cannot be verified in CI.

## Release gate

- TypeScript
- Unit, differential and rendered interaction tests
- Close-out, parity and live-route guards
- Security/RLS guards
- Display-scale, contrast and mobile-fit guards
- Production build
