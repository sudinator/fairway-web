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
  sand?: boolean | null; // greenside bunker on this hole (for sand-save %)
  yardage?: number | null; // hole distance for the played tee
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
  ai_analysis?: string | null; // saved AI coach summary, persists once generated
  game_id?: string | null; // set when this round was recorded from a finished game/match
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
// How many holes a round represents. Hole-by-hole rounds know it directly; a
// gross-only round stores no hole rows, so we infer from course par — a 9-hole
// course tops out around par 40 and an 18-hole course starts around par 54, so
// 50 cleanly separates them.
export function roundHoleCount(r: Round): number {
  const detail = played(r);
  if (detail.length) return detail.length;
  if (r.holes?.length) return r.holes.length;
  if (r.course_par != null && r.course_par <= 50) return 9;
  return 18;
}

// We only show an estimated Stableford for rounds that represent a full 18.
// Hole-by-hole rounds always qualify; a 9-hole gross-only total is too thin to
// estimate comparably, so callers should show "—" instead of a misleading number.
export function stablefordEstimable(r: Round): boolean {
  if (!isGrossOnly(r)) return true;
  return roundHoleCount(r) >= 18;
}

export function estimatedStablefordPts(r: Round): number {
  const entered = played(r);
  const actual = ptsOf(r);
  const totalHoles = r.holes?.length || (r.gross_score ? 18 : entered.length);

  let ch = r.course_handicap;
  if (ch == null && r.handicap_index != null && r.rating != null && r.slope != null && r.course_par != null) {
    ch = courseHandicap(r.handicap_index, r.slope, r.rating, r.course_par);
  }

  if (isGrossOnly(r) && r.gross_score != null && r.course_par != null) {
    // course_par and course_handicap already correspond to the round's actual
    // holes, so no scaling is needed — just net the gross to par and compare to
    // the all-net-par baseline of 2 points per hole.
    const holes = roundHoleCount(r);
    const netToPar = r.gross_score - (ch ?? 0) - r.course_par;
    return Math.max(0, Math.round(holes * 2 - netToPar));
  }

  const missing = Math.max(0, totalHoles - entered.length);
  return actual + missing * 2;
}

export function hasEstimatedStableford(r: Round): boolean {
  const totalHoles = r.holes?.length || (r.gross_score ? 18 : played(r).length);
  return isGrossOnly(r) || played(r).length < totalHoles;
}

