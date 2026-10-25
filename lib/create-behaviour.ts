/**
 * 212.38 — ONE-STEP CREATION, PHASE 1: the record of what today's Create step saves, for any format combination.
 * It runs the real rules the Create screen uses — the format buttons replayed (lib/create-game-format), the allowance
 * and scramble settings (lib/game-create), the game and player rows (buildGamePayload / buildPlayerRows), the split
 * skins check, and where Create sends the organizer — on one fixed course and roster. lib/create-behaviour.test pins the
 * result for every combination in ci/golden/create-behaviour.json: the yardstick the one-step flow must match.
 */
import { buildGamePayload, buildPlayerRows, postCreateDestination, splitSkinsTooBig, scrambleCreateSettings, type RosterMember, type GuestEntry } from "./game-create";
import { replayFormatKey, formatReviewLabel, type ReplayedFormat } from "./create-game-format";
import { holesForLength, type MatchLength } from "./match-length";
import { shapeOf } from "./game-shape";

export const BEHAVIOUR_COURSE = {
  name: "Baseline Course", par: 72,
  holes: [4, 5, 3, 4, 4, 3, 5, 4, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5].map((par, i) => ({ n: i + 1, par, si: [7, 1, 17, 11, 3, 15, 9, 5, 13, 8, 2, 18, 6, 12, 4, 16, 10, 14][i] })),
  tees: [{ name: "Blue", rating: 72.3, slope: 133, yardages: Array.from({ length: 18 }, (_, i) => 350 + i * 7) }, { name: "White", rating: 70.7, slope: 132, yardages: Array.from({ length: 18 }, (_, i) => 330 + i * 7) }],
};
export const BEHAVIOUR_CREATOR = { id: "u-amit", display_name: "Amit Sud", handicap_index: 14.7 };
export const BEHAVIOUR_ROSTER: RosterMember[] = [
  { id: "u-raj", display_name: "Raj Mehta", handicap_index: 4.2 }, { id: "u-nihar", display_name: "Nihar Shah", handicap_index: 19.4 },
  { id: "u-karan", display_name: "Karan Patel", handicap_index: 6.4 }, { id: "u-sam", display_name: "Sam Lee", handicap_index: 22.4 },
  { id: "u-vikram", display_name: "Vikram Rao", handicap_index: 11.3 }, { id: "u-bo", display_name: "Bo Li", handicap_index: null },
];
export const BEHAVIOUR_GUESTS: GuestEntry[] = [{ id: "guest-1", display_name: "Guest Kumar", handicap_index: 18, guest_of: "u-amit" }];

export type CreateCase = { id: string; key: string; matchLength?: MatchLength; scrambleTeamSize?: 1 | 2 | 3 | 4; members?: number; guests?: number };
export function createBehaviour(c: CreateCase) {
  const f: ReplayedFormat = replayFormatKey(c.key, { matchLength: c.matchLength, scrambleTeamSize: c.scrambleTeamSize });
  const roster = BEHAVIOUR_ROSTER.slice(0, c.members ?? BEHAVIOUR_ROSTER.length), guests = BEHAVIOUR_GUESTS.slice(0, c.guests ?? BEHAVIOUR_GUESTS.length);
  const fieldCount = 1 + roster.length + guests.length;
  const courseHoles = holesForLength(BEHAVIOUR_COURSE.holes as never, f.matchLength);
  const tee = BEHAVIOUR_COURSE.tees[0];
  const game = buildGamePayload({
    code: "000000", activeGroupId: "club-1", name: "", courseName: BEHAVIOUR_COURSE.name, courseHoles,
    teeYardages: tee.yardages, coursePar: BEHAVIOUR_COURSE.par, matchDate: "2026-10-24", allowancePct: f.allowancePct,
    gameType: f.gameType, teamMode: f.teamMode, team1: "", team2: "", teamColors: undefined,
    skinsTeamStyle: f.skinsTeamStyle, teamScoreMode: f.teamScoreMode, strokeBasis: f.strokeBasis, skinsMode: f.skinsMode,
    flightsSupported: false, flightMode: "off", flightBands: null, sideContestsEnabled: true,
    scramble: scrambleCreateSettings({ gameType: f.gameType, cupScrambleSize: null, scrambleTeamSize: f.scrambleTeamSize ?? 4,
      scrambleHandicap: f.scrambleHandicap ?? "usga", scrambleMinDrives: f.scrambleMinDrives ?? null, scrambleAllowance: null, fmtFamily: f.fmtFamily }),
  } as never);
  const players = buildPlayerRows({
    gameId: "GAME", userId: BEHAVIOUR_CREATOR.id, displayName: BEHAVIOUR_CREATOR.display_name, idxVal: BEHAVIOUR_CREATOR.handicap_index,
    selectedPlayers: Object.fromEntries(roster.map((m) => [m.id, true])), groupRoster: roster, guestPlayers: guests, hcpOverrides: {},
    tee, tees: BEHAVIOUR_COURSE.tees, defaultTeeIdx: 0, coursePar: BEHAVIOUR_COURSE.par, holesCount: courseHoles.length,
    flightsSupported: false, flightMode: "off", flightBands: null, tgcBettingEnabled: false, sideContestsEnabled: true, includeCreator: true,
  });
  const blocked = splitSkinsTooBig(f.gameType, f.teamMode, f.skinsMode, fieldCount)
    ? "Split skins is best for up to 4 players. For a bigger group, use Team skins or 1:1 matchups, or switch Skins to carryover." : null;
  const sh = shapeOf(game as never) as unknown as Record<string, unknown>;
  const shape = Object.fromEntries(Object.entries(sh).filter(([, v]) => typeof v !== "function").sort(([a], [b]) => a.localeCompare(b)));
  return { id: c.id, key: c.key, label: formatReviewLabel(f), format: f, fieldCount, blocked, game, players, destination: postCreateDestination(f.gameType, f.teamMode), shape };
}

/** Every combination the Create screen can reach, plus the variants that change what is saved. */
export function behaviourCases(keys: string[]): CreateCase[] {
  const cases: CreateCase[] = keys.map((key) => ({ id: key, key }));
  cases.push(
    { id: "stableford · back nine", key: "stableford", matchLength: "back9" },
    { id: "alt_shot · front nine", key: "alt_shot", matchLength: "front9" },
    { id: "skins:individual:split · 4 players", key: "skins:individual:split", members: 3, guests: 0 },
    { id: "scramble:field · teams of 2", key: "scramble:field", scrambleTeamSize: 2 },
    { id: "scramble:field · captains only", key: "scramble:field", scrambleTeamSize: 1 },
    { id: "scramble:match · teams of 2", key: "scramble:match", scrambleTeamSize: 2 },
  );
  return cases;
}
