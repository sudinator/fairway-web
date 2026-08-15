# Release Verification — 177.36.260815

## Scope
CI severity alignment only. No application runtime logic, database migration, RLS policy/grant/helper, schema, or data behavior is intentionally changed.

## Root cause
177.35 GitHub CI progressed past hook lint and failed in `ci/check_extracted_import_debt.py`. The script hard-failed on unused-symbol baseline drift even though APP_RULES #26 explicitly classifies unused props/state/imports as boundary-drift warnings. The check's severity contradicted the documented engineering contract.

## Implemented
- Preserve the unused-symbol per-file baseline measurement and detailed report.
- Change unused-symbol debt findings from blocking FAIL/exit 1 to ADVISORY WARNING/exit 0.
- Do not reset the baseline or clean up the reported application symbols.
- Define BLOCKING vs ADVISORY semantics in APP_RULES/HANDOFF.
- Keep security/RLS, fresh-DB/migrations, secrets, TypeScript correctness, unit/differential behavior, build, reachability/source contracts, and feature correctness blocking.
- Bump version metadata to 177.36.260815.

## EXECUTED validation in this environment
- **PASS — advisory normal path:** current 512-diagnostic / 27-file baseline reports PASS and exits 0.
- **PASS — advisory drift mutation:** deliberately changed one per-file baseline count; checker printed a WARNING with the exact delta and exited 0. Baseline was restored afterward.
- **PASS — blocking-control mutation:** deliberately injected a forbidden `react-hooks/exhaustive-deps` suppression; the independent blocking guard exited 1. Source was restored afterward.
- **PASS — complete source/guard suite:** `npm run guards` rc 0, including 135-migration dependency closure, exact core-RLS source contracts, fresh-DB source contract, 50,087 workflow fault simulations, integration/reachability/state/security/UI/PWA/feature contracts, and the advisory unused-symbol report.
- **PASS — Python syntax:** changed advisory checker compiles successfully.
- **PASS — scope review:** no `app/` or `components/` executable application file changes; no migration/RLS/grant/helper files changed. Only CI severity policy, documentation, release evidence, and version metadata change.
- **PASS — version consistency:** 177.36.260815 across package metadata, generated app version, public version JSON, and service-worker version.

## NOT EXECUTED / still blocking
- Dependency-backed ESLint, repository `npx tsc --noEmit`, complete unit/differential suite, and Next production build cannot be executed locally because dependency installation previously timed out in this environment. GitHub remains authoritative.
- Disposable Supabase/PostgreSQL migration reconstruction and RLS behavior tests are not executable locally and remain mandatory GitHub gates.
- Vercel staging, browser feature/regression validation, PR verify, Production Ready and Production smoke remain pending.

## Release status
**NOT DEPLOYABLE.** 177.36 may be used only as the next staging validation candidate until all BLOCKING gates above are green. Advisory unused-symbol findings are documented but do not block release.
