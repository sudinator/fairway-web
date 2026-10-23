import type { Game, Player } from "./game-types";
import { netBySix, stablefordBySix, stablefordPts } from "./golf";
import { playerHoles } from "./player-scoring";

export const SEG_LABELS = ["Holes 1\u20136", "Holes 7\u201312", "Holes 13\u201318"];

export type SegLeader = {
  label: string; complete: boolean; started: boolean; val: number | null;
  who: string[]; thruHole: number; leaderThru: number; maxPlayed: number;
};

// A player's per-six-hole totals: net strokes (stroke play) or Stableford points — front/mid/back.
// Reuses playerHoles + netBySix/stablefordBySix.
export function segOf(p: Player, game: Game | null): [number, number, number] {
  const isStroke = game?.game_type === "stroke";
  return isStroke ? netBySix(playerHoles(p, game)) : stablefordBySix(playerHoles(p, game));
}

// Leader(s) of each six-hole segment, with pace / tie / progress detail for the segment cards.
// Stroke: fewest net strokes vs par of holes played (lower better). Stableford: most points vs the
// par pace of 2/hole (higher better). Ties collect all leaders.
export function segLeadersFrom(rows: { p: Player; seg: [number, number, number] }[], game: Game | null): SegLeader[] {
  const isStroke = game?.game_type === "stroke";
  return [0, 1, 2].map((si) => {
    let bestPace = isStroke ? Infinity : -Infinity;
    let who: string[] = [];
    let leaderRaw: number | null = null;
    let leaderPlayed = 0;
    let started = false, maxPlayed = 0, allDone = true, anyActive = false;
    rows.forEach(({ p, seg }) => {
      const hs = playerHoles(p, game);
      if (!hs.some((h) => h.strokes)) return;
      anyActive = true;
      const segHoles = hs.slice(si * 6, si * 6 + 6);
      const played = segHoles.filter((h) => h.strokes).length;
      if (played < 6) allDone = false;
      if (played > 0) started = true;
      maxPlayed = Math.max(maxPlayed, played);
      if (played < 1) return;
      if (isStroke) {
        const parPlayed = segHoles.reduce((s, h) => s + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0);
        const pace = seg[si] - parPlayed;
        if (pace < bestPace) { bestPace = pace; who = [p.display_name]; leaderRaw = seg[si]; leaderPlayed = played; }
        else if (pace === bestPace) { who.push(p.display_name); leaderPlayed = Math.max(leaderPlayed, played); }
      } else {
        const pace = seg[si] - 2 * played;
        if (pace > bestPace) { bestPace = pace; who = [p.display_name]; leaderRaw = seg[si]; leaderPlayed = played; }
        else if (pace === bestPace) { who.push(p.display_name); leaderPlayed = Math.max(leaderPlayed, played); }
      }
    });
    const complete = anyActive && allDone && started;
    const thruHole = si * 6 + maxPlayed;
    const leaderThru = si * 6 + leaderPlayed;
    return { label: SEG_LABELS[si], complete, started, val: started ? leaderRaw : null, who, thruHole, leaderThru, maxPlayed };
  });
}

// ── 212.24 (owner): the segment side contest for INDIVIDUAL games (Stableford, stroke play), as the organizer chose —
// three sixes (the default), front 9 & back 9, or off. TGC money games are always three sixes: their payouts and clean
// sweep are built on them (lib/golf computeBetting, untouched — segOf / segLeadersFrom above stay as they are).
export type IndivSegScheme = "sixes" | "nines" | "none";

/** The scheme for this game: a money game is three sixes; otherwise the game's choice (leg_config.scheme), else sixes. */
export function indivSegScheme(game: Game | null, moneyGame: boolean): IndivSegScheme {
  if (moneyGame) return "sixes";
  const s = (game as { leg_config?: { scheme?: string } } | null)?.leg_config?.scheme;
  return s === "nines" ? "nines" : s === "none" ? "none" : "sixes";
}

/** The segments' hole ranges ([from, to), 0-based) and labels for a scheme over n holes. */
export function segRanges(scheme: IndivSegScheme, n: number): { from: number; to: number; label: string; short: string }[] {
  if (scheme === "none" || n <= 0) return [];
  const size = scheme === "nines" ? 9 : 6;
  const out: { from: number; to: number; label: string; short: string }[] = [];
  for (let s = 0; s < n; s += size) {
    const to = Math.min(s + size, n);
    out.push({ from: s, to, label: scheme === "nines" ? (s === 0 ? "Front 9" : "Back 9") : `Holes ${s + 1}\u2013${to}`, short: scheme === "nines" ? (s === 0 ? "Front" : "Back") : `${s + 1}\u2013${to}` });
  }
  return out;
}

/** A player's totals per segment — net strokes (stroke play) or Stableford points, summed as the three sixes are. */
export function segValues(p: Player, game: Game | null, ranges: { from: number; to: number }[]): number[] {
  const isStroke = game?.game_type === "stroke";
  const hs = playerHoles(p, game);
  return ranges.map(({ from, to }) => hs.slice(from, to).reduce((s, h) => s + (isStroke
    ? (h.strokes && h.strokes > 0 ? h.strokes - (h.recv || 0) : 0)
    : (stablefordPts(h.strokes, h.par, h.recv || 0) || 0)), 0));
}

/** Leader(s) of each segment — segLeadersFrom's rules, for any ranges (stroke: lowest net vs par of holes played;
 *  Stableford: most points vs the par pace of 2 a hole). */
export function segLeadersFor(rows: { p: Player; seg: number[] }[], game: Game | null, ranges: { from: number; to: number; label: string }[]): SegLeader[] {
  const isStroke = game?.game_type === "stroke";
  return ranges.map((r, si) => {
    const size = r.to - r.from;
    let bestPace = isStroke ? Infinity : -Infinity, who: string[] = [], leaderRaw: number | null = null, leaderPlayed = 0;
    let started = false, maxPlayed = 0, allDone = true, anyActive = false;
    rows.forEach(({ p, seg }) => {
      const hs = playerHoles(p, game);
      if (!hs.some((h) => h.strokes)) return;
      anyActive = true;
      const segHoles = hs.slice(r.from, r.to);
      const played = segHoles.filter((h) => h.strokes).length;
      if (played < size) allDone = false;
      if (played > 0) started = true;
      maxPlayed = Math.max(maxPlayed, played);
      if (played < 1) return;
      const pace = isStroke ? seg[si] - segHoles.reduce((s, h) => s + (h.strokes && h.strokes > 0 ? (h.par || 0) : 0), 0) : seg[si] - 2 * played;
      const better = isStroke ? pace < bestPace : pace > bestPace;
      if (better) { bestPace = pace; who = [p.display_name]; leaderRaw = seg[si]; leaderPlayed = played; }
      else if (pace === bestPace) { who.push(p.display_name); leaderPlayed = Math.max(leaderPlayed, played); }
    });
    return { label: r.label, complete: anyActive && allDone && started, started, val: started ? leaderRaw : null, who,
      thruHole: r.from + maxPlayed, leaderThru: r.from + leaderPlayed, maxPlayed };
  });
}
