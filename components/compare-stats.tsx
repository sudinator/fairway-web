"use client";
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { BENCH_DIR, BENCH_LABEL, bandFor, goalOptions, type StatKey, type Band } from "@/lib/benchmarks";
import { Eyebrow } from "@/components/ui";

const clampPct = (v: number) => Math.max(0, Math.min(100, v));
const fmtVal = (key: StatKey, v: number) => (key === "putts" ? (Math.round(v * 10) / 10).toFixed(1) : Math.round(v) + "%");

// Plain-English explainer shown when a category row is tapped: how the number is
// computed, and what it points you toward practising.
const CAT_DESC: Record<StatKey, { measured: string; work: string }> = {
  fir: {
    measured: "The share of your par-4 and par-5 tee shots that find the fairway. Par-3s don't count, and both left and right misses count as a miss.",
    work: "If this is low, the tee shot is costing you position. Favour a club you can keep in play over maximum distance, pick a specific aim point, and focus on shrinking the big miss rather than hitting it dead straight.",
  },
  gir: {
    measured: "How often you reach the green with two strokes to spare versus par — e.g. on the green in two on a par 4. It's mostly a read on your approach shot.",
    work: "If this is low, look at approach distance control — are you consistently short or long? It's also often a knock-on from missing fairways, so check Off the tee first: recovering from the rough drags this down.",
  },
  scramble: {
    measured: "On the holes where you missed the green, how often you still made par or better — 'getting up and down.' It combines the greenside shot (chip, pitch, or bunker) with the putt to save par.",
    work: "Compare it with Putting. If your putting is fine but this is low, the greenside shots are the issue — work on distance control on chips and pitches, plus bunker technique. If both are low, fix putting first and this rises with it. Sand saves (under More) isolates bunkers specifically.",
  },
  putts: {
    measured: "Your average number of putts per round.",
    work: "Two levers move this: lag putting (distance control on long putts so you avoid three-putts) and converting the short ones. Check 3-putts per round (under More) — if that's high, the leak is distance control on the first putt, not the short ones.",
  },
};

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
// white tick = peer average at 50), and a sub-line. Tapping the row expands a
// plain-English "how it's measured / what to work on" panel.
function CatBar({ name, score, sub, statKey, open, onToggle }: {
  name: string; score: number; sub: React.ReactNode;
  statKey?: StatKey; open?: boolean; onToggle?: () => void;
}) {
  const [vlabel, vcol] = catVerdict(score);
  const desc = statKey ? CAT_DESC[statKey] : undefined;
  const clickable = !!desc && !!onToggle;
  return (
    <div style={{ marginTop: 12 }}>
      <div onClick={clickable ? onToggle : undefined} style={{ cursor: clickable ? "pointer" : "default" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
          <span style={{ color: C.cream, fontSize: 12.5, fontWeight: 600 }}>
            {name}
            {clickable && <span style={{ color: C.gold, fontSize: 11, marginLeft: 6, fontWeight: 700 }}>{open ? "▲" : "ⓘ"}</span>}
          </span>
          <span style={{ color: vcol, fontSize: 11, fontWeight: 700 }}>{vlabel}</span>
        </div>
        <div style={{ position: "relative", height: 9, background: C.green, borderRadius: 5 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 9, width: `${Math.round(score)}%`, background: vcol, borderRadius: 5 }} />
          <div style={{ position: "absolute", top: -2, left: "50%", width: 2, height: 13, background: "#fff", opacity: 0.75 }} />
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 4, lineHeight: 1.45 }}>{sub}</div>
      </div>
      {open && desc && (
        <div style={{ background: C.green, borderRadius: 10, padding: "11px 13px", marginTop: 8 }}>
          <Eyebrow>HOW IT'S MEASURED</Eyebrow>
          <div style={{ color: C.cream, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{desc.measured}</div>
          <Eyebrow>WHAT TO WORK ON</Eyebrow>
          <div style={{ color: C.cream, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>{desc.work}</div>
        </div>
      )}
    </div>
  );
}

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
  const [openCat, setOpenCat] = useState<StatKey | null>(null);
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
      <Eyebrow>WHERE YOU’RE GAINING &amp; LOSING SHOTS</Eyebrow>

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

      <div style={{ color: C.gold, fontSize: 11, marginTop: 12, opacity: 0.85 }}>Tap a category for how it's measured &amp; what to work on ⓘ</div>
      <div style={{ marginTop: 2 }}>
        {rows.map((r) => {
          const goalTxt = goalBands
            ? (r.gap > 0.02 ? `you ${fmtVal(r.key, r.value)} → ${synGoalLabel(goalHcp as number)} avg ${fmtVal(r.key, goalBands[r.key].avg)}` : `you ${fmtVal(r.key, r.value)} · already ${synGoalLabel(goalHcp as number)}-level`)
            : `you ${fmtVal(r.key, r.value)} · peer avg ${fmtVal(r.key, you[r.key].avg)}`;
          return <CatBar key={r.key} name={r.cat} score={r.score} sub={goalTxt} statKey={r.key} open={openCat === r.key} onToggle={() => setOpenCat((o) => (o === r.key ? null : r.key))} />;
        })}
      </div>

      <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.45, marginTop: 12, opacity: 0.9 }}>
        Bars show you vs the typical range for your {Math.round(index)} index (white tick = peer average). Proxies from public amateur data (Arccos · Shot Scope · Break X) — approximate; scrambling needs ~15+ tracked rounds to read reliably.
      </div>
    </div>
  );
}
