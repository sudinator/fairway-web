/** Club engagement counts club participation and aggregate gross scoring; never exposes individual performance. */
import type { ReportGame, ReportPeriod } from "./club-report";
import { isValidRound, holeScore } from "./round-rules";
import { dedupeHoles, holeBuckets, allocateStrokes, scoringCategory, type Hole, type Round } from "./golf";
import { canonicalAltShotGross } from "./alt-shot-side-scores";
import { gameTypeLabel } from "./game-create";
import { GAME_TYPES, shapeOf } from "./game-shape";
import { clubGameHandicap, clubPersonalHandicap } from "./club-net-scoring";
export type ClubEngagementRange = "30" | "90" | "year";
export type EngagementRound = { id: string; user_id: string; group_id: string | null; course: string | null; played_at: string; game_id?: string | null; status?: string | null; deleted_at?: string | null; holes: Hole[] } & Partial<Pick<Round, "course_handicap" | "course_handicap_source" | "handicap_index" | "rating" | "slope" | "course_par">>;
export type ClubEngagement = {
  period: ReportPeriod; rounds: number; members: number; totalMembers: number; games: number; courses: number;
  standaloneRounds: number; participationPct: number | null; missingCourseRounds: number;
  repeatPlayers: number; holesPlayed: number; scoringHoles: number;
  netScoringHoles: number; netScoring: ReturnType<typeof holeBuckets>; netExcludedHandicapHoles: number; netExcludedAllocationHoles: number;
  scoring: ReturnType<typeof holeBuckets>; formats: { name: string; games: number }[];
  topCourses: { name: string; rounds: number; members: number }[];
};
export function clubEngagementPeriod(now: number, range: ClubEngagementRange = "30"): ReportPeriod {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const to = `${get("year")}-${get("month")}-${get("day")}`;
  const start = new Date(`${to}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - (range === "90" ? 89 : 29));
  return { key: `club-${range}:${to}`, label: range === "year" ? "Year to date" : `Last ${range} days`, from: range === "year" ? `${get("year")}-01-01` : start.toISOString().slice(0, 10), to };
}
export function buildClubEngagement(groupId: string, period: ReportPeriod, memberIds: readonly string[], input: ReportGame[], standalone: EngagementRound[] = []): ClubEngagement {
  const eligible = new Set(memberIds.filter(Boolean)), seen = new Set<string>(), people = new Set<string>(), games = new Set<string>();
  const byCourse = new Map<string, { name: string; rounds: number; people: Set<string> }>();
  let rounds = 0, missingCourseRounds = 0, holesPlayed = 0;
  const roundCounts = new Map<string, number>(), formatCounts = new Map<string, number>(), scoredCards = new Set<string>();
  const classified: Hole[] = [];
  const netScoring = { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 };
  let netScoringHoles = 0, netExcludedHandicapHoles = 0, netExcludedAllocationHoles = 0;
  const countRound = (id: string) => roundCounts.set(id, (roundCounts.get(id) || 0) + 1);
  const countCard = (key: string, scores: readonly unknown[], pars: readonly unknown[], basis: number | null, allocationHoles: { hole_number: number; stroke_index: number | null }[], completeMetadata = true) => {
    if (scoredCards.has(key)) return;
    scoredCards.add(key);
    const indexes = allocationHoles.map(h => h.stroke_index);
    const canAllocate = basis != null && (basis === 0 || (completeMetadata && allocationHoles.every(h => Number.isInteger(h.hole_number) && h.hole_number >= 1 && h.hole_number <= 18) && indexes.length > 0 && indexes.every(si => typeof si === "number" && Number.isInteger(si) && si > 0 && si <= 18) && new Set(indexes).size === indexes.length && new Set(allocationHoles.map(h => h.hole_number)).size === indexes.length));
    const allocation = canAllocate ? allocateStrokes(allocationHoles, basis) : null;
    for (let i = 0; i < pars.length; i++) {
      const strokes = holeScore(scores[i]);
      if (strokes == null || !Number.isInteger(strokes)) continue;
      holesPlayed++;
      const par = pars[i];
      if (typeof par === "number" && Number.isInteger(par) && par > 0) {
        classified.push({ strokes, par } as Hole);
        if (basis == null) netExcludedHandicapHoles++;
        else if (!allocation) netExcludedAllocationHoles++;
        else { netScoring[scoringCategory(strokes - (allocation[allocationHoles[i].hole_number] || 0), par)]++; netScoringHoles++; }
      }
    }
  };
  for (const { game, players, altScores = [] } of input) {
    const date = String((game as { played_at?: string | null }).played_at || "").slice(0, 10);
    if (game.group_id !== groupId || game.status !== "ended" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.from || date > period.to) continue;
    const n = game.holes_meta?.length || 0;
    const allocationHoles = (game.holes_meta || []).map(h => ({ hole_number: h.n, stroke_index: h.si }));
    const name = String(game.course || "").trim().replace(/\s+/g, " "), courseKey = name.toLocaleLowerCase();
    for (const p of players) {
      if (!p.user_id || !eligible.has(p.user_id) || p.no_show || seen.has(`${game.id}:${p.user_id}`)) continue;
      let scores = p.scores;
      let cardKey = `${game.id}:player:${p.user_id}`;
      if (game.game_type === "alt_shot" || game.game_type === "scramble") {
        const f = (game.foursomes || []).find((x) => x.a.includes(p.user_id!) || x.b.includes(p.user_id!));
        if (!f) continue;
        const side = f.a.includes(p.user_id) ? "a" : "b";
        cardKey = `${game.id}:side:${f.id}:${side}`;
        // Legacy copies are read in stable player-ID order below; canonical rows (including null clears) win.
        const legacy = players.filter((x) => !x.no_show && x.user_id && eligible.has(x.user_id) && f[side].includes(x.user_id))
          .slice().sort((a, b) => a.id.localeCompare(b.id)).find((x) => isValidRound(x.scores, n))?.scores;
        scores = canonicalAltShotGross(altScores, f.id, side, n, p.scores);
        if (isValidRound(scores, n)) countCard(cardKey, canonicalAltShotGross(altScores, f.id, side, n, legacy ?? p.scores), game.holes_meta.map((h) => h.par), clubGameHandicap(game, players, p), allocationHoles);
      }
      if (!isValidRound(scores, n)) continue;
      seen.add(`${game.id}:${p.user_id}`); people.add(p.user_id); countRound(p.user_id);
      if (!games.has(game.id)) {
        const name = !GAME_TYPES.includes(game.game_type) ? "Other" : game.game_type === "skins" && shapeOf(game).skinsStyle !== "individual" ? "Team Skins" : gameTypeLabel(game.game_type);
        formatCounts.set(name, (formatCounts.get(name) || 0) + 1);
      }
      games.add(game.id); rounds++;
      countCard(cardKey, scores, game.holes_meta.map((h) => h.par), clubGameHandicap(game, players, p), allocationHoles);
      if (!name) { missingCourseRounds++; continue; }
      const c = byCourse.get(courseKey) || { name, rounds: 0, people: new Set<string>() };
      c.rounds++; c.people.add(p.user_id); byCourse.set(courseKey, c);
    }
  }
  let standaloneRounds = 0;
  for (const r of standalone) {
    const date = String(r.played_at || "").slice(0, 10);
    if (r.group_id !== groupId || !eligible.has(r.user_id) || r.game_id || r.deleted_at || (r.status != null && r.status !== "final") || date < period.from || date > period.to || !/^\d{4}-\d{2}-\d{2}$/.test(date) || seen.has(`round:${r.id}`)) continue;
    const hs = dedupeHoles(r.holes || []).filter((h) => h.hole_number >= 1 && h.hole_number <= 18);
    if (!isValidRound(hs.map((h) => h.strokes), hs.length > 9 ? 18 : 9)) continue;
    seen.add(`round:${r.id}`); people.add(r.user_id); countRound(r.user_id); rounds++; standaloneRounds++;
    countCard(`round:${r.id}`, hs.map((h) => h.strokes), hs.map((h) => h.par), clubPersonalHandicap(r), hs.map(h => ({ hole_number: h.hole_number, stroke_index: h.stroke_index })), hs.length === 18 || (hs.length === 9 && r.course_par != null && r.course_par <= 50));
    const name = String(r.course || "").trim().replace(/\s+/g, " "), key = name.toLocaleLowerCase();
    if (!name) { missingCourseRounds++; continue; }
    const c = byCourse.get(key) || { name, rounds: 0, people: new Set<string>() };
    c.rounds++; c.people.add(r.user_id); byCourse.set(key, c);
  }
  return { period, standaloneRounds, rounds, members: people.size, totalMembers: eligible.size, games: games.size, courses: byCourse.size,
    repeatPlayers: [...roundCounts.values()].filter((n) => n >= 2).length, holesPlayed, scoringHoles: classified.length,
    netScoringHoles, netScoring, netExcludedHandicapHoles, netExcludedAllocationHoles,
    scoring: holeBuckets([{ holes: classified } as Round]), formats: [...formatCounts].map(([name, games]) => ({ name, games })).sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    participationPct: eligible.size ? Math.round(100 * people.size / eligible.size) : null, missingCourseRounds,
    topCourses: [...byCourse.values()].sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)).slice(0, 3).map((c) => ({ name: c.name, rounds: c.rounds, members: c.people.size })) };
}
