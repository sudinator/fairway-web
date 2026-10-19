// The club report (210.0, owner-approved mock). Pure: a club's finished games in a period → the report.
// Owner decisions (Oct 2026): two reports a year — July 1 (January–June) and October 1 (July–September); the
// whole year is Season Wrapped. Celebration only — no "worst" lists. Reuses the shared code: net on the FULL
// course handicap via chBasis (the recap's rule); standouts and course difficulty from lib/game-highlights;
// rivalries from lib/match-outcomes; "most improved" from the index recorded at each game.
// Best gross / best net include guest rounds (owner, Oct 19 2026); member lists (most rounds, most improved,
// streaks, rivalries, most net birdies) are members only.
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { allocateStrokes } from "@/lib/golf";
import { chBasis } from "@/lib/game-shape";
import { buildHighlights } from "@/lib/game-highlights";
import { matchOutcomes } from "@/lib/match-outcomes";

export type ReportPeriod = { key: string; label: string; from: string; to: string };   // dates YYYY-MM-DD inclusive
export type ReportGame = { game: Game; players: Player[]; altScores?: AltShotScoreRow[] };
type Who = { name: string; userId: string | null };
export type ClubReport = {
  club: string; period: ReportPeriod;
  games: number; rounds: number; members: number;
  bestGross: (Who & { score: number; course: string; date: string }) | null;
  bestNet: (Who & { score: number; course: string; date: string }) | null;
  standouts: { count: number; best: (Who & { better: number; date: string }) | null };
  mostNetBirdies: (Who & { count: number }) | null;
  mostImproved: (Who & { from: number; to: number }) | null;
  mostRounds: (Who & { count: number }) | null;
  toughestCourse: { course: string; fieldGap: number } | null;
  nemesisHole: { course: string; hole: number; par: number; vsPar: number } | null;
  mostBirdiedHole: { course: string; hole: number; birdies: number } | null;
  closestRivalry: { a: string; b: string; aWins: number; bWins: number; halved: number } | null;
  longestStreak: (Who & { weeks: number }) | null;
};

/** The two report periods (owner): January–June (sent July 1) and July–September (sent October 1). */
export function reportPeriods(year: number): ReportPeriod[] {
  return [
    { key: `${year}-H1`, label: `January–June ${year}`, from: `${year}-01-01`, to: `${year}-06-30` },
    { key: `${year}-Q3`, label: `July–September ${year}`, from: `${year}-07-01`, to: `${year}-09-30` },
  ];
}

// 210.2 — what counts as a round (owner, Oct 19; BNN's handicap rule, lib/golf adjustedGross):
//   fewer than 9 holes with real scores → not a round (never scored / abandoned); 9+ → a valid round, even if it
//   was marked complete early. Best gross / best net: complete 18-hole rounds only (owner: option A).
const validHoles = (p: Player, nh: number) => (Array.isArray(p.scores) ? p.scores.slice(0, nh).filter((v) => v != null && Number(v) > 0).length : 0);
const isRound = (p: Player, nh: number) => !p.no_show && validHoles(p, nh) >= Math.min(9, nh);
const isFull18 = (p: Player, nh: number) => nh === 18 && validHoles(p, nh) === 18;
/** A real handicap reading — a missing index is skipped, never read as 0. */
const indexOf = (p: Player): number | null => { const v = (p as { handicap_index?: unknown }).handicap_index; if (v == null || v === "") return null; const n = Number(v); return isFinite(n) ? n : null; };
const weekOf = (d: string) => Math.floor((Date.parse(d + "T12:00:00Z") / 86400000 + 3) / 7);   // Monday-based week number

