"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay, partialHandicapInfo,
} from "@/lib/golf";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

export function RoundsList({ rounds, onOpen }: { rounds: Round[]; onOpen: (r: Round) => void }) {
  if (!rounds.length)
    return (
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 28, color: C.sage, textAlign: "center" }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, marginBottom: 6 }}>No rounds yet</div>
        <div style={{ fontSize: 13, lineHeight: 1.5 }}>Tap <b style={{ color: C.cream }}>＋ New round</b> at the top to log your first one — go hole-by-hole for full stats, or enter a quick total for a past round. Games you finish show up here automatically too.</div>
      </div>
    );
  return <div>{[...rounds].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at)).map((r) => <RoundRow key={r.id} r={r} onOpen={onOpen} />)}</div>;
}

export function RoundRow({ r, onOpen }: { r: Round; onOpen: (r: Round) => void }) {
  return (
    <div onClick={() => onOpen(r)}
      style={{ background: C.card, borderRadius: 12, padding: "13px 16px", marginTop: 10, display: "flex", alignItems: "center", cursor: "pointer", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>
          {r.course}{r.tee_name ? ` · ${r.tee_name}` : ""}
          {r.game_id ? <span style={{ background: C.greenLight, color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, padding: "2px 7px", borderRadius: 6, marginLeft: 8, verticalAlign: "middle" }}>🏆 GAME</span> : null}
        </div>
        <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
          {r.group_name ? `${r.group_name} · ` : ""}{fmtDate(r.played_at)} · {played(r).length}/{r.holes.length} holes{(() => { const i = partialHandicapInfo(r); return i ? ` · ${i.filled} net par for hcp` : ""; })()} · GIR {pct(girStats([r]))} · FW {pct(firStats([r]))} · {puttsOf(r)} putts{pensOf(r) ? ` · ${pensOf(r)} pen` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ color: C.ink, fontSize: 20, fontWeight: 800, fontFamily: "Georgia, serif" }}>{strokesOf(r)}</span>
        {!isGrossOnly(r) && played(r).length > 0 && played(r).length < 18 && <span style={{ color: C.faint, fontSize: 11, fontWeight: 700, marginLeft: 5 }}>thru {played(r).length}</span>}
        <span style={{ color: C.green, fontWeight: 700, marginLeft: 8 }}>{toParStr(diffOf(r))}</span>
      </div>
      <div style={{ background: C.cream, borderRadius: 8, padding: "4px 10px", color: C.green, fontWeight: 800, fontSize: 13 }}>{stablefordDisplay(r)}</div>
    </div>
  );
}
