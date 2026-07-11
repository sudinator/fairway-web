"use client";
import React from "react";
import { C } from "@/lib/golf";
import { BENCH_DIR, BENCH_LABEL, BENCH_DOMAIN, bandFor, goalOptions, type StatKey, type Band } from "@/lib/benchmarks";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const pos = (key: StatKey, v: number) => {
  const [lo, hi] = BENCH_DOMAIN[key];
  return clampPct(((v - lo) / (hi - lo)) * 100);
};
const fmtVal = (key: StatKey, v: number) => (key === "putts" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v) + "%");
const fmtBand = (key: StatKey, b: Band) => (key === "putts" ? `${b.lo}–${b.hi}` : `${Math.round(b.lo)}–${Math.round(b.hi)}%`);

function insight(key: StatKey, value: number, your: Band, goal: Band | null, goalHcp: number | null) {
  const dir = BENCH_DIR[key];
  const beats = dir === 1 ? value > your.hi : value < your.lo;
  const inRange = value >= your.lo && value <= your.hi;
  const where = beats ? "Ahead of the typical range for your handicap"
    : inRange ? "Right in your handicap’s typical range"
    : "A touch outside your handicap’s range";
  if (goal == null || goalHcp == null) return where + ".";
  const needToward = dir === 1 ? goal.avg > value : goal.avg < value;
  const tail = needToward
    ? ` — a ${goalHcp === 0 ? "scratch" : goalHcp + " hcp"} averages about ${fmtVal(key, goal.avg)}.`
    : ` — already around ${goalHcp === 0 ? "scratch" : goalHcp + "-hcp"} level here.`;
  return where + tail;
}

// One band track on a LIGHT panel: solid "your range" fill or a dashed "goal range"
// outline, with a haloed gold marker for the player's value. Label is dark-on-light.
function Track({ keyName, value, band, accent, labelPre, labelVal }: {
  keyName: StatKey; value: number; band: Band; accent: boolean; labelPre: string; labelVal: string;
}) {
  const left = pos(keyName, band.lo), right = pos(keyName, band.hi);
  const lo = Math.min(left, right), w = Math.abs(right - left);
  const me = pos(keyName, value);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ position: "relative", height: 15, borderRadius: 8, background: "#EAE3CF" }}>
        <div style={{
          position: "absolute", top: 0, height: 15, left: `${lo}%`, width: `${w}%`, borderRadius: 8,
          background: accent ? "#8FBBA3" : "rgba(22,80,61,0.16)",
          border: accent ? "none" : "1.5px dashed #2F7A57",
        }} />
        <div style={{ position: "absolute", top: -4, left: `${me}%`, width: 2.5, height: 23, background: accent ? C.gold : "#A98F3C", transform: "translateX(-1px)", borderRadius: 2 }} />
        {accent && <div style={{ position: "absolute", top: -7, left: `${me}%`, width: 12, height: 12, borderRadius: "50%", background: C.gold, border: "2px solid #fff", transform: "translateX(-5px)", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }} />}
      </div>
      <div style={{ color: "#6c6754", fontSize: 10.5, marginTop: 3, fontWeight: 600 }}>{labelPre}<b style={{ color: C.ink }}>{labelVal}</b></div>
    </div>
  );
}

// ---- Shot-category synthesis ---------------------------------------------
// Ranks off-tee / approach / short game / putting against the player's own
// handicap-peer band, and — when an aspire goal is set — toward that goal.
// Reuses the exact same bands + direction as CompareCard so the two never
// disagree. The band-relative score puts every stat on one 0–100 scale where
// 50 = the peer average for your handicap.
const SYN_GOOD = "#8FE0B0", SYN_OK = "#F0C97B", SYN_WEAK = "#FB7185";
function catScore(key: StatKey, value: number, band: Band) {
  const half = (band.hi - band.lo) / 2 || 1;
  const rel = BENCH_DIR[key] * (value - band.avg) / half;
  return clampPct(50 + rel * 50);
}
function catVerdict(score: number): [string, string] {
  return score >= 66 ? ["Strength", SYN_GOOD] : score <= 40 ? ["Focus here", SYN_WEAK] : ["On par", SYN_OK];
}
const synFmt = (key: StatKey, v: number) => (key === "putts" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v) + "%");
const synGoalLabel = (g: number) => (g === 0 ? "scratch" : `${g} hcp`);

