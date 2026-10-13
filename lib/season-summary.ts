// Year-end season summary (205.0). Pure; every figure comes from the engine's own functions
// (roundDifferential, runningHandicap, adjustedGross, badgesForRound) applied to the golfer's rounds
// for a calendar year, Jan 1 – Dec 31. Cards are built only where the data supports them; a season
// under the floor (5 rounds) gets the short version. No money anywhere (owner, Oct 13). Club comparisons: totals for everyone, YOUR rank only when
// it is top three, never on the share card.
import { roundDifferential, runningHandicap, adjustedGross, handicapRounds, girStats, firStats, scrambleStats, sandSaveStats, puttsOf, pensOf, ptsOf, played, type Round } from "./golf";
import { prepareRounds } from "./round-prep";
import { badgesForRound, BADGES } from "./badges";

export const SEASON_FLOOR = 5;

export type SeasonInput = {
  year: number;
  name: string;
  rounds: Round[];                       // the golfer's finished rounds, any year (filtered here)
  /** Match results this year, from games the golfer played: opponent name and whether they won / lost / halved. */
  matches?: { opponent: string; result: "won" | "lost" | "halved"; played_at: string }[];
  /** Club-wide context (optional). */
  club?: { name: string; totalRounds: number; members: number; myRank?: { metric: string; rank: number; of: number }[]; playedWithMost?: { name: string; rounds: number } | null } | null;
};

export type SeasonCard =
  | { kind: "headline"; rounds: number; holes: number; hours: number | null; courses: number }
  | { kind: "index"; start: number | null; end: number | null; low: number | null; lowDate: string | null; series: { date: string; index: number }[];
      /** Build-up year: the index became "established" (20 differentials) on this date; start is null and the trend runs from here. */
      establishedOn: string | null; establishedAt: number | null;
      /** Every season round with a differential, in date order — the Dashboard's Scoring Form, for the season. */
      diffs: { date: string; course: string; value: number }[] }
  | { kind: "best"; course: string; tee: string | null; par: number | null; date: string; gross: number | null; differential: number; indexAfter: number | null;
      /** That round's stats beside the season's — "what you can do when…". Each null when not recorded. */
      stats: { label: string; day: string; season: string; better: boolean }[] }
  | { kind: "birdies"; birdies: number; eaglesOrBetter: number; favouriteHole: { course: string; hole: number; count: number } | null;
      /** The most recent five birdies-or-better, newest first. */
      recent: { date: string; course: string; hole: number; par: number; strokes: number }[] }
  | { kind: "grind"; puttsPerRound: { first: number; last: number } | null; fairwayPct: number | null; mostImproved: string | null;
      /** Putts per full round in date order (rounds with putts on all 18). */
      putts: { date: string; course: string; value: number }[] }
  | { kind: "headToHead"; won: number; lost: number; halved: number; rival: { name: string; won: number; lost: number; halved: number } | null }
  | { kind: "badges"; earned: { key: string; label: string; icon: string; tier: string }[]; rarest: { key: string; label: string; icon: string; tier: string } | null }
  | { kind: "club"; name: string; totalRounds: number; members: number; myRank: { metric: string; rank: number; of: number } | null; playedWithMost: { name: string; rounds: number } | null }
  | { kind: "closing"; target: string }
  | { kind: "short"; rounds: number };

export type SeasonSummary = {
  year: number; name: string; rounds: number; cards: SeasonCard[];
  /** The share card's facts — never money, never rank. */
  share: { rounds: number; courses: number; indexStart: number | null; indexEnd: number | null; bestDifferential: number | null; birdies: number; favouriteCourse: string | null; badges: number };
};

