# Money — Group Expenses & Splitting (Build Plan)

Status: **proposed, awaiting final sign-off to build Phase 1.** No code written yet. First release: a MINOR version bump.
Revision 3 — sponsor is fixed on the guest; payer must be a member; owe-banner aggregates across groups.

## 1. Principles (non-negotiables)

- **BNN never moves money.** Ledger + hand-off only. Venmo/PayPal open pre-filled; the person confirms and sends in their own app. Keeps us out of PCI scope and money-transmitter status.
- **Integer cents everywhere.** No floats; format to USD only at display.
- **The ledger is the record of truth.** No success callback from Venmo/PayPal, so a debt clears only via an explicit "mark settled" (`settlements` row), never auto-detected.
- **Online-only for writes.** Add/edit expense and record settlement require a connection (scoring stays offline-capable). Avoids offline balance split-brain.
- **USD only** for v1.
- **Guests are sponsored, never independent.** A non-app player has **no balance of their own** and **must** have a **sponsor** — a member responsible for that guest's share, who reconciles with the guest offline. A guest's share always rolls up to the sponsor. A guest **cannot be a payer** (a payer must be a member who can receive money and settle). Only members owe, get paid, get nudged, or mark settled.

## 2. Data model (one idempotent migration: `0048_money.sql`)

Four new tables, group-scoped. Amounts `integer` cents, `>= 0`. Every statement `create table if not exists` / `add column if not exists`, printed in full for manual run in the Supabase SQL editor.

### `group_guests` — a non-app player, tied to a sponsoring member
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| group_id | uuid | fk groups |
| name | text | display name within the group |
| sponsor_user_id | uuid | **required** — the member responsible for this guest's money |
| created_by | uuid | |
| created_at | timestamptz | |

A non-app player must have a sponsor at creation. `sponsor_user_id` must be an active member of the group. No payment/phone fields — a guest never transacts through the app.

### `expenses`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| group_id | uuid | fk groups |
| created_by | uuid | member who logged it |
| payer_user_id | uuid | **required, member** — who paid / is owed |
| description | text | |
| category | text | `bet` \| `tee` \| `food` \| `other` |
| amount_cents | int | `> 0` |
| currency | text | default `'USD'` |
| split_type | text | `even` \| `custom` |
| created_at / updated_at | timestamptz | |

