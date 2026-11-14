# 212.98 — protected-deployment update recovery (candidate)

Baseline: full 212.97.261109. Scope: version-check diagnostics and explicit recovery navigation with protection enabled. No Vercel setting is changed by this archive. Unauthenticated probes during this work confirmed that both / and /app-version.json redirect to Vercel login (302), with the perimeter restored.

## Contracts and intentional behavior

Existing version comparison, registration/focus/online checks, explicit worker activation, confirmed restart result, scoring, storage and recovery-copy export remain. Version requests add same-origin credentials (the existing browser default) and manual redirect handling; redirects/401/403/HTML cannot masquerade as version JSON. Errors become access, invalid, server, timeout or network categories; a request failure is not proof of being offline. State adds failure category and last-attempt time; background checks do not navigate or reload. Last-known version is labelled as such after failure.

Denied/redirected checks expose a recovery banner and explicit same-origin link. /auth/deployment-access is already excluded from interception by deployed workers, including 212.95; no new worker bypass is introduced. It passes through Vercel's normal gate before reaching an app route that returns only a no-store 303 to /. The route accepts no destination or secret, queries no database, and grants no access. No shared deployment bypass token, public exception, automatic retry navigation or storage deletion is included. Existing local draft data is retained; in-memory input must be saved before any explicit navigation.

UI inputs/outputs: existing store subscription plus new failure/time fields; update and check buttons retain their callbacks. Reconnect is a plain navigation link, not an update success signal. Existing background access errors now produce a visible recovery banner, rather than an absent version banner with an error only in More. Ordinary offline checks remain nonblocking. A successful retry clears the failure and reconnect action. Pending releases retain their existing explicit Update now path after access is restored.

## Validation

Full local npm run ci completed with exit 0: lint, TypeScript, full unit suite (447,254 assertions across 107 suites), moving-clock simulation (170 suites), differential/source-contract/security/version guards, browser regression tests and complete production build. Chart checks passed 1,393 assertions across 324 data/viewport cases and all 15 trends. No local checks were skipped. New unit/UI scenarios cover 401/403, opaque and followed redirects, login HTML, malformed JSON/version, server failure, timeout, successful retry, visible access recovery, retained known versions and byte-identical stored drafts. Real-browser fixture models a gateway before app/static requests and uses the actual worker/update module and recovery GET handler, an HTTP-only sign-in cookie and explicit sign-in navigation. This is modelled protection, not live Vercel proof.

## Archive review

The cumulative archive retains all 1,301 baseline files and adds the recovery route and this report. All SQL files, dependency records and CI workflow files are unchanged. The worker executable body is unchanged apart from release metadata. Generated build output, dependencies, test output and private environment files are excluded.

## External gates and bootstrap limitation

The user's previously installed app may be unable to download this candidate before its own deployment authorization is renewed. The new link cannot repair an old client before it has loaded new code. Verify initial delivery and reconnection in the installed app with Vercel protection enabled; do not use an unexplained public exception or delete app data as a workaround. Live staging authorization, Vercel Ready, GitHub CI/fresh database/live integration and physical iPhone/PWA validation are pending. Not approved for production or represented as a fully proven protected-PWA solution until those gates pass.
