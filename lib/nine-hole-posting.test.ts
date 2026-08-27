/**
 * A nine-hole round posts, on a nine-hole basis.
 *
 * WHS accepts 9-hole scores (immediately, since 2024) PROVIDED the nine has a published Course
 * Rating and Slope. GolfCourseAPI publishes neither, so BNN halves the eighteen-hole figures. That
 * is an approximation and is documented as one — the app already approximates in the same spirit
 * when it fills an unfinished round's missing holes with net par.
 *
 * The point these assertions protect: rating and par HALVE, slope does NOT. Slope is a ratio on
 * the 55-155 scale, not a stroke count.
 */
import { roundDifferential, adjustedGross, expectedNineDifferential, nineToEighteenDifferential } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const near = (n: string, a: number | null, b: number, tol = 0.02) => {
  if (a != null && Math.abs(a - b) <= tol) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ~${b}\n     actual   ${a}`); }
};
const eq = (n: string, a: unknown, b: unknown) => {
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${b}\n     actual   ${a}`); }
};

// NOTE: the nineHoleBasis() helper these once covered was removed at 177.96. Halving happens ONCE,
// at write time, in migration 0139 — an exported helper that halves a rating next to code that must
// not halve is a trap, and it reintroduced the double halve. What remains here is what matters: the
// differential must use the STORED rating, and the explainer must agree with the headline.

// ── halving slope would be a real error, so pin the size of it ─────────────
{
  // Course Handicap = idx*(slope/113) + (rating - par). Halving slope applies the difficulty
  // adjustment twice; the error GROWS with difficulty, hurting hard courses most.
  const chFor = (idx: number, slope: number, rating: number, par: number) =>
    idx * (slope / 113) + (rating - par);
  for (const slope of [113, 130, 155]) {
    const correct = chFor(7, slope, 35.75, 36);
    const halved = chFor(7, slope / 2, 35.75, 36);
    ok(`slope ${slope}: halving loses more than 3 strokes`, correct - halved > 3);
  }
}

// ── the explainer and the headline must agree ─────────────────────────────
// The differential explainer recomputes from the STORED rating and slope. If anything halves a
// second time at read time, its arithmetic and its headline disagree — reported as "we calculate
// 2 and change but show 17". Isolated tests could not see it; this compares the two paths.
{
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  // A posted nine: rating ALREADY halved at write time by migration 0139.
  const posted = {
    id: "r9", played_at: "2026-08-27", course: "Berkshire Valley", tee_name: "Blue",
    rating: 35.2, slope: 130, course_par: 36, handicap_index: 14, course_handicap: 8,
    holes: [
      hole(1, 4, 1, 4), hole(2, 4, 3, 5), hole(3, 3, 5, 3), hole(4, 4, 7, 4), hole(5, 5, 9, 5),
      hole(6, 4, 11, 4), hole(7, 4, 13, 4), hole(8, 3, 15, 4), hole(9, 4, 17, 5),
    ],
  } as never;
  const ag = adjustedGross(posted);
  const headline = roundDifferential(posted);
  // Exactly what the explainer prints, from the stored values.
  const explainer = (113 / 130) * ((ag as number) - 35.2);
  // The explainer shows the raw nine PLUS the expected conversion, and the headline is their sum.
  near("the explainer's steps sum to the headline", headline, explainer + 8.5);
  // And a nine's differential is a small number, not an eighteen-sized one.
  ok("a nine posts in the same range as an eighteen", (headline ?? 99) > 5 && (headline ?? 99) < 20);
}

// ── the differential: a nine uses its own gross, nothing filled in ─────────
{
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  // A nine played in 45 (par 36 + 9).
  const nine = {
    id: "r1", played_at: "2026-08-27", course: "C", tee_name: "Blue",
    // Stored rating is ALREADY the nine-hole figure — halved at write time by migration 0139.
    rating: 35.75, slope: 130, course_par: 36, handicap_index: 14, course_handicap: 8,
    holes: Array.from({ length: 9 }, (_, i) => hole(i + 1, 4, i * 2 + 1, 5)),
  } as never;
  // Differential = (113/slope) * (adjustedGross - rating9). Slope is NOT halved.
  // adjustedGross for a nine is the nine as played: 45.
  // Stored rating, full slope, then converted to an 18-hole equivalent for a 14 index.
  near("a nine's differential uses the STORED rating, then converts",
       roundDifferential(nine), (113 / 130) * (45 - 35.75) + 8.5);
  // Sanity: it must NOT be computed against the 18-hole rating, which would be wildly negative.
  ok("and not against the 18-hole rating", (roundDifferential(nine) ?? 0) > 0);
}


