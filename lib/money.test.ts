// Unit tests for lib/money.ts — run with `npm test`.
import {
  evenShares, validateCustomTotal, computeBalances, simplify, pairwiseDebts, aggregateOwed,
  payLink, nudgeSms, fmtUSD, guestOwedFor, guestCoverageBySponsor, betResultToPost,
  collapseAuditBursts, auditVersionsByExpense, eventNet, expensesByEvent, personLedger, eventSettlement, withinEventDebts, withinEventDebtsRemaining, eventStandings, allocateSettlement,
} from "./money";
import type { Expense, Share, Settlement, Guest, Transfer, Payer, AuditRow } from "./money";

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
  check("bet payers = winners", r.payers, [{ user_id: "a", guest_id: null, sponsor_user_id: null, paid_cents: 3000 }]);
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
  check("2-player winner is payer", r.payers, [{ user_id: "a", guest_id: null, sponsor_user_id: null, paid_cents: 5500 }]);
  check("2-player loser is share", r.shares, [{ user_id: "b", guest_id: null, sponsor_user_id: null, share_cents: 5500 }]);
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

// --- per-expense guest sponsor (0063) ---
{
  // Sam is a guest whose OLD fixed sponsor is amit. New shares carry their own sponsor.
  const gSam: Guest[] = [{ id: "gSam", sponsor_user_id: "amit", name: "Sam" }];
  // Two dinners, each $100 paid by ravi, split evenly between ravi and guest Sam ($50 each).
  const exp: Expense[] = [
    { id: "e1", payer_user_id: "ravi", amount_cents: 10000 },
    { id: "e2", payer_user_id: "ravi", amount_cents: 10000 },
  ];
  const sh: Share[] = [
    { expense_id: "e1", user_id: "ravi", share_cents: 5000 },
    { expense_id: "e1", guest_id: "gSam", sponsor_user_id: "amit", share_cents: 5000 }, // amit covers Sam this time
    { expense_id: "e2", user_id: "ravi", share_cents: 5000 },
    { expense_id: "e2", guest_id: "gSam", sponsor_user_id: "dev", share_cents: 5000 },  // dev covers Sam this time
  ];
  const bal = computeBalances(exp, sh, [], gSam);
  // ravi paid 20000, owes own 10000 => +10000; amit owes Sam's first 5000; dev owes Sam's second 5000.
  check("per-expense sponsor splits a guest across members", bal, { ravi: 10000, amit: -5000, dev: -5000 });
  check("per-expense sponsor sums zero", sum(bal), 0);

  // Legacy fallback: a guest share with NO per-expense sponsor uses the guest's old sponsor (amit).
  const legacy: Share[] = [
    { expense_id: "e1", user_id: "ravi", share_cents: 5000 },
    { expense_id: "e1", guest_id: "gSam", share_cents: 5000 }, // no sponsor_user_id -> falls back to amit
  ];
  const balL = computeBalances([exp[0]], legacy, [], gSam);
  check("legacy guest share falls back to fixed sponsor", balL, { ravi: 5000, amit: -5000 });

  // Coverage helper: who is covering which guest, and the net effect on the sponsor
  // (a losing guest's share is negative).
  const gById = Object.fromEntries(gSam.map((g) => [g.id, g]));
  check("guestCoverageBySponsor maps per-expense sponsors (shares negative)", guestCoverageBySponsor(sh, gById), { amit: { gSam: -5000 }, dev: { gSam: -5000 } });
  check("guestCoverageBySponsor uses fallback when share has none", guestCoverageBySponsor(legacy, gById), { amit: { gSam: -5000 } });

  // A guest with no sponsor anywhere (new-style guest, share missing sponsor) is simply unresolved (dropped).
  const orphanGuest: Guest[] = [{ id: "gX", sponsor_user_id: null, name: "X" }];
  const orphanShare: Share[] = [{ expense_id: "e1", guest_id: "gX", share_cents: 5000 }];
  check("guest with no sponsor at all is unresolved", guestCoverageBySponsor(orphanShare, Object.fromEntries(orphanGuest.map((g) => [g.id, g]))), {});

  // --- guest on the WINNING side (payer), 0065 ---
  // Bet: ravi paid nothing; guest Sam WON $60 credited to sponsor amit; ravi & dev lost $30 each.
  const betExp: Expense[] = [{ id: "b1", payer_user_id: "amit", amount_cents: 6000 }];
  const betPayers: Payer[] = [{ expense_id: "b1", guest_id: "gSam", sponsor_user_id: "amit", paid_cents: 6000 }];
  const betShares: Share[] = [
    { expense_id: "b1", user_id: "ravi", share_cents: 3000 },
    { expense_id: "b1", user_id: "dev", share_cents: 3000 },
  ];
  const betBal = computeBalances(betExp, betShares, [], gSam, betPayers);
  // Sam's $60 win credits amit (sponsor); ravi and dev each owe $30.
  check("winning guest credits sponsor (payer resolves to sponsor)", betBal, { amit: 6000, ravi: -3000, dev: -3000 });
  check("winning-guest bet sums zero", sum(betBal), 0);
  check("coverage includes winning guests (payer, positive)", guestCoverageBySponsor(betShares, gById, betPayers), { amit: { gSam: 6000 } });

  // betResultToPost carries guest identity onto the posted payer/share rows.
  const nets: any[] = [
    { user_id: "amit", net: 50 },
    { user_id: null, guest_id: "gSam", sponsor_user_id: "amit", net: 40 }, // guest of amit, wins
    { user_id: "dev", net: -40 },
    { user_id: "ravi", net: -30 },
    { user_id: "p4", net: -20 },
  ];
  const bp = betResultToPost(nets as any);
  ok("betResultToPost balances", bp.ok);
  const samPayer = bp.payers.find((p: any) => p.guest_id === "gSam");
  check("guest winner booked as guest payer with sponsor", { g: samPayer?.guest_id, s: samPayer?.sponsor_user_id, c: samPayer?.paid_cents }, { g: "gSam", s: "amit", c: 4000 });
}

