# Release Verification 178.19.260829

## Scope
Team-play setup simplification and canonical Alternate Shot side-owned scoring. New Four-Ball and Alternate Shot games use Teams + Groups without a redundant Matchups step; Trifecta retains Matchups because 1v1 opponent identity affects scoring. Alternate Shot persists an explicit first driver per side and stores one canonical side/hole score. Historical duplicated player scores remain a read-only fallback.

## Database
- `0140_alt_shot_side_scores.sql` creates `game_alt_shot_scores`, the canonical side-score RPC, realtime publication, RLS/grants, scoring-start marker, and reset integration.
- Staging 0140 verification supplied by the owner: structure 5/5 PASS and security/grants 9/9 PASS.
- `0141_alt_shot_clear_tombstones.sql` is a required additive follow-up found during backward-compatibility simulation: an explicit NULL row masks a cleared historical duplicated score instead of allowing it to reappear.
- 0141 must be applied and verified on Staging before the 178.19 application candidate is pushed. Neither 0140 nor 0141 is approved for Production until staging acceptance and the Production migration-parity gate pass.

## Executed locally
### Pure/differential tests
- Alternate Shot domain: 73/73 PASS.
- Alternate Shot scoring: 30/30 PASS.
- Historical duplicated-score reader: 49/49 PASS.
- Canonical side-score model: 5,006/5,006 PASS.
- Alternate Shot deterministic model simulation: 178,103/178,103 PASS across 5,000 matches.
- Game shape: 95/95 PASS.
- Game structure randomized differential/transition matrix: 40,000 assertions PASS.
- Game create: 60/60 PASS.
- Game-create old-vs-new differential: 9,000 comparisons, 0 mismatches.
- Create-game format: 41/41 PASS plus Alternate Shot format contract 12/12 PASS.
- Game setup policy: 53/53 PASS.

### Source/release guards
- Team-play/Alternate Shot architecture: 14/14 PASS.
- Alternate Shot team-card contract: PASS after updating the guard to the new canonical side-score callback.
- Scoring input / single Alternate Shot handicap source / Alternate Shot view-finalization: PASS.
- Migration ledger: PASS (28 ledger-era migrations checked).
- Migration manifest freshness: PASS.
- Migration parity contract: PASS 8/8.
- Migration authorization: PASS.
- Core RLS/source closure/fresh DB CI contracts: PASS.
- Workflow fault simulation: 50,087 PASS.
- Staging integration source contract: PASS.
- React hook-order, environment hygiene, VAPID source, reactive-time, UI/global rules, course schema, player tee, dashboard, course-provider, PWA and related source guards reached before/after the guard-chain timeout and passed.
- Design-scale regression introduced by the first-driver selector was corrected to the approved spacing token; design-scale guard then PASS.
- Game-structure source guard was made precise enough to allow pure `Array.from(...)` while still forbidding Supabase/client side effects; guard then PASS.
- Game-setup workspace boundary guard was updated for the new explicit first-driver callback; guard then PASS.

## Dependency-backed local gate
Could not be completed in this container because `npm ci` timed out and left an incomplete dependency tree. Evidence:
- `npm test`: cannot resolve installed type libraries from the incomplete `node_modules`.
- `npm run lint:hooks`: `eslint` executable unavailable.
- `npx tsc --noEmit`: missing React/Node/Supabase/Next type packages from the incomplete install.
- `npm run build`: after deliberate local VAPID opt-out, `next` executable unavailable.

These are environment/dependency failures before application assertions/build execution, not observed failures of the 178.19 behavior. GitHub CI + Vercel Staging remain mandatory and authoritative.

## Release status
**STAGING CANDIDATE ONLY. NOT PRODUCTION-DEPLOYABLE.**

Required next gates:
1. Apply/verify 0141 on Staging.
2. Push 178.19 changed files to Staging.
3. GitHub lint/type/full unit+differential/guards/build PASS.
4. Fresh-database CI and real Staging integration PASS, including canonical side-score authorization and clear tombstone.
5. Vercel Staging Ready.
6. Targeted browser acceptance for Four-Ball Teams+Groups, Alternate Shot first-driver/side-owned scores/offline-clear-reentry, and Trifecta Matchups retention.
7. Only then apply required migrations to Production under the parity gate and proceed with staging -> main PR.
