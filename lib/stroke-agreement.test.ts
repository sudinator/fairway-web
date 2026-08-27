/**
 * The scorecard dots and the Strokes panel must never disagree.
 *
 * Reported from staging twice. Two allocators existed:
 *   allocateStrokes  — ranks the holes ACTUALLY in play. Used by the Strokes panel, always right.
 *   strokesReceived  — `floor(ch/18) + (si <= ch % 18)`, with 18 HARDCODED. Used by the dots.
 *
 * On 18 holes with a clean 1-18 index they agree. On a nine they do not: a back nine holds every
 * second index, so the threshold form matches only si <= ch and hands out roughly half the strokes
 * owed. Amit off 8.5 got four dots while the panel correctly said nine.
 */
import { fullStrokes, chBasis, dotStrokes } from "./game-shape";
import { allocateStrokes, applyAllowance } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = (n: string, a: unknown, b: unknown) => {
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${b}\n     actual   ${a}`); }
};

const nine = (startHole: number, sis: number[]) =>
  sis.map((si, i) => ({ n: startHole + i, par: 4, si }));

// A real back nine: every SECOND stroke index. This is the shape that broke.
const BACK9 = nine(10, [2, 4, 6, 8, 10, 12, 14, 16, 18]);
const FRONT9 = nine(1, [1, 3, 5, 7, 9, 11, 13, 15, 17]);
const FULL18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));

const mkGame = (meta: typeof BACK9) =>
  ({ game_type: "stableford", course_par: 72, pairings: [], holes_meta: meta, allowance_pct: 100 }) as never;

/** Dots the scorecard draws, totalled. */
const dots = (meta: typeof BACK9, ch18: number) => {
  const g = mkGame(meta);
  const p = { handicap_index: null, slope: null, rating: null, course_handicap: ch18 } as never;
  return meta.reduce((a, m) => a + fullStrokes(g, p, m.si), 0);
};
/** What the Strokes panel computes for the same player. */
const panel = (meta: typeof BACK9, ch18: number) => {
  const g = mkGame(meta);
  const p = { handicap_index: null, slope: null, rating: null, course_handicap: ch18 } as never;
  const ch = applyAllowance(chBasis(p, 72, meta.length), 100);
  return Object.values(
    allocateStrokes(meta.map((m) => ({ hole_number: m.n, stroke_index: m.si })), ch),
  ).reduce((a, v) => a + v, 0);
};

// ── the two must agree, on every shape ─────────────────────────────────────
for (const ch of [0, 2, 4, 7, 8, 14, 17, 21, 28, 36]) {
  eq(`back nine, ch ${ch}: dots == panel`, dots(BACK9, ch), panel(BACK9, ch));
  eq(`front nine, ch ${ch}: dots == panel`, dots(FRONT9, ch), panel(FRONT9, ch));
  eq(`18 holes, ch ${ch}: dots == panel`, dots(FULL18, ch), panel(FULL18, ch));
}

// ── and the total is the halved handicap, not half of it again ────────────
// The reported numbers: Amit off 17 plays 9 over the nine; G22 off 28 plays 14.
eq("Amit: 17 -> 9 dots on the back nine", dots(BACK9, 17), 9);
eq("G22: 28 -> 14 dots", dots(BACK9, 28), 14);
eq("G1: 4 -> 2 dots", dots(BACK9, 4), 2);
// Before the fix these were 4, 7 and 1 — the SI-threshold form.
eq("18 holes is unchanged: 17 -> 17 dots", dots(FULL18, 17), 17);


// ── MATCH strokes: the difference, allocated across the holes in play ─────
// matchStrokesFor carried a THIRD copy of the same 18-hardcoded formula. On the reported back
// nine it gave Amit three strokes where the difference was eight, because it matched si <= 7.5
// against indexes 2, 4, 6, 8 ... 18.
{
  const meta = [
    { n: 10, par: 4, si: 4 }, { n: 11, par: 4, si: 16 }, { n: 12, par: 3, si: 12 },
    { n: 13, par: 4, si: 2 }, { n: 14, par: 4, si: 6 }, { n: 15, par: 4, si: 8 },
    { n: 16, par: 4, si: 10 }, { n: 17, par: 4, si: 14 }, { n: 18, par: 4, si: 18 },
  ];
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 17), P("b", 2), P("c", 20), P("d", 10)];
  const game = {
    game_type: "fourball", course_par: 72, pairings: [], holes_meta: meta, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
  } as never;
  const dots = (p: never) => meta.reduce((s, m) => s + dotStrokes(game, p, m.si, players as never), 0);

  // Nine-hole handicaps are 9, 1, 10, 5. The lowest plays scratch, so the others get the
  // DIFFERENCE: 8, 0, 9, 4. Before the fix these were 3, 0, 4, 2.
  eq("match dots = 9 - 1 = 8", dots(players[0]), 8);
  eq("the low handicap plays scratch", dots(players[1]), 0);
  eq("match dots = 10 - 1 = 9", dots(players[2]), 9);
  eq("match dots = 5 - 1 = 4", dots(players[3]), 4);
}

console.log(`stroke agreement: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
