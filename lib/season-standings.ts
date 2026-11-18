/**
 * Season standings — the club's order of merit (owner, Nov 17, 2026). ONE table, sortable by the metric the viewer
 * picks; nothing index- or personal-round-based ("this app might not be the primary app used by all club members — keep
 * the focus on what data exists"). Counts ENDED club games in the four own-ball formats — Stableford, stroke play,
 * best ball (four-ball) and trifecta; skins, scramble, alternate shot and the Cup are out; test clubs never reach here
 * (the loader drops them). Members only (a guest has no account to rank). Five games to appear; ties share the place.
 * Every number comes from the same helpers the game screens use (positions, points, match outcomes, segments, standouts).
 */
import type { Game, Player } from "@/lib/game-types";
import * as PS from "@/lib/player-scoring";
import { courseHandicapOf } from "@/lib/game-shape";
import { matchOutcomes } from "@/lib/match-outcomes";
import { buildHighlights } from "@/lib/game-highlights";
import { indivSegScheme, segRanges, segValues, segLeadersFor } from "@/lib/segments";

export const STANDINGS_FORMATS = new Set(["stableford", "stroke", "fourball", "trifecta"]);
export const STANDINGS_MIN_GAMES = 5;

export type StandingRow = {
  userId: string; name: string; avatarUrl: string | null;
  games: number;
  wins: number;            // an individual first place OR a won best-ball / trifecta match (aggregated, owner's rule)
  top3: number;            // individual formats: a finish in the top 3
  matchW: number; matchL: number; matchH: number;   // best ball / trifecta matches
  avgPts: number | null;   // average Stableford points from hole scores, every own-ball game (null below the floor)
  bestGross: number | null; bestNet: number | null;
  birdies: number; eagles: number;   // net, season totals
  segments: number;        // sixes / nines won (ties share)
  contests: number;        // closest-to-the-pin / long-drive wins
  standouts: number;       // times featured as a standout round
  eligible: boolean;       // games >= the floor
};
export type StandingsMetric = "wins" | "avgPts" | "bestGross" | "birdies" | "match" | "top3" | "games" | "segments" | "contests";
export const METRICS: { key: StandingsMetric; label: string; lowerIsBetter?: boolean; value: (r: StandingRow) => number | null; show: (r: StandingRow) => string }[] = [
  { key: "wins", label: "Wins", value: (r) => r.wins, show: (r) => String(r.wins) },
  { key: "avgPts", label: "Avg points", value: (r) => r.avgPts, show: (r) => (r.avgPts == null ? "—" : r.avgPts.toFixed(1)) },
  { key: "bestGross", label: "Best gross", lowerIsBetter: true, value: (r) => r.bestGross, show: (r) => (r.bestGross == null ? "—" : String(r.bestGross)) },
  { key: "birdies", label: "Net birdies", value: (r) => r.birdies, show: (r) => String(r.birdies) },
  { key: "match", label: "Match record", value: (r) => r.matchW - r.matchL, show: (r) => `${r.matchW}–${r.matchL}–${r.matchH}` },
  { key: "top3", label: "Top-3s", value: (r) => r.top3, show: (r) => String(r.top3) },
  { key: "games", label: "Games", value: (r) => r.games, show: (r) => String(r.games) },
  { key: "segments", label: "Segments won", value: (r) => r.segments, show: (r) => String(r.segments) },
  { key: "contests", label: "Contests won", value: (r) => r.contests, show: (r) => String(r.contests) },
];

export type ContestWin = { gameId: string; userId: string | null; name: string };

