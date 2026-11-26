/**
 * Season standings — the ROUNDS tab (owner, Nov 17–18, 2026): every round logged in BNN this year by members who share
 * them (profiles.share_rounds_with_club, on by default; the switch is in Profile). Only what the data holds — nothing
 * index-based. Rules from the club's real 2026 export:
 *  - 18-hole rounds only (a round with any hole unscored is out, as on the Rounds tab);
 *  - a member's rounds on the same course and day collapse to one (the export showed three same-day duplicates);
 *  - putts rank only members whose counted rounds all have 18 putts recorded (about half the rounds have none);
 *  - five rounds to be ranked; ties share the place; the rounds-logged count is on every row because members log unevenly.
 * Scoring averages are TO PAR (gross and net, the net off the round's course handicap). Net birdies/eagles use the round's
 * handicap allocation (allocateStrokes) — the same arithmetic as the Rounds tab.
 */
import { allocateStrokes } from "@/lib/golf";

export type RoundRow = { id: string; user_id: string; display_name: string; avatar_url?: string | null; played_at: string; course: string | null; course_par: number | null; course_handicap: number | null };
export type HoleRow = { round_id: string; hole_number: number; par: number | null; stroke_index: number | null; strokes: number | null; putts: number | null };
export type RoundsStandingRow = {
  userId: string; name: string; avatarUrl: string | null;
  rounds: number;
  avgGross: number | null; avgNet: number | null;      // to par
  bestGross: number | null; bestNet: number | null;
  birdies: number; eagles: number; bestBirdies: number;
  fewestPutts: number | null;                          // null when any counted round lacks putts
  parStreak: number;                                   // longest run of consecutive holes at gross par or better
  eligible: boolean;
};
export const ROUNDS_MIN = 5;
export type RoundsMetric = "avgNet" | "avgGross" | "bestGross" | "bestNet" | "birdies" | "bestBirdies" | "fewestPutts" | "parStreak" | "rounds";
export const ROUNDS_METRICS: { key: RoundsMetric; label: string; lowerIsBetter?: boolean; value: (r: RoundsStandingRow) => number | null; show: (r: RoundsStandingRow) => string }[] = [
  { key: "avgNet", label: "Scoring avg (net)", lowerIsBetter: true, value: (r) => r.avgNet, show: (r) => (r.avgNet == null ? "—" : `${r.avgNet > 0 ? "+" : ""}${r.avgNet.toFixed(1)}`) },
  { key: "avgGross", label: "Scoring avg (gross)", lowerIsBetter: true, value: (r) => r.avgGross, show: (r) => (r.avgGross == null ? "—" : `${r.avgGross > 0 ? "+" : ""}${r.avgGross.toFixed(1)}`) },
  { key: "bestGross", label: "Best gross", lowerIsBetter: true, value: (r) => r.bestGross, show: (r) => (r.bestGross == null ? "—" : String(r.bestGross)) },
  { key: "bestNet", label: "Best net", lowerIsBetter: true, value: (r) => r.bestNet, show: (r) => (r.bestNet == null ? "—" : String(r.bestNet)) },
  { key: "birdies", label: "Net birdies", value: (r) => r.birdies, show: (r) => String(r.birdies) },
  { key: "bestBirdies", label: "Most birdies in a round", value: (r) => r.bestBirdies, show: (r) => String(r.bestBirdies) },
  { key: "fewestPutts", label: "Fewest putts", lowerIsBetter: true, value: (r) => r.fewestPutts, show: (r) => (r.fewestPutts == null ? "—" : String(r.fewestPutts)) },
  { key: "parStreak", label: "Longest par streak", value: (r) => r.parStreak, show: (r) => String(r.parStreak) },
  { key: "rounds", label: "Rounds logged", value: (r) => r.rounds, show: (r) => String(r.rounds) },
];

/**
 * One round, summarised — the ONLY shape the Rounds tab receives from the server since 212.131 (migration 0239: the
 * owner's contract is "aggregates and ranking only, no hole-by-hole", and 0237 returned the holes). The database
 * computes this per round in SQL; summarizeRound() is the same arithmetic in TypeScript, kept as the oracle:
 * ci/assert-club-round-standings.sql checks the SQL against fixtures whose expected figures lib/season-rounds.test.ts
 * checks against this function, and the stroke-allocation table in that assertion is generated from allocateStrokes
 * (ci/check_rounds_summary_parity.py keeps it current). Only complete 18-hole rounds are summarised; anything else is null.
 */
