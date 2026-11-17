/** 212.111 (owner, Nov 16: in a trifecta "the order of players in the scorecard swapped the position between Probir and me"):
 *  the group card's columns follow the FOURSOME's stored order, never the order the player rows happened to arrive in
 *  (which changes as scores sync); every other format is alphabetical, equally stable. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { GroupScorecard } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number, name: string, team: string) => ({ id: `p${i}`, user_id: `u${i}`, display_name: name, handicap_index: 10, course_handicap: 10, tee_group: 1, team, no_show: false, scores: [], putts: [], fairways: [] } as unknown as Player);
const amit = P(1, "Amit", "A"), probir = P(2, "Probir", "A"), sam = P(3, "Sam", "B"), vik = P(4, "Vikram", "B");
const noop = async () => {};
const names = (t: ReturnType<typeof renderScreen>) => [...t.el.querySelectorAll("[data-card-col]")].map((c) => c.getAttribute("data-card-col"));
for (const gt of ["trifecta", "fourball"] as const) {
  const game = { id: "g", status: "active", game_type: gt, teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: [{ id: "f1", name: "Foursome 1", a: ["u1", "u2"], b: ["u3", "u4"] }], pairings: [], holes_meta: holes, course_par: 72, allowance_pct: 100, team_score_mode: "best_ball" } as unknown as Game;
  const first = renderScreen(<GroupScorecard game={game} players={[amit, probir, sam, vik]} allPlayers={[amit, probir, sam, vik]} user={{ id: "u1" }} isMarker={true} markerName="Amit" onTakeOver={noop} onRelease={noop} onSetHole={noop} teeMode groupLabel="Foursome 1" />);
  const a = JSON.stringify(names(first)); first.unmount();
  const reversed = renderScreen(<GroupScorecard game={game} players={[vik, sam, probir, amit]} allPlayers={[vik, sam, probir, amit]} user={{ id: "u1" }} isMarker={true} markerName="Amit" onTakeOver={noop} onRelease={noop} onSetHole={noop} teeMode groupLabel="Foursome 1" />);
  const b = JSON.stringify(names(reversed)); reversed.unmount();
  ok(a === b && a.startsWith('["Amit","Probir"'), `${gt}: the columns follow the foursome's order whatever order the rows arrive in (got ${a} then ${b})`);
}
const stroke = { id: "g", status: "active", game_type: "stroke", teams: null, foursomes: null, pairings: [], holes_meta: holes, course_par: 72, allowance_pct: 100 } as unknown as Game;
const s1 = renderScreen(<GroupScorecard game={stroke} players={[vik, amit, sam, probir]} allPlayers={[vik, amit, sam, probir]} user={{ id: "u1" }} isMarker={true} markerName="Amit" onTakeOver={noop} onRelease={noop} onSetHole={noop} teeMode groupLabel="Group 1" />);
ok(JSON.stringify(names(s1)) === JSON.stringify(["Amit", "Probir", "Sam", "Vikram"]), `stroke play: alphabetical whatever the row order (got ${JSON.stringify(names(s1))})`);
s1.unmount();
report("card column order");
