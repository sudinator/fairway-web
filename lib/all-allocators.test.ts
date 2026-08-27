/**
 * EVERY stroke producer, checked against the same inputs.
 *
 * Three separate copies of `floor(x/18) + (si <= x % 18)` were found one at a time, each after a
 * bug report: strokesReceived, then matchStrokesFor, then very nearly a fourth. They agreed on a
 * full round with a clean 1-18 index and diverged on a nine, so each screen looked internally
 * consistent and only disagreed with a different screen.
 *
 * Finding them one report at a time was the mistake. This enumerates every producer and asserts
 * the properties that must hold for ALL of them, so a fourth cannot hide.
 */
import { allocateStrokes, strokesReceived, matchStrokesFor, applyAllowance } from "./golf";
import { dotStrokes, fullStrokes, chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = (n: string, a: unknown, b: unknown) => {
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${b}\n     actual   ${a}`); }
};

/** A real back nine: every SECOND stroke index. The shape that broke all three. */
const BACK9 = [
  { n: 10, par: 4, si: 4 }, { n: 11, par: 4, si: 16 }, { n: 12, par: 3, si: 12 },
  { n: 13, par: 4, si: 2 }, { n: 14, par: 4, si: 6 }, { n: 15, par: 4, si: 8 },
  { n: 16, par: 4, si: 10 }, { n: 17, par: 4, si: 14 }, { n: 18, par: 4, si: 18 },
];
const FULL18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const asAlloc = (hs: typeof BACK9) => hs.map((h) => ({ hole_number: h.n, stroke_index: h.si }));

const HANDICAPS = [0, 1, 2, 4, 7, 8, 9, 12, 14, 18, 27, 36];

// ── PROPERTY 1: the total allocated equals the handicap, rounded ───────────
// A producer that thresholds on stroke index cannot satisfy this on a nine — that is precisely how
// each of the three failed.
for (const holes of [BACK9, FULL18]) {
  const label = holes.length === 9 ? "back nine" : "18 holes";
  for (const ch of HANDICAPS) {
    const viaAlloc = Object.values(allocateStrokes(asAlloc(holes), ch)).reduce((a, v) => a + v, 0);
    eq(`${label}, ch ${ch}: allocateStrokes totals the handicap`, viaAlloc, Math.round(ch));

    const viaReceived = holes.reduce((a, h) => a + strokesReceived(h.si, ch, asAlloc(holes)), 0);
    eq(`${label}, ch ${ch}: strokesReceived agrees`, viaReceived, viaAlloc);

    const viaMatch = holes.reduce((a, h) => a + matchStrokesFor(ch, h.si, asAlloc(holes)), 0);
    eq(`${label}, ch ${ch}: matchStrokesFor agrees`, viaMatch, ch <= 0 ? 0 : viaAlloc);
  }
}

// ── PROPERTY 2: strokes land on the HARDEST holes first ───────────────────
// Ranking, not thresholding. With fewer strokes than holes, the hardest must all be covered.
for (const holes of [BACK9, FULL18]) {
  const label = holes.length === 9 ? "back nine" : "18 holes";
  const ch = 3;
  const alloc = allocateStrokes(asAlloc(holes), ch);
  const hardest = [...holes].sort((a, b) => a.si - b.si).slice(0, ch).map((h) => h.n);
  ok(`${label}: ${ch} strokes land on the 3 hardest holes`,
     hardest.every((n) => alloc[n] === 1));
  const rest = holes.filter((h) => !hardest.includes(h.n));
  ok(`${label}: and nowhere else`, rest.every((h) => alloc[h.n] === 0));
}

// ── PROPERTY 3: more strokes than holes wraps, never caps ─────────────────
{
  const alloc = allocateStrokes(asAlloc(BACK9), 14);
  const total = Object.values(alloc).reduce((a, v) => a + v, 0);
  eq("14 strokes over 9 holes totals 14", total, 14);
  ok("every hole gets at least one", BACK9.every((h) => alloc[h.n] >= 1));
  const hardest = [...BACK9].sort((a, b) => a.si - b.si)[0];
  eq("the hardest hole gets two", alloc[hardest.n], 2);
}

// ── PROPERTY 4: the game-level producers agree with the core ──────────────
// dotStrokes (match/relative basis) and fullStrokes (course basis) are what the scorecard draws.
{
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 17), P("b", 2), P("c", 20), P("d", 10)];
  const mk = (holes: typeof BACK9, type: string) => ({
    game_type: type, course_par: 72, pairings: [], holes_meta: holes, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
  }) as never;

  for (const holes of [BACK9, FULL18]) {
    const label = holes.length === 9 ? "back nine" : "18 holes";
    const game = mk(holes, "stableford");
    for (const p of players) {
      // fullStrokes is the COURSE basis: it must total the player's own (halved) handicap.
      const dots = holes.reduce((a, h) => a + fullStrokes(game, p, h.si), 0);
      const own = Math.round(applyAllowance(chBasis(p as never, 72, holes.length), 100));
      eq(`${label}: fullStrokes totals the course handicap for ${(p as never as {id:string}).id}`, dots, own);
    }
    // dotStrokes on a four-ball is the difference from the foursome's low handicap.
    const fb = mk(holes, "fourball");
    const chs = players.map((p) => applyAllowance(chBasis(p as never, 72, holes.length), 100));
    const low = Math.min(...chs);
    players.forEach((p, i) => {
      const dots = holes.reduce((a, h) => a + dotStrokes(fb, p, h.si, players as never), 0);
      eq(`${label}: dotStrokes is the difference from low, player ${i}`, dots, Math.round(Math.max(0, chs[i] - low)));
    });
  }
}

// ── PROPERTY 5: a nine gets HALF an eighteen, never the same ─────────────
{
  const P = { handicap_index: null, slope: null, rating: null, course_handicap: 18 } as never;
  const g9 = { game_type: "stableford", course_par: 72, pairings: [], holes_meta: BACK9, allowance_pct: 100 } as never;
  const g18 = { game_type: "stableford", course_par: 72, pairings: [], holes_meta: FULL18, allowance_pct: 100 } as never;
  const nine = BACK9.reduce((a, h) => a + fullStrokes(g9, P, h.si), 0);
  const full = FULL18.reduce((a, h) => a + fullStrokes(g18, P, h.si), 0);
  eq("18 holes off 18 -> 18 strokes", full, 18);
  eq("a nine off 18 -> 9 strokes", nine, 9);
  eq("the nine is exactly half", nine * 2, full);
}


// ── GAP 1: allowances other than 100%. Four-ball uses 85; alt shot defines 50 ──
// Everything above ran at 100%, so the allowance path was entirely unexercised. An allowance
// produces FRACTIONS (85% of 12 = 10.2), which is where the ceiling bug lived.
for (const holes of [BACK9, FULL18]) {
  const label = holes.length === 9 ? "back nine" : "18 holes";
  for (const pct of [100, 90, 85, 50]) {
    for (const ch of [7, 12, 18, 27]) {
      const applied = applyAllowance(ch, pct);
      const total = Object.values(allocateStrokes(asAlloc(holes), applied)).reduce((a, v) => a + v, 0);
      eq(`${label}, ch ${ch} at ${pct}%: totals the allowed handicap`, total, Math.round(applied));
    }
  }
}

// ── GAP 2: five of seven game types were never exercised ─────────────────
// dotStrokes branches on game type — match, fourball and trifecta take a RELATIVE basis, the
// others take the full handicap. Only stableford and fourball had been covered.
{
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 17), P("b", 2), P("c", 20), P("d", 10)];
  for (const gt of ["stableford", "stroke", "match", "fourball", "skins", "trifecta", "alt_shot"]) {
    for (const holes of [BACK9, FULL18]) {
      const label = holes.length === 9 ? "nine" : "18";
      const game = {
        game_type: gt, course_par: 72, pairings: [{ a: "a", b: "c" }], holes_meta: holes,
        allowance_pct: 100, teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
        foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
      } as never;
      for (const p of players) {
        const dots = holes.reduce((a, h) => a + dotStrokes(game, p, h.si, players as never), 0);
        // Whatever the basis, a player can never receive MORE than their own handicap, nor a
        // negative count. Those bounds hold for every format and catch a wrong basis.
        const own = Math.round(applyAllowance(chBasis(p as never, 72, holes.length), 100));
        ok(`${gt} on ${label}: dots are not negative`, dots >= 0);
        ok(`${gt} on ${label}: dots never exceed the player's own handicap`, dots <= own);
      }
    }
  }
}

