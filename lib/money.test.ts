// Unit tests for lib/money.ts — run with `npm test`.
import {
  evenShares, validateCustomTotal, computeBalances, simplify, pairwiseDebts, aggregateOwed,
  payLink, nudgeSms, fmtUSD, guestOwedFor, betResultToPost,
} from "./money";
import type { Expense, Share, Settlement, Guest, Transfer, Payer } from "./money";

let pass = 0, fail = 0; const fails: string[] = [];
// Canonicalize: sort object keys (leave arrays in order) so {a,b} == {b,a}.
const canon = (v: any): string => JSON.stringify(v, (_k, val) =>
  (val && typeof val === "object" && !Array.isArray(val))
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
    : val);
const check = (name: string, got: any, exp: any) => {
  const a = canon(got), b = canon(exp);
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${name}\n   got ${a}\n   exp ${b}`); }
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);
const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

// --- 2) even split reconciles exactly, incl. odd cents ---
check("even 1000/3", evenShares(1000, 3), [334, 333, 333]);
check("even 400/4", evenShares(400, 4), [100, 100, 100, 100]);
check("even 0/3", evenShares(0, 3), [0, 0, 0]);
check("even 1001/3 sums", evenShares(1001, 3).reduce((s, v) => s + v, 0), 1001);
check("even 9999/7 sums", evenShares(9999, 7).reduce((s, v) => s + v, 0), 9999);

// --- 3) custom split must reconcile to total ---
ok("custom ok", validateCustomTotal([1500, 1500, 1500], 4500));
ok("custom short", !validateCustomTotal([1500, 1500, 1400], 4500));
ok("custom over", !validateCustomTotal([1500, 1500, 1600], 4500));

// --- scenario: Amit sponsors guest Sam ---
const guests: Guest[] = [{ id: "gSam", sponsor_user_id: "amit", name: "Sam" }];
const expenses: Expense[] = [
  { id: "e1", payer_user_id: "amit", amount_cents: 36000 }, // tee, even 4
  { id: "e2", payer_user_id: "ravi", amount_cents: 8000 },  // lunch, even 4
  { id: "e3", payer_user_id: "dev", amount_cents: 4500 },   // bet: amit, ravi, Sam
];
const shares: Share[] = [
  { expense_id: "e1", user_id: "amit", share_cents: 9000 },
  { expense_id: "e1", user_id: "dev", share_cents: 9000 },
  { expense_id: "e1", user_id: "ravi", share_cents: 9000 },
  { expense_id: "e1", guest_id: "gSam", share_cents: 9000 },
  { expense_id: "e2", user_id: "amit", share_cents: 2000 },
  { expense_id: "e2", user_id: "dev", share_cents: 2000 },
  { expense_id: "e2", user_id: "ravi", share_cents: 2000 },
  { expense_id: "e2", guest_id: "gSam", share_cents: 2000 },
  { expense_id: "e3", user_id: "amit", share_cents: 1500 },
  { expense_id: "e3", user_id: "ravi", share_cents: 1500 },
  { expense_id: "e3", guest_id: "gSam", share_cents: 1500 },
];
const settlements: Settlement[] = [];

// --- 1) balances sum to zero; --- 5) guest resolves to sponsor, absent from map ---
const bal = computeBalances(expenses, shares, settlements, guests);
check("balances", bal, { amit: 11000, dev: -6500, ravi: -4500 });
ok("guest not in balances", !("gSam" in bal));
check("balances sum zero", sum(bal), 0);
check("guest owed total", guestOwedFor("gSam", shares), 12500);

// reassign Sam's sponsor to Dev -> guest amounts move
const guests2: Guest[] = [{ id: "gSam", sponsor_user_id: "dev", name: "Sam" }];
const bal2 = computeBalances(expenses, shares, settlements, guests2);
check("reassign moves balance", bal2, { amit: 23500, dev: -19000, ravi: -4500 });
check("reassign still sums zero", sum(bal2), 0);

// a settlement squares part of it
const bal3 = computeBalances(expenses, shares, [{ from_user_id: "dev", to_user_id: "amit", amount_cents: 6500 }], guests);
check("after settlement", bal3, { amit: 4500, dev: 0, ravi: -4500 });
check("settlement sums zero", sum(bal3), 0);

// --- multiple payers: paid side uses per-payer rows, else legacy single payer ---
const mpExp: Expense[] = [{ id: "m1", payer_user_id: "amit", amount_cents: 30000 }];
const mpShares: Share[] = [
  { expense_id: "m1", user_id: "amit", share_cents: 10000 },
  { expense_id: "m1", user_id: "dev", share_cents: 10000 },
  { expense_id: "m1", user_id: "ravi", share_cents: 10000 },
];
const mpPayers: Payer[] = [
  { expense_id: "m1", user_id: "amit", paid_cents: 20000 },
  { expense_id: "m1", user_id: "dev", paid_cents: 10000 },
];
check("multi-payer balances", computeBalances(mpExp, mpShares, [], [], mpPayers), { amit: 10000, dev: 0, ravi: -10000 });
check("multi-payer sums zero", sum(computeBalances(mpExp, mpShares, [], [], mpPayers)), 0);
check("legacy single payer (no payer rows)", computeBalances(mpExp, mpShares, [], []), { amit: 20000, dev: -10000, ravi: -10000 });

// --- 4) simplify: fewest transfers, everyone nets to zero, <= n-1 ---
const tx = simplify(bal);
const applied: Record<string, number> = { ...bal };
tx.forEach((t: Transfer) => { applied[t.from] += t.amt; applied[t.to] -= t.amt; });
check("simplify nets to zero", sum(Object.fromEntries(Object.entries(applied).map(([k, v]) => [k, v]))), 0);
ok("simplify zeroes everyone", Object.values(applied).every((v) => v === 0));
const nonzero = Object.values(bal).filter((v) => v !== 0).length;
ok("simplify <= n-1 transfers", tx.length <= nonzero - 1);
check("simplify transfers", tx, [{ from: "dev", to: "amit", amt: 6500 }, { from: "ravi", to: "amit", amt: 4500 }]);

// --- aggregate owed across groups (banner) ---
const g1 = { amit: -6500, dev: 6500 };
const g2 = { amit: -4500, x: 4500 };
check("aggregate owed amit", aggregateOwed([g1, g2], "amit"), 11000);
check("aggregate owed dev (owed, not owing)", aggregateOwed([g1, g2], "dev"), 0);

// --- formatting + links ---
check("fmt whole", fmtUSD(6500), "$65");
check("fmt cents", fmtUSD(6550), "$65.50");
check("fmt neg", fmtUSD(-100), "-$1");
check("venmo link", payLink("venmo", "amit-sud", 6500, "Golf"), "https://venmo.com/amit-sud?txn=pay&amount=65.00&note=Golf");
check("paypal link", payLink("paypal", "ravigolf", 4500, "x"), "https://paypal.me/ravigolf/45.00");
ok("nudge sms has body", nudgeSms("2015550102", "Dev", 6500, "Saturday Golf", "bnn.app/g/x").startsWith("sms:2015550102?&body="));

// --- pairwiseDebts (as-entered who-owes-whom) ---
{
  const guests: any[] = [];
  const expenses = [
    { id: "e1", payer_user_id: "amit", amount_cents: 6000 },
    { id: "e2", payer_user_id: "ravi", amount_cents: 3000 },
  ];
  const shares = [
    { expense_id: "e1", user_id: "amit", share_cents: 2000 },
    { expense_id: "e1", user_id: "ravi", share_cents: 2000 },
    { expense_id: "e1", user_id: "sam", share_cents: 2000 },
    { expense_id: "e2", user_id: "ravi", share_cents: 1500 },
    { expense_id: "e2", user_id: "sam", share_cents: 1500 },
  ];
  const pw = pairwiseDebts(expenses as any, shares as any, [], guests, []);
  const key = (t: any) => t.from + ">" + t.to + ":" + t.amt;
  check("pairwise dinner/drinks", pw.map(key).sort(), ["ravi>amit:2000", "sam>amit:2000", "sam>ravi:1500"].sort());

  // invariant: pairwise nets per member equal computeBalances
  const bal = computeBalances(expenses as any, shares as any, [], guests, []);
  const netFrom: Record<string, number> = {};
  pw.forEach((t: any) => { netFrom[t.to] = (netFrom[t.to] || 0) + t.amt; netFrom[t.from] = (netFrom[t.from] || 0) - t.amt; });
  check("pairwise invariant vs balances", netFrom, { amit: bal.amit, ravi: bal.ravi, sam: bal.sam });

  // settlement subtracts a real pair
  const pw2 = pairwiseDebts(expenses as any, shares as any, [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 2000 }] as any, guests, []);
  check("pairwise after settle", pw2.map(key).sort(), ["sam>amit:2000", "sam>ravi:1500"].sort());
}
// multi-payer proportional allocation + guest->sponsor
{
  const guests = [{ id: "g1", sponsor_user_id: "carol" }];
  const expenses = [{ id: "e1", payer_user_id: "alice", amount_cents: 10000 }];
  const payers = [
    { expense_id: "e1", user_id: "alice", paid_cents: 6000 },
    { expense_id: "e1", user_id: "bob", paid_cents: 4000 },
  ];
  const shares = [
    { expense_id: "e1", user_id: "alice", share_cents: 2500 },
    { expense_id: "e1", user_id: "bob", share_cents: 2500 },
    { expense_id: "e1", user_id: "carol", share_cents: 2500 },
    { expense_id: "e1", guest_id: "g1", share_cents: 2500 },
  ];
  const pw = pairwiseDebts(expenses as any, shares as any, [], guests as any, payers as any);
  const bal = computeBalances(expenses as any, shares as any, [], guests as any, payers as any);
  const netFrom: Record<string, number> = {};
  pw.forEach((t: any) => { netFrom[t.to] = (netFrom[t.to] || 0) + t.amt; netFrom[t.from] = (netFrom[t.from] || 0) - t.amt; });
  // guest folds into carol; every member's pairwise net equals its balance
  check("multipayer invariant", netFrom, { alice: bal.alice, bob: bal.bob, carol: bal.carol });
}


// ---- betResultToPost: bet nets -> expense (payers=winners, shares=losers) ----
{
  const r = betResultToPost([
    { user_id: "a", name: "A", net: 30 },
    { user_id: "b", name: "B", net: -10 },
    { user_id: "c", name: "C", net: -20 },
  ]);
  check("bet ok", r.ok, true);
  check("bet amount = winnings", r.amount_cents, 3000);
  check("bet payers = winners", r.payers, [{ user_id: "a", paid_cents: 3000 }]);
  check("bet shares = losers", r.shares.map((s) => [s.user_id, s.share_cents]), [["b", 1000], ["c", 2000]]);
  check("bet payers==shares (zero-sum cents)", r.amount_cents, r.shares.reduce((x, s) => x + s.share_cents, 0));
}
{
  // segment winner who net-loses is a SHARE (owes), not a payer
  const r = betResultToPost([
    { user_id: "a", name: "A", net: 55 },
    { user_id: "b", name: "B", net: -55 },
    { user_id: "c", name: "C", net: -55 + 55 - 55 }, // placeholder to keep it simple below
  ].slice(0, 2));
  check("2-player winner is payer", r.payers, [{ user_id: "a", paid_cents: 5500 }]);
  check("2-player loser is share", r.shares, [{ user_id: "b", share_cents: 5500 }]);
}
{
  // fractional dollars kept zero-sum in cents via largest-remainder
  const r = betResultToPost([
    { user_id: "a", name: "A", net: 33.34 },
    { user_id: "b", name: "B", net: -16.67 },
    { user_id: "c", name: "C", net: -16.67 },
  ]);
  check("frac zero-sum", r.amount_cents, r.shares.reduce((x, s) => x + s.share_cents, 0));
  check("frac ok", r.ok, true);
}
{
  const r = betResultToPost([{ user_id: "a", name: "A", net: 0 }]);
  check("solo not ok", r.ok, false);
}

console.log(`\n=== money.test ===\nPASS ${pass}  FAIL ${fail}`);
if (fails.length) { console.log("\n" + fails.join("\n\n")); process.exit(1); }
console.log("All assertions passed.");
