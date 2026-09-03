import { strict as assert } from "assert";
import { combineCompetitionScores, competitionFormatLabel, competitionOutcome, competitionPointsNeeded, competitionSchedule, fmtCompetitionPoints, scoreCompetitionGame } from "./competition";
import type { Game, Player } from "./game-types";
import { computeTrifecta } from "./golf";

let n = 0;
const ok = (name: string, fn: () => void) => { fn(); n++; console.log(`ok ${n} - ${name}`); };

ok("formats common golf point fractions", () => {
  assert.equal(fmtCompetitionPoints(0.25), "¼");
  assert.equal(fmtCompetitionPoints(0.5), "½");
  assert.equal(fmtCompetitionPoints(0.75), "¾");
  assert.equal(fmtCompetitionPoints(2.5), "2½");
  assert.equal(fmtCompetitionPoints(6.75), "6¾");
  assert.equal(fmtCompetitionPoints(3), "3");
});
ok("labels supported cup formats", () => {
  assert.equal(competitionFormatLabel("fourball"), "Four-Ball");
  assert.equal(competitionFormatLabel("alt_shot"), "Alternate Shot");
  assert.equal(competitionFormatLabel("match"), "Singles");
  assert.equal(competitionFormatLabel("trifecta"), "Trifecta");
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
ok("locked schedule denominator comes from planned sessions, not created games", () => {
  const schedule = competitionSchedule([
    { id: "s1", competition_id: "c", name: "Four-Ball", format: "fourball", session_order: 1, play_date: "2026-09-01", points_per_match: 1, planned_match_count: 3, game_id: "g1", created_at: "" },
    { id: "s2", competition_id: "c", name: "Singles", format: "match", session_order: 2, play_date: "2026-09-02", points_per_match: 2, planned_match_count: 6, game_id: null, created_at: "" },
  ], "shared");
  assert.equal(schedule.totalPoints, 15);
  assert.equal(schedule.teamATarget, 8);
  assert.equal(competitionPointsNeeded(5.5, schedule.teamATarget), 2.5);
});
ok("Cup outlook distinguishes an outright path from a share-only path", () => {
  const schedule = competitionSchedule([
    { id: "s1", competition_id: "c", name: "Four-Ball", format: "fourball", session_order: 1, play_date: "2026-09-01", points_per_match: 0.5, planned_match_count: 3, game_id: "g1", created_at: "" },
    { id: "s2", competition_id: "c", name: "Alternate Shot", format: "alt_shot", session_order: 2, play_date: "2026-09-02", points_per_match: 1, planned_match_count: 3, game_id: "g2", created_at: "" },
    { id: "s3", competition_id: "c", name: "Singles", format: "match", session_order: 3, play_date: "2026-09-02", points_per_match: 1.5, planned_match_count: 6, game_id: "g3", created_at: "" },
  ], "shared");
  const outcome = competitionOutcome(6.75, 2.25, schedule, "shared");
  assert.equal(schedule.totalPoints, 13.5);
  assert.equal(schedule.teamATarget, 7);
  assert.equal(outcome.remainingPoints, 4.5);
  assert.equal(outcome.teamA.pointsNeeded, 0.25);
  assert.equal(outcome.teamA.canWin, true);
  assert.equal(outcome.teamB.canWin, false);
  assert.equal(outcome.teamB.canShare, true);
  assert.equal(outcome.teamB.maxPoints, 6.75);
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
ok("a running Four-Ball match is projected but is not counted complete", () => {
  const g: Game = { ...game, id: "four-live", game_type: "fourball", pairings: [], foursomes: [{ id: "f1", name: "Match 1", a: ["fa1", "fa2"], b: ["fb1", "fb2"] }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: g.id, scores: p.team === "A" ? [4] : [5] }));
  const s = scoreCompetitionGame(g, ps);
  assert.equal(s.matches[0].started, true);
  assert.equal(s.matches[0].decided, false);
  assert.equal(s.decidedCount, 0);
  assert.equal(s.projectedA, 1);
});
ok("post-clinch Four-Ball holes cannot rewrite a 5 & 3 result as 2 UP", () => {
  const nine = Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
  const a = [4,4,4,4,4,4,6,6,6], b = [4,5,5,5,5,5,4,4,4];
  const g: Game = { ...game, id: "four-clinch", holes_meta: nine, course_par: 36, game_type: "fourball", pairings: [], foursomes: [{ id: "f1", name: "Match 1", a: ["fa1", "fa2"], b: ["fb1", "fb2"] }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: g.id, scores: p.team === "A" ? a : b }));
  const s = scoreCompetitionGame(g, ps);
  assert.equal(s.matches[0].result, "5 & 3");
  assert.equal(s.matches[0].thru, 6);
  assert.equal(s.matches[0].lead, 5);
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
ok("Ryder Cup Trifecta expands each foursome into two Singles and one Four-Ball match", () => {
  const g: Game = { ...game, id: "tri", holes_meta: oneHole, course_par: 4, game_type: "trifecta", pairings: [], trifecta_scoring: "match", team_score_mode: "best_ball", foursomes: [{ id: "f1", name: "Group 1", a: ["fa1", "fa2"], b: ["fb1", "fb2"] }] };
  const ps = teamPlayers.map((p) => ({ ...p, game_id: g.id }));
  const s = scoreCompetitionGame(g, ps);
  assert.equal(s.matchCount, 3);
  assert.equal(s.decidedCount, 3);
  assert.deepEqual(s.matches.map((m) => m.key), ["f1-single-0", "f1-single-1", "f1-team-2"]);
});
ok("Ryder Cup Trifecta Singles allocate strokes within each head-to-head pair", () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
  const members = [
    { id: "a1", ch: 10, gross: Array(18).fill(4) }, { id: "a2", ch: 0, gross: Array(18).fill(4) },
    { id: "b1", ch: 12, gross: Array(18).fill(4) }, { id: "b2", ch: 0, gross: Array(18).fill(4) },
  ];
  const tri = computeTrifecta(eighteen, members, ["a1", "a2"], ["b1", "b2"], 100, "best_ball", false, "match");
  assert.equal(tri.contests[0].perHole[0].r, -1);
  assert.equal(tri.contests[0].perHole[10].r, 0);
});

console.log(`competition: ${n} passed, 0 failed`);
