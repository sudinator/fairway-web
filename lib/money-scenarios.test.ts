// ============================================================================
// MONEY SCENARIO & WORKFLOW SUITE
// Two kinds of testing, per the plan:
//   (1) MATH LOGIC — invariants that must hold for any ledger state.
//   (2) PROCESS/WORKFLOW — real action sequences (add → settle → unmark → move →
//       close → reopen → edit) driven through the SAME functions the app uses,
//       asserting the derived state after every step; plus a random-workflow fuzzer.
// Run: compiled with the other lib tests. Prints every scenario it exercised.
// ============================================================================
import {
  computeBalances, eventNet, withinEventDebts, allocateSettlement, eventSettlement,
  eventStandings, simplify, fmtUSD,
} from "./money";

let pass = 0, fail = 0;
const scenarios: string[] = [];
function ok(name: string, cond: boolean) { if (cond) pass++; else { fail++; console.log("  ✗ " + name); } }
function eq(name: string, got: any, want: any) { ok(name + ` (got ${got}, want ${want})`, got === want); }
function scenario(s: string) { scenarios.push(s); }

// ---------------------------------------------------------------------------
// World harness — mirrors the app's data model + the exact mutations it performs.
// ---------------------------------------------------------------------------
type World = { expenses: any[]; shares: any[]; payers: any[]; settlements: any[]; allocations: any[]; events: any[]; guests: any[] };
let idc = 0;
const nid = (p: string) => p + "_" + (++idc);
function W(): World { return { expenses: [], shares: [], payers: [], settlements: [], allocations: [], events: [], guests: [] }; }
function addEvent(w: World, name = "ev"): string { const id = nid("ev"); w.events.push({ id, group_id: "g", name, event_date: null, event_type: "manual", status: "open" }); return id; }
function addGuest(w: World, sponsor: string): string { const id = nid("g"); w.guests.push({ id, sponsor_user_id: sponsor }); return id; }

// add expense: split = list of {member?, guest?, cents}; payer is a member (or multi via payerSplit)
function addExpense(w: World, event: string | null, payer: string, split: { m?: string; g?: string; cents: number }[]): string {
  const id = nid("e"); const amount = split.reduce((a, s) => a + s.cents, 0);
  idc++; w.expenses.push({ id, event_id: event, payer_user_id: payer, amount_cents: amount, description: "exp", created_at: new Date(1_700_000_000_000 + idc * 1000).toISOString() });
  w.payers.push({ expense_id: id, user_id: payer, guest_id: null, paid_cents: amount });
  for (const s of split) w.shares.push({ expense_id: id, user_id: s.m ?? null, guest_id: s.g ?? null, sponsor_user_id: s.g ? (w.guests.find((x) => x.id === s.g)?.sponsor_user_id) : null, share_cents: s.cents });
  return id;
}
// SETTLE an event for `from` — mirrors armSettle + record_settlement (per-fronter debt + FIFO allocations)
function settleEvent(w: World, from: string, event: string | null): string[] {
  const ids: string[] = [];
  for (const d of withinEventDebts(event, from, w.expenses as any, w.shares as any, w.guests as any, w.payers as any)) {
    const sid = nid("s");
    const allocs = allocateSettlement(from, d.to, event, d.amount, w.expenses as any, w.shares as any, w.guests as any, w.payers as any);
    w.settlements.push({ id: sid, group_id: "g", from_user_id: from, to_user_id: d.to, amount_cents: d.amount, event_id: event, status: "confirmed" });
    for (const a of allocs) w.allocations.push({ settlement_id: sid, expense_id: a.expense_id, amount_cents: a.amount_cents });
    ids.push(sid);
  }
  return ids;
}
function unmark(w: World, sid: string) { w.settlements = w.settlements.filter((s) => s.id !== sid); w.allocations = w.allocations.filter((a) => a.settlement_id !== sid); } // cascade
function moveExpense(w: World, eid: string, toEvent: string | null) { const e = w.expenses.find((x) => x.id === eid); if (e) e.event_id = toEvent; }
function setClosed(w: World, event: string, closed: boolean) { const e = w.events.find((x) => x.id === event); if (e) e.status = closed ? "closed" : "open"; }