// --- audit burst collapse (money_audit → clean versions) ---
{
  const snap = (amt: number, shares: number) => ({ amount_cents: amt, shares: Array.from({ length: shares }, (_, i) => ({ user_id: "u" + i, guest_id: null, name: "P" + i, share_cents: Math.floor(amt / shares) })) });
  // A CREATE arrives as: expense insert (no children) → shares insert → payers insert, same actor, ~sub-second apart.
  const createBurst: AuditRow[] = [
    { id: "1", expense_id: "e1", actor_id: "amit", action: "created", snapshot: snap(3000, 0) as any, created_at: "2026-07-14T10:00:00.000Z" },
    { id: "2", expense_id: "e1", actor_id: "amit", action: "edited",  snapshot: snap(3000, 3) as any, created_at: "2026-07-14T10:00:00.400Z" },
    { id: "3", expense_id: "e1", actor_id: "amit", action: "edited",  snapshot: snap(3000, 3) as any, created_at: "2026-07-14T10:00:00.800Z" },
  ];
  const v1 = collapseAuditBursts(createBurst);
  check("create burst collapses to one version", v1.length, 1);
  check("create burst keeps 'created' action", v1[0].action, "created");
  check("create burst keeps final (complete) snapshot", (v1[0].snapshot as any).shares.length, 3);

  // A later EDIT by an admin: expense update → shares delete/insert → payers delete/insert.
  const editBurst: AuditRow[] = [
    { id: "4", expense_id: "e1", actor_id: "bob", action: "edited", snapshot: snap(5000, 3) as any, created_at: "2026-07-14T11:30:00.000Z" },
    { id: "5", expense_id: "e1", actor_id: "bob", action: "edited", snapshot: snap(5000, 2) as any, created_at: "2026-07-14T11:30:00.500Z" },
    { id: "6", expense_id: "e1", actor_id: "bob", action: "edited", snapshot: snap(5000, 2) as any, created_at: "2026-07-14T11:30:00.900Z" },
  ];
  const v2 = collapseAuditBursts([...createBurst, ...editBurst]);
  check("create + edit = two versions", v2.length, 2);
  check("second version is an edit", v2[1].action, "edited");
  check("second version by bob", v2[1].actor_id, "bob");
  check("edit keeps final amount", (v2[1].snapshot as any).amount_cents, 5000);

  // A DELETE is always its own terminal version and never merges, even if close in time.
  const withDelete: AuditRow[] = [
    ...createBurst,
    { id: "7", expense_id: "e1", actor_id: "amit", action: "deleted", snapshot: snap(3000, 3) as any, created_at: "2026-07-14T10:00:01.000Z" },
  ];
  const v3 = collapseAuditBursts(withDelete);
  check("delete does not merge into create burst", v3.length, 2);
  check("delete is terminal version", v3[v3.length - 1].action, "deleted");
  check("deleted version retains frozen allocation", (v3[1].snapshot as any).shares.length, 3);

  // Different actors within the window do NOT merge.
  const twoActors: AuditRow[] = [
    { id: "8", expense_id: "e2", actor_id: "amit", action: "created", snapshot: snap(1000, 2) as any, created_at: "2026-07-14T12:00:00.000Z" },
    { id: "9", expense_id: "e2", actor_id: "bob",  action: "edited",  snapshot: snap(1000, 2) as any, created_at: "2026-07-14T12:00:00.300Z" },
  ];
  check("distinct actors stay distinct versions", collapseAuditBursts(twoActors).length, 2);

  // A gap larger than the window splits versions even for the same actor.
  const gapped: AuditRow[] = [
    { id: "10", expense_id: "e3", actor_id: "amit", action: "created", snapshot: snap(1000, 1) as any, created_at: "2026-07-14T13:00:00.000Z" },
    { id: "11", expense_id: "e3", actor_id: "amit", action: "edited",  snapshot: snap(2000, 1) as any, created_at: "2026-07-14T13:05:00.000Z" },
  ];
  check("large time gap splits versions", collapseAuditBursts(gapped).length, 2);

  // Grouping helper keys by expense.
  const grouped = auditVersionsByExpense([...withDelete, ...twoActors]);
  check("grouped has e1", grouped["e1"].length, 2);
  check("grouped has e2", grouped["e2"].length, 2);
}

