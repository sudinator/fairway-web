# Release Verification — 177.49.260816

## Scope
Create Game convergence Stage 3A. Staging-only checkpoint.

## Intended behavior change
Create Game is reorganized into the target five-section navigation model: Game, Players, Format, Teams & groups, Review. The final Create action is exposed from Review. Existing form controls and mutation/persistence handlers remain authoritative.

## Deliberately unchanged
- `create()` database write sequence and error handling
- `buildGamePayload()` and `buildPlayerRows()` inputs/outputs
- game/player inserts, notifications, activity logging, tee-time linkage
- local Resume Setup serialized shape
- format/scoring semantics
- post-create routing (Stableford/Stroke -> Play; structural formats -> Setup)
- detailed team/matchup/foursome setup still occurs post-create in this checkpoint

## New boundary
`components/game/setup/create-game-workspace.tsx` owns presentation/navigation only. It contains no Supabase, RPC, games/game_players writes, or local-storage persistence.

## Executed validation
- `python3 ci/check_create_game_workspace_contract.py` — PASS 9/9.
- Differential source check: existing Players/Guests block is byte-identical to 177.48 after relocation; existing Format/Flights block is byte-identical to 177.48 after relocation.
- `npm run guards` — PASS, including 50,087 workflow/fault simulation checks and every prior Create Game draft/structure/setup contract.
- Create Game state inventory — PASS: 36 state cells + 3 refs deliberately classified; the new section-navigation state is explicitly runtime/UI state.
- Project `npx tsc --noEmit` was attempted; parsing reaches the changed TSX without syntax-class diagnostics, but the full dependency-backed type gate cannot complete locally because the supplied tree has no installed React/Next/Node type roots.
- `npm test` was attempted; it cannot compile the full test list locally for the same missing `@types/node` dependency root. GitHub CI remains mandatory.

## Required staging validation before next stage
- GitHub CI green.
- Vercel staging Ready.
- Browser: open Create Game and navigate Game -> Players -> Format -> Teams & groups -> Review -> back to earlier sections; confirm entered values remain intact.
- Browser: Resume an existing local setup draft and confirm the restored values remain intact while navigating sections.
- Do not promote to Production; this is an intermediate convergence checkpoint.

## Database
No migration. No schema/RLS/RPC change.
