# BNN 183.1.260906 — Staging verification

## Outcome

Trifecta results state who won rather than leaving it to be inferred, on both the in-game Results and the public share page. The share page also stops computing Trifecta singles a second way: it had been recomputing them with the count-based `matchStatus`, which ignored the close-out freeze.

## Database

No migration. 0150 remains current.

## Real-data reproduction (staging 641032, FB 6/21 scores)

| Leg | Public page on 183.0 | In-game Results | Public page on 183.1 |
|---|---|---|---|
| Chris v Michael | won 4 UP | 4 & 2 | won 4 & 2 |
| Amit v Christopher | lost 5 UP | 4 & 3 | lost 4 & 3 |
| Team leg | Wildcats 1 up | (close-out) | Wildcats won <close-out> |

The 2–1 team score and "3 matches still out" were already correct on 183.0 and are unchanged.

## Executed checks on the patched tree

- `lib/live-trifecta-labels.test.ts` — 14 assertions: correct labels pinned, the screenshot's "won 4 UP" / "lost 5 UP" pinned as a fence, and an assertion that the two paths disagree.
- `lib/trifecta-results-row.test.tsx` — 10 assertions: the real row rendered, weight and colour read per side off the DOM for winner, loser, leader, trailer and the team pair.
- `ci/check_trifecta_one_singles_source.py` — passes; negative-tested by restoring the old `matchStatus` call, which fails it at the exact line.
- `npm test`, `tsc --noEmit`, `eslint --max-warnings=0`, full `npm run guards` — green.

## Manual Staging check

1. Reload the 641032 share link. Singles read "won 4 & 2" and "lost 4 & 3"; winners' names green and bold, losers' muted.
2. The blurb no longer says "three points a hole".
3. Team point row shows the settled margin.
4. In the app, open 641032 Results: winner's names bold gold, loser's muted; margins 4 & 2 and 4 & 3 as before.
5. Open an unfinished Trifecta (or a game mid-round): the leading side is gold but not bold, and the margin next to it reads UP, never DN.

## Release gate

- TypeScript
- Unit and rendered interaction tests
- Trifecta single-rule and single-singles-source guards
- Security/RLS guards
- Display-scale, contrast and mobile-fit guards
- Production build
