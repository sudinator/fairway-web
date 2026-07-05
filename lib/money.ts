// lib/money.ts — pure logic for the group expense ledger (Money feature).
// No I/O, no React; fully unit-tested in lib/money.test.ts. Integer cents throughout.
//
// Key rule: a guest never holds a balance. Every share attributed to a guest resolves
// to that guest's sponsor (a member). Payers are always members. So all balances are
// member-to-member and always sum to zero.

export type Cents = number;

export interface Guest { id: string; sponsor_user_id: string; name?: string }
export interface Expense { id: string; payer_user_id: string; amount_cents: Cents }
export interface Payer { expense_id: string; user_id: string; paid_cents: Cents }
export interface Share { expense_id?: string; user_id?: string | null; guest_id?: string | null; share_cents: Cents }
export interface Settlement { from_user_id: string; to_user_id: string; amount_cents: Cents }
export interface Transfer { from: string; to: string; amt: Cents }

/** Split `total` cents across `n` participants; the first (total - floor*n) get +1 cent. */
export function evenShares(total: Cents, n: number): Cents[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const rem = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

/** True iff custom shares reconcile exactly to the expense total. */
export function validateCustomTotal(shares: Cents[], total: Cents): boolean {
  return shares.reduce((s, v) => s + v, 0) === total;
}

/** The member a share belongs to: the member directly, or a guest's sponsor. */
export function resolveMember(
  user_id: string | null | undefined,
  guest_id: string | null | undefined,
  guestsById: Record<string, Guest>,
): string | null {
  if (user_id) return user_id;
  if (guest_id) { const g = guestsById[guest_id]; return g ? g.sponsor_user_id : null; }
  return null;
}

/** Net balance per MEMBER (positive = owed money, negative = owes). Sums to zero.
 *  Payer side: use per-payer rows when present (multiple payers), else the single payer_user_id. */
export function computeBalances(
  expenses: Expense[], shares: Share[], settlements: Settlement[], guests: Guest[], payers: Payer[] = [],
): Record<string, Cents> {
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const payersByExp: Record<string, Payer[]> = {};
  for (const p of payers) (payersByExp[p.expense_id] || (payersByExp[p.expense_id] = [])).push(p);
  const bal: Record<string, Cents> = {};
  const add = (uid: string | null, amt: Cents) => { if (!uid) return; bal[uid] = (bal[uid] || 0) + amt; };
  for (const e of expenses) {
    const ps = payersByExp[e.id];
    if (ps && ps.length) ps.forEach((p) => add(p.user_id, p.paid_cents));
    else add(e.payer_user_id, e.amount_cents);
  }
  for (const s of shares) add(resolveMember(s.user_id, s.guest_id, gById), -s.share_cents);
  for (const st of settlements) { add(st.from_user_id, st.amount_cents); add(st.to_user_id, -st.amount_cents); }
  return bal;
}

/** How much of a sponsor's balance comes from a given guest's shares (for the "incl. guest" line). */
export function guestOwedFor(guest_id: string, shares: Share[]): Cents {
  return shares.filter((s) => s.guest_id === guest_id).reduce((s, v) => s + v.share_cents, 0);
}

/** Greedy minimum-cash-flow: fewest member-to-member transfers to square everyone. */
export function simplify(balances: Record<string, Cents>): Transfer[] {
  const deb: { id: string; v: Cents }[] = [];
  const cred: { id: string; v: Cents }[] = [];
  for (const id of Object.keys(balances)) {
    const v = balances[id];
    if (v < 0) deb.push({ id, v: -v });
    else if (v > 0) cred.push({ id, v });
  }
  const bySize = (a: { id: string; v: Cents }, b: { id: string; v: Cents }) => (b.v - a.v) || (a.id < b.id ? -1 : 1);
  deb.sort(bySize); cred.sort(bySize);
  const tx: Transfer[] = [];
  let i = 0, j = 0;
  while (i < deb.length && j < cred.length) {
    const amt = Math.min(deb[i].v, cred[j].v);
    if (amt > 0) tx.push({ from: deb[i].id, to: cred[j].id, amt });
    deb[i].v -= amt; cred[j].v -= amt;
    if (deb[i].v === 0) i++;
    if (cred[j].v === 0) j++;
  }
  return tx;
}

/** Total a member owes across all their groups (for the aggregated owe-banner). */
/** Proportionally allocate `amount` cents across `weights`, summing exactly to `amount`
 *  (largest-remainder). Falls back to an even split if all weights are zero. */
function allocateProportional(amount: Cents, weights: Cents[]): Cents[] {
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return evenShares(amount, weights.length);
  const raw = weights.map((w) => (amount * w) / total);
  const out = raw.map((r) => Math.floor(r));
  let rem = amount - out.reduce((s, v) => s + v, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => (b.f - a.f) || (a.i - b.i));
  for (let k = 0; k < rem; k++) out[order[k % order.length].i] += 1;
  return out;
}

/** Who-owes-whom "as entered": each participant owes the expense's payer(s) their share
 *  (allocated across multiple payers by how much each fronted). Reciprocal pairs are netted,
 *  and recorded settlements are subtracted. Unlike `simplify`, every transfer maps to a real
 *  shared expense between those two members. Result sums per member match `computeBalances`. */
export function pairwiseDebts(
  expenses: Expense[], shares: Share[], settlements: Settlement[], guests: Guest[], payers: Payer[] = [],
): Transfer[] {
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const payersByExp: Record<string, Payer[]> = {};
  for (const p of payers) (payersByExp[p.expense_id] || (payersByExp[p.expense_id] = [])).push(p);
  const sharesByExp: Record<string, Share[]> = {};
  for (const s of shares) if (s.expense_id) (sharesByExp[s.expense_id] || (sharesByExp[s.expense_id] = [])).push(s);

  const net: Record<string, Record<string, Cents>> = {};
  const owe = (from: string | null, to: string | null, amt: Cents) => {
    if (!from || !to || from === to || amt === 0) return;
    (net[from] || (net[from] = {}));
    net[from][to] = (net[from][to] || 0) + amt;
  };

  for (const e of expenses) {
    const parts = sharesByExp[e.id] || [];
    const ps = (payersByExp[e.id] && payersByExp[e.id].length)
      ? payersByExp[e.id]
      : [{ expense_id: e.id, user_id: e.payer_user_id, paid_cents: e.amount_cents }];
    const weights = ps.map((p) => p.paid_cents);
    for (const s of parts) {
      const debtor = resolveMember(s.user_id ?? null, s.guest_id ?? null, gById);
      if (!debtor) continue;
      const alloc = allocateProportional(s.share_cents, weights);
      ps.forEach((p, idx) => owe(debtor, p.user_id, alloc[idx]));
    }
  }
  for (const st of settlements) owe(st.from_user_id, st.to_user_id, -st.amount_cents);

  const out: Transfer[] = [];
  const done = new Set<string>();
  for (const a of Object.keys(net)) for (const b of Object.keys(net[a])) {
    const key = a < b ? a + "|" + b : b + "|" + a;
    if (done.has(key)) continue;
    done.add(key);
    const diff = (net[a]?.[b] || 0) - (net[b]?.[a] || 0);
    if (diff > 0) out.push({ from: a, to: b, amt: diff });
    else if (diff < 0) out.push({ from: b, to: a, amt: -diff });
  }
  out.sort((x, y) => (y.amt - x.amt) || (x.from < y.from ? -1 : 1));
  return out;
}

export function aggregateOwed(perGroupBalances: Record<string, Cents>[], user_id: string): Cents {
  let owed = 0;
  for (const b of perGroupBalances) { const v = b[user_id] || 0; if (v < 0) owed += -v; }
  return owed;
}

/** "$65" / "$65.50" / "-$1" — trims a trailing .00. */
export function fmtUSD(cents: Cents): string {
  const s = (Math.abs(cents) / 100).toFixed(2).replace(/\.00$/, "");
  return (cents < 0 ? "-$" : "$") + s;
}

/** Pre-filled pay hand-off link. Venmo carries amount + note; PayPal.me carries amount. */
export function payLink(kind: "venmo" | "paypal", handle: string, amount_cents: Cents, note: string): string {
  const amt = (amount_cents / 100).toFixed(2);
  if (kind === "venmo") {
    return `https://venmo.com/${encodeURIComponent(handle)}?txn=pay&amount=${amt}&note=${encodeURIComponent(note)}`;
  }
  return `https://paypal.me/${encodeURIComponent(handle)}/${amt}`;
}

/** sms: link opening the sender's own Messages with a pre-written nudge. */
export function nudgeSms(phone: string, name: string, oweCents: Cents, groupName: string, link: string): string {
  const body = `Hey ${name}, you're at ${fmtUSD(oweCents)} for ${groupName} \u2014 settle up: ${link}`;
  return `sms:${phone}?&body=${encodeURIComponent(body)}`;
}
