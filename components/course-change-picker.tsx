"use client";
// Choose which provider changes to apply (209.1), from the approved mock. Items come from lib/course-merge —
// the same code the server uses to merge — so what's ticked here is exactly what gets applied.
import React, { useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { createClient } from "@/lib/supabase";
import { changeItems, withoutDeclined, type ChangeItem } from "@/lib/course-merge";
import type { Course } from "@/lib/courses";

type Detail = { stored: Course; api: Course; revision: number; declined: Record<string, unknown>; last_provider: Course | null; corrected_at: string | null };
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

export function CourseChangePicker({ courseId, courseName, onDone }: {
  courseId: string; courseName: string; onDone: (outcome: { kind: "applied" | "kept"; count: number; message: string }) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [usage, setUsage] = useState<Record<string, { rounds: number; players: number }>>({});
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: d, error: e1 }, { data: u }] = await Promise.all([
        supabase.rpc("course_review_detail", { p_course_id: courseId }),
        // bounded: one row per tee of one course
        supabase.rpc("course_tee_usage", { p_course_id: courseId, p_year: new Date().getFullYear() }),
      ]);
      if (!live) return;
      if (e1 || !d) { setErr(e1?.message || "Couldn't load this update."); return; }
      setDetail(d as Detail);
      setUsage(Object.fromEntries(((u || []) as { tee_name: string; rounds: number; players: number }[]).map((r) => [r.tee_name.trim().toLowerCase(), { rounds: Number(r.rounds), players: Number(r.players) }])));
    })();
    return () => { live = false; };
  }, [supabase, courseId]);

  const items: ChangeItem[] = useMemo(() => (detail ? withoutDeclined(changeItems(detail.stored, detail.api, detail.last_provider), detail.declined) : []), [detail]);
  useEffect(() => { setOn(Object.fromEntries(items.map((i) => [i.key, i.defaultOn]))); }, [items]);
  const selected = items.filter((i) => on[i.key]).map((i) => i.key);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/courses/apply-selected", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ courseId, revision: detail!.revision, ...body }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || res.statusText);
    return j;
  };
  const apply = async () => {
    if (!selected.length) return;
    if (!confirm(`Apply ${selected.length} selected change${selected.length === 1 ? "" : "s"} to "${courseName}" for everyone? Unticked changes are kept as they are and won't be asked about again unless the provider changes them.`)) return;
    setBusy(true); setErr(null);
    try { await post({ selected }); onDone({ kind: "applied", count: selected.length, message: `"${courseName}": applied ${selected.length} change${selected.length === 1 ? "" : "s"}.` }); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const keep = async () => {
    const reason = window.prompt("Keep the current data. Reason (optional):", "");
    if (reason === null) return;
    setBusy(true); setErr(null);
    try {
      await post({ selected: [], keep: true });
      const { error } = await supabase.rpc("dismiss_course_freshness", { p_course_id: courseId, p_revision: detail!.revision, p_reason: reason || null });
      if (error) throw new Error(error.message);
      onDone({ kind: "kept", count: items.length, message: `"${courseName}": kept the current data.` });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  if (err && !detail) return <div style={{ color: C.gold, fontSize: 12.5 }}>{err}</div>;
  if (!detail) return <div style={{ color: C.sage, fontSize: 12.5 }}>Loading the changes…</div>;
  if (!items.length) return <div style={{ color: C.sage, fontSize: 12.5 }}>Nothing new — every difference here was declined before.</div>;
  return (
    <div data-course-change-picker>
      <div style={{ color: C.sage, fontSize: 12.5, marginBottom: 8 }}>Tick the changes to take; anything unticked stays as it is.</div>
      {items.map((it) => {
        const u = it.kind === "tee_remove" ? usage[it.label.replace(/ tees removed$/, "").trim().toLowerCase()] : undefined;
        const why = it.kind === "tee_remove"
          ? (u ? `Played in ${u.rounds} round${u.rounds === 1 ? "" : "s"} by ${u.players} member${u.players === 1 ? "" : "s"} this year — unticked by default` : "Not played this year — unticked by default")
          : it.handCorrected ? `You corrected this by hand${detail.corrected_at ? ` on ${day(detail.corrected_at)}` : ""} — unticked so your correction is kept` : null;
        return (
          <label key={it.key} data-change={it.key} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: C.green, borderRadius: 10, padding: "8px 12px", marginTop: 6, cursor: "pointer" }}>
            <input type="checkbox" checked={!!on[it.key]} onChange={(e) => setOn((m) => ({ ...m, [it.key]: e.target.checked }))} style={{ marginTop: 3, width: 16, height: 16, accentColor: C.gold }} />
            <span style={{ fontSize: 13.5, color: C.cream, lineHeight: 1.4 }}><b>{it.label}</b>
              {it.detail ? <span style={{ display: "block", color: C.sage, fontSize: 12 }}>{it.detail}</span> : null}
              {why ? <span style={{ display: "block", color: C.gold, fontSize: 12 }}>{why}</span> : null}
            </span>
          </label>
        );
      })}
      {err ? <div style={{ color: C.gold, fontSize: 12.5, marginTop: 8 }}>{err}</div> : null}
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || !selected.length} style={{ ...btn(true), fontSize: 12, opacity: busy || !selected.length ? 0.5 : 1 }} onClick={apply}>
          {busy ? "Working…" : `Apply ${selected.length} selected change${selected.length === 1 ? "" : "s"}`}
        </button>
        <button type="button" disabled={busy} style={{ ...btn(false), fontSize: 12 }} onClick={keep}>Keep current data</button>
      </div>
    </div>
  );
}
