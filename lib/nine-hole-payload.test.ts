import { buildGamePayload } from "./game-create";
import { holesForLength } from "./match-length";
const course = Array.from({ length: 18 }, (_, i) => ({
  n: i + 1, par: 4, si: i + 1, yards: 380,
}));
const base = {
  code: "ABC", activeGroupId: "g", name: "", courseName: "C", coursePar: 72,
  matchDate: "2026-08-26", allowancePct: 100, gameType: "match" as const,
  teamMode: false, team1: "", team2: "", skinsTeamStyle: "head_to_head" as const,
  teamScoreMode: "best_ball" as const, trifectaScoring: "per_hole" as const,
  strokeBasis: "net" as const, skinsMode: "carryover" as const,
  flightsSupported: false, flightMode: "off" as const,
};
let pass = 0, fail = 0;
const eq = (n: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; console.log(`FAIL ${n}\n  expected ${JSON.stringify(b)}\n  actual   ${JSON.stringify(a)}`); }
};
for (const [len, count, first, last] of [
  ["18", 18, 1, 18], ["front9", 9, 1, 9], ["back9", 9, 10, 18],
] as const) {
  const p = buildGamePayload({ ...base, courseHoles: holesForLength(course, len) } as never) as Record<string, unknown>;
  const hm = p.holes_meta as { n: number; si: number }[];
  eq(`${len}: hole count`, hm.length, count);
  eq(`${len}: first hole number`, hm[0].n, first);
  eq(`${len}: last hole number`, hm[hm.length - 1].n, last);
  // Stroke indexes are RE-RANKED 1-9 within a nine — an 18-hole index over nine holes is not a
  // ranking of those nine, and using it gave a 7-stroke allowance only 3 strokes. The stored
  // holes_meta must carry the re-ranked value, because that is what allocateStrokes reads.
  eq(`${len}: stroke index`, hm[0].si, len === "18" ? first : 1);
}
console.log(`nine-hole payload: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
