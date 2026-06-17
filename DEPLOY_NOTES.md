# Deploy notes — v1.0.32 (cumulative — full app, supersedes all prior)

## Database
No new migration. If not already run: 0002–0008.

## Changes
1. Stableford is now individual-only: no Group card / marker. The Results vs
   Group card toggle, the group card, and the auto-switch are all hidden for
   stableford games, and each player's own score-entry card always shows. (Match,
   four-ball, and skins keep group scoring.)
2. Guest players are now easy to find: in a match or four-ball game, the
   organizer opens the **Setup** tab and sees a "Guest players" section with
   "+ Add guest player" (name + course handicap) — it no longer hides behind the
   "Add / edit" matchups toggle.

## Where to add a guest (match / four-ball)
Open the game → **Setup** tab (organizer only) → "Guest players" →
"+ Add guest player". The guest then appears in the pairing/foursome dropdowns
and on the Group card for scoring.
