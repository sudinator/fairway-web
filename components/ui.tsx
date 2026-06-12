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
        const putts = nine.reduce((s, h) => s + (h.putts || 0), 0);
        const hasPutts = nine.some((h) => h.putts != null);
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
              {hasPutts && (
                <tr>
                  <td style={cardTd()}>Putts</td>
                  {nine.map((h, i) => <td key={i} style={{ ...cardTd(), color: C.faint }}>{h.putts ?? "·"}</td>)}
                  <td style={{ ...cardTd(), fontWeight: 700 }}>{putts || "—"}</td>
                </tr>
              )}
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
      {round.holes.length > 9 && (() => {
        const out = round.holes.slice(0, 9).reduce((s, h) => s + (h.strokes || 0), 0);
        const inn = round.holes.slice(9, 18).reduce((s, h) => s + (h.strokes || 0), 0);
        if (!out && !inn) return null;
        return (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 12, flexWrap: "wrap" }}>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 16px", textAlign: "center" }}>
              <div style={{ color: C.faint, fontSize: 10, letterSpacing: 2 }}>OUT</div>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 18 }}>{out || "–"}</div>
            </div>
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 16px", textAlign: "center" }}>
              <div style={{ color: C.faint, fontSize: 10, letterSpacing: 2 }}>IN</div>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 18 }}>{inn || "–"}</div>
            </div>
            <div style={{ background: C.green, borderRadius: 8, padding: "6px 16px", textAlign: "center" }}>
              <div style={{ color: C.cream, fontSize: 10, letterSpacing: 2 }}>TOTAL</div>
              <div style={{ color: "#fff", fontWeight: 800, fontSize: 18 }}>{out + inn || "–"}</div>
            </div>
          </div>
        );
      })()}
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

// ---------------- Shared vertical scorecards ----------------
// A single per-hole row model used by every entry scorecard (individual & group).
export type EntryHole = {
  n: number; par: number; si: number | null;
  strokes: number | null; putts: number | null; fairway: "hit" | "miss" | null;
  recv: number; // handicap strokes received on this hole
};

