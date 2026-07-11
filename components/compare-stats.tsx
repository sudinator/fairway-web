"use client";
import React from "react";
import { C } from "@/lib/golf";
import { BENCH_DIR, BENCH_LABEL, bandFor, goalOptions, type StatKey, type Band } from "@/lib/benchmarks";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const fmtVal = (key: StatKey, v: number) => (key === "putts" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v) + "%");

// ---- Shared category-bar language (used by BOTH cards) --------------------
// Band-relative 0–100 score: 50 = the peer average for your handicap; +/- moves
// toward the strong/weak edge of your handicap's typical range (putts inverted).
const SYN_GOOD = "#8FE0B0", SYN_OK = "#F0C97B", SYN_WEAK = "#FB7185";
function catScore(key: StatKey, value: number, band: Band) {
  const half = (band.hi - band.lo) / 2 || 1;
  const rel = BENCH_DIR[key] * (value - band.avg) / half;
  return clampPct(50 + rel * 50);
}
function catVerdict(score: number): [string, string] {
  return score >= 66 ? ["Strength", SYN_GOOD] : score <= 40 ? ["Focus here", SYN_WEAK] : ["On par", SYN_OK];
}
const synGoalLabel = (g: number) => (g === 0 ? "scratch" : `${g} hcp`);

// One row: name + verdict chip, a 0–100 bar (fill = score, coloured by verdict,
// white tick = peer average at 50), and a sub-line. Shared so the synthesis and
// How-you-compare are visually identical.
function CatBar({ name, score, sub }: { name: string; score: number; sub: React.ReactNode }) {
  const [vlabel, vcol] = catVerdict(score);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 600 }}>{name}</span>
        <span style={{ color: vcol, fontSize: 10.5, fontWeight: 700 }}>{vlabel}</span>
      </div>
      <div style={{ position: "relative", height: 9, background: C.green, borderRadius: 5 }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: 9, width: `${Math.round(score)}%`, background: vcol, borderRadius: 5 }} />
        <div style={{ position: "absolute", top: -2, left: "50%", width: 2, height: 13, background: "#fff", opacity: 0.75 }} />
      </div>
      <div style={{ color: C.sage, fontSize: 10.5, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );
}

// Detailed sentence for How-you-compare (references your range + the goal level).
// ---- Gaining / losing shots (summary + biggest opportunity) ---------------
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
          ? <>Biggest opportunity: <b style={{ color: "#F4E4B0" }}>{top.cat.toLowerCase()}</b> — your {BENCH_LABEL[top.key].toLowerCase()} ({fmtVal(top.key, top.value)}) is furthest from {synGoalLabel(goalHcp as number)} level (~{fmtVal(top.key, goalBands[top.key].avg)}).</>
          : <>Your <b style={{ color: "#F4E4B0" }}>{top.cat.toLowerCase()}</b> has the most room vs your handicap’s peers right now.</>}
      </div>

      <div style={{ marginTop: 4 }}>
        {rows.map((r) => {
          const goalTxt = goalBands
            ? (r.gap > 0.02 ? `you ${fmtVal(r.key, r.value)} → ${synGoalLabel(goalHcp as number)} avg ${fmtVal(r.key, goalBands[r.key].avg)}` : `you ${fmtVal(r.key, r.value)} · already ${synGoalLabel(goalHcp as number)}-level`)
            : `you ${fmtVal(r.key, r.value)} · peer avg ${fmtVal(r.key, you[r.key].avg)}`;
          return <CatBar key={r.key} name={r.cat} score={r.score} sub={goalTxt} />;
        })}
      </div>

      <div style={{ color: C.sage, fontSize: 10.5, lineHeight: 1.45, marginTop: 12, opacity: 0.9 }}>
        Bars show you vs the typical range for your {Math.round(index)} index (white tick = peer average). Proxies from public amateur data (Arccos · Shot Scope · Break X) — approximate; scrambling needs ~15+ tracked rounds to read reliably.
      </div>
    </div>
  );
}
