"use client";
/**
 * The individual leaderboard under the scorecard (212.137, owner): everyone in the field, net to par through the holes
 * they have played, with a "v you" column for the viewer's match with each of them — so the one table answers "how is
 * everyone doing" and "where do I stand against each of them". Sort by net, gross or the match. Tap a player to open
 * the head-to-head card: their card beside yours, hole by hole. Today a Colosseum's; the net/gross columns are any
 * own-ball format's, the "v you" column appears only where there is a match to show.
 */
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { Eyebrow, btn } from "@/components/ui";
import { fullStrokes, pkey, courseHandicapOf } from "@/lib/game-shape";
import { colosseumMatches, colosseumSides, colosseumStakes, inField, resultFor } from "@/lib/colosseum";
import { HeadToHeadCard } from "@/components/game/head-to-head-card";
import { compactMargin } from "@/lib/match-outcomes";
import type { Game, Player } from "@/lib/game-types";

type Row = { key: string; name: string; ch: number | null; thru: number; gross: number; grossToPar: number; net: number; vs: { lead: number; thru: number; decided: boolean; result: string } | null };
const toPar = (n: number) => (n === 0 ? "E" : n > 0 ? `+${n}` : String(n));

export function IndividualLeaderboard({ game, players, user }: { game: Game; players: Player[]; user: { id: string } }) {
  const [sort, setSort] = useState<"net" | "gross" | "vs">("net");
  const [open, setOpen] = useState<string | null>(null);
  const holes = game.holes_meta || [];
  const me = players.find((p) => p.user_id === user.id);
  const myKey = me ? pkey(me) : null;
  const colosseum = game.game_type === "colosseum";
  const matches = colosseum ? colosseumMatches(game, players) : [];
  const rows: Row[] = players.filter(inField).map((p) => {
    let thru = 0, gross = 0, par = 0, strokes = 0;
    holes.forEach((h, i) => { const g = p.scores?.[i]; if (g != null && g > 0) { thru++; gross += g; par += h.par; strokes += fullStrokes(game, p, h.si); } });
    const key = pkey(p);
    const m = myKey && key !== myKey ? matches.find((x) => (x.a === myKey && x.b === key) || (x.a === key && x.b === myKey)) : null;
    const vs = m ? { lead: m.a === myKey ? m.status.lead : -m.status.lead, thru: m.status.thru, decided: m.status.decided, result: m.status.result } : null;
    return { key, name: p.display_name, ch: courseHandicapOf(p, game.course_par, holes.length), thru, gross, grossToPar: gross - par, net: gross - strokes - par, vs };   // the one accessor (212.76), never the stored figure
  });
  const played = rows.filter((r) => r.thru > 0), waiting = rows.filter((r) => r.thru === 0);
  const sorted = [...played].sort((x, y) =>
    sort === "gross" ? x.grossToPar - y.grossToPar || y.thru - x.thru || x.name.localeCompare(y.name)
    : sort === "vs" ? (y.vs?.lead ?? -99) - (x.vs?.lead ?? -99) || x.name.localeCompare(y.name)
    : x.net - y.net || y.thru - x.thru || x.name.localeCompare(y.name));
  // compact so it fits one line in a narrow column: "Won 7&5", "Lost 1 up", "2 up", "A/S" (the margin as the head-to-head
  // records print it, lib/match-outcomes compactMargin)
  const vsLabel = (v: Row["vs"]) => !v || v.thru === 0 ? "—"
    : v.decided ? (v.result === "Halved" || v.lead === 0 ? "Halved" : `${v.lead > 0 ? "Won" : "Lost"} ${compactMargin(v.result)}`)
    : resultFor({ thru: v.thru, lead: v.lead, decided: false, result: "" }, v.lead);
  const vsColor = (v: Row["vs"]) => !v || v.thru === 0 ? C.sage : v.lead > 0 ? C.underDark : v.lead < 0 ? C.overRedDark : C.sage;
  const th: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 700, textAlign: "right", padding: "4px 10px" };
  const td: React.CSSProperties = { borderTop: `1px solid ${C.borderGreen}`, padding: "6px 12px", textAlign: "right", fontSize: 13, color: C.cream, fontVariantNumeric: "tabular-nums" };

  if (open && myKey && colosseum) {
    const sides = colosseumSides(game, players, myKey, open);
    if (sides) return <HeadToHeadCard holes={holes} a={sides.a} b={sides.b} basis="course" stakes={colosseumStakes(game, players, myKey, open, true)} onBack={() => setOpen(null)} backLabel="‹ Leaderboard" />;
  }
  if (rows.length < 2) return null;
  return (
    <div data-individual-leaderboard style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Eyebrow>LEADERBOARD · EVERYONE</Eyebrow>
        <div style={{ display: "flex", gap: 4 }}>
          {(colosseum && myKey ? (["net", "gross", "vs"] as const) : (["net", "gross"] as const)).map((k) => (
            <button key={k} type="button" data-lb-sort={k} onClick={() => setSort(k)} style={{ ...btn(sort === k), fontSize: 11, padding: "6px 12px" }}>{k === "net" ? "Net" : k === "gross" ? "Gross" : "v you"}</button>
          ))}
        </div>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr><th style={{ ...th, textAlign: "left" }}>Pos</th><th style={{ ...th, textAlign: "left" }}>Player</th><th style={th}>Thru</th><th style={th}>Gross</th><th style={th}>Net</th>{colosseum && <th style={th}>v you</th>}</tr></thead>
        <tbody>
          {sorted.map((r, i) => {
            const mine = r.key === myKey;
            // shared places read "T2", as the Colosseum table and the recap print them; no places under the "v you" sort
            const val = (x: Row) => (sort === "net" ? x.net : x.grossToPar);
            const place = sort === "vs" ? "" : `${sorted.filter((x) => val(x) === val(r)).length > 1 ? "T" : ""}${sorted.findIndex((x) => val(x) === val(r)) + 1}`;
            const tappable = !!r.vs;   // a match exists (never a teammate in a side-v-side Colosseum, never for a viewer outside the field)
            return (
              <tr key={r.key} data-lb-row={r.key} onClick={() => { if (tappable) setOpen(r.key); }} style={{ cursor: tappable ? "pointer" : "default", background: mine ? C.greenLight : undefined }}>
                <td style={{ ...td, textAlign: "left", color: mine ? C.cream : C.gold, fontFamily: "Georgia, serif", fontWeight: 800 }}>{place}</td>
                <td style={{ ...td, textAlign: "left" }}><b>{r.name}</b>{r.ch != null && <span style={{ color: C.sage, fontSize: 11, marginLeft: 6 }}>{Math.round(r.ch)}</span>}</td>
                <td style={td}>{r.thru}</td>
                <td style={td}>{r.gross}<span style={{ color: C.sage, fontSize: 11, marginLeft: 4 }}>{toPar(r.grossToPar)}</span></td>
                <td style={{ ...td, fontWeight: 800 }}>{toPar(r.net)}</td>
                {colosseum && <td style={{ ...td, color: vsColor(r.vs), fontWeight: 700, whiteSpace: "nowrap" }}>{mine ? "—" : vsLabel(r.vs)}</td>}
              </tr>
            );
          })}
          {waiting.map((r) => (
            <tr key={r.key} data-lb-row={r.key} style={{ background: r.key === myKey ? C.greenLight : undefined }}>
              <td style={{ ...td, color: C.sage }} /><td style={{ ...td, textAlign: "left", color: C.sage }}>{r.name}</td><td style={td}>0</td><td style={{ ...td, color: C.sage }}>—</td><td style={{ ...td, color: C.sage }}>—</td>{colosseum && <td style={{ ...td, color: C.sage }}>—</td>}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>Net to par through the holes each player has played{colosseum && myKey ? '; "v you" is your match with them. Tap a player you play to see their card beside yours, hole by hole.' : "."}</div>
    </div>
  );
}
