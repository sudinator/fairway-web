/** 212.35 — 1:1 team skins with ties HALVED (owner, Oct 24). Create offers "Halved" for 1:1 skins, but the 1:1 engine
 * (computeHeadToHeadSkins) had no tie setting and always carried. Production check (Oct 24): no 1:1 skins game was
 * ever set to halved, so no past result changes. Every team skins call now reads skins_mode through skinsTieOf. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { computeHeadToHeadSkins, computeTeamBestBallSkins } from "@/lib/golf";
import { skinsTieOf, shapeOf } from "@/lib/game-shape";
import { skinsTotals } from "@/lib/game-results";
import { SkinsView } from "@/components/game/scoring-views";
import type { Game, Player } from "@/lib/game-types";

const eq = <V,>(a: V, e: V, label: string) => ok(JSON.stringify(a) === JSON.stringify(e), `${label} (expected ${JSON.stringify(e)}, got ${JSON.stringify(a)})`);
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const card = (first3: number[]) => [...first3, ...Array(15).fill(null)];
// A wins hole 1, hole 2 is tied, B wins hole 3 (scratch players, so gross = net)
const A = { id: "u1", name: "Raj", gross: card([4, 4, 5]), ch: 0 }, B = { id: "u2", name: "Sam", gross: card([5, 4, 4]), ch: 0 };

// --- the engine ---
const carry = computeHeadToHeadSkins(holes as never, A, B, 100, "carryover");
eq(carry.skinsBySide, { u1: 1, u2: 2 }, "carry over: the tied hole's skin rides to hole 3 (unchanged)");
const halved = computeHeadToHeadSkins(holes as never, A, B, 100, "halved");
eq(halved.skinsBySide, { u1: 1.5, u2: 1.5 }, "halved: the tied hole is ½ each, nothing carries");
eq(halved.holes.slice(0, 3).map((h) => h.value), [1, 1, 1], "halved: every hole is worth 1");
eq(halved.carryAtEnd, 0, "halved: nothing left carrying");
eq(computeHeadToHeadSkins(holes as never, A, B, 100).skinsBySide, carry.skinsBySide, "no setting = carry over (old callers unchanged)");
// the same tie rule as 2 v 2 skins: one player a side gives the same answer
const m = [{ id: "u1", gross: A.gross, ch: 0 }, { id: "u2", gross: B.gross, ch: 0 }];
const two = computeTeamBestBallSkins(holes as never, m as never, ["u1"], ["u2"], 100, "best_ball", "halved");
eq([two.skinsBySide.a, two.skinsBySide.b], [halved.skinsBySide.u1, halved.skinsBySide.u2], "1:1 halved agrees with 2 v 2 halved on the same holes");

// --- the setting is read one way ---
eq([skinsTieOf({ skins_mode: "split" }), skinsTieOf({ skins_mode: "carryover" }), skinsTieOf({})], ["halved", "carryover", "carryover"], "skinsTieOf: split = halved; anything else carries");

// --- a 1:1 team skins game: totals, and the screen ---
const players = [
  { id: "p1", user_id: "u1", display_name: "Raj", team: "A", scores: A.gross, course_handicap: 0, course_handicap_source: "manual", no_show: false },
  { id: "p2", user_id: "u2", display_name: "Sam", team: "B", scores: B.gross, course_handicap: 0, course_handicap_source: "manual", no_show: false },
] as unknown as Player[];
const game = (mode: string) => ({ id: "g", game_type: "skins", skins_mode: mode, teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: null,
  pairings: [{ a: "u1", b: "u2" }], holes_meta: holes, course_par: 72, allowance_pct: 100, status: "active" } as unknown as Game);
ok(shapeOf(game("split")).skinsStyle === "team_11", "the test game is 1:1 team skins");
eq(skinsTotals(game("split"), players).byTeam, { A: 1.5, B: 1.5 }, "team totals, halved");
eq(skinsTotals(game("carryover"), players).byTeam, { A: 1, B: 2 }, "team totals, carry over (unchanged)");
for (const [mode, want, not] of [["split", "Halved · ½ each", "push →"], ["carryover", "Halved — carries", "½ each"]] as const) {
  const t = renderScreen(<SkinsView game={game(mode)} players={players} user={{ id: "u1" }} isCreator mode="view" onChanged={() => {}} />);
  const txt = t.el.textContent || "";
  ok(txt.includes(want) && !txt.includes(not), `the 1:1 screen, ${mode}: says "${want}"`);
  t.unmount();
}
// "still in play" counts every match's skins (212.35: it counted the game as one match — 6 left of 36 read as 6)
{
  const C2 = { id: "u3", name: "Bo", gross: card([4, 4, 4]), ch: 0 }, D2 = { id: "u4", name: "Lex", gross: card([4, 5, 4]), ch: 0 };
  const four = [...players,
    { id: "p3", user_id: "u3", display_name: "Bo", team: "A", scores: C2.gross, course_handicap: 0, course_handicap_source: "manual", no_show: false },
    { id: "p4", user_id: "u4", display_name: "Lex", team: "B", scores: D2.gross, course_handicap: 0, course_handicap_source: "manual", no_show: false }] as unknown as Player[];
  const g2 = { ...game("split"), pairings: [{ a: "u1", b: "u2" }, { a: "u3", b: "u4" }] } as unknown as Game;
  const t = renderScreen(<SkinsView game={g2} players={four} user={{ id: "u1" }} isCreator mode="view" onChanged={() => {}} />);
  // two matches × 18 holes = 36 skins; 3 holes played in each = 6 decided → 30 still in play
  ok((t.el.textContent || "").includes("30 skins still in play"), `two matches: 30 of 36 skins still in play (got "${((t.el.textContent || "").match(/[\d½]+ skins? still in play/) || ["none"])[0]}")`);
  t.unmount();
}
report("skins ties");
