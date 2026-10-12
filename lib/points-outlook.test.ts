function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { pointsOutlook, outlookLine } from "./points-outlook";
// Nine contests (three Trifecta foursomes): 3 decided (A, A, B), 4 in play (A leads 2, B leads 1, AS 1), 2 not started.
const cs = [
  { lead: 3, thru: 15, settled: true }, { lead: 2, thru: 17, settled: true }, { lead: -1, thru: 18, settled: true },
  { lead: 1, thru: 9, settled: false }, { lead: 2, thru: 10, settled: false }, { lead: -1, thru: 8, settled: false }, { lead: 0, thru: 7, settled: false },
  { lead: 0, thru: 0, settled: false }, { lead: 0, thru: 0, settled: false },
];
const o = pointsOutlook(cs);
eq(o.decidedA, 2, "decided A"); eq(o.decidedB, 1, "decided B");
eq(o.nowA, 4.5, "now A: 2 decided + 2 leading + half of the AS"); eq(o.nowB, 2.5, "now B: 1 decided + 1 leading + half");
eq(o.open, 6, "still to play for: 9 − 3 decided"); eq(o.total, 9, "total");
eq(outlookLine(o, "USA", "Europe"), "If every match ended now: USA 4.5 · Europe 2.5", "wording: only what the big number and clinch line do not already show");
// 3 up with 4 to play is NOT decided, even though it is "now" counted for A.
{
  const r = pointsOutlook([{ lead: 3, thru: 14, settled: false }]);
  eq(r.decidedA, 0, "not decided"); eq(r.nowA, 1, "counted if ended now"); eq(r.open, 1, "still open");
}
// Weighted contests (a team leg worth 2).
{
  const r = pointsOutlook([{ lead: 1, thru: 18, settled: true, points: 2 }, { lead: 0, thru: 18, settled: true }]);
  eq(r.decidedA, 2.5, "2 + half"); eq(r.decidedB, 0.5, "half"); eq(r.open, 0, "all decided");
  eq(outlookLine(r, "Red", "Blue"), "If every match ended now: Red 2.5 · Blue 0.5", "weighted wording");
}
console.log("points-outlook tests passed");
