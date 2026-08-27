/**
 * A fractional handicap must never hand out an extra stroke.
 *
 * Reported from staging as "ph and strokes received don't line up". The allocator's loop condition
 * `k < total` made a fractional total behave as a CEILING: 10.2 gave eleven strokes. Not rounding,
 * not truncation, and invisible on screen.
 *
 * This is NOT a nine-hole issue. Any allowance produces fractions — 85% of 12 is 10.2 — so it has
 * been mis-allocating in four-ball and trifecta for as long as those allowances have existed.
 */
import { allocateStrokes } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = (n: string, a: unknown, b: unknown) => {
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${b}\n     actual   ${a}`); }
};

const back9 = Array.from({ length: 9 }, (_, i) => ({ hole_number: 10 + i, stroke_index: 2 + i * 2 }));
const full18 = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, stroke_index: i + 1 }));
const total = (h: typeof back9, ch: number | null) =>
  Object.values(allocateStrokes(h, ch)).reduce((s, v) => s + v, 0);

// ── fractions round half-up, once ──────────────────────────────────────────
// Below the half must round DOWN. These were all giving one stroke too many.
eq("10.2 -> 10", total(back9, 10.2), 10);
eq("10.4 -> 10", total(back9, 10.4), 10);
eq("8.1 -> 8", total(back9, 8.1), 8);
eq("4.25 -> 4", total(back9, 4.25), 4);
// At and above the half, up.
eq("10.5 -> 11", total(back9, 10.5), 11);
eq("10.6 -> 11", total(back9, 10.6), 11);
eq("7.65 -> 8", total(back9, 7.65), 8);
// Whole numbers are untouched — the 18-hole path must not move.
for (const ch of [0, 1, 7, 8, 10, 11, 18, 27]) {
  eq(`${ch} is unchanged`, total(full18, ch), ch);
}

// ── a nine-hole handicap is half an 18-hole one, so .5 is the common case ──
eq("21/2 = 10.5 -> 11 strokes", total(back9, 21 / 2), 11);
eq("17/2 = 8.5 -> 9 strokes", total(back9, 17 / 2), 9);
eq("7/2 = 3.5 -> 4 strokes", total(back9, 7 / 2), 4);

// ── plus handicaps give strokes BACK, and round the same way ──────────────
eq("-2.4 -> -2", total(full18, -2.4), -2);
eq("-2.5 -> -3", total(full18, -2.5), -3);

// ── edges ──────────────────────────────────────────────────────────────────
eq("null handicap -> none", total(full18, null), 0);
eq("0.4 rounds to none", total(back9, 0.4), 0);
eq("0.5 rounds to one", total(back9, 0.5), 1);
// More strokes than holes wraps to a second stroke per hole rather than being capped.
eq("20 over 9 holes -> 20 strokes", total(back9, 20), 20);

console.log(`stroke rounding: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
