"use client";
// 212.18 — Insights (owner, Oct 22): a dashboard card with the two strongest findings, opening a full Insights screen —
// scoring against par by hole type, difficulty and stretch, consistency, and every finding. lib/insights computes it.
import React, { useMemo, useState } from "react";
import { C } from "@/lib/golf";
import type { Round } from "@/lib/golf";
import { Eyebrow, btn } from "@/components/ui";
import { computeInsights, INSIGHT_MIN_ROUNDS, type Bucket, type Finding, type Insights } from "@/lib/insights";

const toPar = (n: number | null) => (n == null ? "–" : `${n > 0.049 ? "+" : ""}${n.toFixed(1)}`);
const dot = (tone: Finding["tone"]) => (tone === "leak" ? C.overRedDark : tone === "strength" ? "#5BD08A" : C.gold);

function FindingLine({ f }: { f: Finding }) {
  return (
    <div data-insight-finding style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: dot(f.tone), marginTop: 7, flexShrink: 0 }} />
      <span style={{ lineHeight: 1.35 }}>
        <span style={{ display: "block", color: C.cream, fontSize: 15, fontWeight: 800 }}>{f.title}</span>
        <span style={{ display: "block", color: C.sage, fontSize: 13, marginTop: 1 }}>{f.detail[0].toUpperCase() + f.detail.slice(1)}</span>
      </span>
    </div>
  );
}

/** The dashboard card: the two strongest findings, and the way into the full screen. */
export function InsightsCard({ rounds }: { rounds: Round[] }) {
  const ins = useMemo(() => computeInsights(rounds), [rounds]);
  const [open, setOpen] = useState(false);
  return (
    <div data-insights-card style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
      <Eyebrow style={{ marginTop: 0 }}>INSIGHTS</Eyebrow>
      {!ins.ready ? (
        <div style={{ color: C.sage, fontSize: 14 }}>Insights appear after {INSIGHT_MIN_ROUNDS} rounds with hole-by-hole scores — you have {ins.roundsUsed}.</div>
      ) : (
        <>
          {ins.findings.slice(0, 2).map((f) => <FindingLine key={f.key} f={f} />)}
          {!ins.findings.length ? <div style={{ color: C.sage, fontSize: 14 }}>No standout patterns in your last {ins.roundsUsed} rounds — a very even game.</div> : null}
          <button onClick={() => setOpen(true)} style={{ ...btn(false), marginTop: 14, fontSize: 13, width: "100%" }}>See all insights →</button>
        </>
      )}
      {open ? <InsightsScreen ins={ins} onClose={() => setOpen(false)} /> : null}
    </div>
  );
}

function Bars({ title, buckets }: { title: string; buckets: Bucket[] }) {
  const max = Math.max(0.5, ...buckets.map((b) => Math.abs(b.avgToPar ?? 0)));
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{title}</div>
      {buckets.map((b) => (
        <div key={b.key} data-insight-bucket={b.key} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: C.cream }}>{b.label[0].toUpperCase() + b.label.slice(1)}</span>
            <span style={{ color: C.cream, fontWeight: 800 }}>{toPar(b.avgToPar)}<span style={{ color: C.sage, fontWeight: 500 }}> a hole{b.netAvg != null ? ` · ${toPar(b.netAvg)} vs your game` : ""}</span></span>
          </div>
          <div style={{ height: 8, background: C.green, borderRadius: 999, marginTop: 4, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, (Math.abs(b.avgToPar ?? 0) / max) * 100)}%`, background: (b.avgToPar ?? 0) > 0.75 ? C.overRedDark : (b.avgToPar ?? 0) > 0.25 ? C.gold : "#5BD08A", borderRadius: 999 }} />
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{b.holes} holes</div>
        </div>
      ))}
    </div>
  );
}

/** The full Insights screen. */
export function InsightsScreen({ ins, onClose }: { ins: Insights; onClose: () => void }) {
  return (
    <div data-insights-screen role="dialog" aria-label="Insights" style={{ position: "fixed", inset: 0, zIndex: 60, background: C.green, overflowY: "auto",
      paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: 16 }}>
        <button onClick={onClose} style={{ ...btn(false), fontSize: 13 }}>‹ Back</button>
        <div style={{ color: C.cream, fontSize: 26, fontWeight: 800, fontFamily: "Georgia, serif", marginTop: 14 }}>Your insights</div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 2 }}>From your last {ins.roundsUsed} rounds with hole-by-hole scores · {toPar(ins.overall)} a hole overall</div>
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>WHAT STANDS OUT</div>
          {ins.findings.length ? ins.findings.map((f) => <FindingLine key={f.key} f={f} />) : <div style={{ color: C.sage, fontSize: 14, marginTop: 8 }}>No standout patterns — a very even game.</div>}
        </div>
        <Bars title="BY HOLE TYPE" buckets={ins.byPar} />
        <Bars title="BY DIFFICULTY (STROKE INDEX)" buckets={ins.byDifficulty} />
        <Bars title="THROUGH THE ROUND" buckets={ins.byStretch} />
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
          <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>CONSISTENCY</div>
          {[
            ["Within 3 of your handicap", ins.withinHandicap ? `${ins.withinHandicap.within} of ${ins.withinHandicap.rounds} full rounds` : "needs 5 full rounds with a handicap"],
            ["Blow-up holes cost", ins.blowUpCost != null ? `${ins.blowUpCost.toFixed(1)} shots a round` : "–"],
            ["Three-putts", ins.threePutts != null ? `${ins.threePutts.toFixed(1)} a round` : "record putts to see this"],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 10, fontSize: 14 }}>
              <span style={{ color: C.cream }}>{k}</span><span style={{ color: C.cream, fontWeight: 800, textAlign: "right" }}>{v}</span>
            </div>
          ))}
        </div>
        <div style={{ color: C.sage, fontSize: 11.5, marginTop: 12, lineHeight: 1.45 }}>Against par, per hole played. "vs your game" compares each hole with what your own game predicts for it — your score spread across the holes the way handicap strokes are, so the hardest holes are expected to cost more. The findings use that, so they show what's really different about your game. Rounds need 9 or more holes scored; scramble and alternate-shot rounds aren&apos;t included (the score belongs to the team).</div>
      </div>
    </div>
  );
}
