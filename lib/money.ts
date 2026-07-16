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
  is_general?: boolean;
}
export interface EventExpense { id: string; event_id?: string | null; }
export interface EventPersonNet { member_id: string; paid: Cents; share: Cents; net: Cents } // net = paid - share

/** Per-member spent/share/net for ONE event's expenses. Guests resolve to sponsor,
 *  exactly like computeBalances, so an event's nets sum to zero when it balances. */
export function eventNet(
  eventId: string | null,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], guests: Guest[], payers: Payer[] = [],
): { total: Cents; perMember: EventPersonNet[]; owedWithin: Cents } {
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
  // Amount that someone fronted for others WITHIN this event (= sum of the positive nets). This is NOT a
  // payment/settled signal — settlements are group-wide and not tagged to an event, so an event can't know
  // if it's been paid. owedWithin just says "is anyone carrying anyone else here." 0 = everyone paid their
  // own share; >0 = there is fronting. Note the old `balanced` (nets sum to 0) was always true by identity.
  const owedWithin = perMember.reduce((s, m) => s + (m.net > 0 ? m.net : 0), 0);
  return { total, perMember, owedWithin };
}

/** Bucket expenses by event id; event-less expenses go under the "" (Ungrouped) key. */
export function expensesByEvent<T extends EventExpense>(expenses: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const e of expenses) { const k = e.event_id ?? ""; (out[k] || (out[k] = [])).push(e); }
  return out;
}

// ---------------------------------------------------------------------------
// Per-person balance breakdown (v166.5) — the "how did I get to this number" view
// ---------------------------------------------------------------------------
// Plain-language line items that build ONE member's global balance. This is the RAW
// obligation ledger (each expense share you owe, each amount you paid, each recorded
// settlement) — deliberately NOT the simplified who-pays-whom. Sum of line.delta
// equals computeBalances()[memberId] exactly (mirrors its sign conventions).

export interface LedgerLine {
  kind: "owe" | "paid" | "settle_out" | "settle_in";
  label: string;
  eventId: string | null;
  delta: Cents; // signed: + increases net (you're owed), - decreases (you owe)
}

export function personLedger(
  memberId: string,
  expenses: (Expense & { event_id?: string | null; description?: string })[],
  shares: Share[], settlements: (Settlement & { id?: string; event_id?: string | null })[], guests: Guest[], payers: Payer[] = [],
  nameOf: (userId: string | null) => string = (u) => u || "someone",
  allocations: { settlement_id: string; expense_id: string | null; amount_cents: Cents }[] = [],
  eventName: (eventId: string | null) => string = () => "",
): { lines: LedgerLine[]; total: Cents } {
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const gName: Record<string, string> = {};
  for (const g of guests) gName[g.id] = (g as any).name || "guest";
  const expById: Record<string, any> = {};
  for (const e of expenses) expById[e.id] = e;
  const desc = (eid: string) => (expById[eid]?.description || "expense");
  const evOf = (eid: string) => (expById[eid]?.event_id ?? null);
  const lines: LedgerLine[] = [];

  // amounts this member paid (via payers rows, else sole payer)
  const payersByExp: Record<string, Payer[]> = {};
  for (const p of payers) (payersByExp[p.expense_id] || (payersByExp[p.expense_id] = [])).push(p);
  for (const e of expenses) {
    const ps = payersByExp[e.id];
    if (ps && ps.length) {
      for (const p of ps) {
        if (resolveMember(p.user_id, p.guest_id, gById, p.sponsor_user_id) === memberId && p.paid_cents)
          lines.push({ kind: "paid", label: `You paid ${fmtUSD(p.paid_cents)} for “${desc(e.id)}”`, eventId: evOf(e.id), delta: p.paid_cents });
      }
    } else if (e.payer_user_id === memberId && e.amount_cents) {
      lines.push({ kind: "paid", label: `You paid ${fmtUSD(e.amount_cents)} for “${desc(e.id)}”`, eventId: evOf(e.id), delta: e.amount_cents });
    }
  }
  // shares this member owes (own + sponsored guests)
  for (const s of shares) {
    if (!s.expense_id) continue;
    if (resolveMember(s.user_id, s.guest_id, gById, s.sponsor_user_id) !== memberId || !s.share_cents) continue;
    const isGuest = !s.user_id && s.guest_id;
    const label = isGuest
      ? `You owe ${fmtUSD(s.share_cents)} — ${gName[s.guest_id as string] || "guest"}’s share of “${desc(s.expense_id)}”`
      : `You owe ${fmtUSD(s.share_cents)} — your share of “${desc(s.expense_id)}”`;
    lines.push({ kind: "owe", label, eventId: evOf(s.expense_id), delta: -s.share_cents });
  }
  // settlements — attributed to the event(s) they cleared (via allocations, else the payment's event tag)
  for (const st of settlements) {
    const als = allocations.filter((a) => a.settlement_id === st.id);
    const evIds = Array.from(new Set(als.map((a) => (a.expense_id ? evOf(a.expense_id) : (st.event_id ?? null))).filter(Boolean))) as string[];
    const names = (evIds.length ? evIds.map((e) => eventName(e)) : (st.event_id ? [eventName(st.event_id)] : [])).filter(Boolean);
    const evLabel = names.length ? ` · ${names.join(", ")}` : "";
    if (st.from_user_id === memberId) lines.push({ kind: "settle_out", label: `You paid ${fmtUSD(st.amount_cents)} to ${nameOf(st.to_user_id)}${evLabel}`, eventId: st.event_id ?? null, delta: st.amount_cents });
    if (st.to_user_id === memberId) lines.push({ kind: "settle_in", label: `${nameOf(st.from_user_id)} paid you ${fmtUSD(st.amount_cents)}${evLabel}`, eventId: st.event_id ?? null, delta: -st.amount_cents });
  }
  const total = lines.reduce((s, l) => s + l.delta, 0);
  return { lines, total };
}

