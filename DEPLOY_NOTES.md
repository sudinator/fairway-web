# Birdie Num Num — v1.15.1

Legibility fix. NO migration, app-only.

## Fixed
- The per-foursome scoring summary (Trifecta) had its contest rows drawn with
  near-white text on the white card — invisible. The rows now use dark text
  (C.ink) and a light divider (C.line), matching the four-ball and skins cards.
  This is the same white-box-with-light-text problem that previously hit the
  GHIN field.

## Consistency check (this release)
Audited every white (C.card) box in the games UI to confirm dark text:
- Trifecta per-foursome card: FIXED.
- Four-ball skins card, skins head-to-head card, four-ball setup card,
  team scoreboard total cards, and all inputs (GHIN etc. via inputStyle):
  already correct (C.ink on white). No other offenders found.
- The v1.15.0 strokes panel renders on a dark surface (#16302A) with light
  text — already legible.

Rule going forward: a white (C.card) box uses C.ink text and C.line dividers;
dark surfaces use C.cream/C.sage text.

## Verified locally
- tsc --noEmit: clean
- next build: passes
- Unit tests: 113/113 pass

## Smoke-test
- Open a Trifecta game's results and confirm each foursome's contest rows
  (the two singles + team line) are now readable on the white card.