const confirmed = (w: World) => w.settlements.filter((s) => (s.status || "confirmed") === "confirmed");

// ---------------------------------------------------------------------------
// Invariants that must hold in ANY state
// ---------------------------------------------------------------------------
function checkInvariants(w: World, tag: string) {
  const bal = computeBalances(w.expenses as any, w.shares as any, confirmed(w) as any, w.guests as any, w.payers as any);
  eq(`[${tag}] conservation (balances sum 0)`, Object.values(bal).reduce((a: number, b: any) => a + b, 0), 0);
  const settle = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  for (const k of Object.keys(settle)) {
    ok(`[${tag}] covered<=owed for bucket ${k}`, settle[k].covered <= settle[k].owed);
    ok(`[${tag}] covered>=0`, settle[k].covered >= 0);
    const evId = k === "" ? null : k;
    const stand = eventStandings(evId, w.expenses as any, w.shares as any, w.guests as any, w.payers as any, w.settlements as any, w.allocations);
    const owes = stand.reduce((a, x) => a + x.owes, 0), gets = stand.reduce((a, x) => a + x.gets, 0);
    eq(`[${tag}] standings balance bucket ${k}`, owes, gets);
    ok(`[${tag}] standings non-negative`, stand.every((x) => x.owes >= 0 && x.gets >= 0));
  }
  // allocations always sum to their settlement
  for (const s of w.settlements) {
    const sum = w.allocations.filter((a) => a.settlement_id === s.id).reduce((x, a) => x + a.amount_cents, 0);
    if (w.allocations.some((a) => a.settlement_id === s.id)) eq(`[${tag}] alloc sums to payment ${s.id}`, sum, s.amount_cents);
  }
}

// ===========================================================================
// PROCESS / WORKFLOW SCENARIOS
// ===========================================================================

// W1 — settle an event fully → settled, standings empty, covered==owed
{
  scenario("W1: add expenses to an event, each ower settles → event fully settled");
  const w = W(); const E = addEvent(w);
  addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]); // B owes A 50
  addExpense(w, E, "A", [{ m: "A", cents: 2000 }, { m: "B", cents: 2000 }]); // B owes A 20
  checkInvariants(w, "W1.before");
  settleEvent(w, "B", E);
  checkInvariants(w, "W1.after");
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W1: event settled after B pays", s[E].settled);
  eq("W1: covered == owed", s[E].covered, s[E].owed);
  eq("W1: standings empty", eventStandings(E, w.expenses as any, w.shares as any, w.guests as any, w.payers as any, w.settlements as any, w.allocations).length, 0);
}

// W2 — settle then UNMARK returns to original (the bug found live)
{
  scenario("W2: settle an event, then unmark → returns EXACTLY to pre-payment state");
  const w = W(); const E = addEvent(w);
  addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]);
  const before = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations })[E];
  const ids = settleEvent(w, "B", E);
  ids.forEach((id) => unmark(w, id));
  const after = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations })[E];
  eq("W2: covered back to 0", after.covered, 0);
  eq("W2: owed unchanged", after.owed, before.owed);
  ok("W2: not settled after unmark", after.settled === false);
  checkInvariants(w, "W2");
}

// W3 — settle event, then MOVE a settled expense into another event → coverage follows
{
  scenario("W3: settle event E, move a settled expense to event F → coverage follows the expense; both correct");
  const w = W(); const E = addEvent(w), F = addEvent(w);
  const e1 = addExpense(w, E, "A", [{ m: "A", cents: 3000 }, { m: "B", cents: 3000 }]); // B owes A 30 (e1)
  addExpense(w, E, "A", [{ m: "A", cents: 2000 }, { m: "B", cents: 2000 }]);            // B owes A 20 (e2)
  settleEvent(w, "B", E);
  checkInvariants(w, "W3.settled");
  moveExpense(w, e1, F);
  checkInvariants(w, "W3.moved");
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W3: E still settled after move", s[E].settled);
  ok("W3: F settled (coverage followed e1)", s[F].settled);
}

