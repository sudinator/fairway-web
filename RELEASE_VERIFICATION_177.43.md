# Release Verification — 177.43.260816

## Scope
Centralize Game Control Center mutation safety behind one pure ALLOW / CONFIRM / BLOCK policy. No migration.

## Intentional behavior change
177.42 allowed several organizer mutations through different local rules. 177.43 makes the transition contract explicit and consistent:
- scored players cannot be removed, moved to another team, or moved between tee groups;
- pairings and foursomes freeze once any score exists, including the legacy direct writers in `scoring-views.tsx`;
- individual/team and skins structural conversions are blocked once scoring starts;
- deterministic score reinterpretations remain available with explicit confirmation;
- tee/handicap edits after a player's first score are explicit whole-round corrections;
- ended games require reopen for competition edits, but reopen does not bypass score-state rules;
- rename/share remain metadata-safe; game-date correction remains available with confirmation;
- course replacement is not implemented in this release and remains pre-score-only by design.

## Contract inventory
### Inputs
- game status/type/teams/foursomes/pairings/allowance/scoring options;
- all player scores, no-show, team, tee-group and group-lock state;
- target format/structure/scoring option;
- target player and target tee/group/team where applicable.

### Outputs
- pure `SetupDecision`: allow / confirm(title,message) / block(reason);
- existing callbacks and Supabase/RPC writes remain the only mutation outputs;
- blocked/cancelled actions produce no database write;
- existing reload/notification/error side effects remain downstream of allowed decisions.

### Dependencies
- `lib/game-shape.ts` for canonical current/target competition shape;
- `lib/game-types.ts` for Game/Player contracts;
- `components/tournaments.tsx` for primary mutation ownership;
- `components/game/organizer-panel.tsx`, `scorecard-views.tsx`, `scoring-views.tsx`, and `game-setup-workspace.tsx` for policy-aware presentation and legacy structural writers.

## Old vs new behavior review
- Raw gross score writes/scoring ownership: unchanged.
- Supabase/RPC mutation payloads after an allowed decision: unchanged.
- Refresh/reload chains after successful writes: unchanged.
- Pre-score setup changes: remain allowed, subject to existing format prerequisites.
- Mid-round structural changes: intentionally tightened to BLOCK.
- Mid-round deterministic reinterpretations: intentionally preserved via CONFIRM.
- Match pairing and Four-ball/Trifecta foursome editors: now consume the same central policy instead of bypassing `GameRoom` handlers.

## EXECUTED validation
- Pure policy assertions: **41/41 PASS**.
- Workflow fault simulation: **50,087 checks PASS**.
- Game setup transition-policy contract: **PASS (28 source links + pure-policy check)**.
- Negative source-contract test: removing the foursome policy gate correctly makes the guard fail; restoring it returns PASS.
- Game setup workspace contract: PASS.
- Player tee setup contract: PASS.
- Extraction reachability: PASS.
- Extracted-state hygiene: PASS.
- Historical migration dependency closure: PASS across all 135 ordered migrations.
- DB extension prerequisite, migration-ledger, core-RLS helper/baseline/source-closure guards: PASS.
- CI runtime, fresh-DB CI, VAPID, reactive-time, round-analysis, environment-hygiene guards: PASS.
- UI guards: min-font, global layout, chart overflow, date input, bottom sheet, safe-area frame, contrast, popup close: PASS.
- Migration authorization + course-schema contracts: PASS.
- Staging integration source contract, effect-suppression, bet-atomicity contracts: PASS.
- Course-provider ID, PWA update, staging marker, course-source transparency, dashboard putts/round, historical rating/slope contracts: PASS.
- Changed TSX syntax parse: **0 syntax diagnostics** under dependency-free `tsc --noResolve`; unresolved imports/types are expected in that isolated parse.
- `MIGRATIONS.md` and `SCHEMA.md`: byte-unchanged; no database change.
- Unused-symbol debt check: advisory warning only; existing round-editor debt improved 24 → 21.

## ENVIRONMENT-LIMITED / NOT YET PASS
- `npx tsc --noEmit`: cannot start the project check because this workspace's dependency type roots are incomplete (`react`, `node`, d3 type packages, etc.).
- Full `npm test`: blocked by the same missing ambient type roots before suite execution. The new pure policy suite was separately compiled/executed and passed 41/41.
- `npm run build`: cannot run because the uploaded workspace does not contain a usable Next.js install (`next: not found`).
- GitHub CI / Vercel staging / targeted browser validation / PR verify / Production Ready / Production smoke: pending.

## Release gate
**NOT DEPLOYABLE YET.** The code candidate is ready for dependency-backed GitHub CI and staging validation, but the mandatory release gate is not complete until those checks, PR verification, Production deployment, and non-destructive Production smoke all pass.
