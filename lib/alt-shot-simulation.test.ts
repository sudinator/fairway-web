/**
 * Deterministic model-based Alternate Shot simulation.
 *
 * This is deliberately broader than the example-based tests: it checks the production side-handicap,
 * stroke allocation, duplicated-row reader, hole result, running match, status, conflict, and edit/revert
 * contracts together. The seed is fixed so CI failures are reproducible.
 */
import { altShotSides } from "./game-shape";
import { altShotHoleDetail, altShotProgress, altShotStatus } from "./golf";
import { readAltShotSideScores } from "./alt-shot-scores";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; if (fails.length < 20) fails.push("FAIL " + name); } };

let seed = 0x17812;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const allowances = [25, 40, 50, 60, 70, 80, 85, 90, 95, 100];

const exactStrokeRound = (rawDiffTenths: number, pct: number, holes: number) => {
  const den = holes <= 9 ? 2000 : 1000;
  const num = Math.abs(rawDiffTenths) * pct;
  return Math.floor((2 * num + den) / (2 * den));
};
const expectedResult = (lead: number, thru: number, holes: number) => {
  const remaining = holes - thru;
  if (thru === 0) return "Not started";
  if (Math.abs(lead) > remaining) return remaining === 0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)} & ${remaining}`;
  if (thru === holes) return lead === 0 ? "Halved" : `${Math.abs(lead)} UP`;
  return lead === 0 ? "All square" : `${Math.abs(lead)} UP`;
};

for (let t = 0; t < 5000; t++) {
  const n = rnd() < 0.35 ? 9 : 18;
  const allowance = allowances[ri(0, allowances.length - 1)];
  const start = n === 9 && rnd() < 0.5 ? 10 : 1;
  const holes = Array.from({ length: n }, (_, i) => ({ n: start + i, par: 4, si: n === 9 ? i * 2 + 1 : i + 1 }));
  const ch10 = [ri(-50, 600), ri(-50, 600), ri(-50, 600), ri(-50, 600)];
  const players = ch10.map((c, i) => ({ id: `p${i}`, user_id: `p${i}`, course_handicap: c / 10, handicap_index: null, slope: null, rating: null }));
  const foursome = { id: "f", name: "F", a: ["p0", "p1"], b: ["p2", "p3"] };
  const game = { game_type: "alt_shot" as const, course_par: 72, allowance_pct: allowance, holes_meta: holes, foursomes: [foursome], pairings: [] };
  const sides = altShotSides(game as never, players as never, foursome as never);
  const rawDiff10 = (ch10[0] + ch10[1]) - (ch10[2] + ch10[3]);
  const expectedStrokes = exactStrokeRound(rawDiff10, allowance, n);
  ok(`case ${t}: exact stroke difference`, sides.strokes === expectedStrokes);
  ok(`case ${t}: receiving side`, sides.receiving === (expectedStrokes === 0 ? null : rawDiff10 > 0 ? "a" : "b"));

  const a1 = Array.from({ length: n }, () => rnd() < 0.08 ? null : ri(3, 9));
  const b1 = Array.from({ length: n }, () => rnd() < 0.08 ? null : ri(3, 9));
  const a2 = a1.map((v) => rnd() < 0.05 ? null : v);
  const b2 = b1.map((v) => rnd() < 0.05 ? null : v);
  const ar = readAltShotSideScores(a1, a2, n);
  const br = readAltShotSideScores(b1, b2, n);
  ok(`case ${t}: no false A conflicts`, ar.conflictHoles.length === 0);
  ok(`case ${t}: no false B conflicts`, br.conflictHoles.length === 0);

  const A = { ids: foursome.a, chs: [sides.aCh, 0], gross: ar.gross };
  const B = { ids: foursome.b, chs: [sides.bCh, 0], gross: br.gross };
  const detail = altShotHoleDetail(holes as never, A as never, B as never);
  const progress = altShotProgress(holes as never, A as never, B as never);
  const status = altShotStatus(holes as never, A as never, B as never);
  const complete = detail.filter((d) => d.r != null);
  const lead = complete.reduce((sum, d) => sum + (d.r ?? 0), 0);
  ok(`case ${t}: thru agrees`, status.thru === complete.length);
  ok(`case ${t}: lead agrees`, status.lead === lead);
  ok(`case ${t}: status label agrees`, status.result === expectedResult(lead, complete.length, n));
  for (let i = 0; i < n; i++) {
    ok(`case ${t}/hole ${i}: progress agrees`, progress[i] === (detail[i].r == null ? null : detail[i].aRun - detail[i].bRun));
    if (detail[i].r != null) {
      const want = detail[i].aNet! < detail[i].bNet! ? 1 : detail[i].bNet! < detail[i].aNet! ? -1 : 0;
      ok(`case ${t}/hole ${i}: net decides winner`, detail[i].r === want);
    }
  }

  const edit = detail.findIndex((d) => d.r != null);
  if (edit >= 0) {
    const before = status.result;
    const old = A.gross[edit]!;
    A.gross[edit] = old + 1;
    altShotStatus(holes as never, A as never, B as never);
    A.gross[edit] = old;
    ok(`case ${t}: edit/revert restores result`, altShotStatus(holes as never, A as never, B as never).result === before);
  }

  if (t % 10 === 0) {
    const i = ri(0, n - 1), base = ri(3, 8);
    const x = Array<number | null>(n).fill(null), y = Array<number | null>(n).fill(null), z = Array<number | null>(n).fill(null);
    x[i] = base; y[i] = base + 1; z[i] = base;
    const conflict = readAltShotSideScores(x, y, n);
    ok(`case ${t}: conflict detected`, conflict.conflictHoles.length === 1 && conflict.conflictHoles[0] === i && conflict.gross[i] == null);
    const conflictStatus = altShotStatus(holes as never, { ...A, gross: conflict.gross } as never, { ...B, gross: z } as never);
    ok(`case ${t}: conflict not scored`, conflictStatus.thru === 0);
  }
}

console.log(`alt shot simulation: ${pass} passed, ${fail} failed (5000 deterministic matches, seed 0x17812)`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
