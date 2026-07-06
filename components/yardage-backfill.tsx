"use client";

// Admin-only tool: backfill / fix per-tee, per-hole YARDAGES in the saved course
// library (favorite_courses.data.tees[].yardages).
//
// Two parts:
//   A) Bulk auto: Preview -> Apply, pulling yardages from golfcourseapi by each
//      course's external_id. Writes only missing yardages.
//   B) Per-course editor: for courses the bulk pass can't handle (custom courses
//      with no external_id, or a stale/wrong external_id that errors), fill
//      yardages by (1) re-looking-up the correct course on golfcourseapi and
//      mapping tees, or (2) typing them in by hand.
//
// In ALL paths only the yardages array is written. Par, stroke index, rating,
// slope, tee names, external_id, the `corrected` flag, name/location/vetted are
// never touched.

import React, { useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, Eyebrow, inputStyle } from "@/components/ui";
import type { Course, CourseTee } from "@/lib/courses";

const supabase = createClient();
const norm = (s?: string) => (s || "").trim().toLowerCase();

type TeeReport = { tee: string; fill: number; reason?: string };
type CoursePlan = {
  id: string;
  name: string;
  externalId: string | null;
  status: "skip" | "error" | "nochange" | "ready";
  note?: string;
  tees: TeeReport[];
  newData?: Course;
};

type LibRow = { id: string; name: string; external_id: string | null; data: Course };

async function fetchApiCourse(extId: string): Promise<Course | null> {
  try {
    const res = await fetch(`/api/courses?id=${encodeURIComponent(extId)}`);
    if (!res.ok) return null;
    const j = await res.json();
    return (j.course || null) as Course | null;
  } catch {
    return null;
  }
}

function teeFilledCount(c: Course): { filled: number; total: number } {
  const tees = c.tees || [];
  return { filled: tees.filter((t) => (t.yardages || []).some((v) => v != null)).length, total: tees.length };
}

