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
import { nineHoleBasis, roundDifferential } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const near = (n: string, a: number | null, b: number, tol = 0.02) => {
  if (a != null && Math.abs(a - b) <= tol) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ~${b}\n     actual   ${a}`); }
};
const eq = (n: string, a: unknown, b: unknown) => {
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${b}\n     actual   ${a}`); }
};

// ── the basis ──────────────────────────────────────────────────────────────
{
  const b = nineHoleBasis(71.5, 130, 72, 9);
  near("rating halves", b.rating as number, 35.75);
  eq("slope does NOT halve", b.slope, 130);
  eq("par halves", b.par, 36);
  ok("and it is flagged as approximated", b.approximated);
}
{
  // 18 holes and partial rounds are untouched — a partial is an eighteen with holes missing.
  for (const n of [18, 17, 12, 10]) {
    const b = nineHoleBasis(71.5, 130, 72, n);
    eq(`${n} holes: rating unchanged`, b.rating, 71.5);
    eq(`${n} holes: par unchanged`, b.par, 72);
    ok(`${n} holes: not flagged`, !b.approximated);
  }
}
{
  // Missing data must not become 0, which would look like a scratch course.
  const b = nineHoleBasis(null, null, null, 9);
  eq("null rating stays null", b.rating, null);
  eq("null slope stays null", b.slope, null);
  eq("null par stays null", b.par, null);
}

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

// ── the differential: a nine uses its own gross, nothing filled in ─────────
{
  const hole = (n: number, par: number, si: number, strokes: number) =>
    ({ hole_number: n, par, stroke_index: si, strokes, putts: null, fairway: null, penalties: 0 });
  // A nine played in 45 (par 36 + 9).
  const nine = {
    id: "r1", played_at: "2026-08-27", course: "C", tee_name: "Blue",
    rating: 71.5, slope: 130, course_par: 72, handicap_index: 14, course_handicap: 16,
    holes: Array.from({ length: 9 }, (_, i) => hole(i + 1, 4, i * 2 + 1, 5)),
  } as never;
  // Differential = (113/slope) * (adjustedGross - rating9). Slope is NOT halved.
  // adjustedGross for a nine is the nine as played: 45.
  near("a nine's differential uses the halved rating and full slope",
       roundDifferential(nine), (113 / 130) * (45 - 35.75));
  // Sanity: it must NOT be computed against the 18-hole rating, which would be wildly negative.
  ok("and not against the 18-hole rating", (roundDifferential(nine) ?? 0) > 0);
}

console.log(`nine-hole posting: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
