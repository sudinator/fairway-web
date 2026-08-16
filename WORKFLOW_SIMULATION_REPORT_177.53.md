# Workflow Simulation Report — 177.53.260816

## Descriptor
Format Selection Convergence

## MODELLED + EXECUTED pure scenarios
The new pure selection mapping covers every historical Create Game format shape identified in the pre-change audit:
- Stableford
- Stroke Net / Gross
- Match Individual / Team
- Four-ball 2 v 2 Match / Team vs Team × Best ball / Aggregate
- Trifecta Best ball / Aggregate × Per-hole / Ryder Cup
- Skins Individual × Carryover/Split
- Skins 1:1 Teams × Carryover/Halved
- Skins 2 v 2 Best-ball × Best ball/Aggregate × Carryover/Halved

The dedicated mapping test passed 35/35 assertions. Existing game creation tests passed 52/52 and the historical old-vs-new game-create differential passed 9,000/9,000 comparisons.

## Adjacent EXECUTED regression coverage
- Resume/draft state: 2,007/2,007 PASS
- Tee inheritance: 5,011/5,011 PASS
- Full source/contract guard suite: PASS
- Workflow/fault simulation: 50,087 PASS

## Required BROWSER validation after staging deploy
1. Select each of the six top-level formats and verify only relevant sub-controls appear.
2. Match: toggle Individual ↔ Team; confirm no second Team Match control exists and Review matches the selection.
3. Four-ball: test 2 v 2 Match and Team vs Team; for each test Best ball and Shootout; confirm Review wording and post-create Manage Game destination.
4. Skins: test Individual, 1:1 Teams, and 2 v 2 Best-ball; verify tie options and 2v2 team-score options; switch among styles and verify no contradictory controls remain.
5. Trifecta: test both team-point methods and both scoring methods.
6. Stroke: test Net/Gross.
7. Navigate backward/forward and Resume Setup; confirm format state survives.
8. Create representative games and verify Manage Game reads exactly the selected structure/settings.

Browser results must be labeled BROWSER-VALIDATED before Production promotion.