export const stablefordDisplay = (r: Round) =>
  !stablefordEstimable(r) ? "—" :
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
// Scrambling: of the holes where the green was MISSED in regulation, how often
// the player still made par or better. Needs both strokes and putts recorded
// (putts are what let us know whether the green was hit in regulation).
export const scrambleStats = (rs: Round[]) => {
  const hs = rs.flatMap(played).filter((h) => h.strokes != null && h.putts != null);
  const missed = hs.filter((h) => !isGIR(h)); // missed green in regulation
  return { hit: missed.filter((h) => (h.strokes as number) <= h.par).length, total: missed.length };
};
// Sand saves: of the holes flagged as a greenside bunker (sand), how often the
// player still made par or better (got up-and-down).
export const sandSaveStats = (rs: Round[]) => {
  const hs = rs.flatMap(played).filter((h) => !!h.sand && h.strokes != null);
  return { hit: hs.filter((h) => (h.strokes as number) <= h.par).length, total: hs.length };
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

// Playing handicap after a match-play allowance (e.g. 85% for four-ball). WHS
// applies the % to each player's course handicap, then strokes come from the
// difference. allowancePct defaults to 100 (full handicap) = no change.
export const applyAllowance = (ch: number | null | undefined, allowancePct: number = 100) =>
  Math.round(((ch ?? 0) * (allowancePct ?? 100)) / 100);

// Given two players' course handicaps, returns the per-player match allowance.
export function matchAllowance(chA: number | null, chB: number | null, allowancePct: number = 100): { a: number; b: number } {
  const A = applyAllowance(chA, allowancePct), B = applyAllowance(chB, allowancePct);
  const low = Math.min(A, B);
  return { a: A - low, b: B - low };
}

// Compute the match status from each player's gross scores.
// Returns holes played, A's lead (positive = A up), and a settled result string.
// Per-hole running match lead from player A's perspective.
// Returns an array aligned to holes: cumulative lead after each *played* hole
// (positive = A up, negative = A down, 0 = all square), or null for holes not yet played by both.
export function matchProgress(
  holes: MatchHoleMeta[],
  grossA: (number | null)[],
  grossB: (number | null)[],
  chA: number | null,
  chB: number | null,
  allowancePct: number = 100
): (number | null)[] {
  const allow = matchAllowance(chA, chB, allowancePct);
  let lead = 0;
  return holes.map((h, i) => {
    const ga = grossA[i], gb = grossB[i];
    if (ga == null || gb == null || ga <= 0 || gb <= 0) return null;
    const netA = ga - matchStrokesFor(allow.a, h.si);
    const netB = gb - matchStrokesFor(allow.b, h.si);
    if (netA < netB) lead++;
    else if (netB < netA) lead--;
    return lead;
  });
}

// Short label for a running lead from the scorer's perspective.
export function matchLeadLabel(lead: number | null): string {
  if (lead == null) return "";
  if (lead === 0) return "AS";
  return `${Math.abs(lead)}${lead > 0 ? "UP" : "DN"}`;
}

export function matchStatus(
  holes: MatchHoleMeta[],
  grossA: (number | null)[],
  grossB: (number | null)[],
  chA: number | null,
  chB: number | null,
  allowancePct: number = 100
): { thru: number; lead: number; aWins: number; bWins: number; halves: number; result: string } {
  const allow = matchAllowance(chA, chB, allowancePct);
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
  } else if (remaining === 0 && thru > 0) {
    // Went the full distance without an early close-out: a level finish is a
    // halve ("AS"), otherwise the final margin. (Mirrors fourballStatus.)
    result = lead === 0 ? "AS" : `${Math.abs(lead)} UP`;
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

// ---------------- Four-ball (better net ball) match play ----------------
// Two pairs play a hole; each team's hole score is the BETTER (lowest) net of its
// two players. The lower team net wins the hole. Strokes are allocated relative to
// the lowest course handicap among the four players (that player plays off scratch;
// the others get the full difference by stroke index).

export type FourballMember = { id: string; gross: (number | null)[]; ch: number | null; noShow?: boolean };

// Net score per player per hole, strokes relative to the lowest CH among the group.
function fourballNets(holes: MatchHoleMeta[], members: FourballMember[], allowancePct: number = 100): Record<string, (number | null)[]> {
  // The low-handicap reference excludes no-shows so they don't drag the basis.
  const adj = (ch: number | null) => applyAllowance(ch, allowancePct);
  const active = members.filter((m) => !m.noShow);
  const low = Math.min(...(active.length ? active : members).map((m) => adj(m.ch)));
  const out: Record<string, (number | null)[]> = {};
  for (const m of members) {
    const diff = adj(m.ch) - low;
    out[m.id] = holes.map((h, i) => {
      const g = m.gross[i];
      const played = g != null && g > 0;
      if (m.noShow) {
        // A flagged player keeps the real net on holes they actually played, and
        // takes net double bogey (par + 2) on holes they didn't. This handles a
        // mid-round departure: holes 1–8 count as played, 9–18 become net dbl bogey.
        return played ? g - matchStrokesFor(diff, h.si) : h.par + 2;
      }
      if (!played) return null;
      return g - matchStrokesFor(diff, h.si);
    });
  }
  return out;
}

// Running lead from pair A's perspective after each hole (positive = A up).
// A hole counts once BOTH teams have at least one net score on it.
export function fourballProgress(
  holes: MatchHoleMeta[],
  members: FourballMember[],
  aIds: string[],
  bIds: string[],
  allowancePct: number = 100,
): (number | null)[] {
  const nets = fourballNets(holes, members, allowancePct);
  let lead = 0;
  return holes.map((_, i) => {
    const aN = aIds.map((id) => nets[id]?.[i]).filter((n): n is number => n != null);
    const bN = bIds.map((id) => nets[id]?.[i]).filter((n): n is number => n != null);
    if (!aN.length || !bN.length) return null;
    const a = Math.min(...aN), b = Math.min(...bN);
    if (a < b) lead++;
    else if (b < a) lead--;
    return lead;
  });
}

// Summary: holes played (both teams), current lead, and a result/status label.
export function fourballStatus(
  holes: MatchHoleMeta[],
  members: FourballMember[],
  aIds: string[],
  bIds: string[],
  allowancePct: number = 100,
): { thru: number; lead: number; result: string } {
  const prog = fourballProgress(holes, members, aIds, bIds, allowancePct);
  const played = prog.filter((p) => p != null) as number[];
  const thru = played.length;
  const lead = played.length ? played[played.length - 1] : 0;
  const remaining = holes.length - thru;
  let result = "";
  if (thru === 0) result = "Not started";
  else if (Math.abs(lead) > remaining) {
    // Match decided early: "X & Y".
    const up = Math.abs(lead);
    result = remaining === 0 ? (lead === 0 ? "Halved" : `${up} UP`) : `${up} & ${remaining}`;
  } else if (thru === holes.length) {
    result = lead === 0 ? "Halved" : `${Math.abs(lead)} UP`;
  } else {
    result = lead === 0 ? "All square" : `${Math.abs(lead)} UP`;
  }
  return { thru, lead, result };
}

// ---------------- Skins (net, with carryovers) ----------------
export type SkinPlayer = { id: string; name: string; gross: (number | null)[]; ch: number | null; noShow?: boolean };
export type SkinSide = { id: string; name: string; playerIds: string[] };
export type SkinHole = {
  hole: number;
  winnerId: string | null; // player id for individual skins, side id for match/team skins; null = halved/carried/not ready
  carriedIn: number;        // skins carried into this hole from prior ties
  value: number;            // skins at stake on this hole (carriedIn + 1)
  decided: boolean;         // every required side has a score on this hole
  netById: Record<string, number | null>;
};
export type SkinResult = {
  holes: SkinHole[];
  skinsByPlayer: Record<string, number>; // total skins won by player id
  carryAtEnd: number;                     // unresolved skins still carrying
};
export type SkinMatchResult = {
  holes: SkinHole[];
  skinsBySide: Record<string, number>;    // total skins won by side id
  carryAtEnd: number;
};

// Legacy individual net skins: on each fully-played hole the lowest UNIQUE net wins
// 1 skin plus any carried over from immediately preceding tied holes. A tie carries
// the skins forward. Kept as a fallback for old/unconfigured skins games.
export function computeSkins(holes: MatchHoleMeta[], players: SkinPlayer[], allowancePct: number = 100): SkinResult {
  const skinsByPlayer: Record<string, number> = {};
  players.forEach((p) => (skinsByPlayer[p.id] = 0));
  const out: SkinHole[] = [];
  let carry = 0;
  holes.forEach((h, i) => {
    const netById: Record<string, number | null> = {};
    let allPlayed = true;
    for (const p of players) {
      const g = p.gross[i];
      if (g == null || g <= 0) { netById[p.id] = null; allPlayed = false; }
      else netById[p.id] = g - strokesReceived(h.si, applyAllowance(p.ch, allowancePct));
    }
    if (!allPlayed || players.length < 2) {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value: carry + 1, decided: false, netById });
      return; // not yet resolvable; carry unchanged
    }
    const nets = players.map((p) => netById[p.id] as number);
    const min = Math.min(...nets);
    const winners = players.filter((p) => (netById[p.id] as number) === min);
    const value = carry + 1;
    if (winners.length === 1) {
      skinsByPlayer[winners[0].id] += value;
      out.push({ hole: h.n, winnerId: winners[0].id, carriedIn: carry, value, decided: true, netById });
      carry = 0;
    } else {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value, decided: true, netById });
      carry = value;
    }
  });
  return { holes: out, skinsByPlayer, carryAtEnd: carry };
}

