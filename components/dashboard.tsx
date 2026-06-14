"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell, ComposedChart, PieChart, Pie, Legend,
} from "recharts";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
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

export function Dashboard({ rounds, name, onOpen, currentIndex, saveIndex, userEmail, userId, savedCoach, onCoachSaved }: {
  rounds: Round[]; name: string; onOpen: (r: Round) => void;
  currentIndex: number | null; saveIndex: (i: number | null) => void;
  userEmail?: string | null; userId?: string; savedCoach?: any; onCoachSaved?: () => void;
}) {
  const done = rounds.filter((r) => played(r).length > 0 || isGrossOnly(r));
  const sorted = [...done].sort((a, b) => +new Date(a.played_at) - +new Date(b.played_at));
  const avgDiff = done.length ? done.reduce((s, r) => s + diffOf(r), 0) / done.length : null;
  const best = done.length ? Math.min(...done.map(diffOf)) : null;
  const allHoles = done.flatMap(played);
  const withPutts = allHoles.filter((h) => h.putts != null);
  const avgPutts = withPutts.length ? withPutts.reduce((s, h) => s + (h.putts || 0), 0) / withPutts.length : null;
  const gir = girStats(done), fir = firStats(done);
  const pens = done.reduce((s, r) => s + pensOf(r), 0);
  const fulls = done.filter((r) => played(r).length >= 14 || isGrossOnly(r));
  const avgPts = fulls.length ? fulls.reduce((s, r) => s + estimatedStablefordPts(r), 0) / fulls.length : null;
  const anyEstimatedPts = fulls.some(hasEstimatedStableford);
  const buckets = holeBuckets(done);
  const byPar = avgByPar(done);
  const diffs = done.map(roundDifferential).filter((d): d is number => d != null);
  const avgDifferential = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null;
  const hcp = runningHandicap(done);
  const threePutts = threePuttsPerRound(done);

  // Compact, numbers-only career summary for the AI coach.
  const coachAggregate = {
    handicapIndex: hcp.index ?? currentIndex ?? null,
    roundsLogged: done.length,
    avgScoreVsPar: avgDiff == null ? null : Math.round(avgDiff * 10) / 10,
    bestVsPar: best,
    avgDifferential: avgDifferential == null ? null : Math.round(avgDifferential * 10) / 10,
    avgPuttsPerHole: avgPutts == null ? null : Math.round(avgPutts * 100) / 100,
    threePuttsPerRound: threePutts == null ? null : Math.round(threePutts * 10) / 10,
    girPct: gir.total ? Math.round((100 * gir.hit) / gir.total) : null,
    fairwayPct: fir.total ? Math.round((100 * fir.hit) / fir.total) : null,
    avgByPar: byPar,
    scoringMix: buckets, // eagles/birdies/pars/bogeys/doubles totals
    penaltiesTotal: pens,
  };

  const trend = sorted.map((r, i) => ({ i: i + 1, name: fmtDate(r.played_at), diff: diffOf(r), pts: estimatedStablefordPts(r), course: r.course, estimated: hasEstimatedStableford(r) }));
  // Dynamic axis domains: fit the data range with a little padding, instead of anchoring at 0.
  const niceDomain = (vals: number[], pad: number): [number, number] => {
    if (vals.length === 0) return [0, 1];
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= pad; hi += pad; }       // flat series → give it some room
    else { const p = Math.max(pad, Math.round((hi - lo) * 0.15)); lo -= p; hi += p; }
    return [Math.floor(lo), Math.ceil(hi)];
  };
  const diffDomain = niceDomain(trend.map((t) => t.diff), 2);
  const ptsVals = trend.map((t) => t.pts).filter((v) => v > 0);
  const ptsDomain = niceDomain(ptsVals, 2);
  const distTotal = buckets.eagle + buckets.birdie + buckets.par + buckets.bogey + buckets.double;
  const distData = [
    { name: "Eagle+", v: buckets.eagle, c: "#C77DFF" },
    { name: "Birdie", v: buckets.birdie, c: "#4ADE80" },
    { name: "Par", v: buckets.par, c: "#38BDF8" },
    { name: "Bogey", v: buckets.bogey, c: "#FBBF24" },
    { name: "Dbl+", v: buckets.double, c: "#FB7185" },
  ].map((d) => ({ ...d, label: `${d.name}: ${d.v} (${distTotal ? Math.round((100 * d.v) / distTotal) : 0}%)` }));

  // Per-round value for each stat, for the click-to-expand drill-down.
  type StatKey = "rounds" | "avgpar" | "best" | "diff" | "par3" | "par4" | "par5" | "pts" | "gir" | "fir" | "putts" | "threeputt" | "pen";
  const [detail, setDetail] = useState<StatKey | null>(null);
  const perRound = (key: StatKey, r: Round): string => {
    const hs = played(r);
    switch (key) {
      case "rounds": return `${strokesOf(r)} (${toParStr(diffOf(r))})`;
      case "avgpar": return toParStr(diffOf(r));
      case "best": return toParStr(diffOf(r));
      case "diff": { const d = roundDifferential(r); return d == null ? "— (needs 18 + rating/slope)" : d.toFixed(1); }
      case "par3": { const a = hs.filter((h) => h.par === 3); return a.length ? (a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length).toFixed(2) : "—"; }
      case "par4": { const a = hs.filter((h) => h.par === 4); return a.length ? (a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length).toFixed(2) : "—"; }
      case "par5": { const a = hs.filter((h) => h.par === 5); return a.length ? (a.reduce((s, h) => s + (h.strokes || 0), 0) / a.length).toFixed(2) : "—"; }
      case "pts": return stablefordDisplay(r);
      case "gir": { const g = girStats([r]); return g.total ? `${g.hit}/${g.total} (${Math.round(100 * g.hit / g.total)}%)` : "— (needs putts)"; }
      case "fir": { const f = firStats([r]); return f.total ? `${f.hit}/${f.total} (${Math.round(100 * f.hit / f.total)}%)` : "—"; }
      case "putts": { const p = hs.filter((h) => h.putts != null); return p.length ? `${puttsOf(r)} (${(puttsOf(r) / p.length).toFixed(2)}/hole)` : "—"; }
      case "threeputt": return `${hs.filter((h) => (h.putts || 0) >= 3).length}`;
      case "pen": return `${pensOf(r)}`;
    }
  };
  const detailLabels: Record<StatKey, string> = {
    rounds: "Score", avgpar: "vs par", best: "vs par", diff: "Differential",
    par3: "Avg par 3", par4: "Avg par 4", par5: "Avg par 5", pts: "Stableford",
    gir: "GIR", fir: "Fairways", putts: "Putts", threeputt: "3+ putts", pen: "Penalties",
  };

  return (
    <div>
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginBottom: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 700 }}>RUNNING HANDICAP INDEX</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
            {hcp.index == null
              ? `Need at least 3 full 18-hole rounds (with rating & slope). You have ${hcp.total}.`
              : `Best ${hcp.used} of your last ${Math.min(hcp.total, 20)} differentials · WHS method`}
          </div>
          {hcp.index != null && hcp.usedDiffs.length > 0 && (
            <div style={{ color: C.cream, fontSize: 12, marginTop: 6 }}>
              Differential{hcp.usedDiffs.length > 1 ? "s" : ""} used: <b>{hcp.usedDiffs.map((d) => d.toFixed(1)).join(", ")}</b>
              {hcp.adj !== 0 ? ` · adjustment ${hcp.adj > 0 ? "+" : ""}${hcp.adj.toFixed(1)}` : ""}
              <span style={{ color: C.sage }}> (of {hcp.allDiffs.map((d) => d.toFixed(1)).join(", ")})</span>
            </div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 44, fontWeight: 800 }}>
            {hcp.index == null ? "—" : hcp.index.toFixed(1)}
          </div>
          {hcp.index != null && (
            currentIndex === hcp.index ? (
              <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>✓ in use as your handicap</div>
            ) : (
              <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12, marginTop: 4 }}
                onClick={() => saveIndex(hcp.index)}>
                Use as my handicap
              </button>
            )
          )}
        </div>
      </div>
      <DashboardCoach
        aggregate={coachAggregate}
        roundsUsed={done.length}
        userEmail={userEmail}
        userId={userId}
        saved={savedCoach}
        onSaved={onCoachSaved}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Clk k="rounds" d={detail} set={setDetail}><StatCard label="Rounds" value={done.length} /></Clk>
        <Clk k="avgpar" d={detail} set={setDetail}><StatCard label="Avg vs par" value={avgDiff == null ? "—" : (avgDiff >= 0 ? "+" : "") + avgDiff.toFixed(1)} /></Clk>
        <Clk k="best" d={detail} set={setDetail}><StatCard label="Best round" value={best == null ? "—" : toParStr(best)} /></Clk>
        <Clk k="diff" d={detail} set={setDetail}><StatCard label="Avg differential" value={avgDifferential == null ? "—" : avgDifferential.toFixed(1)}
          sub={diffs.length ? `${diffs.length} full round${diffs.length === 1 ? "" : "s"} w/ rating·slope` : "needs 18 holes + rating/slope"} /></Clk>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <Clk k="par3" d={detail} set={setDetail}><StatCard label="Avg on par 3s" value={byPar.par3 == null ? "—" : byPar.par3.toFixed(2)} sub={byPar.par3 == null ? "" : (byPar.par3 - 3 >= 0 ? "+" : "") + (byPar.par3 - 3).toFixed(2) + " vs par"} /></Clk>
        <Clk k="par4" d={detail} set={setDetail}><StatCard label="Avg on par 4s" value={byPar.par4 == null ? "—" : byPar.par4.toFixed(2)} sub={byPar.par4 == null ? "" : (byPar.par4 - 4 >= 0 ? "+" : "") + (byPar.par4 - 4).toFixed(2) + " vs par"} /></Clk>
        <Clk k="par5" d={detail} set={setDetail}><StatCard label="Avg on par 5s" value={byPar.par5 == null ? "—" : byPar.par5.toFixed(2)} sub={byPar.par5 == null ? "" : (byPar.par5 - 5 >= 0 ? "+" : "") + (byPar.par5 - 5).toFixed(2) + " vs par"} /></Clk>
        <Clk k="pts" d={detail} set={setDetail}><StatCard label="Stableford avg" value={avgPts == null ? "—" : avgPts.toFixed(1)} sub={anyEstimatedPts ? "includes estimates" : "full rounds"} /></Clk>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <Clk k="gir" d={detail} set={setDetail}><StatCard label="GIR" value={fracPct(gir)} sub={gir.total ? "greens in regulation" : "needs putts"} /></Clk>
        <Clk k="fir" d={detail} set={setDetail}><StatCard label="Fairways hit" value={fracPct(fir)} sub={fir.total ? "excludes par 3s" : "tap FW"} /></Clk>
        <Clk k="putts" d={detail} set={setDetail}><StatCard label="Putts / hole" value={avgPutts == null ? "—" : avgPutts.toFixed(2)} /></Clk>
        <Clk k="threeputt" d={detail} set={setDetail}><StatCard label="3+ putts / round" value={threePutts == null ? "—" : threePutts.toFixed(1)} sub="three-putt holes" /></Clk>
        <Clk k="pen" d={detail} set={setDetail}><StatCard label="Penalties" value={done.length ? (pens / done.length).toFixed(1) : "—"} sub="per round" /></Clk>
      </div>

      {detail && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <Eyebrow>{detailLabels[detail]} · BY ROUND</Eyebrow>
            <div style={{ flex: 1 }} />
            <button style={{ ...btn(false), fontSize: 12 }} onClick={() => setDetail(null)}>Close ✕</button>
          </div>
          {sorted.slice().reverse().map((r) => (
            <div key={r.id} onClick={() => onOpen(r)} style={{ display: "flex", alignItems: "center", padding: "10px 4px", borderBottom: `1px solid ${C.greenMid}`, cursor: "pointer" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.cream, fontSize: 14, fontWeight: 600 }}>{r.course}</div>
                <div style={{ color: C.sage, fontSize: 11 }}>{fmtDate(r.played_at)}</div>
              </div>
              <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700, fontSize: 15 }}>{perRound(detail, r)}</div>
            </div>
          ))}
        </div>
      )}

      {trend.length >= 2 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <Eyebrow>SCORING TREND</Eyebrow>
          <div style={{ height: 200, marginTop: 10 }}>
            <ResponsiveContainer>
              <ComposedChart data={trend} margin={{ top: 5, right: 6, left: -8, bottom: 0 }}>
                <XAxis dataKey="i" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} />
                <YAxis yAxisId="left" domain={diffDomain} allowDecimals={false} tick={{ fill: C.cream, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <YAxis yAxisId="right" orientation="right" domain={ptsDomain} allowDecimals={false} tick={{ fill: C.gold, fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
                <Tooltip
                  contentStyle={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, k: any) => [k === "diff" ? toParStr(v) : v, k === "diff" ? "vs par" : "Stableford pts"]}
                  labelFormatter={(l: any, p: any) => (p && p[0] ? `${p[0].payload.course} · ${p[0].payload.name}` : l)} />
                <ReferenceLine yAxisId="left" y={0} stroke={C.cream} strokeDasharray="4 4" />
                <Line yAxisId="left" type="monotone" dataKey="diff" stroke={C.cream} strokeWidth={2} dot={{ fill: C.cream, r: 3 }} />
                <Line yAxisId="right" type="monotone" dataKey="pts" stroke={C.gold} strokeWidth={2} strokeDasharray="5 3" dot={{ fill: C.gold, r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Cream (left axis) = strokes vs par (lower better) · Gold (right axis) = Stableford points (higher better)</div>
        </div>
      )}

      {allHoles.length > 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <Eyebrow>HOLE OUTCOMES · {allHoles.length} HOLES</Eyebrow>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, marginTop: 10 }}>
            <div style={{ width: 200, height: 200, position: "relative" }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={distData} dataKey="v" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="none">
                    {distData.map((d, i) => <Cell key={i} fill={d.c} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, n: any) => [`${v} holes (${distTotal ? Math.round(100 * v / distTotal) : 0}%)`, n]} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{distTotal}</div>
                <div style={{ color: C.sage, fontSize: 10, letterSpacing: 1 }}>HOLES</div>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              {distData.map((d, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0" }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: d.c, display: "inline-block" }} />
                  <span style={{ color: C.cream, fontSize: 13, flex: 1 }}>{d.name}</span>
                  <span style={{ color: C.cream, fontWeight: 700, fontSize: 13 }}>{d.v}</span>
                  <span style={{ color: C.sage, fontSize: 12, width: 44, textAlign: "right" }}>{distTotal ? Math.round(100 * d.v / distTotal) : 0}%</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0 0", marginTop: 4, borderTop: `1px solid ${C.greenMid}` }}>
                <span style={{ width: 12 }} />
                <span style={{ color: C.gold, fontSize: 13, flex: 1, fontWeight: 700 }}>Total holes</span>
                <span style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>{distTotal}</span>
                <span style={{ width: 44 }} />
              </div>
            </div>
          </div>
        </div>
      )}

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
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 14, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, cursor: data ? "pointer" : "default" }}
        onClick={() => data && setOpen((v) => !v)}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 800 }}>✦ AI COACH</div>
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
          <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>
            Generated {fmt(data.date)} · based on {data.rounds} round{data.rounds === 1 ? "" : "s"}
          </div>
          <div style={{ color: C.cream, fontSize: 14, marginTop: 8, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{data.text}</div>
        </>
      )}

      {state === "loading" && <div style={{ color: C.gold, fontSize: 13, marginTop: 10 }}>Reviewing your game…</div>}
      {state === "error" && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>}

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
