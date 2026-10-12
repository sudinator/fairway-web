# Workflow Simulation Report — 177.36.260815

## Change class
CI policy/severity change only; no application runtime path is intentionally changed.

## Scenarios
- Unused-symbol baseline unchanged: advisory checker reports PASS and exits 0.
- Unused-symbol baseline increases/decreases: checker reports every delta as WARNING and exits 0.
- TypeScript compile/type error: separate blocking `npx tsc --noEmit` remains unchanged and must fail CI.
- Security/RLS/migration/source-contract/behavior guard failure: existing blocking guard chain remains unchanged and must fail CI.
- Retry/re-entry/application state: no executable application source is changed by 177.36.

Execution evidence is recorded in RELEASE_VERIFICATION_177.36.md.