// SCORE ENTRY — vertical, one row per hole, fits screen width (no horizontal scroll).
// Used by both individual stroke play and group play so the card is identical everywhere.
export function ScoreEntryCard({ holes, hasHandicap, onSet, savingHole, showFairway = true, showPutts = true }: {
  holes: EntryHole[];
  hasHandicap: boolean;
  onSet: (i: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | null }) => void;
  savingHole?: number | null;
  showFairway?: boolean;
  showPutts?: boolean;
}) {
  const cycleFw = (i: number, cur: "hit" | "miss" | null, par: number) => {
    if (par < 4) return;
    onSet(i, { fairway: cur == null ? "hit" : cur === "hit" ? "miss" : null });
  };
  const anyStroke = holes.some((h) => h.recv > 0);

  const block = (from: number, to: number, label: string) => {
    const seg = holes.slice(from, to);
    if (seg.length === 0) return null;
    const sPar = seg.reduce((s, h) => s + (h.par || 0), 0);
    const sScore = seg.reduce((s, h) => s + (h.strokes || 0), 0);
    const sPutts = seg.reduce((s, h) => s + (h.putts || 0), 0);
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: 10, flex: 1, minWidth: 280 }}>
        <div style={{ color: C.faint, fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 2px 5px", color: C.faint, fontSize: 9, letterSpacing: 1, borderBottom: `1px solid ${C.line}` }}>
          <div style={{ width: 52 }}>HOLE</div>
          <div style={{ width: 28, textAlign: "center" }}>PAR</div>
          <div style={{ flex: 1, textAlign: "center" }}>SCORE</div>
          {showPutts && <div style={{ width: 50, textAlign: "center" }}>PUTTS</div>}
          {showFairway && <div style={{ width: 30, textAlign: "center" }}>FW</div>}
        </div>
        {seg.map((h, j) => {
          const i = from + j;
          const maxStrokes = hasHandicap ? h.par + 2 + h.recv : h.par * 2;
          // Putts can't exceed the strokes taken on the hole.
          const maxPutts = h.strokes != null && h.strokes > 0 ? Math.min(h.strokes, 6) : 6;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 2px", borderBottom: `1px solid ${C.line}` }}>
              <div style={{ width: 52 }}>
                <span style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.n}</span>
                {h.recv > 0 && <span title={`${h.recv} stroke(s)`} style={{ color: C.gold, fontWeight: 700, fontSize: 11, marginLeft: 3 }}>{"•".repeat(Math.min(h.recv, 3))}</span>}
                <div style={{ color: C.faint, fontSize: 9 }}>S.I. {h.si ?? "–"}</div>
              </div>
              <div style={{ width: 28, textAlign: "center", color: C.sage, fontSize: 14 }}>{h.par}</div>
              <div style={{ flex: 1, textAlign: "center" }}>
                <NumPicker value={h.strokes} from={1} to={maxStrokes} onChange={(v) => onSet(i, { strokes: v })} width={52} accent={savingHole === i} />
              </div>
              {showPutts && (
                <div style={{ width: 50, textAlign: "center" }}>
                  <NumPicker value={h.putts} from={0} to={maxPutts} onChange={(v) => onSet(i, { putts: v })} width={46} />
                </div>
              )}
              {showFairway && (
                <div style={{ width: 30, textAlign: "center" }}>
                  <button onClick={() => cycleFw(i, h.fairway, h.par)} disabled={h.par < 4}
                    style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 30, height: 30, cursor: h.par < 4 ? "default" : "pointer",
                      background: h.fairway === "hit" ? "#DDF0DF" : h.fairway === "miss" ? "#F6DEDB" : C.card,
                      color: h.fairway === "hit" ? C.greenMid : h.fairway === "miss" ? C.birdie : C.faint, fontWeight: 800, fontSize: 14 }}>
                    {h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "miss" ? "✗" : "·"}
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 2px 0", fontWeight: 800 }}>
          <div style={{ width: 52, color: C.gold, fontSize: 12 }}>{from === 0 ? "OUT" : "IN"}</div>
          <div style={{ width: 28, textAlign: "center", color: C.ink, fontSize: 13 }}>{sPar}</div>
          <div style={{ flex: 1, textAlign: "center", color: C.green, fontSize: 15 }}>{sScore || "–"}</div>
          {showPutts && <div style={{ width: 50, textAlign: "center", color: C.faint, fontSize: 13 }}>{sPutts || "–"}</div>}
          {showFairway && <div style={{ width: 30 }} />}
        </div>
      </div>
    );
  };

  const out = holes.slice(0, 9).reduce((s, h) => s + (h.strokes || 0), 0);
  const inn = holes.slice(9, 18).reduce((s, h) => s + (h.strokes || 0), 0);
  const has18 = holes.length > 9;

  return (
    <>
      {anyStroke && hasHandicap && (
        <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>• dots show the handicap strokes you receive on that hole.</div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        {block(0, Math.min(9, holes.length), "FRONT NINE")}
        {has18 && block(9, 18, "BACK NINE")}
      </div>
      {has18 && (out > 0 || inn > 0) && (
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
          <div style={{ background: C.card, borderRadius: 10, padding: "8px 18px", textAlign: "center" }}>
            <div style={{ color: C.sage, fontSize: 10, letterSpacing: 2 }}>OUT</div>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{out || "–"}</div>
          </div>
          <div style={{ background: C.card, borderRadius: 10, padding: "8px 18px", textAlign: "center" }}>
            <div style={{ color: C.sage, fontSize: 10, letterSpacing: 2 }}>IN</div>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{inn || "–"}</div>
          </div>
          <div style={{ background: C.green, borderRadius: 10, padding: "8px 18px", textAlign: "center" }}>
            <div style={{ color: C.cream, fontSize: 10, letterSpacing: 2 }}>TOTAL</div>
            <div style={{ color: "#fff", fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{out + inn || "–"}</div>
          </div>
        </div>
      )}
    </>
  );
}

// READ-ONLY VIEW — vertical scorecard for a completed round. Fits screen width.
export function ScoreViewCard({ round }: { round: Round }) {
  const hasPutts = round.holes.some((h) => h.putts != null);
  const hasPens = round.holes.some((h) => (h.penalties || 0) > 0);
  const hasDots = round.holes.some((h) => (h.recv || 0) > 0);
  const hasFw = round.holes.some((h) => h.fairway === "hit" || h.fairway === "miss");

  const headStyle: React.CSSProperties = { color: C.faint, fontSize: 9, letterSpacing: 0.5, fontWeight: 700, textTransform: "uppercase" };

  const block = (from: number, to: number, label: string) => {
    const seg = round.holes.slice(from, to);
    if (seg.length === 0) return null;
    const sPar = seg.reduce((s, h) => s + h.par, 0);
    const sStr = seg.reduce((s, h) => s + (h.strokes || 0), 0);
    const sPutts = seg.reduce((s, h) => s + (h.putts || 0), 0);
    const sPen = seg.reduce((s, h) => s + (h.penalties || 0), 0);
    const sPts = seg.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    const fwElig = seg.filter((h) => h.par >= 4 && (h.fairway === "hit" || h.fairway === "miss")).length;
    const fwHit = seg.filter((h) => h.par >= 4 && h.fairway === "hit").length;
    const Row = (cells: React.ReactNode[], opts?: { header?: boolean; foot?: boolean }) => (
      <div style={{
        display: "grid",
        gridTemplateColumns: `34px 30px 30px${hasDots ? " 34px" : ""} 1fr${hasFw ? " 30px" : ""}${hasPutts ? " 38px" : ""}${hasPens ? " 30px" : ""} 34px`,
        alignItems: "center", gap: 4,
        padding: opts?.header ? "0 4px 6px" : "6px 4px",
        borderBottom: opts?.header ? `1px solid ${C.line}` : opts?.foot ? "none" : `1px solid ${C.line}`,
        borderTop: opts?.foot ? `2px solid ${C.greenMid}` : "none",
        marginTop: opts?.foot ? 4 : 0,
      }}>
        {cells}
      </div>
    );
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: 12, flex: 1, minWidth: 300 }}>
        <div style={{ color: C.green, fontSize: 11, letterSpacing: 2, fontWeight: 800, marginBottom: 8 }}>{label}</div>
        {Row([
          <div key="h" style={headStyle}>Hole</div>,
          <div key="p" style={{ ...headStyle, textAlign: "center" }}>Par</div>,
          <div key="si" style={{ ...headStyle, textAlign: "center" }}>S.I.</div>,
          ...(hasDots ? [<div key="d" style={{ ...headStyle, textAlign: "center" }}>Hcp</div>] : []),
          <div key="sc" style={{ ...headStyle, textAlign: "center" }}>Score</div>,
          ...(hasFw ? [<div key="fw" style={{ ...headStyle, textAlign: "center" }}>FW</div>] : []),
          ...(hasPutts ? [<div key="pu" style={{ ...headStyle, textAlign: "center" }}>Putt</div>] : []),
          ...(hasPens ? [<div key="pe" style={{ ...headStyle, textAlign: "center" }}>Pen</div>] : []),
          <div key="pt" style={{ ...headStyle, textAlign: "center" }}>Pts</div>,
        ], { header: true })}
        {seg.map((h, j) => {
          const recv = h.recv || 0;
          const pts = stablefordPts(h.strokes, h.par, h.recv || 0);
          return Row([
            <div key="h" style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.hole_number}</div>,
            <div key="p" style={{ textAlign: "center", color: C.sage, fontSize: 14 }}>{h.par}</div>,
            <div key="si" style={{ textAlign: "center", color: C.faint, fontSize: 12 }}>{h.stroke_index ?? "–"}</div>,
            ...(hasDots ? [<div key="d" style={{ textAlign: "center", color: C.gold, fontWeight: 700, fontSize: 13, letterSpacing: 1 }}>{recv > 0 ? "•".repeat(Math.min(recv, 3)) : ""}</div>] : []),
            <div key="sc" style={{ textAlign: "center" }}><ScoreMark hole={h} /></div>,
            ...(hasFw ? [<div key="fw" style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: h.fairway === "hit" ? C.greenMid : h.fairway === "miss" ? C.birdie : C.faint }}>{h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "miss" ? "✗" : "·"}</div>] : []),
            ...(hasPutts ? [<div key="pu" style={{ textAlign: "center", color: C.faint, fontSize: 13 }}>{h.putts ?? "·"}</div>] : []),
            ...(hasPens ? [<div key="pe" style={{ textAlign: "center", color: (h.penalties || 0) > 0 ? C.birdie : C.faint, fontSize: 13 }}>{h.penalties || "·"}</div>] : []),
            <div key="pt" style={{ textAlign: "center", color: C.green, fontWeight: 800, fontSize: 14 }}>{pts ?? "·"}</div>,
          ]);
        })}
        {Row([
          <div key="h" style={{ color: C.gold, fontWeight: 800, fontSize: 12 }}>{from === 0 ? "OUT" : "IN"}</div>,
          <div key="p" style={{ textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 13 }}>{sPar}</div>,
          <div key="si" />,
          ...(hasDots ? [<div key="d" />] : []),
          <div key="sc" style={{ textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 15 }}>{sStr || "—"}</div>,
          ...(hasFw ? [<div key="fw" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 11 }}>{fwElig ? `${fwHit}/${fwElig}` : "—"}</div>] : []),
          ...(hasPutts ? [<div key="pu" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 13 }}>{sPutts || "—"}</div>] : []),
          ...(hasPens ? [<div key="pe" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 13 }}>{sPen || "—"}</div>] : []),
          <div key="pt" style={{ textAlign: "center", color: C.green, fontWeight: 800, fontSize: 14 }}>{sPts}</div>,
        ], { foot: true })}
      </div>
    );
  };

  const out = round.holes.slice(0, 9).reduce((s, h) => s + (h.strokes || 0), 0);
  const inn = round.holes.slice(9, 18).reduce((s, h) => s + (h.strokes || 0), 0);
  const has18 = round.holes.length > 9;
  const summaryBox = (label: string, val: number, primary?: boolean) => (
    <div style={{ background: primary ? C.gold : C.card, borderRadius: 10, padding: "8px 20px", textAlign: "center", minWidth: 70 }}>
      <div style={{ color: primary ? "#3B2A00" : C.faint, fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>{label}</div>
      <div style={{ color: primary ? "#3B2A00" : C.ink, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{val || "–"}</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {block(0, Math.min(9, round.holes.length), "FRONT NINE")}
        {has18 && block(9, 18, "BACK NINE")}
      </div>
      {has18 && (out > 0 || inn > 0) && (
        <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap", justifyContent: "center" }}>
          {summaryBox("OUT", out)}
          {summaryBox("IN", inn)}
          {summaryBox("TOTAL", out + inn, true)}
        </div>
      )}
    </div>
  );
}
