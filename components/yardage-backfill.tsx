"use client";

// Admin-only tool: backfill per-tee, per-hole YARDAGES into the saved course
// library (favorite_courses.data.tees[].yardages) from golfcourseapi.
//
// Safety rules (deliberate):
//   - Writes ONLY the yardages array. Par, stroke index, rating, slope, tee
//     names, the `corrected` flag, name/location/vetted — never touched.
//   - Fills only yardages that are currently MISSING; an existing yardage is
//     never overwritten.
//   - Matches a saved tee to the API tee BY NAME. Unmatched tees, tees the API
//     has no yardages for, and hole-count mismatches are reported and skipped,
//     never guessed.
//   - Custom courses (no golfcourseapi id) are skipped — no source to pull from.
//
// It is two-step: Preview (reads everything, writes nothing) -> Apply.

import React, { useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, Eyebrow } from "@/components/ui";
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

export function YardageBackfill() {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [plans, setPlans] = useState<CoursePlan[] | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [applied, setApplied] = useState(false);

  const addLog = (m: string) => setLog((L) => [...L, m]);

  // ---- DRY RUN: build the merge plan, write nothing ----
  async function preview() {
    setRunning(true);
    setApplied(false);
    setPlans(null);
    setLog(["Loading every saved course\u2026"]);
    const { data: rows, error } = await supabase
      .from("favorite_courses")
      .select("id, name, external_id, data")
      .order("name");
    if (error) {
      addLog("Could not load courses: " + error.message);
      setRunning(false);
      return;
    }
    const list = rows || [];
    addLog(`Found ${list.length} courses. Looking up yardages\u2026`);
    const out: CoursePlan[] = [];
    for (const row of list) {
      const data: Course = (row.data || {}) as Course;
      const extId = data.externalId || (row as any).external_id || null;
      const holesCount = (data.holes || []).length;
      if (!extId) {
        out.push({ id: row.id, name: row.name, externalId: null, status: "skip", note: "Custom course (no golfcourseapi id)", tees: [] });
        continue;
      }
      const api = await fetchApiCourse(String(extId));
      await new Promise((r) => setTimeout(r, 200)); // be polite to the API
      if (!api) {
        out.push({ id: row.id, name: row.name, externalId: String(extId), status: "error", note: "golfcourseapi lookup failed", tees: [] });
        continue;
      }
      const apiTees = api.tees || [];
      const teeReports: TeeReport[] = [];
      let anyFill = false;
      const newTees: CourseTee[] = (data.tees || []).map((st) => {
        const at = apiTees.find((t) => norm(t.name) === norm(st.name));
        if (!at) {
          teeReports.push({ tee: st.name, fill: 0, reason: "no matching tee in golfcourseapi" });
          return st;
        }
        const ay = at.yardages || [];
        if (!ay.some((v) => v != null)) {
          teeReports.push({ tee: st.name, fill: 0, reason: "API has no yardages for this tee" });
          return st;
        }
        if (holesCount && ay.length !== holesCount) {
          teeReports.push({ tee: st.name, fill: 0, reason: `hole-count mismatch (api ${ay.length} vs course ${holesCount}) \u2014 skipped` });
          return st;
        }
        const existing = st.yardages || [];
        const n = holesCount || ay.length;
        const merged: (number | null)[] = [];
        let fill = 0;
        for (let i = 0; i < n; i++) {
          const ex = existing[i];
          if (ex != null) merged[i] = ex; // never overwrite an existing yardage
          else if (ay[i] != null) {
            merged[i] = ay[i] as number;
            fill++;
          } else merged[i] = null;
        }
        if (fill > 0) anyFill = true;
        teeReports.push({ tee: st.name, fill });
        return { ...st, yardages: merged };
      });
      if (anyFill) {
        out.push({ id: row.id, name: row.name, externalId: String(extId), status: "ready", tees: teeReports, newData: { ...data, tees: newTees } });
      } else {
        out.push({ id: row.id, name: row.name, externalId: String(extId), status: "nochange", note: "Nothing to fill", tees: teeReports });
      }
    }
    setPlans(out);
    const ready = out.filter((p) => p.status === "ready").length;
    addLog(`Preview complete. ${ready} course(s) ready to update. Nothing has been written.`);
    setRunning(false);
  }

  // ---- COMMIT: write only the merged data for "ready" courses ----
  async function apply() {
    if (!plans) return;
    setRunning(true);
    const ready = plans.filter((p) => p.status === "ready" && p.newData);
    addLog(`Applying yardages to ${ready.length} course(s)\u2026`);
    let ok = 0;
    let failed = 0;
    for (const p of ready) {
      const { error } = await supabase.from("favorite_courses").update({ data: p.newData }).eq("id", p.id);
      if (error) {
        failed++;
        addLog(`\u2717 ${p.name}: ${error.message}`);
      } else {
        ok++;
        addLog(`\u2713 ${p.name}`);
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    addLog(`Done. ${ok} updated${failed ? `, ${failed} failed` : ""}.`);
    setApplied(true);
    setRunning(false);
  }

  const counts = plans
    ? {
        ready: plans.filter((p) => p.status === "ready").length,
        nochange: plans.filter((p) => p.status === "nochange").length,
        skip: plans.filter((p) => p.status === "skip").length,
        error: plans.filter((p) => p.status === "error").length,
      }
    : null;

  const statusColor = (s: CoursePlan["status"]) =>
    s === "ready" ? "#1F8F54" : s === "error" ? C.birdie : C.faint;

  return (
    <div style={{ background: C.greenMid, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginTop: 12, marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Eyebrow>YARDAGE BACKFILL · ADMIN</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Open"}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>
            Pulls per-tee, per-hole yardages from golfcourseapi and fills them into the saved courses.
            It writes <b style={{ color: C.cream }}>only missing yardages</b> and never changes par, stroke index,
            ratings, names, or corrections. Run <b style={{ color: C.cream }}>Preview</b> first.
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button style={{ ...btn(true), fontSize: 13, padding: "8px 16px", opacity: running ? 0.6 : 1 }} disabled={running} onClick={preview}>
              {running && !plans ? "Working\u2026" : "Preview"}
            </button>
            <button
              style={{ ...btn(false), fontSize: 13, padding: "8px 16px", opacity: !counts || counts.ready === 0 || running || applied ? 0.5 : 1 }}
              disabled={!counts || counts.ready === 0 || running || applied}
              onClick={apply}
            >
              {applied ? "Applied \u2713" : `Apply${counts ? ` (${counts.ready})` : ""}`}
            </button>
          </div>

          {counts && (
            <div style={{ color: C.cream, fontSize: 12, marginTop: 12, fontWeight: 700 }}>
              {counts.ready} ready · {counts.nochange} already complete · {counts.skip} custom (skipped) · {counts.error} lookup errors
            </div>
          )}

          {plans && (
            <div style={{ marginTop: 10, maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {plans
                .filter((p) => p.status === "ready" || p.status === "error" || p.tees.some((t) => t.reason))
                .map((p) => (
                  <div key={p.id} style={{ background: C.greenLight, borderRadius: 10, padding: "8px 12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: statusColor(p.status), fontWeight: 800, fontSize: 12, textTransform: "uppercase" }}>{p.status}</span>
                      <span style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>{p.name}</span>
                    </div>
                    {p.note && <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{p.note}</div>}
                    {p.tees.length > 0 && (
                      <div style={{ marginTop: 4 }}>
                        {p.tees.map((t, i) => (
                          <div key={i} style={{ color: t.reason ? C.faint : C.sage, fontSize: 11 }}>
                            {t.tee}: {t.reason ? t.reason : `${t.fill} hole${t.fill === 1 ? "" : "s"} to fill`}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}

          {log.length > 0 && (
            <div style={{ marginTop: 10, background: "#0E2C24", borderRadius: 8, padding: "8px 10px", maxHeight: 160, overflowY: "auto" }}>
              {log.map((l, i) => (
                <div key={i} style={{ color: C.sage, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{l}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