// W4 — owe in two events, settle only one (dispute case) → that one settled, other open
{
  scenario("W4: owe in two events, settle only one → settled/open are independent (dispute preserved)");
  const w = W(); const E = addEvent(w), F = addEvent(w);
  addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]); // B owes A 50 in E
  addExpense(w, F, "A", [{ m: "A", cents: 4000 }, { m: "B", cents: 4000 }]); // B owes A 40 in F
  settleEvent(w, "B", E);
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W4: E settled", s[E].settled);
  ok("W4: F still open", s[F].settled === false);
  checkInvariants(w, "W4");
}

// W5 — net creditor overall who owes a share in another event → NO phantom covered (bug found live)
{
  scenario("W5: net-creditor member (owed overall) owes a share in another event → must NOT show phantom 'covered'");
  const w = W(); const E = addEvent(w), F = addEvent(w);
  // Monica fronts a big F expense (net creditor overall); Monica also owes a share in E, unpaid.
  addExpense(w, F, "M", [{ m: "M", cents: 20000 }, { m: "A", cents: 20000 }]); // A owes M 200 (F)
  addExpense(w, E, "J", [{ m: "J", cents: 4200 }, { m: "M", cents: 4200 }]);    // M owes J 42 (E), unpaid
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  eq("W5: E covered is 0 (no phantom from creditor)", s[E].covered, 0);
  ok("W5: E not settled", s[E].settled === false);
  checkInvariants(w, "W5");
}

// W6 — everyone globally square via cross-event netting → all events show settled (Livingston/global-square)
{
  scenario("W6: everyone globally square (net 0) via untagged payments → every event shows settled");
  const w = W(); const E = addEvent(w);
  addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]); // B owes A 50
  // B settles via a GLOBAL (untagged) payment — mirrors old Settle-tab payment → general allocation
  const sid = nid("s"); w.settlements.push({ id: sid, group_id: "g", from_user_id: "B", to_user_id: "A", amount_cents: 5000, event_id: null, status: "confirmed" });
  w.allocations.push({ settlement_id: sid, expense_id: null, amount_cents: 5000 }); // general (as 0118 backfill would)
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W6: event settled via global-square", s[E].settled);
  checkInvariants(w, "W6");
}

// W7 — re-mark after unmark restores coverage
{
  scenario("W7: settle → unmark → settle again → coverage restored, event settled");
  const w = W(); const E = addEvent(w);
  addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]);
  const ids = settleEvent(w, "B", E); ids.forEach((id) => unmark(w, id)); settleEvent(w, "B", E);
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W7: settled after re-mark", s[E].settled);
  checkInvariants(w, "W7");
}

// W8 — GUEST expense: settle routes to sponsor; standings resolve to sponsor
{
  scenario("W8: guest expense — settling resolves to the guest's sponsor");
  const w = W(); const E = addEvent(w); const guest = addGuest(w, "A"); // guest sponsored by A
  addExpense(w, E, "B", [{ m: "B", cents: 3000 }, { g: guest, cents: 3000 }]); // A (sponsor) owes B 30
  const s0 = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W8: event owes before settle", s0[E].settled === false);
  settleEvent(w, "A", E); // sponsor A settles
  const s1 = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W8: settled after sponsor pays", s1[E].settled);
  checkInvariants(w, "W8");
}