// --- event islands: per-member net + grouping ---
{
  // Ireland: Amit paid $1600, Dave paid $810; split evenly 3 ways across the two expenses.
  const exps = [
    { id: "e1", event_id: "ire", payer_user_id: "amit", amount_cents: 160000 },
    { id: "e2", event_id: "ire", payer_user_id: "dave", amount_cents: 81000 },
    { id: "e3", event_id: null,  payer_user_id: "ravi", amount_cents: 3600 }, // ungrouped, must be ignored
  ];
  const shares = [
    // e1 split 3 ways
    { expense_id: "e1", user_id: "amit", guest_id: null, share_cents: 53334 },
    { expense_id: "e1", user_id: "dave", guest_id: null, share_cents: 53333 },
    { expense_id: "e1", user_id: "ravi", guest_id: null, share_cents: 53333 },
    // e2 split 3 ways
    { expense_id: "e2", user_id: "amit", guest_id: null, share_cents: 27000 },
    { expense_id: "e2", user_id: "dave", guest_id: null, share_cents: 27000 },
    { expense_id: "e2", user_id: "ravi", guest_id: null, share_cents: 27000 },
    // ungrouped share (must be ignored by the event lens)
    { expense_id: "e3", user_id: "amit", guest_id: null, share_cents: 3600 },
  ];
  const en = eventNet("ire", exps as any, shares as any, [], []);
  check("event total sums only its expenses", en.total, 241000);
  check("nets still sum to zero by identity", en.perMember.reduce((s, m) => s + m.net, 0), 0);
  ok("owedWithin is positive when someone fronted", en.owedWithin > 0);
  check("owedWithin = sum of positive nets", en.owedWithin, en.perMember.reduce((s, m) => s + (m.net > 0 ? m.net : 0), 0));
  const amit = en.perMember.find((m) => m.member_id === "amit")!;
  check("amit paid within event", amit.paid, 160000);
  check("amit share within event", amit.share, 80334);
  check("amit net within event", amit.net, 79666);
  const ravi = en.perMember.find((m) => m.member_id === "ravi")!;
  check("ravi net within event (owes)", ravi.net, -80333);
  check("ungrouped expense excluded from event", en.perMember.some((m) => m.paid === 3600), false);

  // Grouping buckets event-less under "".
  const byEv = expensesByEvent(exps as any);
  check("grouped ire has 2", byEv["ire"].length, 2);
  check("grouped ungrouped has 1", byEv[""].length, 1);

  // Guest share routes to sponsor inside the event, too.
  const gexps = [{ id: "g1", event_id: "trip", payer_user_id: "amit", amount_cents: 10000 }];
  const gshares = [
    { expense_id: "g1", user_id: "amit", guest_id: null, share_cents: 5000 },
    { expense_id: "g1", user_id: null, guest_id: "gX", sponsor_user_id: "dave", share_cents: 5000 },
  ];
  const gen = eventNet("trip", gexps as any, gshares as any, [{ id: "gX", sponsor_user_id: "dave" }] as any, []);
  const dave = gen.perMember.find((m) => m.member_id === "dave")!;
  check("guest share billed to sponsor in event", dave.net, -5000);
  check("guest event owedWithin = amount fronted", gen.owedWithin, 5000);

  // Everyone pays exactly their own share → nothing fronted → owedWithin 0.
  const sq = eventNet("sq",
    [{ id: "s1", event_id: "sq", payer_user_id: "amit", amount_cents: 5000 },
     { id: "s2", event_id: "sq", payer_user_id: "dave", amount_cents: 5000 }] as any,
    [{ expense_id: "s1", user_id: "amit", guest_id: null, share_cents: 5000 },
     { expense_id: "s2", user_id: "dave", guest_id: null, share_cents: 5000 }] as any, [], []);
  check("self-square event owedWithin is 0", sq.owedWithin, 0);
}

// --- personLedger reconciles to computeBalances for every member ---
{
  const exps = [
    { id: "x1", event_id: "ire", payer_user_id: "amit", amount_cents: 30000, description: "Rental" },
    { id: "x2", event_id: null, payer_user_id: "dave", amount_cents: 6000, description: "Beer" },
  ];
  const shares = [
    { expense_id: "x1", user_id: "amit", guest_id: null, share_cents: 10000 },
    { expense_id: "x1", user_id: "dave", guest_id: null, share_cents: 10000 },
    { expense_id: "x1", user_id: null, guest_id: "gz", sponsor_user_id: "ravi", share_cents: 10000 },
    { expense_id: "x2", user_id: "amit", guest_id: null, share_cents: 3000 },
    { expense_id: "x2", user_id: "dave", guest_id: null, share_cents: 3000 },
  ];
  const setts = [{ from_user_id: "dave", to_user_id: "amit", amount_cents: 5000 }];
  const gs = [{ id: "gz", sponsor_user_id: "ravi", name: "Guest Z" }];
  const bal = computeBalances(exps as any, shares as any, setts as any, gs as any, []);
  for (const mid of ["amit", "dave", "ravi"]) {
    const led = personLedger(mid, exps as any, shares as any, setts as any, gs as any, [], (u) => u || "?");
    check(`ledger total reconciles to balance for ${mid}`, led.total, bal[mid] || 0);
  }
  // ravi's guest line is attributed to the sponsor with a guest label
  const ravi = personLedger("ravi", exps as any, shares as any, setts as any, gs as any, []);
  ok("sponsor sees guest share line", ravi.lines.some((l) => l.kind === "owe" && l.label.includes("Guest Z")));
  // dave's settlement out appears and reduces what he owes (positive delta)
  const dave = personLedger("dave", exps as any, shares as any, setts as any, gs as any, [], (u) => u || "?");
  ok("settlement-out line present", dave.lines.some((l) => l.kind === "settle_out" && l.delta === 5000));
}

