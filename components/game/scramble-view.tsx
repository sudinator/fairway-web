"use client";
// The scramble results on the game screen (211.1): the leaderboard (one leaderboard) or the matches (team v team).
// Numbers from lib/scramble-game — the same as the recap.
import React from "react";
import { C } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { scrambleResults } from "@/lib/scramble-game";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";

const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

export function ScrambleView({ game, players, altShotScores }: { game: Game; players: Player[]; altShotScores: AltShotScoreRow[] }) {
  const r = scrambleResults(game, players, altShotScores);
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 700, textAlign: "right", padding: "4px 10px" };
  const td: React.CSSProperties = { borderTop: `1px solid ${C.borderGreen}`, padding: "4px 10px", textAlign: "right", fontSize: 13, color: C.cream };
  if (!r.teams.length) return <div style={{ color: C.sage, fontSize: 13, marginTop: 14 }}>Make the teams first — Setup → Teams.</div>;
  return (
    <div data-scramble-view style={{ marginTop: 18 }}>
      {r.mode === "match" ? (
        <>
          <Eyebrow>SCRAMBLE · TEAM V TEAM{r.gross ? " · GROSS" : ""}</Eyebrow>
          {r.matches.map((m) => (
            <div key={m.groupId} data-scramble-match style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
              <div style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{m.line}</div>
              {[m.a, m.b].map((t) => (
                <div key={t.key} style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
                  <b style={{ color: C.cream }}>{t.name}</b> · {t.memberNames.join(", ")}{r.gross ? "" : ` · team hcp ${t.handicap}`}
                </div>
              ))}
            </div>
          ))}
        </>
      ) : (
        <>
          <Eyebrow>SCRAMBLE · LEADERBOARD · {r.gross ? "GROSS" : "NET"}</Eyebrow>
          <table data-scramble-board style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr><th style={{ ...th, textAlign: "left" }}>Pos</th><th style={{ ...th, textAlign: "left" }}>Team</th><th style={th}>Thru</th><th style={th}>Gross</th>{r.gross ? null : <th style={th}>Hcp</th>}<th style={th}>{r.gross ? "To par" : "Net"}</th></tr></thead>
            <tbody>{r.board.map((row) => {
              const t = r.teams.find((x) => x.key === row.key)!;
              return (
                <tr key={row.key}>
                  <td style={{ ...td, textAlign: "left", color: C.gold, fontWeight: 800 }}>{row.pos}</td>
                  <td style={{ ...td, textAlign: "left" }}><b>{row.name}</b><div style={{ color: C.sage, fontSize: 11 }}>{t.memberNames.join(", ")}</div></td>
                  <td style={td}>{row.thru || "—"}</td>
                  <td style={td}>{row.thru ? row.gross : "—"}</td>
                  {r.gross ? null : <td style={td}>{row.handicap}</td>}
                  <td style={{ ...td, fontWeight: 800 }}>{row.thru ? toPar(r.gross ? row.grossToPar : row.netToPar) : "—"}</td>
                </tr>
              );
            })}</tbody>
          </table>
          {r.gross ? null : <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Net to par, with each team&apos;s strokes taken hole by hole — fair while teams are on different holes.</div>}
        </>
      )}
      <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>Scramble scores belong to the team — they don&apos;t count as anyone&apos;s individual round.</div>
    </div>
  );
}
