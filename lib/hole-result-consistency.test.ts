/**
 * LAYER 2 — every hole result must agree with its own nets.
 *
 * Layer 1 asks whether the strokes DRAWN match the strokes USED. This asks the next question: once
 * the nets are settled, does the declared winner follow from them?
 *
 * That is a separate step in the code from the net calculation and can be wrong independently. It
 * also covers the falsy-zero trap: a halved hole is `0`, which is FALSY in JavaScript, so any
 * `if (result)` treats a halve as no result at all. Nothing asserted the distinction between
 * "halved" and "not played yet" before this.
 *
 * Every producer of hole results is driven here — matchProgress, fourballHoleDetail,
 * altShotHoleDetail, altShotProgress — across a spread of scores chosen to land on the boundaries:
 * exact ties, one-stroke margins, and holes only one side has played.
 */
import {
  matchProgress, fourballHoleDetail, altShotHoleDetail, altShotProgress,
} from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const H = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const H18 = H(18), H9 = H(9);

/** Score patterns chosen to sit ON the boundaries, where an off-by-one shows. */
const PATTERNS: [string, (number | null)[], (number | null)[]][] = [
  ["identical", [4, 4, 4, 4, 4, 4, 4, 4, 4], [4, 4, 4, 4, 4, 4, 4, 4, 4]],
  ["one apart", [4, 5, 4, 5, 4, 5, 4, 5, 4], [5, 4, 5, 4, 5, 4, 5, 4, 5]],
  ["one side better", [3, 3, 3, 3, 3, 3, 3, 3, 3], [5, 5, 5, 5, 5, 5, 5, 5, 5]],
  ["partly played", [4, 4, 4, null, null, null, null, null, null], [5, 4, 3, null, null, null, null, null, null]],
  ["one side missing", [4, 4, 4, 4, 4, 4, 4, 4, 4], [null, null, null, null, null, null, null, null, null]],
];

// ── SINGLES MATCH ─────────────────────────────────────────────────────────
for (const [pname, ga, gb] of PATTERNS) {
  for (const [chA, chB] of [[0, 0], [18, 0], [4, 12], [-2, 6]]) {
    const prog = matchProgress(H9, ga, gb, chA, chB, 100);
    const label = `match/${pname}/${chA}v${chB}`;

    // The lead must move by at most one per hole: a hole is won, lost, or halved.
    let prev = 0;
    for (let i = 0; i < prog.length; i++) {
      const v = prog[i];
      if (v == null) continue;
      ok(`${label} h${i + 1}: lead moves by at most 1`, Math.abs(v - prev) <= 1);
      prev = v;
    }
    // A hole nobody completed has NO result — not a halve. `null` and `0` must stay distinct.
    if (pname === "one side missing") {
      ok(`${label}: an unplayed hole is null, not 0`, prog.every((v) => v == null));
    }
  }
}

// ── FOUR-BALL ─────────────────────────────────────────────────────────────
for (const [pname, ga, gb] of PATTERNS) {
  const members = [
    { id: "a1", gross: ga, ch: 12, noShow: false },
    { id: "a2", gross: ga.map((v) => (v == null ? null : v + 1)), ch: 4, noShow: false },
    { id: "b1", gross: gb, ch: 8, noShow: false },
    { id: "b2", gross: gb.map((v) => (v == null ? null : v + 1)), ch: 2, noShow: false },
  ];
  const d = fourballHoleDetail(H9, members as never, ["a1", "a2"], ["b1", "b2"], 90);
  const label = `fourball/${pname}`;

  for (const h of d) {
    // THE core assertion: the declared winner must follow from the nets.
    if (h.aNet != null && h.bNet != null) {
      const expected = h.aNet < h.bNet ? 1 : h.bNet < h.aNet ? -1 : 0;
      eq(`${label} h${h.hole}: result follows the nets`, h.r, expected);
    } else {
      // Not played by both -> no result. NOT a halve.
      eq(`${label} h${h.hole}: incomplete is null, not 0`, h.r, null);
    }
  }
  // Running totals reconcile: nothing dropped, nothing counted twice.
  const played = d.filter((h) => h.r != null).length;
  const last = d[d.length - 1];
  eq(`${label}: won + lost + halved == played`, last.aRun + last.bRun, played);
}

