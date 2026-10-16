"use client";
// Course history and restore (207.0). Every version of a shared course (course_versions, 0186), newest
// first, each summarised by the SAME comparison the review screen uses (buildFreshnessDiff), so a
// change reads identically everywhere. Restore: site admins, a reason required, a confirmation that
// names the clubs sharing the course; it creates a NEW version — history is never erased.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { buildFreshnessDiff } from "@/lib/course-diff";
import { FreshnessDiffList } from "@/components/course-freshness-diff";
import type { Course } from "@/lib/courses";

type Version = { version: number; data: Course | null; source: string; actor: string | null; reason: string | null; ref: string | null; created_at: string; name: string | null };
const SOURCE: Record<string, string> = {
  initial: "Starting snapshot", created: "Course created", manual_edit: "Edited", member_correction: "Member correction approved",
  provider_update: "Provider update applied", restore: "Restored",
};

export function CourseHistory({ courseId, clubs, canRestore, onRestored }: { courseId: string; clubs: string; canRestore: boolean; onRestored?: () => void }) {
  // ONE client for the component's life: a new client per render made `load` change every render,
  // re-running the effect forever (caught by the rendered test hanging).
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Version[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [openV, setOpenV] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from("course_versions").select("version, data, source, actor, reason, ref, created_at, name").eq("course_id", courseId).order("version", { ascending: false });
    if (error) { setErr("Couldn't load the history."); return; }
    setRows((data || []) as Version[]);
    const ids = Array.from(new Set((data || []).map((r: any) => r.actor).filter(Boolean)));
    if (ids.length) {
      const { data: ps } = await supabase.from("profiles").select("id, display_name").in("id", ids);
      setNames(Object.fromEntries((ps || []).map((p: any) => [p.id, p.display_name])));
    }
  }, [supabase, courseId]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <div style={{ color: C.gold, fontSize: 12.5 }}>{err}</div>;
  if (!rows) return <div style={{ color: C.sage, fontSize: 12.5 }}>Loading history…</div>;
  const current = rows[0]?.version;
  const restore = async (v: Version) => {
    if (reason.trim().length < 3) { alert("Please give a reason for restoring this version."); return; }
    if (!confirm(`Restore version ${v.version} of this course?\n\nUsed by: ${clubs || "no club"}.\nThis becomes the current course for every club using it, as a new version — nothing in the history is removed. Rounds already played keep their own course details.`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("restore_course_version", { p_course_id: courseId, p_version: v.version, p_reason: reason.trim() });
    setBusy(false);
    if (error) { alert(`Couldn't restore: ${error.message}`); return; }
    setReason(""); setOpenV(null); await load(); onRestored?.();
  };
  return (
    <div data-course-history style={{ marginTop: 10 }}>
      <div style={{ color: C.gold, fontWeight: 800, fontSize: 12, letterSpacing: 1, marginBottom: 6 }}>HISTORY</div>
      {rows.map((v, i) => {
        const prev = rows[i + 1];
        const diff = prev?.data && v.data ? buildFreshnessDiff(prev.data, v.data) : null;
        const when = new Date(v.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
        return (
          <div key={v.version} data-version={v.version} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, paddingBottom: 6 }}>
            <button type="button" onClick={() => setOpenV(openV === v.version ? null : v.version)} style={{ background: "transparent", border: "none", padding: 0, width: "100%", textAlign: "left", color: C.cream, cursor: "pointer", WebkitAppearance: "none", appearance: "none" }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{SOURCE[v.source] || v.source}</span>
              <span style={{ color: C.sage, fontSize: 12 }}> · {when}{v.actor && names[v.actor] ? ` · ${names[v.actor]}` : ""}{v.version === current ? " · in use" : ""}</span>
              {v.reason ? <div style={{ color: C.sage, fontSize: 12 }}>{v.reason}</div> : null}
              {v.source === "initial" ? <div style={{ color: C.sage, fontSize: 12 }}>Earlier history unavailable.</div> : null}
            </button>
            {openV === v.version && (
              <div style={{ marginTop: 6 }}>
                {diff && diff.hasChanges ? <FreshnessDiffList diff={diff} maxHeight={220} /> : <div style={{ color: C.sage, fontSize: 12 }}>{prev ? "No rating, slope, yardage, tee or hole changes from the previous version." : "The first recorded version."}</div>}
                {canRestore && v.version !== current && (
                  <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for restoring" style={{ flex: 1, minWidth: 160, background: C.green, color: C.cream, border: `1px solid ${C.greenMid}`, borderRadius: 8, padding: "8px 12px", fontSize: 13 }} />
                    <button type="button" disabled={busy} onClick={() => void restore(v)} style={{ ...btn(true), fontSize: 12 }}>{busy ? "Restoring…" : "Restore this version"}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
