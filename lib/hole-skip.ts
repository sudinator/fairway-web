/**
 * 212.111 (owner, Nov 16): "prevent a score being entered when a hole is being skipped — if after hole 1 the next hole
 * scored is 3, we should get some warning … and ask if we should switch to hole 2". Pure rule: given the group's scores,
 * which hole do we expect next, and does opening `holeIdx` skip it?
 *  - the expected next hole is the one after the group's LAST scored hole, wrapping 18 → 1 (a shotgun start on 10 is fine);
 *  - no warning when nothing is scored yet (any hole may be first), when the opened hole already has a score (an edit),
 *    or when the expected hole has a score from anyone in the group;
 *  - scores are per player; "the group" is the players on the card.
 */
export type HoleSkip = { expectedIdx: number; openedIdx: number } | null;

export function expectedNextHole(scores: (number | null | undefined)[][], holeCount: number): number | null {
  // the last scored hole: the highest index with any positive score, following the group's run (a shotgun start on 10
  // scores 10..18 then 1..9: once 18 is scored and 1 is scored, the run continues from the low holes)
  const scored = (i: number) => scores.some((row) => (row?.[i] ?? 0) > 0);
  const any = Array.from({ length: holeCount }, (_, i) => scored(i));
  if (!any.some(Boolean)) return null;
  if (any[holeCount - 1] && any[0]) {   // wrapped: the run continues from the start
    let i = 0; while (i < holeCount && any[i]) i++;
    return i % holeCount;
  }
  let last = -1; for (let i = holeCount - 1; i >= 0; i--) if (any[i]) { last = i; break; }
  return (last + 1) % holeCount;
}

export function holeSkip(scores: (number | null | undefined)[][], holeCount: number, openedIdx: number): HoleSkip {
  const expected = expectedNextHole(scores, holeCount);
  if (expected == null || expected === openedIdx) return null;
  const scored = (i: number) => scores.some((row) => (row?.[i] ?? 0) > 0);
  if (scored(openedIdx)) return null;          // editing a hole already scored
  if (scored(expected)) return null;           // the expected hole is already in
  return { expectedIdx: expected, openedIdx };
}
