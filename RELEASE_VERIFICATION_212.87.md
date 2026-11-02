# 212.87.261102 — update prompt with one action

Candidate full source, not a production deployment. No database writes, migration or email. Owner requested removal of banner dismissal: when an update is offered, Update now is its only action.

## Contracts and intentional change
- RegisterSW still subscribes to shared version/update state and registers the same worker lifecycle. A pending newer version always renders its prompt; Later/Dismiss controls, dismissal state and session-dismissal reads/writes are removed. Existing session dismissal keys remain untouched but are ignored.
- Error/progress feedback and retry remain visible. The Update now button remains disabled only while an explicit attempt is running. Legacy pending-round/outbox keys do not gate updates.
- A confirmed successful/current result may expire after8seconds through the real component effect. The expiration helper independently checks completed=true, updating=false and no newer version pending. It cannot hide an available update. Pending/error notices do not get that timer.
- Background download/manual worker activation, bounded installation and activation, timeout listener cleanup, actual-version verification, same-origin fresh navigation, ordinary network-first refresh and notification navigation are preserved from212.86. This is a persistent prompt, not an automatic reload or a modal that blocks the rest of the app.

Inputs: APP_VERSION, deployed version JSON, worker status, existing URL/attempt marker, shared update results, explicit Update now and success-expiry timer. Removed input: session dismissal key.
Outputs: one-action banner and shared Settings status; successful-result expiry. Existing explicit navigation, worker activation and version-attempt marker are unchanged. No score/draft/outbox/device writes, deletion, uploads or database APIs are added.
Dependencies: React external-store/effect hooks, existing C/btn styles and automatic-update controller. Worker body is byte-identical to212.86 apart from version stamp; scoring/handicap/recap/draft/device code and migration directories are byte-identical. Capability descriptions/FAQs/PDFs are unchanged and remain subject to owner copy approval.

## Test scenarios and evidence
Real component tests with MODELLED fetch/registration: one visible update action; no Later/Dismiss; old dismissal flags ignored; expiry cannot hide pending release; subsequent releases remain visible; failed update retains retry and installed-version feedback; timeout removes activation listener; explicit activation precedes navigation; stale restart fails; verified restart succeeds; actual8second effect callback clears only completed/current notice; legacy score strings remain unchanged. Existing normal, invalid, offline, request/body timeout, repeated-entry and adjacent recovery/scoring suites remain required.
Actual Chromium fixture-server test executes historical212.78 reload handler plus historical/new worker lifecycle: background download does not trigger the older reload handler, explicit activation, stale HTML detection, retry to target version, offline shell, API bypass and pending score preservation. This is EXECUTED source against MODELLED server/network data, not live iOS/Supabase evidence.

## External gates
Require latest-commit GitHub verify/Robustness/staging integration, Vercel staging Ready and affected iPhone validation before production merge. Check one-action banner, retry after offline failure, no unfinished-round gate, correct version after update, no banner after verified success expires and retained game scores. A device on212.84 must load new code once to receive this behavior; its earlier failure to load212.85 has not been independently diagnosed. No SQL migration required.

Deployment withdrawal is simulated: after a failed attempt, a fresh server check reporting current/older code clears the obsolete error; a later newer release restores the prompt. No pending newer release is hidden by this path.

Known verification limitation: the actual212.84 bootstrap has no banner or restart-result verifier. If a server/cache returns that old JavaScript, it cannot display these new error messages. The stale-version browser fixture exercises the current verifier with an older embedded version; it does not prove that historic212.84 can render new feedback. Actual phone Current/Latest versions must be checked for this case.

## Final executed evidence
- EXECUTED in an isolated source directory: scoring-device/round-editor/game recovery, lint, TypeScript noEmit, complete unit/differential suite (440,504 assertions across100 suites;37 update assertions), changing-clock scenarios, setup-navigation and lifecycle checks PASS.
- The full npm run ci attempt reached the final browser test and exited1 on the historical212.85 offline CDP-reload driver. It is recorded as a FAILED run, not a clean full-pipeline pass.
- The browser test now uses a real reopen-link gesture for offline navigation, still requiring a new document, cached application code and byte-identical saved scores. Existing online page.reload coverage remains. No product-worker/scoring code changed for this driver adjustment. The revised targeted browser test PASS.
- EXECUTED subsequent complete npm run guards && npm run build exit0: all source/security/version/assertion/format guards,390px gallery, actual worker/browser lifecycle and production build PASS. See final-guards-and-build.log. This completes local validation stages; a single fresh GitHub CI run is still a required external gate.
- Actual RegisterSW markup with MODELLED newer-version state was visually reviewed at320/390px: one Update now button, no Later/Dismiss, no horizontal overflow. Isolated component render, not a live iPhone screenshot. Internal screenshots are not packaged.
- Earlier attempts also caught test timer-mock typing and inconsistent generated test imports. Those failed attempts are not represented as release validation.
- All231 migration SQL files, score/draft/device/handicap code, Settings and member-guide content remain unchanged from212.86. Worker body unchanged except version stamp. No SQL migration required. Compiled test/dependency/build outputs are excluded from the source ZIP.
- No production deployment, live database write or membership email performed. GitHub/Vercel staging, integration, real-phone transition and member-copy approval remain outstanding. This candidate is NOT certified production-deployable.
