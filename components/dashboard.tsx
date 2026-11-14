"use client";

import { PersonalBestsCard } from "@/components/personal-bests-card";
import { InsightsCard } from "@/components/insights";
import React, { useEffect, useState, useMemo } from "react";
import {
  Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart,
} from "recharts";
import { recentForm, trendSummary, type TrendSample } from "@/lib/chart-trend";
import { ChartTip, DismissableChart } from "@/components/charts/chart-tip";
import { ChartAxisTick } from "@/components/charts/axis-tick";
import { chartXAxis } from "@/lib/chart-axis";
import { roundStatCompleteness } from "@/lib/round-stats";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, scrambleStats, sandSaveStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, handicapRounds, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay, stablefordEstimable,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";
import { RoundRow } from "@/components/rounds-list";
import { createClient } from "@/lib/supabase";
import { aiUsesLeft, recordAiUse, AI_DAILY_LIMIT_VALUE } from "@/lib/draft";

const supabase = createClient();

function Clk<T extends string>({ k, d, set, children }: { k: T; d: T | null; set: (v: T | null) => void; children: React.ReactNode }) {
  return (
    <div onClick={() => set(d === k ? null : k)}
      style={{ cursor: "pointer", borderRadius: 12, outline: d === k ? `2px solid ${C.gold}` : "none", flex: "1 1 auto", display: "flex" }}>
      {children}
    </div>
  );
}

import { ShotSynthesis } from "@/components/compare-stats";
import { AchievementsTeaser } from "@/components/achievements";
import { goalOptions } from "@/lib/benchmarks";

