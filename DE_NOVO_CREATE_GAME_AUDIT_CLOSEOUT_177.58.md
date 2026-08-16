# De novo Create Game audit closeout — 177.46 Production to 177.58 staging

## Purpose
Fresh comparison of the pre-convergence Production implementation (177.46) with the cumulative staging candidate after the Create Game convergence work. This audit does not assume that incremental releases were correct; it inventories the old responsibilities and verifies that each remains reachable in the current implementation or is an intentional documented behavior change.

## Bottom line
- **No legacy Create Game capability was found missing.**
- The core `buildGamePayload()` persistence contract remains behaviorally equivalent to the Production baseline; the historical differential suite remains in place.
- The old guided Stroke / Match Play selection hierarchy and Production visual grammar are restored.
- Custom handicap allowance retains 100/90/85 shortcuts plus an arbitrary 0–100 value, with blank-edit fallback to 100%.
- Resume Setup remains device-local and now additionally preserves workspace location, tee inheritance overrides, and custom allowance state.
- Advanced structural setup remains authoritative in Manage Game under the Lean Create design; the user is routed to the exact required section after creation.
- The guided-format helpers are now runtime-authoritative and characterized against the restored working handler semantics.
- No new database migration was introduced by 177.47–177.58.

## Source-diff inventory
Normalized source comparison of 177.46 -> 177.57 found:
- 17 modified tracked/source files
- 43 added files (modules, guards, tests, and release evidence)
- 0 removed files

One generated `tsconfig.tsbuildinfo` artifact was present in the working staging tree. It is **removed in 177.58** and is not part of the release overlay.

## Responsibility matrix
| Production responsibility | 177.58 owner | Status |
|---|---|---|
| Game name / play date / course | `CreateGame` + `CreateGameWorkspace` presentation | PRESERVED |
| Course/default tee selection | `CreateGame` + tee assignment helper | PRESERVED + extended |
| Player/member selection | `CreateGame` | PRESERVED |
| Guests + sponsor + handicap | `CreateGame` / `game-create` | PRESERVED |
| Handicap overrides | `CreateGame` draft state | PRESERVED |
| Stroke / Match family chooser | shared `FormatFamilySelector` | PRESERVED visually/semantically |
| Stableford | guided format helpers + existing state | PRESERVED |
| Stroke Net/Gross | existing state + helpers | PRESERVED |
| Match Individual/Team | guided format helpers | PRESERVED |
| Four-ball plain 2v2 / overall teams | existing `teamMode`; clarified label | PRESERVED |
| Four-ball Best ball / Shootout | existing `teamScoreMode` | PRESERVED |
| Trifecta Best ball / Shootout | existing `teamScoreMode` | PRESERVED |
| Trifecta Per-hole / Ryder Cup | existing `trifectaScoring` | PRESERVED |
| Skins Individual / 1:1 / 2v2 | existing `teamMode` + `skinsTeamStyle` | PRESERVED |
| Skins Carryover / Halved | existing `skinsMode` | PRESERVED |
| Team names | existing `team1` / `team2` | PRESERVED |
| Handicap allowance 100/90/85/custom | `allowancePct` + `handicap-allowance` edit helper | PRESERVED + input polish |
| Flights | existing flight state | PRESERVED + flight tee support |
| Resume Setup | canonical `GameSetupDraft` + compatibility adapter | PRESERVED + strengthened |
| Game payload construction | `lib/game-create.ts` | PRESERVED |
| Initial player row construction | `lib/game-create.ts` | PRESERVED + explicit tee inheritance/TGC scope |
| Activity log | existing create side-effect chain | PRESERVED |
| Tee-time linking | existing create side-effect chain | PRESERVED |
| Notifications | existing create side-effect chain | PRESERVED |
| Draft clear on successful Create | existing create side-effect chain | PRESERVED |
| Post-create destination | `postCreateDestination()` | INTENTIONAL CHANGE: exact Lean Create handoff |
| Teams/pairings/foursomes/tee groups editing | Manage Game | INTENTIONAL OWNERSHIP: post-create only |
| Manage Game format mutation safety | existing centralized transition policy | PRESERVED |

