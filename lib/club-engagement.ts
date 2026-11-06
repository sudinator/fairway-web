/** Club engagement counts participation, not individual scoring performance. */
import type { ReportGame, ReportPeriod } from "./club-report";
import { isValidRound } from "./round-rules";
import { dedupeHoles, type Hole } from "./golf";
import { canonicalAltShotGross } from "./alt-shot-side-scores";
export type EngagementRound = { id: string; user_id: string; group_id: string | null; course: string | null; played_at: string; game_id?: string | null; status?: string | null; deleted_at?: string | null; holes: Hole[] };
export type ClubEngagement = {
  period: ReportPeriod; rounds: number; members: number; totalMembers: number; games: number; courses: number;
  standaloneRounds: number; participationPct: number | null; missingCourseRounds: number;
  topCourses: { name: string; rounds: number; members: number }[];
};
export function clubEngagementPeriod(now: number): ReportPeriod {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (key: string) => parts.find((p) => p.type === key)!.value;
  const to = `${get("year")}-${get("month")}-${get("day")}`;
  const start = new Date(`${to}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 29);
  return { key: `club-30:${to}`, label: "Last 30 days", from: start.toISOString().slice(0, 10), to };
}
export function buildClubEngagement(groupId: string, period: ReportPeriod, memberIds: readonly string[], input: ReportGame[], standalone: EngagementRound[] = []): ClubEngagement {
  const eligible = new Set(memberIds.filter(Boolean)), seen = new Set<string>(), people = new Set<string>(), games = new Set<string>();
  const byCourse = new Map<string, { name: string; rounds: number; people: Set<string> }>();
  let rounds = 0, missingCourseRounds = 0;
  for (const { game, players, altScores = [] } of input) {
    const date = String((game as { played_at?: string | null }).played_at || "").slice(0, 10);
    if (game.group_id !== groupId || game.status !== "ended" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < period.from || date > period.to) continue;
    const n = game.holes_meta?.length || 0;
    const name = String(game.course || "").trim().replace(/\s+/g, " "), courseKey = name.toLocaleLowerCase();
    for (const p of players) {
      if (!p.user_id || !eligible.has(p.user_id) || p.no_show || seen.has(`${game.id}:${p.user_id}`)) continue;
      let scores = p.scores;
      if (game.game_type === "alt_shot" || game.game_type === "scramble") {
        const f = (game.foursomes || []).find((x) => x.a.includes(p.user_id!) || x.b.includes(p.user_id!));
        if (!f) continue;
        scores = canonicalAltShotGross(altScores, f.id, f.a.includes(p.user_id) ? "a" : "b", n, p.scores);
      }
      if (!isValidRound(scores, n)) continue;
      seen.add(`${game.id}:${p.user_id}`); people.add(p.user_id); games.add(game.id); rounds++;
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
    seen.add(`round:${r.id}`); people.add(r.user_id); rounds++; standaloneRounds++;
    const name = String(r.course || "").trim().replace(/\s+/g, " "), key = name.toLocaleLowerCase();
    if (!name) { missingCourseRounds++; continue; }
    const c = byCourse.get(key) || { name, rounds: 0, people: new Set<string>() };
    c.rounds++; c.people.add(r.user_id); byCourse.set(key, c);
  }
  return { period, standaloneRounds, rounds, members: people.size, totalMembers: eligible.size, games: games.size, courses: byCourse.size,
    participationPct: eligible.size ? Math.round(100 * people.size / eligible.size) : null, missingCourseRounds,
    topCourses: [...byCourse.values()].sort((a, b) => b.rounds - a.rounds || a.name.localeCompare(b.name)).slice(0, 3).map((c) => ({ name: c.name, rounds: c.rounds, members: c.people.size })) };
}
