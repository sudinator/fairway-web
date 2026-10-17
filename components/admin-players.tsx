"use client";
// Admin → Players (208.0), from the approved mock. One Google account per member. The rule:
//   duplicate → MERGE into the member's real account, then it's taken out (never just deleted)
//   stranger  → REJECT (from the sign-up queue)
//   member who leaves / misbehaves → SUSPEND (history kept; nobody's balances change)
//   account with no activity at all → REMOVE
// Every decision is made by a server function that refuses out loud; this screen shows what it says.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";
import { createClient } from "@/lib/supabase";

type Player = {
  id: string; display_name: string | null; email: string | null; is_admin: boolean; is_owner: boolean; banned: boolean;
  handicap_index: number | null; group_count: number; rounds_count: number;
  account_status: string; status_reason: string | null; status_at: string | null; status_by_name: string | null;
  merged_into_name: string | null; merged_into_email: string | null; pending_kind: string | null; last_active: string | null;
};
type Pending = {
  id: string; display_name: string | null; email: string | null; pending_kind: string | null; pending_since: string | null;
  duplicate_acknowledged: boolean; club_id: string | null; club_name: string | null;
  match_id: string | null; match_name: string | null; match_email: string | null; match_clubs: string | null; match_rounds: number | null; match_last_active: string | null;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const TAG: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: "PENDING", bg: C.greenMid, fg: C.sage },
  suspended: { label: "SUSPENDED", bg: C.gold, fg: C.green },
  merged: { label: "MERGED", bg: C.overRedDark, fg: C.cream },
  removed: { label: "REMOVED", bg: C.overRedDark, fg: C.cream },
};
const FILTERS = [["all", "All"], ["active", "Active"], ["pending", "Pending"], ["suspended", "Suspended"], ["gone", "Merged / removed"]] as const;

