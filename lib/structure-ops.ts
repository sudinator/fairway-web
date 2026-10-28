/**
 * 212.39 — ONE-STEP CREATION, PHASE 1 (part 2): what Manage Game SENDS when an organizer sets teams, matchups and
 * groups. Each function is the payload-building of a Manage Game save handler (components/tournaments.tsx and
 * components/game/scoring-views.tsx), moved here VERBATIM so the record of what Manage Game saves
 * (lib/structure-behaviour, ci/assert-structure-behaviour.sql) runs the real logic, and the one-step flow can reuse it.
 * The handlers call these and still make the same calls to the server. No behaviour change.
 */
import { deriveTeamFoursomesFromGroups, type Foursome } from "./game-structure";
import { scrambleTeeGroups, type ScrambleGroup } from "./scramble-teams";
import { pkey } from "./game-shape";
import type { Game, Player } from "./game-types";

type G = Pick<Game, "game_type" | "teams" | "foursomes"> & { scramble_mode?: string | null; scramble_team_size?: number | null };

/** The team formats whose foursomes are built from tee groups (four-ball, alternate shot, trifecta). */
export const isTeamGroupFormat = (game: G) =>
  Array.isArray(game.teams) && game.teams.length === 2 && (game.game_type === "fourball" || game.game_type === "alt_shot" || game.game_type === "trifecta");

/** setPlayerTeam / balanceTeamsByHandicap: the apply_game_structure arguments for moving players between teams. */
export function teamMoveArgs(gameId: string, game: G, nextPlayers: Player[], moves: { player: string; team: string | null }[]) {
  const foursomes = isTeamGroupFormat(game) ? deriveTeamFoursomesFromGroups(nextPlayers, game.teams!, game.foursomes) : null;
  return { p_game: gameId, p_teams: moves, p_groups: [] as { player: string; group: number | null }[], p_foursomes: foursomes };
}

/** syncTeamPlayFoursomes: after a tee-group change, the foursomes to save (null = nothing to save for this format). */
export function teamPlayFoursomesAfter(game: G, nextPlayers: Player[]): Foursome[] | null {
  if (!Array.isArray(game.teams) || game.teams.length !== 2) return null;
  // 212.65: + best-ball team skins (teams, foursomes present) — a 2 v 2 game like four-ball
  const bestBallSkins = game.game_type === "skins" && Array.isArray(game.foursomes);
  if (game.game_type !== "fourball" && game.game_type !== "alt_shot" && game.game_type !== "trifecta" && game.game_type !== "scramble" && !bestBallSkins) return null;
  return deriveTeamFoursomesFromGroups(nextPlayers, game.teams, game.foursomes);
}

/** 212.45: "Build balanced matchups" — the foursomes from the new groups, a Trifecta's singles ordered strong v strong
 * (swap chosen so the stronger A meets the stronger B). Moved verbatim from Manage Game's balanceMatchups so the
 * one-step Create draft uses the same rule. */
export function balancedMatchupFoursomes(game: G, nextPlayers: Player[], ph: (p: Player) => number): Foursome[] {
  const built = deriveTeamFoursomesFromGroups(nextPlayers, game.teams, game.foursomes);
  const keyOf = (p: Player) => p.user_id ?? p.id;
  return game.game_type === "trifecta"
    ? built.map((f) => {
        if (f.a.length !== 2 || f.b.length !== 2) return f;
        const phOf = (k: string) => { const p = nextPlayers.find((x) => keyOf(x) === k); return p ? ph(p) : 0; };
        const aStrongFirst = phOf(f.a[0]) <= phOf(f.a[1]);
        const bStrongFirst = phOf(f.b[0]) <= phOf(f.b[1]);
        return { ...f, swap: aStrongFirst !== bStrongFirst };
      })
    : built;
}

/** setScrambleTeams: each player's tee group once the scramble teams are saved (set_tee_groups assignments). */
export function scrambleTeeAssignments(game: G, players: Player[], groups: ScrambleGroup[]) {
  const tee = scrambleTeeGroups(groups, game.scramble_mode === "match" ? "match" : "field", game.scramble_team_size === 1);
  return players.map((p) => {
    const gr = groups.find((x) => x.a.includes(pkey(p)) || x.b.includes(pkey(p)));
    return { player: p.id, group: gr ? tee.get(gr.id) ?? null : null };
  });
}

/** setAltShotFirstDriver: the foursomes with one side's first driver set. */
export function altShotFirstDriverFoursomes(foursomes: Foursome[], foursomeId: string, side: "a" | "b", playerKey: string): Foursome[] {
  return foursomes.map((f) => f.id === foursomeId ? { ...f, [side === "a" ? "a_first" : "b_first"]: playerKey } : f);
}

/** setTrifectaPairing: the foursomes with one group's singles crossed (or not). */
export function trifectaSwapFoursomes(foursomes: Foursome[], foursomeId: string, cross: boolean): Foursome[] {
  return foursomes.map((f) => f.id === foursomeId ? { ...f, swap: cross } : f);
}

/** saveFoursomes (team skins foursome editor): each player whose tee group must change to match the foursomes. */
export function foursomeTeeGroupUpdates(players: Player[], groupOf: Record<string, number | null | undefined>) {
  return players.flatMap((p) => {
    const g = groupOf[pkey(p)] ?? null;
    return (p.tee_group ?? null) !== g ? [{ id: p.id, tee_group: g }] : [];
  });
}
