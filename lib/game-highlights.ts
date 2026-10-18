// Game highlights — the shared sections of the game recap and its share image (207.2). Pure; tested.
// "Net" here is gross − FULL course handicap with strokes allocated by stroke index (the app's
// allocateStrokes) — a golfer's own net score, independent of the game's match allowance.
// Rules agreed with the owner (Oct 2026): golf-style ties everywhere ("T3"); field average only for
// 8+ players; front v back only on 18 holes; winners named, losers never singled out.
import { allocateStrokes } from "@/lib/golf";
import { pkey, chBasis } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";

export type Ranked<T> = { pos: string; item: T }[];
export type NetBirdieRow = { key: string; name: string; birdies: number; eagles: number };
export type HoleStat = { n: number; par: number; si: number | null; avg: number; vsPar: number; birdies: number; pars: number; parsOrBetter: number };
export type Highlights = {
  finishers: number;
  topGross: Ranked<{ name: string; score: number }>;
  topNet: Ranked<{ name: string; score: number; gross: number; ch: number }>;
  netBirdies: { top: Ranked<NetBirdieRow>; all: NetBirdieRow[]; birdies: number; eagles: number; players: number };
  scoring: { birdies: number; pars: number; bogeys: number; doublesPlus: number };   // gross; eagles count as birdies
  fieldNet: number | null;                     // average net of finishers; null under 8 players
  frontBack: { front: number; back: number } | null;
  toughest: HoleStat | null; easiest: HoleStat | null;
  netEagleHole: { n: number; par: number; si: number | null; count: number; total: number } | null;
  bestNetHole: { name: string; n: number; par: number; si: number | null; gross: number; grossVsPar: number; netVsPar: number } | null;
  mostParsOrBetter: { names: string[]; count: number } | null;
  mostBirdies: { names: string[]; count: number } | null;
  bestGroup: { group: number; names: string[]; avgNet: number } | null;
  roundMinutes: number | null;
  /** 209.0: rounds that were rare FOR THAT PLAYER (owner, Oct 2026). Score differential (USGA: 113/slope ×
   *  (adjusted gross − rating), each hole capped at net double bogey on the full course handicap) against the
   *  player's Handicap Index. With 8+ scored players, measured against the FIELD's average gap (the course and
   *  conditions — the idea behind the WHS playing-conditions calculation); smaller groups use the player's own
   *  index. Standout = 2.0+ better; "exceptional" = 7.0+ below the player's own index (the WHS term). */
  /** 209.1: EVERY scored player's comparison with the field (8+ players only; else empty) — for the admin
   *  Standout watch. Not shown on the recap or any shared card. */
  fieldRows: { name: string; userId: string | null; better: number }[];
  standouts: {
    basis: "field" | "own";
    fieldGap: number | null;                       // the field's average differential − index (normal ≈ +3)
    rows: { name: string; better: number; exceptional: boolean; differential: number; index: number }[];
  } | null;
};

/** Golf-style ranking: equal keys share a position, shown "T"n; keep everyone at position ≤ limit. */
export function rankTies<T>(items: T[], key: (x: T) => number | string, limit: number): Ranked<T> {
  const out: { p: number; item: T }[] = [];
  items.forEach((x, i) => {
    const p = i === 0 || key(items[i - 1]) !== key(x) ? i + 1 : out[out.length - 1].p;
    out.push({ p, item: x });
  });
  const shown = out.filter((r) => r.p <= limit);
  const tied = new Set(shown.filter((r) => shown.filter((s) => s.p === r.p).length > 1).map((r) => r.p));
  return shown.map((r) => ({ pos: `${tied.has(r.p) ? "T" : ""}${r.p}`, item: r.item }));
}

const bestOf = (m: Map<string, number>, names: Map<string, string>) => {
  let max = 0; m.forEach((v) => { if (v > max) max = v; });
  if (max <= 0) return null;
  return { names: Array.from(m.entries()).filter(([, v]) => v === max).map(([k]) => names.get(k) || "?"), count: max };
};

/** Every player against the field (8+ players), standouts or not. */
export function fieldComparison(scored: { name: string; userId?: string | null; index: number; differential: number }[]): { name: string; userId: string | null; better: number }[] {
  if (scored.length < 8) return [];
  const gaps = scored.map((x) => x.differential - x.index);
  const fieldGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return scored.map((x, i) => ({ name: x.name, userId: x.userId ?? null, better: Math.round((fieldGap - gaps[i]) * 10) / 10 }));
}

