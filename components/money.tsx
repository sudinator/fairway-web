"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Avatar, btn, inputStyle, Eyebrow, FieldLabel } from "@/components/ui";
import {
  computeBalances, simplify, pairwiseDebts, evenShares, validateCustomTotal, guestCoverageBySponsor,
  fmtUSD, payLink, nudgeSms, auditVersionsByExpense, eventNet, expensesByEvent, personLedger, eventSettlement, withinEventDebts,
  type Expense, type Share, type Settlement, type Guest, type Payer,
  type AuditRow, type AuditVersion, type AuditSnapshot, type EventRow, type LedgerLine,
} from "@/lib/money";

const supabase = createClient();

type Member = { id: string; display_name: string; avatar_url?: string | null; venmo_handle?: string | null; paypal_handle?: string | null; zelle_handle?: string | null; phone?: string | null };
type SettlementRow = Settlement & { id: string; method?: string | null; created_by?: string | null; created_at?: string; event_id?: string | null; status?: "pending" | "confirmed" };
type GuestRow = Guest & { name: string; group_id: string; archived?: boolean; became_member_id?: string | null; source_game_id?: string | null };
type ExpenseRow = Expense & { group_id: string; created_by: string | null; description: string; category: string; split_type: "even" | "custom"; created_at: string; event_id?: string | null };
type ShareRow = Share & { id: string };
type PayerRow = Payer & { id?: string };

const ini = (n: string) => n.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();