// --- per-event settlement: event-tagged coverage (all-or-nothing) ---
{
  const events = [
    { id: "may", group_id: "g", name: "May", event_date: "2026-05-01", event_type: "manual", status: "open" },
    { id: "jul", group_id: "g", name: "Jul", event_date: "2026-07-01", event_type: "manual", status: "open" },
  ];
  const expenses = [
    { id: "e_may", event_id: "may", payer_user_id: "amit", amount_cents: 20000, created_at: "2026-05-01T00:00:00Z" },
    { id: "e_jul", event_id: "jul", payer_user_id: "amit", amount_cents: 20000, created_at: "2026-07-01T00:00:00Z" },
  ];
  const shares = [
    { expense_id: "e_may", user_id: "amit", guest_id: null, share_cents: 10000 },
    { expense_id: "e_may", user_id: "ravi", guest_id: null, share_cents: 10000 },
    { expense_id: "e_jul", user_id: "amit", guest_id: null, share_cents: 10000 },
    { expense_id: "e_jul", user_id: "ravi", guest_id: null, share_cents: 10000 },
  ];
  // Ravi owes $100 within each event, to Amit. Confirm coverage is event-specific.
  const debtsMay = withinEventDebts("may", "ravi", expenses as any, shares as any, [], []);
  check("within-event debt points to fronter Amit", debtsMay[0].to, "amit");
  check("within-event debt amount", debtsMay[0].amount, 10000);

  // Pay ONLY the newer event (Jul) — Jul settles, May stays open. No cross-event ordering.
  const paidJul = eventSettlement({ events: events as any, expenses: expenses as any, shares: shares as any, payers: [],
    settlements: [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 10000, event_id: "jul", status: "confirmed" }] as any, guests: [] });
  ok("Jul settled (its own coverage)", paidJul["jul"].settled);
  ok("May still open (untouched by Jul payment)", !paidJul["may"].settled);

  // Pending settlement does NOT count.
  const pendingOnly = eventSettlement({ events: events as any, expenses: expenses as any, shares: shares as any, payers: [],
    settlements: [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 10000, event_id: "may", status: "pending" }] as any, guests: [] });
  ok("pending settlement doesn't settle the event", !pendingOnly["may"].settled);

  // Editing an expense UP re-opens automatically: coverage $100 no longer covers new $150 owed.
  const bigger = [{ ...shares[1], share_cents: 15000 }, ...shares.filter((_, i) => i !== 1)];
  const afterEdit = eventSettlement({ events: events as any, expenses: [{ ...expenses[0], amount_cents: 25000 }, expenses[1]] as any, shares: bigger as any, payers: [],
    settlements: [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 10000, event_id: "may", status: "confirmed" }] as any, guests: [] });
  ok("edit up re-opens the event (coverage now short)", !afterEdit["may"].settled);

  // Full coverage settles.
  const full = eventSettlement({ events: events as any, expenses: expenses as any, shares: shares as any, payers: [],
    settlements: [
      { from_user_id: "ravi", to_user_id: "amit", amount_cents: 10000, event_id: "may", status: "confirmed" },
      { from_user_id: "ravi", to_user_id: "amit", amount_cents: 10000, event_id: "jul", status: "confirmed" },
    ] as any, guests: [] });
  ok("both settled with full coverage", full["may"].settled && full["jul"].settled);
  // BUG REGRESSION (Livingston): expenses settled globally (untagged settlement), then moved into an
  // event, must stay settled — global-square covers the event even with no event-tagged payment.
  {
    const ev = [{ id: "arch", group_id: "g", name: "Architects 7/5", event_date: "2026-07-05", event_type: "manual", status: "open" }];
    const exp = [{ id: "u1", event_id: "arch", payer_user_id: "amit", amount_cents: 12000, created_at: "2026-07-05T00:00:00Z" }];
    const sh = [
      { expense_id: "u1", user_id: "amit", guest_id: null, share_cents: 6000 },
      { expense_id: "u1", user_id: "ravi", guest_id: null, share_cents: 6000 },
    ];
    // Ravi already settled his $60 via the GLOBAL tab (event_id null) — before the move.
    const st = [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 6000, event_id: null, status: "confirmed" }];
    const res = eventSettlement({ events: ev as any, expenses: exp as any, shares: sh as any, payers: [], settlements: st as any, guests: [] });
    ok("moved-in expenses stay settled when globally square", res["arch"].settled);
  }
}

console.log(`\n=== money.test ===\nPASS ${pass}  FAIL ${fail}`);
if (fails.length) { console.log("\n" + fails.join("\n\n")); process.exit(1); }
console.log("All assertions passed.");

