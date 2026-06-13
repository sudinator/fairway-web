"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay, adjustedHoleScore,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

export function RoundDetail({ round, ghinNumber, playerName, onBack, onEdit, onDelete }: {
  round: Round; ghinNumber?: string | null; playerName?: string; onBack: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const gross = isGrossOnly(round);
  const [showGhin, setShowGhin] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={onBack}>‹ Back</button>
        <div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>
            {round.course}{round.tee_name ? ` · ${round.tee_name}` : ""}
          </div>
          <div style={{ color: C.sage, fontSize: 13 }}>
            {fmtDate(round.played_at)} · {strokesOf(round)} ({toParStr(diffOf(round))})
            {gross ? ` · ${stablefordDisplay(round)} · total score only${round.course_handicap != null ? ` · CH ${round.course_handicap}` : ""}` : ` · ${stablefordDisplay(round)}${round.course_handicap != null ? ` · CH ${round.course_handicap}` : ""} · GIR ${fracPct(girStats([round]))} · FW ${fracPct(firStats([round]))} · ${puttsOf(round)} putts · ${pensOf(round)} pen`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={() => setShowGhin((v) => !v)}>{showGhin ? "Hide GHIN" : "Post to GHIN"}</button>
        <button style={btn(false)} onClick={onEdit}>Edit round</button>
        <button style={{ ...btn(false), background: "#7A2F28" }}
          onClick={() => { if (confirm("Delete this round?")) onDelete(); }}>Delete</button>
      </div>


      {showGhin && <GhinPanel round={round} ghinNumber={ghinNumber} playerName={playerName} />}

      {gross ? (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 20, marginTop: 14 }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 800 }}>{round.gross_score}</div>
          <div style={{ color: C.sage, fontSize: 13, marginTop: 4 }}>
            Total score · {toParStr(diffOf(round))} vs par{round.rating != null && round.slope != null ? ` · differential ${roundDifferential(round)?.toFixed(1) ?? "—"}` : ""}
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 12 }}>
            This round was logged as a total only — it counts toward your handicap and scoring average. Stableford is estimated from total score, par, and course handicap. Add hole-by-hole detail to get exact Stableford, GIR, putts, and par-type stats.
          </div>
          <button style={{ ...btn(true), marginTop: 12 }} onClick={onEdit}>＋ Add hole-by-hole detail</button>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}><ScoreViewCard round={round} /></div>
      )}
    </div>
  );
}

