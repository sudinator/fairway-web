// 212.18 — YOUR COURSES (owner, Oct 2026): a member's record at each course they've played — rounds, best and average
// gross (complete 18-hole rounds only — a standing rule), last played — and, hole by hole, their average against par,
// with their nemesis hole (worst) and best hole. From ALL their valid rounds (lib/round-rules). Pure. Shown on the
// Courses tab; the club's averages beside it come from course_field_averages (0215), averages only.
import type { Round } from "./golf";
import { holeScore, isFull18 } from "./round-rules";
import { isInsightRound } from "./insights";

export type CourseHole = { hole: number; par: number; avgToPar: number; n: number };
export type CourseRecord = {
  key: string; course: string; rounds: number; lastPlayed: string;
  bestGross: number | null; avgGross: number | null; full18: number;
  holes: CourseHole[]; nemesis: CourseHole | null; best: CourseHole | null;
};

export const courseKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function yourCourses(rounds: Round[]): CourseRecord[] {
  const by = new Map<string, Round[]>();
  for (const r of rounds.filter(isInsightRound)) {
    if (!r.course) continue;
    const k = courseKey(r.course);
    by.set(k, [...(by.get(k) || []), r]);
  }
  const out: CourseRecord[] = [];
  for (const [key, rs] of by) {
    const latest = [...rs].sort((a, b) => String(b.played_at).localeCompare(String(a.played_at)));
    const fulls = rs.filter((r) => isFull18(r.holes.map((h) => h.strokes), r.holes.length)).map((r) => r.holes.reduce((n, h) => n + (holeScore(h.strokes) || 0), 0));
    const per = new Map<number, { par: number; sum: number; n: number }>();
    for (const r of rs) for (const h of r.holes) {
      const s = holeScore(h.strokes);
      if (s == null || !h.par) continue;
      const a = per.get(h.hole_number) || { par: h.par, sum: 0, n: 0 };
      a.sum += s - h.par; a.n++; per.set(h.hole_number, a);
    }
    const holes = [...per.entries()].sort((a, b) => a[0] - b[0]).map(([hole, a]) => ({ hole, par: a.par, avgToPar: a.sum / a.n, n: a.n }));
    const ranked = holes.filter((h) => h.n >= 2);
    const nemesis = ranked.length >= 3 ? ranked.reduce((m, h) => (h.avgToPar > m.avgToPar ? h : m)) : null;
    const best = ranked.length >= 3 ? ranked.reduce((m, h) => (h.avgToPar < m.avgToPar ? h : m)) : null;
    out.push({ key, course: latest[0].course, rounds: rs.length, lastPlayed: String(latest[0].played_at).slice(0, 10),
      bestGross: fulls.length ? Math.min(...fulls) : null, avgGross: fulls.length ? fulls.reduce((a, b) => a + b, 0) / fulls.length : null, full18: fulls.length,
      holes, nemesis, best: best && nemesis && best.hole !== nemesis.hole ? best : null });
  }
  return out.sort((a, b) => b.rounds - a.rounds || b.lastPlayed.localeCompare(a.lastPlayed));
}
