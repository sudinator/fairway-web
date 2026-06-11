"use client";

import React from "react";
import {
  C, Hole, Round, stablefordPts,
} from "@/lib/golf";

export const btn = (primary?: boolean): React.CSSProperties => ({
  background: primary ? C.gold : C.greenLight, color: primary ? C.green : C.cream,
  border: "none", borderRadius: 10, padding: "11px 20px", fontSize: 14, fontWeight: 800, cursor: "pointer",
});

export const inputStyle: React.CSSProperties = {
  background: C.card, border: `1px solid ${C.line}`, borderRadius: 10,
  padding: "10px 13px", fontSize: 16, color: C.ink, width: "100%", boxSizing: "border-box",
};

export const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 700 }}>{children}</div>
);

export function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: "14px 16px", flex: 1, minWidth: 118 }}>
      <div style={{ color: C.cream, fontSize: 26, fontWeight: 800, fontFamily: "Georgia, serif" }}>{value}</div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{label}</div>
      {sub ? <div style={{ color: C.sage, fontSize: 11, opacity: 0.7, marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export function ScoreMark({ hole }: { hole: Hole }) {
  if (!hole.strokes) return <span style={{ color: C.line }}>·</span>;
  const d = hole.strokes - hole.par;
  const base: React.CSSProperties = { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, fontWeight: 700, fontSize: 13 };
  if (d <= -1) return <span style={{ ...base, border: `1.5px solid ${C.birdie}`, borderRadius: "50%", color: C.birdie }}>{hole.strokes}</span>;
  if (d >= 1) return <span style={{ ...base, border: `1.5px solid ${C.bogey}`, borderRadius: 4, color: C.bogey }}>{hole.strokes}</span>;
  return <span style={{ ...base, color: C.ink }}>{hole.strokes}</span>;
}

const cardTd = (head?: boolean): React.CSSProperties => ({
  border: `1px solid ${C.line}`, textAlign: "center", padding: "5px 4px",
  fontSize: head ? 10 : 13, color: head ? C.faint : C.ink,
  fontWeight: head ? 700 : 400, letterSpacing: head ? 1 : 0, minWidth: 32,
});

export function ClassicCard({ round }: { round: Round }) {
  const nines = [round.holes.slice(0, 9), round.holes.slice(9, 18)].filter((n) => n.length);
  return (
    <div style={{ background: C.cream, borderRadius: 12, padding: 16, overflowX: "auto" }}>
      {nines.map((nine, ni) => {
        const start = ni * 9;
        const par = nine.reduce((s, h) => s + h.par, 0);
        const str = nine.reduce((s, h) => s + (h.strokes || 0), 0);
        const pts = nine.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
        return (
          <table key={ni} style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}>
            <tbody>
              <tr>
                <td style={cardTd(true)}>{ni === 0 ? "OUT" : "IN"}</td>
                {nine.map((_, i) => <td key={i} style={cardTd(true)}>{start + i + 1}</td>)}
                <td style={cardTd(true)}>TOT</td>
              </tr>
              <tr>
                <td style={cardTd()}>Par</td>
                {nine.map((h, i) => <td key={i} style={cardTd()}>{h.par}</td>)}
                <td style={{ ...cardTd(), fontWeight: 700 }}>{par}</td>
              </tr>
              <tr>
                <td style={cardTd()}>S.I.</td>
                {nine.map((h, i) => <td key={i} style={{ ...cardTd(), color: C.faint, fontSize: 11 }}>{h.stroke_index ?? "–"}</td>)}
                <td style={cardTd()} />
              </tr>
              <tr>
                <td style={cardTd()}>Score</td>
                {nine.map((h, i) => <td key={i} style={{ ...cardTd(), padding: 2 }}><ScoreMark hole={h} /></td>)}
                <td style={{ ...cardTd(), fontWeight: 800 }}>{str || "—"}</td>
              </tr>
              <tr>
                <td style={cardTd()}>Pts</td>
                {nine.map((h, i) => {
                  const p = stablefordPts(h.strokes, h.par, h.recv || 0);
                  return <td key={i} style={{ ...cardTd(), color: (p ?? 0) >= 3 ? C.birdie : p === 0 ? C.faint : C.ink, fontWeight: 700 }}>{p ?? "·"}</td>;
                })}
                <td style={{ ...cardTd(), fontWeight: 800, color: C.green }}>{pts || "—"}</td>
              </tr>
            </tbody>
          </table>
        );
      })}
      <div style={{ display: "flex", gap: 16, justifyContent: "center", fontSize: 11, color: C.faint, flexWrap: "wrap" }}>
        <span><span style={{ display: "inline-block", width: 12, height: 12, border: `1.5px solid ${C.birdie}`, borderRadius: "50%", verticalAlign: -2, marginRight: 5 }} />under par</span>
        <span><span style={{ display: "inline-block", width: 12, height: 12, border: `1.5px solid ${C.bogey}`, borderRadius: 3, verticalAlign: -2, marginRight: 5 }} />over par</span>
        <span>Pts = Stableford (net, off {round.course_handicap ?? 0} course handicap)</span>
      </div>
    </div>
  );
}

// A compact numeric dropdown for score entry on mobile (tap instead of type).
// `from`/`to` set the range; `dash` shows a blank "–" option for "not entered".
export function NumPicker({ value, from, to, onChange, width = 46, dash = true, accent }: {
  value: number | null; from: number; to: number;
  onChange: (v: number | null) => void; width?: number; dash?: boolean; accent?: boolean;
}) {
  const opts: number[] = [];
  for (let n = from; n <= to; n++) opts.push(n);
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : parseInt(e.target.value, 10))}
      style={{
        background: accent ? C.cream : C.card, border: `1px solid ${C.line}`, borderRadius: 8,
        padding: "6px 2px", fontSize: 15, color: C.ink, width, textAlign: "center", textAlignLast: "center",
      } as React.CSSProperties}
    >
      {dash && <option value="">–</option>}
      {opts.map((n) => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