// ── GAP 3: real course data — null, duplicate and out-of-range indexes ───
// CourseHole.si is `number | null`. A course imported with gaps must not silently make those
// holes hardest, nor lose strokes.
{
  const withNulls = [
    { n: 1, par: 4, si: 3 }, { n: 2, par: 4, si: null as unknown as number },
    { n: 3, par: 4, si: 1 }, { n: 4, par: 4, si: null as unknown as number },
    { n: 5, par: 4, si: 2 },
  ];
  const alloc = allocateStrokes(asAlloc(withNulls as never), 3);
  const total = Object.values(alloc).reduce((a, v) => a + v, 0);
  eq("null stroke indexes: all 3 strokes still allocated", total, 3);
  ok("and they land on the RANKED holes, not the null ones",
     alloc[3] === 1 && alloc[5] === 1 && alloc[1] === 1);
  eq("a null-index hole gets nothing", alloc[2], 0);
}
{
  // Duplicate indexes are a real import fault. Ranking must still allocate exactly ch strokes.
  const dupes = [
    { n: 1, par: 4, si: 1 }, { n: 2, par: 4, si: 1 }, { n: 3, par: 4, si: 2 },
    { n: 4, par: 4, si: 2 }, { n: 5, par: 4, si: 3 },
  ];
  const total = Object.values(allocateStrokes(asAlloc(dupes), 4)).reduce((a, v) => a + v, 0);
  eq("duplicate stroke indexes: exactly 4 strokes", total, 4);
}
{
  // Out-of-range indexes (a 9-hole course numbered 1-9, or bad data at 25) must not over-allocate.
  const odd = [{ n: 1, par: 4, si: 25 }, { n: 2, par: 4, si: 0 }, { n: 3, par: 4, si: 9 }];
  const total = Object.values(allocateStrokes(asAlloc(odd), 2)).reduce((a, v) => a + v, 0);
  eq("out-of-range stroke indexes: exactly 2 strokes", total, 2);
}

