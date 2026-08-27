/**
 * Nine-hole course handicap.
 *
 * Reported from staging: a 9-hole match allocated the FULL 18-hole handicap — "ph 16" and "a
 * stroke on every hole, + 2nd on 10, 13, 16, 17, 18". The player card and the strokes panel
 * disagreed because the card reads the stored course_handicap while the panel recomputes through
 * chBasis; two sources for one number, one of them wrong.
 *
 * The trap these assertions exist to prevent: slicing coursePar looks like the fix and makes it
 * WORSE, because chBasis computes (rating - coursePar) and an 18-hole rating against a 9-hole par
 * is incoherent.
 */
import { chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const near = (n: string, a: number, b: number, tol = 0.05) => {
  if (Math.abs(a - b) <= tol) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ~${b}\n     actual   ${a.toFixed(2)}`); }
};

// The player from the staging report: index 14, blue tees.
const p = { handicap_index: 14, slope: 130, rating: 71.5, course_handicap: 16 };
const PAR18 = 72;

// ── 18 holes: unchanged, and omitting the argument must behave identically ─
near("18 holes", chBasis(p, PAR18, 18), 15.61);
near("omitting the hole count is 18", chBasis(p, PAR18), 15.61);
ok("omitted and explicit 18 agree", chBasis(p, PAR18) === chBasis(p, PAR18, 18));

// ── 9 holes: half the 18-hole figure ───────────────────────────────────────
near("9 holes is half", chBasis(p, PAR18, 9), 7.80);
ok("9 holes is exactly half of 18", Math.abs(chBasis(p, PAR18, 9) * 2 - chBasis(p, PAR18, 18)) < 1e-9);

// THE TRAP. Slicing coursePar to 36 while the rating stays an 18-hole rating gives ~52 — far worse
// than the unhalved 15.6 it was meant to fix. Pinned so nobody "fixes" that line again.
{
  const sliced = chBasis(p, 36, 9);
  ok("slicing coursePar does NOT give the right answer", Math.abs(sliced - 7.80) > 5);
  ok("and is worse than leaving it unhalved", Math.abs(sliced - 15.61) > Math.abs(15.61 - 7.80));
}

// ── the stored-handicap fallback halves too ────────────────────────────────
// A guest with no index falls back to course_handicap. It is stored as an 18-hole figure, so a
// nine must halve it as well — otherwise guests and members get different treatment on the same card.
{
  const guest = { handicap_index: null, slope: null, rating: null, course_handicap: 16 };
  near("fallback, 18 holes", chBasis(guest, PAR18, 18), 16);
  near("fallback, 9 holes halves too", chBasis(guest, PAR18, 9), 8);
}

// ── edges ──────────────────────────────────────────────────────────────────
ok("a scratch player stays scratch on a nine",
   chBasis({ handicap_index: 0, slope: 113, rating: 72, course_handicap: 0 }, PAR18, 9) === 0);
// A plus handicap halves toward zero rather than flipping sign.
ok("a plus handicap halves toward zero",
   chBasis({ handicap_index: -2, slope: 113, rating: 72, course_handicap: -2 }, PAR18, 9) < 0);
// Guard values must not be mistaken for a nine.
near("holeCount 0 is ignored, not treated as a nine", chBasis(p, PAR18, 0), 15.61);
near("negative holeCount is ignored", chBasis(p, PAR18, -1), 15.61);
near("null holeCount is 18", chBasis(p, PAR18, null), 15.61);
// A 12-hole game is not a nine.
near("12 holes is not halved", chBasis(p, PAR18, 12), 15.61);

console.log(`nine-hole handicap: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