// ---------------------------------------------------------------------------
// Per-event settlement (v167.2) — event-attributable, all-or-nothing
// ---------------------------------------------------------------------------
// Settlements now carry an event_id (null = the Ungrouped bucket). A person is
// "settled" for an event when their CONFIRMED, event-tagged payments cover their
// within-event owed amount. An event is settled when every owing participant is.
// No cross-event ordering (FIFO is gone): each event's coverage is its own, so a
// disputed/old event never blocks settling a newer one. Editing an expense changes
// the within-event owed, which naturally re-opens the event if coverage now falls
// short — no destructive deletion needed (this is Amit's option (a), computed).
// Only CONFIRMED settlements count; pending (armed-but-unconfirmed) ones are ignored
// here and by computeBalances — they only drive the "confirm your payment" nudge.

export interface EventSettleState {
  eventId: string | null;  // null = Ungrouped
  owed: Cents;             // total within-event owed across owing participants (current)
  covered: Cents;          // confirmed event-tagged coverage applied to that owed
  settled: boolean;        // every owing participant fully covered
  date: number;            // sort key
}

/** What `memberId` owes WITHIN one event, split across that event's fronters
 *  (proportional to their positive net; largest-remainder for exact cents). */
// Like withinEventDebts, but on the REMAINING positions after payments (via eventStandings) — so a
// re-settle only asks for what's still owed, not the raw share. Used by the settle action so a member who
// already paid (even via a parent-level/global payment whose coverage landed on this event) isn't asked
// to pay again.
export function withinEventDebtsRemaining(
  eventId: string | null, memberId: string,
  expenses: (Expense & { event_id?: string | null })[], shares: Share[], guests: Guest[], payers: Payer[],
  settlements: (Settlement & { id?: string; event_id?: string | null; status?: string })[],
  allocations: { settlement_id: string; expense_id: string | null; amount_cents: Cents }[] = [],
): { to: string; amount: Cents }[] {
  const stand = eventStandings(eventId, expenses, shares, guests, payers, settlements, allocations);
  const mine = stand.find((s) => s.member_id === memberId);
  if (!mine || mine.owes <= 0) return [];
  const owed = mine.owes;
  const creditors = stand.filter((s) => s.gets > 0).map((s) => ({ to: s.member_id, net: s.gets })).sort((a, b) => b.net - a.net);
  const totalPos = creditors.reduce((s, c) => s + c.net, 0);
  if (totalPos <= 0) return [];
  const raw = creditors.map((c) => ({ to: c.to, exact: (owed * c.net) / totalPos }));
  const out = raw.map((r) => ({ to: r.to, amount: Math.floor(r.exact) }));
  let rem = owed - out.reduce((s, r) => s + r.amount, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i].amount += 1; rem -= 1; }
  return out.filter((r) => r.amount > 0);
}

