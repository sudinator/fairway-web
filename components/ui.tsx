"use client";

import React, { useState } from "react";
import {
  C, Hole, Round, stablefordPts, ptsColor,
} from "@/lib/golf";

// Player avatar: circular photo when one exists, otherwise a colored circle with
// the player's initials so the layout is always consistent (never a broken image).
const initialsOf = (name: string) =>
  (name || "?")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || "")
    .join("") || "?";

// A stable, pleasant color derived from the name when no team accent is supplied.
const AVATAR_PALETTE = ["#16503D", "#5A7BC0", "#B05B5B", "#4FB8A8", "#C9A227", "#7A5BB0", "#C77B3A"];
const colorFor = (name: string) => {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
};

export function Avatar({ src, name, size = 32, accent, enlargeable = true, cssSize }: {
  src?: string | null; name: string; size?: number; accent?: string | null; enlargeable?: boolean;
  cssSize?: string; // responsive width (e.g. "min(65px, 90%)"); overrides fixed `size`
}) {
  const [open, setOpen] = useState(false);
  const ring = accent || "transparent";
  const common: React.CSSProperties = cssSize
    ? { width: cssSize, aspectRatio: "1 / 1", borderRadius: "50%", flexShrink: 0, boxShadow: accent ? `0 0 0 2px ${ring}` : "none" }
    : { width: size, height: size, borderRadius: "50%", flexShrink: 0, boxShadow: accent ? `0 0 0 2px ${ring}` : "none" };
  const initialsFont = cssSize ? 22 : Math.max(10, Math.round(size * 0.4));

  // Only real photos are tappable-to-enlarge (no point zooming an initials circle).
  const canEnlarge = !!src && enlargeable;

  const lightbox = open ? (
    <div
      onClick={(e) => { e.stopPropagation(); setOpen(false); }}
      style={{
        position: "fixed", inset: 0, background: "rgba(8,20,15,0.93)", zIndex: 1000,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer",
      }}
    >
      <img
        src={src!}
        alt={name}
        referrerPolicy="no-referrer"
        style={{ width: "min(80vw, 360px)", height: "min(80vw, 360px)", borderRadius: 24, objectFit: "cover", boxShadow: "0 12px 44px rgba(0,0,0,0.5)" }}
      />
      <div style={{ color: C.cream, fontSize: 18, fontWeight: 700, marginTop: 16 }}>{name}</div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>tap anywhere to close</div>
    </div>
  ) : null;

  const node = src ? (
    <img
      src={src}
      alt={name}
      style={{ ...common, objectFit: "cover", background: C.greenMid, cursor: canEnlarge ? "pointer" : "default" }}
      referrerPolicy="no-referrer"
      onClick={canEnlarge ? (e) => { e.stopPropagation(); setOpen(true); } : undefined}
    />
  ) : (
    <div
      style={{
        ...common,
        background: accent || colorFor(name),
        color: "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: initialsFont,
        fontFamily: "system-ui, sans-serif",
      }}
      aria-label={name}
    >
      {initialsOf(name)}
    </div>
  );

  return (<>{node}{lightbox}</>);
}

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

// Compact date field: shows a short M/D/YY date in the page font (so it matches
// every other input) with a real native date picker layered transparently on top.
export function ShortDateInput({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  const fmt = (iso: string) => {
    if (!iso) return "Pick date";
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    return `${m}/${d}/${String(y).slice(2)}`;
  };
  return (
    <div style={{ position: "relative", display: "flex", width: "fit-content", marginTop: 6 }}>
      <div style={{ ...inputStyle, width: 116, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ color: value ? C.ink : C.faint }}>{fmt(value)}</span>
        <span aria-hidden style={{ color: C.sage, fontSize: 12 }}>▾</span>
      </div>
      <input aria-label="Pick date" type="date" value={value} max={max} onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, border: "none", padding: 0, margin: 0, cursor: "pointer", background: "transparent" }} />
    </div>
  );
}

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
  // Double-ring marks use REAL nested borders (not box-shadow) so they survive PNG
  // export — html-to-image does not rasterize box-shadow. Outer span = outer ring +
  // gap (shows the card behind it), inner span = inner ring + number. Footprint stays 26x26.
  const doubleRing = (color: string, shape: "circle" | "square", fill?: string) => {
    const ri = shape === "circle" ? "50%" : 4;
    const ro = shape === "circle" ? "50%" : 6;
    return (
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, border: `1.5px solid ${color}`, borderRadius: ro, padding: 1.5, boxSizing: "border-box" }}>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "100%", height: "100%", border: `1.5px solid ${color}`, borderRadius: ri, color, fontWeight: 700, fontSize: 12, background: fill || "transparent" }}>{hole.strokes}</span>
      </span>
    );
  };
  // Birdie or better: circle (eagle gets a double circle).
  if (d <= -2) return doubleRing(C.birdie, "circle");
  if (d === -1) return <span style={{ ...base, border: `1.5px solid ${C.birdie}`, borderRadius: "50%", color: C.birdie }}>{hole.strokes}</span>;
  // Double bogey or worse: double square; triple+ (d>=3) adds a translucent blue fill.
  if (d >= 3) return doubleRing(C.bogey, "square", "rgba(46,90,184,0.22)");
  if (d === 2) return doubleRing(C.bogey, "square");
  if (d === 1) return <span style={{ ...base, border: `1.5px solid ${C.bogey}`, borderRadius: 4, color: C.bogey }}>{hole.strokes}</span>;
  return <span style={{ ...base, color: C.ink }}>{hole.strokes}</span>;
}

