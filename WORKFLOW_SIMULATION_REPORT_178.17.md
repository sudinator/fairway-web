# Workflow Simulation Report — 178.17.260829

## Change under test
Move the existing `GroupSegmentSummary` state hook above the Alternate Shot early return and add a source-level hook-order backstop.

## Simulated scenarios
- Alternate Shot render: hook initializes, component returns `null`; no individual six-hole side game appears.
- Non-Alternate-Shot render: same hook initializes and existing segment-results UI remains reachable.
- Re-render transition from non-Alternate-Shot props to Alternate Shot props: hook call order remains stable.
- Re-render transition from Alternate Shot props to non-Alternate-Shot props: hook call order remains stable.
- Synthetic regression: top-level early return inserted before `useState`; source guard fails.

## Result
MODELLED: observable Alternate Shot behavior is unchanged; React hook ordering is now valid across render transitions.
EXECUTED: source hook-order guard passes the release tree and fails the synthetic regression fixture.
