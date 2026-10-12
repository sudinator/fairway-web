# BNN 186.0.260907 — Staging verification

## Outcome

Stroke bases are distinguished by shape first and colour second, on every surface that draws them.

| Basis | Shape | Cream card | Dark rows |
|---|---|---|---|
| Course handicap | circle | `#A24700` | `#FF7F19` |
| Off your opponent | triangle | `#375CBD` | `#7DA1FF` |
| Off the foursome low | square | `#007052` | `#14CC9A` |

Hollow = the same basis in the giving direction.

## Why shape

Colour alone cannot separate three categories at 6px. Across the full hue wheel and both standard colour-blind-safe palettes, the best trio reached ΔE ~12 under protan/deutan simulation against the ~35 needed. The 185.0 purple was ΔE 39 / 32 from the blue even in normal vision. Shape survives greyscale, every CVD type, and a phone screen outdoors.

## Database

No migration. 0150 remains current.

## Executed checks

- `npm test`, `tsc --noEmit`, `eslint --max-warnings=0`, `npm run guards` — green.
- `ci/check_stroke_dot_bases.py` now discovers dot-drawing surfaces (4 found, vs the 2 hand-listed in 185.0) and requires each to use `strokeGlyph`. Negative-tested: removing the triangle fails; reverting the share card to plain dots fails.
- Rendered from the real `GroupScorecard` with the Architects Jul 5 rows at 400px: hole 9 (all three bases) and hole 7 (filled vs hollow triangle).

## Manual Staging check

See the v186.0 checklist at the top of BACKLOG.md. The phone-in-sunlight check is the one CI cannot do.

## Release gate

- TypeScript
- Unit, differential and rendered interaction tests
- Stroke-dot basis and glyph guard
- Close-out, parity and live-route guards
- Security/RLS guards
- Display-scale, palette, contrast and mobile-fit guards
- Production build
