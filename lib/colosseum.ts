/**
 * The Colosseum (212.136, owner): everyone plays everyone. Every pair of players in the field is a match, read off
 * the scorecards everyone already keeps — one gross score per hole per player, nothing extra to enter. A hole in a
 * match goes to the lower NET, where net is the player's gross less the strokes on their OWN card: full course
 * handicap times the game's allowance, by stroke index (lib/game-shape fullStrokes — the Stableford basis, so the
 * dots on the card ARE the strokes in every match). The owner chose this over "strokes off the lower handicap per
 * pair": one card, one rule, the same in all 28 matches of an 8-player field (n(n−1)/2).
 *
 * Match state (thru, lead, 3 & 2, Halved) comes from the ONE closeout rule (lib/golf matchCloseoutStatus), so a
 * decided match freezes at its margin exactly as a singles match does. A match between players in different tee
 * groups counts through the hole BOTH have played.
 *
 * Standings: 1 point a win, ½ a halve; a match still in play counts as it stands ("if it ended now"). Ties on
 * points break by the points won in the matches between the tied players, then by aggregate holes up, then name.
 */
import { matchCloseoutStatus, type MatchCloseoutStatus, type MatchHoleMeta } from "./golf";
import { fullStrokes, chBasis, pkey, type DotGame, type ShapePlayer } from "./game-shape";
import { applyAllowance } from "./golf";

export type ColosseumPlayer = ShapePlayer & { display_name?: string | null; scores?: (number | null)[] | null; tee_group?: number | null };
/** A Ryder Cup Colosseum (owner, Nov 27): two sides, and only pairs on OPPOSITE sides are matches — 6 v 6 is 36. */
export const isCupColosseum = (game: { game_type: string; teams?: unknown }) => game.game_type === "colosseum" && Array.isArray(game.teams) && (game.teams as unknown[]).length === 2;
const paired = (game: ColosseumGame, a: ColosseumPlayer, b: ColosseumPlayer) => !isCupColosseum(game) || (!!a.team && !!b.team && a.team !== b.team);
export type ColosseumGame = DotGame & { holes_meta?: MatchHoleMeta[] | null };

export type ColosseumMatch = {
  a: string; b: string;
  /** running lead from a's perspective after each hole both have played (null = not yet) */
  progress: (number | null)[];
  status: MatchCloseoutStatus;
  /** playing-handicap difference, positive = a gives strokes to b (shown for the stakes; the strokes are on each card) */
  gives: number;
};
export type ColosseumRow = {
  key: string; name: string; ch: number | null; group: number | null; team: string | null;
  won: number; halved: number; lost: number; points: number;
  /** aggregate lead across all matches (frozen at closeout for decided ones) */
  holes: number;
  /** matches with at least one hole played / decided outright */
  played: number; decided: number;
  rank: number;
  /** "T2" when the place is shared, else "2" — the recap's and the leaderboard's convention */
  pos: string;
};
export type ColosseumStandings = { rows: ColosseumRow[]; matches: ColosseumMatch[]; matchCount: number; holeCount: number };

export const colosseumMatchCount = (players: number) => (players * (players - 1)) / 2;
/** A Cup Colosseum: every player on one side against every player on the other — |A| × |B|. */
export const cupColosseumMatchCount = (players: { team?: string | null }[]) =>
  players.filter((p) => p.team === "A").length * players.filter((p) => p.team === "B").length;

/** In the field: everyone who is playing, plus a player marked Out who has already scored — their matches stand on the
 *  holes played (the singles rule); a no-show who never scored is simply not in the field. */
const inField = (p: ColosseumPlayer) => !p.no_show || (p.scores || []).some((x) => x != null && x > 0);
/** The ONE match-count rule (the header, the line-up, the view, the Cup): n(n−1)/2, or |A| × |B| with two sides. */
export function colosseumMatchCountFor(game: { game_type: string; teams?: unknown }, players: ColosseumPlayer[]): number {
  const field = players.filter(inField);
  return isCupColosseum(game) ? cupColosseumMatchCount(field) : colosseumMatchCount(field.length);
}
/** "5½", "½", "3" — the one printer for Colosseum points (view, live page, recap, game list). */
export const fmtHalf = (n: number) => (n % 1 === 0 ? String(n) : `${Math.floor(n) || ""}½`);

