// lib/money.ts — pure logic for the group expense ledger (Money feature).
// No I/O, no React; fully unit-tested in lib/money.test.ts. Integer cents throughout.
//
// Key rule: a guest never holds a balance. Every share attributed to a guest resolves
// to that guest's sponsor (a member). Payers are always members. So all balances are
// member-to-member and always sum to zero.

export type Cents = number;

export interface Guest { id: string; sponsor_user_id: string | null; name?: string; archived?: boolean }
export interface Expense { id: string; payer_user_id: string; amount_cents: Cents }
export interface Payer { expense_id: string; user_id?: string | null; guest_id?: string | null; sponsor_user_id?: string | null; paid_cents: Cents }
export interface Share { expense_id?: string; user_id?: string | null; guest_id?: string | null; sponsor_user_id?: string | null; share_cents: Cents }
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

/** The member a share belongs to: the member directly, or the share's per-expense
 *  guest sponsor, or (for legacy shares with none) the guest's old fixed sponsor. */
export function resolveMember(
  user_id: string | null | undefined,
  guest_id: string | null | undefined,
  guestsById: Record<string, Guest>,
  shareSponsor?: string | null,
): string | null {
  if (user_id) return user_id;
  if (guest_id) {
    if (shareSponsor) return shareSponsor;               // per-expense sponsor (new)
    const g = guestsById[guest_id];                       // fallback for pre-migration shares
    return g ? (g.sponsor_user_id ?? null) : null;
  }
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
    if (ps && ps.length) ps.forEach((p) => add(resolveMember(p.user_id, p.guest_id, gById, p.sponsor_user_id), p.paid_cents));
    else add(e.payer_user_id, e.amount_cents);
  }
  for (const s of shares) add(resolveMember(s.user_id, s.guest_id, gById, s.sponsor_user_id), -s.share_cents);
  for (const st of settlements) { add(st.from_user_id, st.amount_cents); add(st.to_user_id, -st.amount_cents); }
  return bal;
}

/** How much of a sponsor's balance comes from a given guest's shares (for the "incl. guest" line). */
export function guestOwedFor(guest_id: string, shares: Share[]): Cents {
  return shares.filter((s) => s.guest_id === guest_id).reduce((s, v) => s + v.share_cents, 0);
}

/** Which guests each member is currently covering, and their net effect on that member's
 *  balance (a losing guest's share is negative; a winning guest's credit is positive),
 *  using the per-expense sponsor (falling back to the guest's old fixed sponsor for legacy
 *  shares). Returns memberId -> { guestId -> net cents }. Powers the Balances "incl. <guests>"
 *  line, where a guest can roll to different members across expenses and win or lose. */
