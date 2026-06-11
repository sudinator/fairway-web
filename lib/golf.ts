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

// ---------------- Singles match play ----------------
// Relative allowance: the lower course handicap plays off scratch; the opponent
// receives the difference in strokes, allocated by stroke index.
export type MatchHoleMeta = { n: number; par: number; si: number | null };

export function matchStrokesFor(diff: number, si: number | null): number {
  // diff = strokes this player receives over the match (>=0); allocate by SI.
  if (si == null || diff <= 0) return 0;
  return Math.floor(diff / 18) + (si <= diff % 18 ? 1 : 0);
}

// Given two players' course handicaps, returns the per-player match allowance.
export function matchAllowance(chA: number | null, chB: number | null): { a: number; b: number } {
  const A = chA ?? 0, B = chB ?? 0;
  const low = Math.min(A, B);
  return { a: A - low, b: B - low };
}

// Compute the match status from each player's gross scores.
// Returns holes played, A's lead (positive = A up), and a settled result string.
export function matchStatus(
  holes: MatchHoleMeta[],
  grossA: (number | null)[],
  grossB: (number | null)[],
  chA: number | null,
  chB: number | null
): { thru: number; lead: number; aWins: number; bWins: number; halves: number; result: string } {
  const allow = matchAllowance(chA, chB);
  let lead = 0, thru = 0, aWins = 0, bWins = 0, halves = 0;
  holes.forEach((h, i) => {
    const ga = grossA[i], gb = grossB[i];
    if (ga == null || gb == null || ga <= 0 || gb <= 0) return;
    thru++;
    const netA = ga - matchStrokesFor(allow.a, h.si);
    const netB = gb - matchStrokesFor(allow.b, h.si);
    if (netA < netB) { lead++; aWins++; }
    else if (netB < netA) { lead--; bWins++; }
    else halves++;
  });
  const remaining = holes.length - thru;
  let result = "";
  if (Math.abs(lead) > remaining && thru > 0) {
    // Match decided: "X & Y" (up by X with Y to play, before the last counted hole)
    const upBy = Math.abs(lead);
    result = remaining === 0 ? `${upBy} UP` : `${upBy} & ${remaining}`;
  }
  return { thru, lead, aWins, bWins, halves, result };
}
