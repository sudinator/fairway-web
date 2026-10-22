// Scramble (211.0, owner-approved mock, Oct 20 2026): every player hits, the team picks the best shot, everyone
// plays from there — ONE score per team per hole. Pure: no database, no screens.
//
// Owner decisions: team sizes 2, 3 and 4; teams compete on one leaderboard OR team v team (both offered); an
// optional drive requirement (off by default); handicap strokes allotted HOLE BY HOLE by stroke index; no betting.
//
// Handicaps — USGA Rules of Handicapping, Appendix C (recommended allowances): 4 players 25% / 20% / 15% / 10%,
// 3 players 30% / 20% / 10%, 2 players 35% / 15%, from the lowest course handicap to the highest. Applied to each
// player's UNROUNDED course handicap; only the team total is rounded (lib/golf allocateStrokes rounds once, the
// same rule the rest of the app uses). "Gross only" sets the team handicap to 0.
//
// A scramble score belongs to the team: it is never an individual round (no handicap posting, no personal stats —
// lib/round-rules countsForIndividualStats).
import { allocateStrokes } from "./golf";
import { holeScore } from "./round-rules";

export type ScrambleTeamSize = 2 | 3 | 4;
/** USGA recommended scramble allowances, lowest course handicap first. */
export const SCRAMBLE_ALLOWANCES: Record<ScrambleTeamSize, number[]> = { 2: [0.35, 0.15], 3: [0.30, 0.20, 0.10], 4: [0.25, 0.20, 0.15, 0.10] };

export type TeamHandicap = { total: number; raw: number; parts: { index: number; ch: number; pct: number; counts: number }[] };

/**
 * A team's playing handicap from its players' unrounded course handicaps (any order; `index` in the result
 * points back to the input). Missing handicaps count as 0. Returns null for a team size the USGA table doesn't
 * cover (fewer than 2 or more than 4 players). gross = true → 0.
 */
export function scrambleTeamHandicap(courseHandicaps: (number | null | undefined)[], gross = false, customPcts?: number[] | null): TeamHandicap | null {
  const n = courseHandicaps.length as ScrambleTeamSize;
  // 211.9: a game may set its own percentages (fractions, lowest course handicap first) — else the USGA's
  const pcts = customPcts && customPcts.length === n ? customPcts : SCRAMBLE_ALLOWANCES[n];
  if (!pcts) return null;
  const sorted = courseHandicaps.map((ch, index) => ({ index, ch: Number.isFinite(Number(ch)) ? Number(ch) : 0 })).sort((a, b) => a.ch - b.ch || a.index - b.index);
  const parts = sorted.map((p, i) => ({ ...p, pct: gross ? 0 : pcts[i], counts: gross ? 0 : p.ch * pcts[i] }));
  const raw = parts.reduce((s, p) => s + p.counts, 0);
  // Round half away from zero, once, on the total (a plus-handicap team rounds the same way as allocateStrokes).
  const total = gross ? 0 : Math.sign(raw) * Math.round(Math.abs(raw));
  return { total: Object.is(total, -0) ? 0 : total, raw, parts };
}

type Hole = { n?: number; hole_number?: number; par: number; si?: number | null; stroke_index?: number | null };
const holeNo = (h: Hole, i: number) => h.hole_number ?? h.n ?? i + 1;

export type ScrambleCard = {
  holes: { n: number; par: number; gross: number | null; strokes: number; net: number | null }[];
  thru: number; gross: number; net: number; grossToPar: number; netToPar: number;
};

/** One team's card: gross per hole, the team's strokes allotted by stroke index, net per hole and totals so far. */
export function scrambleCard(holesMeta: Hole[], teamScores: unknown[], teamHandicap: number): ScrambleCard {
  const holes = holesMeta.map((h, i) => ({ hole_number: holeNo(h, i), stroke_index: h.stroke_index ?? h.si ?? null, par: h.par }));
  const alloc = allocateStrokes(holes, teamHandicap);
  let gross = 0, net = 0, par = 0, thru = 0;
  const out = holes.map((h, i) => {
    const g = holeScore(teamScores?.[i]);
    const strokes = alloc[h.hole_number] || 0;
    if (g != null) { gross += g; net += g - strokes; par += h.par; thru++; }
    return { n: h.hole_number, par: h.par, gross: g, strokes, net: g != null ? g - strokes : null };
  });
  return { holes: out, thru, gross, net, grossToPar: gross - par, netToPar: net - par };
}

export type LeaderboardTeam = { key: string; name: string; scores: unknown[]; handicap: number };
export type LeaderboardRow = { key: string; name: string; pos: string; rank: number; thru: number; gross: number; net: number; grossToPar: number; netToPar: number; handicap: number };

/**
 * Every team ranked — by net to par (or gross, for a gross-only game), shared positions on ties ("T2"); teams
 * that haven't started go last. To par keeps the order fair while teams are on different holes.
 */