Payer is always a member (a guest can't be owed money through the app). If a guest actually fronted cash in real life, the sponsoring member logs it as themselves paying.

### `expense_shares` — one row per participant in the split
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| expense_id | uuid | fk expenses **on delete cascade** |
| user_id | uuid null | participant (member) |
| guest_id | uuid null | participant (guest); nets to the guest's sponsor |
| share_cents | int | `>= 0` |

`check`: exactly one of `user_id`, `guest_id`. `unique (expense_id, user_id, guest_id)`. Invariant (app + test): `sum(share_cents) == expenses.amount_cents`.

### `settlements` — a recorded payment between **members only**
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| group_id | uuid | fk groups |
| from_user_id | uuid | payer (member) |
| to_user_id | uuid | payee (member) |
| amount_cents | int | `> 0` |
| method | text null | `venmo` \| `paypal` \| `cash` \| `other` (informational) |
| created_by | uuid | |
| created_at | timestamptz | |

Guests never appear in settlements — their balance belongs to the sponsor, so the settlement is member-to-member. Settlements are party-to-party, not tied to a specific expense.

### `profiles` (existing) — add optional payment fields
`add column if not exists`: `venmo_handle text`, `paypal_handle text`, `phone text`. Nullable, self-entered, never verified, never mandatory. Members only.

### Indexes
`expenses(group_id)`, `expense_shares(expense_id)`, `settlements(group_id)`, `group_guests(group_id)`, `group_guests(sponsor_user_id)`.

## 3. RLS (mirrors existing `group_members` gating)

Membership predicate:
```
exists (select 1 from group_members gm
        where gm.group_id = <row>.group_id
          and gm.user_id = auth.uid()
          and gm.status = 'active')
```
- **select / insert:** any active member of the row's group.
- **update / delete on `expenses`:** `created_by = auth.uid()` OR an `admin`-role member of the group.
- **`settlements`:** insertable by an active member who is a party (`from_user_id`/`to_user_id` = auth.uid()) or a group admin; no update (delete + re-add to correct).
- **`group_guests`:** managed by any active member; `sponsor_user_id` must be an active member of the same group.
- `expense_shares` inherits access via its parent expense's group.

## 4. Core logic (pure TypeScript, unit-tested in the existing harness)

New module `lib/money.ts`:

- `resolveParty(participantRef, guestsById)` — a member share → that member; a **guest share → the guest's `sponsor_user_id`**. Guests collapse onto their sponsor before balance math. (Payers are already members, so only participants need resolving.)
- `evenShares(amount_cents, participants[])` — floor split, deterministic remainder (first `amount - floor*k` participants get +1 cent); reconciles exactly.
- `computeBalances(expenses, shares, settlements, guests)` → `Map<user_id, cents>`:
  - payer: `+amount_cents` to `payer_user_id`; each share: `-share_cents` from `resolveParty(participant)`; settlement: `from += amt`, `to -= amt`.
  - Members only; guests resolved to sponsors; nets sum to zero.
- `guestBreakdown(...)` — optional per-member detail ("incl. guest Sam $20").
- `simplify(balances)` → `{from, to, amt}[]` — greedy min-cash-flow over members.
- `payLink(...)`, `nudgeSms(...)` — builders.
- `aggregateOwed(groupsBalances, user_id)` — sum of the user's negative nets across all their groups, for the banner.

**Tests** (added to the current 83):
1. Balances sum to zero over members (fuzz).
2. Even split reconciles exactly incl. odd cents.
3. Custom split rejected unless shares sum to total.
4. `simplify` nets each member to zero, `<= n-1` transfers.
5. **Guest resolution:** a guest's share lands entirely on the sponsor; the guest never appears in the balance map or `simplify`; reassigning the sponsor moves the balance.

## 5. UI surfaces

- **New top-level "Money" tab** (standalone, not game-tied).
  - **Balances** (default): **members only**, each with net (owed/owes/settled), a Nudge button for anyone owing, optional "incl. guest <name> $X" sub-line. Expense list below.
  - **Add / Edit expense**: description, amount, category chips, **payer select (members only)**, participant checklist (members + guests, guests tagged "(guest of <sponsor>)"). Adding a guest prompts for a name **and a sponsor** (defaults to current user, editable to any member). Even/custom toggle with live preview; custom blocks submit until shares == total.
  - **Settle up**: simplified member-to-member transfers; Venmo/PayPal (when handle on file) + Mark paid; cash fallback.
- **Persistent owe-banner (aggregated across groups):** shows the member's total owed across **all** their groups — e.g. "You owe $140 to settle up across 2 groups" — until every group is squared; tapping opens Money. A member's owed amount in a group includes their own shares plus any sponsored-guest shares.
- **Profile editor** (`ProfilePanel`): optional Venmo / PayPal / phone, with a "test your own pay link" convenience.
- **Guest management:** the sponsor is fixed on the guest but editable (creator/admin) if the wrong person was assigned; reassigning moves that guest's amounts.

## 6. Pay hand-off & confirm-on-return

- Tap Venmo/PayPal → stash `pending` settlement → navigate to pre-filled deep link.
- On return (`visibilitychange` visible with `pending`) → one-tap "Did you pay <member> $X? ✓ Mark settled / Not yet." Yes writes a `settlements` row (online).
- Per-row **Mark paid** always present as the reliable fallback (visibility detection flaky on installed iOS PWAs).
- Amount pre-fill best-effort; amount shown + copied to clipboard as fallback.

## 7. Nudge-by-text

- "Nudge" opens the **sender's own** Messages via an `sms:` link with a pre-written body. From a person's phone → no provider, no A2P/10DLC, no TCPA burden. Members only; needs the target member's phone on file, else an "add a number" fallback.

## 8. Permissions

Any active member adds expenses and records their own settlement. Expense edit/delete, guest sponsor reassignment, and arbitrary settlement management: expense/guest creator or group admin.

## 9. Edge cases & decisions

- **Guest without a sponsor:** disallowed — sponsor required at creation.
- **Reassigning a sponsor:** moves that guest's attributed amounts to the new sponsor; balances recompute.
- **Delete after settle:** settlements are independent of expenses, so deleting an expense recomputes nets and may leave a prior payer net-positive; warn on delete, don't block.
- **Rounding:** deterministic remainder; tested.
- **Currency:** USD fixed; `currency` column present for later multi-currency.

## 10. Phasing

- **Phase 1 (this build):** migration 0048 + RLS, tested `lib/money.ts`, profile fields, Money tab (Balances / Add-Edit / Settle up) with even+custom splits and sponsored guests, auto-simplify, mark-paid, Venmo/PayPal pre-filled hand-off + confirm-on-return, nudge-by-text, aggregated owe-banner. Online-only writes.
- **Phase 2:** recipient-side "confirm receipt"; expense edit history; category spend summary.
- **Phase 3 (deferred, cost/consent noted):** automated web-push reminders; receipts/photos; multi-currency; possibly server-sent SMS.

## 11. Migrations & docs to keep in sync

- New `migrations/0048_money.sql` (idempotent; printed in full) — joins the outstanding list (0045, 0046, 0047, **0048**).
- Update `SCHEMA.md`, `DEPLOY_NOTES.md`, `BACKLOG.md`, `README.md` if user-facing.

## 12. What I can't verify here (needs on-device / Supabase testing)

RLS under real auth; Venmo/PayPal deep-link pre-fill on real iOS/Android; `sms:` body pre-fill; `visibilitychange` return detection on installed PWAs. The `lib/money.ts` math (balances, splits, simplify, sum-to-zero, guest→sponsor resolution, cross-group aggregate) is covered by unit tests.

---

## Decisions (locked)
- Guest sponsor is **fixed on the guest** (editable by creator/admin), required at creation.
- **Payer must be a member.** Guests are participants only.
- Owe-banner **aggregates across all of a member's groups**.

## Remaining (assumed unless you say otherwise)
- Category list = `bet / tee time / food & drink / other`. Say the word to add cart / caddie / lodging.