const inYear = (iso: string, year: number) => (iso || "").slice(0, 4) === String(year);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function buildSeasonSummary(input: SeasonInput): SeasonSummary {
  const { year, name } = input;
  // Same rounds, prepared the same way, as the Dashboard: recv allocated, then handicapRounds().
  const all = handicapRounds(prepareRounds(input.rounds.filter((r) => (r.status ?? "final") === "final")));
  const season = all.filter((r) => inYear(r.played_at, year)).sort((a, b) => a.played_at.localeCompare(b.played_at));
  const cards: SeasonCard[] = [];
  const birdieCount = (rs: Round[]) => rs.reduce((n, r) => n + r.holes.filter((h) => h.strokes != null && h.strokes > 0 && h.strokes === h.par - 1).length, 0);
  const courses = Array.from(new Set(season.map((r) => r.course)));
  const byCourse = new Map<string, number>(); for (const r of season) byCourse.set(r.course, (byCourse.get(r.course) || 0) + 1);
  const favouriteCourse = Array.from(byCourse.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  if (season.length < SEASON_FLOOR) {
    cards.push({ kind: "short", rounds: season.length });
    return { year, name, rounds: season.length, cards, share: { rounds: season.length, courses: courses.length, indexStart: null, indexEnd: null, bestDifferential: null, birdies: birdieCount(season), favouriteCourse, badges: 0 } };
  }

  // Headline
  const holes = season.reduce((n, r) => n + r.holes.filter((h) => h.strokes != null && h.strokes > 0).length, 0);
  cards.push({ kind: "headline", rounds: season.length, holes, hours: null, courses: courses.length });

  // Index journey: the running index after each round of the season, using every round to date
  // (the best-8-of-20 window can reach back into the prior year — that is the rule, not a leak).
  const before = all.filter((r) => r.played_at < `${year}-01-01`);
  const diffCount = (rs: Round[]) => rs.filter((r) => roundDifferential(r) != null).length;
  const establishedBefore = diffCount(before) >= 20;
  const start = establishedBefore ? runningHandicap(before).index : null;
  let establishedOn: string | null = null, establishedAt: number | null = null;
  const full: { date: string; index: number }[] = [];
  for (let i = 0; i < season.length; i++) {
    const upTo = [...before, ...season.slice(0, i + 1)];
    const idx = runningHandicap(upTo).index;
    if (idx != null) full.push({ date: season[i].played_at, index: idx });
    if (!establishedBefore && establishedOn == null && diffCount(upTo) >= 20) { establishedOn = season[i].played_at; establishedAt = idx; }
  }
  // Trend only from establishment: below 20 differentials the WHS table deliberately starts low and
  // rises as rounds arrive, which is the sample filling in, not the golfer getting worse.
  const series = establishedBefore ? full : establishedOn ? full.filter((s) => s.date >= establishedOn!) : [];
  const end = full.length ? full[full.length - 1].index : null;
  const lowPt = series.length ? series.reduce((a, b) => (b.index < a.index ? b : a)) : null;
  const diffs = season.map((r) => ({ date: r.played_at, course: r.course, d: roundDifferential(r) })).filter((x): x is { date: string; course: string; d: number } => x.d != null).map((x) => ({ date: x.date, course: x.course, value: r1(x.d) }));
  cards.push({ kind: "index", start, end, low: lowPt?.index ?? null, lowDate: lowPt?.date ?? null, series, establishedOn, establishedAt, diffs });

  // Best day: lowest differential
  const withDiff = season.map((r) => ({ r, d: roundDifferential(r) })).filter((x): x is { r: Round; d: number } => x.d != null);
  if (withDiff.length) {
    const best = withDiff.reduce((a, b) => (b.d < a.d ? b : a));
    const after = full.find((s) => s.date === best.r.played_at)?.index ?? null;
    // The engine's own stat functions, on the best round and on the whole season, so the card shows
    // the gap. A stat is shown only when the best round recorded it.
    const frac = (x: { hit: number; total: number }) => (x.total ? x.hit / x.total : null);
    const pctS = (v: number | null) => (v == null ? "" : `${Math.round(v * 100)}%`);
    const statRows: { label: string; day: string; season: string; better: boolean }[] = [];
    // Net score and Stableford points, on 18-hole rounds with hole scores (the engine's ptsOf uses the
    // allocated strokes from prepareRounds). Season figures are the averages over the same kind of round.
    const full18 = (r: Round) => played(r).length >= 18;
    const netOf = (r: Round) => (r.course_handicap != null ? played(r).reduce((n, h) => n + (h.strokes || 0), 0) - r.course_handicap : null);
    const avgOf = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    if (full18(best.r)) {
      const s18 = season.filter(full18);
      const bn = netOf(best.r), an = avgOf(s18.map(netOf));
      if (bn != null && an != null) statRows.push({ label: "Net score", day: String(bn), season: String(r1(an)), better: bn < an });
      const bs = ptsOf(best.r), as = avgOf(s18.map(ptsOf));
      if (as != null) statRows.push({ label: "Stableford points", day: String(bs), season: String(r1(as)), better: bs > as });
    }
    // Percentages where the samples are large (fairways, greens); counts where they are small
    // (scrambling, sand saves) — "0 of 1" is honest where "0%" misleads (owner, Oct 13).
    const pair = (label: string, f: (rs: Round[]) => { hit: number; total: number }, asCount = false) => {
      const day = f([best.r]), all = f(season);
      const d1 = frac(day), sAll = frac(all);
      if (d1 == null || sAll == null) return;
      statRows.push({ label, day: asCount ? `${day.hit} of ${day.total}` : pctS(d1), season: asCount && all.total < 50 ? `${all.hit} of ${all.total}` : pctS(sAll), better: d1 > sAll });
    };
    pair("Fairways", firStats); pair("Greens in regulation", girStats); pair("Scrambling", scrambleStats, true); pair("Sand saves", sandSaveStats, true);
    const fullPutts = (r: Round) => (played(r).length >= 18 && played(r).every((h) => h.putts != null) ? puttsOf(r) : null);
    const bp = fullPutts(best.r); const sp = season.map(fullPutts).filter((x): x is number => x != null);
    if (bp != null && sp.length) { const avgP = sp.reduce((a, b) => a + b, 0) / sp.length; statRows.push({ label: "Putts", day: String(bp), season: String(r1(avgP)), better: bp < avgP }); }
    const bpen = played(best.r).some((h) => h.penalties != null) ? pensOf(best.r) : null;
    if (bpen != null) { const spen = season.filter((r) => played(r).some((h) => h.penalties != null)); if (spen.length) { const avgPen = spen.reduce((a, r) => a + pensOf(r), 0) / spen.length; statRows.push({ label: "Penalties", day: String(bpen), season: String(r1(avgPen)), better: bpen < avgPen }); } }
    cards.push({ kind: "best", course: best.r.course, tee: best.r.tee_name ?? null, par: best.r.course_par ?? (played(best.r).length >= 18 ? played(best.r).reduce((n, h) => n + h.par, 0) : null), date: best.r.played_at, gross: best.r.gross_score ?? played(best.r).reduce((n, h) => n + (h.strokes || 0), 0), differential: r1(best.d), indexAfter: after, stats: statRows });
  }

  // Birdies and better
  const birdies = birdieCount(season);
  const eagles = season.reduce((n, r) => n + r.holes.filter((h) => h.strokes != null && h.strokes > 0 && h.strokes <= h.par - 2).length, 0);
  const holeCounts = new Map<string, number>();
  for (const r of season) for (const h of r.holes) if (h.strokes != null && h.strokes > 0 && h.strokes <= h.par - 1) { const k = `${r.course}|${h.hole_number}`; holeCounts.set(k, (holeCounts.get(k) || 0) + 1); }
  const fav = Array.from(holeCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  const recent = season.flatMap((r) => r.holes.filter((h) => h.strokes != null && h.strokes > 0 && h.strokes <= h.par - 1).map((h) => ({ date: r.played_at, course: r.course, hole: h.hole_number, par: h.par, strokes: h.strokes as number })))
    .sort((a, b) => b.date.localeCompare(a.date) || b.hole - a.hole).slice(0, 5);
  if (birdies + eagles > 0) cards.push({ kind: "birdies", birdies, eaglesOrBetter: eagles, favouriteHole: fav && fav[1] >= 2 ? { course: fav[0].split("|")[0], hole: Number(fav[0].split("|")[1]), count: fav[1] } : null, recent });

  // The grind: putts per round, first five vs last five; fairway %; most improved
  const roundPutts = (r: Round) => { const hs = r.holes.filter((h) => h.putts != null); return hs.length >= 18 ? hs.reduce((n, h) => n + (h.putts || 0), 0) : null; };
  const puttsSeries = season.map((r) => ({ date: r.played_at, course: r.course, value: roundPutts(r) })).filter((x): x is { date: string; course: string; value: number } => x.value != null);
  const pr = puttsSeries.map((x) => x.value);
  const puttsPerRound = pr.length >= 10 ? { first: r1(pr.slice(0, 5).reduce((a, b) => a + b, 0) / 5), last: r1(pr.slice(-5).reduce((a, b) => a + b, 0) / 5) } : null;
  const fwS = firStats(season);
  const fairwayPct = fwS.total >= 50 ? Math.round((fwS.hit / fwS.total) * 100) : null;
  const halves = [withDiff.slice(0, Math.floor(withDiff.length / 2)), withDiff.slice(Math.floor(withDiff.length / 2))];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const d1 = mean(halves[0].map((x) => x.d)), d2 = mean(halves[1].map((x) => x.d));
  const mostImproved = d1 != null && d2 != null && d2 < d1 - 0.5 ? `Your average differential fell from ${r1(d1)} to ${r1(d2)} over the season` : puttsPerRound && puttsPerRound.last < puttsPerRound.first - 0.5 ? `Putting: ${puttsPerRound.first} → ${puttsPerRound.last} per round` : null;
  if (puttsPerRound || fairwayPct != null || mostImproved) cards.push({ kind: "grind", puttsPerRound, fairwayPct, mostImproved, putts: puttsSeries });

  // Head to head
  const ms = (input.matches || []).filter((m) => inYear(m.played_at, year));
  if (ms.length) {
    const tally = (xs: typeof ms) => ({ won: xs.filter((m) => m.result === "won").length, lost: xs.filter((m) => m.result === "lost").length, halved: xs.filter((m) => m.result === "halved").length });
    const byOpp = new Map<string, typeof ms>(); for (const m of ms) byOpp.set(m.opponent, [...(byOpp.get(m.opponent) || []), m]);
    const rivalEntry = Array.from(byOpp.entries()).sort((a, b) => b[1].length - a[1].length)[0];
    const rival = rivalEntry && rivalEntry[1].length >= 2 ? { name: rivalEntry[0], ...tally(rivalEntry[1]) } : null;
    cards.push({ kind: "headToHead", ...tally(ms), rival });
  }

  // Badges earned this season (replaying the engine's awards in order)
  const earnedKeys = new Set<string>();
  for (const r of season) for (const a of badgesForRound(all, r.id)) if (a.kind !== "count") earnedKeys.add(a.key);
  const tierRank: Record<string, number> = { common: 0, uncommon: 1, rare: 2, elite: 3, epic: 3, legendary: 4 };
  const earned = BADGES.filter((b) => earnedKeys.has(b.key)).map((b) => ({ key: b.key, label: b.label, icon: b.icon, tier: b.tier }));
  const rarest = earned.length ? earned.reduce((a, b) => ((tierRank[b.tier] ?? 0) > (tierRank[a.tier] ?? 0) ? b : a)) : null;
  if (earned.length) cards.push({ kind: "badges", earned, rarest });

  // Club
  if (input.club) {
    const top = (input.club.myRank || []).filter((x) => x.rank <= 3).sort((a, b) => a.rank - b.rank)[0] ?? null;
    cards.push({ kind: "club", name: input.club.name, totalRounds: input.club.totalRounds, members: input.club.members, myRank: top, playedWithMost: input.club.playedWithMost ?? null });
  }

  // Closing: the one number to beat
  const target = lowPt ? `Beat your season low index of ${lowPt.index}` : withDiff.length ? `Beat your best differential of ${r1(withDiff.reduce((a, b) => (b.d < a.d ? b : a)).d)}` : `Play more than ${season.length} rounds`;
  cards.push({ kind: "closing", target });

  return {
    year, name, rounds: season.length, cards,
    share: { rounds: season.length, courses: courses.length, indexStart: start, indexEnd: end, bestDifferential: withDiff.length ? r1(withDiff.reduce((a, b) => (b.d < a.d ? b : a)).d) : null, birdies, favouriteCourse, badges: earned.length },
  };
}
