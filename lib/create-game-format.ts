import type { GameTypeOpt } from "./game-create";
import type { MatchLength } from "./match-length";

export type CreateFormatState = {
  gameType: GameTypeOpt;
  teamMode: boolean;
  skinsTeamStyle: "head_to_head" | "best_ball";
  teamScoreMode: "best_ball" | "aggregate";
  trifectaScoring: "per_hole" | "match";
  strokeBasis: "net" | "gross";
  skinsMode: "carryover" | "split";
  /**
   * 18 holes, front nine or back nine. Applies to EVERY format, not just alternate shot — a
   * nine-hole singles match or four-ball is just as ordinary. Optional so existing drafts and
   * saved games, which predate the setting, keep behaving as 18 holes.
   */
  matchLength?: MatchLength;
};

export type GuidedFormatState = CreateFormatState & {
  fmtFamily: "stroke" | "match";
  matchKind: "ind" | "team";
};

export type CreateFormatPatch = Partial<GuidedFormatState>;

// These helpers model the actual restored Production-style Create Game controls.
// They intentionally describe user actions in the guided hierarchy rather than
// inventing a second flat format model. The React caller owns state setters and
// allowance defaults; these helpers own which format-state fields each click changes.
export function selectGuidedFamily(state: GuidedFormatState, family: "stroke" | "match"): CreateFormatPatch {
  if (family === "stroke") {
    if (state.gameType === "match" || state.gameType === "fourball" || state.gameType === "trifecta") {
      return { fmtFamily: "stroke", gameType: "stableford" };
    }
    if (state.gameType === "skins") {
      return { fmtFamily: "stroke", teamMode: false, skinsTeamStyle: "head_to_head" };
    }
    return { fmtFamily: "stroke" };
  }

  const isBestBallSkins = state.gameType === "skins" && state.teamMode && state.skinsTeamStyle === "best_ball";
  if (!isBestBallSkins && (state.gameType === "stableford" || state.gameType === "stroke" || state.gameType === "skins")) {
    return { fmtFamily: "match", gameType: state.matchKind === "team" ? "fourball" : "match" };
  }
  return { fmtFamily: "match" };
}

export function selectGuidedStrokeFormat(gameType: "stableford" | "stroke" | "skins"): CreateFormatPatch {
  if (gameType === "skins") return { gameType, teamMode: false, skinsTeamStyle: "head_to_head" };
  return { gameType };
}

export function selectGuidedMatchKind(state: GuidedFormatState, kind: "ind" | "team"): CreateFormatPatch {
  if (kind === "ind") return { matchKind: "ind", gameType: "match" };
  return state.gameType === "fourball" || state.gameType === "trifecta"
    ? { matchKind: "team" }
    : { matchKind: "team", gameType: "fourball" };
}

export function selectGuidedTeamFormat(
  gameType: "fourball" | "trifecta" | "skins" | "alt_shot",
): CreateFormatPatch {
  if (gameType === "skins") return { gameType, teamMode: true, skinsTeamStyle: "best_ball" };
  if (gameType === "fourball") return { gameType, teamMode: true };
  if (gameType === "alt_shot") {
    // One ball per side, so best-ball vs aggregate does not apply — forced rather than left over
    // from four-ball, where it would sit in the review label claiming a choice this format lacks.
    //
    // The 50% allowance is NOT set here. applyGuidedFormatPatch does not read an allowance field,
    // so returning one would have been silently dropped and the format would have played off 100%
    // — roughly twice the strokes, with nothing on screen to say so. The per-format default lives
    // in selectGameType alongside four-ball's and trifecta's.
    return { gameType, teamMode: true, teamScoreMode: "best_ball" };
  }
  return { gameType };
}

export function setGuidedTeamMode(enabled: boolean): CreateFormatPatch {
  return { teamMode: enabled };
}

export function skinsStyleFromState(state: Pick<CreateFormatState, "teamMode" | "skinsTeamStyle">): "individual" | "team_11" | "team_2v2" {
  if (!state.teamMode) return "individual";
  return state.skinsTeamStyle === "best_ball" ? "team_2v2" : "team_11";
}

export function formatReviewLabel(state: CreateFormatState): string {
  switch (state.gameType) {
    case "stableford": return "Stableford";
    case "stroke": return `Stroke Play · ${state.strokeBasis === "gross" ? "Gross" : "Net"}`;
    case "match": return `Match Play · ${state.teamMode ? "Team" : "Individual"}`;
    case "fourball": return `Four-ball · Team vs Team · ${state.teamScoreMode === "aggregate" ? "Shootout" : "Best ball"}`;
    case "trifecta": return `Trifecta · ${state.teamScoreMode === "aggregate" ? "Shootout" : "Best ball"} · ${state.trifectaScoring === "match" ? "Ryder Cup" : "Per hole"}`;
    case "alt_shot":
      // One ball per side, so there is no best-ball/aggregate choice to state — that is the whole
      // difference from four-ball. The match length is worth showing because a nine is a genuinely
      // different match, not a shorter one.
      return `Alternate Shot · 2 v 2 Match${state.matchLength && state.matchLength !== "18" ? ` · ${state.matchLength === "front9" ? "Front 9" : "Back 9"}` : ""}`;
    case "skins": {
      const style = skinsStyleFromState(state);
      const styleLabel = style === "individual" ? "Individual" : style === "team_11" ? "1:1 Teams" : "2 v 2 Best-ball";
      const scoreLabel = style === "team_2v2" ? ` · ${state.teamScoreMode === "aggregate" ? "Aggregate" : "Best ball"}` : "";
      return `Skins · ${styleLabel}${scoreLabel} · ${state.skinsMode === "split" ? "Halved" : "Carry over"}`;
    }
  }
}

export function reachableFormatKeys(): string[] {
  const out = ["stableford", "stroke:net", "stroke:gross", "match:individual", "match:team"];
  for (const score of ["best_ball", "aggregate"] as const) out.push(`fourball:team:${score}`);
  for (const score of ["best_ball", "aggregate"] as const) for (const scoring of ["per_hole", "match"] as const) out.push(`trifecta:${score}:${scoring}`);
  for (const ties of ["carryover", "split"] as const) {
    out.push(`skins:individual:${ties}`);
    out.push(`skins:team_11:${ties}`);
    for (const score of ["best_ball", "aggregate"] as const) out.push(`skins:team_2v2:${score}:${ties}`);
  }
  return out;
}
