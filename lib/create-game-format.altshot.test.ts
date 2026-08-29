/**
 * The guided format flow, where alternate shot now sits: Match -> Team -> Alternate Shot.
 *
 * These assert the fields FORCED when a format is chosen. Leaving a previous format's answers in
 * place is how a game ends up claiming a choice it does not have, or handing out the wrong strokes
 * with nothing on screen to say so.
 */
import { selectGuidedTeamFormat, selectGuidedMatchKind, formatReviewLabel } from "./create-game-format";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`); }
};

const base = {
  gameType: "fourball" as never, teamMode: true, skinsTeamStyle: "head_to_head" as const,
  teamScoreMode: "aggregate" as const, trifectaScoring: "per_hole" as const,
  strokeBasis: "net" as const, skinsMode: "carryover" as const,
  fmtFamily: "match" as const, matchKind: "team" as const,
};

{
  const p = selectGuidedTeamFormat("alt_shot");
  eq("selects alternate shot", p.gameType, "alt_shot");
  ok("is a team format", p.teamMode === true);
  // Carried over from four-ball, "aggregate" would claim a scoring choice one ball cannot have.
  eq("forces best_ball (one ball: no aggregate)", p.teamScoreMode, "best_ball");
  // The allowance is deliberately NOT in the patch: applyGuidedFormatPatch does not read such a
  // field, so returning one would be silently dropped and the format would play off 100%. The
  // per-format default lives in selectGameType, verified by reading that function.
  eq("does not carry an allowance the applier ignores", (p as { allowancePct?: number }).allowancePct, undefined);
}
{
  // The other team formats keep their own behaviour.
  eq("four-ball is unchanged", selectGuidedTeamFormat("fourball"), { gameType: "fourball" });
  eq("trifecta is unchanged", selectGuidedTeamFormat("trifecta"), { gameType: "trifecta" });
  ok("team skins still forces best_ball style", selectGuidedTeamFormat("skins").skinsTeamStyle === "best_ball");
}
{
  // Choosing Individual from an alternate shot game must leave the team format behind.
  const p = selectGuidedMatchKind({ ...base, gameType: "alt_shot" as never }, "ind");
  eq("individual match play", p.gameType, "match");
}
{
  const label = formatReviewLabel({ ...base, gameType: "alt_shot" as never, matchLength: "18" });
  ok("review label names the format", label.includes("Alternate Shot"));
  ok("review label says 2 v 2", label.includes("2 v 2"));
  ok("18 holes is not spelled out (it is the default)", !label.includes("Front") && !label.includes("Back"));
}
{
  const back = formatReviewLabel({ ...base, gameType: "alt_shot" as never, matchLength: "back9" });
  ok("a nine IS spelled out", back.includes("Back 9"));
}

console.log(`create-game format: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
