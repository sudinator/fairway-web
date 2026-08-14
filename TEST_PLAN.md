# Refactor test plan — verifying component moves (Stage 1b: OrganizerPanel, BettingPanel, GroupScorecard, GroupsBuilder)

The leaf moves so far were low-risk enough that "did it build?" was the whole test. These four are a step
up: they're still top-level components coupled only through typed props (no shared scope), BUT they perform
~23 Supabase writes between them (posting/unposting bets, setting/randomizing tee groups, claiming/releasing
groups, entering scores, switching format, ending games). Those side effects can't be exercised by a compiler
or a pure unit test, so the plan adds a live click-through on top of the static guarantees.

## What can actually go wrong in a *relocation*, and what catches each
1. Accidental edit to the moved code during cut/paste → **byte-identity check** (ci/verify-relocation.py).
2. A dependency left behind / renamed → **tsc**.
3. An identifier resolving to a *different* binding in the new file's scope → **tsc** (type mismatch) +
   controlled imports + a manual reference review of the new file's import list.
4. Prop-contract drift at the `GameRoom` call site → **tsc** (the call site is unchanged; types must match).
5. Runtime / DB behavior — RLS, realtime, the actual mutations → **manual QA only**. No static check reaches this.

Because a relocation changes no logic, the strongest guarantee is (1)+(2): if the moved code is
character-for-character identical AND it typechecks in its new home AND the app builds, the only remaining
risk is #5 (runtime), which Tier C covers.

## Tiers
- **Tier A — automated equivalence (the core guarantee).** byte-identity of every moved component vs its
  pre-move snapshot; `tsc --noEmit`; `next build`; existing `npm test`; all 8 guards.
- **Tier B — logic already covered.** The pure math these components call lives in lib and is unit-tested
  (money.test, legs.test, golf.test, game-shape via sync/grouping tests). Those must stay green; they will,
  because lib is untouched. We deliberately do NOT add component render tests here — a relocation can't change
  render logic, and standing up a jsdom/RTL harness for it is cost without benefit. (That harness IS worth it
  for Stage 4 — see Tier D.)
- **Tier C — manual QA smoke (REQUIRED for these four, because of the writes).** Scripted click-through on the
  "App Testing" club against a throwaway game. Checklist below.
- **Tier D — future, Stage 4 only.** Before decomposing GameRoom/CreateGame (where behavior genuinely can
  change, not just move), stand up an integration harness (vitest + React Testing Library + a Supabase test
  project or mocked client) and write characterization tests for scoring, settlement, and finalization. Do
  NOT gate this relocation on it.

## Process discipline
Move **one component at a time**, running Tier A after each, so any failure is isolated to a single move.
Snapshot all four BEFORE any move (baseline). Bundle the four moves into one deploy at the end; then run Tier
C once against the deployed build.

