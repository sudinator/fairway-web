"use client";
// 212.18 — Your courses (owner, Oct 22): on the Courses tab, a member's record at each course they've played, most
// played first; tap one for "Your record here" — nemesis hole, best hole, and hole by hole their average against par
// beside the CLUB's average (course_field_averages, 0215 — averages only, shown only with enough play).
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { C } from "@/lib/golf";
import type { Round } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { yourCourses, type CourseRecord } from "@/lib/your-courses";

type Field = { enough: boolean; rounds: number; holes: { hole: number; par: number; avg_to_par: number }[] } | null;
const tp = (n: number | null | undefined) => (n == null ? "–" : `${n > 0 ? "+" : ""}${n.toFixed(1)}`);
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function YourCourses({ rounds, groupId, loadField }: { rounds: Round[]; groupId?: string; loadField?: (course: string) => Promise<Field> }) {
  const list = useMemo(() => yourCourses(rounds), [rounds]);
  // the club's averages (0215) — injected in tests, else from the database for the active club
  const load = useCallback(async (course: string): Promise<Field> => {
    if (loadField) return loadField(course);
    if (!groupId) return null;
    const { createClient } = await import("@/lib/supabase");
    const { data, error } = await createClient().rpc("course_field_averages", { p_group: groupId, p_course: course });
    return error ? null : (data as Field);
  }, [groupId, loadField]);
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  return (
    <div data-your-courses style={{ marginBottom: 18 }}>
      <Eyebrow>YOUR COURSES</Eyebrow>
      {list.map((c) => (
        <div key={c.key} data-your-course={c.course} style={{ background: C.greenLight, borderRadius: 12, marginTop: 8, overflow: "hidden" }}>
          <div onClick={() => setOpen(open === c.key ? null : c.key)} style={{ padding: "13px 16px", cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 15, flex: 1, minWidth: 0 }}>{c.course}</span>
              <span style={{ color: C.gold, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>{open === c.key ? "Close" : "Your record ›"}</span>
            </div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>
              {c.rounds} round{c.rounds === 1 ? "" : "s"}{c.bestGross != null ? ` · best ${c.bestGross}` : ""}{c.avgGross != null ? ` · avg ${c.avgGross.toFixed(1)}` : ""} · last {fmtDay(c.lastPlayed)}
            </div>
          </div>
          {open === c.key ? <CourseDetail c={c} loadField={load} /> : null}
        </div>
      ))}
    </div>
  );
}

export function CourseDetail({ c, loadField, initialField = null }: { c: CourseRecord; loadField: (course: string) => Promise<Field>; initialField?: Field }) {
  const [field, setField] = useState<Field>(initialField);
  useEffect(() => { let live = true; loadField(c.course).then((f) => { if (live) setField(f); }).catch(() => {}); return () => { live = false; }; }, [c.course, loadField]);
  const clubAt = (hole: number) => (field?.enough ? field.holes.find((h) => h.hole === hole)?.avg_to_par ?? null : null);
  return (
    <div data-course-detail style={{ padding: "16px", paddingTop: 0 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {c.nemesis ? <Tile label="NEMESIS HOLE" hole={c.nemesis.hole} par={c.nemesis.par} v={c.nemesis.avgToPar} tone={C.overRedDark} /> : null}
        {c.best ? <Tile label="BEST HOLE" hole={c.best.hole} par={c.best.par} v={c.best.avgToPar} tone="#5BD08A" /> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "40px 36px 1fr 1fr", gap: 6, color: C.sage, fontSize: 11, fontWeight: 700, marginTop: 12 }}>
        <span>Hole</span><span>Par</span><span style={{ textAlign: "right" }}>You</span><span style={{ textAlign: "right" }}>Club</span>
      </div>
      {c.holes.map((h) => {
        const club = clubAt(h.hole);
        return (
          <div key={h.hole} style={{ display: "grid", gridTemplateColumns: "40px 36px 1fr 1fr", gap: 6, fontSize: 13, marginTop: 4, alignItems: "baseline" }}>
            <span style={{ color: C.cream, fontWeight: 800 }}>{h.hole}</span>
            <span style={{ color: C.sage }}>{h.par}</span>
            {/* 212.18: where you're half a shot or more worse (red) or better (green) than the club there */}
            <span data-vs-club={club == null ? undefined : h.avgToPar - club >= 0.5 ? "worse" : h.avgToPar - club <= -0.5 ? "better" : "even"}
              style={{ textAlign: "right", fontWeight: 700, color: club == null ? C.cream : h.avgToPar - club >= 0.5 ? C.overRedDark : h.avgToPar - club <= -0.5 ? "#5BD08A" : C.cream }}>{tp(h.avgToPar)}</span>
            <span style={{ textAlign: "right", color: C.sage }}>{tp(club)}</span>
          </div>
        );
      })}
      <div style={{ color: C.sage, fontSize: 11.5, marginTop: 10, lineHeight: 1.45 }}>
        Average against par on each hole{field?.enough ? " · red: half a shot or more worse than the club there, green: better" : ""}{field && !field.enough ? " · the club's averages appear once 3 or more members have played it 5 or more times" : field?.enough ? ` · club: ${field.rounds} rounds by your club's members, last two years` : ""}.
      </div>
    </div>
  );
}

function Tile({ label, hole, par, v, tone }: { label: string; hole: number; par: number; v: number; tone: string }) {
  return (
    <div style={{ flex: 1, background: C.green, borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{label}</div>
      <div style={{ color: C.cream, fontSize: 17, fontWeight: 800, marginTop: 2 }}>Hole {hole} <span style={{ color: C.sage, fontSize: 12, fontWeight: 500 }}>par {par}</span></div>
      <div style={{ color: tone, fontSize: 14, fontWeight: 800 }}>averages {tp(v)}</div>
    </div>
  );
}