export function guestCoverageBySponsor(
  shares: Share[], guestsById: Record<string, Guest>, payers: Payer[] = [],
): Record<string, Record<string, Cents>> {
  const out: Record<string, Record<string, Cents>> = {};
  const bump = (sponsor: string | null, guestId: string, cents: Cents) => {
    if (!sponsor) return;
    (out[sponsor] || (out[sponsor] = {}));
    out[sponsor][guestId] = (out[sponsor][guestId] || 0) + cents;
  };
  for (const s of shares) {
    if (!s.guest_id) continue;
    bump(s.sponsor_user_id || (guestsById[s.guest_id]?.sponsor_user_id ?? null), s.guest_id, -s.share_cents);
  }
  for (const p of payers) {
    if (!p.guest_id) continue;
    bump(p.sponsor_user_id || (guestsById[p.guest_id]?.sponsor_user_id ?? null), p.guest_id, p.paid_cents);
  }
  return out;
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
      const debtor = resolveMember(s.user_id ?? null, s.guest_id ?? null, gById, s.sponsor_user_id ?? null);
      if (!debtor) continue;
      const alloc = allocateProportional(s.share_cents, weights);
      ps.forEach((p, idx) => owe(debtor, resolveMember(p.user_id, p.guest_id, gById, p.sponsor_user_id), alloc[idx]));
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

// ---------------- Bet → Money posting ----------------
// Convert a settled bet (per-player net dollars, zero-sum) into a single expense:
// net winners become payers (credited their winnings), net losers become shares
// (owing their loss). Dollars are converted to cents and kept exactly zero-sum with
// largest-remainder rounding, so payers' paid_cents equals losers' share_cents.
export interface BetNet { user_id: string | null; guest_id?: string | null; sponsor_user_id?: string | null; name: string; net: number } // net in dollars (+win / -loss)
export interface BetPost {
  amount_cents: Cents;
  payers: { user_id: string | null; guest_id?: string | null; sponsor_user_id?: string | null; paid_cents: Cents }[]; // net winners
  shares: { user_id: string | null; guest_id?: string | null; sponsor_user_id?: string | null; share_cents: Cents }[]; // net losers
  ok: boolean;
  reason?: string;
}

// Round an array of signed dollar amounts (summing ~0) to cents, preserving the exact
// zero total: round each, then fix the residual on the largest-magnitude entries.
function roundZeroSumCents(netsDollars: number[]): number[] {
  const raw = netsDollars.map((d) => d * 100);
  const cents = raw.map((c) => Math.round(c));
  let residual = cents.reduce((s, c) => s + c, 0); // should be 0; correct drift
  if (residual !== 0) {
    // adjust on entries with the largest fractional loss/gain first
    const order = raw
      .map((c, i) => ({ i, frac: c - cents[i] }))
      .sort((a, b) => (residual > 0 ? a.frac - b.frac : b.frac - a.frac));
    let k = 0;
    const step = residual > 0 ? -1 : 1;
    while (residual !== 0 && order.length) {
      cents[order[k % order.length].i] += step;
      residual += step;
      k++;
    }
  }
  return cents;
}

export function betResultToPost(nets: BetNet[]): BetPost {
  if (nets.length < 2) return { amount_cents: 0, payers: [], shares: [], ok: false, reason: "Need at least 2 bettors." };
  const sum = nets.reduce((s, n) => s + n.net, 0);
  if (Math.abs(sum) > 0.5) return { amount_cents: 0, payers: [], shares: [], ok: false, reason: "Bet nets don't balance to zero." };
  const cents = roundZeroSumCents(nets.map((n) => n.net));
  const payers: BetPost["payers"] = [];
  const shares: BetPost["shares"] = [];
  nets.forEach((n, i) => {
    const c = cents[i];
    if (c > 0) payers.push({ user_id: n.user_id, guest_id: n.guest_id ?? null, sponsor_user_id: n.sponsor_user_id ?? null, paid_cents: c });
    else if (c < 0) shares.push({ user_id: n.user_id, guest_id: n.guest_id ?? null, sponsor_user_id: n.sponsor_user_id ?? null, share_cents: -c });
  });
  const amount_cents = payers.reduce((s, p) => s + p.paid_cents, 0);
  const shareTotal = shares.reduce((s, p) => s + p.share_cents, 0);
  const ok = amount_cents === shareTotal;
  return { amount_cents, payers, shares, ok, reason: ok ? undefined : "Rounding failed to balance." };
}

// ---------------------------------------------------------------------------
// Money audit trail (v1.165.0)
// ---------------------------------------------------------------------------
// The `money_audit` table gets one row per underlying table write (see migration
// 0111). Because the app writes an expense and its shares/payers in SEPARATE
// requests, a single logical create/edit produces a BURST of snapshot rows that
// arrive within a second or two from the same actor. collapseAuditBursts folds
// each burst into one clean VERSION: the action of the first row in the burst
// (created vs edited) with the snapshot of the LAST row (the settled final state
// once every child write has landed). A 'deleted' row always stands alone and is
// terminal. Pure + unit-tested; the UI renders whatever this returns.

export interface AuditRow {
  id: string;
  expense_id: string;
  actor_id: string | null;
  action: "created" | "edited" | "deleted";
  snapshot: AuditSnapshot | null;
  created_at: string; // ISO
}
export interface AuditSnapshot {
  expense_id?: string;
  group_id?: string;
  description?: string;
  category?: string;
  amount_cents?: Cents;
  currency?: string;
  split_type?: string;
  source_kind?: string | null;
  created_by?: string | null;
  created_by_name?: string | null;
  payers?: { user_id: string | null; name: string; paid_cents: Cents }[];
  shares?: { user_id: string | null; guest_id: string | null; name: string; is_guest?: boolean; share_cents: Cents }[];
}
export interface AuditVersion {
  action: "created" | "edited" | "deleted";
  actor_id: string | null;
  at: string;           // ISO of the first row in the burst
  snapshot: AuditSnapshot | null; // the settled (last) snapshot in the burst
}

/** Fold per-row audit snapshots into clean per-edit versions, chronological. */
export function collapseAuditBursts(rows: AuditRow[], windowMs = 8000): AuditVersion[] {
  const sorted = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: AuditVersion[] = [];
  let cur: { action: AuditRow["action"]; actor_id: string | null; at: string; snapshot: AuditSnapshot | null; lastMs: number } | null = null;
  const flush = () => { if (cur) { out.push({ action: cur.action, actor_id: cur.actor_id, at: cur.at, snapshot: cur.snapshot }); cur = null; } };
  for (const r of sorted) {
    const ms = Date.parse(r.created_at);
    const sameBurst =
      cur !== null &&
      r.action !== "deleted" &&           // a delete always starts fresh…
      cur.action !== "deleted" &&         // …and nothing merges into a delete
      r.actor_id === cur.actor_id &&
      ms - cur.lastMs <= windowMs;
    if (sameBurst && cur) {
      cur.snapshot = r.snapshot ?? cur.snapshot; // keep the latest non-null snapshot
      cur.lastMs = ms;
    } else {
      flush();
      cur = { action: r.action, actor_id: r.actor_id, at: r.created_at, snapshot: r.snapshot, lastMs: ms };
    }
  }
  flush();
  return out;
}

/** Group collapsed versions by expense_id (each list chronological). */
export function auditVersionsByExpense(rows: AuditRow[], windowMs = 8000): Record<string, AuditVersion[]> {
  const byExp: Record<string, AuditRow[]> = {};
  for (const r of rows) (byExp[r.expense_id] || (byExp[r.expense_id] = [])).push(r);
  const out: Record<string, AuditVersion[]> = {};
  for (const eid of Object.keys(byExp)) out[eid] = collapseAuditBursts(byExp[eid], windowMs);
  return out;
}

// ---------------------------------------------------------------------------
// Events (v166) — group expenses into event "islands" (migration 0112)
// ---------------------------------------------------------------------------
// Events are a reporting lens: each island shows its own spent/share/net per
// person so a group can see "all Ireland expenses are settled." Settlement itself
// stays GROUP-WIDE (computeBalances/simplify are unchanged) — nobody settles
// inside an event. These helpers are pure and drive only the island display.

export interface EventRow {
  id: string;
  group_id: string;
  name: string;
  event_date?: string | null;
  event_type: "manual" | "game";
  source_game_id?: string | null;
  status: "open" | "closed";
  closed_by?: string | null;
  closed_at?: string | null;
  created_by?: string | null;
  created_at?: string | null;
}
export interface EventExpense { id: string; event_id?: string | null; }
export interface EventPersonNet { member_id: string; paid: Cents; share: Cents; net: Cents } // net = paid - share

/** Per-member spent/share/net for ONE event's expenses. Guests resolve to sponsor,
 *  exactly like computeBalances, so an event's nets sum to zero when it balances. */
export function eventNet(
  eventId: string,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], guests: Guest[], payers: Payer[] = [],
): { total: Cents; perMember: EventPersonNet[]; balanced: boolean } {
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const inEvent = new Set(expenses.filter((e) => (e.event_id ?? null) === eventId).map((e) => e.id));
  const payersByExp: Record<string, Payer[]> = {};
  for (const p of payers) if (inEvent.has(p.expense_id)) (payersByExp[p.expense_id] || (payersByExp[p.expense_id] = [])).push(p);
  const paid: Record<string, Cents> = {};
  const share: Record<string, Cents> = {};
  let total = 0;
  const addPaid = (uid: string | null, amt: Cents) => { if (uid) paid[uid] = (paid[uid] || 0) + amt; };
  const addShare = (uid: string | null, amt: Cents) => { if (uid) share[uid] = (share[uid] || 0) + amt; };
  for (const e of expenses) {
    if (!inEvent.has(e.id)) continue;
    total += e.amount_cents;
    const ps = payersByExp[e.id];
    if (ps && ps.length) ps.forEach((p) => addPaid(resolveMember(p.user_id, p.guest_id, gById, p.sponsor_user_id), p.paid_cents));
    else addPaid(e.payer_user_id, e.amount_cents);
  }
  for (const s of shares) {
    if (!s.expense_id || !inEvent.has(s.expense_id)) continue;
    addShare(resolveMember(s.user_id, s.guest_id, gById, s.sponsor_user_id), s.share_cents);
  }
  const ids = Array.from(new Set([...Object.keys(paid), ...Object.keys(share)]));
  const perMember = ids.map((member_id) => ({
    member_id, paid: paid[member_id] || 0, share: share[member_id] || 0,
    net: (paid[member_id] || 0) - (share[member_id] || 0),
  }));
  const balanced = perMember.reduce((s, m) => s + m.net, 0) === 0;
  return { total, perMember, balanced };
}

/** Bucket expenses by event id; event-less expenses go under the "" (Ungrouped) key. */
export function expensesByEvent<T extends EventExpense>(expenses: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const e of expenses) { const k = e.event_id ?? ""; (out[k] || (out[k] = [])).push(e); }
  return out;
}