export function YardageBackfill() {
  const [open, setOpen] = useState(false);

  // ---- Bulk auto state ----
  const [running, setRunning] = useState(false);
  const [plans, setPlans] = useState<CoursePlan[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);
  const addLog = (m: string) => setLog((L) => [...L, m]);

  // ---- Editor state ----
  const [rows, setRows] = useState<LibRow[] | null>(null);
  const [selId, setSelId] = useState<string>("");
  const [yard, setYard] = useState<string[][]>([]); // [teeIdx][holeIdx] as strings
  const [eMsg, setEMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // lookup sub-state
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: number; club: string; name: string; location: string }[] | null>(null);
  const [apiCourse, setApiCourse] = useState<Course | null>(null);
  const [looking, setLooking] = useState(false);

  const sel = rows && selId ? rows.find((r) => r.id === selId) || null : null;
  const holesCount = sel ? (sel.data.holes || []).length || 18 : 18;

  // ---------- BULK ----------
  async function preview() {
    setRunning(true); setApplied(false); setPlans(null);
    setLog(["Loading every saved course…"]);
    const { data: rws, error } = await supabase.from("favorite_courses").select("id, name, external_id, data").order("name");
    if (error) { addLog("Could not load courses: " + error.message); setRunning(false); return; }
    const list = rws || [];
    addLog(`Found ${list.length} courses. Looking up yardages…`);
    const out: CoursePlan[] = [];
    for (const row of list) {
      const data: Course = (row.data || {}) as Course;
      const extId = data.externalId || (row as any).external_id || null;
      const hc = (data.holes || []).length;
      if (!extId) { out.push({ id: row.id, name: row.name, externalId: null, status: "skip", note: "Custom course (no golfcourseapi id) — use the editor below", tees: [] }); continue; }
      const api = await fetchApiCourse(String(extId));
      await new Promise((r) => setTimeout(r, 200));
      if (!api) { out.push({ id: row.id, name: row.name, externalId: String(extId), status: "error", note: `Lookup failed for id ${extId} (likely a stale/wrong id) — use the editor below to re-look-up`, tees: [] }); continue; }
      const apiTees = api.tees || [];
      const teeReports: TeeReport[] = [];
      let anyFill = false;
      const newTees: CourseTee[] = (data.tees || []).map((st) => {
        const at = apiTees.find((t) => norm(t.name) === norm(st.name));
        if (!at) { teeReports.push({ tee: st.name, fill: 0, reason: "no matching tee in golfcourseapi" }); return st; }
        const ay = at.yardages || [];
        if (!ay.some((v) => v != null)) { teeReports.push({ tee: st.name, fill: 0, reason: "API has no yardages for this tee" }); return st; }
        if (hc && ay.length !== hc) { teeReports.push({ tee: st.name, fill: 0, reason: `hole-count mismatch (api ${ay.length} vs course ${hc}) — skipped` }); return st; }
        const existing = st.yardages || [];
        const n = hc || ay.length;
        const merged: (number | null)[] = [];
        let fill = 0;
        for (let i = 0; i < n; i++) {
          const ex = existing[i];
          if (ex != null) merged[i] = ex;
          else if (ay[i] != null) { merged[i] = ay[i] as number; fill++; }
          else merged[i] = null;
        }
        if (fill > 0) anyFill = true;
        teeReports.push({ tee: st.name, fill });
        return { ...st, yardages: merged };
      });
      if (anyFill) out.push({ id: row.id, name: row.name, externalId: String(extId), status: "ready", tees: teeReports, newData: { ...data, tees: newTees } });
      else out.push({ id: row.id, name: row.name, externalId: String(extId), status: "nochange", note: "Nothing to fill", tees: teeReports });
    }
    setPlans(out);
    addLog(`Preview complete. ${out.filter((p) => p.status === "ready").length} course(s) ready. Nothing has been written.`);
    setRunning(false);
  }

  async function apply() {
    if (!plans) return;
    setRunning(true);
    const ready = plans.filter((p) => p.status === "ready" && p.newData);
    addLog(`Applying yardages to ${ready.length} course(s)…`);
    let ok = 0, failed = 0;
    for (const p of ready) {
      const { error } = await supabase.from("favorite_courses").update({ data: p.newData }).eq("id", p.id);
      if (error) { failed++; addLog(`✗ ${p.name}: ${error.message}`); }
      else { ok++; addLog(`✓ ${p.name}`); }
      await new Promise((r) => setTimeout(r, 80));
    }
    addLog(`Done. ${ok} updated${failed ? `, ${failed} failed` : ""}.`);
    setApplied(true); setRunning(false);
  }

  const counts = plans ? {
    ready: plans.filter((p) => p.status === "ready").length,
    nochange: plans.filter((p) => p.status === "nochange").length,
    skip: plans.filter((p) => p.status === "skip").length,
    error: plans.filter((p) => p.status === "error").length,
  } : null;
  const statusColor = (s: CoursePlan["status"]) => (s === "ready" ? "#1F8F54" : s === "error" ? C.birdie : C.faint);

  // ---------- EDITOR ----------
  async function loadRows() {
    setEMsg(null);
    const { data, error } = await supabase.from("favorite_courses").select("id, name, external_id, data").order("name");
    if (error) { setEMsg("Could not load courses: " + error.message); return; }
    setRows((data || []).map((r: any) => ({ id: r.id, name: r.name, external_id: r.external_id, data: (r.data || {}) as Course })));
  }

  function selectCourse(id: string) {
    setSelId(id); setEMsg(null); setResults(null); setApiCourse(null); setQ("");
    const r = (rows || []).find((x) => x.id === id);
    if (!r) { setYard([]); return; }
    const c = r.data; const n = (c.holes || []).length || 18;
    setYard((c.tees || []).map((t) => Array.from({ length: n }, (_, i) => { const v = (t.yardages || [])[i]; return v != null ? String(v) : ""; })));
  }

  function setCell(ti: number, hi: number, val: string) {
    setYard((Y) => { const c = Y.map((r) => r.slice()); if (!c[ti]) c[ti] = []; c[ti][hi] = val.replace(/[^0-9]/g, ""); return c; });
  }

  async function runSearch() {
    setLooking(true); setResults(null); setApiCourse(null);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(q.trim())}`);
      const j = await res.json();
      setResults(j.courses || []);
      if (!j.courses || !j.courses.length) setEMsg("No matches on golfcourseapi for that search.");
    } catch { setEMsg("Search failed."); }
    setLooking(false);
  }

  async function pickResult(id: number) {
    setLooking(true); setEMsg(null);
    const c = await fetchApiCourse(String(id));
    setApiCourse(c);
    if (!c) setEMsg("Couldn't load that course's detail.");
    setLooking(false);
  }

  function fillTeeFrom(ti: number, apiTeeName: string) {
    if (!apiCourse) return;
    const at = (apiCourse.tees || []).find((t) => t.name === apiTeeName);
    if (!at) return;
    const ay = at.yardages || [];
    setYard((Y) => { const c = Y.map((r) => r.slice()); c[ti] = Array.from({ length: holesCount }, (_, i) => { const v = ay[i]; return v != null ? String(v) : ""; }); return c; });
  }

  function fillAllMatching() {
    if (!apiCourse || !sel) return;
    setYard((Y) => sel.data.tees.map((st, ti) => {
      const at = (apiCourse.tees || []).find((t) => norm(t.name) === norm(st.name));
      if (!at) return (Y[ti] || Array.from({ length: holesCount }, () => ""));
      const ay = at.yardages || [];
      return Array.from({ length: holesCount }, (_, i) => { const v = ay[i]; return v != null ? String(v) : ""; });
    }));
  }

  async function saveYardages() {
    if (!sel) return;
    setSaving(true); setEMsg(null);
    const orig = sel.data; const n = (orig.holes || []).length || 18;
    const parsed = (orig.tees || []).map((_t, ti) => Array.from({ length: n }, (_, i) => {
      const s = (yard[ti] || [])[i]; const num = parseInt((s || "").replace(/[^0-9]/g, ""), 10);
      return Number.isFinite(num) && num > 0 ? num : null;
    }));
    const newData: Course = { ...orig, tees: (orig.tees || []).map((t, ti) => ({ ...t, yardages: parsed[ti] })) };
    const { error } = await supabase.from("favorite_courses").update({ data: newData }).eq("id", sel.id);
    if (error) { setEMsg("Save failed: " + error.message); setSaving(false); return; }
    setRows((R) => (R || []).map((r) => (r.id === sel.id ? { ...r, data: newData } : r)));
    setEMsg("Saved ✓  Only yardages were written.");
    setSaving(false);
  }

  const courseLabel = (r: LibRow) => {
    const { filled, total } = teeFilledCount(r.data);
    const custom = !(r.data.externalId || r.external_id);
    const tag = total === 0 ? "" : filled === total ? " ✓ yardages" : filled === 0 ? " ✗ no yardages" : ` — ${filled}/${total} tees`;
    return `${r.name}${custom ? " (custom)" : ""}${tag}`;
  };

  return (
    <div style={{ background: C.greenMid, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginTop: 12, marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Eyebrow>YARDAGE BACKFILL · ADMIN</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={() => setOpen((v) => !v)}>{open ? "Hide" : "Open"}</button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          {/* ---------------- BULK ---------------- */}
          <div style={{ color: C.cream, fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>1 · BULK AUTO-FILL</div>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
            Pulls yardages from golfcourseapi by each course's id and fills <b style={{ color: C.cream }}>only missing</b> yardages. Run Preview first.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button style={{ ...btn(true), fontSize: 13, padding: "8px 16px", opacity: running ? 0.6 : 1 }} disabled={running} onClick={preview}>{running && !plans ? "Working…" : "Preview"}</button>
            <button style={{ ...btn(false), fontSize: 13, padding: "8px 16px", opacity: !counts || counts.ready === 0 || running || applied ? 0.5 : 1 }} disabled={!counts || counts.ready === 0 || running || applied} onClick={apply}>{applied ? "Applied ✓" : `Apply${counts ? ` (${counts.ready})` : ""}`}</button>
          </div>
          {counts && <div style={{ color: C.cream, fontSize: 12, marginTop: 10, fontWeight: 700 }}>{counts.ready} ready · {counts.nochange} already complete · {counts.skip} custom (skipped) · {counts.error} lookup errors</div>}
          {plans && (
            <div style={{ marginTop: 8, maxHeight: 240, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {plans.filter((p) => p.status === "ready" || p.status === "error" || p.status === "skip" || p.tees.some((t) => t.reason)).map((p) => (
                <div key={p.id} style={{ background: C.greenLight, borderRadius: 10, padding: "8px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: statusColor(p.status), fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>{p.status}</span>
                    <span style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                  </div>
                  {p.note && <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{p.note}</div>}
                  {p.tees.map((t, i) => (<div key={i} style={{ color: t.reason ? C.faint : C.sage, fontSize: 11 }}>{t.tee}: {t.reason ? t.reason : `${t.fill} hole${t.fill === 1 ? "" : "s"} to fill`}</div>))}
                </div>
              ))}
            </div>
          )}
          {log.length > 0 && (
            <div style={{ marginTop: 10, background: "#0E2C24", borderRadius: 8, padding: "8px 10px", maxHeight: 140, overflowY: "auto" }}>
              {log.map((l, i) => (<div key={i} style={{ color: C.sage, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{l}</div>))}
            </div>
          )}

          {/* ---------------- EDITOR ---------------- */}
          <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 16, paddingTop: 14 }}>
            <div style={{ color: C.cream, fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>2 · FIX ONE COURSE (re-look-up or type by hand)</div>
            <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
              For custom courses, or a course whose id errored (e.g. a mapping issue). Saving writes <b style={{ color: C.cream }}>only the yardages</b>.
            </div>

            {!rows ? (
              <button style={{ ...btn(true), fontSize: 13, padding: "8px 16px", marginTop: 10 }} onClick={loadRows}>Load courses</button>
            ) : (
              <>
                <select value={selId} onChange={(e) => selectCourse(e.target.value)} style={{ ...inputStyle, marginTop: 10, width: "100%" }}>
                  <option value="">Choose a course…</option>
                  {rows.map((r) => (<option key={r.id} value={r.id}>{courseLabel(r)}</option>))}
                </select>

                {sel && (
                  <div style={{ marginTop: 10 }}>
                    {/* lookup */}
                    <div style={{ background: C.greenLight, borderRadius: 10, padding: 10 }}>
                      <div style={{ color: C.sage, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 }}>Fill from golfcourseapi (optional)</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search e.g. Fiddler's Elbow River" style={{ ...inputStyle, flex: 1 }} onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }} />
                        <button style={{ ...btn(true), fontSize: 12, padding: "6px 12px", opacity: looking ? 0.6 : 1 }} disabled={looking || !q.trim()} onClick={runSearch}>{looking ? "…" : "Search"}</button>
                      </div>
                      {results && results.length > 0 && !apiCourse && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                          {results.map((r) => (
                            <button key={r.id} onClick={() => pickResult(r.id)} style={{ textAlign: "left", background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>
                              <div style={{ color: C.ink, fontWeight: 700, fontSize: 13 }}>{r.name}</div>
                              <div style={{ color: C.faint, fontSize: 11 }}>{r.club}{r.location ? ` · ${r.location}` : ""}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      {apiCourse && (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ color: C.cream, fontSize: 12 }}>Matched: <b>{apiCourse.name}</b> — API tees: {(apiCourse.tees || []).map((t) => t.name).join(", ") || "none"}</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                            <button style={{ ...btn(true), fontSize: 12, padding: "6px 12px" }} onClick={fillAllMatching}>Fill all matching tees</button>
                            <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={() => { setApiCourse(null); setResults(null); }}>Clear match</button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* per-tee inputs */}
                    {(sel.data.tees || []).map((t, ti) => (
                      <div key={ti} style={{ background: C.card, borderRadius: 10, padding: 10, marginTop: 8 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <div style={{ color: C.ink, fontWeight: 800, fontSize: 13 }}>{t.name}</div>
                          {apiCourse && (
                            <select defaultValue={(apiCourse.tees || []).find((x) => norm(x.name) === norm(t.name))?.name || ""} onChange={(e) => fillTeeFrom(ti, e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: "4px 8px" }}>
                              <option value="">map from API tee…</option>
                              {(apiCourse.tees || []).map((x) => (<option key={x.name} value={x.name}>{x.name}</option>))}
                            </select>
                          )}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
                          {Array.from({ length: holesCount }, (_, hi) => (
                            <div key={hi} style={{ width: 42, textAlign: "center" }}>
                              <div style={{ color: C.faint, fontSize: 10 }}>{hi + 1}</div>
                              <input value={(yard[ti] || [])[hi] || ""} onChange={(e) => setCell(ti, hi, e.target.value)} inputMode="numeric" style={{ width: 42, padding: "4px 2px", textAlign: "center", fontSize: 12, border: `1px solid ${C.line}`, borderRadius: 6, color: C.ink, background: "#fff" }} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}

                    <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
                      <button style={{ ...btn(true), fontSize: 13, padding: "8px 16px", opacity: saving ? 0.6 : 1 }} disabled={saving} onClick={saveYardages}>{saving ? "Saving…" : "Save yardages"}</button>
                      {eMsg && <span style={{ color: eMsg.startsWith("Saved") ? "#7BD89B" : C.sage, fontSize: 12 }}>{eMsg}</span>}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
