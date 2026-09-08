# BNN 185.0.260907 — Staging verification

## Outcome

Every stroke dot in the app now names its basis and uses one colour for that basis everywhere. Trifecta shows the singles strokes it never showed.

## Database

No migration. 0150 remains current.

## The scheme

| Basis | Colour (cream card / dark header) | Formats |
|---|---|---|
| Course handicap | `#9A4A08` / `#E8730C` | all — the scoring basis itself in Stableford, stroke, individual skins |
| Off your opponent | `#0E6E9E` / `#8FC4EE` | singles, team match, 1:1 skins, alternate shot (other side) |
| Off the foursome low | `#7A5BB0` / `#B49AE0` | four-ball, 2v2 skins, Trifecta team leg |

Contrast measured on both grounds; each basis is a pair because no single hex is legible on both.

## Real-data verification

Architects Jul 5, Foursome 1. Hole 14 (SI 4): BK receives in the team leg (purple) and NOT in his single against Sachin (no teal) — the exact discrepancy behind the 182.2 card bug, now visible. Hole 9 (SI 1): Sachin GIVES a stroke in his single (hollow) while RECEIVING one in the team leg (purple).

`lib/stroke-sets.test.ts` — 81 assertions: each basis's dots equal what the engine scores that contest on, and the singles dots match `computeTrifecta`'s own nets hole for hole.

## Defects fixed en route

- Group scorecard's course-handicap dot row used a dark-ground colour at 1.83:1 on cream cells — effectively invisible.
- Personal card legend was suppressed in match mode, so a singles match drew a second colour with no key.
- Match-basis Stableford corner box removed (points nobody scores).
- A `\u25CF` written in JSX *text* would have rendered as literal characters — caught by the JSX-escape guard.

## Manual Staging check

See the v185.0 checklist at the top of BACKLOG.md. Check on a phone: the Trifecta card stacks up to three dot rows in the Hcp column.

## Release gate

- TypeScript
- Unit, differential and rendered interaction tests
- Stroke-dot basis guard
- Close-out, parity and live-route guards
- Security/RLS guards
- Display-scale, palette, contrast and mobile-fit guards
- Production build
