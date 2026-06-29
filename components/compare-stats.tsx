"use client";
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { BENCH_DIR, BENCH_LABEL, BENCH_DOMAIN, bandFor, goalOptions, type StatKey, type Band } from "@/lib/benchmarks";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const pos = (key: StatKey, v: number) => {
  const [lo, hi] = BENCH_DOMAIN[key];
  return clampPct(((v - lo) / (hi - lo)) * 100);
};
const fmtVal = (key: StatKey, v: number) => (key === "putts" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v) + "%");
const fmtBand = (key: StatKey, b: Band) => (key === "putts" ? `${b.lo}\u2013${b.hi}` : `${Math.round(b.lo)}\u2013${Math.round(b.hi)}%`);

function insight(key: StatKey, value: number, your: Band, goal: Band | null, goalHcp: number | null) {
  const dir = BENCH_DIR[key];
  const beats = dir === 1 ? value > your.hi : value < your.lo;
  const inRange = value >= your.lo && value <= your.hi;
  const where = beats ? "Ahead of the typical range for your handicap"
    : inRange ? "Right in your handicap\u2019s typical range"
    : "A touch outside your handicap\u2019s range";
  if (goal == null || goalHcp == null) return where + ".";
  const needToward = dir === 1 ? goal.avg > value : goal.avg < value;
  const tail = needToward
    ? ` \u2014 a ${goalHcp} hcp averages about ${fmtVal(key, goal.avg)}.`
    : ` \u2014 already around ${goalHcp}-hcp level here.`;
  return where + tail;
}

function Track({ keyName, value, band, accent, dashed, label }: {
  keyName: StatKey; value: number; band: Band; accent: boolean; dashed: boolean; label: string;
}) {
  const left = pos(keyName, band.lo), right = pos(keyName, band.hi);
  const lo = Math.min(left, right), w = Math.abs(right - left);
  const me = pos(keyName, value);
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ position: "relative", height: 13, borderRadius: 7, background: "#F0EBDA" }}>
        <div style={{
          position: "absolute", top: 0, height: 13, left: `${lo}%`, width: `${w}%`, borderRadius: 7,
          background: dashed ? "rgba(30,90,60,0.20)" : "rgba(169,196,181,0.85)",
          border: dashed ? "1px dashed rgba(20,80,61,0.55)" : "none",
        }} />
        <div style={{ position: "absolute", top: -4, left: `${me}%`, width: 2, height: 21, background: accent ? C.gold : "#9a8a55", transform: "translateX(-1px)" }} />
        {accent && <div style={{ position: "absolute", top: -7, left: `${me}%`, width: 11, height: 11, borderRadius: "50%", background: C.gold, border: "2px solid #fff", transform: "translateX(-5.5px)" }} />}
      </div>
      <div style={{ color: C.faint, fontSize: 9.5, marginTop: 2 }}>{label}</div>
    </div>
  );
}

export function CompareCard({ fir, gir, puttsPerRound, index }: {
  fir: { hit: number; total: number };
  gir: { hit: number; total: number };
  puttsPerRound: number | null;
  index: number | null;
}) {
  const goals = index == null ? [] : goalOptions(index);
  const [goalHcp, setGoalHcp] = useState<number | null>(goals.length ? goals[0] : null);

  if (index == null) return null;
  const vals: { key: StatKey; value: number }[] = [];
  if (fir.total) vals.push({ key: "fir", value: (100 * fir.hit) / fir.total });
  if (gir.total) vals.push({ key: "gir", value: (100 * gir.hit) / gir.total });
  if (puttsPerRound != null) vals.push({ key: "putts", value: puttsPerRound });
  if (vals.length === 0) return null;

  const yourBands = bandFor(index);
  const goalBands = goalHcp != null ? bandFor(goalHcp) : null;

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>How you compare</div>
        <div style={{ color: C.sage, fontSize: 11.5 }}>you · {index} hcp</div>
      </div>

      {goals.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
          <span style={{ color: C.sage, fontSize: 11.5 }}>Aspire to:</span>
          {goals.map((g) => {
            const on = g === goalHcp;
            return (
              <button key={g} onClick={() => setGoalHcp(g)} style={{
                border: `1px solid ${on ? C.gold : "#2c5142"}`, background: on ? C.gold : "#173a2c",
                color: on ? "#2a2410" : C.cream, borderRadius: 999, padding: "3px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>{g === 0 ? "scratch" : `${g} hcp`}</button>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        {vals.map(({ key, value }) => (
          <div key={key} style={{ padding: "12px 0 11px", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 13.5 }}>{BENCH_LABEL[key]}</span>
              <span style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 17 }}>
                {fmtVal(key, value)} <span style={{ color: C.sage, fontWeight: 500, fontSize: 11, fontFamily: "inherit" }}>you</span>
              </span>
            </div>
            <Track keyName={key} value={value} band={yourBands[key]} accent dashed={false}
              label={`${Math.round(index)} hcp range ${fmtBand(key, yourBands[key])}`} />
            {goalBands && goalHcp != null && (
              <Track keyName={key} value={value} band={goalBands[key]} accent={false} dashed
                label={`${goalHcp === 0 ? "scratch" : goalHcp + " hcp"} goal ${fmtBand(key, goalBands[key])}`} />
            )}
            <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.45, color: C.sage, background: "#173a2c", borderRadius: 9, padding: "7px 10px" }}>
              {insight(key, value, yourBands[key], goalBands ? goalBands[key] : null, goalHcp)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
        <span style={{ color: C.sage, fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 13, height: 11, borderRadius: 3, background: "rgba(169,196,181,0.85)", display: "inline-block" }} />your range</span>
        <span style={{ color: C.sage, fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 13, height: 11, borderRadius: 3, background: "rgba(30,90,60,0.20)", border: "1px dashed rgba(169,196,181,0.7)", display: "inline-block" }} />goal range</span>
        <span style={{ color: C.sage, fontSize: 10.5, display: "inline-flex", alignItems: "center", gap: 5 }}><span style={{ width: 11, height: 11, borderRadius: "50%", background: C.gold, display: "inline-block" }} />you</span>
      </div>
      <div style={{ color: C.sage, fontSize: 10, marginTop: 8, opacity: 0.8, lineHeight: 1.45 }}>
        Typical ranges from public amateur datasets (Arccos · Shot Scope · Break X). Approximate — they skew to tracked golfers and sources vary.
      </div>
    </div>
  );
}