## Before / after protocol
BEFORE (once): baseline green (tsc + build + tests + guards); `python3 ci/verify-relocation.py snapshot pre`
records a hash of each component's exact source.
PER MOVE: cut the component into components/game/*.tsx; add its imports; `tsc`.
AFTER (per move): `python3 ci/verify-relocation.py check pre` re-extracts each component from wherever it now
lives and asserts byte-identity to the snapshot; then tsc + build + tests + guards.
AFTER (once, post-deploy): Tier C manual QA.

## Tier C — manual QA checklist (run on the "App Testing" club, throwaway game)
Do each action and confirm the described result. Any deviation = stop and report.

**GroupScorecard** (score entry grid)
- [ ] Open a game; as the group's marker, enter strokes for 2–3 players across several holes. Scores save and
      the net / stroke-dots and running totals look right; yardages show per tee; header stays frozen on scroll.
- [ ] "Take over" a group you don't mark, enter a score, then "Release". Marker changes as expected.
- [ ] Flag a no-show; confirm four-ball scores that player as net double bogey and others are unaffected.

**GroupsBuilder** (tee groups)
- [ ] Assign players to tee groups manually; the assignment persists after reload.
- [ ] "Randomize"; groups fill within size limits and any overflow is flagged, not dropped.

**OrganizerPanel** (structure & lifecycle)
- [ ] Switch format (e.g. Stableford → Match → Four-ball) and back; teams/foursomes you set are restored on
      switch-back (structure_stash), not lost.
- [ ] Toggle "Share live scorecard" on/off; the public link appears/disappears.
- [ ] End the game; it moves to ended state and each player's round posts to their history (existing behavior).

**BettingPanel** (money — highest-stakes, watch closely)
- [ ] Post the bets; a money event is created and the per-player nets match the leaderboard result.
- [ ] Unpost, then re-post; no duplicate settlements, nets identical to the first post.
- [ ] With a guest in the game, confirm the guest is attributed to their sponsor in the money split.

If Tier A is green and Tier C shows no deviation, the move is verified.

## Tier D — real staging Supabase integration (v177.14+)
Run `npm run test:staging` only against a disposable/staging Supabase project. Required environment variables:
- `BNN_STAGING_SUPABASE_URL`
- `BNN_STAGING_SUPABASE_ANON_KEY`
- `BNN_STAGING_SUPABASE_SERVICE_ROLE_KEY`
- `BNN_STAGING_ALLOW_MUTATION=YES`

The suite creates temporary users and fixtures, tests authenticated RPC/RLS behavior through normal anon-key clients, uses the service-role client only for fixture setup/assertion/cleanup, and deletes its fixtures at the end. Current coverage includes course correction RLS/retry/review, Money rollback under a real uniqueness failure, parallel RSVP ordering, TGC bet re-post rollback, and safe group deletion. `npm run ci:staging` is the intended release-candidate gate after ordinary `npm run ci`.

### GitHub Actions wiring
`.github/workflows/ci.yml` runs the normal `npm run ci` gate on pull requests and pushes to main. `.github/workflows/staging-integration.yml` is an explicit/manual staging gate because it creates disposable users/data. Configure the three `BNN_STAGING_SUPABASE_*` values as secrets in a protected GitHub `staging` environment; the workflow supplies the mutation-confirmation switch only inside that protected job.


## v177.15 corrective staging result
The first real staging execution of the v177.14 suite caught a PL/pgSQL runtime ambiguity in `save_bet_expense_atomic` that static/model checks had not surfaced. After applying the 0134-qualified-column fix, the full GitHub `Staging integration` workflow passed. This validates the release process itself: static/unit/build gates remain useful, but a real staging PostgreSQL/RLS/RPC run is required before future production database releases.

## Tier E — permanent extraction integrity (v177.19+)
- `check_extraction_reachability.py`: verifies critical entry -> state -> extracted render/call -> callback/downstream chains remain present.
- `check_extracted_state_hygiene.py`: fails fully orphaned React state in extracted components.
- `check_extracted_import_debt.py`: ratchets inherited import debt so it can decrease but cannot silently grow.
- Stateful extractions require scenario tests for normal flow, cancel/exit, retry/re-entry, failure paths and relevant adjacent workflows.
- Pure extractions retain old-vs-new differential tests where practical.
- Before a candidate is built, verify the input tree is the current clean synchronized `staging` branch. After applying the candidate, differential-review every changed file and confirm unrelated CI/workflow files remain unchanged unless intentionally modified.

## External API contract gate
- GolfCourseAPI: `node ci/external/golfcourseapi-contract.mjs` runs weekly in GitHub Actions using `GOLF_API_KEY` and 18 reviewed Production fixtures. A failure opens/updates an admin GitHub issue.
- Release tests must include provider-id contract tests: ids returned by search normalization must be accepted by detail validation; current opaque ids and legacy numeric ids are accepted; path/query/control-character ids are rejected.
- PWA release test: old installed release -> deploy new release -> old app remains active -> update prompt appears -> Current remains old / Latest is new -> explicit Update activates/reloads -> Current=Latest. Same-version rebuilds must not produce a user-visible update prompt.

## 177.21 targeted release tests
- Staging environment marker: Vercel `staging` preview shows a persistent yellow safe-area-aware border and STAGING badge; Production/main does not.
- Existing provider course selection: search Francis Byrne in Production; selecting it immediately shows `ALREADY IN BNN` and displays the stored BNN rating/slope/tee data as primary.
- Provider drift visibility: when fresh GolfCourseAPI data differs from stored BNN data, show a clear differences summary; do not overwrite stored BNN values automatically.
- Explicit provider review: `Load provider data for review` swaps the editable form to the fresh provider payload; saving changed provider data follows the existing correction/reason path rather than silently replacing the canonical record.
- New provider course: a course absent from `favorite_courses` is labeled `NEW COURSE FROM GOLFCOURSEAPI` and retains the existing create/link flow.
- Canonical duplicate safety: selecting an existing course must reuse the existing BNN canonical UUID, never create a duplicate.
- Re-entry: after selecting an existing provider course, leave and resume the draft; the stored-vs-provider source context must be preserved.
- PWA transition test (Production): start with installed 177.20, deploy 177.21, verify Current remains 177.20 and Latest becomes 177.21 until Update is pressed; after Update, Current=Latest=177.21 and the prompt disappears.