export function withinEventDebts(
  eventId: string | null, memberId: string,
  expenses: (Expense & { event_id?: string | null })[], shares: Share[], guests: Guest[], payers: Payer[] = [],
): { to: string; amount: Cents }[] {
  const { perMember } = eventNet(eventId as any, expenses as any, shares, guests, payers);
  const mine = perMember.find((m) => m.member_id === memberId);
  if (!mine || mine.net >= 0) return [];
  const owed = -mine.net;
  const creditors = perMember.filter((m) => m.net > 0).sort((a, b) => b.net - a.net);
  const totalPos = creditors.reduce((s, c) => s + c.net, 0);
  if (totalPos <= 0) return [];
  const raw = creditors.map((c) => ({ to: c.member_id, exact: (owed * c.net) / totalPos }));
  const out = raw.map((r) => ({ to: r.to, amount: Math.floor(r.exact) }));
  let rem = owed - out.reduce((s, r) => s + r.amount, 0);
  const order = raw.map((r, i) => ({ i, frac: r.exact - Math.floor(r.exact) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < order.length && rem > 0; k++) { out[order[k].i].amount += 1; rem -= 1; }
  return out.filter((r) => r.amount > 0);
}

/** Per-bucket settled state from CONFIRMED, event-tagged settlements. */
// Per-member standing within an event AFTER payments — what each person still owes / is still owed,
// with confirmed allocations (expense-in-event, or a general remainder on a settlement tagged to this
// event) subtracted. Drives the event summary line so a member who has settled stops showing as owing.
export function eventStandings(
  eventId: string | null,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], guests: Guest[], payers: Payer[],
  settlements: (Settlement & { id?: string; event_id?: string | null; status?: string })[],
  allocations: { settlement_id: string; expense_id: string | null; amount_cents: Cents }[] = [],
): { member_id: string; owes: Cents; gets: Cents }[] {
  const { perMember } = eventNet(eventId as any, expenses, shares, guests, payers);
  const conf = new Set(settlements.filter((s) => (s.status || "confirmed") === "confirmed").map((s) => s.id).filter(Boolean));
  const sFrom: Record<string, string> = {}, sTo: Record<string, string> = {}, sEv: Record<string, string> = {};
  for (const s of settlements) if (s.id) { sFrom[s.id] = s.from_user_id; sTo[s.id] = s.to_user_id; sEv[s.id] = s.event_id ?? ""; }
  const inEvent = new Set(expenses.filter((e) => (e.event_id ?? null) === eventId).map((e) => e.id));
  const bk = eventId ?? "";
  // Signed remaining position per member: start from the event net, then apply payments attributed to this
  // event (payer's debt shrinks, payee's credit shrinks). Because every applied payment moves one member up
  // and the other down by the same amount, the remaining positions always sum to zero → owes == gets.
  const rem: Record<string, number> = {};
  for (const m of perMember) rem[m.member_id] = m.net;
  for (const a of allocations) {
    if (!conf.has(a.settlement_id)) continue;
    const belongs = a.expense_id ? inEvent.has(a.expense_id) : (sEv[a.settlement_id] === bk);
    if (!belongs) continue;
    const f = sFrom[a.settlement_id], t = sTo[a.settlement_id];
    if (f) rem[f] = (rem[f] || 0) + a.amount_cents;
    if (t) rem[t] = (rem[t] || 0) - a.amount_cents;
  }
  const out: { member_id: string; owes: Cents; gets: Cents }[] = [];
  for (const member_id of Object.keys(rem)) {
    const r = rem[member_id];
    if (r < 0) out.push({ member_id, owes: -r, gets: 0 });
    else if (r > 0) out.push({ member_id, owes: 0, gets: r });
  }
  return out;
}

// Split a payment (from -> to, `amount` cents) across the specific expenses it clears, FIFO by expense
// created_at. Scope = a single event (eventId) or all of the pair's obligations (eventId null, e.g. a
// global "Settle up" transfer). Each expense gets the portion `from` owes `to` for it (from's share ×
// to's paid fraction). Any amount that can't be mapped to an expense — e.g. a debt rerouted by debt
// simplification, where `from` doesn't directly owe `to` — lands in a single general (null-expense) line.
// The returned lines ALWAYS sum to `amount`, so record_settlement's invariant holds.
export function allocateSettlement(
  from: string, to: string, eventId: string | null, amount: Cents,
  expenses: (Expense & { event_id?: string | null; created_at?: string })[],
  shares: Share[], guests: Guest[], payers: Payer[] = [],
): { expense_id: string | null; amount_cents: Cents }[] {
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const scope = expenses.filter((e) => (eventId == null ? true : (e.event_id ?? null) === eventId));
  const cand: { id: string; amt: Cents; at: string }[] = [];
  for (const e of scope) {
    const total = e.amount_cents; if (total <= 0) continue;
    const ps = payers.filter((p) => p.expense_id === e.id);
    let toPaid = 0;
    if (ps.length) ps.forEach((p) => { if (resolveMember(p.user_id, p.guest_id, gById, p.sponsor_user_id) === to) toPaid += p.paid_cents; });
    else if (e.payer_user_id === to) toPaid = total;
    if (toPaid <= 0) continue;
    let fromShare = 0;
    for (const s of shares) if (s.expense_id === e.id && resolveMember(s.user_id, s.guest_id, gById, s.sponsor_user_id) === from) fromShare += s.share_cents;
    if (fromShare <= 0) continue;
    const attributable = Math.round((fromShare * toPaid) / total);
    if (attributable > 0) cand.push({ id: e.id, amt: attributable, at: e.created_at || "" });
  }
  cand.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)); // FIFO — oldest first
  const out: { expense_id: string | null; amount_cents: Cents }[] = [];
  let remaining = amount;
  for (const c of cand) {
    if (remaining <= 0) break;
    const take = Math.min(c.amt, remaining);
    if (take > 0) { out.push({ expense_id: c.id, amount_cents: take }); remaining -= take; }
  }
  if (remaining > 0) out.push({ expense_id: null, amount_cents: remaining });
  return out;
}

