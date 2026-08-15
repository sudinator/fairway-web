# 177.25 Repository Integrity / Reproducibility Audit

Status: IN PROGRESS. This document tracks the deeper repository review against the current 177.25 working tree.

## Closed in source / locally guarded

- React hook-order defect in `components/player-card.tsx`: `useId()` now runs before the conditional return; hook-order lint is zero-tolerance in CI.
- Migration checklist regeneration: emphasized checked rows and the preserved notes block survive regeneration; repeated generation is idempotent.
- Migration ledger: legacy 0122-0128 self-record, 0135 performs evidence-based backfill, and the semantic ledger guard enforces exact/final recording plus documented gaps.
- Core RLS reproducibility source contract: 0136 recreates the six exact Production RLS helper functions; 0137 recreates the 12 core-table RLS flags, 60 policies, and exported table grants. Exact helper/policy manifests and source-closure guards are committed.
- UI guard coverage: relevant scanner guards now cover both `components/` and `app/`.
- Environment hygiene: `.env` / `.env.*` ignored, `.env.example` preserves the allowed exception and documents all referenced variables.
- Extracted-module dependency debt: the former total-import cap is replaced by a TypeScript unused-symbol per-file ratchet. Current grandfathered debt is 512 diagnostics across 27 files and cannot increase or create headroom.
- Dead-code cleanup: removed the unused Courses `HelpSearch` import. Deleting the two tracked orphan files (`components/nav-debug.tsx`, `public/ghin-autofill.js`) is deferred to a later cleanup because the normal overlay deployment path cannot delete tracked files safely; they remain unreferenced and inert.
- Round analysis state: removed direct prop mutation and added explicit immutable parent/session synchronization.
- Pace UI: elapsed-time rendering now uses a shared reactive clock rather than a non-reactive `Date.now()` snapshot.
- VAPID drift: prebuild checks the environment public key against the service-worker key.
- CI runtime: Node 22 is pinned in `.nvmrc`, `package.json`, and `package-lock.json`; Node-bearing workflows use `.nvmrc`; duplicate full app build/test work was removed from Robustness.
- Fresh database CI wiring: `CI / verify` now installs a pinned Supabase CLI and runs a disposable fresh-database rebuild from both migration trees before the normal app CI gate.

## Still requiring execution evidence

- The disposable Supabase fresh-database rebuild is authored but cannot be executed in this isolated workspace because Docker/Supabase CLI are unavailable here. GitHub CI must execute it successfully.
- Full dependency-backed hook lint, TypeScript, tests, and Next build remain GitHub/Vercel gates because this workspace does not have a complete installed dependency tree.
- New database migrations 0135-0137 must be applied/tested on staging before Production. Production must not receive them until the fresh-rebuild and staging database checks pass.

## Deliberately not combined into 177.25

- Deleting the two tracked orphan files via an overlay-only release; this requires an explicit delete-capable repo operation and is deferred rather than hidden from the normal copy-overlay workflow.
- Broad bundle/code-splitting work. This is a performance refactor and should remain separate from security/reproducibility hardening.
- Reducing all 512 grandfathered unused-symbol findings in one release. The ratchet now prevents regression; cleanup should proceed incrementally under the existing refactor reachability rules.
- Tightening the live `anon`/`authenticated` table grant set (including `TRUNCATE`). 0137 intentionally reproduces the current Production grant contract; privilege minimization is a separate behavior/security change and requires targeted integration testing rather than being silently folded into a reconstruction migration.
