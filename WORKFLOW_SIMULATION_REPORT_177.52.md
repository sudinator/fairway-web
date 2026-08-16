# Workflow Simulation Report — 177.52.260816

## Descriptor
Lean Create pivot: core setup first, structure in Manage Game.

## EXECUTED automated scenarios
- Existing `ci/workflow_fault_simulation.py`: 50,087 checks PASS.
- Create Game pure routing matrix:
  - Stableford → Play PASS
  - Stroke → Play PASS
  - individual Match → Setup/Matchups PASS
  - team Match → Setup/Teams PASS
  - plain Four-ball → Setup/Matchups PASS
  - team Four-ball → Setup/Teams PASS
  - Trifecta → Setup/Teams PASS
  - individual Skins → Setup/Groups PASS
  - team Skins → Setup/Teams PASS
- Historical creation differential: 9,000 comparisons, 0 mismatches.
- Resume/draft assertions: 2,007 PASS.
- Tee inheritance assertions: 5,011 PASS.

## MODELLED state transitions
- Game → Players → Format → Review and reverse navigation.
- Resume from a legacy draft whose saved workspace section is `structure`; maps to Review.
- Core Create succeeds, then persisted Manage Game takes ownership of structural setup.
- Invalid split-Skins field is rejected before any game-row insertion.
- TGC betting scope remains gated outside Main/non-TGC games.

## BROWSER-VALIDATED
None yet for 177.52. Browser validation is required on Vercel staging before continuing the convergence train.

## Result
Automated/modelled evidence supports the Lean Create pivot. Browser validation remains outstanding; this report does not claim browser PASS.
