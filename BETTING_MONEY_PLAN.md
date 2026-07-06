# TGC Betting → Money integration

Tie the winnings from TGC bets into the Money tab, via a confirmatory step. TGC group only to start; open to other groups later by removing one gate.

## Data flow

1. `computeBetting()` already returns a per-player `net` (winnings minus ante), zero-sum across the group, including tie and clean-sweep doubling.
2. Organizer ends + locks the game (`game.status === "ended"`). Only then can winnings be posted (amounts are final).
3. Organizer/admin taps "Post winnings to Money" in the Betting panel (TGC only).
4. A **confirm screen** lists every player with their net (+/-), the pot total, and a clean-sweep note, with a live zero-sum check. Confirm-only (no editing in phase 1).
5. On confirm, write ONE expense to the Money tab that reproduces the exact nets.

## Money-model mapping (no new primitive)

Post a single `expenses` row per bet, so it flows through the existing balances / Settle / nudge / pay-link machinery unchanged:

- `amount_cents` = total won (= total lost).
- `expense_payers`: one row per net **winner**, `paid_cents` = their winnings.
- `expense_shares`: one row per net **loser**, `share_cents` = their loss. Winners owe 0.
- `description` = "TGC bet — {game name}", dedicated category/label so it's recognizable.

`computeBalances` then yields each player's balance = their bet net. Losers see "You owe $X" and settle normally; the home owe-banner picks it up automatically.

## Schema change (idempotency + reversal)

Add to `expenses` (both nullable):
- `source_game_id uuid` — the game whose bet produced this expense.
- `source_kind text` — 'tgc_bet'.

Enables: "Posted ✓" state on the button, one-tap un-post (delete the linked expense), and stale-post detection after score edits. Migration = two `alter table add column` (printed inline).

## Bettors must be group members

Every bettor must be a member of the TGC money group. If any bettor is not a member, **block** the post with a message naming who's missing (posting a partial set would break zero-sum).

## Score edits after posting

Only a change in **Stableford points** can change winnings. Editing round stats (putts, fairways, sand, penalties) without changing the gross score does NOT change points → moot, no trigger.

- When a score edit on a posted TGC game recomputes the bet nets and they **differ** from the posted snapshot:
  - The person editing gets a **warning at edit time**: "This will change the bet winnings." Only shown if the winnings actually change; if the edit leaves nets identical, no warning.
  - The **organizer/admin is notified** (group activity + a flag on the game).
  - Re-settlement is **delete-old-expense + post-new**, and requires **organizer/admin approval** — it does not happen automatically.
- A posted bet whose game later changed shows a "needs update" state until an admin approves the re-post.

## Permissions & gating

- Post / un-post / approve re-post: organizer (creator) or group admin only.
- Entire flow hard-gated to `TGC_GROUP_ID` in phase 1 (same pattern as the Clean Sweep banner). Opening to other groups later = remove the gate + confirm each group's bet settings.

## Rounding

Bet nets are whole-dollar; convert to cents and keep the set zero-sum with largest-remainder allocation so payers' paid_cents and losers' share_cents reconcile exactly.

## Manual adjustments — deferred

Confirm-only in phase 1. Rare bespoke cases (a player sat out the bet, an informal press, forgiving a debt, comping a guest) are cleaner as a separate manual Money entry than an override in the bet post. Add editable amounts only if these recur.

## Phasing

**Phase 1 (TGC):**
- "Post winnings to Money" button in Betting panel, ended+locked games only, admin/creator only.
- Confirm screen (review + zero-sum check).
- Write single linked expense (payers = winners, shares = losers).
- Migration: `source_game_id`, `source_kind`.
- "Posted ✓" state + un-post.

**Phase 2 (TGC):**
- Score-edit detection: recompute nets, compare to posted snapshot.
- Editor warning when their edit changes winnings.
- Organizer/admin notification + approve re-post (delete old + post new).

**Phase 3:** open to other groups (remove `TGC_GROUP_ID` gate; per-group bet settings).

## Open confirmations before build

- Category label for posted bets: reuse an existing category with a "TGC bet — …" description, or add a dedicated "Winnings/Bet" category? (Leaning: description prefix + reuse existing category, minimal.)
- Un-post: allowed anytime by admin/creator, or only before anyone has settled against it? (Leaning: allowed anytime; if partly settled, warn.)
