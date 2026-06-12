// Shared golf logic and styling — no React here, just functions and constants.

export const C = {
  green: "#0E3B2E", greenMid: "#16503D", greenLight: "#1B5A46",
  cream: "#F7F3E8", card: "#FFFDF6", ink: "#26251F",
  faint: "#8B8775", line: "#D8D2BE",
  birdie: "#B83A2E", bogey: "#2E5AB8", gold: "#C9A227", sage: "#A9C4B5",
  dot: "#E8730C", parBlue: "#1E3A8A",
};

// Color for a hole's Stableford points: >2 green, =2 blue, <2 red, none faint.
export function ptsColor(pts: number | null): string {
  if (pts == null) return C.faint;
  if (pts > 2) return "#1A7A3C";
  if (pts === 2) return C.bogey;
  return C.birdie;
}

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
  group_id?: string | null;
  group_name?: string | null;
  course: string;
  tee_name: string | null;
  rating: number | null;
  slope: number | null;
  course_par: number | null;
  handicap_index: number | null;
  course_handicap: number | null;
  played_at: string;
  gross_score?: number | null; // for gross-only historical rounds (no per-hole detail)
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

// Robust allocation: distribute exactly `ch` strokes across the given holes by
// their stroke-index *ranking* (hardest first). Immune to duplicate / missing /
// out-of-range S.I. values that would make the simple per-hole formula over-allocate.
// Returns a map of hole_number -> strokes received.
export function allocateStrokes(holes: { hole_number: number; stroke_index: number | null }[], ch: number | null): Record<number, number> {
  const out: Record<number, number> = {};
  for (const h of holes) out[h.hole_number] = 0;
  if (ch == null || holes.length === 0) return out;
  const n = holes.length;
  const ranked = [...holes].sort((a, b) => {
    const sa = a.stroke_index ?? 999, sb = b.stroke_index ?? 999;
    if (sa !== sb) return sa - sb;
    return a.hole_number - b.hole_number;
  });
  const total = Math.abs(ch);
  const sign = ch >= 0 ? 1 : -1;
  for (let k = 0; k < total; k++) {
    const idx = sign > 0 ? (k % n) : (n - 1 - (k % n));
    out[ranked[idx].hole_number] += sign;
  }
  return out;
}

export function stablefordPts(strokes: number | null, par: number, recv: number): number | null {
  if (!strokes) return null;
  return Math.max(0, 2 - ((strokes - recv) - par));
}

export const played = (r: Round) => r.holes.filter((h) => h.strokes != null && h.strokes > 0);
// A "gross-only" round has a recorded total but no per-hole detail.
export const isGrossOnly = (r: Round) => played(r).length === 0 && r.gross_score != null;
export const hasHoleDetail = (r: Round) => played(r).length > 0;
export const strokesOf = (r: Round) => isGrossOnly(r) ? (r.gross_score || 0) : played(r).reduce((s, h) => s + (h.strokes || 0), 0);
export const parOf = (r: Round) => isGrossOnly(r) ? (r.course_par || 0) : played(r).reduce((s, h) => s + h.par, 0);
export const diffOf = (r: Round) => strokesOf(r) - parOf(r);
export const puttsOf = (r: Round) => played(r).reduce((s, h) => s + (h.putts || 0), 0);
export const pensOf = (r: Round) => played(r).reduce((s, h) => s + (h.penalties || 0), 0);
export const ptsOf = (r: Round) =>
  played(r).reduce((s, h) => s + (stablefordPts(h.strokes, h.par, h.recv || 0) || 0), 0);

// When a round has missing hole-by-hole scores, Stableford cannot be exact.
// This estimate keeps dashboards useful:
// - Gross-only rounds: estimate points from total gross score, par, and course handicap.
//   A net-par round estimates to 36 points for 18 holes.
// - Partial hole detail: use actual points for entered holes and assume net par
//   (2 Stableford points) for unentered holes.
export function estimatedStablefordPts(r: Round): number {
  const entered = played(r);
  const actual = ptsOf(r);
  const totalHoles = r.holes?.length || (r.gross_score ? 18 : entered.length);

  let ch = r.course_handicap;
  if (ch == null && r.handicap_index != null && r.rating != null && r.slope != null && r.course_par != null) {
    ch = courseHandicap(r.handicap_index, r.slope, r.rating, r.course_par);
  }

  if (isGrossOnly(r) && r.gross_score != null && r.course_par != null) {
    const holesFactor = totalHoles > 0 ? totalHoles / 18 : 1;
    const parForRound = r.course_par * holesFactor;
    const chForRound = (ch ?? 0) * holesFactor;
    const netToPar = r.gross_score - chForRound - parForRound;
    return Math.max(0, Math.round(totalHoles * 2 - netToPar));
  }

  const missing = Math.max(0, totalHoles - entered.length);
  return actual + missing * 2;
}

export function hasEstimatedStableford(r: Round): boolean {
  const totalHoles = r.holes?.length || (r.gross_score ? 18 : played(r).length);
  return isGrossOnly(r) || played(r).length < totalHoles;
}

export const stablefordDisplay = (r: Round) =>
  hasEstimatedStableford(r) ? `${estimatedStablefordPts(r)} est pts` : `${ptsOf(r)} pts`;
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

