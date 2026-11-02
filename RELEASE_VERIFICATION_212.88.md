# 212.88.261102 — CI browser discovery

Candidate full source. No deployment, database migration/write or member email. Update behavior and member descriptions remain as212.87; this change fixes the test harness and release metadata only.

## Observed failure and cause
Owner's GitHub verify screenshot: npm run ci reached the update browser test after the automatic-worker check passed, then failed ENOENT scandir /opt/pw-browsers in ci/test-update-browser.cjs. The212.87 script unconditionally read that authoring-runtime directory before calling Chromium. GitHub's workflow already installs the matching Playwright Chromium with npx playwright install chromium --with-deps; its cache does not require /opt/pw-browsers. This is an environment assumption in the test, not a database/app-scoring failure.

## Change and contract
ci/playwright-browser.cjs centralizes this test's launch selection: explicit PLAYWRIGHT_CHROMIUM override first; otherwise a matching existing provisioned local binary; otherwise omit executablePath so Playwright resolves its own installed browser. ENOENT is handled; permission and genuine launch failures still fail. No browser check is skipped and no app update/scoring code is imported from this helper.
Inputs: environment override, filesystem directory entries/existence, Playwright launch API. Output: same real browser object, or a thrown launch/filesystem error. Existing sandbox/software-rendering arguments are preserved. The update test calls this helper and retains every lifecycle, offline, legacy-handler and score-preservation assertion. No app runtime policy changes.
The new launcher regression runs from npm run guards and exercises absent directory, local provisioning, explicit override without scanning, stale and unrelated entries, permission failure and genuinely unavailable browser. Actual launch API invocation/default executable-path omission are checked; mocked cases do not pretend to launch a real browser.

## Evidence levels / release gates
Executed resolver tests use MODELLED filesystem/launcher responses. A separate real Playwright default-cache smoke uses an actually absent provision directory and an existing runtime Chromium binary placed in a temporary Playwright-compatible cache layout. It proves the default launch branch works without executablePath; it is not the GitHub-downloaded binary or a live Actions run. Full browser lifecycle scenarios execute actual Chromium against a fixture server; no live Supabase/iPhone access is implied.
The complete local CI result is recorded in release-verification/212.88. Remote GitHub verify must pass after pushing the full candidate. Vercel staging Ready, actual phone update behavior and member-copy approval remain external gates before a production merge. No production-ready claim is made from local checks alone.

## Final executed results
- EXECUTED complete frozen-source npm run ci exit0 (Node22, TZUTC): scoring-device/editor/game recovery, lint, npx tsc --noEmit, full unit/differential suite (440,504 assertions across100 reported suites), changing-clock scenarios, lifecycle/source/security/format/version/assertion guards,390px gallery, actual worker/browser lifecycle tests and production build PASS. See release-verification/212.88/local-ci.log.
- EXECUTED seven launcher-regression scenarios PASS; genuinely missing browser/permission errors propagate rather than skipping testing. The exact absent-directory failure now selects Playwright's own launch without executablePath.
- EXECUTED real default-cache Chromium launch with an absent provision directory PASS. The temporary Playwright-layout cache used the already available runtime binary, so this is not represented as an actual GitHub-runner binary test.
- Reviewed current workflow: its existing Chromium install step is sufficient. No workflow/dependency changes required. GitHub Actions must still rerun against the new commit; no remote CI or Vercel result has been claimed.
- App/components/lib sources unchanged apart from generated lib/app-version.ts metadata; worker body unchanged except version stamp; all231 SQL migrations and member capabilities/FAQs/PDFs unchanged. No data writes/migration/email/deployment performed.
- A complete full-source ZIP excludes dependency folders, compiled outputs and private environment files. Staging/iPhone/member-copy and production release gates remain external.
