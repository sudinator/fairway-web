import type { Game, Player } from "./game-types";
import { allocateStrokes, applyAllowance, stablefordPts, type Hole } from "./golf";
import { chBasis } from "./game-shape";

// Pure per-player scoring, extracted verbatim from GameRoom (tournaments.tsx). Each is a pure
// function of (player, game) — no component state — which makes them independently testable.

// Per-hole records for a player, including strokes RECEIVED (handicap allocation, allowance-adjusted).
// Returns [] when there's no game (matches the original guard).
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

// Total Stableford points (net; par = 2 pts).
export function playerPoints(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
}

// Holes played so far (a positive score entered).
export function playerThru(p: Player): number {
  return (p.scores || []).filter((s) => s != null && s > 0).length;
}

// Gross = total strokes on holes played.
export function playerGross(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes : 0), 0);
}

// Net = gross minus strokes received on the holes played.
export function playerNet(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s, h) => s + (h.strokes && h.strokes > 0 ? h.strokes - (h.recv || 0) : 0), 0);
}

// Net score relative to par, derived from Stableford (par = 2 pts/hole → rel = 2*thru − points).
// "-1" under, "E" even, "+2" over.
export function relToParStr(p: Player, game: Game | null): string {
  const rel = 2 * playerThru(p) - playerPoints(p, game);
  return rel === 0 ? "E" : rel > 0 ? `+${rel}` : `${rel}`;
}

// Par of the holes played so far (uncapped, for true stroke over/under par).
export function parThru(p: Player, game: Game | null): number {
  return playerHoles(p, game).reduce((s2, h) => s2 + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0);
}

// Compact leaderboard name: "First Last" → "First L" when long; otherwise trimmed/sliced to 15.
export function leaderName(full: string): string {
  const n = (full || "").trim();
  if (n.length <= 15) return n;
  const parts = n.split(/\s+/);
  if (parts.length > 1) {
    const c = parts[0] + " " + parts[parts.length - 1][0];
    return c.length <= 15 ? c : parts[0].slice(0, 15);
  }
  return n.slice(0, 15);
}

// ---- Ranking values (reuse the scoring functions above) ----
// Order-of-finish value for points games: lower is better; Infinity before a player starts.
export function ouVal(p: Player, game: Game | null): number {
  return playerThru(p) === 0 ? Infinity : 2 * playerThru(p) - playerPoints(p, game);
}
// Total used for stroke-play ranking: net or gross per the game's stroke basis (default net).
export function strokeTotal(p: Player, game: Game | null): number {
  const strokeNet = game?.stroke_basis !== "gross";
  return strokeNet ? playerNet(p, game) : playerGross(p, game);
}
// The value a player is ranked by (lower = better): stroke total for stroke play, else order-of-finish.
export function rankVal(p: Player, game: Game | null): number {
  const isStroke = game?.game_type === "stroke";
  return isStroke ? (playerThru(p) === 0 ? Infinity : strokeTotal(p, game)) : ouVal(p, game);
}

// ---- Leaderboard ordering (reuses rankVal / playerPoints) ----
// Sorted standings: by rank value (lower better); non-stroke ties broken by raw points (higher first).
export function sortLeaderboard(players: Player[], game: Game | null): Player[] {
  const isStroke = game?.game_type === "stroke";
  return [...players].sort((a, b) => {
    const d = rankVal(a, game) - rankVal(b, game);
    if (d !== 0) return d;
    return isStroke ? 0 : playerPoints(b, game) - playerPoints(a, game);
  });
}
// Position of p within a pool (1-based; players with a strictly better rank value count ahead).
export function posWithin(p: Player, pool: Player[], game: Game | null): number {
  return pool.filter((x) => rankVal(x, game) < rankVal(p, game)).length + 1;
}
// Whether p shares its rank value with anyone else in the pool.
export function tiedWithin(p: Player, pool: Player[], game: Game | null): boolean {
  return pool.filter((x) => rankVal(x, game) === rankVal(p, game)).length > 1;
}