// ── a nine becomes an 18-HOLE EQUIVALENT ──────────────────────────────────
// The raw nine differential is on a nine-hole scale — ~2.4 where the same player's eighteens sit
// around 14. The Handicap Index averages the LOWEST 8 of 20, so an unconverted nine enters as the
// best round of the player's life and drags the index down every time they play one.
{
  // Calibrated against the USGA's published worked example: a 14.0 index posting a 9-hole
  // differential of 7.2 receives an 18-hole differential of 15.7 — implying 8.5 expected.
  near("expected for a 14.0 index is 8.5", expectedNineDifferential(14) as number, 8.5);
  near("USGA example: 7.2 -> 15.7", nineToEighteenDifferential(7.2, 14) as number, 15.7);
  // A second published example: index 14, 9-hole 6.96 -> 18-hole 15.4. Within a rounding step.
  const second = nineToEighteenDifferential(6.96, 14) as number;
  ok("second published example lands within 0.1", Math.abs(second - 15.4) <= 0.1);

  // Scratch and plus handicaps.
  near("scratch expects 1.5", expectedNineDifferential(0) as number, 1.5);
  ok("a plus handicap floors at zero", (expectedNineDifferential(-4) as number) >= 0);

  // No index means NO conversion — and an unconverted nine must never be averaged.
  eq("unknown index yields null", nineToEighteenDifferential(2.43, null), null);
  eq("unknown differential yields null", nineToEighteenDifferential(null, 14), null);
}
{
  // The reported round, end to end: gross 38 on a par-35 nine, rating 35.2, slope 130, index 14.
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  const r = {
    id: "r9", played_at: "2026-08-27", course: "Berkshire Valley", tee_name: "Blue",
    rating: 35.2, slope: 130, course_par: 35, handicap_index: 14, course_handicap: 8,
    holes: [
      hole(10, 4, 4, 4), hole(11, 4, 16, 5), hole(12, 3, 12, 3), hole(13, 4, 2, 4),
      hole(14, 4, 6, 5), hole(15, 5, 8, 5), hole(16, 3, 10, 3), hole(17, 4, 14, 5),
      hole(18, 4, 18, 4),
    ],
  } as never;
  eq("gross is 38", adjustedGross(r), 38);
  const d = roundDifferential(r) as number;
  // raw = (113/130) * (38 - 35.2) = 2.43; + 8.5 expected = 10.93
  near("the reported round posts 10.9, not 2.4 and not 17.7", d, 10.93, 0.05);
  // It must sit in the same range as an eighteen, or it will skew the index.
  ok("and is plausible against 18-hole differentials", d > 5 && d < 20);
}


// ── an EIGHTEEN is never converted ────────────────────────────────────────
// Nothing asserted this, and a sabotage widening the condition to `<= 18` passed clean. Converting
// a full round would add ~8.5 to every differential in the app.
{
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  const full = {
    id: "r18", played_at: "2026-08-27", course: "C", tee_name: "Blue",
    rating: 71.5, slope: 130, course_par: 72, handicap_index: 14, course_handicap: 16,
    holes: Array.from({ length: 18 }, (_, i) => hole(i + 1, 4, i + 1, 5)),
  } as never;
  const ag = adjustedGross(full) as number;
  // Straight formula, no expected-score term.
  near("an 18-hole round is NOT converted", roundDifferential(full), (113 / 130) * (ag - 71.5));
  ok("and does not carry the ~8.5 expected term",
     Math.abs((roundDifferential(full) as number) - (113 / 130) * (ag - 71.5)) < 0.01);
}
{
  // A PARTIAL round (10-17 holes) keeps the net-par fill and is not converted either.
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  const partial = {
    id: "r14", played_at: "2026-08-27", course: "C", tee_name: "Blue",
    rating: 71.5, slope: 130, course_par: 72, handicap_index: 14, course_handicap: 16,
    holes: Array.from({ length: 14 }, (_, i) => hole(i + 1, 4, i + 1, 5)),
  } as never;
  const d = roundDifferential(partial) as number;
  const ag = adjustedGross(partial) as number;
  near("a 14-hole round is not converted either", d, (113 / 130) * (ag - 71.5));
}

console.log(`nine-hole posting: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