/** The comparison step on its own (209.0): differentials and indexes in, standout rounds out. */
export function standoutsFrom(scored: { name: string; index: number; differential: number }[]): Highlights["standouts"] {
  if (!scored.length) return null;
  const gaps = scored.map((x) => ({ ...x, gap: x.differential - x.index }));
  const field = gaps.length >= 8;
  const fieldGap = field ? gaps.reduce((sum, x) => sum + x.gap, 0) / gaps.length : null;
  const rows = gaps.map((x) => ({ name: x.name, better: Math.round(((fieldGap ?? 0) - x.gap) * 10) / 10, exceptional: x.gap <= -7, differential: x.differential, index: x.index }))
    .filter((r) => r.better >= 2 || r.exceptional)
    .sort((x, y) => y.better - x.better || x.name.localeCompare(y.name));
  return { basis: field ? "field" : "own", fieldGap: fieldGap == null ? null : Math.round(fieldGap * 10) / 10, rows };
}

export function buildHighlights(game: Game, players: Player[]): Highlights {
  const holes = (game.holes_meta || []) as { n: number; par: number; si: number | null }[];
  const nh = holes.length;
  const live = players.filter((p) => !p.no_show);
  const played = (p: Player, i: number) => { const x = (p.scores || [])[i]; return typeof x === "number" && x > 0 ? x : null; };
  const finishers = live.filter((p) => holes.every((_, i) => played(p, i) != null));
  const gross = (p: Player) => holes.reduce((s, _, i) => s + (played(p, i) || 0), 0);
  // Through chBasis: honours manual course-handicap overrides (0153) exactly as the match engines do.
  const ch = (p: Player) => Math.round(Number(chBasis(p, game.course_par, nh) ?? 0));
  const net = (p: Player) => gross(p) - ch(p);
  const names = new Map(live.map((p) => [pkey(p), p.display_name]));
  const alloc = new Map(live.map((p) => [pkey(p), allocateStrokes(holes.map((h) => ({ hole_number: h.n, par: h.par, stroke_index: h.si })) as never, ch(p))]));

  // Top 3 gross / net (finishers only).
  const byGross = [...finishers].sort((a, b) => gross(a) - gross(b));
  const byNet = [...finishers].sort((a, b) => net(a) - net(b));
  const topGross = rankTies(byGross.map((p) => ({ name: p.display_name, score: gross(p) })), (x) => x.score, 3);
  const topNet = rankTies(byNet.map((p) => ({ name: p.display_name, score: net(p), gross: gross(p), ch: ch(p) })), (x) => x.score, 3);

  // Hole-by-hole.
  const scoring = { birdies: 0, pars: 0, bogeys: 0, doublesPlus: 0 };
  const parsOrBetter = new Map<string, number>(), birdies = new Map<string, number>();
  const nb = new Map<string, NetBirdieRow>();
  const eaglesByHole = new Map<number, number>();
  let bestNetHole: Highlights["bestNetHole"] = null;
  live.forEach((p) => {
    const k = pkey(p); const a = alloc.get(k) || {};
    holes.forEach((h, i) => {
      const x = played(p, i); if (x == null) return;
      const d = x - h.par;
      if (d <= -1) { scoring.birdies++; birdies.set(k, (birdies.get(k) || 0) + 1); } else if (d === 0) scoring.pars++; else if (d === 1) scoring.bogeys++; else scoring.doublesPlus++;
      if (d <= 0) parsOrBetter.set(k, (parsOrBetter.get(k) || 0) + 1);
      const nd = x - ((a as Record<number, number>)[h.n] || 0) - h.par;
      if (nd <= -1) {
        const row = nb.get(k) || { key: k, name: p.display_name, birdies: 0, eagles: 0 };
        if (nd <= -2) { row.eagles++; eaglesByHole.set(h.n, (eaglesByHole.get(h.n) || 0) + 1); } else row.birdies++;
        nb.set(k, row);
      }
      // Best net hole: best net-to-par, then best ACTUAL score to par, then the harder hole.
      const si = h.si ?? 99;
      if (!bestNetHole || nd < bestNetHole.netVsPar || (nd === bestNetHole.netVsPar && (d < bestNetHole.grossVsPar || (d === bestNetHole.grossVsPar && si < (bestNetHole.si ?? 99)))))
        bestNetHole = { name: p.display_name, n: h.n, par: h.par, si: h.si, gross: x, grossVsPar: d, netVsPar: nd };
    });
  });
  if (bestNetHole && (bestNetHole as { netVsPar: number }).netVsPar > -1) bestNetHole = null;   // only a net birdie or better is a highlight

  // Net birdies & eagles: holes under par, eagles break ties.
  const all = Array.from(nb.values()).sort((a, b) => (b.birdies + b.eagles) - (a.birdies + a.eagles) || b.eagles - a.eagles || a.name.localeCompare(b.name));
  const top = rankTies(all, (r) => `${r.birdies + r.eagles}|${r.eagles}`, 5);
  const totalEagles = all.reduce((s, r) => s + r.eagles, 0);

  // Holes: field average v par; toughest / easiest.
  const hs: HoleStat[] = holes.map((h, i) => {
    const xs = live.map((p) => played(p, i)).filter((x): x is number => x != null);
    const avg = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
    return { n: h.n, par: h.par, si: h.si, avg, vsPar: avg - h.par, birdies: xs.filter((x) => x < h.par).length, pars: xs.filter((x) => x === h.par).length, parsOrBetter: xs.filter((x) => x <= h.par).length };
  }).filter((h) => h.avg > 0);
  const toughest = hs.length ? [...hs].sort((a, b) => b.vsPar - a.vsPar || (a.si ?? 99) - (b.si ?? 99))[0] : null;
  const easiest = hs.length ? [...hs].sort((a, b) => a.vsPar - b.vsPar || (b.si ?? 0) - (a.si ?? 0))[0] : null;

  // One hole stands out for net eagles: at least 3, and at least half of all net eagles.
  let netEagleHole: Highlights["netEagleHole"] = null;
  eaglesByHole.forEach((c, n) => { if (c >= 3 && c * 2 >= totalEagles && (!netEagleHole || c > netEagleHole.count)) { const h = holes.find((x) => x.n === n)!; netEagleHole = { n, par: h.par, si: h.si, count: c, total: totalEagles }; } });

  // Field average (8+ finishers) and front v back (18 holes).
  const fieldNet = finishers.length >= 8 ? finishers.reduce((s, p) => s + net(p), 0) / finishers.length : null;
  const nine = (p: Player, from: number) => holes.slice(from, from + 9).reduce((s, _, i) => s + (played(p, from + i) || 0), 0);
  const frontBack = nh === 18 && finishers.length >= 2 ? { front: finishers.reduce((s, p) => s + nine(p, 0), 0) / finishers.length, back: finishers.reduce((s, p) => s + nine(p, 9), 0) / finishers.length } : null;

  // Best group: lowest average net among tee groups of 2+ finishers (when there are 2+ groups).
  const groups = new Map<number, Player[]>();
  finishers.forEach((p) => { const g = (p as any).tee_group; if (g != null) groups.set(g, [...(groups.get(g) || []), p]); });
  const gList = Array.from(groups.entries()).filter(([, ps]) => ps.length >= 2).map(([g, ps]) => ({ group: g, names: ps.map((p) => p.display_name), avgNet: ps.reduce((s, p) => s + net(p), 0) / ps.length }));
  const bestGroup = gList.length >= 2 ? gList.sort((a, b) => a.avgNet - b.avgNet)[0] : null;

  // Round length: first clock start to last clock end.
  const starts = live.map((p) => (p as any).clock_start).filter(Boolean).map((t: string) => Date.parse(t));
  const ends = live.map((p) => (p as any).clock_end).filter(Boolean).map((t: string) => Date.parse(t));
  const roundMinutes = starts.length && ends.length ? Math.round((Math.max(...ends) - Math.min(...starts)) / 60000) : null;

  // ---- standout rounds (209.0) ----
  const scored = finishers.map((p) => {
    const hi = Number((p as any).handicap_index), rating = Number((p as any).rating), slope = Number((p as any).slope);
    if (!isFinite(hi) || !isFinite(rating) || !isFinite(slope) || slope <= 0 || nh !== 18) return null;
    const a = (alloc.get(pkey(p)) || {}) as Record<number, number>;
    const ags = holes.reduce((sum, h, i) => sum + Math.min(played(p, i) || 0, h.par + 2 + (a[h.n] || 0)), 0);   // net double bogey cap
    const differential = Math.round(((113 / slope) * (ags - rating)) * 10) / 10;
    return { name: p.display_name, userId: (p as any).user_id ?? null, index: hi, differential, gap: differential - hi };
  }).filter((x): x is { name: string; userId: string | null; index: number; differential: number; gap: number } => !!x);
  const standouts = standoutsFrom(scored);
  const fieldRows = fieldComparison(scored);

  return {
    standouts, fieldRows,
    finishers: finishers.length, topGross, topNet,
    netBirdies: { top, all, birdies: all.reduce((s, r) => s + r.birdies, 0), eagles: totalEagles, players: all.length },
    scoring, fieldNet, frontBack, toughest, easiest, netEagleHole, bestNetHole,
    mostParsOrBetter: bestOf(parsOrBetter, names), mostBirdies: bestOf(birdies, names), bestGroup,
    roundMinutes: roundMinutes != null && roundMinutes > 0 && roundMinutes < 12 * 60 ? roundMinutes : null,
  };
}
