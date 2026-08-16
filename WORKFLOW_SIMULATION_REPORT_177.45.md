# Workflow Simulation Report — 177.45.260816

## Scope
Game Control Center Game-section reorganization and atomic pre-score course replacement.

## EXECUTED automated/model checks
- `lib/game-setup-policy.test.ts`: **43/43 PASS**, including course change allowed before scoring, blocked after scoring, and blocked when ended.
- `ci/workflow_fault_simulation.py`: **50,087 PASS** (including 50,000 randomized RSVP operations; adjacent workflow regression coverage).
- `ci/check_game_course_change_contract.py`: **18/18 source-contract links PASS**.
- Full `npm run guards`: PASS after adding the 177.45 course-change contract.

## MODELLED state scenarios
| Scenario | Expected result | Model result |
|---|---|---|
| Active game, zero scores, choose another club course | Confirm then atomic replacement | PASS |
| Cancel course confirmation | No writes/state change | PASS |
| Active game with any score | Course control locked / policy BLOCK | PASS |
| Ended game with zero or existing scores | Course control locked / policy BLOCK | PASS |
| Reopen a previously scored game | Score-state policy still BLOCKS course change | PASS |
| Successful replacement | Game course/par/holes change together | PASS |
| Successful replacement | Every player tee/rating/slope/course handicap cleared | PASS |
| New course has different hole count | Empty score/stat arrays resized atomically | PASS |
| New course contains a same-named tee | No automatic cross-course tee mapping | PASS |
| After replacement | Organizer routed to Players; Review remains incomplete until tees selected | PASS |
| RPC authorization failure | Transaction aborts; no partial game/player mutation | PASS |
| RPC score-state race | Rows locked and DB re-check blocks mutation | PASS |
| Format screen | Only competition/scoring controls remain | PASS |
| Game screen | Sharing, lifecycle, reset/delete reachable | PASS |

## Not browser-validated locally
The local source ZIP does not contain installed application dependencies, so no browser runtime was available. Browser validation must occur on staging after migration 0138 is applied and GitHub/Vercel gates pass.
