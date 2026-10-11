# Release Verification — 178.16.260829

## Scope
Correct the TypeScript control-flow errors introduced by the 178.14 Alternate Shot team-card exclusion. No scoring or database behavior change.

## Root cause
The individual `YOUR CARD` block is guarded by `game.game_type !== "alt_shot"`, but two nested expressions still compared `game.game_type` with `alt_shot`. TypeScript correctly narrowed the union and rejected those comparisons as impossible.

## Changes
- Remove the redundant Alternate Shot comparison from `showIndivDots`.
- Remove the unreachable Alternate Shot `matchRun` branch from the individual-card block.
- Remove imports used only by that unreachable branch.
- Preserve all dedicated Alternate Shot team-card/results paths.

## Validation
- `python3 ci/check_altshot_team_card_contract.py`: PASS
- `python3 ci/check_altshot_view_contract.py`: PASS
- `python3 ci/check_single_altshot_source.py`: PASS
- `python3 ci/check_scoring_input_contract.py`: PASS
- `python3 ci/check_version_ledger.py`: PASS
- `python3 ci/verify_release.py .`: 20/20 PASS
- `npm ci --prefer-offline`: could not complete in this execution environment before timeout, so the dependency-backed TypeScript/build gate remains for GitHub/Vercel staging.

## Release status
STAGING CANDIDATE ONLY until GitHub CI and Vercel staging complete successfully.
