"use client";
// The one shareable season card (205.0): the golfer's name, six headline numbers, favourite course.
// Never money, never rank — lib/season-summary's `share` is built without them.
import React from "react";
import { C } from "@/lib/golf";
import type { SeasonSummary } from "@/lib/season-summary";

export function SeasonShareCard({ summary }: { summary: SeasonSummary }) {
  const s = summary.share;
  const stat = (label: string, value: React.ReactNode) => (
    <div style={{ flex: "1 1 30%", minWidth: 100, background: "rgba(255,255,255,0.06)", borderRadius: 10, padding: "8px 12px" }}>
      <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.2, fontWeight: 800 }}>{label}</div>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800, marginTop: 2 }}>{value}</div>
    </div>
  );
  return (
    <div data-season-share style={{ background: C.green, borderRadius: 14, padding: "16px", color: C.cream }}>
      <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2.4, fontWeight: 800 }}>{summary.year} SEASON</div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800, marginTop: 2 }}>{summary.name}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        {stat("ROUNDS", s.rounds)}
        {stat("COURSES", s.courses)}
        {stat("INDEX", s.indexStart != null && s.indexEnd != null ? `${s.indexStart} → ${s.indexEnd}` : s.indexEnd ?? "—")}
        {stat("BEST DIFF", s.bestDifferential ?? "—")}
        {stat("BIRDIES", s.birdies)}
        {stat("BADGES", s.badges)}
      </div>
      {s.favouriteCourse && <div style={{ color: C.sage, fontSize: 12, marginTop: 12 }}>Home away from home: <b style={{ color: C.cream }}>{s.favouriteCourse}</b></div>}
      <div style={{ color: C.sage, fontSize: 11, marginTop: 12, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.10)", textAlign: "center" }}>Birdie Num Num · {summary.year} Season Wrapped</div>
    </div>
  );
}
