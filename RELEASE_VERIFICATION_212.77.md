# 212.77.261030 — agreed audit fixes

**Status: CANDIDATE — NOT READY FOR DEPLOYMENT.** Prepared October 30, 2026 (US/Eastern) against the supplied `fairway-web-main (8).zip`, version 212.76.261030.

## Implemented scope

1. `record_settlement` requires the submitting account to have active membership in the payment's club, in addition to the existing payer/payee/club-admin rule. Neither counterparty must remain an active member. Other clubs and buckets remain separate; no recipient-confirmation step was added.
2. `guard_player_setup_locks` rejects participant changes to ended cards even when all scoring/stat arrays are empty. Organizer corrections/resets, system-admin exemptions and version fencing are preserved.
3. The public game AND Ryder Cup feeds carry the effective manual/derived handicap source. Public individual net/Stableford, match legs, stroke dots, skins and alternate-shot adapters preserve that source. A manual value applies to the selected length unchanged, before the separate format allowance. The organizer entry/saved-override notice states the hole count and allowance explicitly. A manual marker with no numeric override falls back to derived basis.
4. New club and season reports group registered members by user ID and resolve current readable profile names. Companion and rival summaries carry stable identity. Report copies are renamed in memory; no historical game rows or previously published report snapshots are rewritten. The legacy name-change RPC now updates only the caller's profile. Future game creation continues using current profile names.

If a profile is deleted, inaccessible under existing permissions, or unnamed, the saved name is retained. A failed profile query stops report generation with an error instead of silently dropping people. Guest rows are distinct and never merged solely by name.

## Executed validation

| Check | Result and evidence level |
|---|---|
| Code/contract review | EXECUTED: traced all application `record_settlement` callers, report loaders, public handicap adapters, organizer resets and preserved function signatures. No unrelated feature changes. |
| TypeScript and hooks lint | PASS, Node 22; `npx tsc --noEmit`, `npm run lint:hooks` in final CI run. |
| Complete unit/render suite | PASS, `npm test`, including existing differential and scenario suites and new regression cases. Render evidence uses jsdom, not a physical browser. |
| Changing-clock regression | PASS: all 158 suites with a clock moving on every read. |
| Public/app scoring parity | PASS: 116 field comparisons, zero mismatches, including manual nine-hole variants in singles, four-ball, Trifecta and alternate shot. |
| New feature regression | PASS: actual public-page `computePlayer` executed for 18 length/source/allowance cases, including gross 45/manual 12/net 33. Report loader/current-name and same-name identity tests passed. Saved override notices: 12 rendered assertions, including 9→18→9 context. |
| Fresh isolated migration chain | PASS: all 231 migration files through 0233 executed on PostgreSQL/PGlite. **MODELLED Supabase environment**: auth/storage compatibility shim; cron stubbed; no cron jobs or production data touched. Empty/missing JWT claims are normalized to match Supabase semantics. This is not the required real Supabase gate. |
| Database behavior | PASS: new club membership, historical-counterparty, multi-club, duplicate, rollback, ended-card clearing, active scoring and organizer reset cases; plus 12 adjacent SQL suites. Public game/Cup manual-source payloads and null-manual fallback passed. |
| Security contract | PASS on isolated rebuilt database: all 136 policies, 45 table grants and 210 privileged-function permissions match the existing snapshot; RLS/search-path/approved-account structural checks passed. No snapshot permissions were weakened. |
| Build | PASS: separate complete `npm run build`, Node 22, using placeholder Supabase configuration and the repository's public VAPID key. No live service access. Generated build output is excluded from this ZIP. |
| Source guards | All guards preceding browser-gallery execution passed in final CI. `check_course_handicap_reads.py`, which follows that guard, was executed separately and passed. Assertion ratchet increased only by the 12 new notice checks; no existing assertions removed. |
| Versions/migrations/package contents | PASS: package/lock/app-version/service-worker metadata agree; migration manifest regenerated; all old SQL migrations remain byte-identical; changed-file manifest/checksums and ZIP contents verified; no credentials, dependency folders or compiled build outputs included. |

## Blocking / unexecuted gates

- **Full `npm run ci` is NOT green.** It exits at `ci/check_gallery_overflow.mjs` because Chromium is unavailable. The pinned Playwright browser download failed with empty/invalid archives. No guard was bypassed or weakened. Real-browser layout checks and screenshot review remain unexecuted.
- Docker/Supabase CLI are unavailable here: the required real fresh-Supabase reconstruction and its complete integration/concurrency/security checks remain unexecuted.
- GitHub CI, Vercel staging build and staging feature/regression integration have not been run from this environment. No production migration/deployment/smoke test has been performed.

**Do not deploy this candidate to production.** The missing gates must pass before it can be called deployable. This file deliberately distinguishes executed synthetic-fixture tests from real Supabase/staging/browser evidence.

## Database and rollback

One new migration: `migrations/0233_club_score_and_report_contracts.sql`. Earlier migrations are unchanged. It replaces existing function definitions within one transaction, retains existing grants and does not rewrite stored history. It must be validated on staging with the candidate before production. A Vercel rollback does not revert database functions. Full SQL is included for review; this candidate is not an instruction to run it.

The ZIP overlays only changed files at their repository-relative paths. Its `RELEASE_CONTENTS_212.77.json` records the exact files and SHA-256 hashes. Local execution evidence is under `release-verification/212.77/`.