// W9 — MULTI-PAYER expense: two people front, one ower settles proportionally
{
  scenario("W9: multi-payer expense — ower settles; allocations/coverage consistent");
  const w = W(); const E = addEvent(w);
  const id = nid("e"); idc++;
  w.expenses.push({ id, event_id: E, payer_user_id: "A", amount_cents: 9000, description: "exp", created_at: new Date(1_700_000_500_000).toISOString() });
  w.payers.push({ expense_id: id, user_id: "A", guest_id: null, paid_cents: 6000 });
  w.payers.push({ expense_id: id, user_id: "B", guest_id: null, paid_cents: 3000 });
  w.shares.push({ expense_id: id, user_id: "A", guest_id: null, share_cents: 3000 });
  w.shares.push({ expense_id: id, user_id: "B", guest_id: null, share_cents: 3000 });
  w.shares.push({ expense_id: id, user_id: "C", guest_id: null, share_cents: 3000 });
  checkInvariants(w, "W9.before");
  settleEvent(w, "C", E);
  checkInvariants(w, "W9.after");
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W9: settled after C pays both fronters", s[E].settled);
}

// W10 — EDIT (increase) an expense after settling → event reopens (owes the delta)
{
  scenario("W10: settle event, then increase an expense → event shows the new shortfall (not settled)");
  const w = W(); const E = addEvent(w);
  const e1 = addExpense(w, E, "A", [{ m: "A", cents: 5000 }, { m: "B", cents: 5000 }]);
  settleEvent(w, "B", E);
  // increase B's share (edit): bump the expense + B's share by 2000
  const ex = w.expenses.find((x) => x.id === e1); ex.amount_cents += 2000;
  w.payers.find((p) => p.expense_id === e1).paid_cents += 2000;
  w.shares.find((sh) => sh.expense_id === e1 && sh.user_id === "B").share_cents += 2000;
  checkInvariants(w, "W10");
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W10: event not settled after increase", s[E].settled === false);
  ok("W10: shortfall shows in standings", eventStandings(E, w.expenses as any, w.shares as any, w.guests as any, w.payers as any, w.settlements as any, w.allocations).some((x) => x.member_id === "B" && x.owes === 2000));
}

// W11 — move a settled expense OUT of an event → coverage leaves with it (source no longer over-covered)
{
  scenario("W11: settle event, move a settled expense to Ungrouped → coverage leaves; source stays consistent");
  const w = W(); const E = addEvent(w);
  const e1 = addExpense(w, E, "A", [{ m: "A", cents: 3000 }, { m: "B", cents: 3000 }]);
  addExpense(w, E, "A", [{ m: "A", cents: 2000 }, { m: "B", cents: 2000 }]);
  settleEvent(w, "B", E);
  moveExpense(w, e1, null); // to Ungrouped
  checkInvariants(w, "W11");
  const s = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
  ok("W11: covered never exceeds owed after move-out (E)", s[E].covered <= s[E].owed);
  ok("W11: ungrouped covered<=owed", s[""].covered <= s[""].owed);
}

