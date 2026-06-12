"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

export function RoundsList({ rounds, onOpen }: { rounds: Round[]; onOpen: (r: Round) => void }) {
  if (!rounds.length)
    return <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, color: C.sage, textAlign: "center" }}>No rounds yet. Tap "New round" to add one.</div>;
  return <div>{[...rounds].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at)).map((r) => <RoundRow key={r.id} r={r} onOpen={onOpen} />)}</div>;
}

export function RoundRow({ r, onOpen }: { r: Round; onOpen: (r: Round) => void }) {
  return (
    <div onClick={() => onOpen(r)}
      style={{ background: C.card, borderRadius: 12, padding: "13px 16px", marginTop: 10, display: "flex", alignItems: "center", cursor: "pointer", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{r.course}{r.tee_name ? ` · ${r.tee_name}` : ""}</div>
        <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
          {fmtDate(r.played_at)} · {played(r).length}/{r.holes.length} holes · GIR {pct(girStats([r]))} · FW {pct(firStats([r]))} · {puttsOf(r)} putts{pensOf(r) ? ` · ${pensOf(r)} pen` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ color: C.ink, fontSize: 20, fontWeight: 800, fontFamily: "Georgia, serif" }}>{strokesOf(r)}</span>
        <span style={{ color: C.green, fontWeight: 700, marginLeft: 8 }}>{toParStr(diffOf(r))}</span>
      </div>
      <div style={{ background: C.cream, borderRadius: 8, padding: "4px 10px", color: C.green, fontWeight: 800, fontSize: 13 }}>{stablefordDisplay(r)}</div>
    </div>
  );
}