/** Each player's net on each hole off their own card; null where no gross score yet. */
function netRows(game: ColosseumGame, players: ColosseumPlayer[]): Map<string, (number | null)[]> {
  const holes = game.holes_meta || [];
  const out = new Map<string, (number | null)[]>();
  for (const p of players) {
    out.set(pkey(p), holes.map((h, i) => {
      const g = p.scores?.[i];
      return g == null || g <= 0 ? null : g - fullStrokes(game, p, h.si);
    }));
  }
  return out;
}

export function colosseumMatches(game: ColosseumGame, players: ColosseumPlayer[]): ColosseumMatch[] {
  const field = players.filter(inField);
  const nets = netRows(game, field);
  const holeCount = game.holes_meta?.length || 18;
  const ph = (p: ColosseumPlayer) => Math.round(applyAllowance(chBasis(p, game.course_par, holeCount), game.allowance_pct ?? 100));
  const out: ColosseumMatch[] = [];
  for (let i = 0; i < field.length; i++) {
    for (let j = i + 1; j < field.length; j++) {
      const a = field[i], b = field[j];
      if (!paired(game, a, b)) continue;
      const na = nets.get(pkey(a))!, nb = nets.get(pkey(b))!;
      let lead = 0;
      const progress = na.map((x, k) => {
        const y = nb[k];
        if (x == null || y == null) return null;
        if (x < y) lead++; else if (y < x) lead--;
        return lead;
      });
      out.push({ a: pkey(a), b: pkey(b), progress, status: matchCloseoutStatus(progress, holeCount), gives: ph(a) - ph(b) });
    }
  }
  return out;
}

export function colosseumStandings(game: ColosseumGame, players: ColosseumPlayer[]): ColosseumStandings {
  const field = players.filter(inField);
  const holeCount = game.holes_meta?.length || 18;
  const matches = colosseumMatches(game, field);
  const rows = new Map<string, ColosseumRow>();
  for (const p of field) {
    rows.set(pkey(p), {
      key: pkey(p), name: p.display_name || "—", ch: chBasis(p, game.course_par, holeCount), group: p.tee_group ?? null, team: p.team ?? null,
      won: 0, halved: 0, lost: 0, points: 0, holes: 0, played: 0, decided: 0, rank: 0, pos: "",
    });
  }
  const credit = (key: string, lead: number, started: boolean, decided: boolean) => {
    const r = rows.get(key)!;
    if (!started) return;
    r.played++; if (decided) r.decided++;
    r.holes += lead;
    if (lead > 0) { r.won++; r.points += 1; } else if (lead < 0) r.lost++; else { r.halved++; r.points += 0.5; }
  };
  for (const m of matches) {
    const started = m.status.thru > 0;
    credit(m.a, m.status.lead, started, m.status.decided);
    credit(m.b, -m.status.lead, started, m.status.decided);
  }
  // order: points, then the matches among the tied, then aggregate holes, then name
  const pointsBetween = (keys: Set<string>) => {
    const pts = new Map<string, number>(); keys.forEach((k) => pts.set(k, 0));
    for (const m of matches) {
      if (!keys.has(m.a) || !keys.has(m.b) || m.status.thru === 0) continue;
      if (m.status.lead > 0) pts.set(m.a, pts.get(m.a)! + 1);
      else if (m.status.lead < 0) pts.set(m.b, pts.get(m.b)! + 1);
      else { pts.set(m.a, pts.get(m.a)! + 0.5); pts.set(m.b, pts.get(m.b)! + 0.5); }
    }
    return pts;
  };
  const list = Array.from(rows.values());
  const byPoints = new Map<number, string[]>();
  for (const r of list) byPoints.set(r.points, [...(byPoints.get(r.points) || []), r.key]);
  const h2h = new Map<string, number>();
  for (const keys of byPoints.values()) {
    if (keys.length < 2) { h2h.set(keys[0], 0); continue; }
    const pts = pointsBetween(new Set(keys));
    keys.forEach((k) => h2h.set(k, pts.get(k) || 0));
  }
  list.sort((x, y) => y.points - x.points || (h2h.get(y.key)! - h2h.get(x.key)!) || y.holes - x.holes || x.name.localeCompare(y.name));
  // ties on every criterion share the place
  list.forEach((r, i) => {
    const prev = list[i - 1];
    r.rank = prev && prev.points === r.points && h2h.get(prev.key) === h2h.get(r.key) && prev.holes === r.holes ? prev.rank : i + 1;
  });
  list.forEach((r) => { r.pos = `${list.filter((x) => x.rank === r.rank).length > 1 ? "T" : ""}${r.rank}`; });
  return { rows: list, matches, matchCount: colosseumMatchCountFor(game, field), holeCount };
}