export type RoundSummary = {
  id: string; user_id: string; display_name: string; avatar_url?: string | null; played_at: string; course: string | null; course_handicap: number | null;
  par: number; gross: number; putts: number | null; net_birdies: number; net_eagles: number; par_streak: number;
};
export function summarizeRound(r: RoundRow, holes: HoleRow[]): RoundSummary | null {
  const hs = holes.filter((h) => h.round_id === r.id).slice().sort((a, b) => a.hole_number - b.hole_number);
  if (hs.length !== 18 || hs.some((h) => h.strokes == null || h.strokes <= 0 || h.par == null)) return null;
  const par = hs.reduce((t, h) => t + (h.par || 0), 0);
  const gross = hs.reduce((t, h) => t + (h.strokes || 0), 0);
  const ch = Math.round(Number(r.course_handicap ?? 0));
  const alloc = allocateStrokes(hs.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index })), ch);
  let birdies = 0, eagles = 0, streak = 0, best = 0;
  for (const h of hs) {
    const netDiff = (h.strokes || 0) - (alloc[h.hole_number] || 0) - (h.par || 0);
    if (netDiff === -1) birdies++; else if (netDiff <= -2) eagles++;
    if ((h.strokes || 0) <= (h.par || 0)) { streak++; best = Math.max(best, streak); } else streak = 0;
  }
  const putts = hs.every((h) => h.putts != null) ? hs.reduce((t, h) => t + (h.putts || 0), 0) : null;
  return { id: r.id, user_id: r.user_id, display_name: r.display_name, avatar_url: r.avatar_url ?? null, played_at: r.played_at, course: r.course, course_handicap: r.course_handicap, par, gross, putts, net_birdies: birdies, net_eagles: eagles, par_streak: best };
}

/** The standings from per-round summaries (the server's shape). */
export function roundsStandings(summaries: RoundSummary[]): RoundsStandingRow[] {
  // same member, same course, same day → one round (the first by id, deterministic)
  const seen = new Set<string>();
  const kept = [...summaries].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => { const k = `${r.user_id}|${(r.course || "").toLowerCase()}|${String(r.played_at).slice(0, 10)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const rows = new Map<string, RoundsStandingRow & { gross: number[]; net: number[]; putts: (number | null)[] }>();
  for (const r of kept) {
    const ch = Math.round(Number(r.course_handicap ?? 0));
    let row = rows.get(r.user_id);
    if (!row) { row = { userId: r.user_id, name: r.display_name, avatarUrl: r.avatar_url ?? null, rounds: 0, avgGross: null, avgNet: null, bestGross: null, bestNet: null, birdies: 0, eagles: 0, bestBirdies: 0, fewestPutts: null, parStreak: 0, eligible: false, gross: [], net: [], putts: [] }; rows.set(r.user_id, row); }
    row.rounds++; row.gross.push(r.gross - r.par); row.net.push(r.gross - ch - r.par); row.putts.push(r.putts);
    row.bestGross = row.bestGross == null ? r.gross : Math.min(row.bestGross, r.gross);
    row.bestNet = row.bestNet == null ? r.gross - ch : Math.min(row.bestNet, r.gross - ch);
    row.birdies += r.net_birdies; row.eagles += r.net_eagles; row.bestBirdies = Math.max(row.bestBirdies, r.net_birdies); row.parStreak = Math.max(row.parStreak, r.par_streak);
  }
  return [...rows.values()].map(({ gross, net, putts, ...row }) => {
    row.eligible = row.rounds >= ROUNDS_MIN;
    if (row.eligible) {
      row.avgGross = Math.round((gross.reduce((a, b) => a + b, 0) / gross.length) * 10) / 10;
      row.avgNet = Math.round((net.reduce((a, b) => a + b, 0) / net.length) * 10) / 10;
      row.fewestPutts = putts.every((p) => p != null) ? Math.min(...(putts as number[])) : null;
    }
    return row;
  });
}
/** The standings from rounds with their holes (tests and the oracle; the app no longer receives holes). */
export function roundsStandingsFromHoles(rounds: RoundRow[], holes: HoleRow[]): RoundsStandingRow[] {
  return roundsStandings(rounds.map((r) => summarizeRound(r, holes)).filter((x): x is RoundSummary => x != null));
}

/** Sort by a metric; ties share the place; below the floor listed after, unranked. */
export function rankRounds(rows: RoundsStandingRow[], metric: RoundsMetric): { row: RoundsStandingRow; place: number | null }[] {
  const m = ROUNDS_METRICS.find((x) => x.key === metric)!;
  const ranked = rows.filter((r) => r.eligible && m.value(r) != null).sort((a, b) => (m.lowerIsBetter ? m.value(a)! - m.value(b)! : m.value(b)! - m.value(a)!) || b.rounds - a.rounds || a.name.localeCompare(b.name));
  const out: { row: RoundsStandingRow; place: number | null }[] = [];
  ranked.forEach((r, i) => { const v = m.value(r); out.push({ row: r, place: i > 0 && m.value(ranked[i - 1]) === v ? out[i - 1].place : i + 1 }); });
  rows.filter((r) => !(r.eligible && m.value(r) != null)).sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)).forEach((r) => out.push({ row: r, place: null }));
  return out;
}
