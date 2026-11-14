"use client";
import React from "react";
import { C, type Round } from "@/lib/golf";
import { sameDraftRound } from "@/lib/draft";

export function recoveryRounds(draft: Round | null, server: Round | null): { round: Round; server: Round | null }[] {
  if (!draft) return server ? [{ round: server, server }] : [];
  return [{ round: draft, server: server && sameDraftRound(draft, server) ? server : null },
    ...(server && !sameDraftRound(draft, server) ? [{ round: server, server }] : [])];
}

export function RoundRecovery({ draft, server, count, onResume, onComplete, onDelete, onDiscardAll }: {
  draft: Round | null; server: Round | null; count: number;
  onResume: (round: Round) => void;
  onComplete: (round: Round) => void;
  onDelete: (round: Round) => void;
  onDiscardAll: () => void;
}) {
  const secondary: React.CSSProperties = { background: "none", color: "#16201C", border: "1px solid #16201C", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" };
  return <>{recoveryRounds(draft, server).map(({ round, server: saved }, i) => (
    <div key={round.id || round.draft_session_id || `local-${i}`} data-round-recovery={round.id || round.draft_session_id || "local"}
      style={{ background: C.gold, color: "#16201C", borderRadius: 12, marginTop: 14 }}>
      <button onClick={() => onResume(round)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: "none", color: "#16201C", border: "none", cursor: "pointer", borderRadius: 12, padding: "12px 16px" }}>
        <span style={{ fontSize: 20 }}>⛳</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: 800, fontSize: 14 }}>Round in progress — tap to resume</span>
          <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
            {round.course || "Your round"} · {round.holes?.filter(h => h.strokes != null).length || 0} holes entered
            {round.played_at ? ` · ${String(round.played_at).slice(0, 10)}` : ""}
          </span>
        </span>
        <span style={{ fontWeight: 800, fontSize: 13 }}>Resume →</span>
      </button>
      {saved && <details style={{ padding: "8px 12px", fontSize: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Round options{count > 1 ? ` · ${count} unfinished rounds` : ""}</summary>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button style={secondary} onClick={() => onComplete(saved)}>Mark complete</button>
          <button style={secondary} onClick={() => onDelete(saved)}>Delete</button>
          {count > 1 && <button style={secondary} onClick={onDiscardAll}>Discard all {count}</button>}
        </div>
      </details>}
    </div>
  ))}</>;
}