## Inputs / outputs / side effects
### Inputs preserved
All Production-facing setup inputs remain represented: course, date, field/default tee, roster, guests, sponsor, player handicaps, format family, format subtype, handicap allowance, team mode/names, scoring modes, skins modes, and flights.

### Outputs preserved
The game row and game-player rows continue to receive the same core persisted fields. New tee-inheritance metadata is resolved into explicit player tee/rating/slope/course-handicap snapshots before persistence; inheritance does not remain live after creation.

### Side effects preserved
The Create sequence still performs the existing activity, tee-time-link, notification, and draft-cleanup side effects after core row creation. Split-Skins field-size validation was intentionally moved ahead of the first database write to avoid an orphan-game failure path.

## Guided format equivalence
The final selector intentionally retains the Production hierarchy:
1. Stroke / Match Play
2. Stroke: Stableford / Stroke Play / Skins
3. Match: Individual / Team
4. Team branch: Four-ball / Trifecta / Skins
5. Existing sub-options remain available

The current pure helper API mirrors those actual user actions and is called by the live React handlers. This closes the earlier gap where helper tests modeled an abandoned flat-format UI rather than the actual guided workflow.

## Lean Create behavior
The intentional design change is that Create Game creates the valid core game and player rows, while persisted competitive structure remains in Manage Game.

The same `postCreateDestination()` result powers both Review guidance and runtime navigation:
- Stableford / Stroke -> Play
- Individual Match / plain Four-ball -> Manage Game -> Matchups
- Team Match / team Four-ball / Trifecta / team Skins -> Manage Game -> Teams
- Individual Skins -> Manage Game -> Groups

This avoids maintaining a second draft copy of teams, pairings, foursomes, and tee groups before a game exists.

## Known inherited risk — not introduced by convergence
Creation remains a browser-side multi-write sequence: the game row is inserted before the player rows. A player-row write failure can theoretically leave a game without its full roster. This existed in 177.46. The convergence project did not worsen it; one concrete orphan path (oversized Split Skins) was eliminated by moving validation before the first write. Full atomic creation remains separate hardening and is not silently included in this release.

## Migration status
177.47–177.58 introduce **no migration**. Migration 0138 belongs to 177.45 and was confirmed applied in both staging and Production; `MIGRATIONS.md` is corrected in 177.58 to reflect that operational state. The database ledger remains the source of truth.

## Executed local evidence
- Full `npm run guards`: PASS on 177.57 before closeout.
- Workflow/fault simulation: 50,087 PASS.
- Create Game format contract: 17/17 PASS.
- Create Game state inventory: 38 state cells + 4 refs classified.
- Guided-format characterization: 42/42 PASS (177.57 evidence).
- Post-create routing/guidance: 9/9 PASS (177.57 evidence).
- Existing Create Game workspace, draft, tee inheritance, Resume/TGC scope, structure, course-change and transition-policy guards: PASS.

177.58 changes documentation/version/artifact hygiene only; runtime application logic is unchanged from 177.57.

## Remaining mandatory release gates
Do **not** call the cumulative release deployable until all are complete:
1. GitHub dependency-backed CI for 177.58: `npx tsc --noEmit`, lint/hooks, guards, full unit/differential suite, Next build.
2. Vercel staging deployment Ready.
3. Browser validation of 177.57/177.58 behavior: format round trips, custom allowance blank/92% behavior, Resume, one simple-game handoff, one structural-game handoff, Manage Game family-filter non-mutation, and adjacent scoring entry.
4. PR verify on staging -> main.
5. Production Vercel Ready.
6. Non-destructive Production smoke test.
7. Sync main -> staging after successful Production closeout.

## Release decision
**Static/contract audit: PASS.**
**Deployable now: NO — GitHub/Vercel/browser/PR/Production gates remain.**
