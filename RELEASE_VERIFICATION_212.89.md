# 212.89.261102 — approved match-results presentation

Candidate full source, based on the complete 212.88 source ZIP. No deployment or database writes have been made. External release gates remain required; this document does not certify a production-ready release.

## Approved changes

- Singles keeps fixed player positions and neutral leader-only live status. Completed tied matches show Halved beside both players and Final under the actual hole count (9 or 18). A decided winning match also shows Final beneath its closing hole count.
- Four-ball and Alternate Shot retain team names and rosters. Their compact results row uses the existing Trifecta player-name/leading-side emphasis and official closeout result. The header says Final rather than duplicating the closeout number. Existing expanded hole-detail handlers remain intact.
- Trifecta retains its existing score semantics, colors and emphasis. The thru count stays on one line; longer player names wrap instead of being hidden behind an ellipsis.
- Team Skins 2 v 2 labels each pair with its actual team name, retaining Pair 1/2 fallback for legacy missing associations. Skins counts, carry/tie handling and 1 v 1 rendering are unchanged.
- Scramble keeps its original compact team-name result and lists each roster/handicap once. The match title is white/cream; result and leading team's players are gold. Result and roster both use 12px. Level/unstarted sides have no leader emphasis. The field leaderboard is unchanged.

## Inputs, outputs and dependencies

Inputs unchanged: Game (format, holes, allowance, team definitions, pairings/foursomes, score mode, status), Player records (IDs, names, team assignment, scores, CH source), user/creator/mode, optional embedded/group filtering, Alternate Shot side scores and onChanged. No new public props or persisted state. Empty legacy hole metadata cannot be mistaken for a halved final.

Outputs intentionally change only visible labels/styles/line wrapping. MatchView's openProgress and FourballView's openKey still control the same expanded detail panels. The shared TrifectaContestRow receives the existing official st.thru/lead/result and existing decided condition instead of Four-ball/Alternate Shot's separate leader sentence. Its onToggle invokes the original setOpenKey callback. No engine algorithm, handicap calculation, score write, RPC, posting, settlement, update policy, storage, membership copy or database migration changes.

Scramble still displays scrambleResults(...).matches[].line verbatim, and derives highlighting from that same match status. TrifectaContestRow continues using trifectaRowState. No independent winner calculation was introduced. Setup handlers and the two components' public function signatures are unchanged. There are no added database/network effects.

## Simulations and verification

Evidence must distinguish modelled data from executed behavior. lib/match-results-presentation.test.tsx executes real component renders and engines using modelled 9/18-hole scores. It covers A/B leaders, live ties, unstarted matches, early closeout, final halves; all viewer roles for singles; Four-ball/Alternate Shot detail open/close/reopen/remount and embedded rendering; Trifecta swapped and 2 v 1; Scramble 2/3/4-member sides, final winners, no setup and unchanged field leaderboard; Team Skins best-ball and 1 v 1 counts/carries. It asserts unchanged props and no mutation callback during display interactions. Existing scoring differential, failure/retry, lifecycle, storage, security and adjacent tests remain required in the full CI run.

No new write path means there is no new rollback or write retry to model here; existing saving/failure/recovery tests are retained and must pass. Expanded detail column perspective and personal running-position behavior after clinch are not changed by this release. They remain separate follow-up audit items; this candidate does not claim to fix them.

The design-scale guard baseline is lowered by one duplicate off-scale padding occurrence because Four-ball/Alternate Shot now reuse the shared row. This tightens its existing debt ceiling; no new exception or guard bypass is added. The assertion-count baseline registers the new 574-assertion presentation suite so a future missing or reduced suite fails CI.

Additional EXECUTED in-place React rerenders exercise Violet leading → Burgundy leading → AS → Violet leading → final → unstarted (15 checks). The same mounted Scramble component updates its sentence and roster emphasis, clears stale highlights on ties/reset, and retains the engine's final result. See release-verification/212.89/live-transitions.json.

Local checks completed before the final aggregate rerun:
- EXECUTED full unit/differential suite: 441,078 monitored assertions across 101 suites; new presentation suite 574/574.
- EXECUTED explicit before/after renderer and source-contract comparison: 383 checks, including 52 unchanged named setup/detail helpers and unchanged pre-existing scoring library files.
- EXECUTED Chromium layout: 33 cases at 320/390/430px, zero overflow; computed white match title, gold result/leading roster and equal 12px result/roster fonts.
- EXECUTED in-place React transitions: 15 checks.
- EXECUTED gallery/worker/browser tests and production build passed after local environment provisioning. The gallery initially lacked its expected Playwright executable; the runtime's available Chromium was provisioned at that path. The public VAPID build variable was supplied from the existing committed worker key and verified; no opt-out was used. GitHub's own Playwright browser/environment remains an external check.

Final aggregate EXECUTED npm run ci: EXIT 0 on the frozen application/test/guard source (Node 22, TZ UTC). TypeScript, hook lint, full unit/differential suite, lifecycle/security/source/version/assertion guards, gallery overflow, worker/browser lifecycle tests and optimized production build all passed. See release-verification/212.89/local-ci.log. External GitHub verify, Vercel staging Ready, live staging integration and owner phone visual checks are not executable from this workspace and remain unverified. No production merge or deployment is authorized by this document. Prior candidate gates (including member-capability text approval where still outstanding) remain in force.

## Staging review after local checks

1. Confirm staging runs 212.89 and the update banner upgrades normally.
2. Open Singles live and tied final 9/18-hole matches. Check fixed sides, AS live, symmetric Halved/Final at finish.
3. Open Four-ball and Alternate Shot results and embedded scorecards; check both named teams/players, either-side gold emphasis, exact official closeout and detail open/close/reopen.
4. Open Trifecta normal, swapped and 2 v 1: all contests present, thru counts on one line.
5. Open Team Skins 2 v 2 and 1 v 1: names, totals, carry/tie labels unchanged.
6. Open Scramble match with four per side: white match title, equal-size gold result, gold winning roster, each player once, two handicaps. Check live tie and final result; field leaderboard unchanged.
7. Run the existing staging integration harness on staging only. Confirm scores save/reload normally and shared/Cup/recap totals still agree with official engines. These adjacent renderers have not been redesigned in this candidate.
8. Only after all required external checks pass, open staging → main PR; require verify, merge, confirm production Ready and perform non-destructive production smoke.