const cardTd = (head?: boolean): React.CSSProperties => ({
  border: `1px solid ${C.line}`, textAlign: "center", padding: "5px 4px",
  fontSize: head ? 10 : 13, color: head ? C.faint : C.ink,
  fontWeight: head ? 700 : 400, letterSpacing: head ? 1 : 0, minWidth: 32,
});

export function NumPicker({ value, from, to, onChange, width = 46, dash = true, accent }: {
  value: number | null; from: number; to: number;
  onChange: (v: number | null) => void; width?: number; dash?: boolean; accent?: boolean;
}) {
  const opts: number[] = [];
  for (let n = from; n <= to; n++) opts.push(n);
  // Always include the current value as an option, even if it falls outside
  // from..to. A controlled <select> renders BLANK when its value has no matching
  // <option> (and WebKit is especially fussy on resume), so this guarantees the
  // saved score is always displayable.
  if (value != null && !opts.includes(value)) {
    opts.push(value);
    opts.sort((a, b) => a - b);
  }
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

// FIT-TO-WIDTH — measures its content's natural width and scales it down to fit
// the available width (never up), so a scorecard never runs off-screen. Wrap any
// card that could exceed the viewport in this.
export function FitToWidth({ children }: { children: React.ReactNode }) {
  const outerRef = React.useRef<HTMLDivElement>(null);
  const innerRef = React.useRef<HTMLDivElement>(null);
  const [st, setSt] = React.useState<{ scale: number; width: number | string; height?: number }>({ scale: 1, width: "100%" });
  React.useLayoutEffect(() => {
    const measure = () => {
      const o = outerRef.current, i = innerRef.current;
      if (!o || !i) return;
      const pw = i.style.width, pt = i.style.transform;
      i.style.width = "max-content"; i.style.transform = "none";
      const natural = i.scrollWidth;
      const avail = o.clientWidth;
      i.style.width = pw; i.style.transform = pt;
      const scale = natural > 0 && natural > avail ? avail / natural : 1;
      const width: number | string = scale < 1 ? natural : "100%";
      const height = scale < 1 ? Math.ceil(i.offsetHeight * scale) : undefined;
      setSt((c) => (c.scale === scale && c.width === width && c.height === height ? c : { scale, width, height }));
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") { ro = new ResizeObserver(measure); if (outerRef.current) ro.observe(outerRef.current); }
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, [children]);
  return (
    <div ref={outerRef} style={{ width: "100%", overflow: "hidden", height: st.height }}>
      <div ref={innerRef} style={{ width: st.width, transformOrigin: "top left", transform: st.scale < 1 ? `scale(${st.scale})` : undefined }}>
        {children}
      </div>
    </div>
  );
}

// ---------------- Shared vertical scorecards ----------------
// A single per-hole row model used by every entry scorecard (individual & group).
export type EntryHole = {
  n: number; par: number; si: number | null; yards?: number | null;
  strokes: number | null; putts: number | null; fairway: "hit" | "miss" | "left" | "right" | null;
  penalties?: number | null;
  sand?: boolean | null; // greenside bunker this hole
  recv: number; // handicap strokes received on this hole
  gives?: number; // strokes GIVEN on this hole (match play, lower-handicap player)
};

// SCORE ENTRY — vertical, one row per hole, fits screen width (no horizontal scroll).
// Used by both individual stroke play and group play so the card is identical everywhere.
export function ScoreEntryCard({ holes, hasHandicap, onSet, savingHole, showFairway = true, showPutts = true, showPenalties = true, opp, oppLabel, matchRun, matchMode = false, showSixes = false, strokeSixes = false, uncap = false }: {
  holes: EntryHole[];
  hasHandicap: boolean;
  onSet: (i: number, patch: { strokes?: number | null; putts?: number | null; fairway?: "hit" | "miss" | "left" | "right" | null; penalties?: number | null; sand?: boolean | null }) => void;
  savingHole?: number | null;
  showFairway?: boolean;
  showPutts?: boolean;
  showPenalties?: boolean;
  opp?: (number | null)[];     // optional opponent gross per hole (match play) — read-only column
  oppLabel?: string;           // short opponent name for the column header
  matchRun?: (string | null)[]; // optional per-hole running match status labels (e.g. "1↑", "AS")
  matchMode?: boolean;          // when true (1:1 match), render one card per hole instead of the wide grid
  showSixes?: boolean;          // TGC: show Front/Middle/Last six net-Stableford subtotals at the top
  strokeSixes?: boolean;     // stroke games: show net-score (lowest) subtotals, not Stableford
  uncap?: boolean;              // stroke play: lift the net-double entry ceiling so every stroke counts
}) {
  const showOpp = Array.isArray(opp);
  const showRun = Array.isArray(matchRun);
  // iOS WebKit can paint a controlled <select> blank when its value is set as the
  // screen first renders (e.g. resuming a round). Flipping this flag right after
  // mount forces the dropdowns to re-render so they show their saved value.
  const [hydrated, setHydrated] = React.useState(false);
  const [editPen, setEditPen] = React.useState<number | null>(null); // hole index whose Sand/Pen popup is open
  React.useEffect(() => {
    const r = requestAnimationFrame(() => setHydrated(true));
    return () => cancelAnimationFrame(r);
  }, []);
  const cycleFw = (i: number, cur: "hit" | "miss" | "left" | "right" | null, par: number) => {
    if (par < 4) return;
    onSet(i, { fairway: cur == null ? "hit" : cur === "hit" ? "left" : cur === "left" ? "right" : null });
  };
  const anyStroke = holes.some((h) => h.recv > 0 || (h.gives || 0) > 0);
  const hasDots = anyStroke && hasHandicap;
  const headStyle: React.CSSProperties = { color: C.faint, fontSize: 9, letterSpacing: 0.5, fontWeight: 700, textTransform: "uppercase" };

  const block = (from: number, to: number, label: string) => {
    const seg = holes.slice(from, to);
    if (seg.length === 0) return null;
    const sPar = seg.reduce((s, h) => s + (h.par || 0), 0);
    const sScore = seg.reduce((s, h) => s + (h.strokes || 0), 0);
    const sPutts = seg.reduce((s, h) => s + (h.putts || 0), 0);
    const sPen = seg.reduce((s, h) => s + (h.penalties || 0), 0);
    const sPts = seg.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    const sFwElig = seg.filter((h) => h.par >= 4 && h.fairway != null).length;
    const sFwHit = seg.filter((h) => h.par >= 4 && h.fairway === "hit").length;
    const cols = `26px 24px 24px${showOpp ? " 40px" : ""}${hasDots ? " 28px" : ""} 1fr${showFairway ? " 30px" : ""}${showPutts ? " 54px" : ""}${showPenalties ? " 54px" : ""} 28px${showRun ? " 44px" : ""}`;
    const Row = (cells: React.ReactNode[], opts?: { header?: boolean; foot?: boolean }) => (
      <div style={{
        display: "grid", gridTemplateColumns: cols, alignItems: "center", gap: 4,
        padding: opts?.header ? "0 2px 6px" : "5px 2px",
        borderBottom: opts?.foot ? "none" : `1px solid ${C.line}`,
        borderTop: opts?.foot ? `2px solid ${C.greenMid}` : "none",
        marginTop: opts?.foot ? 4 : 0,
      }}>{cells}</div>
    );
    return (
      <div style={{ background: C.card, borderRadius: 12, padding: 10, flex: 1, minWidth: 300 }}>
        <div style={{ color: C.green, fontSize: 11, letterSpacing: 2, fontWeight: 800, marginBottom: 8 }}>{label}</div>
        {Row([
          <div key="h" style={headStyle}>Hole</div>,
          <div key="p" style={{ ...headStyle, textAlign: "center" }}>Par</div>,
          <div key="si" style={{ ...headStyle, textAlign: "center" }}>S.I.</div>,
          ...(showOpp ? [<div key="op" style={{ ...headStyle, textAlign: "center", color: C.gold }}>{oppLabel || "Opp"}</div>] : []),
          ...(hasDots ? [<div key="d" style={{ ...headStyle, textAlign: "center" }}>Hcp</div>] : []),
          <div key="sc" style={{ ...headStyle, textAlign: "center" }}>Score</div>,
          ...(showFairway ? [<div key="fw" style={{ ...headStyle, textAlign: "center" }}>FW</div>] : []),
          ...(showPutts ? [<div key="pu" style={{ ...headStyle, textAlign: "center" }}>Putt</div>] : []),
          ...(showPenalties ? [<div key="pe" style={{ ...headStyle, textAlign: "center" }}>Sand/Pen</div>] : []),
          <div key="pt" style={{ ...headStyle, textAlign: "center" }}>Pts</div>,
          ...(showRun ? [<div key="ms" style={{ ...headStyle, textAlign: "center", color: C.gold }}>Match</div>] : []),
        ], { header: true })}
        {seg.map((h, j) => {
          const i = from + j;
          const maxStrokes = uncap ? h.par + 8 : hasHandicap ? h.par + 2 + h.recv : h.par * 2;
          const maxPutts = h.strokes != null && h.strokes > 0 ? Math.min(h.strokes, 6) : 6;
          const pts = stablefordPts(h.strokes, h.par, h.recv || 0);
          return Row([
            <div key="h" style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.n}</div>,
            <div key="p" style={{ textAlign: "center", color: C.parBlue, fontWeight: 700, fontSize: 14 }}>{h.par}</div>,
            <div key="si" style={{ textAlign: "center", color: C.faint, fontSize: 12 }}>{h.si ?? "–"}</div>,
            ...(showOpp ? [(() => {
              const ov = opp![i] ?? null;
              const mine = h.strokes;
              const col = ov == null || mine == null ? C.faint : ov < mine ? C.birdie : ov > mine ? C.greenMid : C.ink;
              return <div key="op" style={{ textAlign: "center", color: col, fontWeight: 800, fontSize: 15 }}>{ov ?? "·"}</div>;
            })()] : []),
            ...(hasDots ? [<div key="d" style={{ textAlign: "center", color: (h.gives || 0) > 0 ? C.sage : C.dot, fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>{h.recv > 0 ? "•".repeat(Math.min(h.recv, 3)) : ((h.gives || 0) > 0 ? "◦".repeat(Math.min(h.gives || 0, 3)) : "")}</div>] : []),
            <div key="sc" style={{ textAlign: "center" }}>
              <NumPicker key={`sc-${hydrated}`} value={h.strokes} from={1} to={maxStrokes} onChange={(v) => onSet(i, { strokes: v })} width={48} accent={savingHole === i} />
            </div>,
            ...(showFairway ? [
              <div key="fw" style={{ textAlign: "center" }}>
                <button onClick={() => cycleFw(i, h.fairway, h.par)} disabled={h.par < 4}
                  style={{ border: `1px solid ${C.line}`, borderRadius: 6, width: 28, height: 30, cursor: h.par < 4 ? "default" : "pointer",
                    background: h.fairway === "hit" ? "#C7E6D1" : (h.fairway === "left" || h.fairway === "right" || h.fairway === "miss") ? "#F2CFCB" : C.card,
                    color: h.fairway === "hit" ? "#0F5436" : (h.fairway === "left" || h.fairway === "right" || h.fairway === "miss") ? C.birdie : C.faint, fontWeight: 800, fontSize: 13 }}>
                  {h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "left" ? "L" : h.fairway === "right" ? "R" : h.fairway === "miss" ? "✗" : "·"}
                </button>
              </div>,
            ] : []),
            ...(showPutts ? [
              <div key="pu" style={{ textAlign: "center" }}>
                <NumPicker key={`pu-${hydrated}`} value={h.putts} from={0} to={maxPutts} onChange={(v) => onSet(i, { putts: v })} width={48} />
              </div>,
            ] : []),
            ...(showPenalties ? [(() => {
              const penN = h.penalties || 0;
              const sandOn = !!h.sand;
              const disp = sandOn && penN > 0 ? "*" : sandOn ? "S" : penN > 0 ? String(penN) : "·";
              const active = sandOn || penN > 0;
              return (
                <div key="pe" style={{ textAlign: "center" }}>
                  <button onClick={() => setEditPen(i)}
                    style={{ border: `1px solid ${active ? C.birdie : C.line}`, borderRadius: 6, width: 44, height: 30, cursor: "pointer",
                      background: active ? "#F6DEDB" : C.card, color: active ? C.birdie : C.faint, fontWeight: 800, fontSize: disp === "*" ? 18 : 15 }}>
                    {disp}
                  </button>
                </div>
              );
            })()] : []),
            <div key="pt" style={{ textAlign: "center", color: ptsColor(pts), fontWeight: 800, fontSize: 14 }}>{pts ?? "·"}</div>,
            ...(showRun ? [(() => {
              const lbl = matchRun![i] || "";
              const col = lbl === "" ? C.faint : lbl === "AS" ? C.ink : lbl.includes("UP") ? C.greenMid : C.birdie;
              return <div key="ms" style={{ textAlign: "center", color: col, fontWeight: 800, fontSize: 13 }}>{lbl || "·"}</div>;
            })()] : []),
          ]);
        })}
        {Row([
          <div key="h" style={{ color: C.gold, fontWeight: 800, fontSize: 12 }}>{from === 0 ? "OUT" : "IN"}</div>,
          <div key="p" style={{ textAlign: "center", color: C.ink, fontWeight: 800, fontSize: 13 }}>{sPar}</div>,
          <div key="si" />,
          ...(showOpp ? [(() => {
            const oSum = opp!.slice(from, to).reduce((s: number, v) => s + (v || 0), 0);
            return <div key="op" style={{ textAlign: "center", color: C.gold, fontWeight: 800, fontSize: 14 }}>{oSum || "–"}</div>;
          })()] : []),
          ...(hasDots ? [<div key="d" />] : []),
          <div key="sc" style={{ textAlign: "center", color: C.green, fontWeight: 800, fontSize: 15 }}>{sScore || "–"}</div>,
          ...(showFairway ? [<div key="fw" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 11 }}>{sFwElig ? `${sFwHit}/${sFwElig}` : "–"}</div>] : []),
          ...(showPutts ? [<div key="pu" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 13 }}>{sPutts || "–"}</div>] : []),
          ...(showPenalties ? [<div key="pe" style={{ textAlign: "center", color: C.faint, fontWeight: 700, fontSize: 13 }}>{sPen || "–"}</div>] : []),
          <div key="pt" style={{ textAlign: "center", color: C.green, fontWeight: 800, fontSize: 14 }}>{sPts}</div>,
          ...(showRun ? [(() => {
            let lbl = "";
            for (let k = to - 1; k >= from; k--) { if (matchRun![k]) { lbl = matchRun![k] as string; break; } }
            const col = lbl === "" ? C.faint : lbl === "AS" ? C.ink : lbl.includes("UP") ? C.greenMid : C.birdie;
            return <div key="ms" style={{ textAlign: "center", color: col, fontWeight: 800, fontSize: 13 }}>{lbl || "–"}</div>;
          })()] : []),
        ], { foot: true })}
      </div>
    );
  };

  // ---- Match-play layout: one compact card per hole (header strip + one field band) ----
  const mCell = (label: string, node: React.ReactNode) => (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 0, padding: "0 1px" }}>
      <span style={{ fontSize: 7.5, fontWeight: 800, textTransform: "uppercase", color: C.faint, letterSpacing: 0.2, whiteSpace: "nowrap" }}>{label}</span>
      {node}
    </div>
  );
  const valBox = (content: React.ReactNode, color: string, size = 16): React.ReactNode => (
    <div style={{ height: 34, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: size, color }}>{content}</div>
  );
  const matchCard = (i: number) => {
    const h = holes[i];
    const maxStrokes = uncap ? h.par + 8 : hasHandicap ? h.par + 2 + h.recv : h.par * 2;
    const maxPutts = h.strokes != null && h.strokes > 0 ? Math.min(h.strokes, 6) : 6;
    const pts = stablefordPts(h.strokes, h.par, h.recv || 0);
    const penN = h.penalties || 0; const sandOn = !!h.sand;
    const spDisp = sandOn && penN > 0 ? "*" : sandOn ? "S" : penN > 0 ? String(penN) : "·";
    const spActive = sandOn || penN > 0;
    const ov = showOpp ? (opp![i] ?? null) : null;
    const run = showRun ? (matchRun![i] || "") : "";
    const runCol = run === "" ? C.faint : run === "AS" ? C.ink : (run.includes("UP") || run.includes("↑")) ? C.greenMid : C.birdie;
    const yds = h.yards ?? null;
    return (
      <div key={h.n} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 13, overflow: "hidden" }}>
        <div style={{ background: C.green, color: C.cream, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 12px" }}>
          <span style={{ fontSize: 16, fontWeight: 800 }}>{h.n}</span>
          <span style={{ fontSize: 12, color: C.sage, fontWeight: 600, flex: 1, marginLeft: 10 }}>Par <b style={{ color: "#EDE7D4" }}>{h.par}</b>{yds ? <> · <b style={{ color: "#EDE7D4" }}>{yds}</b> yds</> : null} · S.I. <b style={{ color: "#EDE7D4" }}>{h.si ?? "–"}</b></span>
          <span style={{ fontSize: 11, color: "#EDE7D4", fontWeight: 700, whiteSpace: "nowrap" }}>
            {h.recv > 0 ? <>you <span style={{ color: C.dot, fontSize: 13, letterSpacing: 1 }}>{"•".repeat(Math.min(h.recv, 3))}</span></> : <span style={{ color: C.sage }}>—</span>}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", padding: "5px 4px 6px", gap: 3 }}>
          {mCell("Score", <NumPicker key={`msc-${hydrated}`} value={h.strokes} from={1} to={maxStrokes} onChange={(v) => onSet(i, { strokes: v })} width={42} accent={savingHole === i} />)}
          {mCell("FW",
            <button onClick={() => cycleFw(i, h.fairway, h.par)} disabled={h.par < 4}
              style={{ height: 34, width: "100%", border: `1px solid ${C.line}`, borderRadius: 7, cursor: h.par < 4 ? "default" : "pointer",
                background: h.fairway === "hit" ? "#C7E6D1" : (h.fairway === "left" || h.fairway === "right" || h.fairway === "miss") ? "#F2CFCB" : C.card,
                color: h.fairway === "hit" ? "#0F5436" : (h.fairway === "left" || h.fairway === "right" || h.fairway === "miss") ? C.birdie : C.faint, fontWeight: 800, fontSize: 14 }}>
              {h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "left" ? "L" : h.fairway === "right" ? "R" : h.fairway === "miss" ? "✗" : "·"}
            </button>)}
          {mCell("Putt", <NumPicker key={`mpu-${hydrated}`} value={h.putts} from={0} to={maxPutts} onChange={(v) => onSet(i, { putts: v })} width={42} />)}
          {mCell("S/Pen",
            <button onClick={() => setEditPen(i)}
              style={{ height: 34, width: "100%", border: `1px solid ${spActive ? C.birdie : C.line}`, borderRadius: 7, cursor: "pointer", background: spActive ? "#F6DEDB" : C.card, color: spActive ? C.birdie : C.faint, fontWeight: 800, fontSize: spDisp === "*" ? 18 : 15 }}>
              {spDisp}
            </button>)}
          {mCell("Pts", valBox(pts ?? "·", ptsColor(pts)))}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, background: "#F3EFE2", borderRadius: 8, borderLeft: `1px solid ${C.line}`, marginLeft: 3, paddingLeft: 2 }}>
            {mCell("Match", valBox(run || "·", runCol, 13))}
            {mCell("Opp", valBox(ov ?? "·", ov == null ? C.faint : C.ink))}
            {mCell("Opp str", valBox((h.gives || 0) > 0 ? "•".repeat(Math.min(h.gives || 0, 3)) : "–", C.sage, 13))}
          </div>
        </div>
      </div>
    );
  };
  const matchSummary = (from: number, to: number, label: string) => {
    const seg = holes.slice(from, to);
    const sScore = seg.reduce((a, h) => a + (h.strokes || 0), 0);
    const sPutts = seg.reduce((a, h) => a + (h.putts || 0), 0);
    const sPts = seg.reduce((a, h) => a + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    let run = ""; if (showRun) { for (let k = to - 1; k >= from; k--) { if (matchRun![k]) { run = matchRun![k] as string; break; } } }
    const runCol = run === "" ? C.sage : run === "AS" ? "#fff" : (run.includes("UP") || run.includes("↑")) ? "#7FE3A6" : "#F0A39A";
    const item = (k: string, v: React.ReactNode, col = "#fff") => (
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 8.5, color: C.sage, fontWeight: 700, textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 16, fontWeight: 800, color: col, marginTop: 1 }}>{v}</div></div>
    );
    return (
      <div key={"sum-" + label} style={{ background: C.green, color: C.cream, borderRadius: 13, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{label}</span>
        <div style={{ display: "flex", gap: 15 }}>
          {item("Score", sScore || "–")}
          {item("Putts", sPutts || "–")}
          {item("Pts", sPts, C.gold)}
          {showRun && item("Match", run || "–", runCol)}
        </div>
      </div>
    );
  };
  const matchRows: React.ReactNode[] = (() => {
    const rows: React.ReactNode[] = [];
    holes.forEach((h, i) => {
      rows.push(matchCard(i));
      if (i === 8 && holes.length > 9) rows.push(matchSummary(0, 9, "OUT"));
    });
    if (holes.length > 9) { rows.push(matchSummary(9, holes.length, "IN")); rows.push(matchSummary(0, holes.length, "TOTAL")); }
    else rows.push(matchSummary(0, holes.length, "TOTAL"));
    return rows;
  })();

  const out = holes.slice(0, 9).reduce((s, h) => s + (h.strokes || 0), 0);
  const inn = holes.slice(9, 18).reduce((s, h) => s + (h.strokes || 0), 0);
  const has18 = holes.length > 9;

  return (
    <>
      {showSixes && !matchMode && holes.length >= 12 && (() => {
        const segPts = (from: number, to: number) => strokeSixes
          ? holes.slice(from, to).reduce((acc, h) => acc + (h.strokes && h.strokes > 0 ? h.strokes - (h.recv || 0) : 0), 0)
          : holes.slice(from, to).reduce((acc, h) => acc + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
        const segs = [
          { lbl: "Front 6", sub: "1\u20136", v: segPts(0, 6) },
          { lbl: "Middle 6", sub: "7\u201312", v: segPts(6, 12) },
          { lbl: "Last 6", sub: "13\u201318", v: segPts(12, 18) },
        ];
        return (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: C.faint, fontSize: 9, letterSpacing: 0.5, fontWeight: 800, textTransform: "uppercase", marginBottom: 6 }}>{strokeSixes ? "Sixes · net score" : "Sixes · net stableford"}</div>
            <div style={{ display: "flex", gap: 8 }}>
              {segs.map((sg) => (
                <div key={sg.lbl} style={{ flex: 1, background: C.greenLight, borderRadius: 12, padding: "9px 6px", textAlign: "center" }}>
                  <div style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}>{sg.lbl}</div>
                  <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 20, marginTop: 2 }}>{sg.v}</div>
                  <div style={{ color: C.faint, fontSize: 10 }}>holes {sg.sub}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {anyStroke && hasHandicap && (
        <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
          {holes.some((h) => h.recv > 0)
            ? "• filled dots show the handicap strokes you receive on that hole."
            : "◦ hollow dots show the holes where you give your opponent a stroke."}
        </div>
      )}
      {matchMode ? (
        <FitToWidth>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 10 }}>
            {matchRows}
          </div>
        </FitToWidth>
      ) : (
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        {block(0, Math.min(9, holes.length), "FRONT NINE")}
        {has18 && block(9, 18, "BACK NINE")}
      </div>
      )}
      {!matchMode && has18 && (out > 0 || inn > 0) && (
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

      {editPen != null && holes[editPen] && (() => {
        const h = holes[editPen!];
        const penN = h.penalties || 0;
        const sandOn = !!h.sand;
        const disp = sandOn && penN > 0 ? "*" : sandOn ? "S" : penN > 0 ? String(penN) : "·";
        return (
          <div onClick={() => setEditPen(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: 280, maxWidth: "100%", background: C.card, borderRadius: 14, padding: 16 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>Hole {h.n} · par {h.par}</div>
              <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>What happened on this hole?</div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
                <span style={{ color: C.ink, fontSize: 14 }}>Greenside bunker</span>
                <button onClick={() => onSet(editPen!, { sand: !sandOn })}
                  style={{ border: `1px solid ${sandOn ? "#C9A227" : C.line}`, background: sandOn ? "#EFE2C0" : C.card, color: sandOn ? "#7A5A12" : C.faint, borderRadius: 8, padding: "6px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                  {sandOn ? "S · on" : "S · off"}
                </button>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ color: C.ink, fontSize: 14, marginBottom: 6 }}>Penalty strokes</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {[0, 1, 2, 3].map((n) => (
                    <button key={n} onClick={() => onSet(editPen!, { penalties: n })}
                      style={{ flex: 1, textAlign: "center", border: `1px solid ${penN === n ? C.birdie : C.line}`, background: penN === n ? "#F6DEDB" : C.card, color: penN === n ? C.birdie : C.faint, borderRadius: 8, padding: "8px 0", fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#F1EFE6", borderRadius: 8, padding: "8px 10px", marginTop: 14 }}>
                <span style={{ color: C.faint, fontSize: 12 }}>Cell shows:</span>
                <span style={{ color: C.birdie, fontWeight: 800, fontSize: 18 }}>{disp}</span>
                <span style={{ color: C.faint, fontSize: 12 }}>{sandOn && penN > 0 ? "(bunker + penalty)" : sandOn ? "(greenside bunker)" : penN > 0 ? "(penalty strokes)" : ""}</span>
              </div>

              <button onClick={() => setEditPen(null)} style={{ width: "100%", marginTop: 14, background: C.green, color: C.cream, borderRadius: 8, padding: 10, fontWeight: 800, fontSize: 14, border: "none", cursor: "pointer" }}>Done</button>
            </div>
          </div>
        );
      })()}
    </>
  );
}

// READ-ONLY VIEW — vertical scorecard for a completed round. Fits screen width.
export function ScoreViewCard({ round }: { round: Round }) {
  const hasPutts = round.holes.some((h) => h.putts != null);
  const hasPens = round.holes.some((h) => (h.penalties || 0) > 0 || !!h.sand);
  const hasDots = round.holes.some((h) => (h.recv || 0) > 0);
  const hasFw = round.holes.some((h) => h.fairway != null);

  const headStyle: React.CSSProperties = { color: C.faint, fontSize: 9, letterSpacing: 0.5, fontWeight: 700, textTransform: "uppercase" };

  const block = (from: number, to: number, label: string) => {
    const seg = round.holes.slice(from, to);
    if (seg.length === 0) return null;
    const sPar = seg.reduce((s, h) => s + h.par, 0);
    const sStr = seg.reduce((s, h) => s + (h.strokes || 0), 0);
    const sPutts = seg.reduce((s, h) => s + (h.putts || 0), 0);
    const sPen = seg.reduce((s, h) => s + (h.penalties || 0), 0);
    const sPts = seg.reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
    const fwElig = seg.filter((h) => h.par >= 4 && h.fairway != null).length;
    const fwHit = seg.filter((h) => h.par >= 4 && h.fairway === "hit").length;
    const Row = (cells: React.ReactNode[], opts?: { header?: boolean; foot?: boolean }) => (
      <div style={{
        display: "grid",
        gridTemplateColumns: `34px 30px 30px${hasDots ? " 34px" : ""} 1fr${hasFw ? " 30px" : ""}${hasPutts ? " 38px" : ""}${hasPens ? " 40px" : ""} 34px`,
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
          ...(hasPens ? [<div key="pe" style={{ ...headStyle, textAlign: "center", lineHeight: 1.05 }}>Sand<br />Pen</div>] : []),
          <div key="pt" style={{ ...headStyle, textAlign: "center" }}>Pts</div>,
        ], { header: true })}
        {seg.map((h, j) => {
          const recv = h.recv || 0;
          const pts = stablefordPts(h.strokes, h.par, h.recv || 0);
          const penN = h.penalties || 0; const sandOn = !!h.sand;
          const spDisp = sandOn && penN > 0 ? "*" : sandOn ? "S" : penN > 0 ? String(penN) : "·";
          const spCol = sandOn || penN > 0 ? C.birdie : C.faint;
          return Row([
            <div key="h" style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.hole_number}</div>,
            <div key="p" style={{ textAlign: "center", color: C.parBlue, fontWeight: 700, fontSize: 14 }}>{h.par}</div>,
            <div key="si" style={{ textAlign: "center", color: C.faint, fontSize: 12 }}>{h.stroke_index ?? "–"}</div>,
            ...(hasDots ? [<div key="d" style={{ textAlign: "center", color: C.dot, fontWeight: 800, fontSize: 15, letterSpacing: 1 }}>{recv > 0 ? "•".repeat(Math.min(recv, 3)) : ""}</div>] : []),
            <div key="sc" style={{ textAlign: "center" }}><ScoreMark hole={h} /></div>,
            ...(hasFw ? [<div key="fw" style={{ textAlign: "center", fontWeight: 800, fontSize: 13, color: h.fairway === "hit" ? C.greenMid : h.fairway === "miss" ? C.birdie : C.faint }}>{h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "left" ? "L" : h.fairway === "right" ? "R" : h.fairway === "miss" ? "✗" : "·"}</div>] : []),
            ...(hasPutts ? [<div key="pu" style={{ textAlign: "center", color: C.faint, fontSize: 13 }}>{h.putts ?? "·"}</div>] : []),
            ...(hasPens ? [<div key="pe" style={{ textAlign: "center", color: spCol, fontWeight: spDisp === "*" ? 800 : 400, fontSize: spDisp === "*" ? 16 : 13 }}>{spDisp}</div>] : []),
            <div key="pt" style={{ textAlign: "center", color: ptsColor(pts), fontWeight: 800, fontSize: 14 }}>{pts ?? "·"}</div>,
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

// ================= Brand wordmark =================
// Dark green badge with gold accents — "Birdie / Num Num" in serif.
export function Wordmark({ width = 280 }: { width?: number }) {
  const h = width * (150 / 400);
  return (
    <svg width={width} height={h} viewBox="0 0 400 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Birdie Num Num">
      <rect x="1.5" y="1.5" width="397" height="147" rx="18" fill="#0E3B2E" stroke="#C9A227" strokeWidth="2.5" />
      <line x1="40" y1="42" x2="120" y2="42" stroke="#C9A227" strokeWidth="1.5" />
      <circle cx="200" cy="42" r="3.5" fill="#C9A227" />
      <line x1="280" y1="42" x2="360" y2="42" stroke="#C9A227" strokeWidth="1.5" />
      <text x="200" y="78" textAnchor="middle" fontFamily="Georgia, serif" fontSize="40" fontWeight="700" fill="#F7F3E8">Birdie</text>
      <text x="200" y="116" textAnchor="middle" fontFamily="Georgia, serif" fontSize="30" fontWeight="700" fontStyle="italic" fill="#C9A227">Num Num</text>
      <line x1="40" y1="130" x2="360" y2="130" stroke="#16503D" strokeWidth="1" />
    </svg>
  );
}