export function scrambleLeaderboard(holesMeta: Hole[], teams: LeaderboardTeam[], by: "net" | "gross" = "net"): LeaderboardRow[] {
  const rows = teams.map((t) => { const c = scrambleCard(holesMeta, t.scores, t.handicap); return { key: t.key, name: t.name, handicap: t.handicap, thru: c.thru, gross: c.gross, net: c.net, grossToPar: c.grossToPar, netToPar: c.netToPar }; });
  const score = (r: (typeof rows)[number]) => (by === "net" ? r.netToPar : r.grossToPar);
  const started = rows.filter((r) => r.thru > 0).sort((a, b) => score(a) - score(b) || b.thru - a.thru || a.name.localeCompare(b.name));
  const notStarted = rows.filter((r) => r.thru === 0).sort((a, b) => a.name.localeCompare(b.name));
  const ranked: LeaderboardRow[] = [];
  started.forEach((r, i) => {
    const rank = i > 0 && score(started[i - 1]) === score(r) ? ranked[i - 1].rank : i + 1;
    const tied = started.filter((x) => score(x) === score(r)).length > 1;
    ranked.push({ ...r, rank, pos: `${tied ? "T" : ""}${rank}` });
  });
  return [...ranked, ...notStarted.map((r) => ({ ...r, rank: started.length + 1, pos: "—" }))];
}

export type ScrambleMatch = { lead: number; thru: number; holesLeft: number; decided: boolean; result: string | null };

/**
 * Team v team, hole by hole on net scores (each team's strokes allotted by stroke index — the owner's choice,
 * so the match can swing on stroke holes). lead > 0 = team A up. Decided when the lead can't be caught.
 */
export function scrambleMatch(holesMeta: Hole[], a: { scores: unknown[]; handicap: number }, b: { scores: unknown[]; handicap: number }): ScrambleMatch {
  const ca = scrambleCard(holesMeta, a.scores, a.handicap), cb = scrambleCard(holesMeta, b.scores, b.handicap);
  let lead = 0, thru = 0;
  for (let i = 0; i < holesMeta.length; i++) {
    const x = ca.holes[i].net, y = cb.holes[i].net;
    if (x == null || y == null) break;          // holes are played in order; stop at the first one not both scored
    thru++; if (x < y) lead++; else if (y < x) lead--;
    if (Math.abs(lead) > holesMeta.length - thru) break;
  }
  const holesLeft = holesMeta.length - thru;
  const decided = thru > 0 && (Math.abs(lead) > holesLeft || holesLeft === 0);
  const result = !decided ? null : lead === 0 ? "Halved" : holesLeft === 0 ? `${Math.abs(lead)} up` : `${Math.abs(lead)}&${holesLeft}`;
  return { lead, thru, holesLeft, decided, result };
}

export type DriveTally = { counts: Record<string, number>; needs: { player: string; more: number; holesLeft: number; short: boolean }[]; met: boolean };

/**
 * Whose drive was used on each hole, and — when a minimum is set — who still needs how many with how many holes
 * left (short = can no longer make it). A nudge, never a block.
 */
export function driveTally(drives: (string | null | undefined)[], players: string[], minDrives: number | null, holes: number): DriveTally {
  const counts: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  let played = 0;
  for (let i = 0; i < holes; i++) { const d = drives?.[i]; if (d) { played++; if (d in counts) counts[d]++; } }
  const holesLeft = Math.max(0, holes - played);
  const needs = !minDrives ? [] : players.map((p) => ({ player: p, more: Math.max(0, minDrives - counts[p]), holesLeft, short: Math.max(0, minDrives - counts[p]) > holesLeft }))
    .filter((x) => x.more > 0);
  return { counts, needs, met: !minDrives || needs.length === 0 };
}

/** 211.9: a game's own allowance for a team of `n` (games.scramble_allowance — percent per position), as fractions;
 *  null when the game uses the USGA's for that size (or the entry is malformed). */
export function customAllowanceFor(allowance: unknown, n: number): number[] | null {
  const v = allowance && typeof allowance === "object" ? (allowance as Record<string, unknown>)[String(n)] : null;
  if (!Array.isArray(v) || v.length !== n || !v.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 100)) return null;
  return v.map((x) => x / 100);
}

/**
 * 212.3: team v team as a hole-by-hole running lead (team A's view; null where either team hasn't scored) — the shape
 * the Ryder Cup's shared closeout (lib/golf matchCloseoutStatus) reads for every format, so a scramble session's
 * results ("2&1", "AS") read exactly like the others'. Each team's strokes from its own handicap, by stroke index.
 */
export function scrambleMatchProgress(holesMeta: Hole[], a: { scores: unknown[]; handicap: number }, b: { scores: unknown[]; handicap: number }): (number | null)[] {
  const ca = scrambleCard(holesMeta, a.scores, a.handicap), cb = scrambleCard(holesMeta, b.scores, b.handicap);
  let lead = 0;
  return holesMeta.map((_, i) => {
    const x = ca.holes[i].net, y = cb.holes[i].net;
    if (x == null || y == null) return null;
    if (x < y) lead++; else if (y < x) lead--;
    return lead;
  });
}
