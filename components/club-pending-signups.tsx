"use client";
// "1 sign-up waiting" for a club's admins (208.0). Only possible duplicates who came through THIS club's
// invite are shown here — sign-ups with no invite go to system admins only. Club admins may admit or reject;
// merging a duplicate is a system-admin action.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";

type Held = { id: string; display_name: string | null; email: string | null; pending_since: string | null; match_name: string | null; match_email: string | null };

export function ClubPendingSignups({ groupId, groupName }: { groupId: string; groupName: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Held[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.rpc("club_pending_signups", { p_group: groupId });
    setRows((data || []) as Held[]);
  }, [supabase, groupId]);
  useEffect(() => { void load(); }, [load]);
  if (!rows.length) return null;
  const decide = async (r: Held, admit: boolean) => {
    if (!admit && !confirm(`Reject ${r.display_name || r.email}? Their email will be blocked from signing in.`)) return;
    setBusy(r.id);
    const { error } = admit
      ? await supabase.rpc("admit_signup", { p_user: r.id, p_group: groupId })
      : await supabase.rpc("reject_signup", { p_user: r.id, p_reason: `Rejected by a ${groupName} admin` });
    setBusy(null);
    if (error) { alert(`${admit ? "Couldn't admit" : "Couldn't reject"}: ${error.message}`); return; }
    await load();
  };
  return (
    <div data-club-pending style={{ background: C.greenMid, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: "13px 16px", marginBottom: 12 }}>
      <button type="button" onClick={() => setOpen((o) => !o)} style={{ background: "transparent", border: "none", padding: 0, color: C.cream, fontSize: 14, textAlign: "left", cursor: "pointer", width: "100%" }}>
        <b>{rows.length} sign-up{rows.length === 1 ? "" : "s"} waiting</b> — joined with {groupName}&apos;s invite but may already have an account. <span style={{ color: C.gold, fontWeight: 800 }}>{open ? "Hide" : "Review →"}</span>
      </button>
      {open ? rows.map((r) => (
        <div key={r.id} style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.green}` }}>
          <div style={{ color: C.cream, fontSize: 14 }}><b>{r.display_name || "(no name)"}</b> <span style={{ color: C.sage, fontSize: 12.5 }}>· {r.email}</span></div>
          {r.match_name ? <div style={{ color: C.sage, fontSize: 12.5, marginTop: 2 }}>Same name as member <b style={{ color: C.cream }}>{r.match_name}</b> ({r.match_email}). If it&apos;s the same person, ask them to sign in with that account — or ask a system admin to merge them.</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" disabled={busy === r.id} style={{ ...btn(true), fontSize: 12 }} onClick={() => decide(r, true)}>Admit to {groupName}</button>
            <button type="button" disabled={busy === r.id} style={{ ...btn(false), fontSize: 12 }} onClick={() => decide(r, false)}>Reject</button>
          </div>
        </div>
      )) : null}
    </div>
  );
}
