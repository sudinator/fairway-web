// Tests for the Bucket-scoped settlement model (lib/money.ts) — run with `npm test`.
// Proves the properties the Club-rollup design rests on:
//   • partition:      a member's Club net == the sum of their Bucket balances
//   • conservation:   every Bucket's balances sum to zero (owes == gets within it)
//   • settled:        a Bucket is settled  <=>  it has no fewest-payments transfers left
//   • isolation:      settling Bucket A never changes Bucket B
//   • round-trip:     paying a Bucket's offered transfers squares it exactly, never over
import {
  computeBalances, evenShares, bucketBalances, bucketTransfers, bucketSettled, clubRollup,
} from "./money";
import type { Expense, Share, Settlement, Guest, Payer } from "./money";

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } }
function eq(name: string, got: any, want: any) { ok(name + ` (got ${got}, want ${want})`, got === want); }
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

type Row = Expense & { event_id: string | null };
type St = Settlement & { id?: string; event_id?: string | null; status?: string };

// ---- fixed fixture: two buckets, four members ----
const M = ["a", "b", "c", "d"];
// Bucket X: a paid $120 split evenly a,b,c,d ($30 each) -> b,c,d each owe a $30
// Bucket Y: b paid $80  split evenly b,c        ($40 each) -> c owes b $40
const expX: Row = { id: "x1", event_id: "X", payer_user_id: "a", amount_cents: 12000 };
const expY: Row = { id: "y1", event_id: "Y", payer_user_id: "b", amount_cents: 8000 };
const expenses: Row[] = [expX, expY];
const shares: Share[] = [
  ...["a", "b", "c", "d"].map((u, i) => ({ expense_id: "x1", user_id: u, guest_id: null as any, share_cents: evenShares(12000, 4)[i] })),
  ...["b", "c"].map((u, i) => ({ expense_id: "y1", user_id: u, guest_id: null as any, share_cents: evenShares(8000, 2)[i] })),
];
const payers: Payer[] = [
  { expense_id: "x1", user_id: "a", guest_id: null as any, paid_cents: 12000 },
  { expense_id: "y1", user_id: "b", guest_id: null as any, paid_cents: 8000 },
];
const guests: Guest[] = [];

// Bucket X balances: a +90, b -30, c -30, d -30
const bx = bucketBalances("X", expenses, shares, [], guests, payers);
eq("X a owed", bx["a"], 9000); eq("X b owes", bx["b"], -3000); eq("X d owes", bx["d"], -3000);
eq("X conserves", sum(bx), 0);
// Bucket Y balances: b +40, c -40
const by = bucketBalances("Y", expenses, shares, [], guests, payers);
eq("Y b owed", by["b"], 4000); eq("Y c owes", by["c"], -4000); eq("Y conserves", sum(by), 0);

// Partition: club net == sum of bucket balances, per member
const club = computeBalances(expenses as Expense[], shares, [], guests, payers);
for (const m of M) eq(`partition ${m}`, (bx[m] || 0) + (by[m] || 0), club[m] || 0);

// clubRollup: net + per-bucket breakdown; net matches computeBalances; c shows BOTH buckets
const roll = clubRollup(["X", "Y"], expenses, shares, [], guests, payers);
const cLine = roll.find((r) => r.member_id === "c")!;
eq("rollup c net", cLine.net, -7000); // owes 30 in X + 40 in Y
eq("rollup c has 2 buckets", cLine.byBucket.length, 2);
const bLine = roll.find((r) => r.member_id === "b")!;
// b owes 30 in X but is owed 40 in Y -> net +10, but MUST still show both buckets (the point of §4.1)
eq("rollup b net", bLine.net, 1000);
eq("rollup b shows both buckets even though near-net", bLine.byBucket.length, 2);

// settled state before any payment
eq("X not settled", bucketSettled("X", expenses, shares, [], guests, payers), false);
eq("Y not settled", bucketSettled("Y", expenses, shares, [], guests, payers), false);

// ---- pay off Bucket X only; Y must be untouched (isolation) ----
function payBucket(bid: string, sts: St[]): St[] {
  const tr = bucketTransfers(bid, expenses, shares, sts, guests, payers);
  return [...sts, ...tr.map((t, i) => ({ id: `${bid}-p${i}`, from_user_id: t.from, to_user_id: t.to, amount_cents: t.amt, event_id: bid, status: "confirmed" }))];
}
let sts: St[] = payBucket("X", []);
eq("X settled after paying its transfers", bucketSettled("X", expenses, shares, sts, guests, payers), true);
eq("Y still NOT settled (isolation)", bucketSettled("Y", expenses, shares, sts, guests, payers), false);
eq("Y balances unchanged after X settled", sum(bucketBalances("Y", expenses, shares, sts, guests, payers)), 0);
ok("Y c still owes 40 after X settled", bucketBalances("Y", expenses, shares, sts, guests, payers)["c"] === -4000);

