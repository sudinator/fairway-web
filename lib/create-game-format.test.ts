import { formatReviewLabel, reachableFormatKeys, selectBaseFormat, selectFourballCompetition, selectMatchPlayers, selectSkinsStyle, skinsStyleFromState, type CreateFormatState } from "./create-game-format";

let n = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  n++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

eq(selectBaseFormat("stableford"), { gameType: "stableford", teamMode: false, fmtFamily: "stroke", matchKind: "ind" }, "stableford patch");
eq(selectBaseFormat("stroke"), { gameType: "stroke", teamMode: false, fmtFamily: "stroke", matchKind: "ind" }, "stroke patch");
eq(selectBaseFormat("match"), { gameType: "match", teamMode: false, fmtFamily: "match", matchKind: "ind" }, "match patch");
eq(selectBaseFormat("fourball"), { gameType: "fourball", teamMode: false, fmtFamily: "match", matchKind: "team" }, "fourball patch");
eq(selectBaseFormat("trifecta"), { gameType: "trifecta", teamMode: false, fmtFamily: "match", matchKind: "team" }, "trifecta patch");
eq(selectBaseFormat("skins"), { gameType: "skins", teamMode: false, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "ind" }, "skins patch");

eq(selectMatchPlayers("individual"), { gameType: "match", teamMode: false, fmtFamily: "match", matchKind: "ind" }, "match individual");
eq(selectMatchPlayers("team"), { gameType: "match", teamMode: true, fmtFamily: "match", matchKind: "team" }, "match team");
eq(selectFourballCompetition("2v2"), { gameType: "fourball", teamMode: false, fmtFamily: "match", matchKind: "team" }, "fourball 2v2");
eq(selectFourballCompetition("team"), { gameType: "fourball", teamMode: true, fmtFamily: "match", matchKind: "team" }, "fourball team");
eq(selectSkinsStyle("individual"), { gameType: "skins", teamMode: false, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "ind" }, "skins individual");
eq(selectSkinsStyle("team_11"), { gameType: "skins", teamMode: true, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "team" }, "skins 1:1");
eq(selectSkinsStyle("team_2v2"), { gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball", fmtFamily: "match", matchKind: "team" }, "skins 2v2");

eq(skinsStyleFromState({ teamMode: false, skinsTeamStyle: "best_ball" }), "individual", "individual ignores stale style");
eq(skinsStyleFromState({ teamMode: true, skinsTeamStyle: "head_to_head" }), "team_11", "team 1:1 style");
eq(skinsStyleFromState({ teamMode: true, skinsTeamStyle: "best_ball" }), "team_2v2", "team 2v2 style");

const base: CreateFormatState = { gameType: "stableford", teamMode: false, skinsTeamStyle: "head_to_head", teamScoreMode: "best_ball", trifectaScoring: "per_hole", strokeBasis: "net", skinsMode: "carryover" };
eq(formatReviewLabel(base), "Stableford", "stableford review");
eq(formatReviewLabel({ ...base, gameType: "stroke", strokeBasis: "gross" }), "Stroke Play · Gross", "stroke review");
eq(formatReviewLabel({ ...base, gameType: "match", teamMode: true }), "Match Play · Team", "match review");
eq(formatReviewLabel({ ...base, gameType: "fourball", teamMode: false, teamScoreMode: "aggregate" }), "Four-ball · 2 v 2 Match · Shootout", "fourball review");
eq(formatReviewLabel({ ...base, gameType: "trifecta", trifectaScoring: "match" }), "Trifecta · Best ball · Ryder Cup", "trifecta review");
eq(formatReviewLabel({ ...base, gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball", teamScoreMode: "aggregate", skinsMode: "split" }), "Skins · 2 v 2 Best-ball · Aggregate · Halved", "skins review");

const keys = reachableFormatKeys();
eq(keys.length, 21, "historical shape count");
eq(new Set(keys).size, keys.length, "historical keys unique");
for (const required of ["stableford", "stroke:net", "stroke:gross", "match:individual", "match:team", "fourball:2v2:best_ball", "fourball:team:aggregate", "trifecta:aggregate:match", "skins:individual:split", "skins:team_11:carryover", "skins:team_2v2:aggregate:split"]) eq(keys.includes(required), true, `reachable ${required}`);

console.log(`create-game-format: ${n}/${n} assertions passed`);
