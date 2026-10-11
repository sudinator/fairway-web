# Release Verification — 177.56.260816

## Descriptor
**Format UI Fidelity + Handicap Input Polish**

## Baseline
Built directly on the cumulative 177.55 staging candidate. No migration.

## Scope
1. Preserve the established Production BNN Stroke / Match Play selector presentation in the shared Create/Manage selector.
2. Correct the custom handicap-allowance editing behavior: delete to blank; blank means no custom override and resolves to 100%; blur restores visible 100%.
3. Preserve custom allowance values through Resume Setup instead of letting a generic game-type effect overwrite them.

## Production UI fidelity review
The shared `FormatFamilySelector` was compared against the 177.46 Production Create Game source used by the supplied Production screenshot. The following observable selector contracts are retained:
- two side-by-side family cards;
- selected card uses dark green with a 1.5px gold outline;
- unselected card uses green-light with transparent outline;
- 12px corner radius and 11px padding;
- 34x34 cream circular icon with 1.5px gold border;
- original flag and crossed-club SVGs;
- Georgia 15px family title;
- 11px sage subtitle;
- labels `Stroke / The whole field` and `Match play / Head to head`.

Permanent source-contract checks now lock those attributes.

## Executed validation
- `HANDICAP_ALLOWANCE_PASS 8/8 assertions` — blank edit, blur/default, custom 92%, clamp boundaries.
- `CREATE_GAME_FORMAT_SELECTION_PASS 15/15` — includes Production selector geometry/selected state, custom editor behavior, and Resume allowance preservation.
- `CREATE_GAME_STATE_INVENTORY_PASS 38 state cells + 4 refs classified`.
- Full `npm run guards`: PASS.
- Workflow/fault simulation: **50,087 PASS**.
- Existing Create Game workspace, tee inheritance, Resume/TGC scope, Manage Game transition-policy, course-change, RLS, migration and UI guards: PASS.

## Dependency-backed gates attempted locally
- `npm test`: BLOCKED by missing installed `@types/node` in this supplied source tree. The first failures are existing tests referencing `process`; the new standalone allowance test itself compiles and passes.
- `npx tsc --noEmit`: BLOCKED by absent installed Next/React/Node/Supabase type roots.
- `npm run build`: prebuild/version stamping PASS; build BLOCKED because local `next` executable is not installed.

GitHub CI remains mandatory for dependency-backed type, full unit, lint, and Next build validation. This candidate is not Production-ready until those gates and targeted staging browser validation pass.

## Database
No migration.
