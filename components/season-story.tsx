"use client";
// The Season Wrapped story (205.0): one card per fact, auto-advancing every 6s with a progress bar;
// tap the right half to skip, left half to go back, hold to pause. All copy comes from
// lib/season-summary; this file only lays it out. `autoplay={false}` renders every card at once
// (the render harness and the look-back page use that).
import React, { useEffect, useRef, useState } from "react";
import { C } from "@/lib/golf";
import { fmtMatchDate } from "@/lib/lineup-meta";
import type { SeasonSummary, SeasonCard } from "@/lib/season-summary";
import { FormBars, withRolling } from "@/components/charts/form-bars";

const Big = ({ children }: { children: React.ReactNode }) => <div style={{ fontFamily: "Georgia, serif", fontSize: 56, fontWeight: 800, color: C.cream, lineHeight: 1 }}>{children}</div>;
const Eyebrow = ({ children }: { children: React.ReactNode }) => <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2.4, fontWeight: 800 }}>{children}</div>;
const Line = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => <div style={{ color: dim ? C.sage : C.cream, fontSize: 16, lineHeight: 1.45, marginTop: 10 }}>{children}</div>;

function IndexSpark({ series }: { series: { date: string; index: number }[] }) {
  if (series.length < 2) return null;
  const w = 300, h = 80, pad = 6;
  const xs = series.map((_, i) => pad + (i * (w - 2 * pad)) / (series.length - 1));
  const lo = Math.min(...series.map((s) => s.index)), hi = Math.max(...series.map((s) => s.index));
  const y = (v: number) => (hi === lo ? h / 2 : pad + ((v - lo) * (h - 2 * pad)) / (hi - lo));
  const d = series.map((s, i) => `${i ? "L" : "M"}${xs[i].toFixed(1)},${y(s.index).toFixed(1)}`).join(" ");
  const li = series.reduce((a, b, i, arr) => (b.index < arr[a].index ? i : a), 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} style={{ marginTop: 14 }} aria-hidden>
      <path d={d} fill="none" stroke={C.cream} strokeWidth={2.5} strokeLinejoin="round" />
      <circle cx={xs[li]} cy={y(series[li].index)} r={5} fill={C.gold} />
    </svg>
  );
}

// The Dashboard's Scoring Form chart (shared component), sized for a story card.
function SeasonForm({ points, label, lowerBetter = true }: { points: { date: string; course: string; value: number }[]; label: string; lowerBetter?: boolean }) {
  if (points.length < 3) return null;
  const data = withRolling(points.map((p) => ({ value: p.value, course: p.course, name: fmtMatchDate(p.date.slice(0, 10)) || p.date })));
  const avg = points.reduce((s, p) => s + p.value, 0) / points.length;
  // A season of rounds numbered 1..26 crowds the axis; label by MONTH instead — one tick at the first
  // round of each month (205.1).
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthOf = (k: number) => Number(points[k].date.slice(5, 7)) - 1;
  const ticks: number[] = []; const label_: Record<number, string> = {};
  points.forEach((_, k) => { if (k === 0 || monthOf(k) !== monthOf(k - 1)) { ticks.push(k + 1); label_[k + 1] = MONTHS[monthOf(k)]; } });
  return (
    <div data-season-chart={label} style={{ marginTop: 14 }}>
      <FormBars data={data} avg={avg} lowerBetter={lowerBetter} width={340} height={170} ticks={ticks} tickFormatter={(i) => label_[i] ?? ""} />
      <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Each bar is one round, in date order · green beat your season average ({Math.round(avg * 10) / 10}), red didn't · the cream line is your 5-round average</div>
    </div>
  );
}