export function seasonStandings(games: Game[], playersByGame: Record<string, Player[]>, contestWins: ContestWin[] = []): StandingRow[] {
  const rows = new Map<string, StandingRow>();
  const row = (p: Player): StandingRow | null => {
    if (!p.user_id || p.is_guest) return null;
    let r = rows.get(p.user_id);
    if (!r) { r = { userId: p.user_id, name: p.display_name, avatarUrl: (p as { avatar_url?: string | null }).avatar_url ?? null, games: 0, wins: 0, top3: 0, matchW: 0, matchL: 0, matchH: 0, avgPts: null, bestGross: null, bestNet: null, birdies: 0, eagles: 0, segments: 0, contests: 0, standouts: 0, eligible: false }; rows.set(p.user_id, r); }
    return r;
  };
  const ptsSum = new Map<string, { pts: number; n: number }>();
  for (const game of games) {
    if (game.status !== "ended" || !STANDINGS_FORMATS.has(game.game_type)) continue;
    const players = playersByGame[game.id] ?? [];
    const holes = game.holes_meta?.length ?? 18;
    const finishers = players.filter((p) => !p.no_show && PS.playerThru(p) >= holes);
    if (!finishers.length) continue;
    // every own-ball game: a game played, points, gross / net, birdies & eagles
    const h = buildHighlights(game, players);
    const birdiesBy = new Map(h.netBirdies.all.map((x) => [x.name, x]));
    for (const p of finishers) {
      const r = row(p); if (!r) continue;
      r.games++;
      const pts = PS.playerPoints(p, game);
      const acc = ptsSum.get(p.user_id!) ?? { pts: 0, n: 0 }; acc.pts += pts; acc.n++; ptsSum.set(p.user_id!, acc);
      const gross = (p.scores || []).reduce<number>((t, x) => t + (Number(x) || 0), 0);   // the raw gross (strokeTotal is the game's basis)
      const net = gross - (courseHandicapOf(p, game.course_par, holes) ?? 0);   // the one accessor (212.76), never the stored figure
      r.bestGross = r.bestGross == null ? gross : Math.min(r.bestGross, gross);
      r.bestNet = r.bestNet == null ? net : Math.min(r.bestNet, net);
      const nb = birdiesBy.get(p.display_name); if (nb) { r.birdies += nb.birdies; r.eagles += nb.eagles; }
    }
    // individual formats: places
    if (game.game_type === "stableford" || game.game_type === "stroke") {
      for (const p of finishers) {
        const r = row(p); if (!r) continue;
        const pos = PS.posWithin(p, finishers, game);
        if (pos === 1) r.wins++;
        if (pos <= 3 && finishers.length >= 5) r.top3++;   // a top-3 in a three-player game isn't one (owner, Nov 17)
      }
      // segments (sixes / nines)
      const scheme = indivSegScheme(game, false);
      if (scheme !== "none") {
        const ranges = segRanges(scheme, holes);
        for (const l of segLeadersFor(finishers.map((p) => ({ p, seg: segValues(p, game, ranges) })), game, ranges)) {
          if (!l.complete || l.val == null) continue;
          for (const nm of l.who) { const p = finishers.find((x) => x.display_name === nm); const r = p && row(p); if (r) r.segments++; }
        }
      }
    }
    // team formats: the matches
    if (game.game_type === "fourball" || game.game_type === "trifecta") {
      for (const m of matchOutcomes(game, players)) {
        for (const side of ["a", "b"] as const) for (const s of m[side]) {
          const p = players.find((x) => x.user_id === s.userId); const r = p && row(p); if (!r) continue;
          if (m.winner === "halved") r.matchH++; else if (m.winner === side) { r.matchW++; r.wins++; } else r.matchL++;
        }
      }
    }
    // standouts
    for (const s of h.standouts?.rows ?? []) { const p = finishers.find((x) => x.display_name === s.name); const r = p && row(p); if (r) r.standouts++; }
  }
  for (const c of contestWins) { if (c.userId && rows.has(c.userId)) rows.get(c.userId)!.contests++; }
  for (const r of rows.values()) {
    const acc = ptsSum.get(r.userId);
    r.eligible = r.games >= STANDINGS_MIN_GAMES;
    r.avgPts = acc && r.eligible ? Math.round((acc.pts / acc.n) * 10) / 10 : null;
  }
  return [...rows.values()];
}

/** Sort by a metric; ties share the place (1, 1, 3). Players below the floor are listed after, unranked. */
export function rankBy(rows: StandingRow[], metric: StandingsMetric): { row: StandingRow; place: number | null }[] {
  const m = METRICS.find((x) => x.key === metric)!;
  const ranked = rows.filter((r) => r.eligible && m.value(r) != null).sort((a, b) => (m.lowerIsBetter ? (m.value(a)! - m.value(b)!) : (m.value(b)! - m.value(a)!)) || b.games - a.games || a.name.localeCompare(b.name));
  const out: { row: StandingRow; place: number | null }[] = [];
  ranked.forEach((r, i) => { const v = m.value(r); out.push({ row: r, place: i > 0 && m.value(ranked[i - 1]) === v ? out[i - 1].place : i + 1 }); });
  rows.filter((r) => !r.eligible || m.value(r) == null).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)).forEach((r) => out.push({ row: r, place: null }));
  return out;
}