// Match-play skins: exactly two sides compete on each hole. If one side has the
// lower net score, that side wins the current skin pot. If the hole is halved,
// the entire pot carries to the next hole.
export function computeHeadToHeadSkins(
  holes: MatchHoleMeta[],
  a: SkinPlayer,
  b: SkinPlayer,
  allowancePct: number = 100,
): SkinMatchResult {
  const allow = matchAllowance(a.ch, b.ch, allowancePct);
  const skinsBySide: Record<string, number> = { [a.id]: 0, [b.id]: 0 };
  const out: SkinHole[] = [];
  let carry = 0;
  holes.forEach((h, i) => {
    const ga = a.gross[i], gb = b.gross[i];
    const netA = ga != null && ga > 0 ? ga - matchStrokesFor(allow.a, h.si) : null;
    const netB = gb != null && gb > 0 ? gb - matchStrokesFor(allow.b, h.si) : null;
    const netById: Record<string, number | null> = { [a.id]: netA, [b.id]: netB };
    const value = carry + 1;
    if (netA == null || netB == null) {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value, decided: false, netById });
      return;
    }
    if (netA < netB) {
      skinsBySide[a.id] += value;
      out.push({ hole: h.n, winnerId: a.id, carriedIn: carry, value, decided: true, netById });
      carry = 0;
    } else if (netB < netA) {
      skinsBySide[b.id] += value;
      out.push({ hole: h.n, winnerId: b.id, carriedIn: carry, value, decided: true, netById });
      carry = 0;
    } else {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value, decided: true, netById });
      carry = value;
    }
  });
  return { holes: out, skinsBySide, carryAtEnd: carry };
}

