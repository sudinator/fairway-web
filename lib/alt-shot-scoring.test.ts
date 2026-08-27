/**
 * Alternate shot scoring, verified against a REAL game pulled from staging.
 *
 * Game b492e67e, Berkshire Valley back nine, 27 Aug 2026. The app scored hole 15 as halved when
 * side A should have won it. This reproduces that game exactly and pins the correct answer.
 *
 * WHY IT WAS WRONG
 * Alternate shot was being scored by fourballNets — best-ball. That takes min() across a side's two
 * players, each with their own handicap relative to the foursome's lowest INDIVIDUAL. With one
 * shared ball both partners hold the same gross, so min() returned whichever partner happened to
 * receive more strokes: side A got 5 where the side difference is 7.
 */
import { altShotSideStrokes, altShotHoleDetail, altShotProgress } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

// ── the real game ─────────────────────────────────────────────────────────
// hole, par, si, side A gross, side B gross — exactly as stored.
const REAL: [number, number, number, number, number][] = [
  [10, 4, 4, 4, 5], [11, 4, 16, 5, 3], [12, 3, 12, 2, 4],
  [13, 4, 2, 3, 4], [14, 4, 18, 4, 4], [15, 5, 14, 5, 5],
  [16, 3, 8, 3, 3], [17, 4, 6, 5, 5], [18, 4, 10, 4, 5],
];
const holes = REAL.map(([n, par, si]) => ({ n, par, si })) as never;

// 18-hole course handicaps 16 and 21 vs 1 and 9, halved for the nine, then the 50% foursomes
// allowance applied per player — which sums to the same as half the combined pair.
const A = { ids: ["amit", "gsuper"], chs: [8.0 * 0.5, 10.5 * 0.5], gross: REAL.map((r) => r[3]) };
const B = { ids: ["g1", "thisone"], chs: [0.5 * 0.5, 4.5 * 0.5], gross: REAL.map((r) => r[4]) };

// ── the side handicaps ────────────────────────────────────────────────────
{
  const s = altShotSideStrokes(A as never, B as never);
  eq("side A plays off 9.25", s.aCh, 9.25);
  eq("side B plays off 2.5", s.bCh, 2.5);
  // 6.75 rounds ONCE, at the difference. Rounding each side first would give 9 - 3 = 6.
  eq("side A receives 7 strokes", s.strokes, 7);
  eq("and it is side A receiving", s.receiving, "a");
}

// ── the hole that was scored wrongly ──────────────────────────────────────
{
  const d = altShotHoleDetail(holes, A as never, B as never);
  const h15 = d.find((x) => x.hole === 15)!;
  // Both sides shot 5. A's stroke is the entire result — the app halved it.
  eq("hole 15: side A receives a stroke", h15.aRecv, 1);
  eq("hole 15: side B does not", h15.bRecv, 0);
  eq("hole 15: A nets 4", h15.aNet, 4);
  eq("hole 15: B nets 5", h15.bNet, 5);
  eq("hole 15: side A WINS (the app said halved)", h15.r, 1);
}

// ── every hole, so a fix cannot break the ones that were right ───────────
{
  const d = altShotHoleDetail(holes, A as never, B as never);
  const expect: Record<number, number> = {
    10: 1, 11: -1, 12: 1, 13: 1, 14: 0, 15: 1, 16: 1, 17: 1, 18: 1,
  };
  for (const [hole, r] of Object.entries(expect)) {
    eq(`hole ${hole} result`, d.find((x) => x.hole === Number(hole))!.r, r);
  }
  // 7 strokes across 9 holes: one on every hole except the two easiest by stroke index —
  // holes 11 (SI 16) and 14 (SI 18).
  eq("no stroke on the easiest hole", d.find((x) => x.hole === 14)!.aRecv, 0);
  eq("nor the second easiest", d.find((x) => x.hole === 11)!.aRecv, 0);
  eq("but one on the hardest", d.find((x) => x.hole === 13)!.aRecv, 1);
}

// ── the match ─────────────────────────────────────────────────────────────
{
  const prog = altShotProgress(holes, A as never, B as never);
  // A wins 7, B wins 1, one halved -> A up 6. The app had A up 5.
  eq("side A finishes 6 up", prog[prog.length - 1], 6);
}

// ── edges ─────────────────────────────────────────────────────────────────
{
  // Equal sides: nobody receives.
  const even = altShotSideStrokes(
    { ids: ["a", "b"], chs: [6, 6], gross: [] } as never,
    { ids: ["c", "d"], chs: [5, 7], gross: [] } as never,
  );
  eq("equal side handicaps give no strokes", even.strokes, 0);
  eq("and nobody receives", even.receiving, null);
}
{
  // A missing handicap must not be treated as scratch — that would hand out strokes nobody agreed.
  const miss = altShotSideStrokes(
    { ids: ["a", "b"], chs: [6, null], gross: [] } as never,
    { ids: ["c", "d"], chs: [5, 7], gross: [] } as never,
  );
  eq("a missing handicap yields no side handicap", miss.aCh, null);
  eq("and no strokes", miss.strokes, 0);
}
{
  // A hole only one side has played is not a result.
  const part = altShotHoleDetail(
    [{ n: 1, par: 4, si: 1 }] as never,
    { ids: ["a", "b"], chs: [8, 8], gross: [5] } as never,
    { ids: ["c", "d"], chs: [2, 2], gross: [null] } as never,
  );
  eq("an incomplete hole has no result", part[0].r, null);
  eq("and no net for the missing side", part[0].bNet, null);
}

console.log(`alt shot scoring: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
