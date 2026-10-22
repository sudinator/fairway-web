/** 212.3 — Scramble as a Ryder Cup session: matches, exact sizes, and the app's and live page's scoring agreeing. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { cupScrambleMatches, scrambleSetupProblem } from "@/lib/scramble-teams";
import { scoreCompetitionGame } from "@/lib/competition";
import { liveCupSessionScore } from "@/lib/live-competition";
import { ScrambleTeamsBuilder } from "@/components/game/scramble-teams-builder";
import type { Game, Player } from "@/lib/game-types";

// matches: each side into teams of exactly 2, paired
const A = [1, 5, 9, 14, 18, 24].map((ch, i) => ({ key: `a${i}`, ch })), B = [3, 7, 12, 16, 22].map((ch, i) => ({ key: `b${i}`, ch }));
const ms = cupScrambleMatches(A, B, 2);
ok(ms.length === 3 && ms[0].a.length === 2 && ms[2].a.length === 2 && ms[2].b.length === 0, `6 Reds / 5 Blues at 2 v 2: three Reds teams, two Blues teams (got ${JSON.stringify(ms)})`);
ok(scrambleSetupProblem(ms, [...A, ...B].map((p) => p.key), "match", { exact: 2, sideNames: ["Reds", "Blues"] }) === "1 player isn't on a team yet.", "the fifth Blue isn't on a team: setup says so first");
ok(scrambleSetupProblem(ms, [...A, ...B].map((p) => p.key).filter((k) => k !== "b4"), "match", { exact: 2, sideNames: ["Reds", "Blues"] }) === "Match 3: Blues have 0 of 2 players.", "match 3 has no Blues team: named");
ok(scrambleSetupProblem([{ id: "m", name: "Match 1", a: ["a0", "a1"], b: ["b0"] }], ["a0", "a1", "b0"], "match", { exact: 2, sideNames: ["Reds", "Blues"] }) === "Match 1: Blues have 1 of 2 players.", "an uneven match: named side, count");
ok(scrambleSetupProblem([{ id: "m", name: "Match 1", a: ["a0", "a1"], b: ["b0", "b1"] }], ["a0", "a1", "b0", "b1"], "match", { exact: 2 }) === null, "2 v 2: complete");

// the SAME match, scored by the app (scoreCompetitionGame) and by the Cup live page (liveCupSessionScore)
const holes = Array.from({ length: 18 }, (_, k) => ({ n: k + 1, par: 4, si: k + 1 }));
const ids = { a1: 4.2, a2: 22.4, b1: 9.8, b2: 14.6 };
const appPlayers = Object.entries(ids).map(([id, ch]) => ({ id, user_id: id, display_name: id, team: id[0] === "a" ? "A" : "B", course_handicap: ch, course_handicap_source: "manual", scores: [], no_show: false })) as unknown as Player[];
const f = { id: "m1", name: "Match 1", a: ["a1", "a2"], b: ["b1", "b2"] };
const scoresA = [4, 4, 3, 4, 5, 4, 4, 3, 4, 4, 4, 4], scoresB = [4, 3, 4, 4, 4, 4, 5, 4, 4, 3, 4, 4];   // 12 holes in
const rows = [...scoresA.map((s, i) => ({ game_id: "g", foursome_id: "m1", side: "a", hole_index: i, strokes: s })), ...scoresB.map((s, i) => ({ game_id: "g", foursome_id: "m1", side: "b", hole_index: i, strokes: s }))];
const game = { id: "g", game_type: "scramble", holes_meta: holes, course_par: 72, status: "active", scramble_mode: "match", scramble_handicap: "usga", scramble_team_size: 2, teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }], foursomes: [f] } as unknown as Game;
const app = scoreCompetitionGame(game, appPlayers, rows as never, 1);
const live = liveCupSessionScore({ id: "s", game: { game_type: "scramble", holes_meta: holes, allowance_pct: 100, course_par: 72, scramble_mode: "match", scramble_handicap: "usga", scramble_team_size: 2 } as never,
  players: Object.entries(ids).map(([id, ch]) => ({ id, ch, team: id[0] === "a" ? "A" : "B", no_show: false, scores: [] })) as never,
  pairings: [], foursomes: [{ ...f, swap: false }] as never, alt_shot_scores: rows.map(({ game_id: _g, ...r }) => r) as never, points_per_match: 1 } as never);
ok(app.matches.length === 1 && live.matches.length === 1, `one match each (app ${app.matches.length}, live ${live.matches.length})`);
const am = app.matches[0] as any, lm = live.matches[0] as any;
ok(am.thru === 12 && am.thru === lm.thru && am.lead === lm.lead, `app and live page agree: thru ${am.thru}/${lm.thru}, lead ${am.lead}/${lm.lead}`);
// team handicaps: Reds 4.2×35% + 22.4×15% = 1.47 + 3.36 = 4.83 → 5; Blues 9.8×35% + 14.6×15% = 3.43 + 2.19 = 5.62 → 6
ok(typeof am.lead === "number", "a lead is reported");

// Setup → Teams in a Cup: "Ryder Cup · 2 v 2", balanced matches, own side only
{
  let saved: any = null;
  const cupGame = { ...game, foursomes: [{ id: "m1", name: "Match 1", a: ["a1"], b: [] }] } as unknown as Game;
  const t = renderScreen(<ScrambleTeamsBuilder game={cupGame} players={appPlayers} readOnly={false} onSave={(g) => { saved = g; }} />);
  const txt = t.el.textContent || "";
  ok(txt.includes("Ryder Cup · 2 v 2") && txt.includes("Reds"), `the Cup header and side names (${txt.slice(0, 120)})`);
  const opts = Array.from((t.el.querySelector('select[aria-label="Add b1 to a team"]') as HTMLSelectElement).options).map((o) => o.textContent || "");
  ok(opts.some((o) => o.includes("Blues")) && !opts.some((o) => o.includes("Reds")), `a Blues player can only join the Blues side (got ${opts})`);
  (Array.from(t.el.querySelectorAll("button")).find((b) => b.textContent === "Rebalance the matches") as HTMLButtonElement).click();
  ok(saved && saved.length === 1 && saved[0].a.length === 2 && saved[0].b.length === 2 && saved[0].a.every((k: string) => k.startsWith("a")), `balanced matches: one 2 v 2, Reds on side a (got ${JSON.stringify(saved)})`);
  t.unmount();
}
report("cup scramble");
