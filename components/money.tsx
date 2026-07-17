"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Avatar, btn, inputStyle, Eyebrow, FieldLabel, BottomSheet } from "@/components/ui";
import {
  computeBalances, evenShares, validateCustomTotal, guestCoverageBySponsor,
  fmtUSD, payLink, nudgeSms, auditVersionsByExpense, eventNet, expensesByEvent, personLedger, allocateSettlement, expenseImpact,
  bucketBalances, bucketTransfers, bucketSettled,
  type Expense, type Share, type Settlement, type Guest, type Payer,
  type AuditRow, type AuditVersion, type AuditSnapshot, type EventRow, type LedgerLine,
} from "@/lib/money";

const supabase = createClient();

type Member = { id: string; display_name: string; avatar_url?: string | null; venmo_handle?: string | null; paypal_handle?: string | null; zelle_handle?: string | null; phone?: string | null };
type SettlementRow = Settlement & { id: string; method?: string | null; created_by?: string | null; created_at?: string; event_id?: string | null; status?: "pending" | "confirmed" };
type GuestRow = Guest & { name: string; group_id: string; archived?: boolean; became_member_id?: string | null; source_game_id?: string | null; created_by?: string | null };
type ExpenseRow = Expense & { group_id: string; created_by: string | null; description: string; category: string; split_type: "even" | "custom"; created_at: string; event_id?: string | null };
type ShareRow = Share & { id: string };
type PayerRow = Payer & { id?: string };

const ini = (n: string) => n.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();