// ── GAP 4: the index+slope path, not just a stored course_handicap ───────
// chBasis prefers handicap_index * (slope/113) + (rating - par) when those exist. Every test above
// used the stored fallback, so the computed path was unexercised.
{
  const computed = { handicap_index: 14, slope: 130, rating: 71.5, course_handicap: 99 } as never;
  const g18 = { game_type: "stableford", course_par: 72, pairings: [], holes_meta: FULL18, allowance_pct: 100 } as never;
  const g9 = { game_type: "stableford", course_par: 72, pairings: [], holes_meta: BACK9, allowance_pct: 100 } as never;
  // 14*(130/113) + (71.5-72) = 15.61 -> 16 strokes. NOT the stored 99.
  const full = FULL18.reduce((a, h) => a + fullStrokes(g18, computed, h.si), 0);
  eq("computed basis is used, not the stored handicap", full, 16);
  const nine = BACK9.reduce((a, h) => a + fullStrokes(g9, computed, h.si), 0);
  eq("and a nine halves the COMPUTED figure", nine, 8);
}
{
  // A player with no handicap at all receives nothing — never NaN, never a negative.
  const none = { handicap_index: null, slope: null, rating: null, course_handicap: null } as never;
  const g = { game_type: "stableford", course_par: 72, pairings: [], holes_meta: BACK9, allowance_pct: 100 } as never;
  const total = BACK9.reduce((a, h) => a + fullStrokes(g, none, h.si), 0);
  eq("no handicap -> no strokes", total, 0);
  ok("and never NaN", Number.isFinite(total));
}


// ── ALTERNATE SHOT: the SIDE's handicap, not the individual's ─────────────
// One ball per side, so the side handicap is 50% of the partners combined and strokes are the
// DIFFERENCE between sides, the lower playing scratch. Both partners get the same dots — the dot
// means "this SIDE receives a stroke here".
{
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  // Side A off 20 and 8 -> 14. Side B off 10 and 5 -> 7.5. Difference 6.5 -> 7 strokes to A.
  const players = [P("a", 20), P("b", 8), P("c", 10), P("d", 5)];
  const game = {
    game_type: "alt_shot", course_par: 72, pairings: [], holes_meta: FULL18, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
  } as never;
  const dots = (p: never) => FULL18.reduce((s, h) => s + dotStrokes(game, p, h.si, players as never), 0);

  // Rounding ONCE at the difference: 14 - 7.5 = 6.5 -> 7. Rounding each side first gives 14 - 8 = 6.
  eq("side A receives 7 strokes", dots(players[0]), 7);
  eq("BOTH partners on side A get the same", dots(players[1]), 7);
  eq("side B plays scratch", dots(players[2]), 0);
  eq("and its partner too", dots(players[3]), 0);
}
{
  // Equal sides: nobody receives.
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 12), P("b", 8), P("c", 14), P("d", 6)];
  const game = {
    game_type: "alt_shot", course_par: 72, pairings: [], holes_meta: FULL18, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
  } as never;
  // Both sides are 10. Nobody gets a stroke.
  for (const p of players) {
    eq("equal side handicaps -> scratch", FULL18.reduce((s, h) => s + dotStrokes(game, p, h.si, players as never), 0), 0);
  }
}
{
  // A nine halves each partner BEFORE the 50%, so the side difference halves too.
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 20), P("b", 8), P("c", 10), P("d", 5)];
  const game = {
    game_type: "alt_shot", course_par: 72, pairings: [], holes_meta: BACK9, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a", "b"], b: ["c", "d"] }],
  } as never;
  // Halved: A is (10+4)/2 = 7, B is (5+2.5)/2 = 3.75. Difference 3.25 -> 3.
  const dots = BACK9.reduce((s, h) => s + dotStrokes(game, players[0], h.si, players as never), 0);
  eq("a nine's side difference is roughly half the eighteen's", dots, 3);
}
{
  // A player in no foursome receives nothing rather than a guessed value.
  const P = (id: string, ch: number) =>
    ({ id, user_id: id, handicap_index: null, slope: null, rating: null, course_handicap: ch, team: null }) as never;
  const players = [P("a", 20), P("b", 8), P("x", 12)];
  const game = {
    game_type: "alt_shot", course_par: 72, pairings: [], holes_meta: FULL18, allowance_pct: 100,
    teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
    foursomes: [{ id: "f1", name: "F1", a: ["a"], b: ["b"] }],
  } as never;
  eq("unpaired player gets nothing", FULL18.reduce((s, h) => s + dotStrokes(game, players[2], h.si, players as never), 0), 0);
}

console.log(`all allocators: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
