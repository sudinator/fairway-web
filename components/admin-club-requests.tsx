"use client";
// Admin → Club requests (210.8). System admins see EVERY pending club request (admin_club_requests — the old list
// read clubs directly, and a club is visible only to its members and creator, so it was always empty) and
// approve or decline it (decide_club_request — the requester is notified). Success is reported only when the
// database confirms it.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { btn, Eyebrow } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { logActivity } from "@/lib/activity";

type Req = { id: string; name: string; request_note: string | null; created_at: string; requester_id: string | null; requester_name: string | null; requester_email: string | null };

export function AdminClubRequests({ user, onCount }: { user: { id: string; email?: string | null }; onCount?: (n: number) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Req[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(async () => {
    // bounded: pending club requests (a handful)
    const { data, error } = await supabase.rpc("admin_club_requests");
    if (error) { setErr(`Couldn't load club requests: ${error.message}`); return; }
    setErr(null); setRows((data || []) as Req[]); onCount?.((data || []).length);
  }, [supabase, onCount]);
  useEffect(() => { void load(); }, [load]);

  const decide = async (r: Req, approve: boolean) => {
    if (!approve && !confirm(`Decline the club request "${r.name}"?`)) return;
    setBusy(r.id); setErr(null); setDone(null);
    const { error } = await supabase.rpc("decide_club_request", { p_group: r.id, p_approve: approve });
    setBusy(null);
    if (error) { setErr(`Couldn't ${approve ? "approve" : "decline"} "${r.name}": ${error.message}`); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Admin", action: approve ? "group_approved" : "group_declined",
      group_id: approve ? r.id : undefined, summary: `${approve ? "Approved" : "Declined"} the club "${r.name}"` });
    setDone(approve ? `"${r.name}" is approved — ${r.requester_name || "the requester"} has been notified and can invite their group.` : `"${r.name}" was declined — ${r.requester_name || "the requester"} has been notified.`);
    await load();
  };

  return (
    <div data-admin-club-requests>
      <Eyebrow>★ CLUB REQUESTS{rows?.length ? ` (${rows.length})` : ""}</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>New clubs need your approval. Approve to make a club active for its members, or decline the request.</div>
      {done ? <div style={{ color: C.gold, fontSize: 13, marginTop: 8 }} data-club-request-done>{done}</div> : null}
      {err ? <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 8 }}>{err}</div> : null}
      {rows && rows.length === 0 ? <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 8, color: C.sage }}>No pending requests.</div> : null}
      {(rows || []).map((r) => (
        <div key={r.id} data-club-request={r.name} style={{ background: C.greenLight, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ color: C.cream, fontWeight: 700 }}>{r.name}</div>
            <div style={{ color: C.sage, fontSize: 12 }}>
              from {r.requester_name || r.requester_email || "a member"}{r.requester_email && r.requester_name ? ` (${r.requester_email})` : ""}
              {" · "}{new Date(r.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {r.request_note ? ` · "${r.request_note}"` : ""}
            </div>
          </div>
          <button disabled={busy === r.id} style={{ ...btn(true), padding: "7px 12px", fontSize: 12, opacity: busy === r.id ? 0.6 : 1 }} onClick={() => void decide(r, true)}>Approve</button>
          <button disabled={busy === r.id} style={{ ...btn(false), padding: "7px 12px", fontSize: 12, color: C.overRedDark }} onClick={() => void decide(r, false)}>Decline</button>
        </div>
      ))}
    </div>
  );
}
