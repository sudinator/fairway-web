import { strict as assert } from "assert";
import { combineCompetitionScores, competitionFormatLabel, fmtCompetitionPoints, scoreCompetitionGame } from "./competition";
import type { Game, Player } from "./game-types";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

ok("formats half points", () => {
  assert.equal(fmtCompetitionPoints(0.5), "½");
  assert.equal(fmtCompetitionPoints(2.5), "2½");
  assert.equal(fmtCompetitionPoints(3), "3");
});
ok("labels supported cup formats", () => {
  assert.equal(competitionFormatLabel("fourball"), "Four-Ball");
  assert.equal(competitionFormatLabel("alt_shot"), "Alternate Shot");
  assert.equal(competitionFormatLabel("match"), "Singles");
});

const holes = Array.from({ length: 3 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game: Game = {
  id: "g", code: "123456", name: "Singles", course: "Test", course_par: 12, holes_meta: holes,
  game_type: "match", allowance_pct: 100, pairings: [{ a: "u1", b: "u2" }],
  teams: [{ key: "A", name: "Violet" }, { key: "B", name: "Burgundy" }], foursomes: null,
  created_by: "u1", created_at: "2026-09-01T00:00:00Z",
};
const basePlayer = { game_id: "g", avatar_url: null, handicap_index: 0, rating: 72, slope: 113, tee_name: "Blue", course_handicap: 0, putts: [], fairways: [] };
const players: Player[] = [
  { ...basePlayer, id: "p1", user_id: "u1", display_name: "A", team: "A", scores: [4,4,4] },
  { ...basePlayer, id: "p2", user_id: "u2", display_name: "B", team: "B", scores: [5,5,5] },
];
ok("singles match awards one point to winning competition team", () => {
  const s = scoreCompetitionGame(game, players);
  assert.equal(s.matchCount, 1);
  assert.equal(s.decidedCount, 1);
  assert.equal(s.projectedA, 1);
  assert.equal(s.decidedA, 1);
  assert.equal(s.projectedB, 0);
});
ok("reversed stored pairing still renders Cup Team A on the left", () => {
  const reversed: Game = { ...game, pairings: [{ a: "u2", b: "u1" }] };
  const s = scoreCompetitionGame(reversed, players);
  assert.equal(s.matches[0].leftNames, "A");
  assert.equal(s.matches[0].rightNames, "B");
  assert.equal(s.matches[0].winnerTeam, "A");
  assert.ok(s.matches[0].lead > 0);
  assert.equal(s.projectedA, 1);
});
ok("all-square completed Singles splits the Cup point", () => {
  const tiedPlayers: Player[] = players.map((p) => ({ ...p, scores: [4, 4, 4] }));
  const s = scoreCompetitionGame(game, tiedPlayers);
  assert.equal(s.decidedCount, 1);
  assert.equal(s.projectedA, 0.5);
  assert.equal(s.projectedB, 0.5);
  assert.equal(s.decidedA, 0.5);
  assert.equal(s.decidedB, 0.5);
});
ok("competition totals combine sessions", () => {
  const s = scoreCompetitionGame(game, players);
  const t = combineCompetitionScores([s, { ...s, projectedA: 0.5, projectedB: 0.5, decidedA: 0.5, decidedB: 0.5 }]);
  assert.equal(t.projectedA, 1.5);
  assert.equal(t.projectedB, 0.5);
  assert.equal(t.matchCount, 2);
});

const oneHole = [{ n: 1, par: 4, si: 1 }];
const teamPlayers: Player[] = [
  { ...basePlayer, id: "fa1", user_id: "fa1", display_name: "A1", team: "A", scores: [4] },
  { ...basePlayer, id: "fa2", user_id: "fa2", display_name: "A2", team: "A", scores: [5] },
  { ...basePlayer, id: "fb1", user_id: "fb1", display_name: "B1", team: "B", scores: [5] },
  { ...basePlayer, id: "fb2", user_id: "fb2", display_name: "B2", team: "B", scores: [6] },
];
ok("Four-Ball awards the existing game result into the Cup score", () => {
  const g: Game = { ...game, id: "four", holes_meta: oneHole, course_par: 4, game_type: "fourball", pairings: [], foursomes: [{ id: "f1", name: "Match 1", a: ["fa1", "fa2"], b: ["fb1", "fb2"] }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: "four" }));
  const s = scoreCompetitionGame(g, ps);
  assert.equal(s.matchCount, 1);
  assert.equal(s.decidedCount, 1);
  assert.equal(s.projectedA, 1);
  assert.equal(s.matches[0].winnerTeam, "A");
});
ok("Four-Ball normalizes Cup Team A to the left when the stored foursome is reversed", () => {
  const g: Game = { ...game, id: "four-reversed", holes_meta: oneHole, course_par: 4, game_type: "fourball", pairings: [], foursomes: [{ id: "f1", name: "Match 1", a: ["fb1", "fb2"], b: ["fa1", "fa2"] }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: "four-reversed" }));
  const s = scoreCompetitionGame(g, ps);
  assert.equal(s.matches[0].leftNames, "A1 / A2");
  assert.equal(s.matches[0].rightNames, "B1 / B2");
  assert.equal(s.matches[0].winnerTeam, "A");
});
ok("Alternate Shot aggregates canonical side-owned scores without copying player scores", () => {
  const g: Game = { ...game, id: "alt", holes_meta: oneHole, course_par: 4, game_type: "alt_shot", pairings: [], foursomes: [{ id: "f1", name: "Match 1", a: ["fa1", "fa2"], b: ["fb1", "fb2"], a_first: "fa1", b_first: "fb1" }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: "alt", scores: [] }));
  const sideRows = [
    { game_id: "alt", foursome_id: "f1", side: "a" as const, hole_index: 0, strokes: 4, updated_at: null, updated_by: null },
    { game_id: "alt", foursome_id: "f1", side: "b" as const, hole_index: 0, strokes: 5, updated_at: null, updated_by: null },
  ];
  const s = scoreCompetitionGame(g, ps, sideRows);
  assert.equal(s.matchCount, 1);
  assert.equal(s.decidedCount, 1);
  assert.equal(s.projectedA, 1);
  assert.equal(s.matches[0].winnerTeam, "A");
});

console.log(`competition: ${n} passed, 0 failed`);
