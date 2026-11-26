/** The Rounds tab engine (212.117): 18-hole rounds only, same-day duplicates collapsed, putts only where recorded,
 *  the 5-round floor, ties shared. */
import { ok, report } from "./screen-harness";
import { roundsStandingsFromHoles as roundsStandings, rankRounds, ROUNDS_METRICS } from "@/lib/season-rounds";
import type { RoundRow, HoleRow } from "@/lib/season-rounds";

const course = Array.from({ length: 18 }, (_, i) => ({ par: i % 3 === 2 ? 3 : i % 5 === 4 ? 5 : 4, si: i + 1 }));
let n = 0;
const round = (user: string, name: string, day: string, strokesRel: number[], ch = 10, opts: { putts?: boolean; holes?: number; course?: string } = {}): { r: RoundRow; hs: HoleRow[] } => {
  const id = `r${++n}`;
  const hs = course.slice(0, opts.holes ?? 18).map((h, i) => ({ round_id: id, hole_number: i + 1, par: h.par, stroke_index: h.si, strokes: h.par + (strokesRel[i] ?? 0), putts: opts.putts === false ? null : 2 }));
  return { r: { id, user_id: user, display_name: name, played_at: day, course: opts.course ?? "Oak Hollow", course_par: 72, course_handicap: ch }, hs };
};
const data: { r: RoundRow; hs: HoleRow[] }[] = [];
// Amit: 6 full rounds (one a same-day duplicate), one 15-hole round
for (let d = 1; d <= 6; d++) data.push(round("u1", "Amit", `2026-05-0${d}`, Array(18).fill(1).map((x, i) => (i === 0 ? -1 : x)), 12));   // +17 gross with a birdie on 1
data.push(round("u1", "Amit", "2026-05-03", Array(18).fill(2), 12));                                      // duplicate of May 3 → collapsed
data.push(round("u1", "Amit", "2026-06-01", Array(15).fill(0), 12, { holes: 15 }));                      // partial → out
// Probir: 5 rounds, no putts recorded on one, level par gross
for (let d = 1; d <= 5; d++) data.push(round("u2", "Probir", `2026-07-0${d}`, Array(18).fill(0), 4, { putts: d !== 5 }));
// Karan: 3 rounds → under the floor
for (let d = 1; d <= 3; d++) data.push(round("u3", "Karan", `2026-08-0${d}`, Array(18).fill(-1), 6));
const rows = roundsStandings(data.map((x) => x.r), data.flatMap((x) => x.hs));
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
ok(by.Amit.rounds === 6, `Amit: 6 counted (the duplicate collapsed, the 15-hole round out) — got ${by.Amit.rounds}`);
ok(by.Amit.avgGross === 16 && by.Amit.avgNet === 4, `Amit: +16 gross (17 bogeys, one birdie), +4 net to par (got ${by.Amit.avgGross}, ${by.Amit.avgNet})`);
ok(by.Amit.eagles === 6 && by.Amit.birdies === 0, `a gross birdie on the stroke-index-1 hole with a 12 handicap is a NET eagle (eagles ${by.Amit.eagles}, birdies ${by.Amit.birdies})`);
ok(by.Amit.fewestPutts === 36, "putts summed where every hole has them");
ok(by.Probir.eligible && by.Probir.fewestPutts == null, "a round without putts: no putts figure for the member");
ok(by.Probir.avgGross === 0 && by.Probir.bestGross === 68 && by.Probir.parStreak === 18, `level par on the par-68 course: streak 18, best 68 (got ${by.Probir.bestGross}, ${by.Probir.parStreak})`);
ok(!by.Karan.eligible && by.Karan.avgGross == null && by.Karan.bestGross === 50, "under the floor: listed with a best score, no average");
const r1 = rankRounds(rows, "avgNet");
ok(r1[0].row.name === "Probir" && r1[1].row.name === "Amit" && r1[2].row.name === "Karan" && r1[2].place == null, "scoring average: low first, Karan unranked after");
const p = rankRounds(rows, "fewestPutts");
ok(p.filter((x) => x.place != null).length === 1, "fewest putts ranks only members with putts on every round");
ok(ROUNDS_METRICS.length === 9, "nine ways to slice the rounds");
report("season rounds");
