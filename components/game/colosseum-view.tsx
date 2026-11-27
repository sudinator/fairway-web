"use client";
/**
 * The Colosseum on the game screen (212.136, owner): the standings table the whole field reads — one row per player
 * however big the field — with the signed-in player's "so far" strip above it, and a tap on any name to that player's
 * matches. The 28 (or 120) matches are never listed as cards. Numbers from lib/colosseum — the same as the recap.
 * The scorecard is the existing group card below this; nothing here enters a score.
 */
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow, btn } from "@/components/ui";
import { colosseumStandings, colosseumPlayerMatches, colosseumSummaryLine, colosseumSidePoints, isCupColosseum, fmtHalf, colosseumSides, colosseumStakes, type ColosseumRow } from "@/lib/colosseum";
import { HeadToHeadCard } from "@/components/game/head-to-head-card";
import { pkey } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";

const fmtPts = fmtHalf;
const fmtHoles = (n: number) => (n === 0 ? "0" : n > 0 ? `+${n}` : String(n));

export function ColosseumView({ game, players, user }: { game: Game; players: Player[]; user: { id: string } }) {
  const st = colosseumStandings(game, players);
  const me = players.find((p) => p.user_id === user.id);
  const myKey = me ? pkey(me) : null;
  const [open, setOpen] = useState<string | null>(null);
  /** 212.137: a match opened from a player's list — the head-to-head card, the viewer on the left when they are in it */
  const [match, setMatch] = useState<{ a: string; b: string } | null>(null);
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 700, textAlign: "right", padding: "4px 10px" };
  const td: React.CSSProperties = { borderTop: `1px solid ${C.borderGreen}`, padding: "6px 12px", textAlign: "right", fontSize: 13, color: C.cream, fontVariantNumeric: "tabular-nums" };
  if (st.rows.length < 2) return <div style={{ color: C.sage, fontSize: 13, marginTop: 14 }}>A Colosseum needs at least two players.</div>;

  const cup = isCupColosseum(game);
  const teams = cup ? (game.teams as { key: string; name: string }[]) : null;
  const sides = cup ? colosseumSidePoints(st, (k) => st.rows.find((r) => r.key === k)?.team) : null;
  const teamName = (key: string | null) => teams?.find((t) => t.key === key)?.name ?? key ?? "";
  const openRow = open ? st.rows.find((r) => r.key === open) : null;
  if (match) {
    const aKey = match.a === myKey || match.b !== myKey ? match.a : match.b, bKey = aKey === match.a ? match.b : match.a;
    const sides = colosseumSides(game, players, aKey, bKey);
    if (sides) return <HeadToHeadCard holes={game.holes_meta || []} a={sides.a} b={sides.b} basis="course" aIsViewer={aKey === myKey} stakes={colosseumStakes(game, players, aKey, bKey, aKey === myKey)} onBack={() => setMatch(null)} backLabel={`‹ ${openRow?.name ?? "Standings"}`} />;
  }
  if (openRow) {
    const lines = colosseumPlayerMatches(st, openRow.key);
    return (
      <div data-colosseum-player={openRow.key} style={{ marginTop: 18 }}>
        <button type="button" data-colosseum-back onClick={() => setOpen(null)} style={{ ...btn(false), fontSize: 12 }}>‹ Standings</button>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
          <div style={{ color: C.cream, fontSize: 20, fontWeight: 800 }}>{openRow.name}</div>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 14 }}>{openRow.won}-{openRow.lost}-{openRow.halved} W-L-H · {fmtPts(openRow.points)} pt{openRow.points === 1 ? "" : "s"}</div>
        </div>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{openRow.ch != null ? `Course handicap ${Math.round(openRow.ch)} · ` : ""}net vs net{openRow.group ? ` · group ${openRow.group}` : ""}</div>
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 10 }}>
          {lines.map((m) => {
            const color = !m.started ? C.sage : m.lead > 0 ? C.cream : m.lead < 0 ? C.overRedDark : C.sage;   // DISPLAY_RULES 7: never gold on greenLight
            return (
              <div key={m.opponent} data-colosseum-match={m.opponent} onClick={() => setMatch({ a: openRow.key, b: m.opponent })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: `1px solid ${C.borderGreen}`, fontSize: 13, cursor: "pointer" }}>
                <div>
                  <div style={{ color: C.cream, fontWeight: 700 }}>{m.opponentName}</div>
                  <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>{m.gives > 0 ? `${openRow.key === myKey ? "you give" : `${openRow.name} gives`} ${m.gives}` : m.gives < 0 ? `${m.opponentName} gives ${openRow.key === myKey ? "you" : openRow.name} ${-m.gives}` : "level"}{m.group ? (m.group === openRow.group ? " · same group" : ` · group ${m.group}`) : ""}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color, fontWeight: 800 }}>{m.started ? m.result : "—"}</div>
                  <div style={{ color: C.sage, fontSize: 11 }}>{m.started ? (m.decided ? "final" : `thru ${m.thru}`) : "not started"} ›</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ color: C.sage, fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>Each match is this player's net score against the other's on every hole — the strokes on their own card. "You give 3" is the difference in playing handicaps, shown for the stakes. Tap a match for the hole-by-hole card.</div>
      </div>
    );
  }

  const Row = ({ r }: { r: ColosseumRow }) => {
    const mine = r.key === myKey;
    return (
      <tr data-colosseum-row={r.key} onClick={() => setOpen(r.key)} style={{ cursor: "pointer", background: mine ? C.greenLight : undefined }}>
        {/* the leaderboard's numerals: gold Georgia position with T for a shared place; cream on the viewer's own (greenLight) row — DISPLAY_RULES 7 */}
        <td style={{ ...td, textAlign: "left", color: mine ? C.cream : C.gold, fontFamily: "Georgia, serif", fontWeight: 800 }}>{r.pos}</td>
        <td style={{ ...td, textAlign: "left" }}><b>{r.name}</b>{r.ch != null && <span style={{ color: C.sage, fontSize: 11, marginLeft: 6 }}>{Math.round(r.ch)}</span>}{cup && r.team && <span style={{ color: C.sage, fontSize: 11, marginLeft: 6 }}>{teamName(r.team)}</span>}</td>
        <td style={td}>{r.won}</td><td style={td}>{r.lost}</td><td style={td}>{r.halved}</td>
        <td style={{ ...td, color: mine ? C.cream : C.gold, fontFamily: "Georgia, serif", fontWeight: 800 }}>{fmtPts(r.points)}</td>
        <td style={td}>{fmtHoles(r.holes)}</td>
      </tr>
    );
  };
  return (
    <div data-colosseum-view style={{ marginTop: 18 }}>
      <Eyebrow>COLOSSEUM · {cup ? "SIDE V SIDE" : "EVERYONE PLAYS EVERYONE"} · {st.rows.length} PLAYERS · {st.matchCount} MATCHES</Eyebrow>
      {cup && teams && sides && (
        <div data-colosseum-sides style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
          <span style={{ color: C.cream, fontWeight: 800 }}>{teamName("A")}</span>
          <span style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800 }}>{fmtPts(sides.A)} – {fmtPts(sides.B)}</span>
          <span style={{ color: C.cream, fontWeight: 800 }}>{teamName("B")}</span>
        </div>
      )}
      {cup && sides && sides.open > 0 && <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{sides.open} match{sides.open === 1 ? "" : "es"} still in play — counted as they stand.</div>}
      {myKey && (
        <button type="button" data-colosseum-mine onClick={() => setOpen(myKey)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: C.greenLight, border: "none", borderRadius: 12, padding: "8px 12px", marginTop: 8, color: C.cream, fontSize: 12, cursor: "pointer", textAlign: "left" }}>
          <span>My matches: <b style={{ color: C.cream }}>{colosseumSummaryLine(st, myKey)}</b></span><span style={{ color: C.sage }}>›</span>
        </button>
      )}
      <table data-colosseum-board style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>Pos</th><th style={{ ...th, textAlign: "left" }}>Player</th><th style={th}>W</th><th style={th}>L</th><th style={th}>H</th><th style={th}>Pts</th><th style={th}>Holes</th></tr></thead>
        <tbody>{st.rows.map((r) => <Row key={r.key} r={r} />)}</tbody>
      </table>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>1 point a win, ½ a halve; a match still in play counts as it stands. Ties on points: the matches between the tied players, then holes up. A match between tee groups counts through the hole both have played. Holes = aggregate holes up across all matches. Tap a player for their matches.</div>
    </div>
  );
}
