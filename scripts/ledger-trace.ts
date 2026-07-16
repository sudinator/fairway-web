// Live ledger trace. Feeds a DB dump (from scripts/ledger-dump.sql) through the REAL lib/money.ts
// functions so we see exactly what the app computes: overall balances, simplified transfers, per-event
// settled-state, and the payment→expense allocations. Usage: node ledger-trace.js <dump.json>
import * as fs from "fs";
import {
  computeBalances, simplify, expensesByEvent, eventSettlement, eventNet, personLedger, fmtUSD,
} from "../lib/money";

const file = process.argv[2];
if (!file) { console.error("usage: ledger-trace <dump.json>"); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const d: any = raw.ledger || raw.data || raw;

const members: any[] = d.members || [];
const expenses: any[] = d.expenses || [];
const shares: any[] = d.shares || [];
const payers: any[] = d.payers || [];
const settlements: any[] = (d.settlements || []).map((s: any) => ({ ...s }));
const allocations: any[] = d.allocations || [];
const events: any[] = d.events || [];
const guests: any[] = d.guests || [];
const confirmed = settlements.filter((s) => (s.status || "confirmed") === "confirmed");
const nameOf = (id: string | null | undefined) =>
  (members.find((m) => m.id === id)?.display_name) || (id ? String(id).slice(0, 8) : "?");
const expName = (id: string | null | undefined) => {
  if (!id) return "(general — unattributed)";
  const e = expenses.find((x) => x.id === id);
  return e ? (e.description || id.slice(0, 8)) : id.slice(0, 8);
};

console.log(`\n============================================================`);
console.log(`LEDGER TRACE — ${d.group?.name || "group"}`);
console.log(`members ${members.length} · expenses ${expenses.length} · settlements ${settlements.length} (${confirmed.length} confirmed) · allocations ${allocations.length} · events ${events.length} · guests ${guests.length}`);
console.log(`============================================================`);

// ---- overall balances (the numbers the app's banner/balances use) ----
const bal = computeBalances(expenses as any, shares as any, confirmed as any, guests as any, payers as any);
console.log(`\n-- OVERALL BALANCES (confirmed payments only) --`);
let sq: string[] = [];
for (const m of members) {
  const c = bal[m.id] || 0;
  if (c === 0) { sq.push(nameOf(m.id)); continue; }
  console.log(`   ${nameOf(m.id).padEnd(18)} ${c > 0 ? "is owed" : "owes   "} ${fmtUSD(Math.abs(c))}`);
}
if (sq.length) console.log(`   (square: ${sq.join(", ")})`);
const conserve = Object.values(bal).reduce((a: number, b: any) => a + b, 0);
console.log(`   [conservation check: sum of all balances = ${conserve} (must be 0)]`);

// ---- simplified transfers ----
const tr = simplify(bal);
console.log(`\n-- SIMPLIFIED "WHO PAYS WHOM" --`);
if (!tr.length) console.log("   (all settled)");
tr.forEach((t) => console.log(`   ${nameOf(t.from)} → ${nameOf(t.to)}   ${fmtUSD(t.amt)}`));

// ---- per event ----
const settle = eventSettlement({ events: events as any, expenses: expenses as any, shares: shares as any, payers: payers as any, settlements: settlements as any, guests: guests as any, allocations });
console.log(`\n-- EVENTS --`);
const keys = Object.keys(settle).sort((a, b) => (settle[a].date || 0) - (settle[b].date || 0));
for (const k of keys) {
  const ev = k ? events.find((e) => e.id === k) : null;
  const label = ev ? `${ev.name} [${ev.status}]` : "Ungrouped";
  const st = settle[k];
  const verdict = st.settled ? "SETTLED ✓" : `owes ${fmtUSD(st.owed - st.covered)}  (owed ${fmtUSD(st.owed)}, covered ${fmtUSD(st.covered)})`;
  console.log(`\n   ▸ ${label} — ${verdict}`);
  expenses.filter((e) => (e.event_id ?? null) === (k || null)).forEach((e) =>
    console.log(`       · ${(e.description || "expense")}  ${fmtUSD(e.amount_cents)}  paid by ${nameOf(e.payer_user_id)}`));
  const en = eventNet((k || null) as any, expenses as any, shares as any, guests as any, payers as any);
  en.perMember.filter((m) => m.net !== 0).sort((a, b) => a.net - b.net).forEach((m) =>
    console.log(`       ${nameOf(m.member_id).padEnd(18)} ${m.net < 0 ? "owes" : "gets"} ${fmtUSD(Math.abs(m.net))}`));
}

// ---- payment allocations (dispute tracing) ----
if (allocations.length) {
  console.log(`\n-- PAYMENT ALLOCATIONS (each payment → the expenses it cleared) --`);
  for (const s of settlements) {
    const al = allocations.filter((a) => a.settlement_id === s.id);
    if (!al.length) continue;
    console.log(`   ${nameOf(s.from_user_id)} → ${nameOf(s.to_user_id)}  ${fmtUSD(s.amount_cents)}  [${s.status || "confirmed"}]`);
    al.forEach((a) => console.log(`       ${fmtUSD(a.amount_cents)} → ${expName(a.expense_id)}`));
  }
} else {
  console.log(`\n-- PAYMENT ALLOCATIONS -- (none yet — pre-0118, or no payments recorded)`);
}
console.log("");
