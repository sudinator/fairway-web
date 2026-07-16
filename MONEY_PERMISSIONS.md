# Money module — permission & lifecycle matrix (reference of record)

Every write path in the Money module, the intended actor (permission model) and lifecycle rule
(open/closed event, pending/confirmed payment), and where each is enforced. Keep this in sync when
changing Money. The pure math is covered by the lib/money.test.ts fuzzer; THIS covers who-can-do-what,
which a fuzzer can't.

Legend: UI = client gate · RLS = row-level security policy · TRG = trigger · RPC = function check.

| Action | Actor allowed | Lifecycle rule | Enforced by |
|---|---|---|---|
| Create event | any active member | — | RLS insert (self+member) |
| Close / reopen event | admin/owner | — | RPC admin check + TRG (status only via RPC) + UI |
| Add expense | any active member | not into closed event | RLS insert + TRG freeze |
| Edit expense | creator or admin | open events only | UI canEdit + RLS update + TRG freeze (save halts on freeze) |
| Void expense | creator or admin | open events only | UI canDelete + RLS delete + TRG freeze |
| Move expense between events | creator or admin | neither end closed | RPC (creator/admin, closed check) + TRG freeze |
| Write shares/payers | expense creator or admin | (parent expense freeze) | RLS write-lock (0111) |
| Arm settle (pending) | payer or admin | not into closed event | RLS insert (party/admin) + TRG (0115) |
| Confirm pending -> confirmed | payer OR payee OR admin | UPDATE allowed even if closed | RLS update (0116) + client error-check |
| Mark paid / received | payer OR payee OR admin | not into closed event | UI (both parties) + RLS insert (party/admin) + TRG (0115) |
| Unmark (delete) payment | creator or admin | not in closed event | UI hides on closed + RLS delete + TRG (0115) |
| Add guest | any active member | — | RLS insert (0116) |
| Retire / un-retire guest | guest creator or admin | — | UI gate + RLS update (0116) |
| Delete guest | guest creator or admin | — | RLS delete (0116) |
| Toggle simplify | admin/owner | — | UI canToggle + groups RLS |
| Read pay roster (handles) | active member of group | — | RPC is_group_member check (0052) |
| Bet posts a game event | game player or admin | posts to a FRESH event if prior is closed | RPC ensure_game_event (0116) |

## Notes / decisions
- Both parties may clear a line ("Mark paid" by payer, "Mark received" by payee) — two chances to settle.
  Backed by the settlements INSERT policy (party or admin) and the new UPDATE policy (0116).
- A guest's sponsor can vary per expense; retire permission keys off group_guests.created_by, NOT sponsor.
- Closed = sealed for BOTH expenses (0112) and payments (0115): reopen the event to change either.
- group_pay_roster is READ-ONLY (returns handles) and membership-checked — not a bulk mutation.
