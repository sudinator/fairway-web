# 180.0 release verification — Ryder Cup lifecycle and System Admin Game oversight

## Release shape

- Candidate: `180.0.260902`.
- Migration: `0145_competition_lifecycle.sql`.
- Rename is available to the Ryder Cup organizer, a current club admin, or a System Admin.
- An uncompleted Ryder Cup or standalone Game can be deleted by its normal organizer; once a Game is ended or has a posted round, deletion is System Admin-only.
- System Admin → Games oversight can search and inspect every Game without joining its club or becoming a player.
- Deletion preserves posted own-ball rounds (including Four-Ball and Singles) and removes posted Alternate Shot shared-ball rounds.

## Staging database gate

1. Confirm migration 0144 is already recorded.
2. Apply migration 0145 with RLS enabled.
3. Verify the lifecycle and Game-oversight RPCs exist, are executable by `authenticated`, and are not executable by `anon`.
4. Verify `game_players` has the SELECT-only System Admin policy and still has no System Admin direct-write policy.
5. Require the disposable fresh-database migration replay and authorization guards to pass.

## Staging browser scenarios

1. Rename an unlocked Ryder Cup; confirm the detail title and Ryder Cup list update after refresh.
2. Rename a locked Ryder Cup; confirm the schedule remains locked and its revision/points are unchanged.
3. Cancel a rename and confirm nothing changes.
4. As an ordinary club member, confirm rename and delete controls are absent.
5. As a System Admin, open Admin → Games oversight. Search by Game name, six-digit code, organizer, player, club, and Ryder Cup name; confirm each search finds the expected Game.
6. Inspect a Game in a club the System Admin has not joined. Confirm the Game opens and the System Admin is not added as a player or club member.
7. As an ordinary organizer, delete an active Game with no posted rounds; confirm normal deletion still works.
8. As an ordinary organizer or club admin, confirm deletion is unavailable for an ended Game or a Ryder Cup containing completed play and the UI explicitly says System Admin.
9. Create a disposable Ryder Cup with one Four-Ball, one Singles, and one Alternate Shot linked game.
10. Post an own-ball round from Four-Ball and Singles and a shared-ball round from Alternate Shot, then delete the Ryder Cup as a System Admin.
11. Confirm the Ryder Cup, all three games, their player rows, sessions, side scores, and contests are gone.
12. Confirm the Four-Ball and Singles personal rounds remain and the Alternate Shot shared-ball round is gone.
13. Delete a completed standalone own-ball Game as a System Admin; confirm its personal round and holes remain in Round history.
14. Delete a completed standalone Alternate Shot Game as a System Admin; confirm its shared-ball round and holes are removed.
15. Cancel each deletion confirmation and confirm every record remains unchanged.
16. At 375 px, 393 px, and 430 px widths, confirm Ryder Cup settings and every Admin Games result stay inside the viewport.

## Production gate

1. Apply and verify migration 0145 immediately before merging `staging` to `main`.
2. Require all pull-request checks and Vercel preview to pass.
3. Merge once; confirm Production migration parity, the live read-only schema guard, normal CI, and Vercel are green.
4. Smoke-test Ryder Cup rename and read-only System Admin Game search in Production. Do not delete real Production data merely to test deletion.
