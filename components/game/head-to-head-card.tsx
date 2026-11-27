"use client";
/**
 * The head-to-head card (212.137, owner): one match, hole by hole — "how am I 1 up thru 11". Both players' gross and
 * net, each player's own stroke glyphs, who won the hole, the running state after it; above it what is needed from here;
 * below it the strokes still to come and the swing. One component for a Colosseum match and a singles match: the
 * numbers come from lib/head-to-head, which takes gross and strokes per hole — whatever basis the format uses — and
 * `basis` names that basis so the glyph is the scorecard's (185.0: circle = course handicap, triangle = off the opponent).
 * The viewer's own pair of columns is shaded; "a" is always the viewer when they are in the match.
 */
import React from "react";
import { C } from "@/lib/golf";
import { btn, strokeGlyph } from "@/components/ui";
import { HScroll } from "@/components/hscroll";
import { headToHead, h2hStateLabel, h2hNeededLine, runningLabel, type H2HSide } from "@/lib/head-to-head";
import type { MatchHoleMeta } from "@/lib/golf";

export function HeadToHeadCard({ holes, a, b, aIsViewer = true, basis, stakes, onBack, backLabel = "‹ Back", host = "green" }: {
  holes: MatchHoleMeta[]; a: H2HSide; b: H2HSide; aIsViewer?: boolean;
  /** which strokes these are: "course" (a Colosseum — each player's own card) or "opponent" (singles — off the difference) */
  basis: "course" | "opponent";
  /** "You give 9 · net v net" — the format's own words for the strokes */
  stakes?: string | null;
  onBack?: () => void; backLabel?: string;
  /** the ground the card sits on: the green page, or a greenLight panel (singles' Details) — the boxes keep contrast either way */
  host?: "green" | "greenLight";
}) {
  // the strokes are the callers' strokeSets (the course set for a Colosseum, the opponent set for singles), consumed as data
  const sets = { a: a.strokes, b: b.strokes };
  const h = headToHead(holes, { ...a, strokes: sets.a }, { ...b, strokes: sets.b });
  const label = h2hStateLabel(h);
  const needed = h2hNeededLine(h, b.name);
  const color = h.status.thru === 0 ? C.sage : h.status.lead > 0 ? C.underDark : h.status.lead < 0 ? C.overRedDark : C.cream;
  const box: React.CSSProperties = { background: host === "greenLight" ? C.green : C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 10, fontSize: 12 };
  const th: React.CSSProperties = { color: C.faint, fontSize: 11, padding: "4px 10px", textAlign: "center", borderBottom: `1px solid ${C.line}`, fontWeight: 700 };
  const td: React.CSSProperties = { padding: "4px 10px", textAlign: "center", borderBottom: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums", fontSize: 12 };
  const mine: React.CSSProperties = { background: C.cellChip };
  const glyphColor = basis === "opponent" ? C.basisOpponent : C.basisCourse;
  const dash = <span style={{ color: C.faint }}>–</span>;
  // the scorecard's glyph for this basis, up to three — the same shape and colour as on the card
  const g = (v: number | null, strokes: number) => v == null ? dash : <span style={{ display: "inline-flex", alignItems: "center", gap: 1 }}>{v}{Array.from({ length: Math.min(strokes, 3) }).map((_, i) => strokeGlyph(basis, glyphColor, false, i))}</span>;
  const out = (i: number) => h.rows.slice(0, i).reduce((acc, r) => ({ ag: acc.ag + (r.aGross || 0), an: acc.an + (r.aNet || 0), bg: acc.bg + (r.bGross || 0), bn: acc.bn + (r.bNet || 0) }), { ag: 0, an: 0, bg: 0, bn: 0 });
  const nine = holes.length === 18 ? out(9) : null;
  return (
    <div data-h2h-card style={{ marginTop: 10 }}>
      {onBack && <button type="button" data-h2h-back onClick={onBack} style={{ ...btn(false), fontSize: 12 }}>{backLabel}</button>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: onBack ? 8 : 0 }}>
        <div>
          <div style={{ color: C.cream, fontSize: 20, fontWeight: 800 }}>{a.name} v {b.name}</div>
          {stakes && <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{stakes}</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div data-h2h-state style={{ color, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800 }}>{label}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>{h.status.thru === 0 ? "" : h.status.decided ? `final · thru ${h.status.thru}` : `thru ${h.status.thru} · ${h.needed.remaining} to play`}</div>
        </div>
      </div>
      {(needed.mine || needed.theirs) && (
        <div data-h2h-needed style={{ ...box, display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span><b style={{ color: C.cream }}>{aIsViewer ? "To win: " : `${a.name}: `}</b><span style={{ color: C.cream }}>{needed.mine}</span></span>
          <span style={{ color: C.sage, textAlign: "right" }}>{needed.theirs}</span>
        </div>
      )}
      <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 }}>MATCH PROGRESSION</div>
      <div style={{ background: C.card, color: C.ink, borderRadius: 12, padding: "8px 12px", marginTop: 6 }}>
        <HScroll>
        <table style={{ width: "100%", minWidth: 330, borderCollapse: "collapse" }}>
          <thead><tr>
            <th style={{ ...th, textAlign: "left" }}>Hole</th>
            <th style={{ ...th, ...(aIsViewer ? mine : {}) }}>{a.name}<br />gross</th><th style={{ ...th, ...(aIsViewer ? mine : {}) }}>net</th>
            <th style={th}>{b.name}<br />gross</th><th style={th}>net</th>
            <th style={th}>Hole</th><th style={th}>Match</th>
          </tr></thead>
          <tbody>
            {h.rows.map((r, i) => (
              <React.Fragment key={r.hole}>
                <tr data-h2h-row={r.hole}>
                  <td style={{ ...td, textAlign: "left", color: C.faint, fontSize: 11, whiteSpace: "nowrap" }}><b style={{ color: C.ink, fontSize: 12 }}>{r.hole}</b> · {r.par}{r.si != null ? ` · ${r.si}` : ""}</td>
                  <td style={{ ...td, ...(aIsViewer ? mine : {}) }}>{g(r.aGross, r.aStrokes)}</td><td style={{ ...td, ...(aIsViewer ? mine : {}), fontWeight: 700 }}>{r.aNet ?? dash}</td>
                  <td style={td}>{g(r.bGross, r.bStrokes)}</td><td style={{ ...td, fontWeight: 700 }}>{r.bNet ?? dash}</td>
                  {/* won = green, lost = ink (never the scorecard's under-par red), halved = faint */}
                  <td style={{ ...td, fontWeight: 800, color: r.result === "a" ? C.green : r.result === "b" ? C.ink : C.faint }}>{r.result === "a" ? "W" : r.result === "b" ? "L" : r.result === "half" ? "½" : ""}</td>
                  <td style={{ ...td, fontWeight: 800, whiteSpace: "nowrap", color: r.lead == null ? C.faint : r.lead > 0 ? C.green : C.ink }}>{runningLabel(r.lead)}</td>
                </tr>
                {nine && i === 8 && (
                  <tr data-h2h-out><td style={{ ...td, textAlign: "left", fontWeight: 800, background: C.cellChip }}>Out</td>
                    <td style={{ ...td, fontWeight: 800, background: C.cellChip }}>{nine.ag || ""}</td><td style={{ ...td, fontWeight: 800, background: C.cellChip }}>{nine.an || ""}</td>
                    <td style={{ ...td, fontWeight: 800, background: C.cellChip }}>{nine.bg || ""}</td><td style={{ ...td, fontWeight: 800, background: C.cellChip }}>{nine.bn || ""}</td>
                    <td style={{ ...td, background: C.cellChip }} /><td style={{ ...td, fontWeight: 800, background: C.cellChip }}>{runningLabel(h.rows[8].lead)}</td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </HScroll>
      </div>
      {(h.strokesToCome.a.length || h.strokesToCome.b.length || h.swing.aBest || h.swing.bBest) ? (
        <div data-h2h-extras style={{ ...box, lineHeight: 1.6 }}>
          {(h.strokesToCome.a.length || h.strokesToCome.b.length) ? (
            <div><b style={{ color: C.cream }}>Strokes to come</b> <span style={{ color: C.sage }}>· {a.name}: {h.strokesToCome.a.join(", ") || "none"} · {b.name}: {h.strokesToCome.b.join(", ") || "none"}</span></div>
          ) : null}
          {(h.swing.aBest || h.swing.bBest) ? (
            <div><b style={{ color: C.cream }}>The swing</b> <span style={{ color: C.sage }}>· {[h.swing.aBest ? `${a.name}'s best ${h.swing.aBest.lead} up (after ${h.swing.aBest.after})` : null, h.swing.bBest ? `${b.name}'s best ${h.swing.bBest.lead} up (after ${h.swing.bBest.after})` : null].filter(Boolean).join(" · ")}</span></div>
          ) : null}
        </div>
      ) : null}
      <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>Net scores drive the running match position. {basis === "opponent" ? "Triangles are strokes off your opponent" : "Circles are each player's own strokes"}; "Hole" is who won it on net, "Match" the state after it.</div>
    </div>
  );
}
