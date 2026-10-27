/** 212.62 (owner, Oct 27: in match play "it should just show the matches, and not the groups") — the Group Card lays a
 * match-play group out match by match: columns ordered by match, a MATCH tag over each pair, a divider between matches. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { GroupScorecard } from "@/components/game/scorecard-views";
import type { Game, Player } from "@/lib/game-types";

const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (i: number, name: string) => ({ id: `p${i}`, user_id: `u${i}`, display_name: name, handicap_index: 10, course_handicap: 10, tee_group: 1, no_show: false, scores: [], putts: [], fairways: [] } as unknown as Player);
const players = [P(1, "Ann"), P(2, "Bob"), P(3, "Cat"), P(4, "Dan")];
// matches: Ann v Cat (match 1), Bob v Dan (match 2) — so the card must NOT keep the roster order
const game = { id: "g", status: "active", game_type: "match", pairings: [{ a: "u1", b: "u3" }, { a: "u2", b: "u4" }], foursomes: null, teams: null, holes_meta: holes, course_par: 72, allowance_pct: 100 } as unknown as Game;
const matchOf = (p: Player) => (p.user_id === "u1" || p.user_id === "u3" ? 1 : 2);
const ordered = [...players].sort((a, b) => matchOf(a) - matchOf(b));
const noop = async () => {};
const t = renderScreen(<GroupScorecard game={game} players={ordered} allPlayers={players} user={{ id: "u1" }} isMarker={true} markerName="Ann" onTakeOver={noop} onRelease={noop} onSetHole={noop}
  teeMode groupLabel="Matches 1 & 2" matchOf={matchOf} />);
const cols = [...t.el.querySelectorAll("[data-match-col]")];
ok(cols.map((c) => c.getAttribute("data-match-col")).join("") === "1122", `the four columns are ordered by match (got ${cols.map((c) => c.getAttribute("data-match-col")).join(",")})`);
ok(cols.map((c) => (c.textContent || "").includes("MATCH 1") ? "1" : (c.textContent || "").includes("MATCH 2") ? "2" : "-").join("") === "1-2-", "a MATCH tag sits over the first column of each match only");
const names = cols.map((c) => (c.textContent || "").match(/Ann|Bob|Cat|Dan/)?.[0]);
ok(JSON.stringify(names) === JSON.stringify(["Ann", "Cat", "Bob", "Dan"]), `opponents sit side by side (got ${JSON.stringify(names)})`);
ok((cols[2] as HTMLElement).style.borderLeft !== "" && (cols[1] as HTMLElement).style.borderLeft === "", "a divider separates the two matches");
ok((t.el.textContent || "").includes("Matches 1 & 2"), "the card is named by its matches, not 'Group 1'");
t.unmount();
report("match card layout");