/** A Cup / team Colosseum: each side's points from the cross-side matches (1 a win, ½ a halve, as they stand). */
export function colosseumSidePoints(st: ColosseumStandings, teamOf: (key: string) => string | null | undefined): { A: number; B: number; open: number } {
  const out = { A: 0, B: 0, open: 0 };
  for (const m of st.matches) {
    const ta = teamOf(m.a), tb = teamOf(m.b);
    if ((ta !== "A" && ta !== "B") || (tb !== "A" && tb !== "B") || ta === tb || m.status.thru === 0) continue;
    if (!m.status.decided) out.open++;
    if (m.status.lead > 0) out[ta] += 1; else if (m.status.lead < 0) out[tb] += 1; else { out[ta] += 0.5; out[tb] += 0.5; }
  }
  return out;
}

export type ColosseumOpponentLine = {
  opponent: string; opponentName: string; group: number | null;
  /** from this player's perspective */
  lead: number; thru: number; result: string; decided: boolean; started: boolean;
  gives: number;
};
/** One player's matches, best-standing first, for the tap-through screen. */
export function colosseumPlayerMatches(st: ColosseumStandings, key: string): ColosseumOpponentLine[] {
  const nameOf = (k: string) => st.rows.find((r) => r.key === k);
  const out: ColosseumOpponentLine[] = [];
  for (const m of st.matches) {
    if (m.a !== key && m.b !== key) continue;
    const mine = m.a === key;
    const opp = mine ? m.b : m.a, r = nameOf(opp);
    const lead = mine ? m.status.lead : -m.status.lead;
    out.push({ opponent: opp, opponentName: r?.name || "—", group: r?.group ?? null, lead, thru: m.status.thru, result: resultFor(m.status, lead), decided: m.status.decided, started: m.status.thru > 0, gives: mine ? m.gives : -m.gives });
  }
  return out.sort((x, y) => y.lead - x.lead || x.opponentName.localeCompare(y.opponentName));
}

/** "3 & 2", "2 UP", "Halved" for a decided match; "2 up", "1 down", "A/S" while in play; "" before it starts. */
export function resultFor(status: MatchCloseoutStatus, lead: number): string {
  if (status.thru === 0) return "";
  if (status.decided) return status.result === "Halved" ? "Halved" : lead > 0 ? `Won ${status.result}` : `Lost ${status.result}`;
  return lead === 0 ? "A/S" : `${Math.abs(lead)} ${lead > 0 ? "up" : "down"}`;
}

/** "4 up · 1 down · 2 halved so far" — the strip above the standings. */
export function colosseumSummaryLine(st: ColosseumStandings, key: string): string {
  const r = st.rows.find((x) => x.key === key);
  if (!r || !r.played) return "No matches under way yet";
  const mine = st.matches.filter((m) => m.a === key || m.b === key).length;
  return `${r.won} up · ${r.lost} down · ${r.halved} halved${r.decided === mine ? "" : " so far"}`;
}