export function SeasonCardView({ card, name, year }: { card: SeasonCard; name: string; year: number }) {
  switch (card.kind) {
    case "headline": return (<><Eyebrow>{year} · {name.toUpperCase()}</Eyebrow><Big>{card.rounds} rounds</Big><Line>{card.holes.toLocaleString()} holes at {card.courses} course{card.courses === 1 ? "" : "s"}{card.hours != null ? ` · ${card.hours} hours on the course` : ""}</Line>{card.teamRounds ? <div style={{ color: C.sage, fontSize: 14, marginTop: 6 }}>including {card.teamRounds} scramble &amp; alternate-shot round{card.teamRounds === 1 ? "" : "s"}</div> : null}</>);
    case "index": return card.start == null && card.establishedOn ? (
      <><Eyebrow>HANDICAP INDEX</Eyebrow><Big>{card.end ?? "—"}</Big><Line>Established at <b style={{ color: C.gold }}>{card.establishedAt}</b> on {fmtMatchDate(card.establishedOn.slice(0, 10))}, after your 20th round</Line>{card.low != null && card.series.length > 1 && <Line dim>Since then: low {card.low}{card.lowDate ? ` on ${fmtMatchDate(card.lowDate.slice(0, 10))}` : ""}</Line>}<SeasonForm points={card.diffs} label="differentials" /></>
    ) : card.start == null ? (
      <><Eyebrow>HANDICAP INDEX</Eyebrow><Big>{card.end ?? "—"}</Big><Line dim>Still building — an index settles after 20 rounds. The trend starts next season.</Line><SeasonForm points={card.diffs} label="differentials" /></>
    ) : (<><Eyebrow>HANDICAP INDEX</Eyebrow><Big>{card.end != null ? `${card.start} → ${card.end}` : card.start}</Big>{card.low != null && <Line dim>Season low <b style={{ color: C.gold }}>{card.low}</b>{card.lowDate ? ` on ${fmtMatchDate(card.lowDate.slice(0, 10))}` : ""}</Line>}<IndexSpark series={card.series} /><SeasonForm points={card.diffs} label="differentials" /></>);
    case "best": return (<><Eyebrow>YOUR BEST DAY</Eyebrow><Big>{card.gross ?? card.differential}{card.gross != null && card.par ? <span style={{ fontSize: 24, color: C.sage, marginLeft: 10 }}>{card.gross - card.par >= 0 ? "+" : ""}{card.gross - card.par}</span> : null}</Big><Line>{card.course}{card.tee ? ` · ${card.tee} tees` : ""}{card.par ? ` · par ${card.par}` : ""} · {fmtMatchDate(card.date.slice(0, 10))}</Line><Line dim>Differential {card.differential}{card.indexAfter != null ? ` · index ${card.indexAfter} after it` : ""}</Line>
      {card.stats.length > 0 && (
        <div data-best-stats style={{ marginTop: 14 }}>
          <div style={{ display: "flex", color: C.sage, fontSize: 11, letterSpacing: 1.2, fontWeight: 800, paddingBottom: 4 }}>
            <span style={{ flex: 1 }} /><span style={{ width: 70, textAlign: "right" }}>THAT DAY</span><span style={{ width: 84, textAlign: "right" }}>SEASON</span>
          </div>
          {card.stats.map((r) => (
            <div key={r.label} style={{ display: "flex", alignItems: "baseline", paddingTop: 4, paddingBottom: 4, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ flex: 1, color: C.cream, fontSize: 14 }}>{r.label}</span>
              <span style={{ width: 70, textAlign: "right", color: r.better ? "#4ADE80" : C.cream, fontSize: 16, fontWeight: 800, fontFamily: "Georgia, serif" }}>{r.day}</span>
              <span style={{ width: 84, textAlign: "right", color: C.sage, fontSize: 14 }}>{r.season}</span>
            </div>
          ))}
        </div>
      )}</>);
    case "birdies": return (<><Eyebrow>BIRDIES</Eyebrow><Big>{card.birdies + card.eaglesOrBetter}</Big><Line>{card.eaglesOrBetter ? `${card.eaglesOrBetter} eagle${card.eaglesOrBetter === 1 ? "" : "s"} or better among them` : "and counting"}</Line>{card.favouriteHole && <Line dim>Your favourite: hole {card.favouriteHole.hole} at {card.favouriteHole.course}, {card.favouriteHole.count} times</Line>}
      {card.recent.length > 0 && (
        <div data-birdie-log style={{ marginTop: 14 }}>
          <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1.2, fontWeight: 800, paddingBottom: 4 }}>THE LAST {card.recent.length === 1 ? "ONE" : card.recent.length}</div>
          {card.recent.map((b, i) => (
            <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, paddingTop: 4, paddingBottom: 4, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <span style={{ color: C.gold, fontSize: 15, fontWeight: 800, fontFamily: "Georgia, serif", width: 54 }}>{b.strokes <= b.par - 2 ? "Eagle" : "Birdie"}</span>
              <span style={{ flex: 1, color: C.cream, fontSize: 14 }}>Hole {b.hole} · par {b.par} · {b.course}</span>
              <span style={{ color: C.sage, fontSize: 12, whiteSpace: "nowrap" }}>{fmtMatchDate(b.date.slice(0, 10))?.replace(/, \d{4}$/, "")}</span>
            </div>
          ))}
        </div>
      )}</>);
    case "grind": return (<><Eyebrow>THE GRIND</Eyebrow>{card.puttsPerRound && <Big>{card.puttsPerRound.last} putts</Big>}{card.puttsPerRound && <Line dim>per round in your last five, from {card.puttsPerRound.first} in your first five</Line>}{card.fairwayPct != null && <Line>{card.fairwayPct}% of fairways hit</Line>}{card.mostImproved && <Line>{card.mostImproved}</Line>}<SeasonForm points={card.putts} label="putts" /></>);
    case "headToHead": return (<><Eyebrow>HEAD TO HEAD</Eyebrow><Big>{card.won}–{card.lost}{card.halved ? `–${card.halved}` : ""}</Big><Line dim>won–lost{card.halved ? "–halved" : ""} in match play</Line>{card.rival && <Line>Your most-played rival: <b>{card.rival.name}</b> — you {card.rival.won > card.rival.lost ? "lead" : card.rival.won < card.rival.lost ? "trail" : "are level"} {card.rival.won}–{card.rival.lost}{card.rival.halved ? `–${card.rival.halved}` : ""}</Line>}</>);
    case "badges": return (<><Eyebrow>BADGES EARNED</Eyebrow><Big>{card.earned.length}</Big><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{card.earned.slice(0, 8).map((b) => <span key={b.key} style={{ background: "rgba(255,255,255,0.08)", borderRadius: 999, padding: "4px 10px", color: C.cream, fontSize: 13 }}>{b.icon} {b.label}</span>)}</div>{card.rarest && <Line dim>Rarest: {card.rarest.icon} {card.rarest.label}</Line>}</>);
    case "club": return (<><Eyebrow>{card.clubs.length === 1 ? card.clubs[0].name.toUpperCase() : "YOUR CLUBS"}</Eyebrow>
      {card.clubs.length === 1 ? (<><Big>{card.clubs[0].totalRounds.toLocaleString()} rounds</Big><Line dim>played by the club this year — {card.clubs[0].members} members</Line>{card.clubs[0].topThree && <Line>You were <b style={{ color: C.gold }}>#{card.clubs[0].topThree}</b> in the club for rounds played</Line>}</>) : (
        <div data-season-clubs style={{ marginTop: 6 }}>
          {card.clubs.map((c) => (
            <div key={c.name} style={{ paddingTop: 8, paddingBottom: 8, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
              <div style={{ color: C.cream, fontSize: 16, fontWeight: 800 }}>{c.name}</div>
              <div style={{ color: C.sage, fontSize: 13, marginTop: 2 }}>You played {c.myRounds} of the club's {c.totalRounds} rounds{c.topThree ? <> · <b style={{ color: C.gold }}>#{c.topThree}</b> in the club</> : null}</div>
            </div>
          ))}
        </div>
      )}
      {card.playedWithMost && <Line>Played most with <b>{card.playedWithMost.name}</b> — {card.playedWithMost.rounds} game{card.playedWithMost.rounds === 1 ? "" : "s"} together</Line>}</>);
    case "closing": return (<><Eyebrow>{year + 1}</Eyebrow><Big>One number</Big><Line>{card.target}.</Line><Line dim>See you on the first tee.</Line></>);
    case "short": return (<><Eyebrow>{year} · {name.toUpperCase()}</Eyebrow><Big>{card.rounds} round{card.rounds === 1 ? "" : "s"}</Big><Line>A short season — the full story starts at five rounds.</Line><Line dim>See you on the first tee in {year + 1}.</Line></>);
  }
}

export function SeasonStory({ summary, autoplay = true, intervalMs = 6000 }: { summary: SeasonSummary; autoplay?: boolean; intervalMs?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = summary.cards.length;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!autoplay) return;
    if (timer.current) clearInterval(timer.current);
    if (paused) return;
    timer.current = setInterval(() => setI((x) => (x + 1 < n ? x + 1 : x)), intervalMs);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [autoplay, paused, n, intervalMs]);

  const shell = (cardIdx: number, child: React.ReactNode) => (
    <div key={cardIdx} data-season-card={summary.cards[cardIdx].kind} style={{ background: C.green, color: C.cream, borderRadius: autoplay ? 0 : 14, padding: "16px", minHeight: autoplay ? "100%" : 220, boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "center", position: "relative" }}>
      {child}
    </div>
  );
  if (!autoplay) {
    return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{summary.cards.map((c, k) => shell(k, <SeasonCardView card={c} name={summary.name} year={summary.year} />))}</div>;
  }
  // Fills its container (the host — a BottomSheet in the app — owns the frame, safe areas and close).
  return (
    <div data-season-story style={{ position: "relative", height: "100%", minHeight: 420, background: C.green, overflow: "hidden", userSelect: "none", touchAction: "manipulation" }}
      onPointerDown={() => setPaused(true)} onPointerUp={(e) => { setPaused(false); const box = (e.currentTarget as HTMLElement).getBoundingClientRect(); const x = (e.clientX - box.left) / Math.max(1, box.width); setI((v) => (x < 0.33 ? Math.max(0, v - 1) : Math.min(n - 1, v + 1))); }}>
      <div style={{ position: "absolute", top: 10, left: 12, right: 52, display: "flex", gap: 4 }}>
        {summary.cards.map((_, k) => <div key={k} style={{ flex: 1, height: 3, borderRadius: 999, background: k <= i ? C.gold : C.greenMid }} />)}
      </div>
      {shell(i, <SeasonCardView card={summary.cards[i]} name={summary.name} year={summary.year} />)}
    </div>
  );
}