// ── ALTERNATE SHOT ────────────────────────────────────────────────────────
for (const [pname, ga, gb] of PATTERNS) {
  for (const [ac, bc] of [[14, 7.5], [9.25, 2.5], [5, 5], [2, 20]]) {
    const A = { ids: ["a1", "a2"], chs: [ac, 0], gross: ga };
    const B = { ids: ["b1", "b2"], chs: [bc, 0], gross: gb };
    const d = altShotHoleDetail(H9, A as never, B as never);
    const label = `alt_shot/${pname}/${ac}v${bc}`;

    for (const h of d) {
      if (h.aNet != null && h.bNet != null) {
        const expected = h.aNet < h.bNet ? 1 : h.bNet < h.aNet ? -1 : 0;
        eq(`${label} h${h.hole}: result follows the nets`, h.r, expected);
        // The net must be the gross minus exactly the strokes recorded on that hole.
        eq(`${label} h${h.hole}: A net is gross minus its own strokes`, h.aNet, (ga[h.hole - 1] as number) - h.aRecv);
        eq(`${label} h${h.hole}: B net is gross minus its own strokes`, h.bNet, (gb[h.hole - 1] as number) - h.bRecv);
      } else {
        eq(`${label} h${h.hole}: incomplete is null, not 0`, h.r, null);
      }
      // Only one side receives — both receiving is incoherent in match play.
      ok(`${label} h${h.hole}: only one side receives`, h.aRecv === 0 || h.bRecv === 0);
    }

    const played = d.filter((h) => h.r != null).length;
    const last = d[d.length - 1];
    eq(`${label}: won + lost + halved == played`, last.aRun + last.bRun, played);

    // Progress must be the running sum of the results — the two views cannot disagree.
    const prog = altShotProgress(H9, A as never, B as never);
    let lead = 0;
    d.forEach((h, i) => {
      if (h.r == null) { eq(`${label} h${h.hole}: progress null where no result`, prog[i], null); return; }
      lead += h.r;
      eq(`${label} h${h.hole}: progress matches the running result`, prog[i], lead);
    });
  }
}

// ── the falsy-zero trap, stated directly ─────────────────────────────────
{
  // Both sides identical, equal handicaps: every hole is HALVED. `0` is falsy, so any code doing
  // `if (result)` would treat all nine as unplayed.
  const A = { ids: ["a", "b"], chs: [10, 0], gross: [4, 4, 4, 4, 4, 4, 4, 4, 4] };
  const B = { ids: ["c", "d"], chs: [10, 0], gross: [4, 4, 4, 4, 4, 4, 4, 4, 4] };
  const d = altShotHoleDetail(H9, A as never, B as never);
  ok("every hole halved gives r === 0, never null", d.every((h) => h.r === 0));
  ok("and none of them is falsy-collapsed to unplayed", d.every((h) => h.r != null));
  const last = d[d.length - 1];
  eq("nine halves count as nine played", last.aRun + last.bRun, 9);
  eq("and the match is all square", altShotProgress(H9, A as never, B as never)[8], 0);
}

// ── an 18-hole shape, so the nine is not the only case covered ───────────
{
  const g = (v: number) => Array.from({ length: 18 }, () => v);
  const A = { ids: ["a", "b"], chs: [20, 0], gross: g(5) };
  const B = { ids: ["c", "d"], chs: [6, 0], gross: g(5) };
  const d = altShotHoleDetail(H18, A as never, B as never);
  // 14 strokes over 18 holes: the 14 hardest carry one, the other four none.
  eq("14 strokes are allocated", d.reduce((s, h) => s + h.aRecv, 0), 14);
  eq("A wins the 14 holes it receives on", d.filter((h) => h.r === 1).length, 14);
  eq("and halves the other four", d.filter((h) => h.r === 0).length, 4);
}

console.log(`hole result consistency: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