export function eventSettlement(input: {
  events: EventRow[];
  expenses: (Expense & { event_id?: string | null })[];
  shares: Share[]; payers: Payer[];
  settlements: (Settlement & { id?: string; event_id?: string | null; status?: string })[];
  guests: Guest[];
  allocations?: { settlement_id: string; expense_id: string | null; amount_cents: Cents }[];
}): Record<string, EventSettleState> {
  const { events, expenses, shares, payers, settlements, guests, allocations } = input;
  const gById: Record<string, Guest> = {};
  for (const g of guests) gById[g.id] = g;
  const evById: Record<string, EventRow> = {};
  for (const e of events) evById[e.id] = e;
  const bkey = (eid: string | null | undefined) => eid ?? "";

  // bucket set + date
  const bucketDate: Record<string, number> = {};
  const noteDate = (k: string, ms: number) => { if (!Number.isNaN(ms) && (bucketDate[k] == null || ms < bucketDate[k])) bucketDate[k] = ms; };
  const bucketExpenses: Record<string, typeof expenses> = {};
  for (const e of expenses) {
    const k = bkey(e.event_id);
    (bucketExpenses[k] || (bucketExpenses[k] = [])).push(e);
    const ev = e.event_id ? evById[e.event_id] : null;
    const ms = ev?.event_date ? Date.parse(ev.event_date + "T00:00:00") : ev?.created_at ? Date.parse(ev.created_at) : (e as any).created_at ? Date.parse((e as any).created_at) : 0;
    noteDate(k, ms);
  }

  // Confirmed coverage per (bucket -> member -> paid). Preferred source: settlement_allocations, which tie
  // a payment to specific expenses — so coverage follows an expense's CURRENT event (moving an expense
  // moves its coverage), and general (null-expense) allocations don't attribute to any event (global-square
  // handles those). Legacy fallback (no allocations passed): the old event-tagged-settlement coverage.
  const cover: Record<string, Record<string, Cents>> = {};
  if (allocations && allocations.length) {
    const confSet = new Set(settlements.filter((s) => (s.status || "confirmed") === "confirmed").map((s) => s.id).filter(Boolean));
    const stFrom: Record<string, string> = {};
    const stBucket: Record<string, string> = {};
    for (const s of settlements) if (s.id) { stFrom[s.id] = s.from_user_id; stBucket[s.id] = bkey(s.event_id); }
    const expBucket: Record<string, string> = {};
    for (const e of expenses) expBucket[e.id] = bkey(e.event_id);
    for (const a of allocations) {
      if (!confSet.has(a.settlement_id)) continue; // confirmed only
      const from = stFrom[a.settlement_id]; if (!from) continue;
      // expense-tagged → the expense's current event; general remainder → the payment's own event bucket
      // (so a payment made toward an event still fully counts even if part of it can't map to an expense).
      const k = a.expense_id ? expBucket[a.expense_id] : stBucket[a.settlement_id];
      if (k == null) continue;
      (cover[k] || (cover[k] = {}));
      cover[k][from] = (cover[k][from] || 0) + a.amount_cents;
    }
  } else {
    for (const st of settlements) {
      if ((st.status || "confirmed") !== "confirmed") continue;
      const k = bkey(st.event_id);
      (cover[k] || (cover[k] = {}));
      cover[k][st.from_user_id] = (cover[k][st.from_user_id] || 0) + st.amount_cents;
    }
  }

  // Global net per member (CONFIRMED settlements only). A member who owes nothing overall
  // (net >= 0) is settled for EVERY event — pre-existing/untagged/global settlements count, and
  // moving already-settled expenses into an event can't make them look unpaid. Members who DO
  // still owe globally are judged by event-tagged coverage (preserves per-event / dispute handling).
  const confirmed = settlements.filter((s) => (s.status || "confirmed") === "confirmed");
  const gnet = computeBalances(expenses as any, shares, confirmed as any, guests, payers);

  const out: Record<string, EventSettleState> = {};
  for (const k of Object.keys(bucketExpenses)) {
    const eid = k === "" ? null : k;
    const { perMember } = eventNet(eid as any, expenses as any, shares, guests, payers);
    let owed = 0, covered = 0, allSettled = true;
    for (const m of perMember) {
      if (m.net >= 0) continue; // only owers must settle
      const need = -m.net;
      owed += need;
      const real = (cover[k]?.[m.member_id]) || 0;       // ACTUAL paid coverage (drives the $ figure)
      covered += Math.min(real, need);
      const globallySquare = (gnet[m.member_id] || 0) === 0; // fully square (actually paid up) — NOT a
      if (!(globallySquare || real >= need)) allSettled = false; // net creditor, who still owes their share
    }
    out[k] = { eventId: eid, owed, covered, settled: owed === 0 || allSettled, date: bucketDate[k] ?? 0 };
  }
  return out;
}