// Team best-ball skins: each side can have one or more players; the side's hole
// score is its best/lowest net ball. A lower team net wins the pot; equal best
// balls halve the hole and carry the pot forward.
export function computeTeamBestBallSkins(
  holes: MatchHoleMeta[],
  members: FourballMember[],
  aIds: string[],
  bIds: string[],
  allowancePct: number = 100,
): SkinMatchResult {
  const sides: SkinSide[] = [
    { id: "a", name: "Pair 1", playerIds: aIds },
    { id: "b", name: "Pair 2", playerIds: bIds },
  ];
  const skinsBySide: Record<string, number> = { a: 0, b: 0 };
  const nets = fourballNets(holes, members, allowancePct);
  const out: SkinHole[] = [];
  let carry = 0;
  holes.forEach((h, i) => {
    const netById: Record<string, number | null> = {};
    members.forEach((m) => (netById[m.id] = nets[m.id]?.[i] ?? null));
    const value = carry + 1;
    const sideNets = sides.map((s) => {
      const vals = s.playerIds.map((id) => nets[id]?.[i]).filter((n): n is number => n != null);
      return { side: s, net: vals.length ? Math.min(...vals) : null };
    });
    if (sideNets.some((s) => s.net == null) || !aIds.length || !bIds.length) {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value, decided: false, netById });
      return;
    }
    const aNet = sideNets[0].net as number, bNet = sideNets[1].net as number;
    if (aNet < bNet) {
      skinsBySide.a += value;
      out.push({ hole: h.n, winnerId: "a", carriedIn: carry, value, decided: true, netById });
      carry = 0;
    } else if (bNet < aNet) {
      skinsBySide.b += value;
      out.push({ hole: h.n, winnerId: "b", carriedIn: carry, value, decided: true, netById });
      carry = 0;
    } else {
      out.push({ hole: h.n, winnerId: null, carriedIn: carry, value, decided: true, netById });
      carry = value;
    }
  });
  return { holes: out, skinsBySide, carryAtEnd: carry };
}

// Putt distribution for a set of rounds: counts of 1-putts and 3+-putts, plus
// holes that have a recorded putt value (so percentages are honest).
export function puttDistribution(rounds: Round[]) {
  let one = 0, three = 0, withPutts = 0, total = 0;
  rounds.forEach((r) =>
    played(r).forEach((h) => {
      if (h.putts == null) return;
      withPutts++;
      total += h.putts;
      if (h.putts === 1) one++;
      else if (h.putts >= 3) three++;
    })
  );
  return { one, three, withPutts, total };
}

// ---------------- Stableford betting (TGC group) ----------------
// The betting calculator and (later) the season money ledger are gated to one
// group by ID, not name — so renaming the group never breaks the gate. If TGC's
// group id ever changes, update this single constant.
export const TGC_GROUP_ID = "640fb606-1a78-4a7f-a632-22446bc934c1";
// Pot = bet * number of bettors. Prizes are PERCENTAGES of the pot:
//   - each of the 3 six-hole segments: segPct (default 10/75)
//   - overall 2nd place (18-hole): secondPct (default 15/75)
//   - overall 1st place (18-hole): firstPct (default 30/75)
// Rules:
//   - Segment ties split that segment's share equally.
//   - All players tied for 1st split (first+second) equally; no second paid.
//   - One outright 1st but multiple tied 2nd: second's share splits equally.
//   - Clean sweep: one player wins all 3 segments OUTRIGHT and is OUTRIGHT 1st
//     overall -> bets double; that player takes the entire doubled pot (everyone
//     else owes double their ante).
export type BetPlayer = { id: string; name: string; total: number; seg: [number, number, number]; segPlayed: [boolean, boolean, boolean] };
export type BetSplit = { segPct: number; secondPct: number; firstPct: number };
export const DEFAULT_BET_SPLIT: BetSplit = { segPct: 10 / 75, secondPct: 15 / 75, firstPct: 30 / 75 };

export type BetResult = {
  pot: number;
  perPlayer: { id: string; name: string; won: number; net: number; notes: string[] }[];
  lines: string[]; // human-readable explanation of each payout
  cleanSweep: boolean;
};

