# BNN 193.1 — CI TEST ONLY

UNVERIFIED / NOT READY FOR DEPLOYMENT. Applies over uploaded staging 193.0.260930.
This bundle is authorized only to run the remaining automated gates on a temporary branch.
No live migration, staging/production merge, or app scoring test is authorized by this checklist.

1. In GitHub Desktop, switch to staging and make sure it contains your current 193.0 code.
   Create a new branch from staging named ci/193.1-reset-protection.
2. Extract this ZIP into the repository folder, replacing the included files. It contains only
   changed/new files relative to the supplied staging ZIP. Keep all other files.
3. Review Changes in GitHub Desktop, then commit with:
   193.1 — CI-only reset protection candidate
   Publish the new branch.
4. Open a DRAFT pull request. Explicitly choose base: staging and compare: ci/193.1-reset-protection.
   Title: 193.1 — CI-only reset protection verification
   Do not merge the PR. Opening it triggers the existing CI workflow; merely publishing the
   temporary branch does not trigger that workflow because its push filter is main/staging.
5. Wait for the CI verify job. Its fresh Supabase database is disposable: it applies the full
   migration chain, runs reset SQL checks and independent-connection concurrency barriers,
   then runs the required Node 22 checks/tests/build.
   Send the PR link or a screenshot of the checks. If it fails, open the failed step and send
   the error plus the Fresh database failure diagnostics block when present.

Do not run migration 0163 manually. Do not merge into staging/main or use any Vercel preview
for scoring yet. The candidate needs fresh Supabase and concurrency proof before staging
promotion; authenticated staging/browser integration is a later gate. If environment branch
protection prevents CI starting, report that message rather than changing protections.

Why this route: .github/workflows/ci.yml triggers pull_request for this branch. Its live staging
parity condition excludes a PR whose head is ci/193.1-reset-protection; real staging integration
runs only for staging -> main; production parity runs only on a main push. Existing branch
workflows or Vercel may create additional checks/previews; ignore any preview for this step.

Local evidence: full CI/build passed under Node 24.19.0, actual callback/component regressions
passed with modelled responses, and actual SQL passed in an isolated PostgreSQL/PGlite fixture.
Node 22 GitHub, complete fresh Supabase, true database concurrency and live staging/browser
checks remain unexecuted here. See RELEASE_VERIFICATION_193.1.md for limits and source paths.
