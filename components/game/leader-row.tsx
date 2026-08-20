"use client";

import React from "react";
import type { Player } from "@/lib/game-types";
import { C } from "@/lib/golf";
import { Avatar } from "@/components/ui";
import { flightTagColor } from "@/lib/flights";

// LeaderRow — one leaderboard row. Moved VERBATIM out of GameRoom (Stage 3, EXTRACTION_VERIFICATION.md).
// Every value the body used to read from GameRoom's scope is now an explicit, typed prop (the free-variable
// ledger); C / Avatar / flightTagColor are module imports, not closure state. Pure render, no state/effects.
type LeaderRowProps = {
  p: Player; pos: number; tied: boolean; showTag: boolean; showBetStatus: boolean;
  user: { id: string };
  isStroke: boolean; strokeNet: boolean;
  playerPoints: (p: Player) => number;
  playerThru: (p: Player) => number;
  playerNet: (p: Player) => number;
  playerGross: (p: Player) => number;
  parThru: (p: Player) => number;
  relToParStr: (p: Player) => string;
  leaderName: (full: string) => string;
};

export function LeaderRow({ p, pos, tied, showTag, showBetStatus, user, isStroke, strokeNet, playerPoints, playerThru, playerNet, playerGross, parThru, relToParStr, leaderName }: LeaderRowProps) {
    const pts = playerPoints(p);
    const thru = playerThru(p);
    const fkey = (p as any).flight as string | null;
    return (
      <div key={p.id} style={{
        background: p.user_id === user.id ? C.greenMid : C.greenLight,
        borderRadius: 12, padding: "10px 16px", marginTop: 8,
        display: "flex", alignItems: "center",
      }}>
        <div style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 700, width: 20, fontSize: 15 }}>
          {tied ? "T" : ""}{pos}
        </div>
        <Avatar src={p.avatar_url} name={p.display_name} size={32} />
        <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
          <div style={{ color: C.cream, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {leaderName(p.display_name)}{p.user_id === user.id ? " (you)" : ""}
            {showTag && fkey ? <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, borderRadius: 5, padding: "1px 6px", background: flightTagColor(fkey), color: "#06251A" }}>{fkey}</span> : null}
          </div>
          <div style={{ color: C.sage, fontSize: 11 }}>
            {p.course_handicap != null ? `CH ${p.course_handicap}` : "no hcp"}
            {showBetStatus && p.bets === false ? <span style={{ color: C.gold, fontWeight: 800 }}> · no bet</span> : ""}
          </div>
        </div>
        {isStroke ? (() => {
          const relV = (strokeNet ? playerNet(p) : playerGross(p)) - parThru(p);
          const relS = !thru ? "–" : relV === 0 ? "E" : relV > 0 ? `+${relV}` : `${relV}`;
          // Row is green since 177.62 — the cream-surface set measured 1.33-2.27:1 here.
          const relCol = !thru ? C.sage : relV < 0 ? C.underDark : relV > 0 ? C.overRedDark : C.sage;
          return (<>
            <div style={{ width: 40, textAlign: "center", color: C.cream, fontWeight: 700, fontSize: 15 }}>{thru || "–"}</div>
            <div style={{ width: 48, textAlign: "center", color: C.cream, fontWeight: strokeNet ? 700 : 800, fontSize: strokeNet ? 15 : 18, fontFamily: strokeNet ? undefined : "Georgia, serif" }}>{thru ? playerGross(p) : "–"}</div>
            <div style={{ width: 48, textAlign: "center", color: relCol, fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{relS}</div>
            <div style={{ width: 50, textAlign: "center", color: strokeNet ? C.gold : C.cream, fontWeight: strokeNet ? 800 : 700, fontSize: strokeNet ? 19 : 15, fontFamily: strokeNet ? "Georgia, serif" : undefined }}>{thru ? playerNet(p) : "–"}</div>
          </>);
        })() : (<>
          <div style={{ width: 44, textAlign: "center", color: C.cream, fontWeight: 700, fontSize: 15 }}>{thru || "–"}</div>
          <div style={{ width: 48, textAlign: "center", color: C.cream, fontWeight: 700, fontSize: 15 }}>{thru ? playerGross(p) : "–"}</div>
          {(() => {
            if (!thru) return <div style={{ width: 44, textAlign: "center", color: C.sage, fontWeight: 700, fontSize: 16, fontFamily: "Georgia, serif" }}>–</div>;
            const rel = 2 * thru - pts;
            const col = rel < 0 ? C.underDark : rel > 0 ? C.overRedDark : C.sage;
            return <div style={{ width: 44, textAlign: "center", color: col, fontWeight: 800, fontSize: 16, fontFamily: "Georgia, serif" }}>{relToParStr(p)}</div>;
          })()}
          <div style={{ width: 40, textAlign: "center", color: C.cream, fontWeight: 800, fontSize: 19, fontFamily: "Georgia, serif" }}>{pts}</div>
        </>)}
      </div>
    );
}
