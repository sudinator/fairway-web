// BASELINE — the ORIGINAL player-scoring logic exactly as it was inlined in GameRoom
// (tournaments.tsx) BEFORE the 176.21 extraction, transcribed verbatim and parameterized with
// `game`. This exists only to prove, via player-scoring.diff.test.ts, that the extracted module
// produces identical results to the pre-change code. Not imported by the app.
import type { Game, Player } from "./game-types";
import { allocateStrokes, applyAllowance, stablefordPts, type Hole } from "./golf";
import { chBasis } from "./game-shape";

export function playerHoles(p: Player, game: Game | null): Hole[] {
  if (!game) return [];
  const alloc = allocateStrokes(
    game.holes_meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })),
    applyAllowance(chBasis(p, game.course_par), game.allowance_pct ?? 100),
  );
  return game.holes_meta.map((m, i) => ({
    hole_number: m.n,
    par: m.par,
    stroke_index: m.si,
    strokes: p.scores?.[i] ?? null,
    putts: p.putts?.[i] ?? null,
    fairway: p.fairways?.[i] ?? null,
    penalties: 0,
    recv: alloc[m.n] || 0,
  }));
}

export function playerPoints(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce(
    (s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0),
    0,
  );
}

export function playerThru(p: Player): number {
  return (p.scores || []).filter((s) => s != null && s > 0).length;
}

export function playerGross(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes : 0), 0);
}

export function playerNet(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce(
    (s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes - (h.recv || 0) : 0),
    0,
  );
}

export function relToParStr(p: Player, game: Game | null): string {
  const rel = 2 * playerThru(p) - playerPoints(p, game);
  return rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
}

export function parThru(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s2, h) => s2 + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0);
}

export function leaderName(full: string): string {
  const n = (full || "").trim();
  if (n.length <= 15) return n;
  const parts = n.split(/\s+/);
  if (parts.length > 1) { const c = parts[0] + " " + parts[parts.length - 1][0]; return c.length <= 15 ? c : parts[0].slice(0, 15); }
  return n.slice(0, 15);
}

// ---- Ranking values (baseline: transcribed from the original GameRoom, where game is non-null) ----
export function ouVal(p: Player, game: Game): number {
  return playerThru(p) === 0 ? Infinity : 2 * playerThru(p) - playerPoints(p, game);
}
export function strokeTotal(p: Player, game: Game): number {
  const strokeNet = game.stroke_basis !== "gross"; // default to net
  return strokeNet ? playerNet(p, game) : playerGross(p, game);
}
export function rankVal(p: Player, game: Game): number {
  const isStroke = game.game_type === "stroke";
  return isStroke ? (playerThru(p) === 0 ? Infinity : strokeTotal(p, game)) : ouVal(p, game);
}

// ---- Leaderboard ordering (baseline: transcribed from the original GameRoom; game non-null,
// isStroke was a closure over game.game_type) ----
export function sortLeaderboard(players: Player[], game: Game): Player[] {
  const isStroke = game.game_type === "stroke";
  return [...players].sort((a, b) => {
    const d = rankVal(a, game) - rankVal(b, game);
    if (d !== 0) return d;
    return isStroke ? 0 : playerPoints(b, game) - playerPoints(a, game);
  });
}
export function posWithin(p: Player, pool: Player[], game: Game): number {
  return pool.filter((x) => rankVal(x, game) < rankVal(p, game)).length + 1;
}
export function tiedWithin(p: Player, pool: Player[], game: Game): boolean {
  return pool.filter((x) => rankVal(x, game) === rankVal(p, game)).length > 1;
}
