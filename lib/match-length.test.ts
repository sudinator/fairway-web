/**
 * Match length — 18, front nine, back nine. Applies to every format, not just alternate shot.
 *
 * The cases that matter: hole NUMBERS must survive a back-nine selection (a card showing "hole 1"
 * on the 10th tee is a scoring error), and the course handicap must halve for a nine.
 */
import {
  nineOf,
  holeCountOf,
  setHoleCount,
  setNine,
  needsNineChoice,
  canChooseNine,
  holesForLength,
  holeCountFor,
  courseHandicapForLength,
  matchLengthLabel,
  MATCH_LENGTHS,
  rerankStrokeIndexes,
} from "./match-length";

let pass = 0, fail = 0;
const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`); }
};

// The REAL shape: CourseHole is { n, par, si }, and holes_meta stores the same. An earlier
// version of this file used `hole_number`, which course holes do not carry — the fixtures agreed
// with the module because both were built from the same assumption, and only a test against the
// real payload builder caught it.
const course = Array.from({ length: 18 }, (_, i) => ({
  n: i + 1,
  par: i % 6 === 5 ? 5 : i % 4 === 3 ? 3 : 4,
  // Stroke indexes interleave odd/even across the nines, as real courses do.
  si: i < 9 ? i * 2 + 1 : (i - 9) * 2 + 2,
}));

eq("18 -> all eighteen", holeCountFor(course, "18"), 18);
eq("front9 -> nine", holeCountFor(course, "front9"), 9);
eq("back9 -> nine", holeCountFor(course, "back9"), 9);

// Hole numbers must NOT be renumbered: a back-nine match is played on 10 through 18.
eq("front nine is holes 1-9", holesForLength(course, "front9").map((h) => h.n),
   [1, 2, 3, 4, 5, 6, 7, 8, 9]);
eq("back nine is holes 10-18, NOT renumbered", holesForLength(course, "back9").map((h) => h.n),
   [10, 11, 12, 13, 14, 15, 16, 17, 18]);

// Stroke indexes are RE-RANKED 1-9 within the nine. This assertion previously demanded the
// course's own indexes come through untouched, which is what produced the reported bug: a back
// nine holds every second index, so a 7-stroke allowance landed on only 3 holes. Difficulty ORDER
// is preserved; the range is not. Covered in detail below.
eq("back nine is re-ranked, hardest first", holesForLength(course, "back9").map((h) => h.si),
   [1, 2, 3, 4, 5, 6, 7, 8, 9]);

// A nine-hole course has no back nine to take; returning nothing would be far worse.
{
  const nine = course.slice(0, 9);
  eq("nine-hole course: 18 returns all nine", holeCountFor(nine, "18"), 9);
  eq("nine-hole course: back9 still returns all nine", holeCountFor(nine, "back9"), 9);
  eq("nine-hole course: front9 still returns all nine", holeCountFor(nine, "front9"), 9);
}
eq("empty course is handled", holesForLength([], "front9"), []);

// ── course handicap halves for a nine ──────────────────────────────────────
eq("18 holes keeps the full handicap", courseHandicapForLength(14, "18"), 14);
eq("front nine halves it", courseHandicapForLength(14, "front9"), 7);
eq("back nine halves it", courseHandicapForLength(14, "back9"), 7);
// NOT rounded here. Rounding mid-chain and again when the format allowance is applied loses a
// stroke; the whole number is taken once, at the end.
eq("odd handicap stays exact at 7.5", courseHandicapForLength(15, "front9"), 7.5);
eq("scratch stays scratch", courseHandicapForLength(0, "front9"), 0);
eq("unknown handicap stays unknown", courseHandicapForLength(null, "front9"), null);

// ── labels ─────────────────────────────────────────────────────────────────
eq("18 label", matchLengthLabel("18", course), "18 holes");
eq("front nine names its holes", matchLengthLabel("front9", holesForLength(course, "front9")),
   "Front nine (1\u20139)");
eq("back nine names its holes", matchLengthLabel("back9", holesForLength(course, "back9")),
   "Back nine (10\u201318)");
ok("three lengths are offered", MATCH_LENGTHS.length === 3);


// ── setup asks TWO questions: how many holes, then which nine ─────────────
eq("18 -> first answer is 18", holeCountOf("18"), "18");
eq("front9 -> first answer is 9", holeCountOf("front9"), "9");
eq("back9 -> first answer is 9", holeCountOf("back9"), "9");

eq("18 has no nine", nineOf("18"), null);
eq("front9 -> front", nineOf("front9"), "front9");
eq("back9 -> back", nineOf("back9"), "back9");

ok("18 does not ask which nine", !needsNineChoice("18"));
ok("front9 asks which nine", needsNineChoice("front9"));
ok("back9 asks which nine", needsNineChoice("back9"));

// Switching to 9 defaults to the front — the more common casual nine, and changeable at once.
eq("18 -> 9 defaults to front", setHoleCount("18", "9"), "front9");
// ...and choosing 9 again must not reset a nine already chosen.
eq("back9 stays back when 9 is re-picked", setHoleCount("back9", "9"), "back9");
// Choosing 18 DISCARDS the nine, so "back nine" cannot linger on an 18-hole match.
eq("back9 -> 18 clears the nine", setHoleCount("back9", "18"), "18");
eq("front9 -> 18 clears the nine", setHoleCount("front9", "18"), "18");
eq("18 -> 18 is a no-op", setHoleCount("18", "18"), "18");

eq("second answer sets the nine", setNine("back9"), "back9");

// The question is meaningless on a nine-hole course: there is one nine and it is the course.
ok("18-hole course can choose a nine", canChooseNine(course));
ok("nine-hole course cannot", !canChooseNine(course.slice(0, 9)));
ok("empty course cannot", !canChooseNine([]));


// Round holes use `hole_number` rather than `n`, so both must resolve.
{
  const roundHoles = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, si: i + 1 }));
  eq("back nine of ROUND holes is labelled 10-18",
     matchLengthLabel("back9", holesForLength(roundHoles, "back9")), "Back nine (10\u201318)");
}


// ── stroke indexes are re-ranked within a nine ────────────────────────────
// Reported from staging: a 7-stroke allowance showed only 3 strokes on the card, reading as a
// second halving. It was not — an 18-hole stroke index spread over nine holes is not a ranking of
// those nine. A back nine holds every second index, so SI <= 7 matched only 2, 4 and 6.
{
  const back = holesForLength(course, "back9");
  eq("back nine is re-ranked 1-9", back.map((h) => h.si), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Hole NUMBERS are deliberately not renumbered — the opposite call, for a different reason.
  eq("but hole numbers stay 10-18", back.map((h) => h.n), [10, 11, 12, 13, 14, 15, 16, 17, 18]);

  const front = holesForLength(course, "front9");
  eq("front nine is re-ranked 1-9", front.map((h) => h.si), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  eq("front nine keeps holes 1-9", front.map((h) => h.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

  // The reported case: a 7-stroke allowance must now fall on 7 of the 9 holes.
  const strokesAt = (holes: { si?: number | null }[], ch: number) =>
    holes.filter((h) => h.si != null && (h.si as number) <= ch).length;
  eq("7 strokes now land on 7 holes", strokesAt(back, 7), 7);
  eq("8 strokes land on 8 holes", strokesAt(back, 8), 8);
  eq("1 stroke lands on the hardest hole only", strokesAt(back, 1), 1);

  // 18 holes must be untouched — the course's own index, unchanged.
  eq("18 holes keeps the course index", holesForLength(course, "18").map((h) => h.si),
     course.map((h) => h.si));
}
{
  // Difficulty ORDER is preserved, not just the range. The hardest of the nine becomes SI 1.
  const holes = [{ si: 14 }, { si: 2 }, { si: 8 }];
  eq("order preserved when re-ranking", rerankStrokeIndexes(holes).map((h) => h.si), [3, 1, 2]);
}
{
  // A hole with no stroke index keeps null rather than silently becoming the hardest.
  const holes = [{ si: 5 }, { si: null }, { si: 1 }];
  eq("null stroke index stays null", rerankStrokeIndexes(holes).map((h) => h.si), [2, null, 1]);
}

console.log(`match length: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
