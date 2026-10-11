# Workflow Simulation Report — 178.10.260828

## Scope
Model-based validation of the two P1 scoring corrections.

## MODELLED scenarios
- Singles match, 100% allowance: exact and stored integer CH paths remain equivalent when no boundary exists.
- Singles match, 90% allowance boundary: exact CH 10.5 produces 9 strokes after one final rounding; rounded-first CH 11 would incorrectly produce 10. Corrected callers use the exact path.
- Singles match re-entry/edit: score arrays and pairing identity are unchanged; recalculation is pure from the same current scores and exact handicap basis.
- Alternate shot, 50% allowance: side A 20+8 => 14.0; side B 10+5 => 7.5; difference 6.5 => 7 strokes. Corrected running match line uses `altShotSides`, matching dots/Strokes.
- Alternate shot missing handicap/player: `altShotSides` returns a null side handicap and zero allocatable strokes rather than silently borrowing/guessing.
- Nine-hole paths: `chBasis` continues to use the existing nine-hole basis; no new halving is introduced.
- Adjacent formats: Stableford, stroke play, four-ball, trifecta, skins, betting, persistence and posting code are untouched.

## EXECUTED source-contract checks
PASS scoring-input contract; PASS single alternate-shot source; PASS nine-hole basis; PASS single stroke allocator.

## NOT EXECUTED
Dependency-backed TypeScript/test/build/runtime/staging checks were blocked by dependency installation timeout in this container.

## EXECUTED pure scoring assertions
- stroke rounding: 24/24 pass
- alternate-shot scoring: 28/28 pass
- format rules: 34/34 pass
- hole-result consistency: 981/981 pass
