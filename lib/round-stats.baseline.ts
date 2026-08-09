// BASELINE — the putt/GIR/fairway math exactly as it was inline in MyStatsLine (tournaments.tsx),
// transcribed independently. Used only by the differential test.
import type { Hole } from "./golf";
export type RoundStats = { withPutts: number; totalPutts: number; girHit: number; fwHoles: number; fwHit: number; fwLeft: number; fwRight: number };
export function roundStats(holes: Hole[]): RoundStats {
  const withPutts = holes.filter((h) => h.putts != null);
  const totalPutts = withPutts.reduce((s, h) => s + (h.putts || 0), 0);
  const girHit = withPutts.filter(
    (h) => h.strokes != null && h.strokes - (h.putts || 0) <= h.par - 2,
  ).length;
  const fwHoles = holes.filter((h) => h.par >= 4 && h.fairway != null);
  const fwHit = fwHoles.filter((h) => h.fairway === "hit").length;
  const fwLeft = fwHoles.filter((h) => h.fairway === "left").length;
  const fwRight = fwHoles.filter((h) => h.fairway === "right").length;
  return { withPutts: withPutts.length, totalPutts, girHit, fwHoles: fwHoles.length, fwHit, fwLeft, fwRight };
}
