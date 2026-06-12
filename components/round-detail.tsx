"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

export function RoundDetail({ round, onBack, onEdit, onDelete }: {
  round: Round; onBack: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const gross = isGrossOnly(round);
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
        <button style={btn(true)} onClick={onEdit}>Edit round</button>
        <button style={{ ...btn(false), background: "#7A2F28" }}
          onClick={() => { if (confirm("Delete this round?")) onDelete(); }}>Delete</button>
      </div>


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