export function computeBetting(
  players: BetPlayer[],
  bet: number,
  split: BetSplit = DEFAULT_BET_SPLIT,
): BetResult {
  const n = players.length;
  const basePot = bet * n;
  const won: Record<string, number> = {};
  const notes: Record<string, string[]> = {};
  players.forEach((p) => { won[p.id] = 0; notes[p.id] = []; });
  const lines: string[] = [];

  if (n < 2) {
    return { pot: basePot, perPlayer: players.map((p) => ({ id: p.id, name: p.name, won: 0, net: 0, notes: ["Need at least 2 bettors."] })), lines: ["Need at least 2 bettors to calculate a pot."], cleanSweep: false };
  }

  // Overall standings by 18-hole total.
  const maxTotal = Math.max(...players.map((p) => p.total));
  const firsts = players.filter((p) => p.total === maxTotal);
  const rest = players.filter((p) => p.total < maxTotal);
  const secondVal = rest.length ? Math.max(...rest.map((p) => p.total)) : null;
  const seconds = secondVal == null ? [] : rest.filter((p) => p.total === secondVal);

  // Segment winners (only counting fully-played segments). Track outright wins.
  const segWinnerIds: string[][] = [];
  for (let si = 0; si < 3; si++) {
    const eligible = players.filter((p) => p.segPlayed[si]);
    if (!eligible.length) { segWinnerIds.push([]); continue; }
    const top = Math.max(...eligible.map((p) => p.seg[si]));
    segWinnerIds.push(eligible.filter((p) => p.seg[si] === top).map((p) => p.id));
  }

  // Clean sweep check: one player wins ALL three segments outright AND is the
  // sole overall leader.
  const sweepCandidate =
    firsts.length === 1 &&
    segWinnerIds.every((w) => w.length === 1 && w[0] === firsts[0].id);

  if (sweepCandidate) {
    const winner = firsts[0];
    const doubledPot = basePot * 2;
    won[winner.id] = doubledPot;
    notes[winner.id].push("CLEAN SWEEP — won all 3 sixes outright and 1st overall");
    lines.push(`🧹 CLEAN SWEEP by ${winner.name}: bets double. Pot = $${doubledPot.toFixed(2)} (everyone owes double their $${bet} ante).`);
    const perPlayer = players.map((p) => ({
      id: p.id, name: p.name, won: won[p.id],
      net: p.id === winner.id ? doubledPot - bet * 2 : -(bet * 2),
      notes: notes[p.id],
    }));
    return { pot: doubledPot, perPlayer, lines, cleanSweep: true };
  }

  // Segment payouts.
  const segShare = basePot * split.segPct;
  for (let si = 0; si < 3; si++) {
    const winners = segWinnerIds[si];
    if (!winners.length) { lines.push(`Holes ${si * 6 + 1}–${si * 6 + 6}: not all scores in — no payout yet.`); continue; }
    const each = segShare / winners.length;
    winners.forEach((id) => { won[id] += each; notes[id].push(`Won holes ${si * 6 + 1}–${si * 6 + 6} (+$${each.toFixed(2)})`); });
    const names = winners.map((id) => players.find((p) => p.id === id)?.name).join(", ");
    lines.push(`Holes ${si * 6 + 1}–${si * 6 + 6}: ${names} — $${segShare.toFixed(2)}${winners.length > 1 ? ` split ${winners.length} ways ($${each.toFixed(2)} each)` : ""}.`);
  }

  // Overall first/second.
  const firstShare = basePot * split.firstPct;
  const secondShare = basePot * split.secondPct;
  if (firsts.length > 1) {
    // All tied for first split first+second combined; no second paid.
    const combined = firstShare + secondShare;
    const each = combined / firsts.length;
    firsts.forEach((p) => { won[p.id] += each; notes[p.id].push(`Tied 1st — split 1st+2nd (+$${each.toFixed(2)})`); });
    lines.push(`Overall: ${firsts.map((p) => p.name).join(", ")} tied for 1st — split 1st+2nd ($${combined.toFixed(2)}) = $${each.toFixed(2)} each. No separate 2nd.`);
  } else {
    const winner = firsts[0];
    won[winner.id] += firstShare;
    notes[winner.id].push(`1st overall (+$${firstShare.toFixed(2)})`);
    lines.push(`Overall 1st: ${winner.name} — $${firstShare.toFixed(2)}.`);
    if (seconds.length) {
      const each = secondShare / seconds.length;
      seconds.forEach((p) => { won[p.id] += each; notes[p.id].push(`2nd overall (+$${each.toFixed(2)})`); });
      lines.push(`Overall 2nd: ${seconds.map((p) => p.name).join(", ")} — $${secondShare.toFixed(2)}${seconds.length > 1 ? ` split ${seconds.length} ways ($${each.toFixed(2)} each)` : ""}.`);
    }
  }

  const perPlayer = players.map((p) => ({
    id: p.id, name: p.name, won: won[p.id], net: won[p.id] - bet, notes: notes[p.id],
  }));
  return { pot: basePot, perPlayer, lines, cleanSweep: false };
}