// ============================================================================
// STRESS BATTERY — adversarial cases + property-based fuzz. Goal: break it.
// ============================================================================
{
  // ---- hand-crafted adversarial cases ----

  // 1) Rounding: $10 split 3 ways. evenShares must sum to total; nets must be exact.
  {
    const sh = evenShares(1000, 3);
    check("evenShares sums to total (rounding)", sh.reduce((a, b) => a + b, 0), 1000);
    const exp = [{ id: "r", event_id: "e", payer_user_id: "a", amount_cents: 1000 }];
    const shares = [
      { expense_id: "r", user_id: "a", guest_id: null, share_cents: sh[0] },
      { expense_id: "r", user_id: "b", guest_id: null, share_cents: sh[1] },
      { expense_id: "r", user_id: "c", guest_id: null, share_cents: sh[2] },
    ];
    const bal = computeBalances(exp as any, shares as any, [], [], []);
    check("rounding: balances sum to 0", Object.values(bal).reduce((a, b) => a + b, 0), 0);
    const d = withinEventDebts("e", "b", exp as any, shares as any, [], []);
    check("withinEventDebts sums to b's owed exactly", d.reduce((s, x) => s + x.amount, 0), sh[1]);
  }

  // 2) Netting: owes in X, is owed in Y, globally square → event shows settled (Amit's model).
  {
    const events = [
      { id: "x", group_id: "g", name: "X", event_date: "2026-05-01", event_type: "manual", status: "open" },
      { id: "y", group_id: "g", name: "Y", event_date: "2026-06-01", event_type: "manual", status: "open" },
    ];
    const exp = [
      { id: "ex", event_id: "x", payer_user_id: "amit", amount_cents: 10000, created_at: "2026-05-01T00:00:00Z" }, // amit fronts X
      { id: "ey", event_id: "y", payer_user_id: "ravi", amount_cents: 10000, created_at: "2026-06-01T00:00:00Z" }, // ravi fronts Y
    ];
    const shares = [
      { expense_id: "ex", user_id: "amit", guest_id: null, share_cents: 5000 },
      { expense_id: "ex", user_id: "ravi", guest_id: null, share_cents: 5000 }, // ravi owes 50 in X
      { expense_id: "ey", user_id: "amit", guest_id: null, share_cents: 5000 }, // amit owes 50 in Y
      { expense_id: "ey", user_id: "ravi", guest_id: null, share_cents: 5000 },
    ];
    const bal = computeBalances(exp as any, shares as any, [], [], []);
    check("netting: amit globally square", bal["amit"] || 0, 0);
    check("netting: ravi globally square", bal["ravi"] || 0, 0);
    const st = eventSettlement({ events: events as any, expenses: exp as any, shares: shares as any, payers: [], settlements: [], guests: [] });
    ok("netting: X settled (globally square)", st["x"].settled);
    ok("netting: Y settled (globally square)", st["y"].settled);
  }

  // 3) Circular debt A->B->C->A, simplify should zero everyone and conserve.
  {
    const bal = { a: -5000, b: 0, c: 5000 } as Record<string, number>;
    const tr = simplify(bal);
    const applied: Record<string, number> = { ...bal };
    for (const t of tr) { applied[t.from] += t.amt; applied[t.to] -= t.amt; }
    check("simplify zeroes everyone", Object.values(applied).reduce((a, b) => a + Math.abs(b), 0), 0);
  }

  // 4) Over-settlement: pay more than owed for an event → still settled, not "double negative".
  {
    const events = [{ id: "o", group_id: "g", name: "O", event_date: "2026-05-01", event_type: "manual", status: "open" }];
    const exp = [{ id: "eo", event_id: "o", payer_user_id: "amit", amount_cents: 10000, created_at: "2026-05-01T00:00:00Z" }];
    const shares = [
      { expense_id: "eo", user_id: "amit", guest_id: null, share_cents: 5000 },
      { expense_id: "eo", user_id: "ravi", guest_id: null, share_cents: 5000 },
    ];
    const st = [{ from_user_id: "ravi", to_user_id: "amit", amount_cents: 9000, event_id: "o", status: "confirmed" }]; // overpaid
    const res = eventSettlement({ events: events as any, expenses: exp as any, shares: shares as any, payers: [], settlements: st as any, guests: [] });
    ok("over-settled event is settled", res["o"].settled);
    check("covered capped at owed (no over-count)", res["o"].covered, res["o"].owed);
  }

  // 5) Guest multi-hop: guest sponsored by amit, everything routes to amit.
  {
    const exp = [{ id: "g", event_id: null, payer_user_id: "ravi", amount_cents: 9000 }];
    const shares = [
      { expense_id: "g", user_id: "ravi", guest_id: null, share_cents: 3000 },
      { expense_id: "g", user_id: null, guest_id: "G1", sponsor_user_id: "amit", share_cents: 3000 },
      { expense_id: "g", user_id: null, guest_id: "G2", sponsor_user_id: "amit", share_cents: 3000 },
    ];
    const guests = [{ id: "G1", sponsor_user_id: "amit" }, { id: "G2", sponsor_user_id: "amit" }];
    const bal = computeBalances(exp as any, shares as any, [], guests as any, []);
    check("guest: amit owes both guests' shares", bal["amit"] || 0, -6000);
    check("guest: balances sum to 0", Object.values(bal).reduce((a, b) => a + b, 0), 0);
    const led = personLedger("amit", exp as any, shares as any, [], guests as any, [], (u) => u || "?");
    check("guest: ledger reconciles for sponsor", led.total, bal["amit"] || 0);
  }

  // ---- property-based fuzz: thousands of random valid ledgers ----
  function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  let fuzzFails = 0; let iterations = 3000;
  for (let iter = 0; iter < iterations; iter++) {
    const rnd = mulberry32(1000 + iter);
    const ri = (n: number) => Math.floor(rnd() * n);
    const nMembers = 2 + ri(5);
    const members = Array.from({ length: nMembers }, (_, i) => "m" + i);
    const nGuests = ri(3);
    const guests = Array.from({ length: nGuests }, (_, i) => ({ id: "g" + i, sponsor_user_id: members[ri(nMembers)] }));
    const parties = [...members.map((id) => ({ user_id: id, guest_id: null as string | null, sponsor: null as string | null })),
                     ...guests.map((g) => ({ user_id: null as string | null, guest_id: g.id, sponsor: g.sponsor_user_id }))];
    const nEvents = ri(4);
    const events = Array.from({ length: nEvents }, (_, i) => ({ id: "ev" + i, group_id: "g", name: "E" + i, event_date: `2026-0${1 + i}-01`, event_type: "manual", status: "open" }));
    const buckets: (string | null)[] = [null, ...events.map((e) => e.id)];

    const nExp = 2 + ri(10);
    const expenses: any[] = []; const shares: any[] = []; const payers: any[] = [];
    for (let e = 0; e < nExp; e++) {
      const amt = 100 + ri(50000);
      const payer = members[ri(nMembers)];
      const bucket = buckets[ri(buckets.length)];
      const id = "x" + e;
      expenses.push({ id, event_id: bucket, payer_user_id: payer, amount_cents: amt, created_at: `2026-01-${String(1 + (e % 27)).padStart(2, "0")}T00:00:00Z` });
      // split among a random non-empty subset of parties
      const subset = parties.filter(() => rnd() < 0.7); if (!subset.length) subset.push(parties[ri(parties.length)]);
      const parts = evenShares(amt, subset.length);
      subset.forEach((p, i) => shares.push({ expense_id: id, user_id: p.user_id, guest_id: p.guest_id, sponsor_user_id: p.sponsor, share_cents: parts[i] }));
      // occasionally multiple payers (must sum to amount)
      if (rnd() < 0.25 && nMembers >= 2) {
        const pp = evenShares(amt, 2); const a = members[ri(nMembers)]; let b = members[ri(nMembers)]; if (b === a) b = members[(members.indexOf(a) + 1) % nMembers];
        payers.push({ expense_id: id, user_id: a, guest_id: null, paid_cents: pp[0] });
        payers.push({ expense_id: id, user_id: b, guest_id: null, paid_cents: pp[1] });
      }
    }
    const nSet = ri(6);
    const settlements: any[] = [];
    for (let s = 0; s < nSet; s++) {
      const from = members[ri(nMembers)]; let to = members[ri(nMembers)]; if (to === from) to = members[(members.indexOf(from) + 1) % nMembers];
      settlements.push({ from_user_id: from, to_user_id: to, amount_cents: 100 + ri(20000), event_id: buckets[ri(buckets.length)], status: rnd() < 0.3 ? "pending" : "confirmed" });
    }
    const confirmed = settlements.filter((x) => x.status === "confirmed");

    try {
      // INV 1: conservation — confirmed balances sum to 0
      const bal = computeBalances(expenses, shares, confirmed, guests as any, payers);
      const sum = Object.values(bal).reduce((a, b) => a + b, 0);
      if (sum !== 0) throw new Error(`conservation broken: sum=${sum}`);

      // INV 2: personLedger reconciles to balance for every member (same settlement set)
      for (const m of members) {
        const led = personLedger(m, expenses, shares, confirmed, guests as any, payers, (u) => u || "?");
        if (led.total !== (bal[m] || 0)) throw new Error(`ledger mismatch for ${m}: ${led.total} vs ${bal[m] || 0}`);
      }

      // INV 3: eventNet per bucket sums to 0
      for (const b of buckets) {
        const en = eventNet(b as any, expenses, shares, guests as any, payers);
        const s = en.perMember.reduce((a, x) => a + x.net, 0);
        if (s !== 0) throw new Error(`eventNet not zero for bucket ${b}: ${s}`);
      }

      // INV 4: withinEventDebts sums to member's within-bucket owed, exactly, all positive
      for (const b of buckets) {
        const en = eventNet(b as any, expenses, shares, guests as any, payers);
        for (const pm of en.perMember) {
          if (pm.net < 0) {
            const debts = withinEventDebts(b, pm.member_id, expenses, shares, guests as any, payers);
            const dsum = debts.reduce((a, x) => a + x.amount, 0);
            if (dsum !== -pm.net) throw new Error(`withinEventDebts sum ${dsum} != owed ${-pm.net} (bucket ${b}, ${pm.member_id})`);
            if (debts.some((x) => x.amount <= 0)) throw new Error(`withinEventDebts non-positive amount`);
          }
        }
      }

      // INV 5: eventSettlement — anyone globally square (net>=0) never blocks a bucket
      const settle = eventSettlement({ events: events as any, expenses, shares, payers, settlements, guests: guests as any });
      const allSquare = members.every((m) => (bal[m] || 0) === 0);
      if (allSquare) {
        for (const b of buckets) { const key = b ?? ""; if (settle[key] && !settle[key].settled) throw new Error(`bucket ${key} unsettled though everyone globally square`); }
      }
      // covered never exceeds owed
      for (const k of Object.keys(settle)) if (settle[k].covered > settle[k].owed) throw new Error(`covered>owed for ${k}`);

      // INV 6: simplify conserves & zeroes
      const tr = simplify(bal);
      const appl: Record<string, number> = { ...bal };
      for (const t of tr) { appl[t.from] += t.amt; appl[t.to] -= t.amt; }
      if (Object.values(appl).reduce((a, b) => a + Math.abs(b), 0) !== 0) throw new Error(`simplify didn't zero balances`);
      if (tr.some((t) => t.amt <= 0)) throw new Error(`simplify non-positive transfer`);
    } catch (err: any) {
      fuzzFails++;
      if (fuzzFails <= 3) console.log(`  FUZZ FAIL seed ${1000 + iter}: ${err.message}`);
    }
  }
  check(`fuzz: ${iterations} random ledgers, all invariants hold`, fuzzFails, 0);
}


