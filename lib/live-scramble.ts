// 212.3: a scramble team's handicap from a PUBLIC feed (live page, Cup live page), where each player arrives with a
// course handicap (`ch`). The same method rule as the app (lib/game-shape scrambleMethodOf / scrambleTeamHandicapFor):
// captains only → agreed; agreed → the entered number, blank scratch; USGA → the game's percentages for the team's
// size (else the USGA's); legacy gross → 0.
import { scrambleTeamHandicap, customAllowanceFor } from "./scramble";
import { scrambleMethodOf } from "./game-shape";

export function liveScrambleTeamHandicap(
  game: { scramble_handicap?: string | null; scramble_team_size?: number | null; scramble_allowance?: unknown },
  chs: number[], entered: unknown,
): number {
  const method = scrambleMethodOf(game);
  if (method === "gross") return 0;
  if (method === "agreed") return typeof entered === "number" && Number.isFinite(entered) ? entered : 0;
  return scrambleTeamHandicap(chs, false, customAllowanceFor(game.scramble_allowance, chs.length))?.total ?? 0;
}
