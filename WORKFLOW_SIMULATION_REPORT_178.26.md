# Workflow Simulation — 178.26.260830

## Scenario
Alternate Shot canonical scores exist, organizer resets scores, integration harness verifies zero canonical rows remain.

## Simulated state chain
1. Side A and Side B canonical rows exist.
2. Organizer calls `reset_game_scores`.
3. RPC returns successfully.
4. Head/count query returns `{ data:null, error:null, count:0 }`.
5. Harness retains the full response and asserts `count === 0`.
6. Harness proceeds to verify the scoring-start marker reset and adjacent safe-delete workflow.

## Result
PASS. The previous harness implementation failed at step 5 because it transformed the response into `data` (`null`) before reading `count`.

## Adjacent audit
All `head:true/count` use in the staging harness was searched. The cleanup verification already retains the full response and is correct; no second instance of the defect remains.