export function MoneyTab({ user, activeGroup, onChanged, initialTab }: { user: { id: string }; activeGroup: { id: string; name: string; role?: string }; onChanged?: () => void; initialTab?: "balances" | "add" | "settle" | "log" | null }) {
  const [screen, setScreen] = useState<"balances" | "add" | "settle" | "log">(initialTab ?? "balances");
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [auditRows, setAuditRows] = useState<AuditRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [viewingSnap, setViewingSnap] = useState<{ snapshot: AuditSnapshot; at?: string } | null>(null); // read-only view of a deleted expense
  const [ledgerFor, setLedgerFor] = useState<string | null>(null); // member whose balance breakdown is open
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [viewing, setViewing] = useState<ExpenseRow | null>(null);
  const [simplifyMode, setSimplifyMode] = useState(true); // group-wide: true = fewest payments, false = as entered
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
    const { data: gRows } = await supabase.from("group_guests").select("id, name, sponsor_user_id, group_id, archived, became_member_id, source_game_id").eq("group_id", gid);
    const { data: exp } = await supabase.from("expenses").select("*").eq("group_id", gid).order("created_at", { ascending: false });
    const expIds = (exp || []).map((e: any) => e.id);
    const { data: sh } = expIds.length
      ? await supabase.from("expense_shares").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: py } = expIds.length
      ? await supabase.from("expense_payers").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: setl } = await supabase.from("settlements").select("*").eq("group_id", gid);
    const { data: grp } = await supabase.from("groups").select("money_simplify").eq("id", gid).single();
    setSimplifyMode(grp?.money_simplify !== false); // default to simplified when column/absent
    const { data: act } = await supabase.from("group_activity").select("*").eq("group_id", gid).not("action", "like", "tt%").order("created_at", { ascending: false }).limit(200);
    const { data: aud } = await supabase.from("money_audit").select("id, expense_id, actor_id, action, snapshot, created_at").eq("group_id", gid).order("created_at", { ascending: true }).limit(1000);
    const { data: evs } = await supabase.from("group_events").select("*").eq("group_id", gid).order("created_at", { ascending: false });
    setMembers((profs || []).map((p: any) => ({ id: p.id, display_name: p.display_name || "Player", avatar_url: p.avatar_url, venmo_handle: p.venmo_handle, paypal_handle: p.paypal_handle, zelle_handle: p.zelle_handle, phone: p.phone })).sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })));
    setGuests(((gRows || []) as GuestRow[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
    setExpenses((exp || []) as ExpenseRow[]);
    setShares((sh || []) as ShareRow[]);
    setSettlements((setl || []) as SettlementRow[]);
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
  const transfers = useMemo(() => (simplifyMode ? simplify(balances) : pairwiseDebts(expenses, shares, confirmedSettlements, guests, payers)), [simplifyMode, balances, expenses, shares, confirmedSettlements, guests, payers]);

  const nameOf = (uid: string) => memberById[uid]?.display_name || "Player";
  const requireOnline = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { alert("You're offline — connect to update the money ledger."); return false; }
    return true;
  };

  // ---- confirm-on-return after a pay hand-off ----
  const [pending, setPending] = useState<{ from: string; to: string; amt: number } | null>(null);
  const [zelleInfo, setZelleInfo] = useState<{ from: string; to: string; amt: number; handle: string } | null>(null);
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
    if (error || !data) { alert("Couldn't create the event — please try again."); return null; }
    setEvents((e) => [data as EventRow, ...e]);
    await logActivity("event_created", "created event " + name.trim(), { event_id: (data as any).id });
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
    setBusy(true);
    const { error } = await supabase.rpc("move_expense_event", { p_expense: expenseId, p_event: eventId });
    setBusy(false);
    if (error) { alert("Couldn't move the expense — " + error.message); return; }
    await load();
  };

  const setSimplify = async (v: boolean) => {
    if (!isAdmin || !requireOnline()) return;
    setSimplifyMode(v);
    const { error } = await supabase.from("groups").update({ money_simplify: v }).eq("id", gid);
    if (error) { setSimplifyMode(!v); alert("Couldn't change the setting - please try again."); }
  };

  // ---- per-event settle: arm (pending) → confirm on return ----
  const armSettle = async (buckets: (string | null)[]) => {
    if (!requireOnline()) return;
    const rows: any[] = [];
    for (const b of buckets) {
      const debts = withinEventDebts(b, user.id, expenses as any, shares as any, guests as any, payers as any);
      for (const d of debts) rows.push({ group_id: gid, from_user_id: user.id, to_user_id: d.to, amount_cents: d.amount, method: "pending", event_id: b, status: "pending", created_by: user.id });
    }
    if (rows.length === 0) { alert("Nothing to settle here."); return; }
    setBusy(true);
    const { error } = await supabase.from("settlements").insert(rows);
    setBusy(false);
    if (error) { alert("Couldn't start the settlement — please try again."); return; }
    const byTo: Record<string, number> = {};
    for (const r of rows) byTo[r.to_user_id] = (byTo[r.to_user_id] || 0) + r.amount_cents;
    const primaryTo = Object.keys(byTo).sort((a, b) => byTo[b] - byTo[a])[0];
    const total = rows.reduce((s, r) => s + r.amount_cents, 0);
    await load();
    setPending({ from: user.id, to: primaryTo, amt: byTo[primaryTo] });
    setPayChoose({ to: primaryTo, amt: byTo[primaryTo], total, count: Object.keys(byTo).length });
  };
  const confirmPending = async () => {
    if (!requireOnline()) return;
    setBusy(true);
    const ids = myPending.map((s) => s.id);
    if (ids.length) {
      await supabase.from("settlements").update({ status: "confirmed" }).in("id", ids);
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

  async function recordSettlement(from: string, to: string, amt: number, method: string) {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("settlements").insert({ group_id: gid, from_user_id: from, to_user_id: to, amount_cents: amt, method, created_by: user.id });
    if (error) { setBusy(false); alert("Couldn't record the payment — please try again."); return; }
    await logActivity("settlement_added", "marked " + fmtUSD(amt) + " paid: " + nameOf(from) + " → " + nameOf(to), { from, to, amount_cents: amt });
    setBusy(false);
    setPending(null); setAskReturn(false);
    await load();
    onChanged?.();
  }

  async function deleteSettlement(s2: SettlementRow) {
    if (!requireOnline()) return;
    if (!window.confirm("Unmark this payment? " + nameOf(s2.from_user_id) + " → " + nameOf(s2.to_user_id) + " " + fmtUSD(s2.amount_cents) + ". Balances will recompute.")) return;
    setBusy(true);
    const { error } = await supabase.from("settlements").delete().eq("id", s2.id);
    if (error) { setBusy(false); alert("Couldn't unmark — " + error.message); return; }
    await logActivity("settlement_removed", "unmarked " + fmtUSD(s2.amount_cents) + " paid: " + nameOf(s2.from_user_id) + " → " + nameOf(s2.to_user_id), { from: s2.from_user_id, to: s2.to_user_id, amount_cents: s2.amount_cents });
    setBusy(false);
    await load();
    onChanged?.();
  }

  function startZelle(t: { from: string; to: string; amt: number }) {
    const payee = memberById[t.to];
    const handle = payee?.zelle_handle;
    if (!handle) { alert(nameOf(t.to) + " hasn't added a Zelle contact yet."); return; }
    setZelleInfo({ from: t.from, to: t.to, amt: t.amt, handle });
  }
  function startPay(kind: "venmo" | "paypal", t: { from: string; to: string; amt: number }) {
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
        {([["balances", "Balances"], ["add", "Add"], ["settle", "Settle"], ["log", "Log"]] as const).map(([k, label]) => (
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
        <GuestManager guests={guests} members={members} busy={busy} onRetire={retireGuest} onUnretire={unretireGuest} />
        </>
      )}
      {screen === "add" && (
        <AddExpense key={editing?.id || "new"} user={user} gid={gid} members={members} guests={guests} busy={busy} setBusy={setBusy}
          requireOnline={requireOnline}
          openEvents={events.filter((e) => e.status === "open")} onCreateEvent={createEvent}
          editing={editing} editShares={editing ? shares.filter((s) => s.expense_id === editing.id) : []} editPayers={editing ? payers.filter((p) => p.expense_id === editing.id) : []} editHistory={editing ? activity.filter((a) => a?.meta?.expense_id === editing.id && (a.action === "expense_created" || a.action === "expense_edited")) : []} onLog={logActivity}
          canDelete={!!editing && (editing.created_by === user.id || isAdmin)}
          onDelete={async () => { if (!editing) return; const d = editing; setBusy(true); const { error } = await supabase.from("expenses").delete().eq("id", d.id); if (error) { setBusy(false); alert("Couldn't void this expense — please try again."); return; } await logActivity("expense_deleted", "voided “" + (d.description || "expense") + "” — " + fmtUSD(d.amount_cents), { expense_id: d.id, amount_cents: d.amount_cents }); setBusy(false); setEditing(null); await load(); setScreen("balances"); }}
          onAddGuest={async (name) => {
            if (!requireOnline()) return;
            const { data, error } = await supabase.from("group_guests").insert({ group_id: gid, name, archived: false, created_by: user.id }).select("id, name, sponsor_user_id, group_id, archived, became_member_id").single();
            if (error || !data) { alert("Couldn't add the guest — please try again."); return; }
            setGuests((g) => [...g, data as GuestRow].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))); await logActivity("guest_added", "added guest " + name, { guest_id: (data as any).id });
          }}
          onSaved={async () => { setEditing(null); await load(); setScreen("balances"); }} />
      )}
      {screen === "settle" && (
        <SettleScreen transfers={transfers} nameOf={nameOf} memberById={memberById} busy={busy} me={user.id} isAdmin={isAdmin}
          simplifyOn={simplifyMode} canToggle={isAdmin} onToggle={setSimplify}
          settlements={settlements} onUnmark={deleteSettlement}
          onPay={startPay} onZelle={startZelle} onMark={(t) => recordSettlement(t.from, t.to, t.amt, "cash")} />
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
          settlements={settlements} me={user.id} onSettleEvent={(eid) => armSettle([eid])}
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
          expenses={expenses} shares={shares} settlements={settlements} guests={guests} payers={payers}
          events={events} memberById={memberById}
          onClose={() => setLedgerFor(null)} />
      )}

      {zelleInfo && (
        <div onClick={() => setZelleInfo(null)} style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "18px 16px 24px", width: "100%", maxWidth: 520 }}>
            <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>Pay {nameOf(zelleInfo.to)} with Zelle</div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>Zelle happens inside your bank app. Open it, send to the contact below, then mark it settled here.</div>
            <div style={{ background: "#123528", borderRadius: 12, padding: 14, marginTop: 12 }}>
              <FieldLabel>Zelle contact</FieldLabel>
              <div style={{ color: C.cream, fontSize: 16, fontWeight: 800, marginTop: 3, wordBreak: "break-all" }}>{zelleInfo.handle}</div>
              <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, marginTop: 8 }}>{fmtUSD(zelleInfo.amt)}</div>
              <button onClick={() => { try { navigator.clipboard?.writeText(zelleInfo.handle); } catch {} }} style={{ ...btn(false), marginTop: 10, fontSize: 12.5, padding: "8px 12px" }}>Copy contact</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button disabled={busy} onClick={() => { const z = zelleInfo; setZelleInfo(null); recordSettlement(z.from, z.to, z.amt, "zelle"); }} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>✓ I&apos;ve paid, mark settled</button>
              <button onClick={() => setZelleInfo(null)} style={{ ...btn(false), flex: 1 }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* confirm-on-return sheet */}
      {askReturn && (myPending.length > 0 || pending) && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.66)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
          <div style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "22px 18px 26px", width: "100%", maxWidth: 520, textAlign: "center" }}>
            <div style={{ color: C.cream, fontWeight: 800, fontSize: 17 }}>Back from paying — did it go through?</div>
            <div style={{ color: C.sage, fontSize: 13, margin: "8px 0 4px" }}>You were settling <b style={{ color: C.gold }}>{fmtUSD(myPending.length > 0 ? myPending.reduce((s, p) => s + p.amount_cents, 0) : (pending?.amt || 0))}</b></div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button disabled={busy} onClick={() => { if (myPending.length > 0) confirmPending(); else if (pending) recordSettlement(pending.from, pending.to, pending.amt, "venmo"); }} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>✓ Yes, mark settled</button>
              <button onClick={() => { setAskReturn(false); if (!myPending.length) setPending(null); }} style={{ ...btn(false), flex: 1 }}>Not yet</button>
            </div>
          </div>
        </div>
      )}

      {/* pay-method chooser for an armed event settle */}
      {payChoose && (
        <div onClick={() => setPayChoose(null)} style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.66)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "20px 18px 26px", width: "100%", maxWidth: 520 }}>
            <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>Pay {nameOf(payChoose.to)} {fmtUSD(payChoose.amt)}</div>
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
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Balances ----------------
function GuestManager({ guests, members, busy, onRetire, onUnretire }: {
  guests: GuestRow[]; members: Member[]; busy: boolean;
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
            <button disabled={busy} onClick={() => { setOpenId(openId === g.id ? null : g.id); setBecame(""); }} style={{ background: "#173a2c", color: C.cream, border: `1px solid #37624f`, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>{openId === g.id ? "Cancel" : "Retire"}</button>
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
              <button disabled={busy} onClick={() => onUnretire(g.id)} style={{ background: "transparent", color: C.gold, border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Un-retire</button>
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
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Balances</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Net across all unsettled expenses · tap a name for the breakdown</div>
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
function SettleScreen({ transfers, nameOf, memberById, busy, me, isAdmin, simplifyOn, canToggle, onToggle, settlements, onUnmark, onPay, onZelle, onMark }: {
  transfers: { from: string; to: string; amt: number }[]; nameOf: (id: string) => string;
  memberById: Record<string, Member>; busy: boolean; me: string; isAdmin: boolean;
  simplifyOn: boolean; canToggle: boolean; onToggle: (v: boolean) => void;
  settlements: SettlementRow[]; onUnmark: (s: SettlementRow) => void;
  onPay: (kind: "venmo" | "paypal", t: { from: string; to: string; amt: number }) => void;
  onZelle: (t: { from: string; to: string; amt: number }) => void;
  onMark: (t: { from: string; to: string; amt: number }) => void;
}) {
  const segBtn = (on: boolean): React.CSSProperties => ({ flex: 1, border: "none", background: on ? C.gold : "transparent", color: on ? "#2a2410" : C.sage, borderRadius: 999, padding: "7px 6px", fontSize: 12, fontWeight: 800, cursor: "pointer" });
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Settle up</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 8 }}>{simplifyOn ? "Fewest payments to square the club" : "Each payment matches an expense you shared - who owes whom"}</div>
      {canToggle ? (
        <div style={{ display: "flex", background: "#123528", borderRadius: 999, padding: 3, marginBottom: 8 }}>
          <button onClick={() => onToggle(true)} style={segBtn(simplifyOn)}>Fewest payments</button>
          <button onClick={() => onToggle(false)} style={segBtn(!simplifyOn)}>As entered</button>
        </div>
      ) : (
        <div style={{ color: C.faint, fontSize: 11, marginBottom: 8 }}>{simplifyOn ? "Showing fewest payments." : "Showing debts as entered."} Set by a club admin.</div>
      )}
      {transfers.length === 0 && <div style={{ color: "#7fd6a3", textAlign: "center", fontFamily: "Georgia, serif", fontSize: 17, padding: "22px 0" }}>✓ All square</div>}
      {transfers.map((t, i) => {
        const to = memberById[t.to];
        return (
          <div key={i} style={{ background: "#173a2c", borderRadius: 12, padding: 12, marginTop: 9 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1, color: C.cream, fontSize: 14 }}><b>{nameOf(t.from)}</b> pays <b>{nameOf(t.to)}</b></span>
              <span style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 17 }}>{fmtUSD(t.amt)}</span>
            </div>
            {(() => {
              const isMine = t.from === me;
              const canMark = isMine || isAdmin;
              return (
                <div style={{ display: "flex", gap: 7, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
                  {isMine && to?.venmo_handle && <button disabled={busy} onClick={() => onPay("venmo", t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#3D95CE", color: "#fff" }}>Venmo</button>}
                  {isMine && to?.paypal_handle && <button disabled={busy} onClick={() => onPay("paypal", t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#003087", color: "#fff" }}>PayPal</button>}
                  {isMine && to?.zelle_handle && <button disabled={busy} onClick={() => onZelle(t)} style={{ flex: "1 1 68px", border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#6D1ED4", color: "#fff" }}>Zelle</button>}
                  {isMine && !to?.venmo_handle && !to?.paypal_handle && !to?.zelle_handle && <span style={{ flex: 1, color: C.sage, fontSize: 11 }}>no handle on file — pay cash</span>}
                  {canMark
                    ? <button disabled={busy} onClick={() => onMark(t)} style={{ flex: "1 1 68px", border: `1px solid ${C.line}`, borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: C.cream, color: C.green }}>Mark paid{!isMine ? " (admin)" : ""}</button>
                    : <span style={{ flex: 1, color: C.faint, fontSize: 11.5, textAlign: "right" }}>Only {nameOf(t.from)} can mark this paid</span>}
                </div>
              );
            })()}
          </div>
        );
      })}
      {settlements.length > 0 && (
        <>
          <Eyebrow>Payments recorded</Eyebrow>
          {[...settlements].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")).map((s2) => {
            const canUndo = isAdmin || s2.created_by === me;
            return (
              <div key={s2.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 2px", borderBottom: `1px solid ${C.greenMid}` }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 13 }}><b>{nameOf(s2.from_user_id)}</b> paid <b>{nameOf(s2.to_user_id)}</b> {fmtUSD(s2.amount_cents)}</div>
                  <div style={{ color: C.faint, fontSize: 11 }}>{s2.method || "cash"}{s2.created_at ? " · " + new Date(s2.created_at).toLocaleDateString() : ""}</div>
                </div>
                {canUndo && <button disabled={busy} onClick={() => onUnmark(s2)} style={{ border: `1px solid ${C.line}`, background: "transparent", color: C.sage, borderRadius: 8, padding: "6px 10px", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>Unmark</button>}
              </div>
            );
          })}
          <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Unmark reverses a payment and recomputes balances. Admins can unmark any; you can unmark ones you recorded.</div>
        </>
      )}
    </div>
  );
}

// ---------------- Add / Edit expense ----------------
type Party = { kind: "member" | "guest"; id: string; name: string; avatar_url?: string | null; sponsor?: string };

function AddExpense({ user, gid, members, guests, busy, setBusy, requireOnline, onAddGuest, onSaved, openEvents, onCreateEvent, editing, editShares, editPayers, editHistory, onLog, canDelete, onDelete }: {
  user: { id: string }; gid: string; members: Member[]; guests: GuestRow[]; busy: boolean; setBusy: (b: boolean) => void;
  requireOnline: () => boolean;
  onAddGuest: (name: string) => Promise<void>;
  onSaved: () => Promise<void>;
  openEvents: EventRow[]; onCreateEvent: (name: string) => Promise<string | null>;
  editing?: ExpenseRow | null; editShares?: ShareRow[]; editPayers?: PayerRow[]; editHistory?: any[]; onLog?: (action: string, summary: string, meta?: any) => Promise<void>; canDelete?: boolean; onDelete?: () => Promise<void>;
}) {
  const skey = (s: ShareRow) => (s.user_id ? "u:" + s.user_id : "g:" + s.guest_id);
  const [eventId, setEventId] = useState<string | null>(editing?.event_id ?? null);
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

  async function save() {
    if (!requireOnline() || !canSave) return;
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

      <Eyebrow>Event (optional)</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button onClick={() => { setEventId(null); setNewEventOpen(false); }} style={chip(eventId === null && !newEventOpen)}>No event</button>
        {openEvents.map((ev) => (
          <button key={ev.id} onClick={() => { setEventId(ev.id); setNewEventOpen(false); }} style={chip(eventId === ev.id)}>
            {ev.name}
          </button>
        ))}
        <button onClick={() => { setNewEventOpen(true); setEventId(null); }} style={{ ...chip(newEventOpen), borderStyle: "dashed" }}>＋ New event</button>
      </div>
      {newEventOpen && (
        <div style={{ background: "#0f3529", borderRadius: 10, padding: 10, marginTop: 8 }}>
          <input value={newEventName} onChange={(e) => setNewEventName(e.target.value)} placeholder="Event name (e.g. Ireland Trip)" style={inputStyle} />
          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", justifyContent: "flex-end" }}>
            <button disabled={busy || !newEventName.trim()} onClick={async () => {
              const id = await onCreateEvent(newEventName);
              if (id) { setEventId(id); setNewEventOpen(false); setNewEventName(""); }
            }} style={{ ...btn(true), flex: 0, padding: "8px 18px", opacity: (busy || !newEventName.trim()) ? 0.5 : 1 }}>Create event</button>
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
        <button disabled={busy} onClick={async () => { if (!requireOnline()) return; if (!window.confirm("Void this expense? It's removed from everyone's balances, but the record stays in the activity log for the audit trail.")) return; setBusy(true); await onDelete?.(); }}
          style={{ ...btn(false), marginTop: 8, color: C.birdie, borderColor: C.birdie }}>Void expense</button>
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "18px 16px 24px", width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{snap.description || "Expense"}</div>
          <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800 }}>{fmtUSD(snap.amount_cents || 0)}</div>
        </div>
        <div style={{ display: "inline-block", background: "#5a2d2d", color: "#ffd9d9", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 10, marginTop: 6 }}>VOIDED{at ? " · " + fmtWhen(at) : ""}</div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>entered by {snap.created_by_name || "someone"}</div>
        <SnapshotBody snap={snap} />
        <div style={{ color: C.faint, fontSize: 11, marginTop: 12, lineHeight: 1.5 }}>This expense was voided. The allocation above is the record as it stood when it was voided — kept for the club's audit trail and can't be edited.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose} style={{ ...btn(false), flex: 1 }}>Close</button>
        </div>
      </div>
    </div>
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
  const paidRows = prs.length
    ? prs.map((p) => ({ name: p.user_id ? (memberById[p.user_id]?.display_name || "?") : (guestById[p.guest_id || ""]?.name || "guest"), cents: p.paid_cents }))
    : [{ name: memberById[expense.payer_user_id]?.display_name || "?", cents: expense.amount_cents }];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "18px 16px 24px", width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{expense.description || "Expense"}</div>
          <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800 }}>{fmtUSD(expense.amount_cents)}</div>
        </div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{new Date(expense.created_at).toLocaleDateString()}</div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
          <span style={{ color: C.faint, fontSize: 12 }}>Event:</span>
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
        {paidRows.map((r, i) => (
          <div key={i} style={{ display: "flex", color: C.cream, fontSize: 13.5, padding: "3px 0" }}><span style={{ flex: 1 }}>{r.name}</span><span style={{ color: C.gold }}>{fmtUSD(r.cents)}</span></div>
        ))}

        <Eyebrow>Split · {parts.length} {parts.length === 1 ? "person" : "people"}</Eyebrow>
        {parts.map((s, i) => {
          const nm = s.user_id ? (memberById[s.user_id]?.display_name || "?") : ((guestById[s.guest_id || ""]?.name || "guest") + " (guest)");
          return <div key={s.id || i} style={{ display: "flex", color: C.cream, fontSize: 13.5, padding: "3px 0" }}><span style={{ flex: 1 }}>{nm}</span><span style={{ color: C.sage }}>{fmtUSD(s.share_cents)}</span></div>;
        })}

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
                    <div style={{ color: C.faint, fontSize: 11 }}>{fmtWhen(v.at)}{v.snapshot?.amount_cents != null ? " · " + fmtUSD(v.snapshot.amount_cents) : ""}</div>
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
        {!canEdit && <div style={{ color: C.faint, fontSize: 11, marginTop: 8, textAlign: "center" }}>View only — only the person who entered this or a club admin can edit it.</div>}
      </div>
    </div>
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
function PersonLedgerModal({ memberId, me, name, net, expenses, shares, settlements, guests, payers, events, memberById, onClose }: {
  memberId: string; me: string; name: string; net: number;
  expenses: ExpenseRow[]; shares: ShareRow[]; settlements: SettlementRow[]; guests: GuestRow[]; payers: PayerRow[];
  events: EventRow[]; memberById: Record<string, Member>; onClose: () => void;
}) {
  const nameOf = (uid: string | null) => (uid ? (memberById[uid]?.display_name || "someone") : "someone");
  const { lines } = personLedger(memberId, expenses as any, shares as any, settlements as any, guests as any, payers as any, nameOf);
  const evName = (id: string | null) => (id ? (events.find((e) => e.id === id)?.name || "Event") : "Ungrouped");
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.72)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "18px 16px 24px", width: "100%", maxWidth: 520, maxHeight: "88vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800 }}>{name}{memberId === me ? " (you)" : ""}</div>
          <div style={{ color: net > 0 ? "#7fd6a3" : net < 0 ? "#ef9d90" : C.sage, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>
            {net > 0 ? "owed " + fmtUSD(net) : net < 0 ? "owes " + fmtUSD(-net) : "settled"}
          </div>
        </div>
        <div style={{ color: C.faint, fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>How this number is built, item by item. This is the raw list — who ultimately pays whom is decided separately on the Settle tab.</div>

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
      </div>
    </div>
  );
}

// Balances → expenses grouped into event islands (open events, Ungrouped, then a
// collapsed Closed section). Per-event nets come from eventNet(); settlement stays
// group-wide (handled elsewhere). Reuses one row renderer for every expense.
function EventGroupedExpenses({ expenses, shares, payers, guests, events, memberById, guestById, partyCount, settlements, me, onSettleEvent, isAdmin, onView, onCloseEvent }: {
  expenses: ExpenseRow[]; shares: ShareRow[]; payers: PayerRow[]; guests: GuestRow[]; events: EventRow[];
  memberById: Record<string, Member>; guestById: Record<string, GuestRow>; partyCount: number;
  settlements: SettlementRow[]; me: string; onSettleEvent: (eventId: string | null) => void;
  isAdmin: boolean; onView: (e: ExpenseRow) => void;
  onCloseEvent: (ev: EventRow, closed: boolean) => void;
}) {
  const [showClosed, setShowClosed] = useState(false);
  const byEv = useMemo(() => expensesByEvent(expenses), [expenses]);
  const settle = useMemo(() => eventSettlement({ events, expenses: expenses as any, shares: shares as any, payers: payers as any, settlements: settlements as any, guests: guests as any }), [events, expenses, shares, payers, settlements, guests]);
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
    const st = settle[ev.id];
    const settled = !!st && st.settled && list.length > 0;
    const partial = !!st && !st.settled && st.covered > 0;
    const created = ev.created_at ? new Date(ev.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null;
    const perMember = [...net.perMember].sort((a, b) => (memberById[a.member_id]?.display_name || "").localeCompare(memberById[b.member_id]?.display_name || ""));
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
            <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>{fmtUSD(net.total)}</div>
            {list.length > 0 && (settled
              ? <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 9, background: "#123f2e", color: "#8fd6b0" }}>settled</span>
              : partial
                ? <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9, background: "#3a3320", color: "#e6cf8a" }}>{fmtUSD(st!.covered)} of {fmtUSD(st!.owed)} settled</span>
                : net.owedWithin > 0
                  ? <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9, background: "#123528", color: C.sage }}>{fmtUSD(net.owedWithin)} outstanding</span>
                  : <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 9, background: "#123528", color: C.sage }}>open</span>)}
          </div>
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
        {list.length > 0 && <div style={{ marginTop: 8, borderTop: `1px dashed ${C.greenMid}`, paddingTop: 4 }}>{list.map(row)}</div>}
        {(() => {
          const mine = net.perMember.find((m) => m.member_id === me);
          const owe = mine && mine.net < 0 ? -mine.net : 0;
          const pendingHere = settlements.some((s) => s.from_user_id === me && (s.event_id ?? null) === ev.id && s.status === "pending");
          const paidHere = settlements.filter((s) => s.from_user_id === me && (s.event_id ?? null) === ev.id && (s.status || "confirmed") === "confirmed").reduce((s2, s) => s2 + s.amount_cents, 0);
          if (owe > 0 && paidHere < owe && !pendingHere) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, background: "#0f3529", borderRadius: 9, padding: "8px 10px" }}>
                <span style={{ flex: 1, color: C.cream, fontSize: 12.5 }}>You owe {fmtUSD(owe - paidHere)} for this event</span>
                <button onClick={() => onSettleEvent(ev.id)} style={{ border: "none", background: "#7fd6a3", color: C.green, fontSize: 11.5, fontWeight: 800, padding: "7px 14px", borderRadius: 8, cursor: "pointer" }}>Settle</button>
              </div>
            );
          }
          if (pendingHere) return <div style={{ marginTop: 10, background: "#3a3320", borderRadius: 9, padding: "7px 10px", color: "#e6cf8a", fontSize: 11.5 }}>You started settling this — confirm it up top.</div>;
          return null;
        })()}
        {ev.event_type === "game" && <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Name &amp; date come from the game.</div>}
        {isAdmin && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, background: "#0f3529", borderRadius: 9, padding: "6px 9px" }}>
            <span style={{ flex: 1, color: C.sage, fontSize: 11 }}>{settled ? "Settled — ready to close" : "Admin"}</span>
            <button onClick={() => onCloseEvent(ev, true)} style={{ border: "none", background: "#5a2d2d", color: "#ffd9d9", fontSize: 11, fontWeight: 800, padding: "6px 12px", borderRadius: 8, cursor: "pointer" }}>Close event</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ marginTop: 16 }}>
      <Eyebrow>Expenses by event</Eyebrow>
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
          <div style={{ flex: 1, color: C.cream, fontSize: 13, fontWeight: 800 }}>Closed events ({closedEvents.length})</div>
          <span style={{ color: C.sage }}>{showClosed ? "\u25BE" : "\u203A"}</span>
        </div>
        {showClosed && closedEvents.map((ev) => {
          const net = eventNet(ev.id, expenses as any, shares as any, guests as any, payers as any);
          const list = byEv[ev.id] || [];
          return (
            <div key={ev.id} style={{ background: "#143f31", borderRadius: 14, padding: "12px 13px", marginBottom: 12, opacity: 0.95 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: "Georgia, serif", fontSize: 15.5, fontWeight: 800, color: C.cream }}>{ev.name} <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 7px", borderRadius: 9, background: "#3a3320", color: "#e6cf8a" }}>CLOSED</span></div>
                  <div style={{ color: C.sage, fontSize: 11.5, marginTop: 1 }}>{[ev.created_at ? "created " + new Date(ev.created_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null, `${list.length} ${list.length === 1 ? "expense" : "expenses"}`, ev.closed_at ? "closed " + new Date(ev.closed_at).toLocaleDateString([], { month: "short", day: "numeric" }) : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 800 }}>{fmtUSD(net.total)}</div>
              </div>
              <div style={{ marginTop: 8, borderTop: `1px dashed ${C.greenMid}`, paddingTop: 4 }}>{list.map(row)}</div>
              <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Sealed — view only.</div>
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
