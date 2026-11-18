/**
 * Games list — the richer row (212.126, owner, Nov 18): "we should add some more description like how many players,
 * once the game is FINAL, the person score and stableford points, differential, perhaps some summary stats".
 * Rules already decided: no money in any summary (game recap rule); shared-ball formats (scramble, alternate shot) show
 * the team result, no personal score or differential (shared-ball rule); the list only shows games the viewer plays in.
 * Everything is derived from what the app already computes: the viewer's posted round for the game (the Rounds tab's
 * figures) and the standings engine's per-game ranking — no new scoring arithmetic.
 */
import type { Game, Player } from "@/lib/game-types";
import { allocateStrokes, strokesOf, diffOf, toParStr, stablefordDisplay, roundDifferential, type Round } from "@/lib/golf";
import { gameTypeLabel } from "@/lib/game-create";
import * as PS from "@/lib/player-scoring";
import { matchOutcomes } from "@/lib/match-outcomes";
import type { TeamRound } from "@/lib/team-rounds";

const SHARED_BALL = new Set(["scramble", "alt_shot"]);
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th")}`;

/** The viewer's result in an ENDED game: a place among the finishers (individual formats) or the match outcome(s). */
export function gameResultFor(game: Game, players: Player[], userId: string): string | null {
  if (game.status !== "ended") return null;
  const holes = game.holes_meta?.length ?? 18;
  const finishers = players.filter((p) => !p.no_show && PS.playerThru(p) >= holes);
  const me = finishers.find((p) => p.user_id === userId);
  if (game.game_type === "stableford" || game.game_type === "stroke") {
    if (!me || finishers.length < 2) return null;
    const pos = PS.posWithin(me, finishers, game);
    const tied = finishers.some((p) => p !== me && PS.posWithin(p, finishers, game) === pos);
    return `${tied ? "T" : ""}${ordinal(pos)} of ${finishers.length}`;
  }
  if (game.game_type === "fourball" || game.game_type === "trifecta" || game.game_type === "match") {
    const mine: ("won" | "lost" | "halved")[] = [];
    for (const m of matchOutcomes(game, players)) {
      for (const side of ["a", "b"] as const) if (m[side].some((s) => s.userId === userId)) mine.push(m.winner === "halved" ? "halved" : m.winner === side ? "won" : "lost");
    }
    if (!mine.length) return null;
    if (mine.length === 1) return mine[0] === "won" ? "Won" : mine[0] === "lost" ? "Lost" : "Halved";
    const c = (k: string) => mine.filter((x) => x === k).length;
    return `W-L-H ${c("won")}-${c("lost")}-${c("halved")}`;
  }
  return null;   // skins and other formats: no single place to show
}

/** The viewer's own line from their posted round: gross (to par) · Stableford · differential · net birdies. */
export function myRoundLine(r: Round): string | null {
  const scored = (r.holes || []).filter((h) => h.strokes != null && h.strokes > 0);
  if (!scored.length) return null;
  const parts = [`Gross ${strokesOf(r)} (${toParStr(diffOf(r))})`];
  const pts = stablefordDisplay(r); if (pts !== "—") parts.push(pts);
  const diff = roundDifferential(r); if (diff != null) parts.push(`Diff ${diff.toFixed(1)}`);
  const alloc = allocateStrokes(scored.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index ?? null })), r.course_handicap == null ? null : Math.round(Number(r.course_handicap)));
  const nb = scored.filter((h) => h.par != null && (h.strokes || 0) - (alloc[h.hole_number] || 0) - (h.par || 0) <= -1).length;
  if (nb) parts.push(`${nb} net birdie${nb === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export type GameRowSummary = { meta: string; result: string | null; stats: string | null };

/** Everything the row shows beyond its name: format · players · course · date-or-code, the headline result, your line. */
export function gameRowSummary(game: Game, players: Player[], userId: string, myRound: Round | null, teamRound: TeamRound | null): GameRowSummary {
  const n = players.filter((p) => !p.no_show).length;
  const ended = game.status === "ended";
  const day = (game as { played_at?: string | null }).played_at || game.created_at;   // played_at is on the row, not yet on the Game type
  const date = day ? new Date(String(day).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  const meta = [gameTypeLabel(game.game_type as Parameters<typeof gameTypeLabel>[0]), n ? `${n} player${n === 1 ? "" : "s"}` : null, game.course || null, ended ? date : null].filter(Boolean).join(" · ");
  if (!ended) return { meta, result: null, stats: null };
  if (SHARED_BALL.has(game.game_type)) return { meta, result: teamRound?.result ?? null, stats: teamRound ? `${teamRound.team}` : null };
  return { meta, result: gameResultFor(game, players, userId), stats: myRound ? myRoundLine(myRound) : null };
}
