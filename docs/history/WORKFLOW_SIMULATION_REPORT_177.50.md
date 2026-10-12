# Workflow Simulation Report — 177.50.260816

Evidence labels: EXECUTED = code/tests actually run; MODELLED = scenario reasoning against verified code; BROWSER-VALIDATED = requires staging interaction.

## EXECUTED
- 5,011 tee-resolution assertions: default, flight inheritance, player override precedence, invalid-index fallback, empty tee catalog, map sanitization, and 5,000 matrix cases.
- 2,006 setup-draft assertions: new tee maps persist and old drafts without those optional fields restore safely to empty maps.
- 42 game-create assertions: effective tee drives persisted rating/slope/course handicap for members and guests.
- 9,000 differential comparisons: historical single-default behavior is identical when new optional hierarchy inputs are not supplied.
- 50,087 existing workflow/fault simulations: PASS.

## MODELLED state transitions
1. Game default Blue, no overrides -> every participant resolves Blue.
2. Player White override -> player remains White when game default changes.
3. Flight B White + game default Blue -> inheriting Flight B players resolve White.
4. Flight B White + player Red override -> player resolves Red.
5. Handicap moves player from Flight A to B -> inherited flight tee follows B; explicit player override does not move.
6. Flights turned off -> flight tee map becomes inactive; player override still wins, otherwise game default.
7. Flights turned back on -> saved flight tee map is active again.
8. Course changes -> all flight/player tee maps are cleared before a new course tee index can be used.
9. Guest override uses guest draft id and resolves to an explicit persisted tee snapshot.
10. Old Resume draft -> no invented overrides.
11. New Resume draft -> maps restored before course is rematched by name; same-course indices remain usable.
12. Create -> inheritance ends; explicit player snapshots are written and Manage Game edits operate on those snapshots normally.

## Failure / re-entry model
- Invalid/stale override index falls back to the next valid inheritance layer rather than leaving a missing tee.
- Missing flight assignment falls back to game default.
- Missing tee catalog returns no resolution; existing Create validation still blocks creation without a selected course/default tee.
- Deselect/reselect retains a deliberate player override during the same draft so temporary roster edits do not discard work.

## BROWSER-VALIDATED required
Pending staging checks listed in RELEASE_VERIFICATION_177.50.md.
