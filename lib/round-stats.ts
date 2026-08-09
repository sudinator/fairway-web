import type { Hole } from "./golf";

// Per-round putt / GIR / fairway stats. Pure. Extracted from MyStatsLine (tournaments.tsx) where this
// math was inline; the same GIR predicate is also duplicated in components/ui.tsx (dedup those next).
// Verified by lib/round-stats.diff.test.ts against an independently transcribed baseline.

// Green in regulation: reached the green with >= 2 strokes to spare for par (strokes - putts <= par - 2),
// only meaningful when both strokes and putts are recorded.
export function isGIR(h: Hole): boolean {
  return h.strokes != null && h.putts != null && h.strokes - h.putts <= h.par - 2;
}

export type RoundStats = {
  withPutts: number; totalPutts: number; girHit: number;
  fwHoles: number; fwHit: number; fwLeft: number; fwRight: number;
};

export function roundStats(holes: Hole[]): RoundStats {
  const withPutts = holes.filter((h) => h.putts != null);
  const totalPutts = withPutts.reduce((s, h) => s + (h.putts || 0), 0);
  const girHit = withPutts.filter(
    (h) => h.strokes != null && h.strokes - (h.putts || 0) <= h.par - 2,
  ).length;
  const fwHoles = holes.filter((h) => h.par >= 4 && h.fairway != null);
  return {
    withPutts: withPutts.length,
    totalPutts,
    girHit,
    fwHoles: fwHoles.length,
    fwHit: fwHoles.filter((h) => h.fairway === "hit").length,
    fwLeft: fwHoles.filter((h) => h.fairway === "left").length,
    fwRight: fwHoles.filter((h) => h.fairway === "right").length,
  };
}
