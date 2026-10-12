# Release Verification — 177.35.260815

## Scope
Corrective release for the 177.34 dependency-backed CI failure caused by stale ESLint disable directives. No application behavior, database schema/data, RLS policy, grant, helper, migration, or deployment configuration behavior is intentionally changed.

## Root cause
- `package.json` runs `eslint app components lib --max-warnings=0` as the first blocking stage of `npm run ci`.
- The exact current staging tree contained 23 disable directives in app/components/lib: 22 `react-hooks/exhaustive-deps` suppressions and one generic inline `eslint-disable-next-line`.
- `eslint.config.mjs` enables `react-hooks/rules-of-hooks` only; it does not enable `react-hooks/exhaustive-deps`. Therefore all 23 directives are stale/unused and the zero-warning lint gate correctly fails.
- The 22-entry legacy suppression baseline and the later zero-warning lint policy had not been reconciled.

## Implemented
- Removed exactly 23 stale ESLint comments from 10 component files.
- Did not edit any React effect body, dependency array, callback, state transition, render branch, import, API/RPC call, or database write.
- Replaced the legacy-baseline suppression guard with a permanent zero-`react-hooks/exhaustive-deps`-suppression guard.
- Retired `ci/effect_suppressions_baseline.txt` to documentation-only zero-baseline status.
- Kept `react-hooks/exhaustive-deps` disabled; enabling/auditing it remains separate behavior-sensitive backlog work.
- Bumped version metadata to 177.35.260815 and updated release/handoff/backlog documentation.

## EXECUTED validation in this environment
- **PASS — executable application differential:** all changes under app/components/lib, excluding generated `lib/app-version.ts`, reduce exactly to deletion of the 23 approved stale directives. Ten component files changed; no executable token/line content changed.
- **PASS — suppression inventory:** zero `eslint-disable` directives remain in app/components/lib.
- **PASS — permanent suppression guard:** clean tree passes; deliberately injecting an `react-hooks/exhaustive-deps` suppression makes the guard fail; clean tree passes again after restoration.
- **PASS — full repository guard suite:** `npm run guards` completed rc 0, including 135-migration dependency closure, exact 60-policy/12-table RLS source contracts, fresh-DB source contract, 50,087 workflow fault simulations, staging integration source contract, extraction/state/import guards, PWA/staging/course/dashboard contracts, and the new zero-suppression guard.
- **PASS — 177.34 RLS verifier preservation:** `ci/assert-core-rls-live.sql`, `ci/assert-core-rls-behavior.sql`, `ci/test_fresh_db_rebuild.sh`, and `ci/check_fresh_db_ci_contract.py` are byte-identical to the uploaded 177.34 staging baseline.
- **PASS — migration/security preservation:** both migration trees plus Production RLS manifests/assertion scripts are unchanged.
- **PASS — CI/lint contract static audit:** zero-warning hook lint remains the first blocking `npm run ci` stage; `rules-of-hooks` remains enabled; `exhaustive-deps` remains disabled.
- **PASS — changed-script syntax:** Python compilation, Node syntax checks, and fresh-DB shell syntax check.
- **PASS — version consistency:** 177.35.260815 across package.json, package-lock root metadata, generated app version, public version JSON, and service-worker cache version.

## Dependency-backed gates blocked locally
- `npm ci --no-audit --no-fund` was attempted twice and timed out before dependencies were installed.
- After removing the partial install, `npm test` reaches the global TypeScript compiler but cannot compile because dependency type definitions such as `@types/node` are unavailable. This is an environment/dependency limitation, not a test assertion failure.
- Therefore local dependency-backed ESLint, repository `npx tsc --noEmit`, complete unit/differential execution, and Next production build are **NOT EXECUTED** and remain mandatory GitHub gates.
- PostgreSQL/Supabase runtime is not available locally, so the disposable fresh-database migration/RLS behavior gate is also **NOT EXECUTED** locally.

## Release status
**NOT DEPLOYABLE.** Required remaining gates: GitHub dependency-backed hook lint → TypeScript → guards → full unit/differential suite → build, disposable fresh-Supabase reconstruction/RLS behavioral assertions, Vercel staging Ready, targeted/adjacent staging validation, staging→main PR verify, Production Ready, staging/main resync, and a non-destructive Production smoke test.
