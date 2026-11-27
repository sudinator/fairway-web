/**
 * The head-to-head card (212.137, owner: "how am I 1 up thru 11"): one match, hole by hole — both players' gross and net,
 * each player's own strokes, who won the hole on net, and the running state after it — plus what is needed from here,
 * the strokes still to come, and the swing. Built from the SAME inputs every match engine already has (gross per hole and
 * strokes per hole for each side), so a Colosseum match (strokes off each player's own card) and a singles match
 * (strokes off the difference) read identically; the running state is the one closeout rule (lib/golf).
 */
import { matchCloseoutStatus, type MatchCloseoutStatus, type MatchHoleMeta } from "./golf";

export type H2HSide = { name: string; gross: (number | null)[]; strokes: number[] };
export type H2HRow = {
  hole: number; par: number; si: number | null;
  aGross: number | null; aStrokes: number; aNet: number | null;
  bGross: number | null; bStrokes: number; bNet: number | null;
  /** who won the hole on net; null until both have played it */
  result: "a" | "b" | "half" | null;
  /** running lead from a's side after this hole; null until both have played it */
  lead: number | null;
};
export type H2HNeeded = {
  remaining: number;
  /** holes a must WIN (losing the rest) to win; null when already decided; Infinity-free: capped at remaining+1 = impossible */
  aWins: number | null; aHalves: number | null; bWins: number | null;
  dormie: "a" | "b" | null;
};
export type H2H = {
  rows: H2HRow[];
  status: MatchCloseoutStatus;
  needed: H2HNeeded;
  /** holes still to play where each side receives a stroke (1-based hole numbers) */
  strokesToCome: { a: number[]; b: number[] };
  swing: { aBest: { lead: number; after: number } | null; bBest: { lead: number; after: number } | null };
};

export function headToHead(holes: MatchHoleMeta[], a: H2HSide, b: H2HSide): H2H {
  let lead = 0;
  const rows: H2HRow[] = holes.map((h, i) => {
    const ag = a.gross[i] ?? null, bg = b.gross[i] ?? null;
    const as = a.strokes[i] ?? 0, bs = b.strokes[i] ?? 0;
    const played = ag != null && ag > 0 && bg != null && bg > 0;
    const an = ag != null && ag > 0 ? ag - as : null, bn = bg != null && bg > 0 ? bg - bs : null;
    let result: H2HRow["result"] = null;
    if (played && an != null && bn != null) {
      if (an < bn) { lead++; result = "a"; } else if (bn < an) { lead--; result = "b"; } else result = "half";
    }
    return { hole: h.n ?? i + 1, par: h.par, si: h.si ?? null, aGross: ag, aStrokes: as, aNet: an, bGross: bg, bStrokes: bs, bNet: bn, result, lead: played ? lead : null };
  });
  const status = matchCloseoutStatus(rows.map((r) => r.lead), holes.length);
  // the ONE closeout rule (184.1): once a match is decided the holes after it are shown but carry no result or state —
  // 5 & 3 must never read 8 up further down the card
  if (status.decided) rows.forEach((r, i) => { if (i >= status.thru) { r.result = null; r.lead = null; } });
  // what is needed from here, from a's side (L = lead, r = holes left): a wins outright with X wins and the rest lost
  // when 2X > r − L; with Y halves and the rest lost when Y > r − L; b (L behind) needs W wins when 2W > r + L
  const r = holes.length - status.thru, L = status.lead;
  const needed: H2HNeeded = status.decided
    ? { remaining: r, aWins: null, aHalves: null, bWins: null, dormie: null }
    : {
        remaining: r,
        aWins: Math.max(0, Math.floor((r - L) / 2) + 1),
        aHalves: Math.max(0, r - L + 1),
        bWins: Math.max(0, Math.floor((r + L) / 2) + 1),
        dormie: r > 0 && L === r ? "a" : r > 0 && -L === r ? "b" : null,
      };
  // holes not yet played by both (not "after thru": a skipped hole is still to come) where the side receives a stroke
  const toCome = (side: H2HSide) => status.decided ? [] : rows.filter((row, i) => row.lead == null && (side.strokes[i] ?? 0) > 0).map((row) => row.hole);
  let aBest: H2H["swing"]["aBest"] = null, bBest: H2H["swing"]["bBest"] = null;
  rows.forEach((row) => {
    if (row.lead == null) return;
    if (row.lead > 0 && (!aBest || row.lead > aBest.lead)) aBest = { lead: row.lead, after: row.hole };
    if (row.lead < 0 && (!bBest || -row.lead > bBest.lead)) bBest = { lead: -row.lead, after: row.hole };
  });
  return { rows, status, needed, strokesToCome: { a: toCome(a), b: toCome(b) }, swing: { aBest, bBest } };
}

/** The ONE printer of a match's state from one side: "5 up", "2 down", "A/S", "Won 3 & 2", "Lost 2 UP", "Halved";
 *  "" before it starts (callers choose their own "not started" wording). Used by the card, the Colosseum lists and the
 *  leaderboard's "v you" column. */
export function matchStateLabel(status: MatchCloseoutStatus, lead: number): string {
  if (status.thru === 0) return "";
  if (status.decided) return status.result === "Halved" ? "Halved" : lead > 0 ? `Won ${status.result}` : `Lost ${status.result}`;
  return lead === 0 ? "A/S" : `${Math.abs(lead)} ${lead > 0 ? "up" : "down"}`;
}
/** The running state after a hole, short: "1 up", "2 down", "A/S"; "·" when not yet played by both. */
export const runningLabel = (lead: number | null) => (lead == null ? "·" : lead === 0 ? "A/S" : `${Math.abs(lead)} ${lead > 0 ? "up" : "down"}`);
export function h2hStateLabel(h: H2H): string {
  return h.status.thru === 0 ? "Not started" : matchStateLabel(h.status, h.status.lead);
}

/** The "to win" line from a's side: "2 wins or 3 halves of the last 7" / "dormie — a half wins it" / "" when decided. */
export function h2hNeededLine(h: H2H, bName: string): { mine: string; theirs: string } {
  const n = h.needed;
  if (n.aWins == null || n.aHalves == null || n.bWins == null) return { mine: "", theirs: "" };
  const r = n.remaining;
  const of = (k: number) => `${k} of the last ${r}`;
  const mine = n.dormie === "a" ? "Dormie — a half of any hole wins it"
    : n.dormie === "b" ? "Dormie against you — win every hole left to halve the match"
    : n.aWins > r ? (n.aHalves <= r ? `Can't win — halve ${of(n.aHalves)} to halve the match` : "")
    : `Win ${of(n.aWins)}${n.aHalves <= r && n.aHalves !== n.aWins ? `, or halve ${n.aHalves}` : ""}`;
  const theirs = n.bWins === 0 ? "" : n.bWins > r ? `${bName} can't win` : `${bName} needs ${of(n.bWins)}`;
  return { mine, theirs };
}
