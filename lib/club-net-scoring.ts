/** Statistics use a known full course/team basis, never an opponent-relative handicap or an inferred scratch player. */
import type { Game, Player } from './game-types';
import type { Round } from './golf';
import { statisticalCourseHandicap, altShotSides, pkey, scrambleMethodOf, scrambleTeamHandicapFor, roundHandicapBasis } from './game-shape';
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null;
export function clubIndividualHandicap(p: Pick<Player, 'course_handicap'> & Partial<Player>, par: number | null | undefined, holes?: number): number | null {
  return number(statisticalCourseHandicap(p, par, holes));
}
export function clubGameHandicap(game: Game, players: Player[], player: Player): number | null {
  if (game.game_type !== 'scramble' && game.game_type !== 'alt_shot') return clubIndividualHandicap(player, game.course_par, game.holes_meta.length);
  const key = pkey(player), group = (game.foursomes || []).find(f => f.a.includes(key) || f.b.includes(key));
  if (!group) return null;
  const side = group.a.includes(key) ? 'a' : 'b', keys = group[side];
  if (game.game_type === 'scramble') {
    const method = scrambleMethodOf(game);
    if (method === 'gross') return 0; // An explicitly gross game deliberately has no adjustment.
    if (method === 'agreed') {
      const entered = (group as { a_hcp?: unknown; b_hcp?: unknown })[side === 'a' ? 'a_hcp' : 'b_hcp'];
      return number(entered); // An absent agreement is unknown for statistics, never silently scratch.
    }
  }
  const members = keys.map(k => players.find(p => pkey(p) === k));
  if (!members.length || members.some(p => !p || clubIndividualHandicap(p, game.course_par, game.holes_meta.length) == null)) return null;
  // Sanitize inputs to the existing team helpers so malformed derived values cannot bypass the null-aware gate.
  const safePlayers = players.map(p => ({ ...p, course_handicap: clubIndividualHandicap(p, game.course_par, game.holes_meta.length), course_handicap_source: 'manual' as const, handicap_index: null, rating: null, slope: null }));
  if (game.game_type === 'scramble') return number(scrambleTeamHandicapFor(game, safePlayers, key));
  const sides = altShotSides(game, safePlayers, group);
  return number(side === 'a' ? sides.aCh : sides.bCh);
}
export function clubPersonalHandicap(round: Partial<Pick<Round, "course_handicap" | "course_handicap_source" | "handicap_index" | "rating" | "slope" | "course_par">>): number | null {
  return roundHandicapBasis(round);
}
