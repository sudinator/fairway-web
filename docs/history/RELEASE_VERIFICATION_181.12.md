# Release verification — 181.12.260903

## Scope

This release closes four scoring-integrity findings: duplicated Course Handicap math, stale-device resurrection of individually cleared scores, unattributed 1:1 Team Skins, and hardcoded Ryder Cup Trifecta settings.

No database migration is required. Migration 0148 remains current.

## Required automated evidence

- TypeScript and React hook lint pass.
- Full unit/render suite passes.
- `ci/check_scoring_integrity_181_12.py` passes 9/9.
- Full repository guard suite passes.
- Production build passes with deployment environment variables supplied.

## Staging acceptance

### Offline clear protection

1. Open the same active game on devices A and B while both are synchronized.
2. On device A, disconnect and retain an existing score locally.
3. On device B, clear that score and wait for **Synced**.
4. Reconnect device A and select **Sync now**.
5. Refresh both devices. The score must remain cleared.
6. Enter a new score on an empty hole while device A is offline, reconnect, and verify that the new score uploads.

### Ryder Cup Trifecta parity

1. Open a Ryder Cup Trifecta session configured as Match + Best Ball.
2. Record a controlled score pattern that decides both Singles and the Four-Ball contest.
3. Compare all three game-room results with the Ryder Cup session card.
4. Winners, close-out labels, decided counts, and session points must match exactly.

### Team Skins defensive state

1. Use a test or legacy 1:1 Team Skins record containing a paired player without Team A/B membership.
2. Verify the player's winnings appear under **Unassigned**.
3. Verify Team A + Team B + Unassigned + still-in-play reconciles to the available skins.

## Release sequence

1. Install the changed-files package on `staging`.
2. Confirm GitHub Actions and Staging Vercel are green.
3. Complete the Staging acceptance checks above.
4. Only then merge `staging` into `main`.
