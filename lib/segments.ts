import type { Game, Player } from "./game-types";
import { netBySix, stablefordBySix } from "./golf";
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
