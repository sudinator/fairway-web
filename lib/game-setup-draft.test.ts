import { buildGameSetupDraft, fromLegacySetupDraft, toLegacySetupData, type GameSetupDraftInput } from "./game-setup-draft";
import type { SetupDraft } from "./setup-draft";

let n = 0;
function eq(actual: unknown, expected: unknown, label: string) {
  n++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}\nexpected ${e}\nactual   ${a}`);
}

const base: GameSetupDraftInput = {
  name: "Saturday Match",
  matchDate: "2026-08-16",
  favName: "Forest Hill",
  teeIdx: 2,
  idxStr: "8.4",
  selectedPlayers: { me: true, p2: true },
  guestPlayers: [{ id: "g1", display_name: "Guest One", handicap_index: 14.2, guest_of: "me" }],
  hcpOverrides: { p2: 11.3 },
  gameType: "fourball",
  allowancePct: 85,
  teamScoreMode: "best_ball",
  trifectaScoring: "per_hole",
  strokeBasis: "net",
  fmtFamily: "match",
  matchKind: "team",
  teamMode: true,
  skinsTeamStyle: "best_ball",
  skinsMode: "carryover",
  team1: "Blue",
  team2: "Gold",
  flightMode: "off",
  flightCount: 3,
  flightTeeIdx: { A: 0, B: 1 },
  playerTeeOverrides: { p2: 2 },
};

const legacyExpected = {
  name: base.name,
  matchDate: base.matchDate,
  favName: base.favName,
  teeIdx: base.teeIdx,
  idxStr: base.idxStr,
  gameType: base.gameType,
  allowancePct: base.allowancePct,
  teamScoreMode: base.teamScoreMode,
  trifectaScoring: base.trifectaScoring,
  strokeBasis: base.strokeBasis,
  fmtFamily: base.fmtFamily,
  matchKind: base.matchKind,
  teamMode: base.teamMode,
  skinsTeamStyle: base.skinsTeamStyle,
  skinsMode: base.skinsMode,
  team1: base.team1,
  team2: base.team2,
  flightMode: base.flightMode,
  flightCount: base.flightCount,
  flightTeeIdx: base.flightTeeIdx,
  playerTeeOverrides: base.playerTeeOverrides,
  hcpOverrides: base.hcpOverrides,
  selectedPlayers: base.selectedPlayers,
  guestPlayers: base.guestPlayers,
};

eq(toLegacySetupData(buildGameSetupDraft(base)), legacyExpected, "legacy serialization stays identical");
eq(buildGameSetupDraft(base).players.handicapOverrides, { p2: 11.3 }, "live handicap overrides are represented in canonical draft");

const legacy: SetupDraft = { v: 1, savedAt: 123, ...legacyExpected };
eq(toLegacySetupData(fromLegacySetupDraft(legacy)), legacyExpected, "legacy resume round-trip stays identical");
eq(fromLegacySetupDraft(legacy).players.handicapOverrides, { p2: 11.3 }, "resume restores persisted handicap overrides");
const oldLegacyWithoutTeeMaps: SetupDraft = { ...legacy };
delete (oldLegacyWithoutTeeMaps as any).flightTeeIdx;
delete (oldLegacyWithoutTeeMaps as any).playerTeeOverrides;
delete (oldLegacyWithoutTeeMaps as any).hcpOverrides;
eq(fromLegacySetupDraft(oldLegacyWithoutTeeMaps).flights.teeIdxByFlight, {}, "pre-177.50 draft resumes with no invented flight tees");
eq(fromLegacySetupDraft(oldLegacyWithoutTeeMaps).tees.playerOverrides, {}, "pre-177.50 draft resumes with no invented player tee overrides");
eq(fromLegacySetupDraft(oldLegacyWithoutTeeMaps).players.handicapOverrides, {}, "older draft resumes with no invented handicap overrides");

const gameTypes = ["stableford", "stroke", "match", "fourball", "skins", "trifecta"] as const;
for (let i = 0; i < 2000; i++) {
  const input: GameSetupDraftInput = {
    ...base,
    name: i % 3 ? `Game ${i}` : "",
    matchDate: `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
    favName: i % 5 ? `Course ${i % 7}` : null,
    teeIdx: i % 6,
    idxStr: i % 4 ? String((i % 540) / 10) : "",
    gameType: gameTypes[i % gameTypes.length],
    allowancePct: [50, 75, 85, 90, 100][i % 5],
    teamMode: i % 2 === 0,
    flightMode: i % 2 ? "oneoff" : "off",
    flightCount: 2 + (i % 3),
    selectedPlayers: { me: true, [`p${i % 9}`]: i % 2 === 0 },
    guestPlayers: i % 4 ? [] : [{ id: `g${i}`, display_name: `Guest ${i}`, handicap_index: i % 3 ? i / 100 : null, guest_of: "me" }],
    hcpOverrides: i % 7 ? {} : { [`p${i % 9}`]: i / 100 },
    flightTeeIdx: i % 3 ? {} : { A: i % 5, B: (i + 1) % 5 },
    playerTeeOverrides: i % 4 ? {} : { [`p${i % 9}`]: i % 5 },
  };
  const d = buildGameSetupDraft(input);
  const expected = {
    name: input.name, matchDate: input.matchDate, favName: input.favName, teeIdx: input.teeIdx, idxStr: input.idxStr,
    gameType: input.gameType, allowancePct: input.allowancePct, teamScoreMode: input.teamScoreMode,
    trifectaScoring: input.trifectaScoring, strokeBasis: input.strokeBasis, fmtFamily: input.fmtFamily,
    matchKind: input.matchKind, teamMode: input.teamMode, skinsTeamStyle: input.skinsTeamStyle, skinsMode: input.skinsMode,
    team1: input.team1, team2: input.team2, flightMode: input.flightMode, flightCount: input.flightCount,
    flightTeeIdx: input.flightTeeIdx, playerTeeOverrides: input.playerTeeOverrides, hcpOverrides: input.hcpOverrides,
    selectedPlayers: input.selectedPlayers, guestPlayers: input.guestPlayers,
  };
  eq(toLegacySetupData(d), expected, `differential legacy shape ${i}`);
}

console.log(`game-setup-draft: ${n}/${n} assertions passed`);
