// Unit tests for lib/money.ts — run with `npm test`.
import {
  evenShares, validateCustomTotal, computeBalances, simplify, pairwiseDebts, aggregateOwed,
  payLink, nudgeSms, fmtUSD, guestOwedFor, guestCoverageBySponsor, betResultToPost,
  collapseAuditBursts, auditVersionsByExpense, eventNet, expensesByEvent,
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
  check("event nets sum to zero (balanced)", en.perMember.reduce((s, m) => s + m.net, 0), 0);
  ok("balanced flag true", en.balanced);
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
  ok("guest event still balances", gen.balanced);
}

console.log(`\n=== money.test ===\nPASS ${pass}  FAIL ${fail}`);
if (fails.length) { console.log("\n" + fails.join("\n\n")); process.exit(1); }
console.log("All assertions passed.");
