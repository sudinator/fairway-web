# Workflow Simulation Report — 178.12.260829

## Alternate Shot model-based scenarios
Executed against the production pure functions (`altShotSides`, `altShotHoleDetail`, `altShotProgress`, `altShotStatus`, `readAltShotSideScores`).

### Normal paths
- 9-hole and 18-hole matches; front/back numbering.
- Side handicaps spanning plus through high handicap.
- Allowances 25/40/50/60/70/80/85/90/95/100%.
- Complete and partially-entered holes.
- Single- and multiple-stroke-per-hole allocations.

### State transitions / re-entry model
- Enter score -> calculate hole result -> calculate running match.
- Edit a completed score -> recalculate -> revert -> prior match state restored.
- One partner row temporarily missing while the other has the side score -> accepted as a one-row lag.
- Partner rows disagree -> conflict detected; hole excluded from match calculation.
- Conflict remains -> finalization source contract blocks finish/end.

### Numerical edge cases
- Exhaustive 1,320,980 side-handicap/allowance combinations checked against exact rational half-up rounding.
- Reproduced former 31.499999999999996 binary representation case; now 32 strokes as mathematically required.

### Randomized run
100,000 deterministic randomized matches, seed 0x17812:
- 3,472,535 assertions PASS.
- 10,000 injected partner-row conflicts detected and excluded.
- 100,000 edit/revert cycles restored prior result.
- 44,796 cases allocated more strokes than holes, exercising wrap/multi-stroke logic.

## Adjacent workflows
Pure adjacent scoring suites for format selection, format rules, hole-result agreement, scoring matrix, allocator behavior, and match length all passed. Four-Ball and Trifecta engine calls remain in place for their own formats; Alternate Shot is explicitly branched to its dedicated engine.

## Not executed here
Browser/runtime Supabase persistence, realtime fan-out across two devices, offline reconnect, group locking, Vercel build, and staging integration require the normal GitHub/staging environment. These remain mandatory before production.
