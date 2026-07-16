# Money ledger redesign — record settlements at the expense level (DESIGN, for approval)

## Problem
Charges are atomic (`expense_shares` = who owes what toward each expense). Payments (`settlements`) are
coarse (from→to $Z, event tag only) and **not linked to expenses**. So moving an expense moves its charges
but not the payment that cleared it — the per-event ledger can misreport. `global-square` compensates on
read but doesn't fix the data. Fix: attach each payment to the obligations it clears.

## Today's model
- `expenses` — the charge header (payer, total, event, …).
- `expense_shares` — per-expense obligations (user/guest owes `share_cents`). ATOMIC. ✔
- `expense_payers` — multi-payer split of who fronted. ATOMIC. ✔
- `settlements` — payment `from→to $Z` (+ `event_id`, `status`, `dedup_key`). COARSE — no expense link. ✘
- Balances/events/simplify are computed on read by netting the above.

## Target model
- `settlements` stays = the PAYMENT HEADER (one real-world payment: from→to $Z, event, status, method).
- NEW `settlement_allocations` (the ledger lines):
  - `id`, `settlement_id → settlements(id) on delete cascade`
  - `expense_id → expenses(id) on delete cascade`
  - `amount_cents integer > 0`
  - index on `settlement_id`, on `expense_id`
- Invariant: for each settlement, `sum(allocations.amount_cents) == settlements.amount_cents`.
- Views (balances, eventNet, eventSettlement, withinEventDebts, personLedger, simplify) roll up from the
  atomic layer. `global-square` becomes unnecessary once coverage is expense-attributable, but stays as a
  harmless safety net until we've proven the new reads.

## Allocation rule (at settle time)
When user F settles event E (paying payee T the netted amount):
1. Gather F's still-owed obligations to T within E: expense_shares where sharer resolves to F and the
   expense is fronted by T (via payers), in event E, not yet covered.
2. Order by expense `created_at` ASC (**FIFO — oldest first**).
3. Walk the list, allocating the payment to each expense until the payment is exhausted.
- No partial payments in the UI now → the payment equals the full within-event F→T debt, so every one of
  F's owed obligations to T in E is fully allocated. (Model already supports partials: if/when we add a
  partial amount field, FIFO stops mid-list and we surface "older debts settled first.")

## Reads that change (all in lib/money.ts, fuzzer-covered)
- `computeBalances`, `eventNet`, `withinEventDebts`, `personLedger`, `simplify`, `eventSettlement`:
  credit side rolls up from `settlement_allocations` (by expense → event/pair) instead of raw settlements.
- Net effect on any person's OVERALL balance: **identical** to today (a payment still nets the same total);
  only the per-event/per-expense attribution becomes exact.

## Writes that change (components/money.tsx)
- `recordSettlement` / `armSettle`: create the settlement header, then compute + insert allocation lines
  (FIFO). Wrap in a single RPC so header+lines are one atomic transaction (no partial writes).
- Move expense between events: allocations ride along automatically (they key off `expense_id`), so both
  sides move together — the case that started this. The move guard/freeze rules are unchanged.
- Unmark: delete header → allocations cascade. Closed-event freeze (0115) unchanged.
- `dedup_key` (0117) unchanged — still one confirmation per line.

## Backfill (one-time, in the migration)
For every existing settlement, synthesize allocation lines by applying the SAME FIFO rule against the
expenses that were open between that pair in that settlement's event (or, for untagged/global settlements,
across that pair's expenses group-wide, oldest first). Little historical data exists, which keeps this low
risk. **Reconciliation gate:** compute every member's overall balance BEFORE and AFTER the backfill and
assert they are identical for every person; abort/rollback if any differ. We prove no one's number moves.

## Testing
- Extend the fuzzer: (a) allocations always sum to their settlement; (b) balances derived the new way equal
  balances derived the old way on random ledgers (equivalence proof); (c) moving an expense preserves every
  balance and moves its coverage; (d) backfill reconciliation on generated history.
- Keep all existing invariants (conservation, personLedger reconciliation, per-event nets, etc.).

## Rollout
1. Migration: create table + indexes + RLS (mirror settlements: party/admin; allocations inherit the
   settlement's group), backfill with reconciliation, `record_migration`.
2. App: settle paths write header+allocations via one RPC; reads roll up from allocations.
3. Ship behind the same pipeline (tsc, fuzzer, guards). No UI change for users except correctness.

## Open decisions for sign-off
1. Model = settlement header + `settlement_allocations` lines (recommended). OK?
2. Allocation = FIFO within the chosen event (your call). Confirmed.
3. Partials: build the model to support them but DO NOT surface partial-amount UI yet (recommended). OK?
4. Backfill rule for old/untagged settlements = same FIFO, with a hard before/after balance reconciliation
   gate. OK?