// ---- settlement allocation (expense-level ledger) ----
{
  const exp = [
    { id: "e1", event_id: "E", payer_user_id: "A", amount_cents: 6000, created_at: "2026-05-01T00:00:00Z" },
    { id: "e2", event_id: "E", payer_user_id: "A", amount_cents: 4000, created_at: "2026-05-02T00:00:00Z" },
  ];
  const sh = [
    { expense_id: "e1", user_id: "A", guest_id: null, share_cents: 3000 },
    { expense_id: "e1", user_id: "B", guest_id: null, share_cents: 3000 },
    { expense_id: "e2", user_id: "A", guest_id: null, share_cents: 2000 },
    { expense_id: "e2", user_id: "B", guest_id: null, share_cents: 2000 },
  ];
  const alloc = allocateSettlement("B", "A", "E", 5000, exp as any, sh as any, [], []);
  check("alloc sums to payment", alloc.reduce((s, a) => s + a.amount_cents, 0), 5000);
  ok("alloc is FIFO (e1 first)", alloc[0].expense_id === "e1");
  check("alloc e1 = B's $30 share", alloc[0].amount_cents, 3000);
  ok("all alloc lines positive", alloc.every((a) => a.amount_cents > 0));

  const alloc2 = allocateSettlement("B", "C", null, 5000, exp as any, sh as any, [], []);
  ok("unmappable payment -> general (null) line", alloc2.length === 1 && alloc2[0].expense_id === null);
  check("general line sums to payment", alloc2[0].amount_cents, 5000);

  const st = [{ id: "s1", from_user_id: "B", to_user_id: "A", amount_cents: 5000, event_id: null, status: "confirmed" }];
  const allocRows = alloc.map((a) => ({ settlement_id: "s1", expense_id: a.expense_id, amount_cents: a.amount_cents }));
  const ev = [
    { id: "E", group_id: "g", name: "E", event_date: "2026-05-01", event_type: "manual", status: "open" },
    { id: "F", group_id: "g", name: "F", event_date: "2026-06-01", event_type: "manual", status: "open" },
  ];
  const before = eventSettlement({ events: ev as any, expenses: exp as any, shares: sh as any, payers: [], settlements: st as any, guests: [], allocations: allocRows });
  ok("E settled via allocations", before["E"].settled);
  const expMoved = exp.map((e) => (e.id === "e2" ? { ...e, event_id: "F" } : e));
  const after = eventSettlement({ events: ev as any, expenses: expMoved as any, shares: sh as any, payers: [], settlements: st as any, guests: [], allocations: allocRows });
  ok("after move: E still settled", after["E"].settled);
  ok("after move: F settled (coverage followed the expense)", after["F"].settled);
}


