/**
 * LAYER 3 — each format's DEFINING RULE, asserted by name.
 *
 * Layers 1 and 2 check self-consistency: that the dots match the scoring, and that a result follows
 * from its nets. Neither can catch a format being CONSISTENTLY wrong — which alternate shot was,
 * with dots and result agreeing while both used four-ball's basis.
 *
 * This states what each format is supposed to DO. The rules were confirmed with the owner rather
 * than assumed, because I had been wrong about the alternate shot rule three times and a test
 * written alone would only have frozen my misunderstanding.
 */
import { shapeOf, dotStrokes, chBasis } from "./game-shape";
import { applyAllowance, allocateStrokes } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const P = (id: string, ch: number, team: string) =>
  ({ id, user_id: id, display_name: id, handicap_index: null, slope: null, rating: null,
     course_handicap: ch, team, scores: [], no_show: false }) as never;

const mk = (gt: string, allowance = 100) => ({
  game_type: gt, course_par: 72, allowance_pct: allowance, holes_meta: H18,
  teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
  foursomes: [{ id: "f1", name: "F1", a: ["p0", "p1"], b: ["p2", "p3"] }],
  pairings: [{ a: "p0", b: "p2" }, { a: "p1", b: "p3" }],
}) as never;

// Four players: 20, 12, 8, 2. Spread enough that every basis gives a different answer.
const CHS = [20, 12, 8, 2];
const PLAYERS = CHS.map((c, i) => P(`p${i}`, c, i < 2 ? "A" : "B"));
const dots = (game: never, p: never) =>
  H18.reduce((s, h) => s + dotStrokes(game, p, h.si, PLAYERS as never), 0);
const total = (n: number) =>
  Object.values(allocateStrokes(H18.map((h) => ({ hole_number: h.n, stroke_index: h.si })), n))
    .reduce((a, v) => a + v, 0);

// ── STABLEFORD and STROKE: own full handicap ──────────────────────────────
// No relative basis. Each player plays against the course, so they receive their own figure.
for (const gt of ["stableford", "stroke"]) {
  const game = mk(gt);
  PLAYERS.forEach((p, i) => {
    eq(`${gt}: p${i} receives their own full handicap`, dots(game, p), total(CHS[i]));
  });
  eq(`${gt}: dotBasis is absolute`, shapeOf(game).dotBasis, "absolute");
}

// ── MATCH: the difference; the lower plays scratch ────────────────────────
{
  const game = mk("match");
  // pairings put p0 (20) against p2 (8), and p1 (12) against p3 (2).
  eq("match: p0 receives the difference vs p2", dots(game, PLAYERS[0]), total(20 - 8));
  eq("match: p2 plays scratch", dots(game, PLAYERS[2]), 0);
  eq("match: p1 receives the difference vs p3", dots(game, PLAYERS[1]), total(12 - 2));
  eq("match: p3 plays scratch", dots(game, PLAYERS[3]), 0);
  eq("match: dotBasis is relative_pair", shapeOf(game).dotBasis, "relative_pair");
}

// ── FOUR-BALL: each player against the foursome's lowest individual ───────
// Best of two balls, so every player carries their OWN handicap relative to the group low.
{
  const game = mk("fourball");
  const low = Math.min(...CHS);
  PLAYERS.forEach((p, i) => {
    eq(`fourball: p${i} receives own minus the foursome low`, dots(game, p), total(CHS[i] - low));
  });
  eq("fourball: the lowest plays scratch", dots(game, PLAYERS[3]), 0);
}

// ── TEAM SKINS: 2v2, each off their own handicap, lowest net takes the skin ─
// Confirmed with the owner: the same relative basis as four-ball — every player carries their own
// handicap, and the lowest net on the hole wins.
{
  const game = mk("skins");
  const low = Math.min(...CHS);
  PLAYERS.forEach((p, i) => {
    eq(`skins: p${i} carries own minus the group low`, dots(game, p), total(CHS[i] - low));
  });
}

// ── ALTERNATE SHOT: the SIDE, at the allowance, off the difference ────────
// One ball per side. Confirmed rule: side handicap is the pair COMBINED at the game's allowance,
// and strokes are the difference between the two sides, the lower playing scratch.
{
  const game = mk("alt_shot", 50);
  // Side A: 20 + 12 = 32, at 50% -> 16. Side B: 8 + 2 = 10, at 50% -> 5. Difference 11.
  eq("alt_shot: both partners on the receiving side get the same", dots(game, PLAYERS[0]), dots(game, PLAYERS[1]));
  eq("alt_shot: the amount is the SIDE difference", dots(game, PLAYERS[0]), total(11));
  eq("alt_shot: the lower side plays scratch", dots(game, PLAYERS[2]), 0);
  eq("alt_shot: and its partner too", dots(game, PLAYERS[3]), 0);
  eq("alt_shot: dotBasis is its own", shapeOf(game).dotBasis, "alt_shot_side");
}
{
  // The allowance OWNS the halving: at 100% the side is the full combined sum.
  const game = mk("alt_shot", 100);
  eq("alt_shot at 100%: the side is the full combined", dots(game, PLAYERS[0]), total(32 - 10));
}
{
  // And a low-handicap partner legitimately receives more than their own figure — the entitlement
  // belongs to the SIDE. This is the assertion that must NOT be inherited from other formats.
  const game = mk("alt_shot", 50);
  ok("alt_shot: a partner may receive more than their own handicap",
     dots(game, PLAYERS[1]) > total(applyAllowance(chBasis(PLAYERS[1], 72, 18), 50)));
}

// ── the bases must stay DISTINCT ─────────────────────────────────────────
// Four formats, four different answers for the same player. If any two collapse, a format has
// silently inherited another's rule — which is exactly what happened to alternate shot.
{
  const p0 = PLAYERS[0];
  const answers = new Map<string, number>();
  for (const [gt, allowance] of [["stableford", 100], ["match", 100], ["fourball", 100], ["alt_shot", 50]] as const) {
    answers.set(gt, dots(mk(gt, allowance), p0));
  }
  eq("stableford differs from match", answers.get("stableford") !== answers.get("match"), true);
  eq("match differs from fourball", answers.get("match") !== answers.get("fourball"), true);
  eq("fourball differs from alt_shot", answers.get("fourball") !== answers.get("alt_shot"), true);
}

console.log(`format rules: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
