# 212.103.261114 — One yellow round recovery panel

Status: LOCAL CHECKS PASSED ACROSS THE RECORDED RUNS. GitHub/Vercel staging, physical-phone and production gates pending. No production clearance.

## Source and approved scope

Baseline is the exact previously delivered 212.102 source ZIP (SHA256 bc4d3f39b0850fd410a0e836c7601ee8a81594ec8e302b857d0fd6cd0521fb95). User approved retaining the existing yellow panel. The separate green personal-round nudge is removed. This candidate includes the prior tee correction and introduces no database migration, dependency update or stale-game automation.

## Reuse and contract review

- Reuse existing loadDraft, sameDraftRound, personalDraftIsPending, personalRoundFingerprint, clearDraft, Home navigation, completion, soft-delete and bulk-discard handlers. RoundEditor save/queue/device behavior is unchanged.
- Inputs: local draft, most recent server unfinished round, unfinished count, editor-stage visibility and existing callbacks. Home's loadRounds and refreshDraft remain the source of those values.
- Identity is the existing round ID/draft-session rule; never merge by course name or date. Matching copies show once; distinct rounds remain separate yellow cards. The local copy supplies Resume and displayed hole count, so offline edits are preserved. Server-only rounds also get the yellow card.
- Keep the approved gold background and Resume action. Add date and collapsed Round options for the existing Mark complete, Delete and Discard all actions. No nested buttons; native details/summary opens/closes options.
- Completion with unacknowledged matching local changes opens the existing scorecard rather than finalizing stale server values. Acknowledged local data supplies the gross total even when Home's server snapshot is older.
- Single complete/delete requests now return IDs; no returned matching row means failure with retained local data. On success clear only the matching draft revision, then refresh draft/server state. A delayed reply cannot clear newer local edits. Bulk discard clears local recovery only for actual returned server IDs and an unchanged local revision.
- Failed writes and cancellation retain recovery. Successful deletion/finish does not leave the old local banner behind. No score arrays, stats or round qualification rules are rewritten by this UI consolidation.

## Validation

EXECUTED / MODELLED boundaries: ci/test-round-recovery.cjs passes 58 assertions using the actual React component, actual extracted Home JSX and mutation/navigation handlers, actual draft/ack storage helpers, with modelled database and scorecard view. Covers same ID, session identity, distinct IDs on the same course, local-only, server-only, empty, Resume, cancel/return/re-entry, pending-change completion, acknowledged latest gross, failure, zero-row replies, deletion cancellation, only-matching cleanup, bulk cancellation/failure/returned-ID cleanup, and late-reply preservation of newer edits. A source assertion rejects restoration of the independent green banner.

BROWSER-VALIDATED component: ci/test-round-recovery-browser.cjs passes in Chromium at 360/390/430px. Asserts one card, no page overflow, Resume payload, Round options open/close and completion/delete callback IDs. Actual source component rendered; this is not a live full-Home/database/iPhone run. Collapsed layout visually inspected from the real component screenshot; internal screenshot is not a fabricated before image.

Final targeted lint and TypeScript no-emit: PASS. Local CI application stages passed: scoring-device, personal round editor, recovery/reset, workflow tests, lint/hooks, TypeScript, full unit/render/differential suites, 171 moving-clock suites, source guards, worker/update/redirect browser regressions and phone diagnostic privacy/persistence/browser checks. The final guard run used the 58-assertion recovery test and real recovery browser test. Production build passed separately (compile, TypeScript, static generation, routes).

The full command stopped on a chart-tooltip Close tap timing out at ci/test-chart-layout.cjs:58; an unchanged retry also timed out. Baseline 212.102 passed the same chart test. Candidate 212.103 then passed the unchanged chart test using the supplied container Chromium provider arguments through the existing PLAYWRIGHT_CHROMIUM override: 1,393 assertions / 324 data/viewport cases, including native mouse/touch Close/reopen and historical differential checks. No chart code, test actions or assertions were changed. The timeout cause remains unproven; retain as a CI reliability follow-up. This is a record of all checks passing across runs, not a claim of one uninterrupted successful npm run ci invocation.

An initial design-scale guard rejected new off-scale padding; changed to the existing allowed spacing token. The design baseline was tightened from 29 to 28 uses of an old off-scale padding after removing the green card; no new exception or guard relaxation. A provisioned headless Chromium executable was made available to Playwright locally; no source/CI browser discovery weakening.

## Remaining gates

GitHub CI including fresh-database/security jobs and required verify; Vercel staging Ready; physical iPhone existing-installation update and Resume/options/finish/delete in disposable staging data; production approval, Ready and safe smoke test. No destructive production tests. Local runtime uses Node 24; remote CI pins Node 22. No local fresh database or live database mutation was performed.

Approved stale-game rules remain unimplemented and separate: daily at 4 a.m. Eastern; empty game deletion seven days after later of creation/scheduled date; fully scored cards after 24h scoring inactivity; partials for organizer review; Test clubs excluded.