export function ShotSynthesis({ fir, gir, puttsPerRound, scramble, index, goalHcp, setGoalHcp, detailRounds }: {
  fir: { hit: number; total: number };
  gir: { hit: number; total: number };
  puttsPerRound: number | null;
  scramble: { hit: number; total: number };
  index: number | null;
  goalHcp: number | null;
  setGoalHcp: (h: number | null) => void;
  detailRounds: number;
}) {
  if (index == null) return null;
  const goals = goalOptions(index);
  const you = bandFor(index);
  const goalBands = goalHcp != null ? bandFor(goalHcp) : null;

  // category -> stat, with a data + sample guard (scrambling needs more rounds to settle).
  const defs: { key: StatKey; cat: string; value: number | null; min: number }[] = [
    { key: "fir", cat: "Off the tee", value: fir.total ? (100 * fir.hit) / fir.total : null, min: 5 },
    { key: "gir", cat: "Approach", value: gir.total ? (100 * gir.hit) / gir.total : null, min: 5 },
    { key: "scramble", cat: "Short game", value: scramble.total ? (100 * scramble.hit) / scramble.total : null, min: 15 },
    { key: "putts", cat: "Putting", value: puttsPerRound, min: 5 },
  ];
  const rows = defs
    .filter((d) => d.value != null && detailRounds >= d.min)
    .map((d) => {
      const band = you[d.key], half = (band.hi - band.lo) / 2 || 1;
      const value = d.value as number;
      const gap = goalBands ? BENCH_DIR[d.key] * (goalBands[d.key].avg - value) / half : 0;
      return { key: d.key, cat: d.cat, value, score: catScore(d.key, value, band), gap };
    });
  if (rows.length === 0) return null;

  const opps = rows.filter((r) => r.gap > 0.02).sort((a, b) => b.gap - a.gap);
  const top = opps[0] ?? [...rows].sort((a, b) => a.score - b.score)[0];

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12, border: "1px solid #245A47" }}>
      <div style={{ color: C.gold, fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>WHERE YOU’RE GAINING &amp; LOSING SHOTS</div>

      {goals.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 11, flexWrap: "wrap" }}>
          <span style={{ color: C.sage, fontSize: 11.5 }}>Aspire to:</span>
          {goals.map((g) => {
            const on = g === goalHcp;
            return (
              <button key={g} onClick={() => setGoalHcp(g)} style={{
                border: `1px solid ${on ? C.gold : "#2c5142"}`, background: on ? C.gold : "#173a2c",
                color: on ? "#2a2410" : C.cream, borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}>{synGoalLabel(g)}</button>
            );
          })}
        </div>
      )}

      <div style={{ color: C.cream, fontSize: 12.5, lineHeight: 1.5, marginTop: 11 }}>
        {goalBands && top.gap > 0.02
          ? <>Biggest opportunity: <b style={{ color: "#F4E4B0" }}>{top.cat.toLowerCase()}</b> — your {BENCH_LABEL[top.key].toLowerCase()} ({synFmt(top.key, top.value)}) is furthest from {synGoalLabel(goalHcp as number)} level (~{synFmt(top.key, goalBands[top.key].avg)}).</>
          : <>Your <b style={{ color: "#F4E4B0" }}>{top.cat.toLowerCase()}</b> has the most room vs your handicap’s peers right now.</>}
      </div>

      <div style={{ marginTop: 4 }}>
        {rows.map((r) => {
          const [vlabel, vcol] = catVerdict(r.score);
          const goalTxt = goalBands
            ? (r.gap > 0.02 ? `you ${synFmt(r.key, r.value)} → ${synGoalLabel(goalHcp as number)} avg ${synFmt(r.key, goalBands[r.key].avg)}` : `you ${synFmt(r.key, r.value)} · already ${synGoalLabel(goalHcp as number)}-level`)
            : `you ${synFmt(r.key, r.value)} · peer avg ${synFmt(r.key, you[r.key].avg)}`;
          return (
            <div key={r.key} style={{ marginTop: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 600 }}>{r.cat}</span>
                <span style={{ color: vcol, fontSize: 10.5, fontWeight: 700 }}>{vlabel}</span>
              </div>
              <div style={{ position: "relative", height: 9, background: C.green, borderRadius: 5 }}>
                <div style={{ position: "absolute", left: 0, top: 0, height: 9, width: `${r.score.toFixed(0)}%`, background: vcol, borderRadius: 5 }} />
                <div style={{ position: "absolute", top: -2, left: "50%", width: 2, height: 13, background: "#fff", opacity: 0.75 }} />
              </div>
              <div style={{ color: C.sage, fontSize: 10.5, marginTop: 4 }}>{goalTxt}</div>
            </div>
          );
        })}
      </div>

      <div style={{ color: C.sage, fontSize: 10.5, lineHeight: 1.45, marginTop: 12, opacity: 0.9 }}>
        Bars show you vs the typical range for your {Math.round(index)} index (white tick = peer average). Proxies from public amateur data (Arccos · Shot Scope · Break X) — approximate; scrambling needs ~15+ tracked rounds to read reliably.
      </div>
    </div>
  );
}

