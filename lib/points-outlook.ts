// "Decided / if every match ended now / still to play for" (204.0). Pure; tested.
//
// decided: points from contests the engine says are settled (finished, or mathematically closed
//          out). A 3-up-with-4-to-play match is NOT decided — it can still be halved.
// now:     decided + every unsettled contest that has started, scored by the same provisional rule
//          the Results cards already use: the current leader takes the point, all square splits it.
// open:    points not yet decided — what everyone is still playing for.
// Nothing here is a prediction; the wording on screen says "if every match ended now".
export type OutlookContest = { lead: number; thru: number; settled: boolean; points?: number };

export function pointsOutlook(contests: OutlookContest[]): { decidedA: number; decidedB: number; nowA: number; nowB: number; open: number; total: number } {
  let decidedA = 0, decidedB = 0, nowA = 0, nowB = 0, total = 0;
  for (const c of contests) {
    const pts = c.points ?? 1;
    total += pts;
    const a = c.lead > 0 ? pts : c.lead < 0 ? 0 : pts / 2;
    const b = pts - a;
    if (c.settled) { decidedA += a; decidedB += b; nowA += a; nowB += b; }
    else if (c.thru > 0) { nowA += a; nowB += b; }
  }
  return { decidedA, decidedB, nowA, nowB, open: total - decidedA - decidedB, total };
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

/** "If every match ended now: USA 5 · Europe 4". Decided points are the big number above it and the
 *  matches still out are the clinch line below it, so the line carries only what neither shows. */
export function outlookLine(o: ReturnType<typeof pointsOutlook>, teamA: string, teamB: string): string {
  return `If every match ended now: ${teamA} ${fmt(o.nowA)} · ${teamB} ${fmt(o.nowB)}`;
}
