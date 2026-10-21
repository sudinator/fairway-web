function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
import { scrambleTeamSizes, balanceScrambleTeams, scrambleTeamsOf, scrambleSetupProblem } from "./scramble-teams";
// sizes: as even as possible, always 2–4
eq(scrambleTeamSizes(16, 4), [4, 4, 4, 4], "16 in fours");
eq(scrambleTeamSizes(10, 4), [4, 3, 3], "10 in fours → 4, 3, 3 (not 4, 4, 2)");
eq(scrambleTeamSizes(9, 4), [3, 3, 3], "9 in fours → 3, 3, 3");
eq(scrambleTeamSizes(5, 4), [3, 2], "5 in fours → 3, 2");
eq(scrambleTeamSizes(7, 2), [3, 2, 2], "7 in twos → 3, 2, 2 (no one alone)");
eq(scrambleTeamSizes(1, 2), null, "1 player: no team");
// balanced: snake by course handicap — team 1 gets the best and the worst
const P = Array.from({ length: 16 }, (_, i) => ({ key: `p${String(i + 1).padStart(2, "0")}`, ch: i + 1 }));   // p01 lowest … p16 highest
const field = balanceScrambleTeams(P, 4, "field")!;
eq(field.map((g) => g.a), [["p01", "p08", "p09", "p16"], ["p02", "p07", "p10", "p15"], ["p03", "p06", "p11", "p14"], ["p04", "p05", "p12", "p13"]], "snake draft: each team a fair mix");
eq(field.map((g) => [g.id, g.name, g.b.length]), [["team-1", "Team 1", 0], ["team-2", "Team 2", 0], ["team-3", "Team 3", 0], ["team-4", "Team 4", 0]], "one team per group on a leaderboard");
const m = balanceScrambleTeams(P, 4, "match")!;
eq(m.map((g) => [g.name, g.a.length, g.b.length]), [["Match 1", 4, 4], ["Match 2", 4, 4]], "team v team: teams paired into matches");
eq(balanceScrambleTeams(P.slice(0, 10), 4, "field")!.map((g) => g.a.length), [4, 3, 3], "10 players: 4, 3, 3");
eq(scrambleTeamsOf(m).map((t) => [t.name, t.groupId, t.side]), [["Team 1", "match-1", "a"], ["Team 2", "match-1", "b"], ["Team 3", "match-2", "a"], ["Team 4", "match-2", "b"]], "teams read in order");
// setup completeness
const keys = P.map((p) => p.key);
eq(scrambleSetupProblem(field, keys, "field"), null, "balanced teams: complete");
eq(scrambleSetupProblem([], keys, "field"), "Make the teams — Setup → Teams.", "no teams yet");
eq(scrambleSetupProblem(field.slice(0, 3), keys, "field"), "4 players aren't on a team yet.", "players left out");
eq(scrambleSetupProblem([{ id: "x", name: "T", a: ["p01"], b: [] }, ...field.slice(1)], keys.filter((k) => !field[0].a.slice(1).includes(k)), "field"), "Team 1 has 1 player — a scramble team has 2 to 4.", "a one-player team");
eq(scrambleSetupProblem([{ ...field[0], b: [] }, ...field.slice(1)], keys, "match"), "Every match needs two teams.", "team v team without an opponent");
eq(scrambleSetupProblem([{ id: "x", name: "T", a: ["p01", "p02"], b: [] }, { id: "y", name: "U", a: ["p02", "p03"], b: [] }], ["p01", "p02", "p03"], "field"), "A player is on two teams.", "a player on two teams");
// 211.8 — one app player per team (teammates outside the app), and entered team handicaps
eq(scrambleTeamSizes(5, 1), [1, 1, 1, 1, 1], "size 1: every player is their own team");
const solo = balanceScrambleTeams(P.slice(0, 4), 1, "field")!;
eq(solo.map((g) => g.a.length), [1, 1, 1, 1], "four one-player teams");
const soloKeys = P.slice(0, 4).map((p) => p.key);
eq(scrambleSetupProblem(solo, soloKeys, "field", { size: 1, method: "agreed" }), null, "captains only uses agreed handicaps: a blank team plays scratch — complete");
eq(scrambleSetupProblem([...solo, { id: "e", name: "E", a: [], b: [] }], soloKeys, "field", { size: 1, method: "agreed" }), "A team has no players — add players to it or remove it.", "an empty team (pick teams myself) must be filled or removed");
eq(scrambleSetupProblem(solo, soloKeys, "field", { size: 4 }), "Team 1 has 1 player — a scramble team has 2 to 4.", "a one-player team in a normal scramble is still refused");
eq(scrambleTeamsOf([{ id: "t", name: "T", a: ["x", "y"], b: [], a_hcp: 11 }])[0].hcp, 11, "an entered team handicap is read");
console.log("scramble-teams tests passed");
