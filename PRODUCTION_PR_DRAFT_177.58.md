# PR title
Release 177.58 — Create Game Convergence and Manage Game Format Consistency

# PR description
## Purpose
Complete the cumulative Create Game convergence work begun after Production 177.46 while preserving the existing BNN game/scoring model and making Create Game safer, easier to resume, and consistent with Manage Game.

## User-facing changes
- Create Game is organized as **Game -> Players -> Format -> Review**.
- Advanced persisted structure remains in **Manage Game** rather than being duplicated into pre-create draft state.
- Default tee can be applied to the field, with flight-level and individual-player exceptions before creation.
- Interrupted Create Game setup is durably resumable, including current section, tee overrides, custom handicap allowance, guests and format selections.
- The original Production **Stroke / Match Play** guided format hierarchy and icons are retained.
- Handicap allowance retains 100%, 90%, 85% shortcuts plus a custom 0-100 value; blank custom editing safely falls back to 100%.
- Four-ball wording is clarified to **Create Team Names (Red vs Blue)** without changing its persisted `teamMode` behavior.
- Create Game and Manage Game share the same Stroke / Match Play family selector presentation.
- Manage Game family-card changes are presentation/filter state only; persisted format changes still go through the existing ALLOW / CONFIRM / BLOCK transition policy.
- Review now shows the exact post-create destination (Play, Teams, Matchups or Groups), sourced from the same routing helper used at runtime.

## Architecture
- Added canonical typed Create Game draft model and compatibility adapter.
- Added permanent Create Game state inventory guard.
- Extracted pure game-structure calculations used by the existing persisted editors.
- Added shared tee-assignment resolution: individual override -> flight tee -> game default tee.
- Added shared Production-style format-family selector.
- Added authoritative guided-format pure helpers characterized against the restored Production handler behavior.
- Kept core game creation and structural editing ownership deliberately separate under the Lean Create model.

## Preserved behavior
A fresh 177.46 Production -> final staging audit found no missing legacy Create Game capability. Stableford, Stroke Net/Gross, Match Individual/Team, Four-ball modes, Trifecta modes, all Skins structures, team names, handicap allowance, flights, guests, tee-time seeded creation, notifications/activity and Resume remain represented.

The core `buildGamePayload()` contract remains behaviorally equivalent to the Production baseline, with historical differential coverage retained.

## Intentional changes
- Structural formats hand off directly to the appropriate Manage Game section after Create instead of duplicating teams/pairings/foursomes/tee-groups in pre-create draft state.
- Player tee inheritance resolves to explicit per-player tee/rating/slope/course-handicap snapshots at creation.
- Split-Skins field-size validation now runs before the first DB write to prevent an orphan-game failure path.
- TGC-specific guest betting defaults/messaging no longer leak into ordinary non-TGC groups.

## Known inherited risk
Game creation remains a browser-side multi-write sequence (`games` before `game_players`). This existed before the convergence project. Full atomic creation is intentionally left as separate hardening rather than being silently bundled into this large UI/refactor release.

## Database
**No new migration for 177.47-177.58.** Migration 0138 belongs to 177.45 and was already applied in staging and Production.

## Validation
Final PR should only be merged after inserting the final green evidence for:
- GitHub CI/type/lint/unit/differential/build
- full guard suite
- 50,087 workflow/fault simulations
- de novo 177.46 -> final staging contract audit
- targeted browser matrix on staging
- adjacent Manage Game/scoring workflow validation
- Vercel staging Ready
- PR verify green

## Production closeout
After merge:
1. Confirm Vercel Production is Ready.
2. Run a small non-destructive Create Game/Manage Game smoke test.
3. Confirm no new migration is required.
4. Sync `main` back into `staging`.