// Net-balance delta per member for a single expense add/edit/void, used to preview the impact before
// committing. delta = (afterPaid - afterShare) - (beforePaid - beforeShare) per member. Guests should be
// pre-resolved to their sponsor by the caller. Sums to 0 for a valid change (paid total == share total).
export function expenseImpact(
  beforeShares: { member: string; cents: Cents }[], beforePaid: { member: string; cents: Cents }[],
  afterShares: { member: string; cents: Cents }[], afterPaid: { member: string; cents: Cents }[],
): Record<string, Cents> {
  const d: Record<string, Cents> = {};
  const add = (m: string, v: number) => { if (m) d[m] = (d[m] || 0) + v; };
  for (const s of beforeShares) add(s.member, s.cents);   // removing an old share => owe less => net up
  for (const p of beforePaid) add(p.member, -p.cents);    // removing old outlay => net down
  for (const s of afterShares) add(s.member, -s.cents);   // new share => owe more => net down
  for (const p of afterPaid) add(p.member, p.cents);      // new outlay => net up
  for (const k of Object.keys(d)) if (d[k] === 0) delete d[k];
  return d;
}

// ---------------- Bucket-scoped settlement (nested worlds that roll up to the Club) ----------------
// A Bucket (group_events row) is a closed money world: its expenses net among its members, its OWN
// confirmed settlements pay those down, and it is SETTLED when everyone in it is net-square. Settlement
// never crosses Buckets. A member's Club balance is exactly the sum of their Bucket balances — that
// partition identity is what lets the Club act as a read-only scoreboard over independent Buckets.
type BucketSettlement = Settlement & { id?: string; event_id?: string | null; status?: string };

