# BNN 182.2.260906 — Staging verification

## Outcome

On a Ryder Cup ("match") Trifecta game, the player's own scorecard running strip now scores each single on the pair basis — strokes are the difference between the two players in that single — matching the Results page and the Cup tally. Previously the card omitted the scoring argument and scored singles on the Four-Ball basis (off the foursome's low), so its running margin disagreed with Results on any hole where the pair-low and foursome-low differ.

## Database

No migration. 0149 remains current.

## Real-data reproduction

Game `51a8ed51-d28d-40ec-bfc0-741d57579415`, The Architects Golf Club, Jul 5 2026, allowance 90%, aggregate team leg, match scoring. Foursome 1: Karan + Sachin vs Ashutosh + BK.

| Single | Card (182.0, rendered) | Results / Cup tally | Diverges |
|---|---|---|---|
| Sachin v BK | 4 UP | 5 UP (4 & 2) | holes 14–18 |
| Karan v Ashutosh | 4 DN (3 & 1) | 4 DN (3 & 1) | none |

Hole 14 (SI 4): Sachin 3, BK 4. Pair basis: BK receives no stroke on SI 4 → Sachin wins. Foursome basis: BK receives a stroke → halved. Foursomes 2 and 3 of the same session were also computed; Foursome 3 (Preet v Nihar) showed a one-hole mid-match divergence at the 14th with the same final.

## Executed checks on the patched tree

- `lib/trifecta-card-scoring.test.ts` — 12 assertions: wrong answer pinned, right answer pinned, divergence window exactly 14–18, immune control single identical under both bases.
- `lib/trifecta-card-render.test.tsx` — mounts the production Tournaments → GameRoom → ScoreEntryCard chain via the offline snapshot boot with the Jul 5 rows; reads the strip off the DOM for Sachin (2UP thru 14, 5UP thru 18, full strip equal to the Results single), BK (2DN/5DN) and Karan (4DN, unchanged). Run against the 182.0 card the same test FAILS with 1UP thru 14 and 4UP — the exact on-device report.
- `ci/check_trifecta_scoring_argument.py` — 7 production call sites, all pass scoring explicitly; verified to FAIL on the 182.0 source at `components/tournaments.tsx` (the card path) and only there.
- `npm test` — all suites green, including scoring matrix (3,698) and screen render (67 / 25 / 18).
- `tsc --noEmit`, `eslint --max-warnings=0`, full `npm run guards` — green.

## Manual Staging check

1. Open the Jul 5 Architects Trifecta game as Sachin (or BK) and view the personal scorecard.
2. Running strip must read 2UP (Sachin's perspective) after the 14th and 5UP after the 18th.
3. Open Results for the same game: Sachin v BK must read 5 UP / 4 & 2, identical to the card.
4. Open a per-hole (non-Ryder-Cup) Trifecta game: card and Results must still agree — the per-hole path is unchanged.

## Release gate

- TypeScript
- Unit and rendered interaction tests
- Trifecta scoring-argument guard
- Rendered Trifecta card check (screens chain)
- Security/RLS guards
- Display-scale and mobile-fit guards
- Production build
