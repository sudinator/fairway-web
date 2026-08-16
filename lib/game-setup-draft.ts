import type { SetupDraft } from "./setup-draft";
import type { GameTypeOpt } from "./game-create";

export type DraftGuest = {
  id: string;
  display_name: string;
  handicap_index: number | null;
  guest_of: string;
};

export type GameSetupDraft = {
  version: 1;
  game: {
    name: string;
    matchDate: string;
    favoriteCourseName: string | null;
    defaultTeeIdx: number;
    creatorHandicapText: string;
  };
  players: {
    selectedPlayers: Record<string, boolean>;
    guestPlayers: DraftGuest[];
    // Current CreateGame keeps these in live state but the legacy device draft does
    // not persist them. Stage 1 records that contract explicitly without changing it.
    handicapOverrides: Record<string, number>;
  };
  format: {
    gameType: GameTypeOpt;
    allowancePct: number;
    teamScoreMode: "best_ball" | "aggregate";
    trifectaScoring: "per_hole" | "match";
    strokeBasis: "gross" | "net";
    fmtFamily: "stroke" | "match";
    matchKind: "ind" | "team";
    teamMode: boolean;
    skinsTeamStyle: "head_to_head" | "best_ball";
    skinsMode: "carryover" | "split";
  };
  structure: {
    team1: string;
    team2: string;
  };
  flights: {
    mode: "off" | "oneoff";
    count: number;
    teeIdxByFlight: Record<string, number>;
  };
  tees: {
    playerOverrides: Record<string, number>;
  };
};

export type GameSetupDraftInput = {
  name: string;
  matchDate: string;
  favName: string | null;
  teeIdx: number;
  idxStr: string;
  selectedPlayers: Record<string, boolean>;
  guestPlayers: DraftGuest[];
  hcpOverrides: Record<string, number>;
  gameType: GameTypeOpt;
  allowancePct: number;
  teamScoreMode: "best_ball" | "aggregate";
  trifectaScoring: "per_hole" | "match";
  strokeBasis: "gross" | "net";
  fmtFamily: "stroke" | "match";
  matchKind: "ind" | "team";
  teamMode: boolean;
  skinsTeamStyle: "head_to_head" | "best_ball";
  skinsMode: "carryover" | "split";
  team1: string;
  team2: string;
  flightMode: "off" | "oneoff";
  flightCount: number;
  flightTeeIdx: Record<string, number>;
  playerTeeOverrides: Record<string, number>;
};

export function buildGameSetupDraft(i: GameSetupDraftInput): GameSetupDraft {
  return {
    version: 1,
    game: {
      name: i.name,
      matchDate: i.matchDate,
      favoriteCourseName: i.favName,
      defaultTeeIdx: i.teeIdx,
      creatorHandicapText: i.idxStr,
    },
    players: {
      selectedPlayers: i.selectedPlayers,
      guestPlayers: i.guestPlayers,
      handicapOverrides: i.hcpOverrides,
    },
    format: {
      gameType: i.gameType,
      allowancePct: i.allowancePct,
      teamScoreMode: i.teamScoreMode,
      trifectaScoring: i.trifectaScoring,
      strokeBasis: i.strokeBasis,
      fmtFamily: i.fmtFamily,
      matchKind: i.matchKind,
      teamMode: i.teamMode,
      skinsTeamStyle: i.skinsTeamStyle,
      skinsMode: i.skinsMode,
    },
    structure: { team1: i.team1, team2: i.team2 },
    flights: { mode: i.flightMode, count: i.flightCount, teeIdxByFlight: i.flightTeeIdx },
    tees: { playerOverrides: i.playerTeeOverrides },
  };
}

export type LegacySetupData = Omit<SetupDraft, "v" | "savedAt">;

// Compatibility adapter for the device-local setup draft. Stage 3 extends the saved shape only
// with optional tee-inheritance maps; all pre-177.50 drafts remain valid and resume with empty maps.
export function toLegacySetupData(d: GameSetupDraft): LegacySetupData {
  return {
    name: d.game.name,
    matchDate: d.game.matchDate,
    favName: d.game.favoriteCourseName,
    teeIdx: d.game.defaultTeeIdx,
    idxStr: d.game.creatorHandicapText,
    gameType: d.format.gameType,
    allowancePct: d.format.allowancePct,
    teamScoreMode: d.format.teamScoreMode,
    trifectaScoring: d.format.trifectaScoring,
    strokeBasis: d.format.strokeBasis,
    fmtFamily: d.format.fmtFamily,
    matchKind: d.format.matchKind,
    teamMode: d.format.teamMode,
    skinsTeamStyle: d.format.skinsTeamStyle,
    skinsMode: d.format.skinsMode,
    team1: d.structure.team1,
    team2: d.structure.team2,
    flightMode: d.flights.mode,
    flightCount: d.flights.count,
    flightTeeIdx: d.flights.teeIdxByFlight,
    playerTeeOverrides: d.tees.playerOverrides,
    selectedPlayers: d.players.selectedPlayers,
    guestPlayers: d.players.guestPlayers,
  };
}

export function fromLegacySetupDraft(d: SetupDraft): GameSetupDraft {
  return buildGameSetupDraft({
    name: d.name,
    matchDate: d.matchDate,
    favName: d.favName,
    teeIdx: d.teeIdx,
    idxStr: d.idxStr,
    selectedPlayers: d.selectedPlayers || {},
    guestPlayers: d.guestPlayers || [],
    hcpOverrides: {},
    gameType: d.gameType as GameTypeOpt,
    allowancePct: d.allowancePct,
    teamScoreMode: d.teamScoreMode as "best_ball" | "aggregate",
    trifectaScoring: d.trifectaScoring as "per_hole" | "match",
    strokeBasis: d.strokeBasis as "gross" | "net",
    fmtFamily: d.fmtFamily as "stroke" | "match",
    matchKind: d.matchKind as "ind" | "team",
    teamMode: d.teamMode,
    skinsTeamStyle: d.skinsTeamStyle as "head_to_head" | "best_ball",
    skinsMode: d.skinsMode as "carryover" | "split",
    team1: d.team1,
    team2: d.team2,
    flightMode: d.flightMode === "oneoff" ? "oneoff" : "off",
    flightCount: d.flightCount && d.flightCount >= 2 && d.flightCount <= 4 ? d.flightCount : 3,
    flightTeeIdx: d.flightTeeIdx || {},
    playerTeeOverrides: d.playerTeeOverrides || {},
  });
}
