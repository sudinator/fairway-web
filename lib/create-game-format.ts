import { defaultAllowanceFor, type GameTypeOpt } from "./game-create";
import type { MatchLength } from "./match-length";

export type CreateFormatState = {
  gameType: GameTypeOpt;
  teamMode: boolean;
  skinsTeamStyle: "head_to_head" | "best_ball";
  teamScoreMode: "best_ball" | "aggregate";
  strokeBasis: "net" | "gross";
  skinsMode: "carryover" | "split";
  /**
   * 18 holes, front nine or back nine. Applies to EVERY format, not just alternate shot — a
   * nine-hole singles match or four-ball is just as ordinary. Optional so existing drafts and
   * saved games, which predate the setting, keep behaving as 18 holes.
   */
  matchLength?: MatchLength;
  /** 211.1: scramble settings — optional so existing drafts load unchanged. */
  scrambleTeamSize?: 1 | 2 | 3 | 4;
  scrambleHandicap?: "usga" | "gross" | "agreed";
  scrambleMinDrives?: number | null;
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
  // 211.1: a scramble stays a scramble — under stroke play its teams share one leaderboard, under match play
  // they play team v team.
  if (state.gameType === "scramble") return family === "match" ? { fmtFamily: "match", matchKind: "team" } : { fmtFamily: "stroke" };
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

export function selectGuidedStrokeFormat(gameType: "stableford" | "stroke" | "skins" | "scramble"): CreateFormatPatch {
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
  gameType: "fourball" | "trifecta" | "skins" | "alt_shot" | "scramble",
): CreateFormatPatch {
  if (gameType === "scramble") return { gameType, teamMode: true };
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
    case "trifecta": return `Trifecta · ${state.teamScoreMode === "aggregate" ? "Shootout" : "Best ball"} · 2 singles + team, 1 pt each`;
    case "alt_shot":
      // One ball per side, so there is no best-ball/aggregate choice to state — that is the whole
      // difference from four-ball. The match length is worth showing because a nine is a genuinely
      // different match, not a shorter one.
      return `Alternate Shot · 2 v 2 Match${state.matchLength && state.matchLength !== "18" ? ` · ${state.matchLength === "front9" ? "Front 9" : "Back 9"}` : ""}`;
    case "scramble": {
      const size = state.scrambleTeamSize ?? 4;
      const drives = state.scrambleMinDrives ? ` · each drive ×${state.scrambleMinDrives}` : "";
      const method = size === 1 || state.scrambleHandicap === "agreed" ? "Agreed handicaps" : state.scrambleHandicap === "gross" ? "Gross" : "USGA handicaps";
      return `Scramble · ${size === 1 ? "Captains only · " : ""}${(state as Partial<GuidedFormatState>).fmtFamily === "match" ? "Team v team" : "Leaderboard"} · ${method}${drives}`;
    }
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
  for (const score of ["best_ball", "aggregate"] as const) out.push(`trifecta:${score}`);
  // 212.38: Alternate Shot has its own Create button (components/tournaments.tsx) but was missing from this list.
  out.push("alt_shot");
  for (const ties of ["carryover", "split"] as const) {
    out.push(`skins:individual:${ties}`);
    out.push(`skins:team_11:${ties}`);
    for (const score of ["best_ball", "aggregate"] as const) out.push(`skins:team_2v2:${score}:${ties}`);
  }
  // 211.1: scramble — one leaderboard (created under stroke play) or team v team (under match play).
  out.push("scramble:field", "scramble:match");
  return out;
}

/**
 * 212.38 (one-step creation, phase 1) — REPLAY the Create screen's format buttons. Each format combination is reached by
 * the same clicks a person makes, through the same helpers the buttons call, applied the way the screen applies them
 * (components/tournaments.tsx applyGuidedFormatPatch: every field a click names is set; choosing a format resets the
 * allowance to that format's default). Used to pin what Create saves for every combination (lib/create-behaviour.test).
 */
export type ReplayedFormat = GuidedFormatState & { allowancePct: number; matchLength: MatchLength };
/** The Create screen's starting state when it is not opened from a tee time or Ryder Cup session. */
export const CREATE_FORMAT_START: ReplayedFormat = {
  gameType: "stableford", teamMode: false, skinsTeamStyle: "head_to_head", teamScoreMode: "best_ball", strokeBasis: "net",
  skinsMode: "carryover", fmtFamily: "stroke", matchKind: "ind", allowancePct: 100, matchLength: "18",
  scrambleTeamSize: 4, scrambleHandicap: "usga", scrambleMinDrives: null,
};
export function applyCreateFormatPatch(s: ReplayedFormat, patch: CreateFormatPatch): ReplayedFormat {
  const n = { ...s };
  if (patch.gameType) { n.gameType = patch.gameType; n.allowancePct = defaultAllowanceFor(patch.gameType); }
  if (patch.fmtFamily) n.fmtFamily = patch.fmtFamily;
  if (patch.matchKind) n.matchKind = patch.matchKind;
  if (patch.teamMode !== undefined) n.teamMode = patch.teamMode;
  if (patch.skinsTeamStyle) n.skinsTeamStyle = patch.skinsTeamStyle;
  if (patch.teamScoreMode) n.teamScoreMode = patch.teamScoreMode;
  if (patch.strokeBasis) n.strokeBasis = patch.strokeBasis;
  if (patch.skinsMode) n.skinsMode = patch.skinsMode;
  return n;
}
/** The format state Create holds after the clicks for one reachable key (plus optional scramble size / nine). */
export function replayFormatKey(key: string, extra: { matchLength?: MatchLength; scrambleTeamSize?: 1 | 2 | 3 | 4 } = {}): ReplayedFormat {
  let s = { ...CREATE_FORMAT_START };
  const click = (f: (st: ReplayedFormat) => CreateFormatPatch) => { s = applyCreateFormatPatch(s, f(s)); };
  const [type, a, b, c] = key.split(":");
  const family = (fam: "stroke" | "match") => click((st) => selectGuidedFamily(st, fam));
  if (type === "stableford" || type === "stroke") {
    family("stroke"); click(() => selectGuidedStrokeFormat(type));
    if (type === "stroke") click(() => ({ strokeBasis: a as "net" | "gross" }));
  } else if (type === "match") {
    family("match"); click((st) => selectGuidedMatchKind(st, "ind"));
    if (a === "team") click(() => setGuidedTeamMode(true));
  } else if (type === "fourball" || type === "trifecta") {
    family("match"); click((st) => selectGuidedMatchKind(st, "team")); click(() => selectGuidedTeamFormat(type));
    click(() => ({ teamScoreMode: (type === "fourball" ? b : a) as "best_ball" | "aggregate" }));
  } else if (type === "alt_shot") {
    family("match"); click((st) => selectGuidedMatchKind(st, "team")); click(() => selectGuidedTeamFormat("alt_shot"));
  } else if (type === "skins") {
    if (a === "team_2v2") {
      family("match"); click((st) => selectGuidedMatchKind(st, "team")); click(() => selectGuidedTeamFormat("skins"));
      click(() => ({ teamScoreMode: b as "best_ball" | "aggregate", skinsMode: c as "carryover" | "split" }));
    } else {
      family("stroke"); click(() => selectGuidedStrokeFormat("skins"));
      if (a === "team_11") click(() => setGuidedTeamMode(true));
      click(() => ({ skinsMode: b as "carryover" | "split" }));
    }
  } else if (type === "scramble") {
    if (a === "match") { family("match"); click((st) => selectGuidedMatchKind(st, "team")); click(() => selectGuidedTeamFormat("scramble")); }
    else { family("stroke"); click(() => selectGuidedStrokeFormat("scramble")); }
  } else throw new Error(`unknown format key ${key}`);
  if (extra.matchLength) s.matchLength = extra.matchLength;
  if (extra.scrambleTeamSize) s.scrambleTeamSize = extra.scrambleTeamSize;
  return s;
}
