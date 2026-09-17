/**
 * Deterministic simulation for the HALF-STROKE handicap difference (house option).
 *
 * Default is "whole": each side's Playing Handicap is rounded first, per Rule 6.2a, so the
 * difference is always whole. "half" applies the allowance unrounded, takes the difference, and
 * rounds only that to the nearest 0.5.
 *
 * The properties that must hold, and why each matters:
 *
 *   1. NEVER WORSE FOR THE RECEIVER. The half difference is always <= the whole difference rounded
 *      up, and >= the whole difference rounded down. It cannot hand a side more than a stroke more
 *      than the Rules would.
 *
 *   2. AGREEMENT WHEN THE DIFFERENCE IS ALREADY WHOLE. If rounding to the nearest half lands on an
 *      integer, "half" and "whole" must produce identical strokes on every hole. Most matches fall
 *      here, so this is what stops the option quietly changing ordinary games.
 *
 *   3. A HALF ONLY BREAKS TIES. Comparing the same two gross scores, a half stroke can convert a
 *      HALVED hole into a win for the receiver and nothing else: no win becomes a loss, no loss
 *      becomes a win, no win becomes a halve. This is the whole justification for the option.
 *
 *   4. EXACTLY ONE HALF, ON THE RIGHT HOLE. A fractional difference puts 0.5 on exactly one hole —
 *      the next ranked stroke index after the whole strokes, among the holes actually played — and
 *      whole strokes everywhere else. Totals must add back to the difference.
 *
 *   5. THE LOWER SIDE PLAYS SCRATCH, always, under both settings.
 */
import { matchAllowance, matchStrokesFor, applyAllowance, applyAllowanceExact } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; if (fails.length < 20) fails.push("FAIL " + n); } };

let seed = 0x9F17E;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[ri(0, xs.length - 1)];
const ALLOW = [50, 75, 80, 85, 90, 95, 100] as const;

const CASES = 5000;
for (let t = 0; t < CASES; t++) {
  const n = rnd() < 0.4 ? 9 : 18;
  // A nine can be the front (odd stroke indexes) or the back (even), which is what makes
  // "the next stroke index" mean the next one PRESENT rather than the next integer.
  const back = n === 9 && rnd() < 0.5;
  const holes = Array.from({ length: n }, (_, i) => ({
    hole_number: (back ? 10 : 1) + i,
    stroke_index: n === 18 ? i + 1 : (back ? (i + 1) * 2 : (i * 2) + 1),
  }));
  const allowance = pick(ALLOW);
  const chA = ri(-4, 40), chB = ri(-4, 40);

  const w = matchAllowance(chA, chB, allowance, "whole");
  const h = matchAllowance(chA, chB, allowance, "half");

  // 5 — the lower side plays scratch under both
  ok(`t${t} whole: one side scratch`, w.a === 0 || w.b === 0);
  ok(`t${t} half: one side scratch`, h.a === 0 || h.b === 0);
  // and the SAME side receives under both (rounding cannot flip who is better)
  const wRecv = w.a > 0 ? "a" : w.b > 0 ? "b" : null;
  const hRecv = h.a > 0 ? "a" : h.b > 0 ? "b" : null;
  if (wRecv && hRecv) ok(`t${t} same side receives`, wRecv === hRecv);

  const wd = Math.max(w.a, w.b), hd = Math.max(h.a, h.b);

  // 4a — a half difference is a multiple of 0.5
  ok(`t${t} half difference lands on a half`, Math.abs(hd * 2 - Math.round(hd * 2)) < 1e-9);

  // 1 — ADDITIVE: the Rules' whole-stroke answer never moves. The half setting either agrees
  //     exactly, or adds exactly 0.5. Nothing else is permitted.
  //     The first design rounded the DIFFERENCE instead of each side and failed here: it moved
  //     4.6% of matches by a full stroke with no half involved, because course handicaps are exact
  //     to several decimals. This assertion is what caught it.
  const delta = hd - wd;
  ok(`t${t} half is the rules figure or the rules figure + 0.5`,
    Math.abs(delta) < 1e-9 || Math.abs(delta - 0.5) < 1e-9);

  const isWhole = Math.abs(hd - Math.round(hd)) < 1e-9;

  // 2 — when no half is added, every hole must be identical to the rules setting
  if (isWhole) {
    for (const hole of holes) {
      ok(`t${t} h${hole.hole_number} identical when no half is added`,
        matchStrokesFor(hd, hole.stroke_index, holes) === matchStrokesFor(wd, hole.stroke_index, holes));
    }
  }

  // 4b — allocation: totals add back, exactly one hole carries the half
  const per = holes.map((hole) => matchStrokesFor(hd, hole.stroke_index, holes));
  const total = per.reduce((a, b) => a + b, 0);
  const halves = per.filter((v) => Math.abs(v - Math.floor(v) - 0.5) < 1e-9).length;
  ok(`t${t} strokes total back to the difference`, Math.abs(total - hd) < 1e-9);
  ok(`t${t} exactly one half hole when fractional`, isWhole ? halves === 0 : halves === 1);

  // 4c — the half sits on the next ranked stroke index after the whole strokes
  if (!isWhole) {
    const ranked = holes.slice().sort((x, y) => x.stroke_index - y.stroke_index);
    const expected = ranked[Math.floor(hd) % ranked.length];
    const got = holes.find((hole) => Math.abs(matchStrokesFor(hd, hole.stroke_index, holes) % 1 - 0.5) < 1e-9);
    ok(`t${t} half is on the next ranked stroke index`, !!got && got.stroke_index === expected.stroke_index);
  }

  // 3 — a half only ever breaks a tie
  const recvIsA = (hRecv ?? wRecv) === "a";
  for (const hole of holes) {
    const gA = ri(2, 9), gB = ri(2, 9);
    const sW = matchStrokesFor(wd, hole.stroke_index, holes);
    const sH = matchStrokesFor(hd, hole.stroke_index, holes);
    const netW = recvIsA ? [gA - sW, gB] : [gA, gB - sW];
    const netH = recvIsA ? [gA - sH, gB] : [gA, gB - sH];
    const cmp = (x: number[]) => (x[0] < x[1] ? -1 : x[0] > x[1] ? 1 : 0);
    const before = cmp(netW), after = cmp(netH);
    if (before !== after) {
      // Additive means the ONLY movement possible is a halved hole becoming a win for the side
      // receiving the half. Nothing else can change.
      const toReceiver = recvIsA ? -1 : 1;
      ok(`t${t} h${hole.hole_number} a half only breaks a tie`, before === 0 && after === toReceiver);
    } else {
      ok(`t${t} h${hole.hole_number} outcome unchanged`, true);
    }
  }
}

// Rule 6.2a itself: the default path must round each side, .5 upwards, BEFORE subtracting.
for (let v = 0; v <= 40; v++) {
  ok(`6.2a rounds ${v}.5 upward`, applyAllowance(v + 0.5, 100) === v + 1);
  ok(`exact allowance is unrounded ${v}`, Math.abs(applyAllowanceExact(v, 85) - (v * 0.85)) < 1e-9);
}

console.log(`half-stroke simulation: ${pass} passed, ${fail} failed (${CASES} deterministic matches, seed 0x9F17E)`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
