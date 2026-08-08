// BASELINE — the ORIGINAL versions of these helpers exactly as they sat in tournaments.tsx before
// the extraction (makeCode/normalizeFavoriteCourse/defaultTeeIdx/todayLocalStr were module-level;
// GP_STATE_DEFAULTS was a module const; refTee/blankCard were closures inside GameRoom over
// `players`/`game`, parameterized here the same way the new module is). Used only by the
// differential test to catch transcription errors in lib/game-utils.ts.
import type { Game, Player } from "./game-types";

export function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function defaultTeeIdx(tees: any[], smart: boolean): number {
  if (!Array.isArray(tees) || tees.length === 0) return 0;
  if (!smart) return 0;
  const mi = tees.findIndex((t) => /member/i.test(t?.name || ""));
  if (mi >= 0) return mi;
  let best = -1, bestDiff = Infinity;
  tees.forEach((t, i) => {
    const yds = Array.isArray(t?.yardages) ? t.yardages.reduce((s: number, v: any) => s + (Number(v) || 0), 0) : 0;
    if (yds > 0) { const d = Math.abs(yds - 6400); if (d < bestDiff) { bestDiff = d; best = i; } }
  });
  return best >= 0 ? best : 0;
}

export function todayLocalStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function normalizeFavoriteCourse(row: any) {
  const d = { ...(row?.data || row || {}) };
  if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
    const t = d.tees.find((x: any) => x.holes && x.holes.length);
    if (t) {
      d.holes = t.holes;
      d.tees = d.tees.map((x: any) => ({
        name: x.name,
        rating: x.rating,
        slope: x.slope,
        par: x.par,
        yardages: x.yardages,
      }));
    }
  }
  return d;
}

export const GP_STATE_DEFAULTS = { penalties: [] as unknown[], sand: [] as unknown[], is_marker: false, group_locked: false };

export function refTee(players: Player[]): { rating: number | null; slope: number | null; tee_name: string | null } {
  const ref = players.find((p) => p.rating != null && p.slope != null && p.tee_name) || players[0];
  return { rating: ref?.rating ?? null, slope: ref?.slope ?? null, tee_name: ref?.tee_name ?? null };
}

export function blankCard(game: Game | null) {
  const n = game?.holes_meta?.length ?? 18;
  return { scores: Array(n).fill(null), putts: Array(n).fill(null), fairways: Array(n).fill(null), ...GP_STATE_DEFAULTS };
}
