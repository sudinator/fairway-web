/** Personal bests — sample rounds for the design gallery's render of the REAL card (components/personal-bests-card).
 *  The three mock-up variants that chose the design (Oct 30: C) lived here until the card was built. */
import type { Round } from "@/lib/golf";

/** Sample rounds for the REAL card (lib/personal-bests): three full rounds and a nine, the latest setting new bests. */
const PARS = [4, 5, 3, 4, 4, 3, 4, 5, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
const mk = (id: string, playedAt: string, rel: number[], o: { course?: string; tee?: string; ch?: number; putts?: number[]; from?: number } = {}): Round => ({
  id, course: o.course ?? "Oak Hollow", tee_name: o.tee ?? "Blue", rating: 72.3, slope: 133, course_par: rel.length === 9 ? 36 : 72, handicap_index: 14.7, course_handicap: o.ch ?? 16, played_at: playedAt, status: "final",
  holes: rel.map((r, i) => ({ hole_number: (o.from ?? 1) + i, par: PARS[((o.from ?? 1) - 1 + i) % 18], stroke_index: i + 1, strokes: PARS[((o.from ?? 1) - 1 + i) % 18] + r, putts: o.putts?.[i] ?? null })),
} as unknown as Round);
export const pbSampleRounds: Round[] = [
  mk("s1", "2026-07-20", [1, 0, 1, 1, 0, 1, 1, 2, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0], { putts: Array(18).fill(2) }),
  mk("s2", "2026-09-14", [0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1], { course: "Galloping Hill", tee: "White", ch: 15 }),
  mk("s3", "2026-10-25", [0, 0, -1, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 1], { putts: [...Array(17).fill(2), 1] }),
  mk("s4", "2026-10-28", [0, 0, 0, 1, 0, 0, 1, 0, 0], { from: 10 }),
];