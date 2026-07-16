# Money redesign spec — Buckets (nested settlement worlds) rolling up to the Club

Status: SHIPPED in 173.0.260716.
Supersedes the club-level-only model shipped in 172.0–172.1.

## 1. Vocabulary

- **Club** — the existing `group`. Owns the roster (members = payors) and a read-only rollup.
- **Bucket** — a self-contained money world inside a club (today's "event", `group_events` row).
  Has its own expenses, balances, totals, and its own settlement. Renamed from "Event" in all money copy. "Tab" is now free for the nav bar only.
  DB table stays `group_events` (no rename) to avoid churn; UI says "Bucket".
- **General** — the default Bucket. Auto-created once per club. Any expense/payment not assigned to a
  specific Bucket lands here. Never deletable; can be archived only if empty.
- Nav sections (Balances / Add / Settle / Activity) are the "tabs" in the nav bar. The money world is a "Bucket" — no collision.

## 2. The model (the part that must be airtight)

### 2.1 A Bucket is a closed system
Every expense belongs to exactly one Bucket. Every payment belongs to exactly one Bucket. Settlement is
scoped to a single Bucket: `allocateSettlement` is always called with that Bucket's id, so a payment can
only ever clear expenses **within its own Bucket**. No cross-Bucket FIFO, no chain-rerouting across Buckets,
no club-level "general/unattributed" bucket. This is the property that failed before and is now
structural: a Bucket's ledger and its settlement can't disagree because nothing outside the Bucket can
touch them.

### 2.2 "Settled" is net-square within the Bucket — NOT per-expense coverage
A Bucket shows the **fewest-payments** transfers to square *its* members (`simplify` over that Bucket's
balances, minus that Bucket's recorded payments). You mark each transfer paid. The Bucket is **settled
when no transfers remain** (every member net-zero within the Bucket).

We deliberately do NOT show a per-expense "$X of $Y settled" figure. That number is what created the
whole reconciliation mess: fewest-payments legitimately reroutes debts (A owes B, B owes C → A pays
C), and a rerouted payment can't map to a single expense. By defining "settled" as net-square rather
than expense-coverage, rerouting inside a Bucket is fine and never contradicts the settled state.
(`settlement_allocations` is retained only as an optional audit detail, not as the source of truth
for settled status.)

### 2.3 The Club is a scoreboard, not a payable
The Club rollup shows each member's **net across all Buckets** = sum of their per-Bucket positions, plus a
per-Bucket breakdown. It is **read-only**. You cannot settle at the Club level. The ONLY way to reduce a
club balance is to settle the underlying Buckets.

Honest consequence (accepted): a member can read **net $0 at the Club** while still having unpaid
debts inside individual Buckets that cancel across Buckets (owes $10 in Bucket A, owed $10 in Bucket B → two real
payments to make, one per Bucket). The Club number answers "where do I stand overall"; the Buckets answer
"what do I actually pay." You get event-level truth at the cost of a non-settleable club total — the
correct trade per the design.

## 3. Data model

- `expenses.event_id` — becomes effectively required; NULL is migrated to the club's General Bucket.
- `settlements.event_id` — becomes **required (NOT NULL)**. Every payment has a home Bucket.
- `allocateSettlement` — always called with a Bucket id (never null scope). No null-expense remainder
  line in normal operation (within-Bucket rerouting still allowed; see 2.2 — it doesn't affect settled).
- General Bucket — one per club, `event_type = 'general'` (new type) or a flag; created lazily on first
  money use and by the migration for existing clubs.
- No change to: `expense_shares`, `expense_payers`, guests/sponsors, the `record_settlement` RPC
  signature (it already takes an event_id; we stop passing null).

## 4. UI structure

### 4.1 Club level (rollup / scoreboard)
- Per member: single net number (owed / owes / settled), sorted by magnitude.
- Tap a member → breakdown by Bucket: e.g. `Amit — Stableford +$45 · E −$32 · F −$188.75 → net −$175.75`.
- The per-Bucket breakdown is shown even when the member's net is $0, and makes the direction explicit:
  "owe $X in Bucket Y, due $Z in Bucket K" — so a net-zero member still sees the real payments to make.
- No settle controls here. A line explains: "Settle inside each Bucket."

### 4.2 Bucket level (the nested Money function)
Each Bucket shows, self-contained:
- Totals + the expense list (with the raw per-member split as today).
- **Balances** within the Bucket.
- **Settle / reconcile**: fewest-payments transfers for this Bucket, each with Pay / Mark paid / Unmark,
  the resulting-balances impact modal (kept from 171.4).
- Settled state: "Settled" when no transfers remain; otherwise the list of transfers.
- Archive (no settlement gate — 172.0 decision (a) stands).

### 4.3 Activity (renamed from Log)
One running, club-wide, reverse-chronological feed of EVERY money transaction (full audit trail), each
line naming its Bucket, the actor, and the reader's own impact. Design principle: rank by money impact so
volume never buries signal.
- Add:    `Amit added "Golf cart" in F — you owe $21.67`
- Payment:`Jonny paid Amit $37.50 in Stableford`
- Edit:   `Amit edited "Golf cart" $65 → $70 in F — your share +$1.67`   (shows old → new + your delta)
- Void:   `Amit voided "Tip" in E — you no longer owe $10`
- Restore:`Amit restored "Tip" in E — you owe $10 again`
Rules:
- Every line ends with the READER's impact ("you owe $X" / "you're owed $X" / no badge if it doesn't
  touch you). Edits/voids/restores surface the balance delta, not just the verb. A change with zero
  balance impact (e.g. a name typo fix) renders with no impact badge.
- Grouped under day headers; reverse chronological.
- One lightweight filter, default OFF (= show everything): "All / Money-moving only".
- Read-only and immutable — the feed is the record; you never edit the record.
Covers add / edit / void / restore / mark-paid / unmark across all Buckets.

## 5. Data migration 0121 (existing clubs)

Deterministic backfill, printed inline for the SQL editor, safe/re-runnable:

1. **Create a General Bucket** for every club that lacks one.
2. **Re-home orphan expenses**: `expenses.event_id IS NULL` → the club's General Bucket.
3. **Re-home existing settlements** (today many are club-level, `event_id IS NULL`): use each
   settlement's `settlement_allocations` rows — every allocation points to an expense, and every
   expense has a Bucket — to split the settlement into per-Bucket child settlements that sum to the
   original amount, preserving each member's total paid/received.
   - Allocation portions with `expense_id IS NULL` (old cross-club rerouting remainder): assigned to
     the club's **General** Bucket. [DECISION NEEDED — see §7.]
4. **Set `settlements.event_id` NOT NULL** after backfill.
5. Record as `0121_money_tabs` in the ledger.

Backfill validation baked into the migration: assert per-member total paid/received is unchanged
club-wide, and that every settlement now has a non-null event_id.

## 6. Testing plan (before ship)

- Adapt `money-scenarios` to Bucket-scope: per-Bucket conservation (owes==gets within a Bucket), Bucket-settled
  ⟺ no transfers remain, and **Club net == sum of Bucket nets** for every member (new invariant).
- Keep the two fuzzers, re-scoped: WF (random add/settle/unmark/move/archive across multiple Buckets) and
  RT (per-Bucket settle offer == true remaining; paying squares the Bucket exactly).
- Freeze the App Testing dataset as a fixture and assert the 0121 backfill preserves every member's
  totals and leaves each Bucket correctly settled/unsettled.
- Full existing suite stays green; tsc + 5 guards + build.

## 7. Decisions — ALL RESOLVED (approved)

1. Null-expense remainders in migration 0121 → **General**. ✓
2. **`settled` = net-square within a Bucket**; the "$X of $Y settled" figure is dropped in favor of
   "Settled / N transfers left." ✓
3. Club net $0 with unpaid Buckets that cancel → **accepted**, AND the Club level must show the
   per-Bucket breakdown even at net-zero ("owe $X in Bucket Y, due $Z in Bucket K"). ✓ (folded into §4.1)
4. Activity feed → **everything** (add/edit/void/restore/pay/unmark), ranked by money impact, with a
   default-off "Money-moving only" filter. ✓ (folded into §4.3)

Spec APPROVED. Build against it with the §6 test battery, ship as **173.0**; 0121 is the only migration.