export function buildClubReport(club: string, period: ReportPeriod, input: ReportGame[]): ClubReport {
  const games = input.filter(({ game }) => { const d = String((game as { played_at?: string }).played_at || "").slice(0, 10); return d >= period.from && d <= period.to; });
  let rounds = 0;
  const members = new Set<string>();
  let bestGross: ClubReport["bestGross"] = null, bestNet: ClubReport["bestNet"] = null;
  let standoutCount = 0; let bestStandout: ClubReport["standouts"]["best"] = null;
  const netBirdies = new Map<string, Who & { count: number }>(), roundsBy = new Map<string, Who & { count: number }>();
  const indexBy = new Map<string, Who & { first: { d: string; v: number }; last: { d: string; v: number } }>();
  const weeksBy = new Map<string, Who & { weeks: Set<number> }>();
  const courseGaps = new Map<string, number[]>();
  const holeStats = new Map<string, { course: string; hole: number; par: number; over: number; n: number; birdies: number }>();
  const rivalries = new Map<string, { a: string; b: string; aId: string; aWins: number; bWins: number; halved: number }>();

  for (const { game, players, altScores = [] } of games) {
    const nh = game.holes_meta?.length ?? 18;
    const date = String((game as { played_at?: string }).played_at || "").slice(0, 10);
    const course = game.course || "";
    const holes = (game.holes_meta || []).map((h: { n?: number; par: number; si?: number | null }, i: number) => ({ hole_number: h.n ?? i + 1, par: h.par, stroke_index: h.si ?? null }));
    // Alternate shot: the scores belong to the PAIR — the round counts (games, rounds, attendance, rivalries)
    // but feeds no individual scoring statistic. (210.2)
    const individual = game.game_type !== "alt_shot";
    for (const p of players) {
      if (!isRound(p, nh)) continue;
      rounds++;
      const uid = (p as { user_id?: string | null }).user_id ?? null;
      const who: Who = { name: p.display_name, userId: uid };
      const raw = (p.scores as (number | null)[]).slice(0, nh);
      const scores = raw.map((v) => (v != null && Number(v) > 0 ? Number(v) : null));
      const gross = scores.reduce<number>((a, b) => a + (b ?? 0), 0);
      // Whole-number course handicap — the recap's own rule (lib/game-highlights: Math.round(chBasis)).
      const ch = Math.round(Number(chBasis(p, game.course_par, nh >= 18 ? undefined : nh) ?? 0));
      const net = gross - ch;
      if (individual && isFull18(p, nh)) {
        if (!bestGross || gross < bestGross.score) bestGross = { ...who, score: gross, course, date };
        if (!bestNet || net < bestNet.score) bestNet = { ...who, score: net, course, date };
      }
      const alloc = allocateStrokes(holes, ch);
      if (individual) scores.forEach((s, i) => {
        const h = holes[i]; if (!h || s == null) return;
        const key = `${course}#${h.hole_number}`;
        const hs = holeStats.get(key) || { course, hole: h.hole_number, par: h.par, over: 0, n: 0, birdies: 0 };
        hs.over += s - h.par; hs.n++; if (s <= h.par - 1) hs.birdies++;
        holeStats.set(key, hs);
      });
      if (!uid) continue;   // per-member lists: members only (guests have no account)
      members.add(uid);
      if (individual) {
        const nb = scores.filter((s, i) => s != null && holes[i] && s - (alloc[holes[i].hole_number] || 0) <= holes[i].par - 1).length;
        const b = netBirdies.get(uid) || { ...who, count: 0 }; b.count += nb; netBirdies.set(uid, b);
      }
      const r = roundsBy.get(uid) || { ...who, count: 0 }; r.count++; roundsBy.set(uid, r);
      const hi = indexOf(p);
      if (hi != null) {
        const x = indexBy.get(uid) || { ...who, first: { d: date, v: hi }, last: { d: date, v: hi } };
        if (date < x.first.d) x.first = { d: date, v: hi }; if (date >= x.last.d) x.last = { d: date, v: hi };
        indexBy.set(uid, x);
      }
      const w = weeksBy.get(uid) || { ...who, weeks: new Set<number>() }; w.weeks.add(weekOf(date)); weeksBy.set(uid, w);
    }
    // standouts and how hard the course played — the recap's own measure
    try {
      const h = buildHighlights(game, players);
      if (h.standouts?.basis === "field") {
        standoutCount += h.standouts.rows.length;
        for (const s of h.standouts.rows) if (!bestStandout || s.better > bestStandout.better) bestStandout = { name: s.name, userId: null, better: s.better, date };
        if (h.standouts.fieldGap != null) { const g = courseGaps.get(course) || []; g.push(h.standouts.fieldGap); courseGaps.set(course, g); }
      }   // under 8 players there's no field measure, so nothing is counted
    } catch { /* a malformed game never breaks the report */ }
    // rivalries — singles between members
    try {
      for (const o of matchOutcomes(game, players, altScores)) {
        if (o.kind !== "singles" || !o.a[0]?.userId || !o.b[0]?.userId) continue;
        const [x, y] = [o.a[0], o.b[0]].sort((m, n) => (m.userId! < n.userId! ? -1 : 1));
        const key = `${x.userId}|${y.userId}`;
        const rv = rivalries.get(key) || { a: x.name, b: y.name, aId: x.userId!, aWins: 0, bWins: 0, halved: 0 };
        if (o.winner === "halved") rv.halved++;
        else { const winnerId = (o.winner === "a" ? o.a : o.b)[0].userId; if (winnerId === rv.aId) rv.aWins++; else rv.bWins++; }
        rivalries.set(key, rv);
      }
    } catch { /* ignore */ }
  }

  const top = <T extends { count: number; name: string }>(m: Map<string, T>) => [...m.values()].filter((x) => x.count > 0).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))[0] ?? null;
  const improved = [...indexBy.values()].filter((x) => x.first.d < x.last.d && x.last.v < x.first.v - 0.05)
    .sort((a, b) => (b.first.v - b.last.v) - (a.first.v - a.last.v) || a.name.localeCompare(b.name))[0];
  const toughest = [...courseGaps.entries()].map(([course, g]) => ({ course, fieldGap: Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 10) / 10 }))
    .sort((a, b) => b.fieldGap - a.fieldGap)[0] ?? null;
  const holesRanked = [...holeStats.values()].filter((h) => h.n >= 8);   // enough rounds to mean something
  const nemesis = holesRanked.map((h) => ({ course: h.course, hole: h.hole, par: h.par, vsPar: Math.round((h.over / h.n) * 10) / 10 })).sort((a, b) => b.vsPar - a.vsPar)[0] ?? null;
  const birdied = [...holeStats.values()].filter((h) => h.birdies > 0).sort((a, b) => b.birdies - a.birdies)[0];
  const rivalry = [...rivalries.values()].map((r) => ({ ...r, played: r.aWins + r.bWins + r.halved, gap: Math.abs(r.aWins - r.bWins) }))
    .filter((r) => r.played >= 2).sort((x, y) => x.gap - y.gap || y.played - x.played)[0];
  const streak = [...weeksBy.values()].map((w) => {
    const ws = [...w.weeks].sort((a, b) => a - b); let best = 0, run = 0, prev = -9;
    for (const x of ws) { run = x === prev + 1 ? run + 1 : 1; prev = x; best = Math.max(best, run); }
    return { name: w.name, userId: w.userId, weeks: best };
  }).filter((x) => x.weeks >= 3).sort((a, b) => b.weeks - a.weeks || a.name.localeCompare(b.name))[0] ?? null;

  return {
    club, period, games: games.length, rounds, members: members.size, bestGross, bestNet,
    standouts: { count: standoutCount, best: bestStandout },
    mostNetBirdies: top(netBirdies), mostRounds: top(roundsBy),
    mostImproved: improved ? { name: improved.name, userId: improved.userId, from: improved.first.v, to: improved.last.v } : null,
    toughestCourse: toughest, nemesisHole: nemesis,
    mostBirdiedHole: birdied ? { course: birdied.course, hole: birdied.hole, birdies: birdied.birdies } : null,
    closestRivalry: rivalry ? { a: rivalry.a, b: rivalry.b, aWins: rivalry.aWins, bWins: rivalry.bWins, halved: rivalry.halved } : null,
    longestStreak: streak,
  };
}