// pay Y too -> whole club square
sts = payBucket("Y", sts);
eq("Y settled", bucketSettled("Y", expenses, shares, sts, guests, payers), true);
const clubAfter = computeBalances(expenses as Expense[], shares, sts as Settlement[], guests, payers);
eq("club fully square after both buckets settled", Object.values(clubAfter).filter((v) => v !== 0).length, 0);

// round-trip: offered transfers never make anyone go the wrong way / overpay
for (const bid of ["X", "Y"]) {
  const before = bucketBalances(bid, expenses, shares, [], guests, payers);
  const tr = bucketTransfers(bid, expenses, shares, [], guests, payers);
  // every transfer's payer is an actual debtor, payee an actual creditor; amount <= their |balance|
  for (const t of tr) {
    ok(`${bid} offer ${t.from}->${t.to} payer is debtor`, (before[t.from] || 0) < 0);
    ok(`${bid} offer ${t.from}->${t.to} payee is creditor`, (before[t.to] || 0) > 0);
  }
  const paid = payBucket(bid, []);
  ok(`${bid} squares exactly after paying offer`, bucketSettled(bid, expenses, shares, paid, guests, payers));
}

// ============================ FUZZER ============================
// Random multi-bucket worlds; after building and after settling buckets one by one, the invariants
// (partition, per-bucket conservation, isolation, settled<=>no-transfers) must hold every time.
function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let fuzzFails = 0; const N = 1500;
for (let iter = 0; iter < N; iter++) {
  const rnd = mulberry32(50000 + iter); const ri = (n: number) => Math.floor(rnd() * n);
  try {
    const mem = ["a", "b", "c", "d", "e"].slice(0, 3 + ri(3));
    const buckets = ["B0", "B1", "B2"].slice(0, 1 + ri(3));
    const exps: Row[] = []; const shs: Share[] = []; const pys: Payer[] = [];
    const nExp = 1 + ri(6);
    for (let e = 0; e < nExp; e++) {
      const bid = buckets[ri(buckets.length)];
      const amt = (1 + ri(50)) * 100;
      const payer = mem[ri(mem.length)];
      // random non-empty sharer subset
      const sharers = mem.filter(() => rnd() < 0.6); if (!sharers.length) sharers.push(mem[ri(mem.length)]);
      const id = `e${iter}_${e}`;
      exps.push({ id, event_id: bid, payer_user_id: payer, amount_cents: amt });
      pys.push({ expense_id: id, user_id: payer, guest_id: null as any, paid_cents: amt });
      const parts = evenShares(amt, sharers.length);
      sharers.forEach((u, i) => shs.push({ expense_id: id, user_id: u, guest_id: null as any, share_cents: parts[i] }));
    }
    // partition + conservation, no settlements yet
    const clubB = computeBalances(exps as Expense[], shs, [], guests, pys);
    for (const m of mem) {
      const s = buckets.reduce((acc, b) => acc + (bucketBalances(b, exps, shs, [], guests, pys)[m] || 0), 0);
      if (s !== (clubB[m] || 0)) throw new Error(`partition broke m=${m} ${s}!=${clubB[m] || 0}`);
    }
    for (const b of buckets) if (sum(bucketBalances(b, exps, shs, [], guests, pys)) !== 0) throw new Error(`bucket ${b} not conserved`);

    // settle buckets one at a time, checking isolation + settled<=>no-transfers after each
    let st: St[] = [];
    for (let bi = 0; bi < buckets.length; bi++) {
      const bid = buckets[bi];
      const before = buckets.slice(bi + 1).map((b) => JSON.stringify(bucketBalances(b, exps, shs, st, guests, pys)));
      const tr = bucketTransfers(bid, exps, shs, st, guests, pys);
      st = [...st, ...tr.map((t, i) => ({ id: `${bid}s${i}`, from_user_id: t.from, to_user_id: t.to, amount_cents: t.amt, event_id: bid, status: "confirmed" }))];
      if (!bucketSettled(bid, exps, shs, st, guests, pys)) throw new Error(`bucket ${bid} not settled after paying offer`);
      if (bucketTransfers(bid, exps, shs, st, guests, pys).length !== 0) throw new Error(`bucket ${bid} still has transfers`);
      const after = buckets.slice(bi + 1).map((b) => JSON.stringify(bucketBalances(b, exps, shs, st, guests, pys)));
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`isolation broke settling ${bid}`);
    }
    // whole club square after all buckets settled
    const clubDone = computeBalances(exps as Expense[], shs, st as Settlement[], guests, pys);
    if (Object.values(clubDone).some((v) => v !== 0)) throw new Error(`club not square after all buckets settled`);
  } catch (err: any) { fuzzFails++; if (fuzzFails <= 3) console.log(`  BF FAIL seed ${50000 + iter}: ${err.message}`); }
}
ok(`BF: ${N} random multi-bucket worlds — partition/conservation/isolation/settled invariants held`, fuzzFails === 0);

console.log(`\nbucket-model: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