export function MoneyTab({ user, activeGroup, onChanged, initialTab }: { user: { id: string }; activeGroup: { id: string; name: string; role?: string }; onChanged?: () => void; initialTab?: "balances" | "add" | "settle" | "log" | null }) {
  const [screen, setScreen] = useState<"balances" | "add" | "settle" | "log" | "untangle">(initialTab ?? "balances");
  const [deletedExpenses, setDeletedExpenses] = useState<ExpenseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [allocations, setAllocations] = useState<{ settlement_id: string; expense_id: string | null; amount_cents: number }[]>([]);
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [viewingSnap, setViewingSnap] = useState<{ snapshot: AuditSnapshot; at?: string } | null>(null); // read-only view of a deleted expense
  const [ledgerFor, setLedgerFor] = useState<string | null>(null); // member whose balance breakdown is open
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [viewing, setViewing] = useState<ExpenseRow | null>(null);
  const isAdmin = activeGroup.role === "admin" || activeGroup.role === "owner";
  const gid = activeGroup.id;

  const load = useCallback(async () => {
    setLoading(true);
    // Full group roster via SECURITY DEFINER RPC (profiles RLS otherwise hides other members
    // from non-admins, collapsing the list to just yourself). Falls back to a direct query if
    // migration 0052 hasn't been run yet.
    let profs: any[] = [];
    const rpc = await supabase.rpc("group_pay_roster", { p_group: gid });
    if (!rpc.error && rpc.data) {
      profs = rpc.data as any[];
    } else {
      const { data: gm } = await supabase.from("group_members").select("user_id, status").eq("group_id", gid).eq("status", "active");
      const ids = (gm || []).map((m: any) => m.user_id).filter(Boolean);
      const { data: p2 } = ids.length
        ? await supabase.from("profiles").select("id, display_name, avatar_url, venmo_handle, paypal_handle, zelle_handle, phone").in("id", ids)
        : { data: [] as any[] };
      profs = p2 || [];
    }
    const { data: gRows } = await supabase.from("group_guests").select("id, name, sponsor_user_id, group_id, archived, became_member_id, source_game_id, created_by").eq("group_id", gid);
    const { data: exp } = await supabase.from("expenses").select("*").eq("group_id", gid).is("deleted_at", null).order("created_at", { ascending: false });
    const { data: delExp } = await supabase.from("expenses").select("*").eq("group_id", gid).not("deleted_at", "is", null).order("created_at", { ascending: false });
    setDeletedExpenses((delExp || []) as ExpenseRow[]);
    const expIds = (exp || []).map((e: any) => e.id);
    const { data: sh } = expIds.length
      ? await supabase.from("expense_shares").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: py } = expIds.length
      ? await supabase.from("expense_payers").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: setl } = await supabase.from("settlements").select("*").eq("group_id", gid);
    const { data: alloc } = await supabase.from("settlement_allocations").select("settlement_id, expense_id, amount_cents").eq("group_id", gid);
    const { data: act } = await supabase.from("group_activity").select("*").eq("group_id", gid).not("action", "like", "tt%").order("created_at", { ascending: false }).limit(200);
    const { data: aud } = await supabase.from("money_audit").select("id, expense_id, actor_id, action, snapshot, created_at").eq("group_id", gid).order("created_at", { ascending: true }).limit(1000);
    const { data: evs } = await supabase.from("group_events").select("*").eq("group_id", gid).order("created_at", { ascending: false });
    setMembers((profs || []).map((p: any) => ({ id: p.id, display_name: p.display_name || "Player", avatar_url: p.avatar_url, venmo_handle: p.venmo_handle, paypal_handle: p.paypal_handle, zelle_handle: p.zelle_handle, phone: p.phone })).sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })));
    setGuests(((gRows || []) as GuestRow[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
    setExpenses((exp || []) as ExpenseRow[]);
    setShares((sh || []) as ShareRow[]);
    setSettlements((setl || []) as SettlementRow[]);
    setAllocations((alloc || []) as any[]);
    setPayers((py || []) as PayerRow[]);
    setActivity((act || []) as any[]);
    setAuditRows((aud || []) as AuditRow[]);
    setEvents((evs || []) as EventRow[]);
    setLoading(false);
    onChanged?.();
  }, [gid, onChanged]);
  useEffect(() => { load(); }, [load]);

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const auditByExpense = useMemo(() => auditVersionsByExpense(auditRows), [auditRows]);
  const liveExpenseIds = useMemo(() => new Set(expenses.map((e) => e.id)), [expenses]);
  // Frozen snapshot for an expense that no longer exists live (deleted): the last version's snapshot.
  const deletedSnapById = useMemo(() => {
    const out: Record<string, { snapshot: AuditSnapshot; at?: string }> = {};
    for (const eid of Object.keys(auditByExpense)) {
      if (liveExpenseIds.has(eid)) continue;
      const vers = auditByExpense[eid];
      for (let i = vers.length - 1; i >= 0; i--) { if (vers[i].snapshot) { out[eid] = { snapshot: vers[i].snapshot as AuditSnapshot, at: vers[i].at }; break; } }
    }
    return out;
  }, [auditByExpense, liveExpenseIds]);
  const guestById = useMemo(() => Object.fromEntries(guests.map((g) => [g.id, g])), [guests]);
  const confirmedSettlements = useMemo(() => settlements.filter((s) => (s.status || "confirmed") === "confirmed"), [settlements]);
  const myPending = useMemo(() => settlements.filter((s) => (s.status === "pending") && s.from_user_id === user.id), [settlements, user.id]);
  const balances = useMemo(() => computeBalances(expenses, shares, confirmedSettlements, guests, payers), [expenses, shares, confirmedSettlements, guests, payers]);
  const generalBucketId = useMemo(() => events.find((e) => e.is_general)?.id ?? null, [events]);
  // Per-Bucket settlement: each Bucket squares in its own world (fewest payments WITHIN the Bucket).
  // A Bucket appears in Settle if it has expenses or any outstanding transfer; its rows carry bucketId.
  const settleGroups = useMemo(() => {
    return events
      .filter((ev) => ev.status !== "closed")
      .map((ev) => ({
        ev,
        settled: bucketSettled(ev.id, expenses as any, shares as any, confirmedSettlements as any, guests as any, payers as any),
        transfers: bucketTransfers(ev.id, expenses as any, shares as any, confirmedSettlements as any, guests as any, payers as any)
          .map((t) => ({ ...t, bucketId: ev.id })),
        hasExpenses: expenses.some((e) => (e.event_id ?? null) === ev.id),
      }))
      .filter((g) => g.hasExpenses || g.transfers.length > 0)
      .sort((a, b) => (a.transfers.length === 0 ? 1 : 0) - (b.transfers.length === 0 ? 1 : 0)); // unsettled first
  }, [events, expenses, shares, confirmedSettlements, guests, payers]);

  const nameOf = (uid: string) => memberById[uid]?.display_name || "Player";
  const requireOnline = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { alert("You're offline — connect to update the money ledger."); return false; }
    return true;
  };

  // ---- confirm-on-return after a pay hand-off ----
  const [pending, setPending] = useState<{ from: string; to: string; amt: number; bucketId: string } | null>(null);
  const [zelleInfo, setZelleInfo] = useState<{ from: string; to: string; amt: number; handle: string; bucketId: string } | null>(null);
  const [askReturn, setAskReturn] = useState(false);
  const [payChoose, setPayChoose] = useState<{ to: string; amt: number; total: number; count: number } | null>(null);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && (pending || myPending.length > 0)) { setPayChoose(null); setAskReturn(true); } };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pending, myPending.length]);

  const logActivity = useCallback(async (action: string, summary: string, meta: any = {}) => {
    await supabase.from("group_activity").insert({ group_id: gid, actor_user_id: user.id, action, summary, meta });
  }, [gid, user.id]);

  const createEvent = async (name: string): Promise<string | null> => {
    if (!requireOnline()) return null;
    const { data, error } = await supabase.from("group_events")
      .insert({ group_id: gid, name: name.trim(), event_type: "manual", status: "open", created_by: user.id })
      .select("*").single();
    if (error || !data) { alert("Couldn't create the Bucket — please try again."); return null; }
    setEvents((e) => [data as EventRow, ...e]);
    await logActivity("event_created", "created Bucket " + name.trim(), { event_id: (data as any).id });
    return (data as any).id as string;
  };
  const setEventClosed = async (ev: EventRow, closed: boolean) => {
    if (!requireOnline()) return;
    if (closed && !window.confirm(`Close "${ev.name}"? It will be sealed — no more expenses, and its expenses can't be edited. You (an admin) can reopen it later.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("set_event_closed", { p_event: ev.id, p_closed: closed });
    setBusy(false);
    if (error) { alert("Couldn't " + (closed ? "close" : "reopen") + " the event — " + error.message); return; }
    await load();
  };
  const moveExpenseEvent = async (expenseId: string, eventId: string | null) => {
    if (!requireOnline()) return;
    // Guard: an event whose debts have been (partly) paid was settled against a fixed set of expenses.
    // Moving an expense in/out of it would misroute that coverage. Require unmarking first.
    const confIds = new Set(settlements.filter((s) => (s.status || "confirmed") === "confirmed").map((s) => s.id));
    const eventHasPayments = (evId: string | null) => {
      if (evId == null) return false;
      if (settlements.some((s) => (s.event_id ?? null) === evId && (s.status || "confirmed") === "confirmed")) return true;
      const inEv = new Set(expenses.filter((e) => (e.event_id ?? null) === evId).map((e) => e.id));
      return allocations.some((a) => a.expense_id && inEv.has(a.expense_id) && confIds.has(a.settlement_id));
    };
    const srcEvent = expenses.find((e) => e.id === expenseId)?.event_id ?? null;
    if (eventHasPayments(srcEvent)) { alert("This event has recorded payments, so its expenses can't be moved — the payments were settled against these expenses. Unmark them in the Settle tab first, then move."); return; }
    if (eventHasPayments(eventId)) { alert("The event you're moving into has recorded payments. Unmark them in the Settle tab first, then move the expense in."); return; }
    setBusy(true);
    const { error } = await supabase.rpc("move_expense_event", { p_expense: expenseId, p_event: eventId });
    setBusy(false);
    if (error) { alert("Couldn't move the expense — " + error.message); return; }
    await load();
  };

  // ---- per-event settle: arm (pending) → confirm on return ----
  const confirmPending = async () => {
    if (!requireOnline()) return;
    setBusy(true);
    const ids = myPending.map((s) => s.id);
    if (ids.length) {
      const { data: upd, error: uErr } = await supabase.from("settlements").update({ status: "confirmed" }).in("id", ids).select("id");
      if (uErr || !upd || upd.length < ids.length) {
        setBusy(false);
        alert("Couldn't confirm your payment — please try again. If it keeps happening, tell your admin.");
        await load();
        return;
      }
      const byTo: Record<string, number> = {};
      for (const s of myPending) byTo[s.to_user_id] = (byTo[s.to_user_id] || 0) + s.amount_cents;
      for (const to of Object.keys(byTo)) {
        try { await supabase.rpc("create_notification", { p_recipient: to, p_message: `${nameOf(user.id)} settled ${fmtUSD(byTo[to])} with you.`, p_group_id: gid }); } catch { /* best-effort */ }
      }
      await logActivity("settlement_added", "settled " + fmtUSD(Object.values(byTo).reduce((a, b) => a + b, 0)), { count: ids.length });
    }
    setBusy(false);
    setPending(null); setAskReturn(false); setPayChoose(null);
    await load();
    onChanged?.();
  };
  const discardPending = async () => {
    setBusy(true);
    const ids = myPending.map((s) => s.id);
    if (ids.length) await supabase.from("settlements").delete().in("id", ids);
    setBusy(false);
    setPending(null); setAskReturn(false); setPayChoose(null);
    await load();
  };

  // Stable key for the debt LINE being settled. Both parties (payer marking "paid", payee marking
  // "received") compute the same key for the same outstanding line, so the unique index rejects the
  // second — one confirmation per line, race-proof. A later new debt for the same pair has a different
  // confirmed-so-far total, hence a different key, so repeat settlements still work.
  function settleKey(from: string, to: string, eventId: string | null) {
    const prior = settlements
      .filter((s) => s.from_user_id === from && s.to_user_id === to && (s.event_id ?? null) === (eventId ?? null) && (s.status || "confirmed") === "confirmed")
      .reduce((a, s) => a + s.amount_cents, 0);
    return `${eventId ?? "g"}:${from}:${to}:${prior}`;
  }

  async function recordSettlement(from: string, to: string, amt: number, method: string, bucketId: string) {
    if (!requireOnline()) return;
    setBusy(true);
    const allocs = allocateSettlement(from, to, bucketId, amt, expenses as any, shares as any, guests as any, payers as any);
    const { error } = await supabase.rpc("record_settlement", { p_group: gid, p_from: from, p_to: to, p_amount: amt, p_method: method, p_event: bucketId, p_status: "confirmed", p_dedup: settleKey(from, to, bucketId), p_allocs: allocs });
    if (error) {
      setBusy(false);
      if ((error as any).code === "23505" || /duplicate|unique/i.test((error as any).message || "")) { alert("This was already marked settled — refreshing."); await load(); onChanged?.(); return; }
      alert("Couldn't record the payment — please try again."); return;
    }
    await logActivity("settlement_added", "marked " + fmtUSD(amt) + " paid: " + nameOf(from) + " → " + nameOf(to), { from, to, amount_cents: amt });
    setBusy(false);
    setPending(null); setAskReturn(false);
    await load();
    onChanged?.();
  }

  const voidExpenseRow = async (d: ExpenseRow) => {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", d.id);
    if (error) { setBusy(false); alert("Couldn't void this expense — please try again."); return; }
    await logActivity("expense_deleted", "voided \u201C" + (d.description || "expense") + "\u201D \u2014 " + fmtUSD(d.amount_cents), { expense_id: d.id, amount_cents: d.amount_cents });
    setBusy(false); await load();
  };
  const restoreExpense = async (d: ExpenseRow) => {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("expenses").update({ deleted_at: null }).eq("id", d.id);
    if (error) { setBusy(false); alert("Couldn't restore this expense — please try again."); return; }
    await logActivity("expense_restored", "restored \u201C" + (d.description || "expense") + "\u201D \u2014 " + fmtUSD(d.amount_cents), { expense_id: d.id, amount_cents: d.amount_cents });
    setBusy(false); await load();
  };
  async function deleteSettlement(s2: SettlementRow) {
    if (!requireOnline()) return;
    const ev = s2.event_id ? events.find((e) => e.id === s2.event_id) : null;
    if (ev && ev.status === "closed") { alert(`This payment is in a closed event ("${ev.name}"). Reopen the event first, then unmark it.`); return; }
    if (!window.confirm("Unmark this payment? " + nameOf(s2.from_user_id) + " → " + nameOf(s2.to_user_id) + " " + fmtUSD(s2.amount_cents) + ". Balances will recompute.")) return;
    setBusy(true);
    const { error } = await supabase.from("settlements").delete().eq("id", s2.id);
    if (error) { setBusy(false); alert("Couldn't unmark — " + error.message); return; }
    await logActivity("settlement_removed", "unmarked " + fmtUSD(s2.amount_cents) + " paid: " + nameOf(s2.from_user_id) + " → " + nameOf(s2.to_user_id), { from: s2.from_user_id, to: s2.to_user_id, amount_cents: s2.amount_cents });
    setBusy(false);
    await load();
    onChanged?.();
  }

  function startZelle(t: { from: string; to: string; amt: number; bucketId: string }) {
    const payee = memberById[t.to];
    const handle = payee?.zelle_handle;
    if (!handle) { alert(nameOf(t.to) + " hasn't added a Zelle contact yet."); return; }
    setZelleInfo({ from: t.from, to: t.to, amt: t.amt, handle, bucketId: t.bucketId });
  }
  function startPay(kind: "venmo" | "paypal", t: { from: string; to: string; amt: number; bucketId: string }) {
    const payee = memberById[t.to];
    const handle = kind === "venmo" ? payee?.venmo_handle : payee?.paypal_handle;
    if (!handle) return;
    setPending(t);
    const url = payLink(kind, handle, t.amt, `${activeGroup.name} golf`);
    if (typeof window !== "undefined") window.location.href = url;
  }

  if (loading) return <div style={{ color: C.sage, padding: 20, textAlign: "center" }}>Loading…</div>;

  async function retireGuest(guestId: string, becameMemberId: string | null) {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("group_guests").update({ archived: true, became_member_id: becameMemberId }).eq("id", guestId);
    if (error) { setBusy(false); alert("Couldn't retire the guest — please try again."); return; }
    await logActivity("guest_retired", "retired guest " + (guestById[guestId]?.name || "") + (becameMemberId ? " (now a member: " + nameOf(becameMemberId) + ")" : ""), { guest_id: guestId });
    setBusy(false); await load();
  }
  async function unretireGuest(guestId: string) {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("group_guests").update({ archived: false, became_member_id: null }).eq("id", guestId);
    if (error) { setBusy(false); alert("Couldn't restore the guest — please try again."); return; }
    await logActivity("guest_restored", "restored guest " + (guestById[guestId]?.name || ""), { guest_id: guestId });
    setBusy(false); await load();
  }


  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: "0 14px" }}>
      {/* screen switch */}
      <div style={{ display: "flex", background: "#123528", borderRadius: 999, padding: 3, marginBottom: 12 }}>
        {([["balances", "Balances"], ["add", "Add"], ["settle", "Settle"], ["log", "Activity"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => { if (k === "add") setEditing(null); setScreen(k); }} style={{
            flex: 1, border: "none", cursor: "pointer", borderRadius: 999, padding: "8px 6px", fontSize: 13, fontWeight: 700,
            background: screen === k ? C.gold : "transparent", color: screen === k ? "#2a2410" : C.sage,
          }}>{label}</button>
        ))}
      </div>

      {screen === "balances" && (
        <>
        {myPending.length > 0 && (
          <div style={{ background: "#3a3320", border: "1px solid #6b5e2e", borderRadius: 12, padding: "11px 13px", marginBottom: 12 }}>
            <div style={{ color: "#f3e2a8", fontSize: 13, fontWeight: 700 }}>Confirm your payment</div>
            <div style={{ color: "#e6cf8a", fontSize: 12, marginTop: 2 }}>You started settling {fmtUSD(myPending.reduce((s, p) => s + p.amount_cents, 0))} but haven't confirmed it went through.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={busy} onClick={confirmPending} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>Mark settled</button>
              <button disabled={busy} onClick={discardPending} style={{ ...btn(false), flex: 0, padding: "8px 14px" }}>Undo</button>
            </div>
          </div>
        )}
        <BalancesScreen members={members} guests={guests} shares={shares} payers={payers} balances={balances} me={user.id} groupName={activeGroup.name}
          onOpenLedger={(mid) => setLedgerFor(mid)}
          onNudge={(m, owe) => { const link = "https://birdienumnum.vercel.app"; if (m.phone) window.location.href = nudgeSms(m.phone, m.display_name, owe, activeGroup.name, link); }} />
        {isAdmin && (
          <button onClick={() => setScreen("untangle")} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", marginTop: 12, background: "#123528", border: `1px solid ${C.greenMid}`, borderRadius: 12, padding: "11px 13px", color: C.sage, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
            <span style={{ fontSize: 15 }}>&#9874;</span> Untangle payments <span style={{ marginLeft: "auto", color: C.faint, fontWeight: 500, fontSize: 11.5 }}>admin · fix an entry</span>
          </button>
        )}
        <GuestManager guests={guests} members={members} busy={busy} me={user.id} isAdmin={isAdmin} onRetire={retireGuest} onUnretire={unretireGuest} />
        </>
      )}
      {screen === "add" && (
        <AddExpense key={editing?.id || "new"} user={user} gid={gid} members={members} guests={guests} balances={balances} busy={busy} setBusy={setBusy}
          requireOnline={requireOnline}
          openEvents={events.filter((e) => e.status === "open")} onCreateEvent={createEvent} defaultEventId={generalBucketId}
          editing={editing} editShares={editing ? shares.filter((s) => s.expense_id === editing.id) : []} editPayers={editing ? payers.filter((p) => p.expense_id === editing.id) : []} editHistory={editing ? activity.filter((a) => a?.meta?.expense_id === editing.id && (a.action === "expense_created" || a.action === "expense_edited")) : []} onLog={logActivity}
          canDelete={!!editing && (editing.created_by === user.id || isAdmin)}
          onDelete={async () => { if (!editing) return; const d = editing; setBusy(true); const { error } = await supabase.from("expenses").update({ deleted_at: new Date().toISOString() }).eq("id", d.id); if (error) { setBusy(false); alert("Couldn't void this expense — please try again."); return; } await logActivity("expense_deleted", "voided “" + (d.description || "expense") + "” — " + fmtUSD(d.amount_cents), { expense_id: d.id, amount_cents: d.amount_cents }); setBusy(false); setEditing(null); await load(); setScreen("balances"); }}
          onAddGuest={async (name) => {
            if (!requireOnline()) return;
            const { data, error } = await supabase.from("group_guests").insert({ group_id: gid, name, archived: false, created_by: user.id }).select("id, name, sponsor_user_id, group_id, archived, became_member_id").single();
            if (error || !data) { alert("Couldn't add the guest — please try again."); return; }
            setGuests((g) => [...g, data as GuestRow].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))); await logActivity("guest_added", "added guest " + name, { guest_id: (data as any).id });
          }}
          onSaved={async () => { setEditing(null); await load(); setScreen("balances"); }} />
      )}
      {screen === "settle" && (
        <SettleScreen groups={settleGroups} nameOf={nameOf} memberById={memberById} balances={balances} busy={busy} me={user.id} isAdmin={isAdmin}
          settlements={settlements} onUnmark={deleteSettlement} eventName={(id) => events.find((e) => e.id === id)?.name || "Bucket"}
          closedEventIds={new Set(events.filter((e) => e.status === "closed").map((e) => e.id))}
          onPay={startPay} onZelle={startZelle} onMark={(t) => recordSettlement(t.from, t.to, t.amt, "cash", t.bucketId)} />
      )}
      {screen === "untangle" && isAdmin && (
        <AdminUntangle members={members} expenses={expenses} deletedExpenses={deletedExpenses} shares={shares} payers={payers}
          settlements={settlements} allocations={allocations} guests={guests} events={events}
          activity={activity} memberById={memberById} busy={busy}
          onVoidExpense={voidExpenseRow} onRestoreExpense={restoreExpense} onUnmarkSettlement={deleteSettlement}
          onEditExpense={(e) => { setEditing(e); setScreen("add"); }} onBack={() => setScreen("balances")} />
      )}
      {screen === "log" && <ActivityLog activity={activity} memberById={memberById}
        onOpenExpense={(id) => {
          const e = expenses.find((x) => x.id === id);
          if (e) { setViewing(e); return; }
          const snap = deletedSnapById[id];
          if (snap) setViewingSnap(snap);
        }}
        canOpen={(id) => liveExpenseIds.has(id) || !!deletedSnapById[id]} />}

      {/* expenses list (under balances) — grouped into event islands */}
      {screen === "balances" && (
        <EventGroupedExpenses
          expenses={expenses} shares={shares} payers={payers} guests={guests} events={events}
          memberById={memberById} guestById={guestById} partyCount={members.length + guests.length}
          settlements={settlements} allocations={allocations} me={user.id}
          isAdmin={isAdmin} onView={(e) => setViewing(e)}
          onCloseEvent={(ev, closed) => setEventClosed(ev, closed)} />
      )}

      {viewing && (
        <ExpenseDetail expense={viewing} shares={shares} payers={payers} memberById={memberById} guestById={guestById}
          versions={auditByExpense[viewing.id] || []}
          openEvents={events.filter((e) => e.status === "open")}
          currentEvent={events.find((e) => e.id === viewing.event_id) || null}
          canEdit={(viewing.created_by === user.id || isAdmin) && events.find((e) => e.id === viewing.event_id)?.status !== "closed"}
          canMove={(viewing.created_by === user.id || isAdmin) && events.find((e) => e.id === viewing.event_id)?.status !== "closed"}
          onMove={(evId) => { const v = viewing; setViewing(null); moveExpenseEvent(v.id, evId); }}
          onEdit={() => { const v = viewing; setViewing(null); setEditing(v); setScreen("add"); }}
          onClose={() => setViewing(null)} />
      )}

      {viewingSnap && (
        <SnapshotDetail snap={viewingSnap.snapshot} at={viewingSnap.at} onClose={() => setViewingSnap(null)} />
      )}

      {ledgerFor && (
        <PersonLedgerModal
          memberId={ledgerFor} me={user.id}
          name={(memberById[ledgerFor]?.display_name) || "Player"}
          net={balances[ledgerFor] || 0}
          expenses={expenses} shares={shares} settlements={confirmedSettlements} allocations={allocations} guests={guests} payers={payers}
          events={events} memberById={memberById}
          onClose={() => setLedgerFor(null)} />
      )}

      {zelleInfo && (
        <BottomSheet onClose={() => setZelleInfo(null)} maxWidth={520}>
            <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800, paddingRight: 32 }}>Pay {nameOf(zelleInfo.to)} with Zelle</div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>Zelle happens inside your bank app. Open it, send to the contact below, then mark it settled here.</div>
            <div style={{ background: "#123528", borderRadius: 12, padding: 14, marginTop: 12 }}>
              <FieldLabel>Zelle contact</FieldLabel>
              <div style={{ color: C.cream, fontSize: 16, fontWeight: 800, marginTop: 3, wordBreak: "break-all" }}>{zelleInfo.handle}</div>
              <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, marginTop: 8 }}>{fmtUSD(zelleInfo.amt)}</div>
              <button onClick={() => { try { navigator.clipboard?.writeText(zelleInfo.handle); } catch {} }} style={{ ...btn(false), marginTop: 10, fontSize: 12.5, padding: "8px 12px" }}>Copy contact</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button disabled={busy} onClick={() => { const z = zelleInfo; setZelleInfo(null); recordSettlement(z.from, z.to, z.amt, "zelle", z.bucketId); }} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>✓ I&apos;ve paid, mark settled</button>
              <button onClick={() => setZelleInfo(null)} style={{ ...btn(false), flex: 1 }}>Cancel</button>
            </div>
        </BottomSheet>
      )}

      {/* confirm-on-return sheet */}
      {askReturn && (myPending.length > 0 || pending) && (
        <BottomSheet onClose={() => { setAskReturn(false); if (!myPending.length) setPending(null); }} dismissOnBackdrop={false} maxWidth={520} bodyStyle={{ textAlign: "center" }}>
            <div style={{ color: C.cream, fontWeight: 800, fontSize: 17 }}>Back from paying — did it go through?</div>
            <div style={{ color: C.sage, fontSize: 13, margin: "8px 0 4px" }}>You were settling <b style={{ color: C.gold }}>{fmtUSD(myPending.length > 0 ? myPending.reduce((s, p) => s + p.amount_cents, 0) : (pending?.amt || 0))}</b></div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button disabled={busy} onClick={() => { if (myPending.length > 0) confirmPending(); else if (pending) recordSettlement(pending.from, pending.to, pending.amt, "venmo", pending.bucketId); }} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>✓ Yes, mark settled</button>
              <button onClick={() => { setAskReturn(false); if (!myPending.length) setPending(null); }} style={{ ...btn(false), flex: 1 }}>Not yet</button>
            </div>
        </BottomSheet>
      )}

      {/* pay-method chooser for an armed event settle */}
      {payChoose && (
        <BottomSheet onClose={() => setPayChoose(null)} maxWidth={520}>
            <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800, paddingRight: 32 }}>Pay {nameOf(payChoose.to)} {fmtUSD(payChoose.amt)}</div>
            <div style={{ color: C.sage, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>Send it, then come back and confirm — we'll ask when you return.{payChoose.count > 1 ? ` (${payChoose.count} people to pay for this settle; open each below.)` : ""}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {memberById[payChoose.to]?.venmo_handle && <button onClick={() => { const u = payLink("venmo", memberById[payChoose.to]!.venmo_handle!, payChoose.amt, `${activeGroup.name} golf`); if (typeof window !== "undefined") window.location.href = u; }} style={{ ...btn(true), flex: 1, background: "#3d95ce", color: "#fff" }}>Venmo</button>}
              {memberById[payChoose.to]?.paypal_handle && <button onClick={() => { const u = payLink("paypal", memberById[payChoose.to]!.paypal_handle!, payChoose.amt, `${activeGroup.name} golf`); if (typeof window !== "undefined") window.location.href = u; }} style={{ ...btn(false), flex: 1 }}>PayPal</button>}
            </div>
            {memberById[payChoose.to]?.zelle_handle && (
              <div style={{ background: "#123528", borderRadius: 10, padding: "9px 11px", marginTop: 10 }}>
                <div style={{ color: C.sage, fontSize: 11 }}>Or Zelle to</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.cream, fontSize: 14, fontWeight: 700, wordBreak: "break-all", flex: 1 }}>{memberById[payChoose.to]!.zelle_handle}</span>
                  <button onClick={() => { try { navigator.clipboard?.writeText(memberById[payChoose.to]!.zelle_handle!); } catch {} }} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Copy</button>
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button disabled={busy} onClick={confirmPending} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>Paid — mark settled</button>
              <button disabled={busy} onClick={discardPending} style={{ ...btn(false), flex: 0, padding: "10px 16px" }}>Cancel</button>
            </div>
        </BottomSheet>
      )}
    </div>
  );
}

// ---------------- Balances ----------------
function GuestManager({ guests, members, busy, me, isAdmin, onRetire, onUnretire }: {
  guests: GuestRow[]; members: Member[]; busy: boolean; me: string; isAdmin: boolean;
  onRetire: (guestId: string, becameMemberId: string | null) => Promise<void>;
  onUnretire: (guestId: string) => Promise<void>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [became, setBecame] = useState<string>("");
  const byName = (a: GuestRow, b: GuestRow) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  const deliberate = guests.filter((g) => !g.source_game_id); // bet-generated guests are throwaway; not managed here
  if (deliberate.length === 0) return null;
  const active = deliberate.filter((g) => !g.archived).sort(byName);
  const retired = deliberate.filter((g) => g.archived).sort(byName);
  const nameOf = (uid: string) => members.find((m) => m.id === uid)?.display_name || "member";
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px", marginTop: 12 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Guests</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Retire a guest to stop offering them on new expenses. Past expenses stay untouched.</div>
      {active.length === 0 && <div style={{ color: C.sage, fontSize: 12, padding: "6px 2px" }}>No active guests. Add one from the Add screen.</div>}
      {active.map((g) => (
        <div key={g.id} style={{ borderBottom: `1px solid ${C.greenMid}`, padding: "8px 2px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ flex: 1, color: C.cream, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{g.name}</span>
            {(g.created_by === me || isAdmin)
              ? <button disabled={busy} onClick={() => { setOpenId(openId === g.id ? null : g.id); setBecame(""); }} style={{ background: "#173a2c", color: C.cream, border: `1px solid #37624f`, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{openId === g.id ? "Cancel" : "Retire"}</button>
              : <span style={{ color: C.faint, fontSize: 11 }}>added by {g.created_by ? nameOf(g.created_by) : "someone else"}</span>}
          </div>
          {openId === g.id && (
            <div style={{ marginTop: 8, background: "#14352b", borderRadius: 10, padding: 10 }}>
              <FieldLabel>Now a member? (optional)</FieldLabel>
              <select value={became} onChange={(e) => setBecame(e.target.value)} style={{ ...inputStyle, padding: "8px 11px", fontSize: 14 }}>
                <option value="">— not a member —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
              <button disabled={busy} onClick={() => { onRetire(g.id, became || null); setOpenId(null); }} style={{ ...btn(true), marginTop: 10, width: "100%" }}>Retire {g.name}</button>
            </div>
          )}
        </div>
      ))}
      {retired.length > 0 && (
        <>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase", margin: "12px 0 4px" }}>Retired</div>
          {retired.map((g) => (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px", opacity: 0.85 }}>
              <span style={{ flex: 1, color: C.sage, fontSize: 13, minWidth: 0 }}>{g.name}{g.became_member_id ? " · now a member: " + nameOf(g.became_member_id) : ""}</span>
              {(g.created_by === me || isAdmin) && <button disabled={busy} onClick={() => onUnretire(g.id)} style={{ background: "transparent", color: C.gold, border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Un-retire</button>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function BalancesScreen({ members, guests, shares, payers, balances, me, onNudge, onOpenLedger }: {
  members: Member[]; guests: GuestRow[]; shares: ShareRow[]; payers: PayerRow[]; balances: Record<string, number>; me: string; groupName: string;
  onNudge: (m: Member, owe: number) => void;
  onOpenLedger: (memberId: string) => void;
}) {
  const rows = members.map((m) => ({ m, v: balances[m.id] || 0 }));
  const gById = Object.fromEntries(guests.map((g) => [g.id, g]));
  const coverage = guestCoverageBySponsor(shares, gById, payers); // memberId -> { guestId -> net cents }, per-expense sponsor (wins + losses)
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Aggregate Club-level Balances</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Everyone’s net across all Buckets · tap a name for the per-Bucket breakdown</div>
      {rows.map(({ m, v }) => {
        const owes = v < 0, owed = v > 0;
        const cov = coverage[m.id] || {};
        const covNames = Object.keys(cov).map((id) => gById[id]?.name).filter(Boolean) as string[];
        return (
          <div key={m.id} onClick={() => onOpenLedger(m.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: `1px solid ${C.greenMid}`, cursor: "pointer" }}>
            <Avatar src={m.avatar_url} name={m.display_name} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontSize: 14, fontWeight: 700 }}>{m.display_name}{m.id === me ? " (you)" : ""}</div>
              {covNames.length > 0 && <div style={{ color: C.sage, fontSize: 11 }}>incl. {covNames.join(", ")}</div>}
            </div>
            <div style={{ color: owed ? "#7fd6a3" : owes ? "#ef9d90" : C.sage, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15 }}>
              {owed ? "is owed " + fmtUSD(v) : owes ? "owes " + fmtUSD(-v) : "settled"}
            </div>
            {owes && m.phone && <button onClick={(e) => { e.stopPropagation(); onNudge(m, -v); }} style={{ marginLeft: 6, background: "#173a2c", color: C.cream, border: `1px solid #37624f`, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Nudge</button>}
            <span style={{ color: C.sage, fontSize: 16, marginLeft: 2 }}>&#8250;</span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Settle up ----------------
function AdminUntangle({ members, expenses, deletedExpenses, shares, payers, settlements, allocations, guests, events, activity, memberById, busy, onVoidExpense, onRestoreExpense, onUnmarkSettlement, onEditExpense, onBack }: {
  members: Member[]; expenses: ExpenseRow[]; deletedExpenses: ExpenseRow[]; shares: ShareRow[]; payers: PayerRow[];
  settlements: SettlementRow[]; allocations: { settlement_id: string; expense_id: string | null; amount_cents: number }[];
  guests: GuestRow[]; events: EventRow[]; activity: any[]; memberById: Record<string, Member>; busy: boolean;
  onVoidExpense: (e: ExpenseRow) => Promise<void>; onRestoreExpense: (e: ExpenseRow) => Promise<void>;
  onUnmarkSettlement: (s: SettlementRow) => void; onEditExpense: (e: ExpenseRow) => void; onBack: () => void;
}) {
  const nameOf = (uid: string | null) => (uid ? (memberById[uid]?.display_name || "someone") : "someone");
  const evName = (id: string | null) => (id ? (events.find((e) => e.id === id)?.name || "Event") : "Ungrouped");
  const confirmed = useMemo(() => settlements.filter((s) => (s.status || "confirmed") === "confirmed"), [settlements]);
  const balances = useMemo(() => computeBalances(expenses as any, shares as any, confirmed as any, guests as any, payers as any), [expenses, shares, confirmed, guests, payers]);
  const sum = Object.values(balances).reduce((a, b) => a + b, 0);
  const conserves = sum === 0;
  const ranked = useMemo(() => [...members].sort((a, b) => Math.abs(balances[b.id] || 0) - Math.abs(balances[a.id] || 0)), [members, balances]);
  const [sel, setSel] = useState(ranked[0]?.id || members[0]?.id || "");
  const [pending, setPending] = useState<null | { impact: Record<string, number>; title: string; subtitle: string; label: string; danger?: boolean; run: () => void }>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const netColor = (v: number) => (v > 0 ? "#7fd6a3" : v < 0 ? "#ef9d90" : C.sage);

  const shareOfIn = (expId: string, m: string) => shares.filter((s) => s.expense_id === expId && (s.user_id === m || s.sponsor_user_id === m)).reduce((a, s) => a + s.share_cents, 0);
  const paidOfIn = (e: ExpenseRow, m: string) => { const py = payers.filter((p) => p.expense_id === e.id); if (py.length) return py.filter((p) => p.user_id === m).reduce((a, p) => a + p.paid_cents, 0); return e.payer_user_id === m ? e.amount_cents : 0; };
  const voidImpact = (e: ExpenseRow) => {
    const sh = shares.filter((s) => s.expense_id === e.id).map((s) => ({ member: (s.user_id || s.sponsor_user_id || "") as string, cents: s.share_cents })).filter((x) => x.member);
    const pyRows = payers.filter((p) => p.expense_id === e.id);
    const pd = pyRows.length ? pyRows.map((p) => ({ member: (p.user_id || "") as string, cents: p.paid_cents })).filter((x) => x.member) : [{ member: e.payer_user_id, cents: e.amount_cents }];
    return expenseImpact(sh, pd, [], []);
  };

  type Row = { kind: "exp" | "settle"; at: string; label: string; sub: string; delta: number; exp?: ExpenseRow; s?: SettlementRow };
  const rows: Row[] = [];
  for (const e of expenses) { const sh = shareOfIn(e.id, sel); const pd = paidOfIn(e, sel); if (sh === 0 && pd === 0) continue; rows.push({ kind: "exp", at: e.created_at, label: e.description || "expense", sub: evName(e.event_id ?? null) + " \u00B7 paid by " + nameOf(e.payer_user_id), delta: pd - sh, exp: e }); }
  for (const st of confirmed) { if (st.from_user_id !== sel && st.to_user_id !== sel) continue; const out = st.from_user_id === sel; rows.push({ kind: "settle", at: st.created_at || "", label: out ? "Paid " + nameOf(st.to_user_id) : "Received from " + nameOf(st.from_user_id), sub: (st.method || "cash") as string, delta: out ? st.amount_cents : -st.amount_cents, s: st }); }
  rows.sort((a, b) => (a.at || "").localeCompare(b.at || ""));
  let run = 0;

  const money = activity.filter((a) => a && ["expense_created", "expense_edited", "expense_deleted", "expense_restored", "settlement_added", "settlement_removed"].includes(a.action)).slice(0, 12);
  const actBtn: React.CSSProperties = { padding: "5px 10px", borderRadius: 8, fontSize: 11.5, fontWeight: 800, cursor: "pointer" };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <button onClick={onBack} style={{ background: "transparent", border: `1px solid ${C.greenMid}`, borderRadius: 9, color: C.sage, fontSize: 12.5, padding: "6px 11px", cursor: "pointer" }}>&#8592; Back</button>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Untangle payments</div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, background: conserves ? "#0f3529" : "#3a2320", border: `1px solid ${conserves ? C.greenMid : "#8a3b34"}`, borderRadius: 11, padding: "9px 12px", marginBottom: 12 }}>
        <span style={{ fontSize: 15, color: conserves ? "#7fd6a3" : "#ef9d90" }}>{conserves ? "\u2713" : "\u26A0"}</span>
        <span style={{ color: C.cream, fontSize: 12.5 }}>{conserves ? "Balances reconcile \u2014 the club nets to $0.00" : `Balances are off by ${fmtUSD(Math.abs(sum))} \u2014 investigate below`}</span>
      </div>

      <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 4, marginBottom: 12 }}>
        {ranked.map((m) => { const v = balances[m.id] || 0; const on = m.id === sel; return (
          <button key={m.id} onClick={() => setSel(m.id)} style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, background: on ? C.gold : "#123528", border: on ? "none" : `1px solid ${C.greenMid}`, borderRadius: 10, padding: "7px 11px", cursor: "pointer", minWidth: 92 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: on ? "#2a2410" : C.cream }}>{m.display_name}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? "#5a4a12" : netColor(v) }}>{v === 0 ? "square" : (v > 0 ? "gets " : "owes ") + fmtUSD(Math.abs(v))}</span>
          </button>
        ); })}
      </div>

      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 8 }}>{memberById[sel]?.display_name}&rsquo;s ledger &middot; {rows.length} entries &middot; running balance ends at {fmtUSD(balances[sel] || 0)}</div>
      {rows.length === 0 && <div style={{ color: C.faint, fontSize: 12.5, padding: "16px 0", textAlign: "center" }}>No expenses or payments for this member.</div>}

      {rows.map((r, i) => {
        run += r.delta;
        return (
          <div key={i} style={{ background: "#173a2c", borderRadius: 12, padding: "10px 12px", marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ flex: 1, color: C.cream, fontSize: 13 }}>{r.kind === "settle" ? <span style={{ color: C.sage }}>&#8599; </span> : null}{r.label}</span>
              <span style={{ color: r.delta >= 0 ? "#7fd6a3" : "#ef9d90", fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 14 }}>{r.delta >= 0 ? "+" : "\u2212"}{fmtUSD(Math.abs(r.delta))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ color: C.faint, fontSize: 11 }}>{r.sub}</span>
              <span style={{ color: C.sage, fontSize: 11 }}>running {fmtUSD(run)}</span>
            </div>
            <div style={{ display: "flex", gap: 7, marginTop: 9, justifyContent: "flex-end" }}>
              {r.kind === "exp" && r.exp && (<>
                <button disabled={busy} onClick={() => onEditExpense(r.exp!)} style={{ ...actBtn, border: `1px solid ${C.greenMid}`, background: "transparent", color: C.sage }}>Edit</button>
                <button disabled={busy} onClick={() => { const e = r.exp!; setPending({ impact: voidImpact(e), title: "Void \u201C" + (e.description || "expense") + "\u201D?", subtitle: "Removes it from everyone's balances. Reversible \u2014 you can restore it below.", label: "Confirm void", danger: true, run: () => onVoidExpense(e) }); }} style={{ ...actBtn, border: "1px solid #8a3b34", background: "transparent", color: "#ef9d90" }}>Void</button>
              </>)}
              {r.kind === "settle" && r.s && (
                <button disabled={busy} onClick={() => { const st = r.s!; setPending({ impact: { [st.from_user_id]: -st.amount_cents, [st.to_user_id]: st.amount_cents }, title: "Unmark this payment?", subtitle: "Puts the debt back on the books.", label: "Confirm unmark", danger: true, run: () => onUnmarkSettlement(st) }); }} style={{ ...actBtn, border: "1px solid #8a3b34", background: "transparent", color: "#ef9d90" }}>Unmark</button>
              )}
            </div>
          </div>
        );
      })}

      {deletedExpenses.length > 0 && (
        <div style={{ marginTop: 16, background: "#2a2320", border: "1px solid #6b5e2e", borderRadius: 12, padding: "10px 12px" }}>
          <Eyebrow>Voided expenses</Eyebrow>
          {deletedExpenses.map((e) => (
            <div key={e.id} style={{ padding: "7px 0", borderTop: `1px solid #4a4020` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span style={{ color: C.cream, fontSize: 12.5 }}>{e.description || "expense"} &middot; {fmtUSD(e.amount_cents)}</span>
                {restoreId === e.id
                  ? <span style={{ display: "flex", gap: 6 }}><button disabled={busy} onClick={async () => { setRestoreId(null); await onRestoreExpense(e); }} style={{ ...actBtn, background: "#7fd6a3", color: C.green, border: "none" }}>Confirm</button><button disabled={busy} onClick={() => setRestoreId(null)} style={{ ...actBtn, background: "transparent", color: C.sage, border: `1px solid ${C.greenMid}` }}>Cancel</button></span>
                  : <button disabled={busy} onClick={() => setRestoreId(e.id)} style={{ ...actBtn, background: "transparent", color: "#e6cf8a", border: "1px solid #6b5e2e" }}>Restore</button>}
              </div>
              {restoreId === e.id && <div style={{ color: "#e6cf8a", fontSize: 11, marginTop: 4 }}>Restores it to everyone's balances exactly as it was.</div>}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16, background: "#0f2a20", border: `1px solid ${C.greenMid}`, borderRadius: 12, padding: "10px 12px" }}>
        <Eyebrow>Audit log</Eyebrow>
        {money.length === 0 && <div style={{ color: C.faint, fontSize: 12 }}>No money changes recorded yet.</div>}
        {money.map((a, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 0", borderTop: i ? `1px solid #123528` : "none" }}>
            <span style={{ color: C.cream, fontSize: 12 }}>{a.summary || a.action}</span>
            <span style={{ color: C.faint, fontSize: 11, whiteSpace: "nowrap" }}>{nameOf(a.actor_user_id || null)}</span>
          </div>
        ))}
      </div>

      {pending && (
        <ImpactModal title={pending.title} subtitle={pending.subtitle} impact={pending.impact} balancesBefore={balances} nameOf={(id) => (memberById[id]?.display_name || "someone")}
          busy={busy} confirmLabel={pending.label} danger={pending.danger}
          onCancel={() => setPending(null)} onConfirm={() => { const p = pending; setPending(null); p.run(); }} />
      )}
    </div>
  );
}

type BTransfer = { from: string; to: string; amt: number; bucketId: string };
function SettleScreen({ groups, nameOf, memberById, balances, busy, me, isAdmin, settlements, onUnmark, closedEventIds, eventName, onPay, onZelle, onMark }: {
  groups: { ev: EventRow; settled: boolean; transfers: BTransfer[]; hasExpenses: boolean }[]; nameOf: (id: string) => string;
  memberById: Record<string, Member>; balances: Record<string, number>; busy: boolean; me: string; isAdmin: boolean;
  settlements: SettlementRow[]; onUnmark: (s: SettlementRow) => void; closedEventIds: Set<string>; eventName: (id: string) => string;
  onPay: (kind: "venmo" | "paypal", t: BTransfer) => void;
  onZelle: (t: BTransfer) => void;
  onMark: (t: BTransfer) => void;
}) {
  const [confirm, setConfirm] = useState<null | { kind: "mark" | "unmark"; t?: BTransfer; s?: SettlementRow; impact: Record<string, number>; label: string }>(null);
  const askMark = (t: BTransfer) => setConfirm({ kind: "mark", t, impact: { [t.from]: t.amt, [t.to]: -t.amt }, label: "Confirm payment" });
  const askUnmark = (s2: SettlementRow) => setConfirm({ kind: "unmark", s: s2, impact: { [s2.from_user_id]: -s2.amount_cents, [s2.to_user_id]: s2.amount_cents }, label: "Confirm unmark" });
  const anyOpen = groups.some((g) => g.transfers.length > 0);
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Settle up</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 10 }}>Each Bucket squares on its own — fewest payments within it</div>
      {groups.length === 0 && <div style={{ color: "#7fd6a3", textAlign: "center", fontFamily: "Georgia, serif", fontSize: 17, padding: "22px 0" }}>✓ All square</div>}
      {groups.length > 0 && !anyOpen && <div style={{ color: "#7fd6a3", textAlign: "center", fontFamily: "Georgia, serif", fontSize: 17, padding: "16px 0 6px" }}>✓ Every Bucket is settled</div>}
      {groups.map((g) => (
        <div key={g.ev.id} style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
            <span style={{ flex: 1, color: C.gold, fontFamily: "Georgia, serif", fontSize: 14, fontWeight: 800 }}>{g.ev.is_general ? "General" : g.ev.name}</span>
            {g.transfers.length === 0 && <span style={{ color: "#7fd6a3", fontSize: 12, fontWeight: 800 }}>✓ settled</span>}
          </div>
          {g.transfers.map((t, i) => {
        const to = memberById[t.to];
        return (
          <div key={i} style={{ background: "#173a2c", borderRadius: 12, padding: 12, marginTop: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, color: C.cream, fontSize: 14 }}><b>{nameOf(t.from)}</b> pays <b>{nameOf(t.to)}</b></span>
              <span style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 17 }}>{fmtUSD(t.amt)}</span>
            </div>
            {(() => {
              const isMine = t.from === me;
              const isPayee = t.to === me;
              const canMark = isMine || isPayee || isAdmin;
              return (
                <div style={{ display: "flex", gap: 7, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
                  {isMine && to?.venmo_handle && <button disabled={busy} onClick={() => onPay("venmo", t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#3D95CE", color: "#fff" }}>Venmo</button>}
                  {isMine && to?.paypal_handle && <button disabled={busy} onClick={() => onPay("paypal", t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#003087", color: "#fff" }}>PayPal</button>}
                  {isMine && to?.zelle_handle && <button disabled={busy} onClick={() => onZelle(t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#6D1ED4", color: "#fff" }}>Zelle</button>}
                  {isMine && !to?.venmo_handle && !to?.paypal_handle && !to?.zelle_handle && <span style={{ flex: 1, color: C.sage, fontSize: 11 }}>no handle on file — pay cash</span>}
                  {canMark
                    ? <button disabled={busy} onClick={() => askMark(t)} style={{ flex: "1 1 68px", border: `1px solid ${C.line}`, borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: C.cream, color: C.green }}>{isMine ? "Mark paid" : isPayee ? "Mark received" : "Mark paid (admin)"}</button>
                    : <span style={{ flex: 1, color: C.faint, fontSize: 11.5, textAlign: "right" }}>Only {nameOf(t.from)} or {nameOf(t.to)} can mark this</span>}
                </div>
              );
            })()}
          </div>
        );
          })}
        </div>
      ))}
      {settlements.length > 0 && (
        <>
          <Eyebrow>Payments recorded</Eyebrow>
          {[...settlements].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).map((s2) => {
            const canUndo = isAdmin || s2.created_by === me;
            const inClosed = !!(s2.event_id && closedEventIds.has(s2.event_id));
            return (
              <div key={s2.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", borderBottom: `1px solid ${C.greenMid}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 13 }}><b>{nameOf(s2.from_user_id)}</b> paid <b>{nameOf(s2.to_user_id)}</b> {fmtUSD(s2.amount_cents)}</div>
                  <div style={{ color: C.faint, fontSize: 11 }}>{(s2.event_id ? eventName(s2.event_id) + " · " : "")}{s2.method || "cash"}{s2.created_at ? " · " + new Date(s2.created_at).toLocaleDateString() : ""}</div>
                </div>
                {canUndo && !inClosed && <button disabled={busy} onClick={() => askUnmark(s2)} style={{ border: `1px solid ${C.line}`, background: "transparent", color: C.sage, borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>Unmark</button>}
                {canUndo && inClosed && <span style={{ color: C.faint, fontSize: 11, whiteSpace: "nowrap" }}>{"\uD83D\uDD12"} closed</span>}
              </div>
            );
          })}
          <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Unmark reverses a payment and recomputes balances. Admins can unmark any; you can unmark ones you recorded.</div>
        </>
      )}
      {confirm && (
        <ImpactModal title={confirm.kind === "unmark" ? "Unmark this payment?" : "Record this payment?"}
          subtitle={confirm.kind === "unmark" ? "Puts the debt back on the books." : "Marks it settled and credits it across the shared expenses."}
          impact={confirm.impact} balancesBefore={balances} nameOf={nameOf} busy={busy} confirmLabel={confirm.label} danger={confirm.kind === "unmark"}
          onCancel={() => setConfirm(null)}
          onConfirm={() => { const c = confirm; setConfirm(null); if (c.kind === "mark" && c.t) onMark(c.t); else if (c.kind === "unmark" && c.s) onUnmark(c.s); }} />
      )}
    </div>
  );
}

// ---------------- Add / Edit expense ----------------
type Party = { kind: "member" | "guest"; id: string; name: string; avatar_url?: string | null; sponsor?: string };

function ImpactModal({ title, subtitle, impact, balancesBefore, nameOf, busy, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; subtitle?: string; impact: Record<string, number>; balancesBefore?: Record<string, number>; nameOf: (id: string) => string;
  busy: boolean; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const rows = Object.entries(impact).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const bb = balancesBefore || {};
  const haveBal = !!balancesBefore;
  const fmtBal = (v: number) => Math.abs(v) < 1 ? "settled up" : v > 0 ? `owed ${fmtUSD(v)}` : `owes ${fmtUSD(-v)}`;
  const balColor = (v: number) => Math.abs(v) < 1 ? C.sage : v > 0 ? "#7fd6a3" : "#ef9d90";
  return (
    <BottomSheet onClose={onCancel} maxWidth={520}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800, paddingRight: 32 }}>{title}</div>
        {subtitle && <div style={{ color: C.sage, fontSize: 12.5, marginTop: 4, lineHeight: 1.5 }}>{subtitle}</div>}
        <div style={{ marginTop: 12 }}>
          {rows.length === 0 && <div style={{ color: C.sage, fontSize: 12.5 }}>No change to anyone&rsquo;s balance.</div>}
          {haveBal ? rows.map(([id, delta]) => {
            const before = bb[id] || 0; const after = before + delta;
            return (
              <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid #123528`, gap: 10 }}>
                <span style={{ color: C.cream, fontSize: 13, flexShrink: 0 }}>{nameOf(id)}</span>
                <span style={{ fontSize: 12.5, textAlign: "right", minWidth: 0 }}>
                  <span style={{ color: C.sage }}>{fmtBal(before)}</span>
                  <span style={{ color: C.sage }}> &rarr; </span>
                  <span style={{ color: balColor(after), fontWeight: 800, fontFamily: "Georgia, serif" }}>{fmtBal(after)}</span>
                </span>
              </div>
            );
          }) : rows.map(([id, v]) => (
            <div key={id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderTop: `1px solid #123528` }}>
              <span style={{ color: C.cream, fontSize: 13 }}>{nameOf(id)}</span>
              <span style={{ color: v >= 0 ? "#7fd6a3" : "#ef9d90", fontWeight: 800, fontSize: 13.5, fontFamily: "Georgia, serif" }}>{v >= 0 ? "+" : "\u2212"}{fmtUSD(Math.abs(v))}</span>
            </div>
          ))}
        </div>
        {rows.length > 0 && <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>{haveBal ? "Each person\u2019s club balance after this. \u201cowed\u201d = the club owes them \u00b7 \u201cowes\u201d = they owe the club." : "+ their balance rises (owed more / owes less) \u00b7 \u2212 their balance falls. Always nets to $0 across the club."}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button disabled={busy} onClick={onConfirm} style={{ ...btn(true), flex: 1, background: danger ? "#d98b80" : "#7fd6a3", color: danger ? "#3a1712" : C.green }}>{confirmLabel}</button>
          <button disabled={busy} onClick={onCancel} style={{ ...btn(false), flex: 0, padding: "10px 18px" }}>Cancel</button>
        </div>
    </BottomSheet>
  );
}

function AddExpense({ user, gid, members, guests, balances, busy, setBusy, requireOnline, onAddGuest, onSaved, openEvents, onCreateEvent, defaultEventId, editing, editShares, editPayers, editHistory, onLog, canDelete, onDelete }: {
  user: { id: string }; gid: string; members: Member[]; guests: GuestRow[]; balances: Record<string, number>; busy: boolean; setBusy: (b: boolean) => void;
  requireOnline: () => boolean;
  onAddGuest: (name: string) => Promise<void>;
  onSaved: () => Promise<void>;
  openEvents: EventRow[]; onCreateEvent: (name: string) => Promise<string | null>; defaultEventId?: string | null;
  editing?: ExpenseRow | null; editShares?: ShareRow[]; editPayers?: PayerRow[]; editHistory?: any[]; onLog?: (action: string, summary: string, meta?: any) => Promise<void>; canDelete?: boolean; onDelete?: () => Promise<void>;
}) {
  const skey = (s: ShareRow) => (s.user_id ? "u:" + s.user_id : "g:" + s.guest_id);
  const [eventId, setEventId] = useState<string | null>(editing?.event_id ?? defaultEventId ?? null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [newEventName, setNewEventName] = useState("");
  const [desc, setDesc] = useState(editing?.description || "");
  const [amount, setAmount] = useState(editing ? (editing.amount_cents / 100).toString() : "");
  const initP = editPayers || [];
  const [payer, setPayer] = useState(initP[0]?.user_id || editing?.payer_user_id || ""); // no default payer on a new expense - must be chosen
  const [multiPayer, setMultiPayer] = useState(initP.length > 1);
  const [payerSet, setPayerSet] = useState<Set<string>>(new Set(initP.length ? initP.map((p) => p.user_id).filter((x): x is string => !!x) : (editing?.payer_user_id ? [editing.payer_user_id] : [])));
  const [payerAmt, setPayerAmt] = useState<Record<string, string>>(Object.fromEntries(initP.filter((p) => p.user_id).map((p) => [p.user_id as string, (p.paid_cents / 100).toString()])));
  const [mode, setMode] = useState<"even" | "custom">(editing?.split_type || "even");
  const [checked, setChecked] = useState<Set<string>>(new Set((editShares || []).map(skey)));
  const [custom, setCustom] = useState<Record<string, string>>(Object.fromEntries((editShares || []).map((s) => [skey(s), (s.share_cents / 100).toString()])));
  const [showGuest, setShowGuest] = useState(false);
  const [gName, setGName] = useState("");
  // Per-EXPENSE guest sponsor (guestId -> memberId). Chosen on the expense, not on the guest.
  const [guestSponsors, setGuestSponsors] = useState<Record<string, string>>(
    Object.fromEntries((editShares || []).filter((s) => s.guest_id).map((s) => [s.guest_id as string, s.sponsor_user_id || ""]))
  );

  const parties: Party[] = [
    ...members.map((m) => ({ kind: "member" as const, id: m.id, name: m.display_name, avatar_url: m.avatar_url })),
    ...guests.filter((g) => !g.archived && !g.source_game_id).map((g) => ({ kind: "guest" as const, id: g.id, name: g.name })),
  ];
  const keyOf = (p: Party) => (p.kind === "member" ? "u:" : "g:") + p.id;
  const amtCents = Math.round((parseFloat(amount) || 0) * 100);
  const centsOf = (str?: string) => Math.round((parseFloat(str || "") || 0) * 100);
  const selected = parties.filter((p) => checked.has(keyOf(p)));
  const guestsMissingSponsor = selected.some((p) => p.kind === "guest" && !guestSponsors[p.id]);

  const evenMap: Record<string, number> = {};
  if (mode === "even" && selected.length) { const arr = evenShares(amtCents, selected.length); selected.forEach((p, i) => { evenMap[keyOf(p)] = arr[i]; }); }
  const shareOf = (p: Party) => mode === "even" ? (evenMap[keyOf(p)] || 0) : centsOf(custom[keyOf(p)]);
  const customSum = selected.reduce((s, p) => s + centsOf(custom[keyOf(p)]), 0);
  const customOk = mode === "even" || validateCustomTotal(selected.map((p) => centsOf(custom[keyOf(p)])), amtCents);
  const paidPayers = multiPayer ? members.filter((mm) => payerSet.has(mm.id)).map((mm) => mm.id) : (payer ? [payer] : []);
  const paidSum = multiPayer ? paidPayers.reduce((s, uid) => s + centsOf(payerAmt[uid]), 0) : amtCents;
  const paidOk = !multiPayer || (paidPayers.length > 0 && paidSum === amtCents);
  const canSave = !!desc.trim() && amtCents > 0 && selected.length > 0 && customOk && paidOk && paidPayers.length > 0 && !guestsMissingSponsor && !busy;
  const togglePayer = (uid: string) => { const n = new Set(payerSet); n.has(uid) ? n.delete(uid) : n.add(uid); setPayerSet(n); };
  const splitPayersEven = () => { const ids = members.filter((mm) => payerSet.has(mm.id)).map((mm) => mm.id); const arr = evenShares(amtCents, ids.length); const nm: Record<string, string> = {}; ids.forEach((uid, i) => { nm[uid] = (arr[i] / 100).toString(); }); setPayerAmt(nm); };
  const runningRemain = (order: string[], amtOf: (k: string) => number, isSel: (k: string) => boolean) => {
    const out: Record<string, number> = {}; let run = 0;
    order.forEach((k) => { if (isSel(k)) { run += amtOf(k); out[k] = amtCents - run; } });
    return out;
  };
  const splitRemainAfter = runningRemain(parties.map(keyOf), (k) => centsOf(custom[k]), (k) => checked.has(k));
  const payRemainAfter = runningRemain(members.map((mm) => mm.id), (k) => centsOf(payerAmt[k]), (k) => payerSet.has(k));
  const remHint = (v: number | undefined): React.CSSProperties => ({ fontSize: 11, whiteSpace: "nowrap", color: v === 0 ? "#7fd6a3" : (v ?? 0) < 0 ? "#ef9d90" : C.sage });

  const toggle = (p: Party) => { const k = keyOf(p); const n = new Set(checked); n.has(k) ? n.delete(k) : n.add(k); setChecked(n); };

  const [pendingConfirm, setPendingConfirm] = useState<null | { mode: "save" | "void"; impact: Record<string, number>; label: string }>(null);
  const impactName = (id: string) => members.find((mm) => mm.id === id)?.display_name || "someone";
  const buildImpact = (voiding: boolean) => {
    const afterShares = voiding ? [] : selected.map((p) => ({ member: p.kind === "member" ? p.id : (guestSponsors[p.id] || ""), cents: shareOf(p) })).filter((x) => x.member);
    const afterPaid = voiding ? [] : paidPayers.map((uid) => ({ member: uid, cents: multiPayer ? centsOf(payerAmt[uid]) : amtCents }));
    const beforeShares = editing ? (editShares || []).map((sr) => ({ member: (sr.user_id || sr.sponsor_user_id || "") as string, cents: sr.share_cents })).filter((x) => x.member) : [];
    const beforePaid = editing ? (editPayers || []).map((pr) => ({ member: (pr.user_id || "") as string, cents: pr.paid_cents })).filter((x) => x.member) : [];
    return expenseImpact(beforeShares, beforePaid, afterShares, afterPaid);
  };
  const save = () => { if (!requireOnline() || !canSave) return; setPendingConfirm({ mode: "save", impact: buildImpact(false), label: editing ? "Confirm changes" : "Confirm & add" }); };
  const askVoid = () => { if (!requireOnline()) return; setPendingConfirm({ mode: "void", impact: buildImpact(true), label: "Confirm void" }); };
  async function commit() {
    if (!requireOnline() || !canSave) return;
    setPendingConfirm(null);
    setBusy(true);
    const primaryPayer = paidPayers[0];
    const payload = { payer_user_id: primaryPayer, description: desc.trim(), amount_cents: amtCents, split_type: mode, event_id: eventId };
    let expId = editing?.id;
    if (editing) {
      const { error } = await supabase.from("expenses").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", editing.id);
      if (error) { setBusy(false); alert("Couldn't update the expense."); return; }
      await supabase.from("expense_shares").delete().eq("expense_id", editing.id);
    } else {
      const { data: exp, error } = await supabase.from("expenses").insert({ group_id: gid, created_by: user.id, ...payload }).select("id").single();
      if (error || !exp) { setBusy(false); alert("Couldn't save the expense."); return; }
      expId = exp.id;
    }
    const rows = selected.map((p) => ({
      expense_id: expId,
      user_id: p.kind === "member" ? p.id : null,
      guest_id: p.kind === "guest" ? p.id : null,
      sponsor_user_id: p.kind === "guest" ? (guestSponsors[p.id] || null) : null,
      share_cents: shareOf(p),
    }));
    const shErr = (await supabase.from("expense_shares").insert(rows)).error;
    await supabase.from("expense_payers").delete().eq("expense_id", expId);
    const pyErr = (await supabase.from("expense_payers").insert(paidPayers.map((uid) => ({ expense_id: expId, user_id: uid, paid_cents: multiPayer ? centsOf(payerAmt[uid]) : amtCents })))).error;
    if (shErr || pyErr) {
      // Never leave a broken expense (payer credited but no shares => wrong balances).
      // New expense: remove it entirely (shares/payers cascade). Edit: surface so they can re-enter.
      if (!editing && expId) await supabase.from("expenses").delete().eq("id", expId);
      setBusy(false);
      alert(editing
        ? "The amount saved but the split didn't record — please reopen this expense and re-enter the split."
        : "Couldn't save the split, so nothing was saved. Check your connection and try again."
          + (pyErr && !shErr ? " (If this persists, the payers migration 0049 may not be applied yet.)" : ""));
      return;
    }
    await onLog?.(editing ? "expense_edited" : "expense_created", (editing ? "edited “" : "added “") + (desc.trim() || "expense") + "” — " + fmtUSD(amtCents), { expense_id: expId, amount_cents: amtCents });
    setBusy(false);
    await onSaved();
  }

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800, marginBottom: 4 }}>{editing ? "Edit expense" : "Add an expense"}</div>
      <Eyebrow>Description</Eyebrow>
      <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Saturday tee times" style={inputStyle} />
      <Eyebrow>Amount (USD)</Eyebrow>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="0.00" style={inputStyle} />

      <div style={{ display: "flex", alignItems: "center", marginTop: 8 }}>
        <Eyebrow>Paid by</Eyebrow>
        <span style={{ flex: 1 }} />
        <button onClick={() => setMultiPayer((v) => !v)} style={linkBtn}>{multiPayer ? "Single payer" : "Multiple payers"}</button>
      </div>
      {!multiPayer ? (
        <select value={payer} onChange={(e) => setPayer(e.target.value)} style={inputStyle}>
          <option value="">Select who paid</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
        </select>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center" }}>
            {amtCents > 0 ? <div style={{ flex: 1 }}><Remaining total={amtCents} allocated={paidSum} /></div> : <span style={{ flex: 1 }} />}
            <button onClick={splitPayersEven} disabled={!(amtCents > 0 && payerSet.size > 0)} style={{ ...linkBtn, opacity: amtCents > 0 && payerSet.size > 0 ? 1 : 0.5 }}>Split evenly</button>
          </div>
          {members.map((m) => {
            const on = payerSet.has(m.id);
            return (
              <div key={m.id} onClick={() => togglePayer(m.id)} style={{ display: "flex", alignItems: "center", gap: 9, background: on ? "#1c4536" : "#173a2c", border: `1.5px solid ${on ? "#3c6f59" : "transparent"}`, borderRadius: 10, padding: "8px 10px", marginTop: 6, cursor: "pointer" }}>
                <span style={{ width: 19, height: 19, borderRadius: 5, border: `2px solid ${on ? C.gold : C.sage}`, background: on ? C.gold : "transparent", color: "#2a2410", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12 }}>{on ? "✓" : ""}</span>
                <Avatar src={m.avatar_url} name={m.display_name} size={24} />
                <span style={{ flex: 1, color: C.cream, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{m.display_name}</span>
                {on && <span style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <input inputMode="decimal" placeholder="0.00" value={payerAmt[m.id] ?? ""} onChange={(e) => setPayerAmt((c) => ({ ...c, [m.id]: e.target.value }))} style={{ ...inputStyle, width: 68, textAlign: "right", padding: "6px 8px" }} />
                  <span style={remHint(payRemainAfter[m.id])}>/ {fmtUSD(payRemainAfter[m.id] ?? amtCents)} left</span>
                </span>}
              </div>
            );
          })}
        </>
      )}

      <Eyebrow>Bucket</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => { setEventId(defaultEventId ?? null); setNewEventOpen(false); }} style={chip((eventId === (defaultEventId ?? null) || eventId === null) && !newEventOpen)}>General</button>
        {openEvents.filter((ev) => !ev.is_general).map((ev) => (
          <button key={ev.id} onClick={() => { setEventId(ev.id); setNewEventOpen(false); }} style={chip(eventId === ev.id)}>
            {ev.name}
          </button>
        ))}
        <button onClick={() => { setNewEventOpen(true); setEventId(null); }} style={{ ...chip(newEventOpen), borderStyle: "dashed" }}>＋ New Bucket</button>
      </div>
      {newEventOpen && (
        <div style={{ background: "#0f3529", borderRadius: 10, padding: 10, marginTop: 8 }}>
          <input value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Bucket name (e.g. Ireland Trip)" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", justifyContent: "flex-end" }}>
            <button disabled={busy || !newEventName.trim()} onClick={async () => {
              const id = await onCreateEvent(newEventName);
              if (id) { setEventId(id); setNewEventOpen(false); setNewEventName(""); }
            }} style={{ ...btn(true), flex: 0, padding: "8px 18px", opacity: (busy || !newEventName.trim()) ? 0.5 : 1 }}>Create Bucket</button>
          </div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Date is optional. Anyone can add expenses to this event until an admin closes it.</div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center" }}>
        <Eyebrow>Split between</Eyebrow>
        <span style={{ flex: 1, color: C.sage, fontSize: 11, marginLeft: 8 }}>{selected.length} of {parties.length} selected{mode === "even" && amtCents > 0 && selected.length ? ` · ${fmtUSD(Math.floor(amtCents / selected.length))} each` : ""}</span>
        {parties.length > 0 && (() => { const allOn = parties.every((p) => checked.has(keyOf(p)));
          return <button onClick={() => setChecked(allOn ? new Set() : new Set(parties.map(keyOf)))} style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "2px 0" }}>{allOn ? "Deselect all" : "Select all"}</button>; })()}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
        <button onClick={() => setMode("even")} style={chip(mode === "even")}>Split evenly</button>
        <button onClick={() => setMode("custom")} style={chip(mode === "custom")}>Custom</button>
      </div>
      {mode === "custom" && amtCents > 0 && <Remaining total={amtCents} allocated={customSum} />}
      {parties.map((p) => {
        const on = checked.has(keyOf(p));
        const isGuest = p.kind === "guest";
        const needSponsor = isGuest && on && !guestSponsors[p.id];
        return (
          <div key={keyOf(p)}>
          <div onClick={() => toggle(p)} style={{ display: "flex", alignItems: "center", gap: 9, background: on ? "#1c4536" : "#173a2c", border: `1.5px solid ${on ? "#3c6f59" : "transparent"}`, borderBottom: isGuest && on ? "none" : undefined, borderRadius: isGuest && on ? "10px 10px 0 0" : 10, padding: "8px 10px", marginTop: 6, cursor: "pointer" }}>
            <span style={{ width: 19, height: 19, borderRadius: 5, border: `2px solid ${on ? C.gold : C.sage}`, background: on ? C.gold : "transparent", color: "#2a2410", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12 }}>{on ? "✓" : ""}</span>
            <Avatar src={p.avatar_url} name={p.name} size={24} />
            <span style={{ flex: 1, color: C.cream, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{p.name}{isGuest ? <span style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}> · guest</span> : ""}</span>
            {on && (mode === "even"
              ? <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontWeight: 700 }}>{fmtUSD(shareOf(p))}</span>
              : <span style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <input inputMode="decimal" placeholder="0.00" value={custom[keyOf(p)] ?? ""} onChange={(e) => setCustom((c) => ({ ...c, [keyOf(p)]: e.target.value }))} style={{ ...inputStyle, width: 68, textAlign: "right", padding: "6px 8px" }} />
                  <span style={remHint(splitRemainAfter[keyOf(p)])}>/ {fmtUSD(splitRemainAfter[keyOf(p)] ?? amtCents)} left</span>
                </span>)}
          </div>
          {isGuest && on && (
            <div onClick={(e) => e.stopPropagation()} style={{ background: "#14352b", border: `1.5px solid ${needSponsor ? C.birdie : "#3c6f59"}`, borderTop: "none", borderRadius: "0 0 10px 10px", padding: "8px 10px 9px 38px" }}>
              <FieldLabel>
                Sponsored by {needSponsor ? <span style={{ color: C.birdie }}>· required</span> : <span style={{ color: "#7fbf9c" }}>✓</span>}
              </FieldLabel>
              <select value={guestSponsors[p.id] || ""} onChange={(e) => setGuestSponsors((s) => ({ ...s, [p.id]: e.target.value }))}
                style={{ ...inputStyle, padding: "8px 11px", fontSize: 14, borderColor: needSponsor ? C.birdie : C.line, color: needSponsor ? C.faint : C.ink }}>
                <option value="">Select member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>
          )}
          </div>
        );
      })}

      {!showGuest
        ? <button onClick={() => setShowGuest(true)} style={{ ...btn(false), marginTop: 10 }}>+ Add a guest</button>
        : (
          <div style={{ background: "#173a2c", borderRadius: 10, padding: 10, marginTop: 10 }}>
            <Eyebrow>Guest name</Eyebrow>
            <input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="e.g. Sam" style={inputStyle} />
            <div style={{ color: C.faint, fontSize: 11, marginTop: 7, lineHeight: 1.45 }}>You'll pick who's covering them on each expense they're part of.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={!gName.trim()} onClick={async () => { await onAddGuest(gName.trim()); setGName(""); setShowGuest(false); }} style={{ ...btn(true), flex: 1 }}>Add guest</button>
              <button onClick={() => setShowGuest(false)} style={{ ...btn(false), flex: 1 }}>Cancel</button>
            </div>
          </div>
        )}

      {guestsMissingSponsor && <div style={{ color: C.birdie, fontSize: 11.5, fontWeight: 700, marginTop: 8 }}>Choose a sponsor for each guest before saving.</div>}

      <button disabled={!canSave} onClick={save} style={{ ...btn(true), marginTop: 14, opacity: canSave ? 1 : 0.5 }}>{editing ? "Save changes" : "Add expense"}</button>
      {editing && canDelete && (
        <button disabled={busy} onClick={askVoid}
          style={{ ...btn(false), marginTop: 8, color: C.birdie, borderColor: C.birdie }}>Void expense</button>
      )}
      {pendingConfirm && (
        <ImpactModal title={pendingConfirm.mode === "void" ? "Void “" + (desc.trim() || editing?.description || "expense") + "”?" : (editing ? "Save these changes?" : "Add this expense?")}
          subtitle={pendingConfirm.mode === "void" ? "Removes it from everyone's balances (kept in the audit log)." : "Here's how it changes each person's balance."}
          impact={pendingConfirm.impact} balancesBefore={balances} nameOf={impactName} busy={busy} confirmLabel={pendingConfirm.label} danger={pendingConfirm.mode === "void"}
          onCancel={() => setPendingConfirm(null)}
          onConfirm={async () => { if (pendingConfirm.mode === "void") { setPendingConfirm(null); setBusy(true); await onDelete?.(); } else { await commit(); } }} />
      )}
      {editing && (editHistory || []).length > 0 && (
        <div style={{ marginTop: 16, borderTop: `1px solid ${C.greenMid}`, paddingTop: 12 }}>
          <Eyebrow>History</Eyebrow>
          {(editHistory || []).map((h) => (
            <div key={h.id} style={{ color: C.sage, fontSize: 11.5, padding: "3px 0" }}>
              {h.action === "expense_created" ? "Created" : "Edited"} by {members.find((mm) => mm.id === h.actor_user_id)?.display_name || "Someone"} · {new Date(h.created_at).toLocaleDateString()} · {fmtUSD(h.meta?.amount_cents || 0)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Shared bits for rendering a frozen snapshot's allocation (used by both the live
// ExpenseDetail version history and the read-only SnapshotDetail for deleted rows).
const fmtWhen = (iso?: string) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const verbFor = (a: string) => (a === "created" ? "Created" : a === "deleted" ? "Voided" : "Edited");

function SnapshotBody({ snap }: { snap: AuditSnapshot }) {
  const payers = snap.payers || [];
  const shares = snap.shares || [];
  return (
    <>
      <Eyebrow>Paid by</Eyebrow>
      {(payers.length ? payers : [{ name: snap.created_by_name || "?", paid_cents: snap.amount_cents || 0 }]).map((r, i) => (
        <div key={i} style={{ display: "flex", color: C.cream, fontSize: 13.5, padding: "3px 0" }}><span style={{ flex: 1 }}>{r.name}</span><span style={{ color: C.gold }}>{fmtUSD(r.paid_cents)}</span></div>
      ))}
      <Eyebrow>Split · {shares.length} {shares.length === 1 ? "person" : "people"}</Eyebrow>
      {shares.map((s, i) => (
        <div key={i} style={{ display: "flex", color: C.cream, fontSize: 13.5, padding: "3px 0" }}><span style={{ flex: 1 }}>{s.name}{s.is_guest ? " (guest)" : ""}</span><span style={{ color: C.sage }}>{fmtUSD(s.share_cents)}</span></div>
      ))}
    </>
  );
}

// Read-only detail for an expense that no longer exists live (deleted). Rendered
// entirely from the frozen money_audit snapshot, so the full allocation survives.
function SnapshotDetail({ snap, at, onClose }: { snap: AuditSnapshot; at?: string; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose} maxWidth={520}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingRight: 32 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{snap.description || "Expense"}</div>
          <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800 }}>{fmtUSD(snap.amount_cents || 0)}</div>
        </div>
        <div style={{ display: "inline-block", background: "#5a2d2d", color: "#ffd9d9", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 10, marginTop: 6 }}>VOIDED{at ? " · " + fmtWhen(at) : ""}</div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>entered by {snap.created_by_name || "someone"}</div>
        <SnapshotBody snap={snap} />
        <div style={{ color: C.sage, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>This expense was voided. The allocation above is the record as it stood when it was voided — kept for the club's audit trail and can't be edited.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn(false), flex: 1 }}>Close</button>
        </div>
    </BottomSheet>
  );
}

function ExpenseDetail({ expense, shares, payers, memberById, guestById, versions, openEvents, currentEvent, canEdit, canMove, onMove, onEdit, onClose }: {
  expense: ExpenseRow; shares: ShareRow[]; payers: PayerRow[];
  memberById: Record<string, Member>; guestById: Record<string, GuestRow>;
  versions: AuditVersion[]; openEvents: EventRow[]; currentEvent: EventRow | null;
  canEdit: boolean; canMove: boolean; onMove: (eventId: string | null) => void; onEdit: () => void; onClose: () => void;
}) {
  const [moving, setMoving] = useState(false);
  const [openVer, setOpenVer] = useState<number | null>(null);
  const prs = payers.filter((p) => p.expense_id === expense.id);
  const parts = shares.filter((s) => s.expense_id === expense.id);
  return (
    <BottomSheet onClose={onClose} maxWidth={520}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingRight: 32 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{expense.description || "Expense"}</div>
          <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800 }}>{fmtUSD(expense.amount_cents)}</div>
        </div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{new Date(expense.created_at).toLocaleDateString()}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ color: C.sage, fontSize: 12 }}>Event:</span>
          <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 700, flex: 1 }}>
            {currentEvent ? currentEvent.name : "Ungrouped"}{currentEvent?.status === "closed" ? " · closed" : ""}
          </span>
          {canMove && !moving && <button onClick={() => setMoving(true)} style={{ border: `1px solid ${C.greenMid}`, background: "transparent", color: C.sage, fontSize: 11, fontWeight: 800, padding: "5px 10px", borderRadius: 8, cursor: "pointer" }}>Move</button>}
        </div>
        {moving && (
          <div style={{ background: "#0f3529", borderRadius: 10, padding: 10, marginTop: 8 }}>
            <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>Move this expense to an open event (or ungroup):</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => onMove(null)} style={chip(!currentEvent)}>Ungrouped</button>
              {openEvents.map((ev) => (
                <button key={ev.id} onClick={() => onMove(ev.id)} style={chip(currentEvent?.id === ev.id)}>{ev.name}</button>
              ))}
            </div>
          </div>
        )}

        <Eyebrow>Paid by</Eyebrow>
        {prs.length ? prs.map((p, i) => {
          const isGuest = !p.user_id && !!p.guest_id;
          const nm = p.user_id ? (memberById[p.user_id]?.display_name || "?") : (guestById[p.guest_id || ""]?.name || "guest");
          const sid = isGuest ? (p.sponsor_user_id || guestById[p.guest_id || ""]?.sponsor_user_id || null) : null;
          const sponsor = sid ? (memberById[sid]?.display_name || "their sponsor") : null;
          return (
            <div key={i} style={{ display: "flex", alignItems: "baseline", color: C.cream, fontSize: 13.5, padding: "3px 0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span>{nm}</span>
                {isGuest && sponsor && <div style={{ color: C.sage, fontSize: 11 }}>guest of {sponsor} · {sponsor} is paid this</div>}
              </div>
              <span style={{ color: C.gold }}>{fmtUSD(p.paid_cents)}</span>
            </div>
          );
        }) : (
          <div style={{ display: "flex", color: C.cream, fontSize: 13.5, padding: "3px 0" }}><span style={{ flex: 1 }}>{memberById[expense.payer_user_id]?.display_name || "?"}</span><span style={{ color: C.gold }}>{fmtUSD(expense.amount_cents)}</span></div>
        )}

        <Eyebrow>Split · {parts.length} {parts.length === 1 ? "person" : "people"}</Eyebrow>
        {parts.map((s, i) => {
          const isGuest = !s.user_id && !!s.guest_id;
          const nm = s.user_id ? (memberById[s.user_id]?.display_name || "?") : (guestById[s.guest_id || ""]?.name || "guest");
          const sid = isGuest ? (s.sponsor_user_id || guestById[s.guest_id || ""]?.sponsor_user_id || null) : null;
          const sponsor = sid ? (memberById[sid]?.display_name || "their sponsor") : null;
          return (
            <div key={s.id || i} style={{ display: "flex", alignItems: "baseline", color: C.cream, fontSize: 13.5, padding: "3px 0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span>{nm}{isGuest ? " (guest)" : ""}</span>
                {isGuest && sponsor && <div style={{ color: C.sage, fontSize: 11 }}>guest of {sponsor} · {sponsor} pays this</div>}
              </div>
              <span style={{ color: C.sage }}>{fmtUSD(s.share_cents)}</span>
            </div>
          );
        })}
        {parts.some((s) => !s.user_id && s.guest_id) && (
          <div style={{ color: C.sage, fontSize: 11, marginTop: 6, lineHeight: 1.45 }}>Guests don’t settle directly — a guest’s share is paid, and a guest’s winnings received, by their sponsoring member.</div>
        )}

        {versions.length > 0 && (<>
          <Eyebrow>History · {versions.length} {versions.length === 1 ? "change" : "changes"}</Eyebrow>
          {versions.map((v, i) => {
            const who = (v.actor_id && memberById[v.actor_id]?.display_name) || v.snapshot?.created_by_name || "Someone";
            const isOpen = openVer === i;
            const expandable = !!v.snapshot;
            return (
              <div key={i} style={{ borderBottom: `1px solid ${C.greenMid}`, padding: "6px 0" }}>
                <div onClick={expandable ? () => setOpenVer(isOpen ? null : i) : undefined}
                  style={{ display: "flex", alignItems: "center", gap: 8, cursor: expandable ? "pointer" : "default" }}>
                  <span style={{ color: C.gold, fontSize: 13, width: 16, textAlign: "center" }}>{v.action === "created" ? "+" : v.action === "deleted" ? "✕" : "✎"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.cream, fontSize: 12.5 }}>{verbFor(v.action)} by {who}</div>
                    <div style={{ color: C.sage, fontSize: 11 }}>{fmtWhen(v.at)}{v.snapshot?.amount_cents != null ? " · " + fmtUSD(v.snapshot.amount_cents) : ""}</div>
                  </div>
                  {expandable && <span style={{ color: C.sage, fontSize: 13 }}>{isOpen ? "▾" : "›"}</span>}
                </div>
                {isOpen && v.snapshot && (
                  <div style={{ background: "#123528", borderRadius: 10, padding: "6px 10px", marginTop: 6 }}>
                    <SnapshotBody snap={v.snapshot} />
                  </div>
                )}
              </div>
            );
          })}
        </>)}

        <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
          {canEdit && <button onClick={onEdit} style={{ ...btn(true), flex: 1 }}>Edit</button>}
          <button onClick={onClose} style={{ ...btn(false), flex: 1 }}>Close</button>
        </div>
        {!canEdit && <div style={{ color: C.sage, fontSize: 11, marginTop: 8, textAlign: "center" }}>View only — only the person who entered this or a club admin can edit it.</div>}
    </BottomSheet>
  );
}

const ACT_ICON: Record<string, string> = { expense_created: "+", expense_edited: "✎", expense_deleted: "✕", settlement_added: "✓", guest_added: "☺" };
function ActivityLog({ activity, memberById, onOpenExpense, canOpen }: { activity: any[]; memberById: Record<string, Member>; onOpenExpense?: (expenseId: string) => void; canOpen?: (expenseId: string) => boolean }) {
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Activity log</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Everything that's happened with the club's money · visible to all, cannot be edited</div>
      {activity.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: "8px 2px" }}>Nothing logged yet.</div>}
      {activity.map((a) => {
        const who = memberById[a.actor_user_id]?.display_name || "Someone";
        const eid = a?.meta?.expense_id;
        const isExpenseEvent = eid && (a.action === "expense_created" || a.action === "expense_edited" || a.action === "expense_deleted");
        const openable = !!isExpenseEvent && (canOpen ? canOpen(eid) : a.action !== "expense_deleted");
        return (
          <div key={a.id} onClick={openable ? () => onOpenExpense?.(eid) : undefined}
            style={{ display: "flex", gap: 9, padding: "9px 2px", borderBottom: `1px solid ${C.greenMid}`, cursor: openable ? "pointer" : "default", alignItems: "center" }}>
            <span style={{ fontSize: 14, width: 18, textAlign: "center", color: C.gold }}>{ACT_ICON[a.action] || "•"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontSize: 13 }}><b>{who}</b> {a.summary}</div>
              <div style={{ color: C.faint, fontSize: 11 }}>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{a.action === "expense_deleted" && openable ? " · tap to see the voided detail" : ""}</div>
            </div>
            {openable && <span style={{ color: C.sage, fontSize: 16 }}>&#8250;</span>}
          </div>
        );
      })}
    </div>
  );
}

// Plain-language breakdown of how a person's balance was built — raw obligations,
// grouped by event, NOT the simplified who-pays-whom. Reconciles to the shown net.
function PersonLedgerModal({ memberId, me, name, net, expenses, shares, settlements, allocations, guests, payers, events, memberById, onClose }: {
  memberId: string; me: string; name: string; net: number;
  expenses: ExpenseRow[]; shares: ShareRow[]; settlements: SettlementRow[]; allocations: { settlement_id: string; expense_id: string | null; amount_cents: number }[]; guests: GuestRow[]; payers: PayerRow[];
  events: EventRow[]; memberById: Record<string, Member>; onClose: () => void;
}) {
  const nameOf = (uid: string | null) => (uid ? (memberById[uid]?.display_name || "someone") : "someone");
  const evName = (id: string | null) => (id ? (events.find((e) => e.id === id)?.name || "Event") : "Ungrouped");
  const { lines } = personLedger(memberId, expenses as any, shares as any, settlements as any, guests as any, payers as any, nameOf, allocations, evName);
  // group lines by event bucket (settlements have no event → "Payments")
  const buckets: { key: string; title: string; lines: LedgerLine[] }[] = [];
  const push = (key: string, title: string, l: LedgerLine) => {
    let b = buckets.find((x) => x.key === key);
    if (!b) { b = { key, title, lines: [] }; buckets.push(b); }
    b.lines.push(l);
  };
  for (const l of lines) {
    if (l.kind === "settle_out" || l.kind === "settle_in") push("__pay", "Payments", l);
    else push(l.eventId || "__ung", evName(l.eventId), l);
  }
  const who = memberId === me ? "You" : name;
  return (
    <BottomSheet onClose={onClose} maxWidth={520}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, paddingRight: 32 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{name}{memberId === me ? " (you)" : ""}</div>
          <div style={{ color: net > 0 ? "#7fd6a3" : net < 0 ? "#ef9d90" : C.sage, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
            {net > 0 ? "owed " + fmtUSD(net) : net < 0 ? "owes " + fmtUSD(-net) : "settled"}
          </div>
        </div>
        <div style={{ color: C.sage, fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>How this number is built, item by item. This is the raw list — who ultimately pays whom is decided separately on the Settle tab.</div>

        {lines.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: "12px 2px" }}>No expenses or payments yet.</div>}
        {buckets.map((b) => (
          <div key={b.key} style={{ marginTop: 14 }}>
            <Eyebrow>{b.title.toUpperCase()}</Eyebrow>
            {b.lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.greenMid}`, alignItems: "center" }}>
                <span style={{ flex: 1, color: C.cream, fontSize: 13, lineHeight: 1.4 }}>{l.label}</span>
                <span style={{ color: l.delta > 0 ? "#7fd6a3" : "#ef9d90", fontWeight: 800, fontSize: 13, whiteSpace: "nowrap" }}>{l.delta > 0 ? "+" : "\u2212"}{fmtUSD(Math.abs(l.delta))}</span>
              </div>
            ))}
          </div>
        ))}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, paddingTop: 10, borderTop: `2px solid ${C.greenMid}` }}>
          <span style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{who === "You" ? "Your balance" : "Balance"}</span>
          <span style={{ color: net > 0 ? "#7fd6a3" : net < 0 ? "#ef9d90" : C.sage, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15 }}>{net > 0 ? "+" : net < 0 ? "\u2212" : ""}{fmtUSD(Math.abs(net))}</span>
        </div>
        <button onClick={onClose} style={{ ...btn(false), width: "100%", marginTop: 16 }}>Close</button>
    </BottomSheet>
  );
}

// Balances → expenses grouped into event islands (open events, Ungrouped, then a
// collapsed Closed section). Per-event nets come from eventNet(); settlement stays
// group-wide (handled elsewhere). Reuses one row renderer for every expense.
function EventGroupedExpenses({ expenses, shares, payers, guests, events, memberById, guestById, partyCount, settlements, allocations, me, isAdmin, onView, onCloseEvent }: {
  expenses: ExpenseRow[]; shares: ShareRow[]; payers: PayerRow[]; guests: GuestRow[]; events: EventRow[];
  memberById: Record<string, Member>; guestById: Record<string, GuestRow>; partyCount: number;
  settlements: SettlementRow[]; allocations: { settlement_id: string; expense_id: string | null; amount_cents: number }[]; me: string;
  isAdmin: boolean; onView: (e: ExpenseRow) => void;
  onCloseEvent: (ev: EventRow, closed: boolean) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const byEv = useMemo(() => expensesByEvent(expenses), [expenses]);
  const openEvents = events.filter((e) => e.status === "open");
  const closedEvents = events.filter((e) => e.status === "closed");
  const ungrouped = byEv[""] || [];

  const row = (e: ExpenseRow) => {
    const payer = memberById[e.payer_user_id];
    const prs = payers.filter((p) => p.expense_id === e.id);
    const paidNames = prs.length ? prs.map((p) => p.user_id ? (memberById[p.user_id]?.display_name || "?") : (guestById[p.guest_id || ""]?.name || "guest")).join(" & ") : (memberById[e.payer_user_id]?.display_name || "?");
    const parts = shares.filter((s) => s.expense_id === e.id);
    const who = parts.length >= partyCount ? "whole group" : parts.map((s) => s.user_id ? (memberById[s.user_id]?.display_name || "?") : (guestById[s.guest_id || ""]?.name || "guest")).join(", ");
    return (
      <div key={e.id} onClick={() => onView(e)}
        style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px", borderBottom: `1px solid ${C.greenMid}`, cursor: "pointer" }}>
        <Avatar src={payer?.avatar_url} name={payer?.display_name || "?"} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontSize: 13.5, fontWeight: 600 }}>{e.description || "Expense"}</div>
          <div style={{ color: C.sage, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{paidNames} paid · {who}</div>
        </div>
        <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700 }}>{fmtUSD(e.amount_cents)}</div>
        <span style={{ color: C.sage, fontSize: 17, marginLeft: 2 }}>&#8250;</span>
      </div>
    );
  };

  const island = (ev: EventRow) => {
    const net = eventNet(ev.id, expenses as any, shares as any, guests as any, payers as any);
    const list = byEv[ev.id] || [];
    const created = ev.created_at ? new Date(ev.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null;
    const bal = bucketBalances(ev.id, expenses as any, shares as any, settlements as any, guests as any, payers as any);
    const brows = Object.entries(bal).sort((a, b) => (memberById[a[0]]?.display_name || "").localeCompare(memberById[b[0]]?.display_name || ""));
    const settled = brows.length === 0;
    return (
      <div key={ev.id} style={{ background: C.greenLight, borderRadius: 14, padding: "12px 13px", marginBottom: 12, border: ev.event_type === "game" ? "1px solid #2c7d5f" : undefined }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 800, color: C.cream }}>
              {ev.name}{ev.event_type === "game" && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 9, marginLeft: 6, background: "#0d3a2c", color: "#8fd6b0", border: "1px solid #2c7d5f" }}>from game</span>}
            </div>
            <div style={{ color: C.sage, fontSize: 11.5, marginTop: 1 }}>{[created ? "created " + created : null, `${list.length} ${list.length === 1 ? "expense" : "expenses"}`].filter(Boolean).join(" · ")}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            {settled
              ? <div style={{ color: "#7fd6a3", fontSize: 13, fontWeight: 800 }}>✓ Settled</div>
              : <><div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>{fmtUSD(net.total)}</div><div style={{ color: C.faint, fontSize: 11 }}>total spend</div></>}
          </div>
        </div>
        {(() => {
          // Per-Bucket settled balance — a mini version of the aggregate Club tile, scoped to THIS Bucket.
          // Shows who owes what within the Bucket after its own settlements; "cleared" when net-square.
          return (
            <div style={{ marginTop: 10, borderTop: `1px solid ${C.greenMid}`, paddingTop: 8 }}>
              {settled ? (
                <div style={{ color: "#7fd6a3", fontSize: 13, fontWeight: 700, textAlign: "center", padding: "3px 0" }}>✓ All balances cleared for this Bucket</div>
              ) : brows.map(([mid, v]) => (
                <div key={mid} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", color: C.cream }}>
                  <span style={{ flex: 1 }}>{memberById[mid]?.display_name || "Player"}{mid === me ? " (you)" : ""}</span>
                  <span style={{ fontWeight: 800, color: v > 0 ? "#8fd6b0" : "#f0b4ab" }}>{v > 0 ? "is owed " + fmtUSD(v) : "owes " + fmtUSD(-v)}</span>
                </div>
              ))}
            </div>
          );
        })()}
        {list.length > 0 && <div style={{ marginTop: 8, borderTop: `1px dashed ${C.greenMid}`, paddingTop: 4 }}>{list.map(row)}</div>}
        {ev.event_type === "game" && <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Name &amp; date come from the game.</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#0f3529", borderRadius: 9, padding: "8px 10px" }}>
          <span style={{ flex: 1, color: C.sage, fontSize: 11.5, lineHeight: 1.4 }}>Settle this Bucket in the <strong style={{ color: C.cream }}>Settle</strong> tab — each Bucket squares on its own.</span>
          {isAdmin && <button onClick={() => onCloseEvent(ev, true)} style={{ border: `1px solid ${C.greenMid}`, background: "transparent", color: C.sage, fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}>Archive Bucket</button>}
        </div>
      </div>
    );
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Eyebrow>Expenses by Bucket</Eyebrow>
      {expenses.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: "8px 2px" }}>No expenses yet. Add one to start the ledger.</div>}

      {openEvents.map(island)}

      {ungrouped.length > 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: "12px 13px", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ flex: 1, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 800, color: C.sage }}>Ungrouped</div>
            <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>{fmtUSD(ungrouped.reduce((s, e) => s + e.amount_cents, 0))}</div>
          </div>
          <div style={{ color: C.sage, fontSize: 11.5, marginTop: 1 }}>{ungrouped.length} {ungrouped.length === 1 ? "expense" : "expenses"} with no event</div>
          <div style={{ marginTop: 8, borderTop: `1px dashed ${C.greenMid}`, paddingTop: 4 }}>{ungrouped.map(row)}</div>
        </div>
      )}

      {closedEvents.length > 0 && (<>
        <div onClick={() => setShowClosed((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 8, background: "#123f31", borderRadius: 10, padding: "9px 11px", cursor: "pointer", marginBottom: showClosed ? 12 : 0 }}>
          <span style={{ fontSize: 12 }}>{"\uD83D\uDD12"}</span>
          <div style={{ flex: 1, color: C.cream, fontSize: 13, fontWeight: 800 }}>Archived events ({closedEvents.length})</div>
          <span style={{ color: C.sage }}>{showClosed ? "\u25BE" : "\u203A"}</span>
        </div>
        {showClosed && closedEvents.map((ev) => {
          const net = eventNet(ev.id, expenses as any, shares as any, guests as any, payers as any);
          const list = byEv[ev.id] || [];
          const perMember = [...net.perMember].sort((a, b) => (memberById[a.member_id]?.display_name || "").localeCompare(memberById[b.member_id]?.display_name || ""));
          return (
            <div key={ev.id} style={{ background: "#143f31", borderRadius: 14, padding: "12px 13px", marginBottom: 12, opacity: 0.95 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15.5, fontWeight: 800, color: C.cream }}>{ev.name} <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9, background: "#123528", color: C.sage }}>archived</span></div>
                  <div style={{ color: C.sage, fontSize: 11.5, marginTop: 1 }}>{[ev.created_at ? "created " + new Date(ev.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null, `${list.length} ${list.length === 1 ? "expense" : "expenses"}`, ev.closed_at ? "archived " + new Date(ev.closed_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 800 }}>{fmtUSD(net.total)}</div>
              </div>
              {perMember.length > 0 && (
                <div style={{ marginTop: 10, borderTop: `1px solid ${C.greenMid}`, paddingTop: 8 }}>
                  {perMember.map((m) => (
                    <div key={m.member_id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 0", color: C.cream }}>
                      <span style={{ flex: 1 }}>{memberById[m.member_id]?.display_name || "Player"}</span>
                      <span style={{ color: C.sage, width: 92, textAlign: "right" }}>paid {fmtUSD(m.paid)}</span>
                      <span style={{ width: 68, textAlign: "right", fontWeight: 800, color: m.net > 0 ? "#8fd6b0" : m.net < 0 ? "#f0b4ab" : C.faint }}>{m.net > 0 ? "+" : m.net < 0 ? "\u2212" : ""}{fmtUSD(Math.abs(m.net))}</span>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 8, borderTop: `1px dashed ${C.greenMid}`, paddingTop: 4 }}>{list.map(row)}</div>
              <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Archived — view only.</div>
              {isAdmin && <button onClick={() => onCloseEvent(ev, false)} style={{ marginTop: 8, border: `1px solid ${C.greenMid}`, background: "transparent", color: C.sage, fontSize: 11.5, fontWeight: 800, padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>Reopen event</button>}
            </div>
          );
        })}
      </>)}

      {expenses.length > 0 && <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Tap any expense to see full details.</div>}
    </div>
  );
}

const linkBtn: React.CSSProperties = { background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "2px 0" };
function Remaining({ total, allocated }: { total: number; allocated: number }) {
  const rem = total - allocated;
  const color = rem === 0 ? "#7fd6a3" : rem < 0 ? "#ef9d90" : C.gold;
  const txt = rem === 0 ? "✓ fully allocated" : rem > 0 ? fmtUSD(rem) + " left to allocate" : fmtUSD(-rem) + " over-allocated";
  return <div style={{ color, fontSize: 12, marginTop: 8, fontWeight: 700 }}>{txt}</div>;
}

const chip = (on: boolean): React.CSSProperties => ({
  border: `1px solid ${on ? C.gold : "#2c5142"}`, background: on ? C.gold : "#173a2c",
  color: on ? "#2a2410" : C.cream, borderRadius: 999, padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
});
