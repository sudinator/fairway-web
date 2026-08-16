import type { Game, Player } from "./game-types";

export type Pairing = Game["pairings"][number];
export type Foursome = NonNullable<Game["foursomes"]>[number];
export type TeamDef = NonNullable<Game["teams"]>[number];
export type StructureStash = NonNullable<Game["structure_stash"]>;

export const DEFAULT_TEAMS: TeamDef[] = [
  { key: "A", name: "Team 1" },
  { key: "B", name: "Team 2" },
];

export function buildFormatPatch(game: Game, next: Game["game_type"]): Record<string, unknown> {
  const suggested = next === "fourball" || next === "trifecta" ? 85 : 100;
  const patch: Record<string, unknown> = { game_type: next, allowance_pct: suggested };
  if (next === "trifecta" && !game.team_score_mode) patch.team_score_mode = "best_ball";
  if (next === "trifecta" && !game.trifecta_scoring) patch.trifecta_scoring = "per_hole";
  if (next === "stroke" && !game.stroke_basis) patch.stroke_basis = "net";
  return patch;
}

export function buildSkinsStylePatch(
  game: Game,
  activePlayerCount: number,
  style: "individual" | "team_11" | "team_2v2",
): { patch: Record<string, unknown>; flippedSplit: boolean } {
  const liveTeams = Array.isArray(game.teams) && game.teams.length === 2 ? game.teams : null;
  const liveFour = Array.isArray(game.foursomes) ? game.foursomes : null;
  const livePair = Array.isArray(game.pairings) ? game.pairings : [];
  const prev = game.structure_stash || {};
  const stash: StructureStash = {
    teams: liveTeams ?? prev.teams ?? null,
    foursomes: liveFour ?? prev.foursomes ?? null,
    pairings: (livePair.length ? livePair : prev.pairings) ?? [],
  };

  let teams: Game["teams"] = null;
  let foursomes: Game["foursomes"] = null;
  let pairings: Game["pairings"] = [];
  if (style === "team_11") {
    teams = stash.teams ?? DEFAULT_TEAMS;
    foursomes = null;
    pairings = stash.pairings ?? [];
  } else if (style === "team_2v2") {
    teams = stash.teams ?? DEFAULT_TEAMS;
    foursomes = stash.foursomes ?? [];
    pairings = stash.pairings ?? [];
  }

  const patch: Record<string, unknown> = { game_type: "skins", teams, foursomes, pairings, structure_stash: stash };
  let flippedSplit = false;
  if (style === "individual" && game.skins_mode === "split" && activePlayerCount > 4) {
    patch.skins_mode = "carryover";
    flippedSplit = true;
  }
  return { patch, flippedSplit };
}

export function buildMatchTeamPatch(game: Game, on: boolean): { teams: Game["teams"]; structure_stash: StructureStash } {
  const liveTeams = Array.isArray(game.teams) && game.teams.length === 2 ? game.teams : null;
  const prev = game.structure_stash || {};
  const structure_stash: StructureStash = { ...prev, teams: liveTeams ?? prev.teams ?? null };
  const teams = on ? (structure_stash.teams ?? DEFAULT_TEAMS) : null;
  return { teams, structure_stash };
}

export function addPairing(pairings: Pairing[], a: string, b: string): Pairing[] {
  if (!a || !b || a === b) return pairings;
  const dup = pairings.some((pr) => (pr.a === a && pr.b === b) || (pr.a === b && pr.b === a));
  return dup ? pairings : [...pairings, { a, b }];
}

export function removePairing(pairings: Pairing[], idx: number): Pairing[] {
  return pairings.filter((_, i) => i !== idx);
}

export function addFoursome(foursomes: Foursome[], id: string): Foursome[] {
  return [...foursomes, { id, name: `Foursome ${foursomes.length + 1}`, a: [], b: [] }];
}

export function removeFoursome(foursomes: Foursome[], id: string): Foursome[] {
  return foursomes.filter((f) => f.id !== id);
}

export function renameFoursome(foursomes: Foursome[], id: string, name: string): Foursome[] {
  return foursomes.map((f) => (f.id === id ? { ...f, name } : f));
}

export function assignFoursomePlayer(foursomes: Foursome[], fId: string, team: "a" | "b", uid: string): Foursome[] {
  const cleared = foursomes.map((f) => ({ ...f, a: f.a.filter((x) => x !== uid), b: f.b.filter((x) => x !== uid) }));
  return cleared.map((f) => {
    if (f.id !== fId) return f;
    const side = f[team];
    if (side.length >= 2) return f;
    return { ...f, [team]: [...side, uid] };
  });
}

export function unassignFoursomePlayer(foursomes: Foursome[], fId: string, team: "a" | "b", uid: string): Foursome[] {
  return foursomes.map((f) => (f.id === fId ? { ...f, [team]: f[team].filter((x) => x !== uid) } : f));
}

export function deriveTeeGroupsFromFoursomes(foursomes: Foursome[]): Record<string, number> {
  const groupOf: Record<string, number> = {};
  foursomes.forEach((f, i) => {
    [...f.a, ...f.b].forEach((uid) => { groupOf[uid] = i + 1; });
  });
  return groupOf;
}

export function applyTeamAssignment<T extends Pick<Player, "id" | "team">>(players: T[], playerId: string, team: string | null): T[] {
  return players.map((p) => (p.id === playerId ? { ...p, team } : p));
}