// "12/18 (66%)" style — fraction plus percentage.
export const fracPct = (s: { hit: number; total: number }) =>
  s.total ? `${s.hit}/${s.total} (${Math.round((100 * s.hit) / s.total)}%)` : "—";

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

// ---------------- Dashboard analytics ----------------
// Average strokes by par (3/4/5), across all completed holes in the given rounds.
export function avgByPar(rounds: Round[]): { par3: number | null; par4: number | null; par5: number | null } {
  const buckets: Record<number, number[]> = { 3: [], 4: [], 5: [] };
  rounds.forEach((r) =>
    played(r).forEach((h) => {
      if (buckets[h.par] && h.strokes != null) buckets[h.par].push(h.strokes);
    })
  );
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  return { par3: avg(buckets[3]), par4: avg(buckets[4]), par5: avg(buckets[5]) };
}

// Net double bogey cap for a hole: par + 2 + strokes received on that hole.
export function adjustedHoleScore(h: Hole): number | null {
  if (h.strokes == null || h.strokes <= 0) return null;
  const cap = h.par + 2 + (h.recv || 0);
  return Math.min(h.strokes, cap);
}

// WHS-style score differential for one round (needs full 18 with rating & slope):
//   (113 / slope) * (adjusted gross - course rating)
export function roundDifferential(r: Round): number | null {
  if (r.rating == null || r.slope == null) return null;
  // Gross-only round: use the recorded total directly (no per-hole adjustment available).
  if (isGrossOnly(r)) {
    return (113 / r.slope) * ((r.gross_score || 0) - r.rating);
  }
  const holes = played(r);
  if (holes.length < 18) return null; // differential is an 18-hole figure
  let adjusted = 0;
  for (const h of holes) {
    const a = adjustedHoleScore(h);
    if (a == null) return null;
    adjusted += a;
  }
  return (113 / r.slope) * (adjusted - r.rating);
}

// ---------------- Running handicap index (WHS) ----------------
// WHS uses the best N of your most recent 20 differentials, where N and any
// adjustment depend on how many scores you have. Below ~3 rounds there's no
// official index yet. This is a faithful approximation of the WHS table.
const WHS_TABLE: { upTo: number; best: number; adj: number }[] = [
  { upTo: 3, best: 1, adj: -2.0 },
  { upTo: 4, best: 1, adj: -1.0 },
  { upTo: 5, best: 1, adj: 0 },
  { upTo: 6, best: 2, adj: -1.0 },
  { upTo: 8, best: 2, adj: 0 },
  { upTo: 11, best: 3, adj: 0 },
  { upTo: 14, best: 4, adj: 0 },
  { upTo: 16, best: 5, adj: 0 },
  { upTo: 18, best: 6, adj: 0 },
  { upTo: 19, best: 7, adj: 0 },
  { upTo: 20, best: 8, adj: 0 },
];

// rounds should be newest-first or any order; we sort by date inside.
export function runningHandicap(rounds: Round[]): { index: number | null; used: number; total: number; usedDiffs: number[]; allDiffs: number[]; adj: number } {
  // Collect valid 18-hole differentials, most recent first.
  const withDiff = rounds
    .map((r) => ({ d: roundDifferential(r), date: r.played_at }))
    .filter((x): x is { d: number; date: string } => x.d != null)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date));
  const total = withDiff.length;
  if (total < 3) return { index: null, used: 0, total, usedDiffs: [], allDiffs: withDiff.map((x) => x.d), adj: 0 };

  const recent = withDiff.slice(0, 20).map((x) => x.d);
  const row = WHS_TABLE.find((t) => recent.length <= t.upTo) || WHS_TABLE[WHS_TABLE.length - 1];
  const best = [...recent].sort((a, b) => a - b).slice(0, row.best);
  const avg = best.reduce((s, x) => s + x, 0) / best.length;
  // Index is rounded to one decimal; the table adjustment nudges small samples.
  const index = Math.round((avg + row.adj) * 10) / 10;
  return { index, used: row.best, total, usedDiffs: best, allDiffs: recent, adj: row.adj };
}

// Average number of three-or-more-putt holes per round (only counts rounds with putts recorded).
export function threePuttsPerRound(rounds: Round[]): number | null {
  const withPutts = rounds.filter((r) => played(r).some((h) => h.putts != null));
  if (!withPutts.length) return null;
  const total = withPutts.reduce((s, r) => s + played(r).filter((h) => (h.putts || 0) >= 3).length, 0);
  return total / withPutts.length;
}

// Validate that a course's stroke indexes are a clean set of 1..N with no dupes/gaps.
// Returns an error string if invalid, or null if OK.
export function validateStrokeIndexes(holes: { n: number; si: number | null }[]): string | null {
  const n = holes.length;
  if (n === 0) return "This course has no holes.";
  const sis = holes.map((h) => h.si);
  if (sis.some((s) => s == null)) return "Every hole needs a stroke index (1–" + n + ").";
  const nums = sis as number[];
  const seen = new Set<number>();
  for (const s of nums) {
    if (s < 1 || s > n) return `Stroke index ${s} is out of range (must be 1–${n}).`;
    if (seen.has(s)) return `Stroke index ${s} is used more than once — each must be unique (1–${n}).`;
    seen.add(s);
  }
  // Confirm full coverage 1..n
  for (let i = 1; i <= n; i++) if (!seen.has(i)) return `Stroke index ${i} is missing — indexes must be 1–${n} with none skipped.`;
  return null;
}
