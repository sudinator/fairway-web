# Extraction verification standard (Stage 3/4 — god-component decomposition)

Sibling to REFACTOR_VERIFICATION.md (pure-logic diff testing) and SECURITY_CHECKLIST.md. This governs
moving code OUT of the god components (GameRoom, CreateGame, manage panels) into hooks/sub-components,
where — unlike Stage 2 — the code is stateful/JSX and cannot always be proven by input→output diffing.

## The principle
An extraction is behavior-preserving IF AND ONLY IF all of the following hold. Each is mechanically
checkable and shown to the reviewer per pass — not left to the author's judgment.

## The four gates (every pass)

### 1. Body is textually identical
After renaming closure-vars-turned-parameters back, the moved code must be character-for-character what
it replaced. Prove with an explicit diff of old-block vs new-body (params normalized). Non-empty diff → STOP.

### 2. Free-variable ledger balances (the crux)
Before moving, enumerate EVERY identifier the block references but does not itself declare — state, props,
functions, imports. That is the block's complete input surface. The extraction is safe only if:
  - every free variable becomes an explicit parameter/prop of the new unit, AND
  - the call site passes the identical in-scope identifier for each, AND
  - the counts and names match exactly: {free vars read} == {new params} == {call-site args}.
No additions, no omissions, no substitutions. The ledger (three columns: read / param / arg) is shown to
the reviewer. This is the check byte-identity CANNOT do — a free var silently resolving to a different
value (stale copy, wrong `game`, un-threaded prop) is the primary failure mode.

### 3. tsc green, zero new `any` at the seam
TypeScript mechanically enforces gate 2: a missing/misconnected wire is a type error. This guarantee is
VOID if the seam is typed `any` (tsc stops checking, a wrong value passes silently). Absolute rule: every
extracted boundary is fully typed; no new `any` at a boundary this pass created.

### 4. Reactive/effect seams flagged and reasoned
When a free variable is React state, or the block is/contains a `useEffect`/`useMemo`/`useCallback`, "same
value" is necessary but NOT sufficient — the TIMING of updates and the dependency array must be preserved
too. Moving an effect across a component boundary can change WHEN it re-runs even with every variable wired
right. These seams are called out explicitly each pass and reasoned about; they are the residue where the
ledger alone doesn't fully close the proof, and where reviewer QA is the backstop.

## Stronger proof where it applies
If a block turns out to be PURE (input→output, no state, no effects), do not stop at the ledger — add the
Stage 2 differential test (baseline + fuzzed old-vs-new, 0 mismatches). Strictly stronger; use it wherever
it fits. Pure helpers are extracted FIRST each pass, before any stateful/JSX relocation.

## Ship criteria (all required)
- [ ] body-diff empty (gate 1)
- [ ] free-variable ledger balances exactly, shown in the pass notes (gate 2)
- [ ] tsc clean, no new `any` at the seam (gate 3)
- [ ] every reactive/effect seam flagged + reasoned (gate 4)
- [ ] pure blocks additionally diff-tested (0 mismatches)
- [ ] npm run ci green; DEPLOY_NOTES records the ledger summary
Miss any line → that is the flag to halt. Meet all → the process is known-correct without running it
(modulo gate-4 reactive seams, which name their own residual risk for reviewer QA).