// Net position per member within ONE Bucket, AFTER that Bucket's confirmed settlements.
// Sign: positive = owed (creditor in the bucket), negative = owes (debtor). Zero balances are dropped.
export function bucketBalances(
  bucketId: string | null,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], settlements: BucketSettlement[], guests: Guest[], payers: Payer[] = [],
): Record<string, Cents> {
  const bal: Record<string, Cents> = {};
  const { perMember } = eventNet(bucketId, expenses, shares, guests, payers);
  for (const m of perMember) bal[m.member_id] = (bal[m.member_id] || 0) + m.net;
  for (const s of settlements) {
    if ((s.status || "confirmed") !== "confirmed") continue;
    if ((s.event_id ?? null) !== bucketId) continue;
    bal[s.from_user_id] = (bal[s.from_user_id] || 0) + s.amount_cents; // debtor pays down
    bal[s.to_user_id] = (bal[s.to_user_id] || 0) - s.amount_cents;     // creditor made whole
  }
  for (const k of Object.keys(bal)) if (bal[k] === 0) delete bal[k];
  return bal;
}

// Fewest-payments transfers to square ONE Bucket (after its settlements).
export function bucketTransfers(
  bucketId: string | null,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], settlements: BucketSettlement[], guests: Guest[], payers: Payer[] = [],
): Transfer[] {
  return simplify(bucketBalances(bucketId, expenses, shares, settlements, guests, payers));
}

// A Bucket is settled when nobody is left owing within it (all balances zero → no transfers remain).
export function bucketSettled(
  bucketId: string | null,
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], settlements: BucketSettlement[], guests: Guest[], payers: Payer[] = [],
): boolean {
  return Object.keys(bucketBalances(bucketId, expenses, shares, settlements, guests, payers)).length === 0;
}

// Club rollup (read-only scoreboard): each member's net across ALL buckets + the per-bucket breakdown,
// so a member who is net-$0 overall still sees "owe $X in bucket Y, due $Z in bucket K". By construction
// net === computeBalances (a member's club balance is the sum of their bucket balances) — the invariant
// the scoreboard rests on. Pass every bucket id (a null entry folds in any still-ungrouped expenses).
export interface ClubRollupLine { member_id: string; net: Cents; byBucket: { bucket_id: string | null; amount: Cents }[] }
export function clubRollup(
  bucketIds: (string | null)[],
  expenses: (Expense & { event_id?: string | null })[],
  shares: Share[], settlements: BucketSettlement[], guests: Guest[], payers: Payer[] = [],
): ClubRollupLine[] {
  const confirmed = settlements.filter((s) => (s.status || "confirmed") === "confirmed");
  const net = computeBalances(expenses as Expense[], shares, confirmed as Settlement[], guests, payers);
  const byMember: Record<string, { bucket_id: string | null; amount: Cents }[]> = {};
  for (const bid of bucketIds) {
    const bb = bucketBalances(bid, expenses, shares, settlements, guests, payers);
    for (const [m, v] of Object.entries(bb)) (byMember[m] || (byMember[m] = [])).push({ bucket_id: bid, amount: v });
  }
  const members = new Set<string>([...Object.keys(net), ...Object.keys(byMember)]);
  const out: ClubRollupLine[] = [];
  for (const m of members) { const v = net[m] || 0; if (v !== 0 || (byMember[m] || []).length) out.push({ member_id: m, net: v, byBucket: byMember[m] || [] }); }
  return out;
}
