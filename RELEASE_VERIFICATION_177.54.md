# Release Verification — 177.54.260816

## Descriptor
Guided Format Selection Restore & Polish

## Scope
- Restore the pre-177.53 guided Stroke / Match Play format hierarchy and family icons.
- Preserve Lean Create and all modular draft/create/tee/resume behavior from 177.52–177.53.
- Restore 100/90/85 handicap shortcuts plus custom 0–100% allowance input.
- Clarify Four-ball overall team toggle to `Create named teams (e.g. Red vs Blue)`.
- Retain detailed Review format summary.
- No database migration.

## Behavior comparison
The Format UI block was restored from the verified pre-flat-selector source rather than re-created from memory. The only intentional wording change inside the restored block is the Four-ball overall-team label. The persisted state variables and game-create payload path remain unchanged.

## EXECUTED validation
- `ci/check_create_game_format_selection.py`: PASS 8/8.
- `ci/check_create_game_tee_inheritance.py`: PASS 12/12.
- `ci/check_create_game_resume_and_betting_scope.py`: PASS 10/10.
- `npm run guards`: executed through the Create Game workspace contract and all preceding guards, including workflow/fault simulation PASS 50,087; command hit the local 120s execution limit before the final three Create Game guards, which were then run individually and passed.
- `npm test`: BLOCKED locally because the supplied source tree has no installed Node type roots (`@types/node`); errors are missing `process` type declarations, not release-source diagnostics. GitHub dependency-backed CI remains mandatory.

## Required staging/browser validation
1. Stroke and Match Play family cards/icons render in BNN style.
2. Stroke → Stableford / Stroke Play / Skins selections behave as before.
3. Match Play → Individual / Team → Singles / Four-ball / Trifecta / Skins behaves as before.
4. Four-ball overall-team toggle reads `Create named teams (e.g. Red vs Blue)` and preserves the existing team-mode semantics.
5. Handicap allowance accepts 100, 90, 85 and a custom value such as 92.
6. Navigate away/back and Resume Setup; format and custom allowance persist.
7. Review describes the selected format correctly.
8. Create then hand off to Manage Game/Play according to Lean Create rules.

## Release status
STAGING CANDIDATE ONLY. Not deployable to Production until GitHub CI, Vercel staging, browser matrix, cumulative 177.46→final code/contract audit, adjacent workflow testing, and the complete BNN release gate pass.
