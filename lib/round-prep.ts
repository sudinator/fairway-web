// The ONE preparation the app applies to a round loaded from the database before any stat is
// computed (205.0, extracted from components/home.tsx): holes in order, and each hole's handicap
// strokes (recv) allocated from the round's course handicap. Net double bogey, Stableford and the
// differential all depend on recv; a round without it is capped as if the golfer received no
// strokes, which understated the season index by 0.9 on real data (11.9 vs the Dashboard's 12.8).
import { allocateStrokes, type Hole, type Round } from "./golf";

export function prepareRound<R extends { holes?: Hole[] | null; course_handicap?: number | null }>(r: R): R & { holes: Hole[] } {
  const sorted = [...(r.holes || [])].sort((a, b) => a.hole_number - b.hole_number);
  const alloc = allocateStrokes(sorted, r.course_handicap ?? null);
  return { ...r, holes: sorted.map((h) => ({ ...h, recv: alloc[h.hole_number] || 0 })) };
}

export function prepareRounds<R extends Round>(rounds: R[]): R[] {
  return rounds.map((r) => prepareRound(r) as R);
}
