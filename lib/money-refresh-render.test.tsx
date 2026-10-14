/**
 * Review finding 5 (206.1): a failed money refresh must not blank or half-replace the ledger.
 * Real MoneyTab, real Supabase client, network intercepted: load 1 succeeds (one $90 expense, one
 * settlement); load 2 fails on settlements. Before the fix the expense list emptied / settlements
 * vanished; now the last complete figures stay, a notice shows, and settling is blocked.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { MoneyTab } from "@/components/money";

const G = "g0000000-0000-0000-0000-000000000001", ME = "u0000000-0000-0000-0000-000000000001", YOU = "u0000000-0000-0000-0000-000000000002";
let failSettlements = false;
const rows: Record<string, unknown[]> = {
  group_members: [{ user_id: ME, role: "member", status: "active" }, { user_id: YOU, role: "member", status: "active" }],
  profiles: [{ id: ME, display_name: "Amit Sud" }, { id: YOU, display_name: "Karan Sarin" }],
  group_guests: [],
  expenses: [{ id: "e1", group_id: G, description: "Saturday skins", amount_cents: 9000, payer_user_id: YOU, created_by: YOU, created_at: "2026-10-01T12:00:00Z", deleted_at: null, category: "bet" }],
  expense_shares: [{ expense_id: "e1", user_id: ME, share_cents: 4500 }, { expense_id: "e1", user_id: YOU, share_cents: 4500 }],
  expense_payers: [{ expense_id: "e1", user_id: YOU, paid_cents: 9000 }],
  settlements: [{ id: "s1", group_id: G, from_user_id: ME, to_user_id: YOU, amount_cents: 4500, status: "confirmed", created_at: "2026-10-02T12:00:00Z" }],
  settlement_allocations: [], group_activity: [], money_audit: [], group_events: [],
  group_pay_roster: [{ id: ME, display_name: "Amit Sud" }, { id: YOU, display_name: "Karan Sarin" }],
};
(globalThis as any).fetch = async (input: any) => {
  const url = String(input?.url ?? input);
  const m = url.match(/\/rest\/v1\/(?:rpc\/)?([a-z_]+)/);
  const table = m?.[1] || "";
  if (table === "settlements" && failSettlements) return new Response(JSON.stringify({ code: "57014", message: "canceling statement due to statement timeout" }), { status: 500, headers: { "content-type": "application/json" } });
  const body = url.includes("deleted_at=not.is.null") ? [] : (rows[table] ?? []);
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};

let bump: () => void = () => {};
function Wrap() {
  const [n, setN] = React.useState(0);
  bump = () => setN((x) => x + 1);
  const onChanged = React.useMemo(() => () => { void n; }, [n]);
  return <MoneyTab user={{ id: ME }} activeGroup={{ id: G, name: "Club" }} onChanged={onChanged} initialTab="balances" />;
}
const settle = (ms = 120) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

(async () => {
  const s = renderScreen(<Wrap />);
  await settle();
  const before = s.el.textContent || "";
  const settledCount = (t: string) => (t.match(/settled/g) || []).length;
  ok(before.includes("Saturday skins") && settledCount(before) >= 2, "first load: the $90 expense, both golfers settled");
  ok(!s.el.querySelector("[data-money-stale]"), "no stale notice after a complete load");
  failSettlements = true;
  act(() => bump());
  await settle();
  const after = s.el.textContent || "";
  ok(after.includes("Saturday skins"), "a failed refresh keeps the expense");
  ok(settledCount(after) >= 2 && !/\$45/.test(after.split("Expenses by Bucket")[0]), "a failed settlements refresh does NOT show Amit owing $45 he already paid");
  ok(!!s.el.querySelector("[data-money-stale]"), "a notice says the refresh failed");
  ok(after.includes("Settling is paused"), "settling is paused");
  failSettlements = false;
  act(() => bump());
  await settle();
  ok(!s.el.querySelector("[data-money-stale]"), "a complete refresh clears the notice");
  try { s.unmount(); } catch { /* jsdom */ }
  report("money refresh");
})().catch((e) => { console.error(e); process.exit(1); });