// Shared chart tooltip — solid deep-green card, thin gold ring, gold label (course ·
// player/date), cream values. `nameMap` maps each series' dataKey to a display label;
// `fmt` formats each value. Replaces the old white contentStyle tooltip on every chart.
// Dashboard performance trends: each round remains visible; the cream line shows recent form.
function AdaptiveTrend({ data, valueKey, rollKey, avg, lowerBetter, domain, pctStat, nameMap, fmt }: {
  data: any[]; valueKey: string; rollKey: string; avg: number | null; lowerBetter: boolean;
  domain?: any; pctStat?: boolean; nameMap: Record<string, string>; fmt: (v: any) => any;
}) {
  // Self-fit: if no domain is passed, fit the axis to the data range so the chart always uses its
  // vertical space well (pct stats clamped 0–100). Callers can still override with `domain`.
  const fitVals = data.flatMap((d) => [d[valueKey], d[rollKey]]).filter((v: any): v is number => v != null && Number.isFinite(v));
  const autoDomain: [number, number] = fitVals.length
    ? (pctStat
        ? [Math.max(0, Math.floor(Math.min(...fitVals) - 3)), Math.min(100, Math.ceil(Math.max(...fitVals) + 3))]
        : [Math.floor(Math.min(...fitVals) - 1), Math.ceil(Math.max(...fitVals) + 1)])
    : [0, 1];
  return (
    <ResponsiveContainer>
      <ComposedChart data={data} margin={{ top: 6, right: 7, left: 2, bottom: 0 }}>
        <XAxis dataKey="i" tick={<ChartAxisTick />} axisLine={{ stroke: C.greenMid }} tickLine={false} {...chartXAxis(data)} />
        <YAxis domain={domain ?? autoDomain} allowDecimals={!pctStat} tickFormatter={pctStat ? (v: any) => `${Math.round(v)}%` : undefined} tick={{ fill: C.cream, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" tickSize={0} tickMargin={4} />
        <Tooltip wrapperStyle={{ pointerEvents: "auto" }} cursor={{ stroke: "rgba(255,255,255,0.12)" }} content={<PerformanceTip nameMap={nameMap} fmt={fmt} avg={avg} valueKey={valueKey} pctStat={pctStat} />} />
        {avg != null && <ReferenceLine y={Math.round(avg * 10) / 10} stroke={C.gold} strokeDasharray="5 4" />}
        <Line type="monotone" dataKey={valueKey} stroke="transparent" isAnimationActive={false} dot={(p: any) => {
          const v = p.payload[valueKey];
          if (v == null || !Number.isFinite(v)) return <g />;
          const good = avg == null || (lowerBetter ? v <= avg : v >= avg);
          return <circle cx={p.cx} cy={p.cy} r={3.6} fill={good ? "#4ADE80" : "#FB7185"} stroke={C.greenLight} strokeWidth={1.2} data-round-value={v} data-round-better={good} />;
        }} activeDot={{ r: 5, fill: C.gold, stroke: C.cream, strokeWidth: 2 }} />
        <Line type="monotone" dataKey={rollKey} stroke={C.cream} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// Keep the existing tooltip close/remount behavior. Add context without any score mutation.
function PerformanceTip({ avg, valueKey, pctStat, ...props }: any) {
  const point = props.payload?.[0]?.payload;
  const extra: any[] = [];
  if (point && avg != null && Number.isFinite(point[valueKey])) extra.push({ dataKey: "vsAverage", value: point[valueKey] - avg });
  if (point?.total > 0) extra.push({ dataKey: "opportunities", value: `${point.hit}/${point.total}` });
  return <ChartTip {...props} payload={[...(props.payload || []), ...extra]}
    nameMap={{ ...props.nameMap, vsAverage: "vs overall average", opportunities: "Recorded opportunities" }}
    fmt={(v: any, key: string) => key === "opportunities" ? v : key === "vsAverage" ? `${v > 0 ? "+" : ""}${v.toFixed(1)}${pctStat ? " pp" : ""}` : props.fmt(v)} />;
}

function TrendOverview({ samples, lowerBetter, rate = false, unit = "strokes" }: { samples: TrendSample[]; lowerBetter: boolean; rate?: boolean; unit?: string }) {
  const summary = trendSummary(samples, lowerBetter, rate);
  if (summary.latest == null) return null;
  const format = (v: number) => `${v.toFixed(1)}${rate ? "%" : ""}`;
  const change = summary.improvement;
  const improved = change != null && change > 0;
  return <div data-trend-overview style={{ marginTop: 10 }}>
    <div style={{ color: C.sage, fontSize: 11 }}>{summary.count} eligible round{summary.count === 1 ? "" : "s"} in selected period</div>
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
      <span data-trend-latest style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 800, color: C.cream }}>{format(summary.latest)}</span>
      <span style={{ color: C.sage, fontSize: 12 }}>Last {summary.lastCount} tracked round{summary.lastCount === 1 ? "" : "s"}</span>
    </div>
    {rate && <div style={{ color: C.sage, fontSize: 11 }}>{summary.hits}/{summary.opportunities} recorded opportunities</div>}
    {change != null && <div style={{ marginTop: 8, color: Math.abs(change) < 0.05 ? C.sage : improved ? "#9be9c0" : "#f3a3a0", fontSize: 12, fontWeight: 700 }}>
      {Math.abs(change) < 0.05 ? "Unchanged vs previous 5 tracked rounds" : `${(improved === lowerBetter) ? "↓" : "↑"} ${Math.abs(change).toFixed(1)} ${rate ? "percentage points" : unit} ${improved ? "better" : "worse"} than previous 5 tracked rounds`}
      <div style={{ color: C.sage, fontSize: 11, fontWeight: 500, marginTop: 4 }}>Previous 5: {format(summary.prior!)}</div>
    </div>}
    <div style={{ marginTop: 8, color: C.sage, fontSize: 11 }}>{summary.betterCount} of last {summary.lastCount} at or {lowerBetter ? "below" : "above"} overall average ({format(summary.average!)})</div>
  </div>;
}

function TrendKey({ rate, lowerBetter }: { rate: boolean; lowerBetter: boolean }) {
  return <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
    <span style={{ color: "#4ADE80" }}>● At or {lowerBetter ? "below" : "above"} average</span> · <span style={{ color: "#FB7185" }}>● {lowerBetter ? "Above" : "Below"} average</span><br />
    Cream: recent form · Gold dashed: overall average. {lowerBetter ? "Lower" : "Higher"} is better.<br />
    {rate ? "Recent form weights recorded successes and opportunities, with older rounds fading by 20% each round." : "Recent form: 20% latest round + 80% prior trend."} Tap a dot for round details.
  </div>;
}

export function Dashboard({ rounds, name, onOpen, currentIndex, saveIndex, userEmail, userId, savedCoach, onCoachSaved, onViewAchievements }: {
  rounds: Round[]; name: string; onOpen: (r: Round) => void;
  currentIndex: number | null; saveIndex: (i: number | null) => void;
  userEmail?: string | null; userId?: string; savedCoach?: any; onCoachSaved?: () => void;
  onViewAchievements?: () => void;
}) {
  const [win, setWin] = useState<"5" | "20" | "season" | "all">("all");
  const allDone = handicapRounds(rounds);
  const nowYear = new Date().getFullYear();
  const byRecent = [...allDone].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at));
  const done = win === "5" ? byRecent.slice(0, 5)
    : win === "20" ? byRecent.slice(0, 20)
    : win === "season" ? allDone.filter((r) => new Date(r.played_at).getFullYear() === nowYear)
    : allDone;
  const sorted = [...done].sort((a, b) => +new Date(a.played_at) - +new Date(b.played_at));
  const avgDiff = done.length ? done.reduce((s, r) => s + diffOf(r), 0) / done.length : null;
  const best = done.length ? Math.min(...done.map(diffOf)) : null;
  const allHoles = done.flatMap(played);
  // Per-hole putting remains valid on partial tracking because both numerator and denominator are known.
  // Whole-round putting below is intentionally stricter and never infers missing holes.
  const withPutts = allHoles.filter((h) => h.putts != null);
  const avgPuttsPerHole = withPutts.length ? withPutts.reduce((s, h) => s + (h.putts || 0), 0) / withPutts.length : null;
  const completePuttRounds = done.filter((r) => roundStatCompleteness(r.holes).puttsRoundEligible);
  const avgPuttsPerRound = completePuttRounds.length
    ? completePuttRounds.reduce((s, r) => s + puttsOf(r), 0) / completePuttRounds.length
    : null;
  const gir = girStats(done), fir = firStats(done), scramble = scrambleStats(done), sand = sandSaveStats(done);
  const pens = done.reduce((s, r) => s + pensOf(r), 0);
  const fulls = done.filter((r) => played(r).length >= 14 || isGrossOnly(r));
  const estimablePts = fulls.filter(stablefordEstimable);
  const avgPts = estimablePts.length ? estimablePts.reduce((s, r) => s + estimatedStablefordPts(r), 0) / estimablePts.length : null;
  const anyEstimatedPts = estimablePts.some(hasEstimatedStableford);
  const buckets = holeBuckets(done);
  const byPar = avgByPar(done);
  const diffs = done.map(roundDifferential).filter((d): d is number => d != null);
  const avgDifferential = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null;
  const hcp = runningHandicap(allDone);

  // Index trajectory: the running index recomputed after each round (full history, WHS).
  const idxTrail = useMemo(() => {
    const chron = handicapRounds(rounds)
      .sort((a, b) => +new Date(a.played_at) - +new Date(b.played_at));
    const pts: number[] = [];
    for (let i = 0; i < chron.length; i++) {
      const rh = runningHandicap(chron.slice(0, i + 1));
      if (rh.index != null) pts.push(rh.index);
    }
    return pts;
  }, [rounds]);
  const idxDelta = idxTrail.length >= 2
    ? { first: idxTrail[0], cur: idxTrail[idxTrail.length - 1], delta: idxTrail[idxTrail.length - 1] - idxTrail[0] }
    : null;
  const threePutts = threePuttsPerRound(done);
  const puttsPerRound = avgPuttsPerRound == null ? null : Math.round(avgPuttsPerRound * 10) / 10;
  // Shared aspire goal (drives BOTH the synthesis and the "How you compare" card).
  const [goalHcp, setGoalHcp] = useState<number | null>(null);
  const idxForGoal = hcp.index ?? currentIndex;
  const effGoal = goalHcp ?? (idxForGoal != null ? (goalOptions(idxForGoal)[0] ?? null) : null);
  // Does the player track hole-by-hole detail at all? Gate the stats-only surfaces if not.
  const anyHoleDetail = allDone.some(hasHoleDetail);
  const detailRounds = done.filter(hasHoleDetail).length;

  // Compact, numbers-only career summary for the AI coach.
  const coachAggregate = {
    handicapIndex: hcp.index ?? currentIndex ?? null,
    roundsLogged: done.length,
    avgScoreVsPar: avgDiff == null ? null : Math.round(avgDiff * 10) / 10,
    bestVsPar: best,
    avgDifferential: avgDifferential == null ? null : Math.round(avgDifferential * 10) / 10,
    avgPuttsPerHole: avgPuttsPerHole == null ? null : Math.round(avgPuttsPerHole * 100) / 100,
    threePuttsPerRound: threePutts == null ? null : Math.round(threePutts * 10) / 10,
    girPct: gir.total ? Math.round((100 * gir.hit) / gir.total) : null,
    fairwayPct: fir.total ? Math.round((100 * fir.hit) / fir.total) : null,
    scramblingPct: scramble.total ? Math.round((100 * scramble.hit) / scramble.total) : null,
    sandSavePct: sand.total ? Math.round((100 * sand.hit) / sand.total) : null,
    avgByPar: byPar,
    scoringMix: buckets, // eagles/birdies/pars/bogeys/doubles totals
    penaltiesTotal: pens,
  };

  // Dynamic axis domains: fit the data range with a little padding, instead of anchoring at 0.
  const niceDomain = (vals: number[], pad: number): [number, number] => {
    if (vals.length === 0) return [0, 1];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= pad; hi += pad; }       // flat series → give it some room
    else { const p = Math.max(pad, Math.round((hi - lo) * 0.15)); lo -= p; hi += p; }
    return [Math.floor(lo), Math.ceil(hi)];
  };
  // ---- Scoring form on differentials (course-adjusted) ----
  // Only rounds with a valid 18-hole differential (need rating + slope) can be
  // charted. Bars are coloured vs the player's own average differential; a cream
  // line shows the trailing 5-round rolling average (≈ handicap direction).
  const diffSeries = sorted
    .map((r) => ({ r, d: roundDifferential(r) }))
    .filter((x): x is { r: Round; d: number } => x.d != null);
  const diffSamples = diffSeries.map(x => ({ value: x.d }));
  const diffRecent = recentForm(diffSamples);
  const diffTrend = diffSeries.map((x, i) => ({ i: i + 1, playedAt: x.r.played_at, name: fmtDate(x.r.played_at), course: x.r.course, diff: x.d, roll: diffRecent[i] }));
  const diffFormAvg = trendSummary(diffSamples, true).average;
  const diffFormDomain = niceDomain(diffTrend.map(t => t.diff), 2);
  const unratedTrend = sorted.length - diffTrend.length;
  const distTotal = buckets.eagle + buckets.birdie + buckets.par + buckets.bogey + buckets.double;
  const distData = [
    { name: "Eagle+", v: buckets.eagle, c: "#C77DFF" },
    { name: "Birdie", v: buckets.birdie, c: "#4ADE80" },
    { name: "Par", v: buckets.par, c: "#38BDF8" },
    { name: "Bogey", v: buckets.bogey, c: "#FBBF24" },
    { name: "Dbl+", v: buckets.double, c: "#FB7185" },
  ].map((d) => ({ ...d, label: `${d.name}: ${d.v} (${distTotal ? Math.round((100 * d.v) / distTotal) : 0}%)` }));

  // Per-round value for each stat, for the click-to-expand drill-down.
  type StatKey = "rounds" | "avgpar" | "best" | "diff" | "par3" | "par4" | "par5" | "pts" | "gir" | "fir" | "scramble" | "sandsave" | "putts" | "threeputt" | "pen";
  const [detail, setDetail] = useState<StatKey | null>(null);
  const [moreScoring, setMoreScoring] = useState(false);
  const [moreShort, setMoreShort] = useState(false);
  const [showDiffs, setShowDiffs] = useState(false);
  const sectionHead = (label: string, right?: React.ReactNode) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "18px 2px 8px" }}>
      <span style={{ color: C.sage, fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>{label}</span>
      <span style={{ flex: 1, height: 1, background: C.line }} />
      {right}
    </div>
  );
  const expandBtn = (open: boolean, onClick: () => void) => (
    <button onClick={onClick} style={{ background: open ? "transparent" : "rgba(201,162,39,0.12)", border: `1px solid ${C.gold}`, color: C.gold, fontSize: 11, fontWeight: 700, cursor: "pointer", padding: "9px 10px", borderRadius: 999, whiteSpace: "nowrap", letterSpacing: 0.3 }}>{open ? "− Less" : "＋ More"}</button>
  );
  const dirLower = new Set<StatKey>(["rounds", "avgpar", "best", "diff", "par3", "par4", "par5", "putts", "threeputt", "pen"]);
  const perRoundNum = (key: StatKey, r: Round): number | null => {
    const hs = played(r);
    switch (key) {
      case "rounds": case "avgpar": case "best": return diffOf(r);
      case "diff": return roundDifferential(r);
      case "par3": { const a = hs.filter((h) => h.par === 3); return a.length ? a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length : null; }
      case "par4": { const a = hs.filter((h) => h.par === 4); return a.length ? a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length : null; }
      case "par5": { const a = hs.filter((h) => h.par === 5); return a.length ? a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length : null; }
      case "pts": return stablefordEstimable(r) ? estimatedStablefordPts(r) : null;
      case "gir": { const g = girStats([r]); return g.total ? 100 * g.hit / g.total : null; }
      case "scramble": { const sc = scrambleStats([r]); return sc.total ? 100 * sc.hit / sc.total : null; }
      case "sandsave": { const ss = sandSaveStats([r]); return ss.total ? 100 * ss.hit / ss.total : null; }
      case "fir": { const f = firStats([r]); return f.total ? 100 * f.hit / f.total : null; }
      case "putts": return roundStatCompleteness(r.holes).puttsRoundEligible ? puttsOf(r) : null;
      case "threeputt": { const pp = hs.filter((h) => h.putts != null); return pp.length ? hs.filter((h) => (h.putts || 0) >= 3).length : null; }
      case "pen": return pensOf(r);
    }
    return null;
  };
  const detailLabels: Record<StatKey, string> = {
    rounds: "Score", avgpar: "vs par", best: "vs par", diff: "Differential",
    par3: "Avg par 3", par4: "Avg par 4", par5: "Avg par 5", pts: "Stableford",
    gir: "GIR", fir: "Fairways", scramble: "Scrambling", sandsave: "Sand saves", putts: "Putts / round", threeputt: "3+ putts", pen: "Penalties",
  };

  return (
    <div>
      {allDone.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 20, marginBottom: 12 }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20 }}>Welcome to Birdie Num Num</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>
            Log a round to start tracking your handicap, scoring trends, and stats. Tap <b style={{ color: C.cream }}>＋ New round</b> up top — full hole-by-hole for stats like GIR and putts, or a quick total for a past round. Your numbers below fill in as you play.
          </div>
        </div>
      )}
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginBottom: 12 }}>
        <div style={{ float: "right", textAlign: "right", marginLeft: 16, marginBottom: 6 }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 44, fontWeight: 800, lineHeight: 1 }}>
            {hcp.index == null ? "—" : hcp.index.toFixed(1)}
          </div>
          {hcp.index != null && (
            currentIndex === hcp.index ? (
              <div style={{ display: "inline-block", marginTop: 6, border: `1px solid ${C.gold}`, color: C.gold, fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "5px 10px" }}>✓ In use</div>
            ) : (
              <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12, marginTop: 6 }}
                onClick={() => saveIndex(hcp.index)}>
                Use as my handicap
              </button>
            )
          )}
        </div>
        <Eyebrow>RUNNING HANDICAP INDEX</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
          {hcp.index == null
            ? `Need at least 3 full 18-hole rounds (with rating & slope). You have ${hcp.total}.`
            : <>Best {hcp.used} of your last {Math.min(hcp.total, 20)} differentials · WHS{hcp.usedDiffs.length > 0 && (
                <span onClick={() => setShowDiffs((v) => !v)} style={{ color: C.gold, cursor: "pointer", marginLeft: 6, fontWeight: 700 }}>{showDiffs ? "hide" : "how?"}</span>
              )}</>}
        </div>
        {idxDelta && Math.abs(idxDelta.delta) >= 0.1 && (
          <div style={{ color: idxDelta.delta < 0 ? "#8FE0B0" : "#FB7185", fontSize: 12, fontWeight: 700, marginTop: 6 }}>
            {idxDelta.delta < 0 ? "▼" : "▲"} {Math.abs(idxDelta.delta).toFixed(1)} since your first index ({idxDelta.first.toFixed(1)})
          </div>
        )}
        {hcp.index != null && hcp.recentDetail.length > 0 && showDiffs && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: C.sage, fontSize: 11, marginBottom: 4 }}>Newest round first.</div>
            <div style={{ color: C.cream, fontSize: 12, lineHeight: 1.9 }}>
              {hcp.recentDetail.map((x, i) => (
                <span key={i}>
                  {i > 0 ? <span style={{ color: C.sage }}>, </span> : null}
                  <span style={{ color: x.used ? C.gold : C.sage, fontWeight: x.used ? 800 : 400 }}>{x.d.toFixed(1)}</span>
                </span>
              ))}
            </div>
            {(() => {
              const u = hcp.usedDiffs;
              if (!u.length) return null;
              const usedAvg = u.reduce((s, d) => s + d, 0) / u.length;
              return (
                <div style={{ color: C.sage, fontSize: 12, marginTop: 7 }}>
                  {hcp.adj === 0
                    ? <>The {hcp.used} in gold average <b style={{ color: C.gold }}>{usedAvg.toFixed(1)}</b> — that’s your index.</>
                    : <>The {hcp.used} in gold average {usedAvg.toFixed(1)} · {hcp.adj > 0 ? "+" : ""}{hcp.adj.toFixed(1)} adjustment → <b style={{ color: C.gold }}>{hcp.index.toFixed(1)}</b>.</>}
                </div>
              );
            })()}
          </div>
        )}
        <div style={{ clear: "both" }} />
      </div>
      {allDone.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 5 }}>
            {(([["5", "Last 5"], ["20", "Last 20"], ["season", "Season"], ["all", "All"]] as [typeof win, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setWin(k)} style={{
                flex: 1, textAlign: "center", fontSize: 11, borderRadius: 6, padding: "7px 0", border: "none", cursor: "pointer",
                background: win === k ? C.gold : C.greenLight, color: win === k ? C.green : C.sage, fontWeight: win === k ? 700 : 400,
              }}>{label}</button>
            )))}
          </div>
          <div data-dashboard-range-caption style={{ color: C.sage, fontSize: 11, marginTop: 5, textAlign: "center", whiteSpace: "nowrap" }}>
            Stats: {done.length} round{done.length === 1 ? "" : "s"} · WHS index: best 8 of 20
          </div>
        </div>
      )}

      {/* 212.18: the two strongest findings, right after the handicap — the full screen one tap away */}
      <InsightsCard rounds={rounds} />

      {diffTrend.length >= 2 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <Eyebrow>SCORING FORM · DIFFERENTIAL</Eyebrow>
          <TrendOverview samples={diffSamples} lowerBetter />
          <DismissableChart height={240} marginTop={12}>
            <AdaptiveTrend data={diffTrend} valueKey="diff" rollKey="roll" avg={diffFormAvg} lowerBetter domain={diffFormDomain}
              nameMap={{ diff: "Differential", roll: "Recent form" }} fmt={(v: any) => typeof v === "number" ? v.toFixed(1) : v} />
          </DismissableChart>
          <TrendKey rate={false} lowerBetter />
          {unratedTrend > 0 && <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{unratedTrend} round{unratedTrend === 1 ? "" : "s"} not shown (need 18 holes + rating/slope).</div>}

        </div>
      )}

      <DashboardCoach
        aggregate={coachAggregate}
        roundsUsed={done.length}
        userEmail={userEmail}
        userId={userId}
        saved={savedCoach}
        onSaved={onCoachSaved}
      />

      {userId && onViewAchievements && <AchievementsTeaser userId={userId} onViewAll={onViewAchievements} />}

      {sectionHead("SCORING", anyHoleDetail ? expandBtn(moreScoring, () => setMoreScoring((v) => !v)) : undefined)}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Clk k="rounds" d={detail} set={setDetail}><StatCard label="Rounds" value={done.length} /></Clk>
        <Clk k="avgpar" d={detail} set={setDetail}><StatCard label="Avg vs par" value={avgDiff == null ? "—" : (avgDiff >= 0 ? "+" : "") + avgDiff.toFixed(1)} /></Clk>
        <Clk k="best" d={detail} set={setDetail}><StatCard label="Best round" value={best == null ? "—" : toParStr(best)} /></Clk>
        <Clk k="diff" d={detail} set={setDetail}><StatCard label="Avg differential" value={avgDifferential == null ? "—" : avgDifferential.toFixed(1)}
          sub={diffs.length ? `${diffs.length} full round${diffs.length === 1 ? "" : "s"} w/ rating·slope` : "needs 18 holes + rating/slope"} /></Clk>
        <Clk k="pts" d={detail} set={setDetail}><StatCard label="Stableford avg" value={avgPts == null ? "—" : avgPts.toFixed(1)} sub={anyEstimatedPts ? "includes estimates" : "full rounds"} /></Clk>
      </div>
      {anyHoleDetail && moreScoring && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <Clk k="par3" d={detail} set={setDetail}><StatCard label="Avg on par 3s" value={byPar.par3 == null ? "—" : byPar.par3.toFixed(2)} sub={byPar.par3 == null ? "" : (byPar.par3 - 3 >= 0 ? "+" : "") + (byPar.par3 - 3).toFixed(2) + " vs par"} /></Clk>
          <Clk k="par4" d={detail} set={setDetail}><StatCard label="Avg on par 4s" value={byPar.par4 == null ? "—" : byPar.par4.toFixed(2)} sub={byPar.par4 == null ? "" : (byPar.par4 - 4 >= 0 ? "+" : "") + (byPar.par4 - 4).toFixed(2) + " vs par"} /></Clk>
          <Clk k="par5" d={detail} set={setDetail}><StatCard label="Avg on par 5s" value={byPar.par5 == null ? "—" : byPar.par5.toFixed(2)} sub={byPar.par5 == null ? "" : (byPar.par5 - 5 >= 0 ? "+" : "") + (byPar.par5 - 5).toFixed(2) + " vs par"} /></Clk>
        </div>
      )}

      {anyHoleDetail ? (
        <>
          {sectionHead("BALL-STRIKING")}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Clk k="fir" d={detail} set={setDetail}><StatCard label="Fairways hit" value={fracPct(fir)} sub={fir.total ? "excludes par 3s" : "tap FW"} /></Clk>
            <Clk k="gir" d={detail} set={setDetail}><StatCard label="GIR" value={fracPct(gir)} sub={gir.total ? "greens in regulation" : "needs putts"} /></Clk>
          </div>
          {sectionHead("SHORT GAME & PUTTING", expandBtn(moreShort, () => setMoreShort((v) => !v)))}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Clk k="scramble" d={detail} set={setDetail}><StatCard label="Scrambling" value={fracPct(scramble)} sub={scramble.total ? "par+ after missing green" : "needs putts"} /></Clk>
            <Clk k="putts" d={detail} set={setDetail}><StatCard label="Putts / round" value={avgPuttsPerRound == null ? "—" : avgPuttsPerRound.toFixed(1)} sub={completePuttRounds.length ? `${completePuttRounds.length} complete 18-hole round${completePuttRounds.length === 1 ? "" : "s"}` : "needs putts on all 18 holes"} /></Clk>
          </div>
          {moreShort && (
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <Clk k="sandsave" d={detail} set={setDetail}><StatCard label="Sand saves" value={fracPct(sand)} sub={sand.total ? "par+ from greenside bunker" : "tap S in Sand/Pen"} /></Clk>
              <Clk k="threeputt" d={detail} set={setDetail}><StatCard label="3+ putts / round" value={threePutts == null ? "—" : threePutts.toFixed(1)} sub="three-putt holes" /></Clk>
              <Clk k="pen" d={detail} set={setDetail}><StatCard label="Penalties" value={done.length ? (pens / done.length).toFixed(1) : "—"} sub="per round" /></Clk>
            </div>
          )}
        </>
      ) : (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "12px 14px", marginTop: 14, color: C.sage, fontSize: 12, lineHeight: 1.5 }}>
          Track fairways, greens, and putts on a round to unlock shot-by-shot insight — GIR, putting, scrambling, and how you compare to your handicap’s peers. Log a hole-by-hole round to switch it on.
        </div>
      )}

      {detail && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Eyebrow>{detailLabels[detail]} · TREND</Eyebrow>
            <div style={{ flex: 1 }} />
            <button aria-label="Close" onClick={() => setDetail(null)} style={{ background: C.greenMid, border: "none", color: C.cream, width: 30, height: 30, borderRadius: 14, fontSize: 17, fontWeight: 800, lineHeight: 1, cursor: "pointer", flexShrink: 0 }}>×</button>
          </div>
          {(() => {
            const key = detail as StatKey;
            const series = sorted.map((r) => ({ r, v: perRoundNum(key, r) })).filter((x) => x.v != null && Number.isFinite(x.v)) as { r: Round; v: number }[];
            if (series.length === 0) return <div style={{ color: C.sage, fontSize: 13, padding: "12px 2px" }}>No rounds with this stat yet — log a few and the trend appears here.</div>;
            const pctStat = key === "gir" || key === "fir" || key === "scramble" || key === "sandsave";
            const samples: TrendSample[] = series.map(({ r, v }) => {
              if (!pctStat) return { value: v };
              const counts = key === "gir" ? girStats([r]) : key === "fir" ? firStats([r]) : key === "scramble" ? scrambleStats([r]) : sandSaveStats([r]);
              return { value: v, hit: counts.hit, total: counts.total };
            });
            const recent = recentForm(samples, pctStat);
            const data = series.map((x, i) => ({ i: i + 1, val: x.v, recent: recent[i], hit: samples[i].hit, total: samples[i].total, course: x.r.course, playedAt: x.r.played_at, name: fmtDate(x.r.played_at) }));
            const seriesAvg = trendSummary(samples, dirLower.has(key), pctStat).average;
            const vals = data.map((d) => d.val);
            const valDomain: [number, number] = pctStat
              ? [Math.max(0, Math.floor(Math.min(...vals) - 3)), Math.min(100, Math.ceil(Math.max(...vals) + 3))]
              : niceDomain(vals, 1);
            return (
              <>
                <TrendOverview samples={samples} lowerBetter={dirLower.has(key)} rate={pctStat} unit={key === "putts" ? "putts" : key === "pts" ? "points" : key === "pen" ? "penalties" : key === "threeputt" ? "three-putt holes" : "strokes"} />
                <DismissableChart height={240} marginTop={12}>
                  <AdaptiveTrend data={data} valueKey="val" rollKey="recent" avg={seriesAvg} lowerBetter={dirLower.has(key)} pctStat={pctStat} domain={valDomain}
                    nameMap={{ val: detailLabels[key], recent: "Recent form" }}
                    fmt={(v: any) => typeof v === "number" ? v.toFixed(1) + (pctStat ? "%" : "") : v} />
                </DismissableChart>
                <TrendKey rate={pctStat} lowerBetter={dirLower.has(key)} />
              </>
            );
          })()}
        </div>
      )}

      <ShotSynthesis fir={fir} gir={gir} puttsPerRound={puttsPerRound} scramble={scramble} index={hcp.index ?? currentIndex} goalHcp={effGoal} setGoalHcp={setGoalHcp} detailRounds={detailRounds} />

      {allHoles.length > 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <Eyebrow>HOLE OUTCOMES</Eyebrow>
            <span style={{ color: C.sage, fontSize: 11 }}>{distTotal} holes · {done.length} round{done.length === 1 ? "" : "s"}</span>
          </div>
          <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden", marginTop: 12 }}>
            {distData.filter((d) => d.v > 0).map((d, i) => {
              const p = distTotal ? (100 * d.v) / distTotal : 0;
              return (
                <div key={i} title={`${d.name}: ${d.v} (${Math.round(p)}%)`}
                  style={{ width: `${p}%`, background: d.c, display: "flex", alignItems: "center", justifyContent: "center", color: C.green, fontSize: 11, fontWeight: 800 }}>
                  {p >= 8 ? `${Math.round(p)}%` : ""}
                </div>
              );
            })}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "9px 14px", marginTop: 11 }}>
            {distData.map((d, i) => (
              <span key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: C.cream }}>
                <span style={{ width: 11, height: 11, borderRadius: 6, background: d.c, display: "inline-block" }} />
                {d.name} <b style={{ fontWeight: 800 }}>{d.v}</b> <span style={{ color: C.sage }}>{distTotal ? Math.round(100 * d.v / distTotal) : 0}%</span>
              </span>
            ))}
          </div>
          <div style={{ color: C.cream, fontSize: 12, marginTop: 12 }}>
            Par or better: <b style={{ color: "#7FE3A3" }}>{distTotal ? Math.round(100 * (buckets.eagle + buckets.birdie + buckets.par) / distTotal) : 0}%</b>
            <span style={{ color: C.sage }}> · </span>
            Doubles+: <b style={{ color: C.overRedDark }}>{distTotal ? Math.round(100 * buckets.double / distTotal) : 0}%</b>
          </div>
        </div>
      )}

      {/* Personal bests (owner, Oct 30): the latest new best as a hero, the rest as rows; each opens its round */}
      <PersonalBestsCard rounds={rounds} onOpen={onOpen} />

      <div style={{ marginTop: 20 }}>
        <Eyebrow>RECENT ROUNDS</Eyebrow>
        {done.length === 0 && (
          <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 10, color: C.sage, textAlign: "center" }}>
            No rounds yet, {name}. Tap "New round" to enter your first scorecard.
          </div>
        )}
        {[...done].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at)).slice(0, 5).map((r) => <RoundRow key={r.id} r={r} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

// Dashboard AI Coach: a zoomed-out coaching summary across ALL the player's
// stats. Collapsible, date-stamped, shows how many rounds it used, and persists
// on the user's profile so it's there whenever they return. Uses the same daily
// quota as the per-round analysis; the owner email is exempt.
function DashboardCoach({ aggregate, roundsUsed, userEmail, userId, saved, onSaved }: {
  aggregate: any; roundsUsed: number; userEmail?: string | null; userId?: string; saved?: any; onSaved?: () => void;
}) {
  const UNLIMITED_EMAIL = "amitsud@gmail.com";
  const unlimited = (userEmail || "").trim().toLowerCase() === UNLIMITED_EMAIL;
  // saved shape: { text, date (ISO), rounds }
  const initial = saved && saved.text ? saved : null;
  const [data, setData] = useState<{ text: string; date: string; rounds: number } | null>(initial);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const [left, setLeft] = useState<number>(AI_DAILY_LIMIT_VALUE);
  useEffect(() => { setLeft(aiUsesLeft()); }, []);

  const run = async () => {
    if (roundsUsed < 1) { setErr("Log a round first to get a coaching summary."); setState("error"); setOpen(true); return; }
    if (!unlimited && aiUsesLeft() <= 0) { setErr(`You've used your ${AI_DAILY_LIMIT_VALUE} AI analyses for today. Try again tomorrow.`); setState("error"); setOpen(true); return; }
    setState("loading"); setErr(""); setOpen(true);
    try {
      const resp = await fetch("/api/analyze-round", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "dashboard", aggregate }),
      });
      const d = await resp.json();
      if (!resp.ok) { setErr(d.error || "Couldn't generate your summary."); setState("error"); return; }
      if (!unlimited) { recordAiUse(); setLeft(aiUsesLeft()); }
      const payload = { text: d.analysis || "", date: new Date().toISOString(), rounds: roundsUsed };
      setData(payload); setState("idle");
      if (userId) {
        supabase.from("profiles").update({ dashboard_ai: payload }).eq("id", userId).then(() => { onSaved && onSaved(); });
      }
    } catch {
      setErr("Couldn't reach the analysis service. Check your connection and try again.");
      setState("error");
    }
  };

  const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); } catch { return iso.slice(0, 10); } };

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 14, marginTop: 16, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: data ? "pointer" : "default" }}
        onClick={() => data && setOpen((v) => !v)}>
        <Eyebrow style={{ margin: 0 }}>✦ AI COACH</Eyebrow>
        <div style={{ flex: 1 }} />
        {data && <span style={{ color: C.sage, fontSize: 16 }}>{open ? "▾" : "▸"}</span>}
      </div>

      {data && !open && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
          Summary from {fmt(data.date)} · {data.rounds} round{data.rounds === 1 ? "" : "s"} — tap to expand
        </div>
      )}

      {!data && state !== "loading" && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
          Get a coaching review across all your rounds — strengths, biggest opportunities, and what to work on to shoot lower.
          {unlimited ? " (unlimited)" : ` (${left} left today)`}
        </div>
      )}

      {open && data && (
        <>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
            Generated {fmt(data.date)} · based on {data.rounds} round{data.rounds === 1 ? "" : "s"}
          </div>
          <div style={{ color: C.cream, fontSize: 14, marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{data.text}</div>
        </>
      )}

      {state === "loading" && <div style={{ color: C.gold, fontSize: 13, marginTop: 10 }}>Reviewing your game…</div>}
      {state === "error" && <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 10 }}>{err}</div>}

      <div style={{ marginTop: 10 }}>
        {state !== "loading" && (
          <button style={{ ...btn(true), fontSize: 12 }} onClick={run}>
            {data ? "↻ Refresh summary" : "✦ Analyze my game"}
          </button>
        )}
      </div>
    </div>
  );
}
