import type { GameTypeOpt } from "./game-create";

export type SkinsStyle = "individual" | "team_11" | "team_2v2";
export type FourballCompetition = "2v2" | "team";
export type MatchPlayers = "individual" | "team";

export type CreateFormatState = {
  gameType: GameTypeOpt;
  teamMode: boolean;
  skinsTeamStyle: "head_to_head" | "best_ball";
  teamScoreMode: "best_ball" | "aggregate";
  trifectaScoring: "per_hole" | "match";
  strokeBasis: "net" | "gross";
  skinsMode: "carryover" | "split";
};

export type CreateFormatPatch = Partial<CreateFormatState> & {
  fmtFamily?: "stroke" | "match";
  matchKind?: "ind" | "team";
};

export function selectBaseFormat(gameType: GameTypeOpt): CreateFormatPatch {
  switch (gameType) {
    case "stableford": return { gameType, teamMode: false, fmtFamily: "stroke", matchKind: "ind" };
    case "stroke": return { gameType, teamMode: false, fmtFamily: "stroke", matchKind: "ind" };
    case "match": return { gameType, teamMode: false, fmtFamily: "match", matchKind: "ind" };
    case "fourball": return { gameType, teamMode: false, fmtFamily: "match", matchKind: "team" };
    case "trifecta": return { gameType, teamMode: false, fmtFamily: "match", matchKind: "team" };
    case "skins": return { gameType, teamMode: false, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "ind" };
  }
}

export function selectMatchPlayers(mode: MatchPlayers): CreateFormatPatch {
  return mode === "team"
    ? { gameType: "match", teamMode: true, fmtFamily: "match", matchKind: "team" }
    : { gameType: "match", teamMode: false, fmtFamily: "match", matchKind: "ind" };
}

export function selectFourballCompetition(mode: FourballCompetition): CreateFormatPatch {
  return { gameType: "fourball", teamMode: mode === "team", fmtFamily: "match", matchKind: "team" };
}

export function selectSkinsStyle(style: SkinsStyle): CreateFormatPatch {
  if (style === "team_11") return { gameType: "skins", teamMode: true, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "team" };
  if (style === "team_2v2") return { gameType: "skins", teamMode: true, skinsTeamStyle: "best_ball", fmtFamily: "match", matchKind: "team" };
  return { gameType: "skins", teamMode: false, skinsTeamStyle: "head_to_head", fmtFamily: "stroke", matchKind: "ind" };
}

export function skinsStyleFromState(state: Pick<CreateFormatState, "teamMode" | "skinsTeamStyle">): SkinsStyle {
  if (!state.teamMode) return "individual";
  return state.skinsTeamStyle === "best_ball" ? "team_2v2" : "team_11";
}

export function formatReviewLabel(state: CreateFormatState): string {
  switch (state.gameType) {
    case "stableford": return "Stableford";
    case "stroke": return `Stroke Play · ${state.strokeBasis === "gross" ? "Gross" : "Net"}`;
    case "match": return `Match Play · ${state.teamMode ? "Team" : "Individual"}`;
    case "fourball": return `Four-ball · ${state.teamMode ? "Team vs Team" : "2 v 2 Match"} · ${state.teamScoreMode === "aggregate" ? "Shootout" : "Best ball"}`;
    case "trifecta": return `Trifecta · ${state.teamScoreMode === "aggregate" ? "Shootout" : "Best ball"} · ${state.trifectaScoring === "match" ? "Ryder Cup" : "Per hole"}`;
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
  for (const competition of ["2v2", "team"] as const) for (const score of ["best_ball", "aggregate"] as const) out.push(`fourball:${competition}:${score}`);
  for (const score of ["best_ball", "aggregate"] as const) for (const scoring of ["per_hole", "match"] as const) out.push(`trifecta:${score}:${scoring}`);
  for (const ties of ["carryover", "split"] as const) {
    out.push(`skins:individual:${ties}`);
    out.push(`skins:team_11:${ties}`);
    for (const score of ["best_ball", "aggregate"] as const) out.push(`skins:team_2v2:${score}:${ties}`);
  }
  return out;
}