export function CompareCard({ fir, gir, puttsPerRound, scramble, index, goalHcp }: {
  fir: { hit: number; total: number };
  gir: { hit: number; total: number };
  puttsPerRound: number | null;
  scramble: { hit: number; total: number };
  index: number | null;
  goalHcp: number | null;
}) {
  if (index == null) return null;
  const vals: { key: StatKey; value: number }[] = [];
  if (fir.total) vals.push({ key: "fir", value: (100 * fir.hit) / fir.total });
  if (gir.total) vals.push({ key: "gir", value: (100 * gir.hit) / gir.total });
  if (scramble.total) vals.push({ key: "scramble", value: (100 * scramble.hit) / scramble.total });
  if (puttsPerRound != null) vals.push({ key: "putts", value: puttsPerRound });
  if (vals.length === 0) return null;

  const yourBands = bandFor(index);
  const goalBands = goalHcp != null ? bandFor(goalHcp) : null;
  const goalLabel = (g: number) => (g === 0 ? "scratch" : `${g} hcp`);

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800 }}>How you compare</div>
        <div style={{ color: C.sage, fontSize: 11.5 }}>you · {index} hcp</div>
      </div>

      {goalHcp != null && (
        <div style={{ color: C.sage, fontSize: 11, marginTop: 9 }}>
          Dashed line = your <b style={{ color: C.cream }}>{goalLabel(goalHcp)}</b> goal, set in “Where you’re gaining &amp; losing shots” above.
        </div>
      )}

      <div>
        {vals.map(({ key, value }) => (
          <div key={key} style={{ background: C.card, borderRadius: 12, padding: "11px 12px 12px", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ color: C.ink, fontWeight: 800, fontSize: 14 }}>{BENCH_LABEL[key]}</span>
              <span style={{ color: C.green, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 18 }}>
                {fmtVal(key, value)} <span style={{ color: C.faint, fontWeight: 600, fontSize: 11, fontFamily: "-apple-system, sans-serif" }}>you</span>
              </span>
            </div>
            <Track keyName={key} value={value} band={yourBands[key]} accent labelPre={`${Math.round(index)} hcp range `} labelVal={fmtBand(key, yourBands[key])} />
            {goalBands && goalHcp != null && (
              <Track keyName={key} value={value} band={goalBands[key]} accent={false} labelPre={`${goalLabel(goalHcp)} goal `} labelVal={fmtBand(key, goalBands[key])} />
            )}
            <div style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.45, color: "#3f5247", background: "#EDF4EF", borderRadius: 9, padding: "8px 10px" }}>
              {insight(key, value, yourBands[key], goalBands ? goalBands[key] : null, goalHcp)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <span style={{ color: C.cream, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 12, borderRadius: 3, background: "#8FBBA3", display: "inline-block" }} />your range</span>
        <span style={{ color: C.cream, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 12, borderRadius: 3, background: "rgba(22,80,61,0.16)", border: "1.5px dashed #2F7A57", display: "inline-block" }} />goal range</span>
        <span style={{ color: C.cream, fontSize: 11, display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 12, borderRadius: "50%", background: C.gold, display: "inline-block" }} />you</span>
      </div>
      <div style={{ color: C.sage, fontSize: 10.5, marginTop: 9, opacity: 0.9, lineHeight: 1.45 }}>
        Typical ranges from public amateur datasets (Arccos · Shot Scope · Break X). Approximate — they skew to tracked golfers and sources vary.
      </div>
    </div>
  );
}
