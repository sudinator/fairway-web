# Behavior-preserving refactor — verification standard

Every time we extract logic out of a component (Stage 2+ of the refactor), we PROVE it changed no
behavior by differential testing the old vs new code. This is mandatory, not optional.

## The method (per extraction)
1. **Move the logic verbatim** into a `lib/<name>.ts` module; leave thin wrappers at the old call
   sites so callers are unchanged.
2. **Capture a baseline**: `lib/<name>.baseline.ts` = the ORIGINAL code, transcribed verbatim from
   the pre-change source (parameterized the same way the new module is). This represents "before".
3. **Write a differential test** `lib/<name>.diff.test.ts` that runs the SAME inputs through BOTH
   the baseline (OLD) and the new module (NEW) and asserts `OLD(input) === NEW(input)` for every
   function. Inputs = the structured edge cases PLUS a large deterministic fuzz (thousands of
   randomized cases) so every branch is exercised. Any divergence prints the exact input + both
   outputs and fails the run.
4. **Write a unit test** `lib/<name>.test.ts` with explicit expected values for every path (so the
   logic is also pinned against future changes, not just against the old version of itself).
5. Wire all three (`<name>.ts`, `<name>.baseline.ts`, `<name>.test.ts`, `<name>.diff.test.ts`) into
   `npm test`. The extraction ships only when: diff test = 0 mismatches, unit tests pass, tsc clean,
   build compiles, guards pass.

## Result for 176.21 (player-scoring)
- Unit tests: 45 passed, 0 failed.
- Differential (OLD vs NEW): **32,463 comparisons, 0 mismatches** — identical across every path.

## Why both a diff test AND a unit test
The diff test proves the extraction matches the OLD behavior exactly (no regression from the move).
The unit test pins the behavior with independent expected values (so a future intentional change is
made deliberately, with the test updated, rather than drifting silently). The baseline file can be
deleted once an extraction is well past — but keeping it is cheap and documents the "before".

## v177.19 refactor-integrity hardening
The Courses regression proved relocation byte-identity is necessary but insufficient: editor state survived while the state->render bridge did not. Future verification therefore combines differential/byte-equivalence with permanent reachability contracts, explicit props boundaries, state/dependency hygiene and scenario testing for stateful flows. New CI guards: `check_extraction_reachability.py`, `check_extracted_state_hygiene.py`, and `check_extracted_import_debt.py`.

Candidate construction must also preserve the latest synchronized branch baseline. A release ZIP created from an older snapshot can silently revert later CI/configuration fixes even when the app version appears current, so every release starts from a freshly verified `staging == main` tree.