export function AdminPlayers({ user, isOwner }: { user: { id: string }; isOwner?: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Player[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [clubs, setClubs] = useState<{ id: string; name: string }[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("active");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [admitClub, setAdmitClub] = useState<Record<string, string>>({});
  const [merge, setMerge] = useState<{ remove: Player | Pending; keep: string; preview: any | null } | null>(null);

  const load = async () => {
    const [{ data: u, error: uErr }, { data: p }, { data: g }] = await Promise.all([
      supabase.rpc("admin_list_users"), supabase.rpc("admin_pending_signups"),
      supabase.from("groups").select("id, name").eq("status", "active").order("name"),
    ]);
    if (uErr) { alert(`Couldn't load players: ${uErr.message}`); return; }
    setRows((u || []) as Player[]); setPending((p || []) as Pending[]); setClubs((g || []) as { id: string; name: string }[]);
  };
  useEffect(() => { void load(); }, []);

  // Every action reports the server's own words — success or refusal — never fails silently.
  const act = async (id: string, label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(id);
    try {
      const { error } = await run();
      if (error) { alert(`${label}: ${error.message}`); return; }
      await load();
    } finally { setBusy(null); }
  };
  const admit = (p: Pending) => {
    const club = admitClub[p.id] || p.club_id;
    if (!club) { alert("Choose a club to admit them to."); return; }
    return act(p.id, "Couldn't admit", () => supabase.rpc("admit_signup", { p_user: p.id, p_group: club }));
  };
  const reject = (p: Pending) => {
    if (!confirm(`Reject ${p.display_name || p.email}? Their email will be blocked from signing in.`)) return;
    return act(p.id, "Couldn't reject", () => supabase.rpc("reject_signup", { p_user: p.id, p_reason: "Sign-up rejected" }));
  };
  const suspend = (u: Player, on: boolean) => {
    const reason = on ? prompt(`Suspend ${u.display_name || u.email}? They can't sign in until restored; their history stays.\n\nReason (shown in Admin):`, "Left the club") : null;
    if (on && reason === null) return;
    return act(u.id, on ? "Couldn't suspend" : "Couldn't restore", () => supabase.rpc("set_account_suspended", { p_user: u.id, p_suspended: on, p_reason: reason }));
  };
  const restore = (u: Player) => {
    if (!confirm(`Restore ${u.display_name || u.email}? Their email is unblocked and they can sign in again.`)) return;
    return act(u.id, "Couldn't restore", () => supabase.rpc("restore_account", { p_user: u.id }));
  };
  const remove = (u: Player) => {
    const reason = prompt(`Remove ${u.display_name || u.email}?\n\nOnly an account with no rounds, games or money can be removed. A duplicate is merged instead; a member with history is suspended. The server will tell you if either applies.\n\nReason (shown in Admin):`, "Test account");
    if (reason === null) return;
    return act(u.id, "Not removed", () => supabase.rpc("remove_account", { p_user: u.id, p_reason: reason }));
  };
  const startMerge = (remove: Player | Pending, keep = "") => setMerge({ remove, keep, preview: null });
  useEffect(() => {
    if (!merge?.keep) return;
    supabase.rpc("account_merge_preview", { p_keep: merge.keep, p_remove: merge.remove.id })
      .then(({ data, error }) => setMerge((m) => (m ? { ...m, preview: error ? { error: error.message } : data } : m)));
  }, [merge?.keep, merge?.remove.id, supabase]);
  const runMerge = async () => {
    if (!merge?.preview?.ok) return;
    const keepName = merge.preview.keep?.name || "the kept account";
    if (!confirm(`Merge ${merge.remove.email} into ${keepName}?\n\nEverything moves to ${keepName}; ${merge.remove.email} is then blocked from signing in. This can't be undone with one tap.`)) return;
    setBusy(merge.remove.id);
    try {
      const res = await fetch("/api/admin/merge-accounts", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ keep: merge.keep, remove: merge.remove.id, reason: `Duplicate of ${keepName}` }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { alert(`Not merged: ${j.error || res.statusText}`); return; }
      setMerge(null); await load();
    } finally { setBusy(null); }
  };

  // The merge panel opens directly under the row (or sign-up) it belongs to, and scrolls into view —
  // 208.1: it used to open at the top of the list, off-screen from the row that was tapped.
  const mergePanel = () => (merge ? (
        <div data-merge-panel ref={(el) => { el?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }} style={{ background: C.greenMid, borderRadius: 12, padding: "13px 16px", marginTop: 10 }}>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>Merge {merge.remove.email} into…</div>
          <select value={merge.keep} onChange={(e) => setMerge({ ...merge, keep: e.target.value, preview: null })} style={{ ...inputStyle, marginTop: 8 }}>
            <option value="">Choose the account to keep…</option>
            {keepChoices.map((k) => <option key={k.id} value={k.id}>{k.display_name} — {k.email} · {k.rounds_count} rounds</option>)}
          </select>
          {merge.preview?.error ? <div style={{ color: C.gold, fontSize: 13, marginTop: 8 }}>{merge.preview.error}</div> : null}
          {merge.preview && !merge.preview.error ? (
            <div style={{ marginTop: 8, fontSize: 13, color: C.sage }}>
              {(merge.preview.counts || []).length === 0 ? <div>Nothing to move — the duplicate is empty.</div> : (
                <div>Moves to {merge.preview.keep?.name}: {(merge.preview.counts as any[]).filter((c) => c.activity).map((c) => `${c.rows} ${String(c.table).replace(/_/g, " ")}`).join(" · ") || "only background records"}</div>
              )}
              {(merge.preview.blockers || []).map((b: string, i: number) => <div key={i} style={{ color: C.gold, marginTop: 4 }}>⚠ {b}</div>)}
              {merge.preview.ok ? <div style={{ marginTop: 4 }}>Club balances don&apos;t change — every expense and settlement moves with him.</div> : null}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button type="button" disabled={!merge.preview?.ok || busy === merge.remove.id} style={{ ...btn(true), fontSize: 13 }} onClick={runMerge}>{busy === merge.remove.id ? "Merging…" : "Merge"}</button>
            <button type="button" style={{ ...btn(false), fontSize: 13 }} onClick={() => setMerge(null)}>Cancel</button>
          </div>
        </div>
  ) : null);

  const counts = useMemo(() => {
    const r = rows || [];
    return { all: r.length, active: r.filter((x) => x.account_status === "active").length, pending: r.filter((x) => x.account_status === "pending").length,
             suspended: r.filter((x) => x.account_status === "suspended").length, gone: r.filter((x) => x.account_status === "merged" || x.account_status === "removed").length };
  }, [rows]);
  const shown = (rows || []).filter((r) => {
    const okF = filter === "all" || (filter === "gone" ? (r.account_status === "merged" || r.account_status === "removed") : r.account_status === filter);
    const s = q.trim().toLowerCase();
    return okF && (!s || (r.display_name || "").toLowerCase().includes(s) || (r.email || "").toLowerCase().includes(s));
  });
  const keepChoices = (rows || []).filter((r) => (r.account_status === "active" || r.account_status === "suspended") && r.id !== merge?.remove.id);

  return (
    <div data-admin-players>
      {pending.length ? (
        <div data-signup-queue style={{ marginBottom: 16 }}>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 12, letterSpacing: 1.5, marginBottom: 6 }}>NEW SIGN-UPS ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} style={{ background: C.greenLight, borderRadius: 12, padding: "13px 16px", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <b style={{ color: C.cream, fontSize: 15 }}>{p.display_name || "(no name)"}</b>
                <span style={{ background: p.pending_kind === "possible_duplicate" ? C.gold : C.greenMid, color: p.pending_kind === "possible_duplicate" ? C.green : C.sage, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>
                  {p.pending_kind === "possible_duplicate" ? "POSSIBLE DUPLICATE" : "NO INVITE"}
                </span>
              </div>
              <div style={{ color: C.sage, fontSize: 12.5, marginTop: 4 }}>{p.email} · signed up {when(p.pending_since)}{p.club_name ? ` · came through ${p.club_name}'s invite` : " · no invite"}</div>
              {p.match_id ? (
                <div style={{ color: C.sage, fontSize: 12.5, marginTop: 2 }}>
                  Matches member <b style={{ color: C.cream }}>{p.match_name}</b> — {p.match_email}{p.match_clubs ? ` · ${p.match_clubs}` : ""} · {p.match_rounds ?? 0} round{p.match_rounds === 1 ? "" : "s"}{p.match_last_active ? ` · last active ${when(p.match_last_active)}` : ""}
                </div>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {p.match_id ? <button type="button" disabled={busy === p.id} style={{ ...btn(true), fontSize: 12 }} onClick={() => startMerge(p, p.match_id!)}>Duplicate — merge into {p.match_name}</button> : null}
                {!p.club_id ? (
                  <select value={admitClub[p.id] || ""} onChange={(e) => setAdmitClub((m) => ({ ...m, [p.id]: e.target.value }))} style={{ ...inputStyle, width: "auto", fontSize: 13, padding: "8px 12px" }}>
                    <option value="">Choose club…</option>
                    {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                ) : null}
                <button type="button" disabled={busy === p.id} style={{ ...btn(!p.match_id), fontSize: 12 }} onClick={() => admit(p)}>Admit{p.club_name ? ` to ${p.club_name}` : ""}</button>
                <button type="button" disabled={busy === p.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => reject(p)}>Reject</button>
              </div>
              {!p.duplicate_acknowledged && p.pending_kind === "possible_duplicate" ? <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>They haven&apos;t answered &quot;Is this you?&quot; yet — they may switch to their other Google account.</div> : null}
              {merge?.remove.id === p.id ? mergePanel() : null}
            </div>
          ))}
        </div>
      ) : null}

      <div data-player-filters style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setFilter(k)} style={{ ...btn(filter === k), fontSize: 12 }}>{label} {counts[k]}</button>
        ))}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…" style={{ ...inputStyle, marginTop: 12 }} />
      {rows === null ? <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div> : null}


      {shown.map((u) => {
        const tag = TAG[u.account_status];
        const isSelf = u.id === user.id;
        return (
          <div key={u.id} data-player={u.account_status} style={{ background: C.greenLight, borderRadius: 12, padding: "13px 16px", marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>{u.display_name || "(no name)"}</div>
              {u.is_owner ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>★ owner</span> : u.is_admin ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>★ system admin</span> : null}
              {tag ? <span style={{ background: tag.bg, color: tag.fg, borderRadius: 999, padding: "4px 10px", fontSize: 11, fontWeight: 800 }}>{tag.label}</span> : null}
            </div>
            <div style={{ color: C.sage, fontSize: 12.5, marginTop: 3 }}>{u.email || "—"} · {u.group_count} club{u.group_count === 1 ? "" : "s"} · {u.rounds_count} round{u.rounds_count === 1 ? "" : "s"}{u.handicap_index != null ? ` · hcp ${u.handicap_index}` : ""}</div>
            {u.account_status !== "active" && u.status_at ? (
              <div style={{ color: C.sage, fontSize: 12.5, marginTop: 2 }}>
                {u.account_status} {when(u.status_at)}{u.status_by_name ? ` by ${u.status_by_name}` : ""}{u.status_reason ? ` · ${u.status_reason}` : ""}
                {u.account_status === "merged" && u.merged_into_name ? <> · into <b style={{ color: C.cream }}>{u.merged_into_name}</b> ({u.merged_into_email})</> : null}
                {(u.account_status === "merged" || u.account_status === "removed") ? " · email blocked — can't sign in to BNN" : ""}
              </div>
            ) : null}
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {u.account_status === "active" && !u.is_owner && !isSelf ? <>
                <button type="button" disabled={busy === u.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => startMerge(u)}>Merge into…</button>
                <button type="button" disabled={busy === u.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => suspend(u, true)}>Suspend</button>
                {!u.is_admin ? <button type="button" disabled={busy === u.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => remove(u)}>Remove</button> : null}
              </> : null}
              {u.account_status === "suspended" ? <button type="button" disabled={busy === u.id} style={{ ...btn(true), fontSize: 12 }} onClick={() => suspend(u, false)}>Restore</button> : null}
              {u.account_status === "removed" ? <button type="button" disabled={busy === u.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => restore(u)}>Restore</button> : null}
              {isOwner && !u.is_owner && !isSelf && u.account_status === "active" ? (
                <button type="button" disabled={busy === u.id} style={{ ...btn(false), fontSize: 12 }}
                  onClick={() => {
                    if (!confirm(u.is_admin
                      ? `Remove system admin from ${u.display_name || u.email || "this user"}? They'll lose all system-admin access.`
                      : `Make ${u.display_name || u.email || "this user"} a system admin? They'll get full system-admin access across the app.`)) return;
                    void act(u.id, "Couldn't update", () => supabase.rpc("admin_set_system_admin", { p_user: u.id, p_make: !u.is_admin }));
                  }}>
                  {u.is_admin ? "Remove system admin" : "Make system admin"}
                </button>
              ) : null}
            </div>
            {merge?.remove.id === u.id ? mergePanel() : null}
          </div>
        );
      })}
    </div>
  );
}
