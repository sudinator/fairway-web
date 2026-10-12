# Release Verification — 177.55.260816

## Descriptor
Cumulative Guided Format Restore + Shared Create/Manage Selector

## Baseline / cumulative scope
This is the cumulative staging package to apply directly on top of 177.53. It includes both the 177.54 guided-format restoration and the 177.55 shared Create/Manage selector work. The standalone 177.54 overlay is not required.

## User-facing changes
- Restore the proven Create Game Stroke / Match Play guided hierarchy and the original family icons.
- Restore Stroke → Stableford / Stroke Play / Skins.
- Restore Match Play → Individual / Team → Singles Match / Four-ball / Trifecta / Skins.
- Restore handicap-allowance shortcuts 100% / 90% / 85% plus the custom 0–100% input.
- Preserve all existing Stroke, Match, Four-ball, Trifecta and Skins sub-selections and persisted semantics.
- Rename the Four-ball overall-team control to `Create Team Names (Red vs Blue)`.
- Retain the detailed Review format summary from 177.53.
- Reuse the same shared Stroke / Match Play family cards and icons in Manage Game → Format.
- In Manage Game, family-card clicks are presentation/filter state only. Persisted format mutation still occurs only from a concrete format choice through the existing setup policy.

## Preserved architecture / behavior
- Lean Create remains Game → Players → Format → Review → Create.
- Resume Setup, default/flight/player tee inheritance, game-create payload generation and post-create Manage Game handoff are unchanged.
- Manage Game remains authoritative for teams, pairings, foursomes and tee groups.
- Existing scoring engines and database schema are unchanged.
- Existing `teamMode`, `team1` / `team2`, allowance, scoring-mode and format persistence contracts remain unchanged.
- No migration.

## Contract review
- `components/game/setup/format-family-selector.tsx` is presentation-only and has no Supabase/database ownership.
- Create Game retains its existing `fmtFamily` state and handler semantics.
- Manage Game adds only local `manageFormatFamily` presentation state, initialized/re-synced from the persisted game shape.
- Clicking a Manage family card does not call `onSetFormat`.
- Concrete Manage format buttons preserve the central `policy({ type: "set_format", target: key })` gate before `onSetFormat(key)`.
- Existing scoring/format mutation callbacks and their inputs/outputs are unchanged.

## EXECUTED validation
- `python3 ci/check_create_game_format_selection.py`: PASS — 12/12 checks.
- `python3 ci/check_game_setup_policy_contract.py`: PASS — 31 source links + pure policy.
- `npm run guards`: PASS, including 50,087 workflow/fault simulation checks and all existing Create/Manage setup contracts.
- Create Game state inventory remains 37 state cells + 4 refs classified.
- Resume/TGC-scope, tee-inheritance, workspace, course-change and Control Center contracts: PASS within full guard suite.
- Secret/environment guard within `npm run guards`: PASS.

## Dependency-backed gates
The supplied source tree has no installed application dependency tree.
- Full `npx tsc --noEmit`, `npm test`, and `npm run build` remain GitHub CI gates.
- These are not reported as local PASSes.

## Browser validation required on staging
1. Create Game → Format shows the restored Stroke / Match Play cards/icons.
2. Custom handicap allowance works (test a non-shortcut value such as 92%).
3. Stroke branch retains Stableford / Stroke Play / Skins and their existing sub-options.
4. Match branch retains Individual / Team and the existing Singles / Four-ball / Trifecta / Skins paths.
5. Four-ball overall-team control reads `Create Team Names (Red vs Blue)` and reveals the same team-name inputs.
6. Create Game → Review accurately describes the selected format; navigate backward/forward and verify selections persist.
7. Leave Create Game and Resume; verify the format and custom allowance restore.
8. Manage Game → Format renders the same Stroke / Match Play cards/icons.
9. In Manage, tapping a family card alone does not change the persisted game format.
10. Selecting a concrete Manage format still follows the existing ALLOW / CONFIRM / BLOCK policy, including after scoring.

## Production status
Not deployable until GitHub CI, Vercel staging, the browser validation above, and the final cumulative 177.46→staging de novo functionality audit all pass.
