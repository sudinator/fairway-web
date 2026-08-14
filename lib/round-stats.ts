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

export type RoundStatCompleteness = {
  playedHoles: number;
  puttHoles: number;
  missingPutts: number[];
  eligibleFairwayHoles: number;
  fairwayHoles: number;
  missingFairways: number[];
  puttsRoundEligible: boolean;
  shouldNudgePutts: boolean;
  shouldNudgeFairways: boolean;
};

// Shared post-round completeness contract. Whole-round putting metrics require a fully played 18-hole
// round with putts recorded on all 18 holes. Completion nudges are intentionally conservative: they
// only appear when the golfer clearly tracked almost the entire stat set, so abandoned stat tracking
// does not create nagging UI.
export function roundStatCompleteness(holes: Hole[]): RoundStatCompleteness {
  const playedHoles = holes.filter((h) => h.strokes != null);
  const missingPutts = playedHoles.filter((h) => h.putts == null).map((h) => h.hole_number);
  const puttHoles = playedHoles.length - missingPutts.length;

  const fairwayEligible = playedHoles.filter((h) => h.par >= 4);
  const missingFairways = fairwayEligible.filter((h) => h.fairway == null).map((h) => h.hole_number);
  const fairwayHoles = fairwayEligible.length - missingFairways.length;

  const puttsRoundEligible = playedHoles.length === 18 && puttHoles === 18;
  const shouldNudgePutts = playedHoles.length === 18 && puttHoles >= 15 && puttHoles < 18;
  const shouldNudgeFairways = fairwayEligible.length > 0
    && fairwayHoles >= Math.max(1, fairwayEligible.length - 3)
    && fairwayHoles < fairwayEligible.length;

  return {
    playedHoles: playedHoles.length,
    puttHoles,
    missingPutts,
    eligibleFairwayHoles: fairwayEligible.length,
    fairwayHoles,
    missingFairways,
    puttsRoundEligible,
    shouldNudgePutts,
    shouldNudgeFairways,
  };
}

export function statHoleList(holes: number[]): string {
  return holes.join(', ');
}

