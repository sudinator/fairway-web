/** 211.1 — scramble results, the results view and the Teams screen. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { scrambleResults } from "@/lib/scramble-game";
import { ScrambleView } from "@/components/game/scramble-view";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import { RecapBody } from "@/components/game/recap-body";
import { buildRecap } from "@/lib/game-recap";
import { scrambleRowValue } from "@/lib/scramble-game";
import type { Game, Player } from "@/lib/game-types";

const par = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4], si = [7, 3, 17, 1, 11, 15, 5, 9, 13, 8, 2, 18, 4, 12, 6, 16, 10, 14];
const holes = par.map((p, i) => ({ n: i + 1, par: p, si: si[i] }));
const CH: Record<string, number> = { Raj: 4.2, Nihar: 9.8, Karan: 14.6, Sam: 22.4, Amit: 6.1, Vikram: 11.3, Probir: 16.9, Hp: 24.8 };
const players = Object.entries(CH).map(([n, ch], i) => ({ id: `p${i}`, user_id: `u-${n}`, display_name: n, course_handicap: ch, course_handicap_source: "manual", scores: [], no_show: false } as unknown as Player));
const groups = [{ id: "team-1", name: "Team 1", a: ["u-Raj", "u-Nihar", "u-Karan", "u-Sam"], b: [] }, { id: "team-2", name: "Team 2", a: ["u-Amit", "u-Vikram", "u-Probir", "u-Hp"], b: [] }];
const red = [4, 4, 3, 3, 4, 3, 4, 4, 4, 3, 4, 3, 4, 4, 3, 3, 4, 4], blue = [4, 4, 2, 4, 3, 3, 4, 5, 3, 4, 3, 3, 4, 3, 4, 2, 4, 4];
const rows = [...red.map((s, i) => ({ game_id: "g", foursome_id: "team-1", side: "a" as const, hole_index: i, strokes: s })), ...blue.map((s, i) => ({ game_id: "g", foursome_id: "team-2", side: "a" as const, hole_index: i, strokes: s }))];
const game = (extra: Record<string, unknown> = {}) => ({ id: "g", game_type: "scramble", holes_meta: holes, course_par: 72, status: "active", scramble_team_size: 4, scramble_mode: "field", scramble_handicap: "usga", foursomes: groups, ...extra } as unknown as Game);

// results: Team 1's handicap is Red's 7 (1.05 + 1.96 + 2.19 + 2.24 = 7.44), Team 2's 9
const r = scrambleResults(game(), players, rows);
ok(r.teams.map((t) => t.handicap).join(",") === "7,9", `team handicaps 7 and 9 (got ${r.teams.map((t) => t.handicap)})`);
ok(r.board[0].name === "Team 2" && r.board[0].net === 63 - 9 && r.board[1].net === 65 - 7, `Team 2 leads net 54 v 58 (got ${r.board.map((b) => b.name + " " + b.net)})`);
const gross = scrambleResults(game({ scramble_handicap: "gross" }), players, rows);
ok(gross.teams.every((t) => t.handicap === 0) && gross.board[0].gross === 63, "gross: no strokes, lowest gross leads");
const mg = game({ scramble_mode: "match", foursomes: [{ id: "match-1", name: "Match 1", a: groups[0].a, b: groups[1].a }] });
const m = scrambleResults(mg, players, [...rows.filter((x) => x.foursome_id === "team-1").map((x) => ({ ...x, foursome_id: "match-1" })), ...rows.filter((x) => x.foursome_id === "team-2").map((x) => ({ ...x, foursome_id: "match-1", side: "b" as const }))]);
ok(m.matches.length === 1 && /^Team (1|2) (won|\\d+ UP)|All square|Halved/.test(m.matches[0].line), `the match has a status line (got ${m.matches[0]?.line})`);

// the results view
{
  const t = renderScreen(<ScrambleView game={game()} players={players} altShotScores={rows as never} />);
  const txt = t.el.textContent || "";
  ok(!!t.el.querySelector("[data-scramble-board]") && txt.includes("SCRAMBLE · LEADERBOARD · NET") && txt.includes("Raj, Nihar, Karan, Sam"), "leaderboard with team members");
  ok(txt.includes("don't count as anyone's individual round"), "says scramble scores aren't individual rounds");
  t.unmount();
  const tm = renderScreen(<ScrambleView game={mg} players={players} altShotScores={[]} />);
  ok(!!tm.el.querySelector("[data-scramble-match]") && (tm.el.textContent || "").includes("Not started"), "team v team: matches, not started yet");
  tm.unmount();
}
// the Teams screen: handicap breakdown and balancing
{
  let saved: unknown = null;
  const t = renderScreen(<ScrambleTeamsBuilder game={game()} players={players} readOnly={false} onSave={(g) => { saved = g; }} />);
  const txt = t.el.textContent || "";
  ok(txt.includes("Team handicap 7") && txt.includes("4.2 × 25% = 1.1") && txt.includes("7.44, rounded to 7"), `handicap breakdown shown (${txt.slice(0, 200)})`);
  const btn = Array.from(t.el.querySelectorAll("button")).find((b) => b.textContent === "Rebalance the teams") as HTMLButtonElement;
  btn.click();
  ok(Array.isArray(saved) && (saved as unknown[]).length === 2, "rebalancing saves two teams of four");
  t.unmount();
  const empty = renderScreen(<ScrambleTeamsBuilder game={game({ foursomes: [] })} players={players} readOnly={false} onSave={() => {}} />);
  ok((empty.el.textContent || "").includes("Make balanced teams") && (empty.el.textContent || "").includes("Make the teams — Setup → Teams."), "no teams yet: says so, offers to make them");
  empty.unmount();
}
// the recap
{
  const rc = buildRecap(game({ status: "ended" }), players, rows as never);
  ok(rc.headline === "Team 2 wins the scramble — net 54", `recap headline (got ${rc.headline})`);
  ok(rc.personal["u-Amit"] === "Your team (Team 2) finished 1st, net 54" && rc.personal["u-Raj"] === "Your team (Team 1) finished 2nd, net 58", `personal lines (got ${JSON.stringify(rc.personal)})`);
  ok(rc.sections.individualStats === false && rc.sections.scramble?.rows.length === 2, "scramble section; no individual stats");
  ok(rc.sections.scramble?.rows[0].pos === "1" && scrambleRowValue(rc.sections.scramble!.rows[0], false) === "net 54 (63 − 9)", "row wording: net 54 (63 − 9)");
  const g = buildRecap(game({ status: "ended", scramble_handicap: "gross" }), players, rows as never);
  ok(g.headline === "Team 2 wins the scramble — gross 63", `gross headline (got ${g.headline})`);
  const empty = buildRecap(game({ status: "ended" }), players, []);
  ok(empty.headline === "Scramble — no scores yet", `no scores yet (got ${empty.headline})`);
  const t = renderScreen(<RecapBody game={game({ status: "ended" })} recap={rc} mode="share" />);
  ok((t.el.querySelector("[data-recap-scramble]")?.textContent || "").includes("net 54 (63 − 9)"), "the recap shows the scramble leaderboard");
  t.unmount();
}
report("scramble screens");
