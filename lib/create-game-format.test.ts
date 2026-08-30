import {
  formatReviewLabel,
  reachableFormatKeys,
  selectGuidedFamily,
  selectGuidedMatchKind,
  selectGuidedStrokeFormat,
  selectGuidedTeamFormat,
  setGuidedTeamMode,
  skinsStyleFromState,
  type CreateFormatState,
  type GuidedFormatState,
} from "./create-game-format";

let n = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  n++;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const guided: GuidedFormatState = {
  gameType: "stableford", teamMode: false, skinsTeamStyle: "head_to_head",
  teamScoreMode: "best_ball", trifectaScoring: "per_hole", strokeBasis: "net",
  skinsMode: "carryover", fmtFamily: "stroke", matchKind: "ind",
};

// Characterization of the restored 177.56 inline handlers. These assertions lock
// the exact old observable transitions before the React buttons delegate to helpers.
eq(selectGuidedFamily(guided, "stroke"), { fmtFamily: "stroke" }, "stroke family from stableford");
eq(selectGuidedFamily({ ...guided, gameType: "match", fmtFamily: "match" }, "stroke"), { fmtFamily: "stroke", gameType: "stableford" }, "match to stroke family");
eq(selectGuidedFamily({ ...guided, gameType: "fourball", fmtFamily: "match", matchKind: "team" }, "stroke"), { fmtFamily: "stroke", gameType: "stableford" }, "fourball to stroke family");
eq(selectGuidedFamily({ ...guided, gameType: "skins", teamMode: true, skinsTeamStyle: "head_to_head" }, "stroke"), { fmtFamily: "stroke", teamMode: false, skinsTeamStyle: "head_to_head" }, "team 1:1 skins to stroke family");
eq(selectGuidedFamily({ ...guided, gameType: "stableford", matchKind: "ind" }, "match"), { fmtFamily: "match", gameType: "match" }, "stroke to individual match family");
eq(selectGuidedFamily({ ...guided, gameType: "stroke", matchKind: "team" }, "match"), { fmtFamily: "match", gameType: "fourball" }, "stroke to team match family");
eq(selectGuidedFamily({ ...guided, gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball", fmtFamily: "match", matchKind: "team" }, "match"), { fmtFamily: "match" }, "best-ball skins stays match family");

eq(selectGuidedStrokeFormat("stableford"), { gameType: "stableford" }, "select stableford");
eq(selectGuidedStrokeFormat("stroke"), { gameType: "stroke" }, "select stroke");
eq(selectGuidedStrokeFormat("skins"), { gameType: "skins", teamMode: false, skinsTeamStyle: "head_to_head" }, "select stroke skins");

eq(selectGuidedMatchKind({ ...guided, gameType: "fourball", fmtFamily: "match", matchKind: "team" }, "ind"), { matchKind: "ind", gameType: "match" }, "team branch to individual");
eq(selectGuidedMatchKind({ ...guided, gameType: "match", fmtFamily: "match", matchKind: "ind" }, "team"), { matchKind: "team", gameType: "fourball" }, "individual to team branch");
eq(selectGuidedMatchKind({ ...guided, gameType: "trifecta", fmtFamily: "match", matchKind: "team" }, "team"), { matchKind: "team" }, "team branch keeps trifecta");

eq(selectGuidedTeamFormat("fourball"), { gameType: "fourball", teamMode: true }, "select fourball");
eq(selectGuidedTeamFormat("trifecta"), { gameType: "trifecta" }, "select trifecta");
eq(selectGuidedTeamFormat("skins"), { gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball" }, "select best-ball skins");
eq(setGuidedTeamMode(true), { teamMode: true }, "enable team mode");
eq(setGuidedTeamMode(false), { teamMode: false }, "disable team mode");

// Round trips important to the working Production-style hierarchy.
const apply = (s: GuidedFormatState, p: Partial<GuidedFormatState>): GuidedFormatState => ({ ...s, ...p });
let rt = apply(guided, selectGuidedFamily(guided, "match"));
rt = apply(rt, selectGuidedMatchKind(rt, "team"));
rt = apply(rt, selectGuidedTeamFormat("trifecta"));
rt = apply(rt, selectGuidedFamily(rt, "stroke"));
eq({ gameType: rt.gameType, fmtFamily: rt.fmtFamily }, { gameType: "stableford", fmtFamily: "stroke" }, "match team trifecta round-trip to stroke");
rt = apply(rt, selectGuidedFamily(rt, "match"));
eq({ gameType: rt.gameType, matchKind: rt.matchKind, fmtFamily: rt.fmtFamily }, { gameType: "fourball", matchKind: "team", fmtFamily: "match" }, "round-trip restores team branch selection method");

const base: CreateFormatState = { gameType: "stableford", teamMode: false, skinsTeamStyle: "head_to_head", teamScoreMode: "best_ball", trifectaScoring: "per_hole", strokeBasis: "net", skinsMode: "carryover" };
eq(skinsStyleFromState({ teamMode: false, skinsTeamStyle: "best_ball" }), "individual", "individual ignores stale style");
eq(skinsStyleFromState({ teamMode: true, skinsTeamStyle: "head_to_head" }), "team_11", "team 1:1 style");
eq(skinsStyleFromState({ teamMode: true, skinsTeamStyle: "best_ball" }), "team_2v2", "team 2v2 style");
eq(formatReviewLabel(base), "Stableford", "stableford review");
eq(formatReviewLabel({ ...base, gameType: "stroke", strokeBasis: "gross" }), "Stroke Play · Gross", "stroke review");
eq(formatReviewLabel({ ...base, gameType: "match", teamMode: true }), "Match Play · Team", "match review");
eq(formatReviewLabel({ ...base, gameType: "fourball", teamMode: false, teamScoreMode: "aggregate" }), "Four-ball · Team vs Team · Shootout", "fourball review");
eq(formatReviewLabel({ ...base, gameType: "trifecta", trifectaScoring: "match" }), "Trifecta · Best ball · Ryder Cup", "trifecta review");
eq(formatReviewLabel({ ...base, gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball", teamScoreMode: "aggregate", skinsMode: "split" }), "Skins · 2 v 2 Best-ball · Aggregate · Halved", "skins review");

const keys = reachableFormatKeys();
eq(keys.length, 19, "current reachable format shape count");
eq(new Set(keys).size, keys.length, "historical keys unique");
for (const required of ["stableford", "stroke:net", "stroke:gross", "match:individual", "match:team", "fourball:team:aggregate", "trifecta:aggregate:match", "skins:individual:split", "skins:team_11:carryover", "skins:team_2v2:aggregate:split"]) eq(keys.includes(required), true, `reachable ${required}`);

console.log(`create-game-format: ${n}/${n} assertions passed`);
