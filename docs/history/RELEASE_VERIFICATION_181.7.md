# Release verification — 181.7.260903

## Scope

- Delete a linked Ryder Cup session game before or after scoring without deleting its planned session.
- Preserve own-ball history; remove Alternate Shot shared-ball rounds.
- Show team player counts and handicap-index totals while assigning the Ryder Cup roster.
- Keep an assigned player in their own Groups selector and exclude them from other selectors.

## Local verification

- TypeScript: PASS.
- ESLint hooks: PASS.
- Full unit/render suite: PASS — 189,941 assertions.
- Differential suites: PASS — no mismatches.
- Competition contract: PASS — 47/47.
- Competitive assignment contract: PASS — 31/31.
- Security, RLS-source, migration authorization, manifest and parity guards: PASS.
- Design scale, contrast, mobile fit and tap-target guards: PASS.
- Production build: PASS with documented local VAPID opt-out and placeholder public Supabase variables.
- Dependency-registry lookup: unavailable in the network-restricted environment; non-blocking existing CI behavior.

## Modelled scenarios

1. Linked Four-Ball/Trifecta/Singles game with scores: unlink session, delete game/player rows, retain personal rounds.
2. Linked Alternate Shot game with scores: unlink session, delete holes and shared-ball rounds, then delete game/player rows.
3. Locked Cup schedule: changing only `game_id` remains permitted; planned scoring fields remain untouched.
4. Unauthorized member/anonymous caller: RPC is denied.
5. Missing or standalone game: RPC rejects without partial deletion.
6. Delete failure: client displays the database error and retains local game state.
7. Selector round trip: assign player → player remains selected in that slot → absent from other slots → unassign → becomes available elsewhere.
8. Roster balance: counts and index totals update immediately after either team assignment changes.

## Required Staging acceptance

1. Apply migration `0148_delete_competition_session_game.sql` to Staging and confirm its ledger row.
2. Deploy 181.7 to Staging; confirm GitHub Actions and Vercel are green.
3. In a scored own-ball Ryder Cup session game, delete the game and verify the planned session remains with a Create Game action and personal rounds remain.
4. Repeat with an Alternate Shot test game and verify its shared-ball rounds are removed.
5. Confirm an ordinary club member cannot invoke the deletion.
6. Create a Ryder Cup and verify both team player counts, handicap-index totals and difference update live.
7. In Trifecta Groups, verify the current assigned player remains selected, does not appear in another slot, and reappears elsewhere after unassignment.

## Release status

STAGING CANDIDATE. Not Production-deployable until migration 0148 and all Staging acceptance checks above pass.
