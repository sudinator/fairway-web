"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { Avatar, btn, inputStyle, Eyebrow } from "@/components/ui";
import {
  computeBalances, simplify, evenShares, validateCustomTotal, guestOwedFor,
  fmtUSD, payLink, nudgeSms,
  type Expense, type Share, type Settlement, type Guest, type Payer,
} from "@/lib/money";

const supabase = createClient();

type Member = { id: string; display_name: string; avatar_url?: string | null; venmo_handle?: string | null; paypal_handle?: string | null; phone?: string | null };
type GuestRow = Guest & { name: string; group_id: string };
type ExpenseRow = Expense & { group_id: string; created_by: string | null; description: string; category: string; split_type: "even" | "custom"; created_at: string };
type ShareRow = Share & { id: string };
type PayerRow = Payer & { id?: string };

const CATS: { k: string; label: string }[] = [
  { k: "tee", label: "Tee time" }, { k: "bet", label: "Bet" },
  { k: "food", label: "Food & drink" }, { k: "other", label: "Other" },
];
const catLabel = (k: string) => CATS.find((c) => c.k === k)?.label || "Other";
const ini = (n: string) => n.split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase();

export function MoneyTab({ user, activeGroup, onChanged }: { user: { id: string }; activeGroup: { id: string; name: string; role?: string }; onChanged?: () => void }) {
  const [screen, setScreen] = useState<"balances" | "add" | "settle" | "log">("balances");
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [guests, setGuests] = useState<GuestRow[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [shares, setShares] = useState<ShareRow[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [payers, setPayers] = useState<PayerRow[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
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
        ? await supabase.from("profiles").select("id, display_name, avatar_url, venmo_handle, paypal_handle, phone").in("id", ids)
        : { data: [] as any[] };
      profs = p2 || [];
    }
    const { data: gRows } = await supabase.from("group_guests").select("id, name, sponsor_user_id, group_id").eq("group_id", gid);
    const { data: exp } = await supabase.from("expenses").select("*").eq("group_id", gid).order("created_at", { ascending: false });
    const expIds = (exp || []).map((e: any) => e.id);
    const { data: sh } = expIds.length
      ? await supabase.from("expense_shares").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: py } = expIds.length
      ? await supabase.from("expense_payers").select("*").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: setl } = await supabase.from("settlements").select("*").eq("group_id", gid);
    const { data: act } = await supabase.from("group_activity").select("*").eq("group_id", gid).order("created_at", { ascending: false }).limit(200);
    setMembers((profs || []).map((p: any) => ({ id: p.id, display_name: p.display_name || "Player", avatar_url: p.avatar_url, venmo_handle: p.venmo_handle, paypal_handle: p.paypal_handle, phone: p.phone })).sort((a, b) => a.display_name.localeCompare(b.display_name, undefined, { sensitivity: "base" })));
    setGuests(((gRows || []) as GuestRow[]).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" })));
    setExpenses((exp || []) as ExpenseRow[]);
    setShares((sh || []) as ShareRow[]);
    setSettlements((setl || []) as Settlement[]);
    setPayers((py || []) as PayerRow[]);
    setActivity((act || []) as any[]);
    setLoading(false);
    onChanged?.();
  }, [gid, onChanged]);
  useEffect(() => { load(); }, [load]);

  const memberById = useMemo(() => Object.fromEntries(members.map((m) => [m.id, m])), [members]);
  const guestById = useMemo(() => Object.fromEntries(guests.map((g) => [g.id, g])), [guests]);
  const balances = useMemo(() => computeBalances(expenses, shares, settlements, guests, payers), [expenses, shares, settlements, guests, payers]);
  const transfers = useMemo(() => simplify(balances), [balances]);

  const nameOf = (uid: string) => memberById[uid]?.display_name || "Player";
  const requireOnline = () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) { alert("You're offline — connect to update the money ledger."); return false; }
    return true;
  };

  // ---- confirm-on-return after a pay hand-off ----
  const [pending, setPending] = useState<{ from: string; to: string; amt: number } | null>(null);
  const [askReturn, setAskReturn] = useState(false);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible" && pending) setAskReturn(true); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pending]);

  const logActivity = useCallback(async (action: string, summary: string, meta: any = {}) => {
    await supabase.from("group_activity").insert({ group_id: gid, actor_user_id: user.id, action, summary, meta });
  }, [gid, user.id]);

  async function recordSettlement(from: string, to: string, amt: number, method: string) {
    if (!requireOnline()) return;
    setBusy(true);
    const { error } = await supabase.from("settlements").insert({ group_id: gid, from_user_id: from, to_user_id: to, amount_cents: amt, method, created_by: user.id });
    if (error) { setBusy(false); alert("Couldn't record the payment — please try again."); return; }
    await logActivity("settlement_added", "marked " + fmtUSD(amt) + " paid: " + nameOf(from) + " → " + nameOf(to), { from, to, amount_cents: amt });
    setBusy(false);
    setPending(null); setAskReturn(false);
    await load();
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

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
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
        <BalancesScreen members={members} guests={guests} shares={shares} balances={balances} me={user.id} groupName={activeGroup.name}
          onNudge={(m, owe) => { const link = "https://birdienumnum.vercel.app"; if (m.phone) window.location.href = nudgeSms(m.phone, m.display_name, owe, activeGroup.name, link); }} />
      )}
      {screen === "add" && (
        <AddExpense key={editing?.id || "new"} user={user} gid={gid} members={members} guests={guests} busy={busy} setBusy={setBusy}
          requireOnline={requireOnline}
          editing={editing} editShares={editing ? shares.filter((s) => s.expense_id === editing.id) : []} editPayers={editing ? payers.filter((p) => p.expense_id === editing.id) : []} editHistory={editing ? activity.filter((a) => a?.meta?.expense_id === editing.id && (a.action === "expense_created" || a.action === "expense_edited")) : []} onLog={logActivity}
          canDelete={!!editing && (editing.created_by === user.id || isAdmin)}
          onDelete={async () => { if (!editing) return; const d = editing; setBusy(true); const { error } = await supabase.from("expenses").delete().eq("id", d.id); if (error) { setBusy(false); alert("Couldn't delete this expense — please try again."); return; } await logActivity("expense_deleted", "deleted “" + (d.description || catLabel(d.category)) + "” — " + fmtUSD(d.amount_cents), { expense_id: d.id, amount_cents: d.amount_cents }); setBusy(false); setEditing(null); await load(); setScreen("balances"); }}
          onAddGuest={async (name, sponsor) => {
            if (!requireOnline()) return;
            const { data, error } = await supabase.from("group_guests").insert({ group_id: gid, name, sponsor_user_id: sponsor, created_by: user.id }).select("id, name, sponsor_user_id, group_id").single();
            if (error || !data) { alert("Couldn't add the guest — please try again."); return; }
            setGuests((g) => [...g, data as GuestRow].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))); await logActivity("guest_added", "added guest " + name + " (sponsored by " + (members.find((mm) => mm.id === sponsor)?.display_name || "?") + ")", { guest_id: (data as any).id });
          }}
          onSaved={async () => { setEditing(null); await load(); setScreen("balances"); }} />
      )}
      {screen === "settle" && (
        <SettleScreen transfers={transfers} nameOf={nameOf} memberById={memberById} busy={busy} me={user.id} isAdmin={isAdmin}
          onPay={startPay} onMark={(t) => recordSettlement(t.from, t.to, t.amt, "cash")} />
      )}
      {screen === "log" && <ActivityLog activity={activity} memberById={memberById} />}

      {/* expenses list (under balances) */}
      {screen === "balances" && (
        <div style={{ marginTop: 16 }}>
          <Eyebrow>Expenses</Eyebrow>
          {expenses.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: "8px 2px" }}>No expenses yet. Add one to start the ledger.</div>}
          {expenses.map((e) => {
            const payer = memberById[e.payer_user_id];
            const prs = payers.filter((p) => p.expense_id === e.id);
            const paidNames = prs.length ? prs.map((p) => memberById[p.user_id]?.display_name || "?").join(" & ") : (memberById[e.payer_user_id]?.display_name || "?");
            const parts = shares.filter((s) => s.expense_id === e.id);
            const who = parts.length >= members.length + guests.length ? "whole group" : parts.map((s) => s.user_id ? (memberById[s.user_id]?.display_name || "?") : (guestById[s.guest_id || ""]?.name || "guest")).join(", ");
            const canEdit = e.created_by === user.id || isAdmin;
            return (
              <div key={e.id} onClick={canEdit ? () => { setEditing(e); setScreen("add"); } : undefined}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px", borderBottom: `1px solid ${C.greenMid}`, cursor: canEdit ? "pointer" : "default" }}>
                <Avatar src={payer?.avatar_url} name={payer?.display_name || "?"} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 13.5, fontWeight: 600 }}>{e.description || catLabel(e.category)}</div>
                  <div style={{ color: C.sage, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catLabel(e.category)} · {paidNames} paid · {who}</div>
                </div>
                <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700 }}>{fmtUSD(e.amount_cents)}</div>
                {canEdit && <span style={{ color: C.sage, fontSize: 17, marginLeft: 2 }}>&#8250;</span>}
              </div>
            );
          })}
          {expenses.length > 0 && <div style={{ color: C.faint, fontSize: 10.5, marginTop: 8 }}>Tap an expense you added to edit or delete it.</div>}
          <CategorySummary expenses={expenses} />
        </div>
      )}

      {/* confirm-on-return sheet */}
      {askReturn && pending && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(8,26,20,.66)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 80 }}>
          <div style={{ background: C.greenLight, borderRadius: "16px 16px 0 0", padding: "22px 18px 26px", width: "100%", maxWidth: 520, textAlign: "center" }}>
            <div style={{ color: C.cream, fontWeight: 800, fontSize: 17 }}>Welcome back — did you pay?</div>
            <div style={{ color: C.sage, fontSize: 13, margin: "8px 0 4px" }}>You were paying <b style={{ color: C.cream }}>{nameOf(pending.to)}</b> <b style={{ color: C.gold }}>{fmtUSD(pending.amt)}</b></div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button disabled={busy} onClick={() => recordSettlement(pending.from, pending.to, pending.amt, "venmo")} style={{ ...btn(true), flex: 1, background: "#7fd6a3", color: C.green }}>✓ Yes, mark settled</button>
              <button onClick={() => { setPending(null); setAskReturn(false); }} style={{ ...btn(false), flex: 1 }}>Not yet</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Balances ----------------
