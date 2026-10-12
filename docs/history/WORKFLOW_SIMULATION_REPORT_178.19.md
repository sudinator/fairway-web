# Workflow Simulation Report 178.19.260829

## Scope
Model-based validation of team-play setup transitions and Alternate Shot side-owned score persistence.

## Simulated scenarios
- New Four-Ball: two teams + tee groups derive the team-v-team contest; no Matchups step required.
- Legacy Four-Ball without global teams: historical matchup/foursome representation remains readable.
- New Alternate Shot: two teams + groups derive the side contest; each side must select its first driver.
- Tee order: selected first driver takes the first hole played and partners alternate by round position, including a back-nine start.
- Trifecta: explicit Matchups remain required because individual 1v1 points depend on opponent identity.
- Canonical score create/update: one side/hole row replaces duplicated player writes.
- Historical fallback: legacy duplicated partner score is used only when no canonical row exists.
- Canonical precedence: side-owned row overrides legacy player rows.
- Clear/re-entry: explicit NULL canonical tombstone masks legacy score; later non-null edit restores the side score.
- Offline draft: local optimistic score/draft survives until RPC acknowledgement; pending drafts block finalization.
- Retry/re-entry: acknowledged drafts are removed; canonical rows reconstruct the score after reload.
- Reset: side-score rows and scoring-start marker are cleared together; legacy player score arrays are also reset so no score resurrects.
- Structural mutation after canonical scoring starts: team/group/foursome/player removal transitions block; handicap correction remains explicit-confirm.
- Adjacent formats: Match and Trifecta retain explicit matchup semantics; Four-Ball/Alternate Shot team games do not.

## Results
- Alternate Shot side-score model: 5,006 assertions PASS.
- Alternate Shot deterministic match simulation: 178,103 assertions PASS across 5,000 matches.
- Game-structure randomized differential/transition matrix: 40,000 PASS.
- Game-create old-vs-new differential: 9,000 comparisons, 0 mismatches.
- Workflow fault simulation: 50,087 PASS.
- Team-play/Alternate Shot architecture source contract: 14/14 PASS.

## Staging runtime still required
Model/source testing cannot prove Supabase runtime authorization, realtime delivery, offline browser lifecycle, or rendered setup navigation. Migration 0141 and the 178.19 candidate must therefore pass the real staging integration and targeted browser acceptance before Production.
