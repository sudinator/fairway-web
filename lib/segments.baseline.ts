// BASELINE — segOf / segLeadersFrom exactly as inlined in GameRoom before the extraction,
// transcribed independently from the original source (game was non-null there; segLabels was a
// local const). Used only by segments.diff.test.ts to catch any transcription error in segments.ts.
import type { Game, Player } from "./game-types";
import { netBySix, stablefordBySix } from "./golf";
import { playerHoles } from "./player-scoring";

export type SegLeader = {
  label: string; complete: boolean; started: boolean; val: number | null;
  who: string[]; thruHole: number; leaderThru: number; maxPlayed: number;
};

const segLabels = ["Holes 1\u20136", "Holes 7\u201312", "Holes 13\u201318"];

export function segOf(p: Player, game: Game): [number, number, number] {
  const isStroke = game.game_type === "stroke";
  return isStroke ? netBySix(playerHoles(p, game)) : stablefordBySix(playerHoles(p, game));
}

export function segLeadersFrom(rows: { p: Player; seg: [number, number, number] }[], game: Game): SegLeader[] {
  const isStroke = game.game_type === "stroke";
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
    return { label: segLabels[si], complete, started, val: started ? leaderRaw : null, who, thruHole, leaderThru, maxPlayed };
  });
}
