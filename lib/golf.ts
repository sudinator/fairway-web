// Shared golf logic and styling — no React here, just functions and constants.

export const C = {
  green: "#0E3B2E", greenMid: "#16503D", greenLight: "#1B5A46",
  cream: "#F7F3E8", card: "#FFFDF6", ink: "#26251F",
  faint: "#8B8775", line: "#D8D2BE",
  birdie: "#B83A2E", bogey: "#2E5AB8", gold: "#C9A227", sage: "#A9C4B5",
};

export type Hole = {
  hole_number: number;
  par: number;
  stroke_index: number | null;
  strokes: number | null;
  putts: number | null;
  fairway: "hit" | "miss" | null;
  penalties: number;
  recv?: number; // strokes received (computed, not stored)
};

export type Round = {
  id: string;
  course: string;
  tee_name: string | null;
  rating: number | null;
  slope: number | null;
  course_par: number | null;
  handicap_index: number | null;
  course_handicap: number | null;
  played_at: string;
  holes: Hole[];
};

// World Handicap System course handicap
export function courseHandicap(index: number, slope: number, rating: number, par: number): number | null {
  if ([index, slope, rating, par].some((v) => v == null || isNaN(v as number))) return null;
  return Math.round(index * (slope / 113) + (rating - par));
}

export function strokesReceived(si: number | null, ch: number | null): number {
  if (si == null || ch == null) return 0;
  if (ch >= 0) return Math.floor(ch / 18) + (si <= ch % 18 ? 1 : 0);
  return si > 18 + ch ? -1 : 0;
}

export function stablefordPts(strokes: number | null, par: number, recv: number): number | null {
  if (!strokes) return null;
  return Math.max(0, 2 - ((strokes - recv) - par));
}

export const played = (r: Round) => r.holes.filter((h) => h.strokes != null && h.strokes > 0);
export const strokesOf = (r: Round) => played(r).reduce((s, h) => s + (h.strokes || 0), 0);
export const parOf = (r: Round) => played(r).reduce((s, h) => s + h.par, 0);
export const diffOf = (r: Round) => strokesOf(r) - parOf(r);
export const puttsOf = (r: Round) => played(r).reduce((s, h) => s + (h.putts || 0), 0);
export const pensOf = (r: Round) => played(r).reduce((s, h) => s + (h.penalties || 0), 0);
export const ptsOf = (r: Round) =>
  played(r).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
export const toParStr = (d: number) => (d === 0 ? "E" : d > 0 ? `+${d}` : `${d}`);
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export const isGIR = (h: Hole) =>
  h.strokes != null && h.putts != null && h.strokes - h.putts <= h.par - 2;
export const girStats = (rs: Round[]) => {
  const hs = rs.flatMap(played).filter((h) => h.putts != null);
  return { hit: hs.filter(isGIR).length, total: hs.length };
};
export const firStats = (rs: Round[]) => {
  const hs = rs.flatMap(played).filter((h) => h.par >= 4 && (h.fairway === "hit" || h.fairway === "miss"));
  return { hit: hs.filter((h) => h.fairway === "hit").length, total: hs.length };
};
export const pct = (s: { hit: number; total: number }) =>
  s.total ? Math.round((100 * s.hit) / s.total) + "%" : "—";

export function holeBuckets(rounds: Round[]) {
  const b = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  rounds.forEach((r) =>
    played(r).forEach((h) => {
      const d = (h.strokes || 0) - h.par;
      if (d <= -2) b.eagle++;
      else if (d === -1) b.birdie++;
      else if (d === 0) b.par++;
      else if (d === 1) b.bogey++;
      else b.double++;
    })
  );
  return b;
}

// Stableford points for each six-hole segment: holes 1-6, 7-12, 13-18.
// Returns [first, middle, last] — used to score the classic "three sixes" game.
export function stablefordBySix(holes: Hole[]): [number, number, number] {
  const seg = (from: number, to: number) =>
    holes.slice(from, to).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);
  return [seg(0, 6), seg(6, 12), seg(12, 18)];
}
