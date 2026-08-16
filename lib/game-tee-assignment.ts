import { flightForIndex, type FlightBand } from "./flights";

export type TeeOption = {
  name: string;
  rating: number;
  slope: number;
  yardages?: (number | null)[] | null;
};

export type TeeSource = "player" | "flight" | "game";

export type ResolveTeeInput = {
  participantKey: string;
  handicapIndex: number | null;
  tees: TeeOption[];
  defaultTeeIdx: number;
  playerTeeOverrides?: Record<string, number>;
  flightMode?: string;
  flightBands?: FlightBand[] | null;
  flightTeeIdx?: Record<string, number>;
};

export type ResolvedTee = {
  teeIdx: number;
  tee: TeeOption;
  source: TeeSource;
  flight: string | null;
};

function validIndex(tees: TeeOption[], idx: unknown): idx is number {
  return Number.isInteger(idx) && (idx as number) >= 0 && (idx as number) < tees.length;
}

// Create Game tee precedence is intentionally explicit:
// player override > flight tee > game default tee.
// The resolved tee is later persisted as an explicit game_players snapshot; inheritance
// is a draft-time convenience only and does not continue after game creation.
export function resolveCreateGameTee(i: ResolveTeeInput): ResolvedTee | null {
  if (!i.tees.length) return null;

  const flight = i.flightMode === "oneoff" && i.flightBands
    ? flightForIndex(i.handicapIndex, i.flightBands)
    : null;

  const playerIdx = i.playerTeeOverrides?.[i.participantKey];
  if (validIndex(i.tees, playerIdx)) {
    return { teeIdx: playerIdx, tee: i.tees[playerIdx], source: "player", flight };
  }

  const flightIdx = flight ? i.flightTeeIdx?.[flight] : undefined;
  if (validIndex(i.tees, flightIdx)) {
    return { teeIdx: flightIdx, tee: i.tees[flightIdx], source: "flight", flight };
  }

  const defaultIdx = validIndex(i.tees, i.defaultTeeIdx) ? i.defaultTeeIdx : 0;
  return { teeIdx: defaultIdx, tee: i.tees[defaultIdx], source: "game", flight };
}

export function teeSourceLabel(source: TeeSource, flight: string | null): string {
  if (source === "player") return "Player override";
  if (source === "flight") return flight ? `Flight ${flight}` : "Flight tee";
  return "Game default";
}

export function sanitizeTeeIndexMap(map: Record<string, number>, teeCount: number): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, idx] of Object.entries(map || {})) {
    if (Number.isInteger(idx) && idx >= 0 && idx < teeCount) next[key] = idx;
  }
  return next;
}