// ===========================================================================
// RANDOM WORKFLOW FUZZER — apply random action sequences, invariants must hold throughout
// ===========================================================================
{
  scenario("WF: 1500 random action sequences (add/settle/unmark/move/close/reopen) — invariants hold after EVERY step");
  function mulberry32(a: number) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  let fails = 0; const N = 1500;
  for (let iter = 0; iter < N; iter++) {
    const rnd = mulberry32(9000 + iter); const ri = (n: number) => Math.floor(rnd() * n);
    const w = W();
    const members = ["A", "B", "C", "D"].slice(0, 2 + ri(3));
    const evs: (string | null)[] = [null];
    for (let i = 0; i < 1 + ri(3); i++) evs.push(addEvent(w));
    const steps = 4 + ri(10);
    try {
      for (let st = 0; st < steps; st++) {
        const act = ri(5);
        if (act === 0 || w.expenses.length === 0) {
          // add expense: random payer, random subset split (even-ish)
          const ev = evs[ri(evs.length)]; const payer = members[ri(members.length)];
          const subset = members.filter(() => rnd() < 0.7); if (!subset.length) subset.push(members[ri(members.length)]);
          const per = 100 + ri(4000); const split = subset.map((m) => ({ m, cents: per }));
          // don't add into a closed event (mirrors the freeze)
          if (ev && w.events.find((e) => e.id === ev)?.status === "closed") continue;
          addExpense(w, ev, payer, split);
        } else if (act === 1) {
          const ev = evs[ri(evs.length)]; const from = members[ri(members.length)];
          if (ev && w.events.find((e) => e.id === ev)?.status === "closed") continue; // can't settle into closed
          settleEvent(w, from, ev);
        } else if (act === 2 && w.settlements.length) {
          // unmark a random settlement whose event is not closed
          const s = w.settlements[ri(w.settlements.length)];
          const ev = s.event_id ? w.events.find((e) => e.id === s.event_id) : null;
          if (ev && ev.status === "closed") continue;
          unmark(w, s.id);
        } else if (act === 3 && w.expenses.length) {
          const e = w.expenses[ri(w.expenses.length)];
          const src = e.event_id ? w.events.find((x) => x.id === e.event_id) : null;
          const dst = evs[ri(evs.length)]; const dstClosed = dst && w.events.find((x) => x.id === dst)?.status === "closed";
          if ((src && src.status === "closed") || dstClosed) continue; // freeze: no move in/out of closed
          moveExpense(w, e.id, dst);
        } else if (act === 4) {
          const real = evs.filter((x) => x) as string[];
          if (real.length) { const ev = real[ri(real.length)]; const e = w.events.find((x) => x.id === ev); e.status = e.status === "open" ? "closed" : "open"; }
        }
        checkInvariantsSilent(w, iter);
      }
    } catch (err: any) { fails++; if (fails <= 3) console.log(`  WF FAIL seed ${9000 + iter}: ${err.message}`); }
  }
  eq(`WF: ${N} random workflows, invariants held throughout`, fails, 0);

  function checkInvariantsSilent(w: World, seed: number) {
    const bal = computeBalances(w.expenses as any, w.shares as any, confirmed(w) as any, w.guests as any, w.payers as any);
    if (Object.values(bal).reduce((a: number, b: any) => a + b, 0) !== 0) throw new Error(`conservation broke (seed ${seed})`);
    const settle = eventSettlement({ events: w.events as any, expenses: w.expenses as any, shares: w.shares as any, payers: w.payers as any, settlements: w.settlements as any, guests: w.guests as any, allocations: w.allocations });
    for (const k of Object.keys(settle)) {
      if (settle[k].covered > settle[k].owed) throw new Error(`covered>owed bucket ${k} (seed ${seed})`);
      if (settle[k].covered < 0 || settle[k].owed < 0) throw new Error(`negative owed/covered (seed ${seed})`);
      const stand = eventStandings(k === "" ? null : k, w.expenses as any, w.shares as any, w.guests as any, w.payers as any, w.settlements as any, w.allocations);
      const owes = stand.reduce((a, x) => a + x.owes, 0), gets = stand.reduce((a, x) => a + x.gets, 0);
      if (owes !== gets) throw new Error(`standings unbalanced bucket ${k}: ${owes} vs ${gets} (seed ${seed})`);
      if (stand.some((x) => x.owes < 0 || x.gets < 0)) throw new Error(`negative standing (seed ${seed})`);
    }
    for (const s of w.settlements) {
      const als = w.allocations.filter((a) => a.settlement_id === s.id);
      if (als.length && als.reduce((x, a) => x + a.amount_cents, 0) !== s.amount_cents) throw new Error(`alloc sum != payment ${s.id} (seed ${seed})`);
    }
  }
}

console.log("\n=== money-scenarios ===");
console.log("Scenarios exercised:");
scenarios.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
console.log(`\nPASS ${pass}  FAIL ${fail}`);
if (fail > 0) { console.log("SCENARIO SUITE FAILED"); process.exit(1); }