// ---- REGRESSION (App Testing live): an event-tagged payment's GENERAL remainder must count toward
// that event. Amit owes Jonny $50.33 net in event E (sole creditor); only $42 maps to Jonny's Food
// expense, $8.33 is a netting remainder → general. The full $50.33 must count as E coverage. ----
{
  const ev = [{ id: "E", group_id: "g", name: "E", event_date: null, event_type: "manual", status: "open" }];
  const exp = [
    { id: "beer", event_id: "E", payer_user_id: "ameya", amount_cents: 5500, created_at: "2026-07-16T03:16:00Z" },
    { id: "food", event_id: "E", payer_user_id: "jonny", amount_cents: 16800, created_at: "2026-07-16T03:16:40Z" },
    { id: "tip",  event_id: "E", payer_user_id: "amit",  amount_cents: 2000,  created_at: "2026-07-16T03:17:00Z" },
  ];
  const sh = [
    { expense_id: "beer", user_id: "ameya", guest_id: null, share_cents: 1834 },
    { expense_id: "beer", user_id: "amit",  guest_id: null, share_cents: 1833 },
    { expense_id: "beer", user_id: "jonny", guest_id: null, share_cents: 1833 },
    { expense_id: "food", user_id: "ameya", guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "amit",  guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "jonny", guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "monica",guest_id: null, share_cents: 4200 },
    { expense_id: "tip",  user_id: "amit",  guest_id: null, share_cents: 1000 },
    { expense_id: "tip",  user_id: "jonny", guest_id: null, share_cents: 1000 },
  ];
  const st = [{ id: "s1", from_user_id: "amit", to_user_id: "jonny", amount_cents: 5033, event_id: "E", status: "confirmed" }];
  const al = [{ settlement_id: "s1", expense_id: "food", amount_cents: 4200 }, { settlement_id: "s1", expense_id: null, amount_cents: 833 }];
  const res = eventSettlement({ events: ev as any, expenses: exp as any, shares: sh as any, payers: [], settlements: st as any, guests: [], allocations: al });
  // Amit fully paid (42 mapped + 8.33 general, both toward E) → covered counts his full 5033; only
  // Ameya (5.34) and Monica (42) remain unpaid (neither globally square here).
  check("event-tagged general remainder counts toward the event", res["E"].covered, 5033);
  ok("event still open (Ameya/Monica unpaid)", res["E"].settled === false);
}