// Assisted GHIN posting (Tier 2): formats the round for quick manual entry in the GHIN app/site.
// Posting hole-by-hole lets GHIN apply net double bogey automatically; for a total-only round we
// supply the already-adjusted total so the user doesn't have to do the math.
function GhinPanel({ round, ghinNumber, playerName }: { round: Round; ghinNumber?: string | null; playerName?: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const detail = hasHoleDetail(round);

  // Per-hole gross + net-double-bogey-adjusted figures (only for hole-by-hole rounds).
  const holeRows = detail
    ? played(round).map((h) => ({ n: h.hole_number, par: h.par, gross: h.strokes ?? 0, adj: adjustedHoleScore(h) ?? h.strokes ?? 0 }))
    : [];
  const grossTotal = detail ? holeRows.reduce((s, r) => s + r.gross, 0) : (round.gross_score || 0);
  const adjTotal = detail ? holeRows.reduce((s, r) => s + r.adj, 0) : (round.gross_score || 0);

  const holesLine = detail ? holeRows.map((r) => r.gross).join(", ") : "";
  const copy = (key: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(key); setTimeout(() => setCopied(null), 1500); }).catch(() => {});
  };

  const summary = [
    playerName ? `Player: ${playerName}` : "",
    ghinNumber ? `GHIN #: ${ghinNumber}` : "",
    `Course: ${round.course}${round.tee_name ? ` (${round.tee_name})` : ""}`,
    round.rating != null && round.slope != null ? `Rating/Slope: ${round.rating} / ${round.slope}` : "",
    `Date: ${fmtDate(round.played_at)}`,
    `Holes: ${detail ? holeRows.length : 18}`,
    detail ? `Hole-by-hole: ${holesLine}` : "",
    detail ? `Gross total: ${grossTotal}` : `Total score: ${grossTotal}`,
    `Adjusted gross (net dbl bogey): ${adjTotal}`,
  ].filter(Boolean).join("\n");

  const field = (label: string, value: string, key: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.greenMid}` }}>
      <div style={{ color: C.sage, fontSize: 12, width: 120 }}>{label}</div>
      <div style={{ color: C.cream, fontSize: 14, fontWeight: 700, flex: 1 }}>{value}</div>
      <button style={{ ...btn(false), fontSize: 11, padding: "4px 10px" }} onClick={() => copy(key, value)}>{copied === key ? "✓" : "Copy"}</button>
    </div>
  );

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
      <Eyebrow>POST THIS ROUND TO GHIN</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6, lineHeight: 1.5 }}>
        GHIN is the official handicap of record. Birdie Num Num can't post for you yet, but here's everything formatted for a quick manual entry.
        {detail
          ? " Use Hole-by-Hole in the GHIN app and enter the scores below — GHIN applies the max-score (net double bogey) cap automatically."
          : " For a total-only round, enter the Adjusted gross below (it already has the net double bogey cap applied)."}
      </div>

      {!ghinNumber && (
        <div style={{ color: "#E8A199", fontSize: 12, marginTop: 8 }}>
          Tip: add your GHIN number in your Profile and it'll show here for easy reference.
        </div>
      )}

      <div style={{ background: C.card, borderRadius: 10, padding: "10px 14px", marginTop: 12 }}>
        {playerName ? field("Player", playerName, "name") : null}
        {ghinNumber ? field("GHIN #", String(ghinNumber), "ghin") : null}
        {field("Course", `${round.course}${round.tee_name ? ` (${round.tee_name})` : ""}`, "course")}
        {round.rating != null && round.slope != null ? field("Rating / Slope", `${round.rating} / ${round.slope}`, "rs") : null}
        {field("Date", fmtDate(round.played_at), "date")}
        {field(detail ? "Gross total" : "Total score", String(grossTotal), "gross")}
        {field("Adjusted gross", String(adjTotal), "adj")}
      </div>

      {detail && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginBottom: 6 }}>HOLE-BY-HOLE (GROSS)</div>
          <div style={{ overflowX: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${holeRows.length}, 1fr)`, gap: 3, minWidth: holeRows.length * 28 }}>
              {holeRows.map((r) => <div key={r.n} style={{ color: C.sage, fontSize: 9, textAlign: "center" }}>{r.n}</div>)}
              {holeRows.map((r) => <div key={r.n} style={{ color: C.cream, fontSize: 14, fontWeight: 700, textAlign: "center", background: C.card, borderRadius: 4, padding: "3px 0" }}>{r.gross}</div>)}
            </div>
          </div>
          <button style={{ ...btn(true), fontSize: 12, marginTop: 8 }} onClick={() => copy("holes", holesLine)}>{copied === "holes" ? "Copied ✓" : "Copy hole-by-hole scores"}</button>
        </div>
      )}

      <button style={{ ...btn(true), marginTop: 12 }} onClick={() => copy("all", summary)}>{copied === "all" ? "Copied full summary ✓" : "Copy full summary"}</button>

      <ol style={{ color: C.sage, fontSize: 12, marginTop: 12, paddingLeft: 18, lineHeight: 1.6 }}>
        <li>Open the GHIN app (or ghin.com) and sign in.</li>
        <li>Tap <b>Post Score</b> → {detail ? <b>Hole-by-Hole</b> : <b>Total Score</b>}.</li>
        <li>Pick <b>{round.course}</b>{round.tee_name ? ` · ${round.tee_name}` : ""} and set the date to <b>{fmtDate(round.played_at)}</b>.</li>
        <li>{detail ? "Enter each hole's score from the row above." : `Enter the Adjusted gross (${adjTotal}).`}</li>
        <li>Submit. GHIN is now your official record for this round.</li>
      </ol>
    </div>
  );
}
