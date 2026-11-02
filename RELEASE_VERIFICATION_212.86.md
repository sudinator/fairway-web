# 212.86.261102 — explicit update banner

Candidate source; no deployment, live database writes, migration or member email. Do not treat local checks as live staging/iPhone approval.

## Problem and evidence
Owner reports staging remained on212.84 after refresh while212.85 was deployed. Source212.85 performs automatic worker registration and network-first navigation, but RegisterSW renders nothing and no explicit install/restart action exists. Actual phone response/cache/URL evidence is unavailable: the exact cause of that incident is UNKNOWN. A stale HTML response is a MODELLED scenario, not a diagnosed live cause.

## Intentional behaviour changes
- RegisterSW subscribes to shared update state and renders a green/gold, dismissible banner for a numerically newer version. Later dismisses that release for this tab session; Settings retains Update now. A different release can show again.
- Check on startup/reconnect/focus/visibility and every30minutes. No automatic reload on these events, deployment or controllerchange. The worker downloads in the background but waits for explicit activation: production212.78 has an unconditional controllerchange reload handler. Automatic activation could restart that old document. The existing SKIP_WAITING message is supported without score-state gates; network-first navigation is preserved.
- Explicit Update now rechecks the live version, requests a worker update, waits for installation, explicitly activates and waits for activation with bounded waiting, then navigates to the SAME origin/path/query/hash with one-shot version and timestamp parameters. Existing route parameters are preserved.
- A session-storage fallback holds only the requested version. On restart, compare the target with APP_VERSION actually running; success names that version, and a stale shell reports requested versus installed. Consume/remove the one-shot markers; no reload loop. Network/worker/navigation failures are bounded, show retry feedback, and never claim success from registration or version metadata alone.
- Unfinished rounds/outboxes do not block the action. Finish current entry before choosing a reload. No draft/outbox/score deletion, automatic upload, scoring state mutation or new database write. Existing old recovery copies remain exportable.
- Capability descriptions/FAQs/PDFs are unchanged from212.85 and still require the owner's copy review before production publication.

## Contract inventory / old-versus-new
Inputs: generated APP_VERSION; deployed version JSON; network/SW registration; focus/online/visibility/timer events; explicit Update now/Later/Dismiss; current URL; session-only attempt/dismissal strings.
Outputs: shared latest/checking/message plus new updating/notice/dismissed state; banner/Settings rendering; explicit navigation; version-marker storage and URL cleanup; existing notification navigation and guarded worker cache-cleanup message.
Dependencies: React external-store subscription; existing C/btn styling; navigator.serviceWorker; fetch/AbortController/timers; location/history/sessionStorage. Settings export still reads legacy recovery keys.
Preserved: worker fetch/cache and push handlers (version stamp aside), score writers, drafts, primary-device controls, migrations, handicap/recap calculations, member guide copy. Intentional change: user-visible update action/status restored, background checks surface new versions, worker activation requires explicit action. No old scoring safety gate is reintroduced.

## Validation
Record final executed checks in release-verification/212.86/local-ci.log. Targeted component tests execute the real RegisterSW and Settings components against MODELLED fetch/registration: current/new/invalid/older versions, pending legacy score keys, dismiss/new release, failed check, overlapping checks, stalled fetch/body, offline update, fresh URL/worker request, stalled navigation, failed restart, successful restart, retry/re-entry, recovery export and byte-identical pending drafts.
Chromium executes actual historical automatic workers and the new manual-activation worker plus registration/update code against a fixture server: active input survives deployment, legacy/other windows, offline shell/assets, API bypass, guarded pruning; deliberately stale HTML on explicit update must fail verification, then retry must load target and preserve all draft/outbox/recovery strings. This is not live Supabase or iOS evidence.

## Required external gates
Latest-commit GitHub verify, Robustness/onepager-sync, staging integration and Vercel staging Ready. On the affected iPhone verify212.86, banner Later/dismiss, Settings retry, pending-round update, offline failure/reconnection and preserved scores. Use two staged releases to test a real update transition. Confirm member descriptions before merging. Existing212.84 cannot display newly added code until a fresh document is loaded; if it remains stuck, inspect that device's exact staging URL/current/latest versions rather than deleting website data.
No new migration SQL is required. Live production schema parity is not certified by a package-version comparison.

## Final executed results
- EXECUTED final frozen-source npm run ci exit0, Node22/TZUTC: scoring-device/editor/game recovery, lint, TypeScript noEmit, complete unit/differential suite, changing-clock scenarios, lifecycle/source/security/format/version/assertion guards, gallery, actual-worker/browser checks and full production build PASS. The tracked assertion baseline now contains440,500 assertions across100 suites; the renamed update suite increased from16 to33. No suite was weakened.
- EXECUTED actual Chromium: background86 download does not trigger the verbatim212.78 reload handler or change its typed input. Explicit activation, deliberately stale HTML, target-version failure, successful retry, URL-marker cleanup and byte-identical score/draft/recovery strings PASS. Fixture server; not live iPhone/Supabase.
- EXECUTED actual RegisterSW markup rendered in Chromium with MODELLED newer-version state:320px and390px viewports have equal scroll/client widths, buttons remain visible, green/gold banner fits above bottom navigation space. Internal screenshots are not packaged or presented as live-app evidence. SSR markup preserves the real env(safe-area-inset-bottom) declaration; jsdom style serialization alone was unsuitable for this geometry check.
- All231 migration SQL files, score/draft/device/handicap code and capability/FAQ/PDF content remain byte-identical to212.85. No new migration. Historical212.78 source uses the same migration chain; no new SQL is introduced in this cumulative upgrade.
- Earlier test attempts caught superseded no-banner text expectations, the renamed assertion-suite baseline and a navigation-driving harness issue. Those are not the final release evidence; the complete final run above passed.
- GitHub/Vercel staging, live staging integration, affected iPhone transition and owner approval of member capability descriptions remain EXTERNAL gates. Production deployment has not been performed or certified.