// ---- eventStandings: summary reflects payments (App Testing E: after Amit pays, he drops off) ----
{
  const exp = [
    { id: "beer", event_id: "E", payer_user_id: "ameya", amount_cents: 5500 },
    { id: "food", event_id: "E", payer_user_id: "jonny", amount_cents: 16800 },
    { id: "tip",  event_id: "E", payer_user_id: "amit",  amount_cents: 2000 },
  ];
  const sh = [
    { expense_id: "beer", user_id: "ameya", guest_id: null, share_cents: 1834 },
    { expense_id: "beer", user_id: "amit",  guest_id: null, share_cents: 1833 },
    { expense_id: "beer", user_id: "jonny", guest_id: null, share_cents: 1833 },
    { expense_id: "food", user_id: "ameya", guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "amit",  guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "jonny", guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "monica",guest_id: null, share_cents: 4200 },
    { expense_id: "tip",  user_id: "amit",  guest_id: null, share_cents: 1000 },
    { expense_id: "tip",  user_id: "jonny", guest_id: null, share_cents: 1000 },
  ];
  const st = [{ id: "s1", from_user_id: "amit", to_user_id: "jonny", amount_cents: 5033, event_id: "E", status: "confirmed" }];
  const al = [{ settlement_id: "s1", expense_id: "food", amount_cents: 4200 }, { settlement_id: "s1", expense_id: null, amount_cents: 833 }];
  const stand = eventStandings("E", exp as any, sh as any, [], [], st as any, al);
  const byId: Record<string, any> = {}; stand.forEach((x) => (byId[x.member_id] = x));
  ok("Amit no longer owes in the summary after paying", !byId["amit"]);
  check("Ameya still owes 5.34", byId["ameya"]?.owes || 0, 534);
  check("Monica still owes 42 (unpaid)", byId["monica"]?.owes || 0, 4200);
  check("Jonny still to receive 47.34", byId["jonny"]?.gets || 0, 4734);
  const owes = stand.reduce((a, x) => a + x.owes, 0), gets = stand.reduce((a, x) => a + x.gets, 0);
  check("standings balance (owes == gets)", owes, gets);
}


// ---- REGRESSION (unmark): a net-creditor member must NOT inflate "covered" with no real payment.
// App Testing E + F, NO settlements. Monica is a global creditor (fronted F's Golf). E covered must be 0. ----
{
  const ev = [
    { id: "E", group_id: "g", name: "E", event_date: null, event_type: "manual", status: "open" },
    { id: "F", group_id: "g", name: "F", event_date: null, event_type: "manual", status: "open" },
  ];
  const exp = [
    { id: "food", event_id: "E", payer_user_id: "jonny",  amount_cents: 16800 },
    { id: "golf", event_id: "F", payer_user_id: "monica", amount_cents: 85500 },
  ];
  const sh = [
    { expense_id: "food", user_id: "amit",  guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "jonny", guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "monica",guest_id: null, share_cents: 4200 },
    { expense_id: "food", user_id: "ameya", guest_id: null, share_cents: 4200 },
    { expense_id: "golf", user_id: "amit",  guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "jonny", guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "monica",guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "ameya", guest_id: null, share_cents: 21375 },
  ];
  const res = eventSettlement({ events: ev as any, expenses: exp as any, shares: sh as any, payers: [], settlements: [], guests: [], allocations: [] });
  check("no payments → E covered is 0 (net creditor does not inflate)", res["E"].covered, 0);
  ok("E not settled with no payments", res["E"].settled === false);
}


// ---- REGRESSION (settle asks remaining, not raw): App Testing F. Amit's raw F debt is 188.75 but he
// already paid 170.42 (parent-level, coverage on Golf). Re-settling must ask for 18.33, not 188.75. ----
{
  const exp = [
    { id: "golf", event_id: "F", payer_user_id: "monica", amount_cents: 85500 },
    { id: "cart", event_id: "F", payer_user_id: "amit",   amount_cents: 6500 },
    { id: "beer", event_id: "F", payer_user_id: "ameya",  amount_cents: 5500 },
  ];
  const sh = [
    { expense_id: "golf", user_id: "ameya", guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "amit",  guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "jonny", guest_id: null, share_cents: 21375 },
    { expense_id: "golf", user_id: "monica",guest_id: null, share_cents: 21375 },
    { expense_id: "cart", user_id: "ameya", guest_id: null, share_cents: 2167 },
    { expense_id: "cart", user_id: "amit",  guest_id: null, share_cents: 2167 },
    { expense_id: "cart", user_id: "monica",guest_id: null, share_cents: 2166 },
    { expense_id: "beer", user_id: "ameya", guest_id: null, share_cents: 1834 },
    { expense_id: "beer", user_id: "amit",  guest_id: null, share_cents: 1833 },
    { expense_id: "beer", user_id: "jonny", guest_id: null, share_cents: 1833 },
  ];
  const pay = [
    { expense_id: "golf", user_id: "monica", guest_id: null, paid_cents: 85500 },
    { expense_id: "cart", user_id: "amit",   guest_id: null, paid_cents: 6500 },
    { expense_id: "beer", user_id: "ameya",  guest_id: null, paid_cents: 5500 },
  ];
  const st = [{ id: "s2", from_user_id: "amit", to_user_id: "monica", amount_cents: 17042, event_id: null, status: "confirmed" }];
  const al = [{ settlement_id: "s2", expense_id: "golf", amount_cents: 17042 }];
  const rem = withinEventDebtsRemaining("F", "amit", exp as any, sh as any, [], pay as any, st as any, al);
  const total = rem.reduce((a, r) => a + r.amount, 0);
  check("settle asks remaining 18.33, not raw 188.75", total, 1833);
  ok("remaining is owed to Monica", rem.length === 1 && rem[0].to === "monica");
  // and raw withinEventDebts (no payments) would have been 188.75 — proving the difference
  check("raw within-event debt was 188.75", withinEventDebts("F", "amit", exp as any, sh as any, [], pay as any).reduce((a, r) => a + r.amount, 0), 18875);
}

console.log(`\n=== money.test ===\nPASS ${pass}  FAIL ${fail}`);