function BalancesScreen({ members, guests, shares, balances, me, onNudge }: {
  members: Member[]; guests: GuestRow[]; shares: ShareRow[]; balances: Record<string, number>; me: string; groupName: string;
  onNudge: (m: Member, owe: number) => void;
}) {
  const rows = members.map((m) => ({ m, v: balances[m.id] || 0 }));
  const sponsoredGuests = (uid: string) => guests.filter((g) => g.sponsor_user_id === uid);
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Balances</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Net across all unsettled expenses</div>
      {rows.map(({ m, v }) => {
        const owes = v < 0, owed = v > 0;
        const gList = sponsoredGuests(m.id);
        const gTotal = gList.reduce((s, g) => s + guestOwedFor(g.id, shares), 0);
        return (
          <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 2px", borderBottom: `1px solid ${C.greenMid}` }}>
            <Avatar src={m.avatar_url} name={m.display_name} size={30} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontSize: 14, fontWeight: 700 }}>{m.display_name}{m.id === me ? " (you)" : ""}</div>
              {gTotal > 0 && <div style={{ color: C.sage, fontSize: 10.5 }}>incl. {gList.map((g) => g.name).join(", ")}</div>}
            </div>
            <div style={{ color: owed ? "#7fd6a3" : owes ? "#ef9d90" : C.sage, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15 }}>
              {owed ? "is owed " + fmtUSD(v) : owes ? "owes " + fmtUSD(-v) : "settled"}
            </div>
            {owes && m.phone && <button onClick={() => onNudge(m, -v)} style={{ marginLeft: 6, background: "#173a2c", color: C.cream, border: `1px solid #37624f`, borderRadius: 8, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>Nudge</button>}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Settle up ----------------
function SettleScreen({ transfers, nameOf, memberById, busy, me, isAdmin, onPay, onMark }: {
  transfers: { from: string; to: string; amt: number }[]; nameOf: (id: string) => string;
  memberById: Record<string, Member>; busy: boolean; me: string; isAdmin: boolean;
  onPay: (kind: "venmo" | "paypal", t: { from: string; to: string; amt: number }) => void;
  onMark: (t: { from: string; to: string; amt: number }) => void;
}) {
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Settle up</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Fewest payments to square the group</div>
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
                <div style={{ display: "flex", gap: 7, marginTop: 9, alignItems: "center" }}>
                  {isMine && to?.venmo_handle && <button disabled={busy} onClick={() => onPay("venmo", t)} style={{ flex: 1, border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#3D95CE", color: "#fff" }}>Venmo</button>}
                  {isMine && to?.paypal_handle && <button disabled={busy} onClick={() => onPay("paypal", t)} style={{ flex: 1, border: "none", borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: "#003087", color: "#fff" }}>PayPal</button>}
                  {isMine && !to?.venmo_handle && !to?.paypal_handle && <span style={{ flex: 1, color: C.sage, fontSize: 11 }}>no handle on file — pay cash</span>}
                  {canMark
                    ? <button disabled={busy} onClick={() => onMark(t)} style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 9, padding: 9, fontSize: 12.5, fontWeight: 800, cursor: "pointer", background: C.cream, color: C.green }}>Mark paid{!isMine ? " (admin)" : ""}</button>
                    : <span style={{ flex: 1, color: C.faint, fontSize: 11.5, textAlign: "right" }}>Only {nameOf(t.from)} can mark this paid</span>}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Add / Edit expense ----------------
type Party = { kind: "member" | "guest"; id: string; name: string; avatar_url?: string | null; sponsor?: string };

function AddExpense({ user, gid, members, guests, busy, setBusy, requireOnline, onAddGuest, onSaved, editing, editShares, editPayers, editHistory, onLog, canDelete, onDelete }: {
  user: { id: string }; gid: string; members: Member[]; guests: GuestRow[]; busy: boolean; setBusy: (b: boolean) => void;
  requireOnline: () => boolean;
  onAddGuest: (name: string, sponsor: string) => Promise<void>;
  onSaved: () => Promise<void>;
  editing?: ExpenseRow | null; editShares?: ShareRow[]; editPayers?: PayerRow[]; editHistory?: any[]; onLog?: (action: string, summary: string, meta?: any) => Promise<void>; canDelete?: boolean; onDelete?: () => Promise<void>;
}) {
  const skey = (s: ShareRow) => (s.user_id ? "u:" + s.user_id : "g:" + s.guest_id);
  const [desc, setDesc] = useState(editing?.description || "");
  const [amount, setAmount] = useState(editing ? (editing.amount_cents / 100).toString() : "");
  const [cat, setCat] = useState(editing?.category || "tee");
  const initP = editPayers || [];
  const [payer, setPayer] = useState(initP[0]?.user_id || editing?.payer_user_id || user.id);
  const [multiPayer, setMultiPayer] = useState(initP.length > 1);
  const [payerSet, setPayerSet] = useState<Set<string>>(new Set(initP.length ? initP.map((p) => p.user_id) : [editing?.payer_user_id || user.id]));
  const [payerAmt, setPayerAmt] = useState<Record<string, string>>(Object.fromEntries(initP.map((p) => [p.user_id, (p.paid_cents / 100).toString()])));
  const [mode, setMode] = useState<"even" | "custom">(editing?.split_type || "even");
  const [checked, setChecked] = useState<Set<string>>(new Set((editShares || []).map(skey)));
  const [custom, setCustom] = useState<Record<string, string>>(Object.fromEntries((editShares || []).map((s) => [skey(s), (s.share_cents / 100).toString()])));
  const [showGuest, setShowGuest] = useState(false);
  const [gName, setGName] = useState("");
  const [gSponsor, setGSponsor] = useState(user.id);

  const parties: Party[] = [
    ...members.map((m) => ({ kind: "member" as const, id: m.id, name: m.display_name, avatar_url: m.avatar_url })),
    ...guests.map((g) => ({ kind: "guest" as const, id: g.id, name: g.name, sponsor: g.sponsor_user_id })),
  ];
  const keyOf = (p: Party) => (p.kind === "member" ? "u:" : "g:") + p.id;
  const amtCents = Math.round((parseFloat(amount) || 0) * 100);
  const centsOf = (str?: string) => Math.round((parseFloat(str || "") || 0) * 100);
  const selected = parties.filter((p) => checked.has(keyOf(p)));

  const evenMap: Record<string, number> = {};
  if (mode === "even" && selected.length) { const arr = evenShares(amtCents, selected.length); selected.forEach((p, i) => { evenMap[keyOf(p)] = arr[i]; }); }
  const shareOf = (p: Party) => mode === "even" ? (evenMap[keyOf(p)] || 0) : centsOf(custom[keyOf(p)]);
  const customSum = selected.reduce((s, p) => s + centsOf(custom[keyOf(p)]), 0);
  const customOk = mode === "even" || validateCustomTotal(selected.map((p) => centsOf(custom[keyOf(p)])), amtCents);
  const paidPayers = multiPayer ? members.filter((mm) => payerSet.has(mm.id)).map((mm) => mm.id) : [payer];
  const paidSum = multiPayer ? paidPayers.reduce((s, uid) => s + centsOf(payerAmt[uid]), 0) : amtCents;
  const paidOk = !multiPayer || (paidPayers.length > 0 && paidSum === amtCents);
  const canSave = !!desc.trim() && amtCents > 0 && selected.length > 0 && customOk && paidOk && paidPayers.length > 0 && !busy;
  const togglePayer = (uid: string) => { const n = new Set(payerSet); n.has(uid) ? n.delete(uid) : n.add(uid); setPayerSet(n); };
  const splitPayersEven = () => { const ids = members.filter((mm) => payerSet.has(mm.id)).map((mm) => mm.id); const arr = evenShares(amtCents, ids.length); const nm: Record<string, string> = {}; ids.forEach((uid, i) => { nm[uid] = (arr[i] / 100).toString(); }); setPayerAmt(nm); };
  const runningRemain = (order: string[], amtOf: (k: string) => number, isSel: (k: string) => boolean) => {
    const out: Record<string, number> = {}; let run = 0;
    order.forEach((k) => { if (isSel(k)) { run += amtOf(k); out[k] = amtCents - run; } });
    return out;
  };
  const splitRemainAfter = runningRemain(parties.map(keyOf), (k) => centsOf(custom[k]), (k) => checked.has(k));
  const payRemainAfter = runningRemain(members.map((mm) => mm.id), (k) => centsOf(payerAmt[k]), (k) => payerSet.has(k));
  const remHint = (v: number | undefined): React.CSSProperties => ({ fontSize: 10.5, whiteSpace: "nowrap", color: v === 0 ? "#7fd6a3" : (v ?? 0) < 0 ? "#ef9d90" : C.sage });

  const toggle = (p: Party) => { const k = keyOf(p); const n = new Set(checked); n.has(k) ? n.delete(k) : n.add(k); setChecked(n); };

  async function save() {
    if (!requireOnline() || !canSave) return;
    setBusy(true);
    const primaryPayer = paidPayers[0];
    const payload = { payer_user_id: primaryPayer, description: desc.trim(), category: cat, amount_cents: amtCents, split_type: mode };
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
    await onLog?.(editing ? "expense_edited" : "expense_created", (editing ? "edited “" : "added “") + (desc.trim() || catLabel(cat)) + "” — " + fmtUSD(amtCents), { expense_id: expId, amount_cents: amtCents });
    setBusy(false);
    await onSaved();
  }

  const sponsorName = (uid: string) => members.find((m) => m.id === uid)?.display_name || "?";

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

      <Eyebrow>Category</Eyebrow>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {CATS.map((c) => <button key={c.k} onClick={() => setCat(c.k)} style={chip(cat === c.k)}>{c.label}</button>)}
      </div>

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
        return (
          <div key={keyOf(p)} onClick={() => toggle(p)} style={{ display: "flex", alignItems: "center", gap: 9, background: on ? "#1c4536" : "#173a2c", border: `1.5px solid ${on ? "#3c6f59" : "transparent"}`, borderRadius: 10, padding: "8px 10px", marginTop: 6, cursor: "pointer" }}>
            <span style={{ width: 19, height: 19, borderRadius: 5, border: `2px solid ${on ? C.gold : C.sage}`, background: on ? C.gold : "transparent", color: "#2a2410", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: 12 }}>{on ? "✓" : ""}</span>
            <Avatar src={p.avatar_url} name={p.name} size={24} />
            <span style={{ flex: 1, color: C.cream, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>{p.name}{p.kind === "guest" ? <span style={{ color: C.sage, fontSize: 10.5, fontWeight: 700 }}> · guest of {sponsorName(p.sponsor!)}</span> : ""}</span>
            {on && (mode === "even"
              ? <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontWeight: 700 }}>{fmtUSD(shareOf(p))}</span>
              : <span style={{ display: "flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <input inputMode="decimal" placeholder="0.00" value={custom[keyOf(p)] ?? ""} onChange={(e) => setCustom((c) => ({ ...c, [keyOf(p)]: e.target.value }))} style={{ ...inputStyle, width: 68, textAlign: "right", padding: "6px 8px" }} />
                  <span style={remHint(splitRemainAfter[keyOf(p)])}>/ {fmtUSD(splitRemainAfter[keyOf(p)] ?? amtCents)} left</span>
                </span>)}
          </div>
        );
      })}

      {!showGuest
        ? <button onClick={() => setShowGuest(true)} style={{ ...btn(false), marginTop: 10 }}>+ Add a guest</button>
        : (
          <div style={{ background: "#173a2c", borderRadius: 10, padding: 10, marginTop: 10 }}>
            <Eyebrow>Guest name</Eyebrow>
            <input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="e.g. Sam" style={inputStyle} />
            <Eyebrow>Sponsored by (responsible member)</Eyebrow>
            <select value={gSponsor} onChange={(e) => setGSponsor(e.target.value)} style={inputStyle}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
            </select>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button disabled={!gName.trim()} onClick={async () => { await onAddGuest(gName.trim(), gSponsor); setGName(""); setShowGuest(false); }} style={{ ...btn(true), flex: 1 }}>Add guest</button>
              <button onClick={() => setShowGuest(false)} style={{ ...btn(false), flex: 1 }}>Cancel</button>
            </div>
          </div>
        )}

      <button disabled={!canSave} onClick={save} style={{ ...btn(true), marginTop: 14, opacity: canSave ? 1 : 0.5 }}>{editing ? "Save changes" : "Add expense"}</button>
      {editing && canDelete && (
        <button disabled={busy} onClick={async () => { if (!requireOnline()) return; if (!window.confirm("Delete this expense? Everyone's balances will recompute. Payments already marked settled stay recorded.")) return; setBusy(true); await onDelete?.(); }}
          style={{ ...btn(false), marginTop: 8, color: C.birdie, borderColor: C.birdie }}>Delete expense</button>
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

const ACT_ICON: Record<string, string> = { expense_created: "+", expense_edited: "✎", expense_deleted: "✕", settlement_added: "✓", guest_added: "☺" };
function ActivityLog({ activity, memberById }: { activity: any[]; memberById: Record<string, Member> }) {
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>Activity log</div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 6 }}>Everything that's happened with the group's money · visible to all, cannot be edited</div>
      {activity.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: "8px 2px" }}>Nothing logged yet.</div>}
      {activity.map((a) => {
        const who = memberById[a.actor_user_id]?.display_name || "Someone";
        return (
          <div key={a.id} style={{ display: "flex", gap: 9, padding: "9px 2px", borderBottom: `1px solid ${C.greenMid}` }}>
            <span style={{ fontSize: 14, width: 18, textAlign: "center", color: C.gold }}>{ACT_ICON[a.action] || "•"}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontSize: 13 }}><b>{who}</b> {a.summary}</div>
              <div style={{ color: C.faint, fontSize: 10.5 }}>{new Date(a.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategorySummary({ expenses }: { expenses: ExpenseRow[] }) {
  const total = expenses.reduce((s, e) => s + e.amount_cents, 0);
  if (!total) return null;
  const byCat: Record<string, number> = {};
  expenses.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + e.amount_cents; });
  const rows = CATS.map((c) => ({ label: c.label, cents: byCat[c.k] || 0 })).filter((r) => r.cents > 0).sort((a, b) => b.cents - a.cents);
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 13px", marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ flex: 1, color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 800 }}>Spend by category</div>
        <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800 }}>{fmtUSD(total)}</div>
      </div>
      {rows.map((r) => (
        <div key={r.label} style={{ marginTop: 9 }}>
          <div style={{ display: "flex", fontSize: 12.5, color: C.cream }}><span style={{ flex: 1 }}>{r.label}</span><span style={{ color: C.sage }}>{fmtUSD(r.cents)} · {Math.round((r.cents / total) * 100)}%</span></div>
          <div style={{ height: 7, background: "#123528", borderRadius: 4, marginTop: 3, overflow: "hidden" }}>
            <div style={{ width: `${((r.cents / total) * 100).toFixed(1)}%`, height: "100%", background: C.gold }} />
          </div>
        </div>
      ))}
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
