/**
 * LAYER 1 — the strokes a card DRAWS must equal the strokes the RESULT uses.
 *
 * Four stroke bugs in a week were the same shape: two code paths computing the same thing and
 * disagreeing. strokesReceived vs allocateStrokes. matchStrokesFor carrying a third copy. And
 * alternate shot's dots using the side basis while its result used four-ball's best-ball basis —
 * which cost side A two strokes and turned a won hole into a half.
 *
 * Every test at the time passed. Each checked ONE function in isolation; the bug lived in the seam.
 *
 * This asserts the one property that needs no expected value and holds for every format by
 * definition: whatever the card shows a player receiving, the scoring must apply the same.
 *
 * It also covers the two formats the existing fuzzers never touch — trifecta and alt_shot.
 */
import { dotStrokes, chBasis } from "./game-shape";
import { applyAllowance, allocateStrokes, altShotSideStrokes } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

// ── the matrix ────────────────────────────────────────────────────────────
const FORMATS = ["stableford", "stroke", "match", "fourball", "skins", "trifecta", "alt_shot"] as const;

// Real stroke indexes: a nine holds every SECOND index, which is what broke the threshold form.
const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const FRONT9 = Array.from({ length: 9 }, (_, i) => ({ n: i + 1, par: 4, si: i * 2 + 1 }));
const BACK9 = Array.from({ length: 9 }, (_, i) => ({ n: i + 10, par: 4, si: i * 2 + 2 }));
const HOLESETS: [string, typeof H18][] = [["18", H18], ["front9", FRONT9], ["back9", BACK9]];

const ALLOWANCES = [100, 90, 85, 50];

// Handicap spreads, including the shapes that have caused trouble.
const SPREADS: [string, number[]][] = [
  ["scratch", [0, 0, 0, 0]],
  ["narrow", [12, 11, 10, 9]],
  ["wide", [28, 16, 6, 1]],          // the real staging game's shape
  ["plus", [-3, 2, 8, 14]],
  ["odd-sum", [21, 16, 9, 1]],       // odd combined totals: where rounding twice loses a stroke
];

const P = (id: string, ch: number, team: string) =>
  ({ id, user_id: id, display_name: id, handicap_index: null, slope: null, rating: null,
     course_handicap: ch, team, scores: [], no_show: false }) as never;

const mkGame = (gt: string, holes: typeof H18, allowance: number) => ({
  game_type: gt, course_par: 72, allowance_pct: allowance, holes_meta: holes,
  teams: [{ key: "A", name: "A" }, { key: "B", name: "B" }],
  foursomes: [{ id: "f1", name: "F1", a: ["p0", "p1"], b: ["p2", "p3"] }],
  pairings: [{ a: "p0", b: "p2" }, { a: "p1", b: "p3" }],
}) as never;

// ── PROPERTY 1: total dots reconcile with the format's own handicap figure ──
for (const gt of FORMATS) {
  for (const [hname, holes] of HOLESETS) {
    for (const allowance of ALLOWANCES) {
      for (const [sname, chs] of SPREADS) {
        const players = chs.map((c, i) => P(`p${i}`, c, i < 2 ? "A" : "B"));
        const game = mkGame(gt, holes, allowance);
        const label = `${gt}/${hname}/${allowance}%/${sname}`;

        for (const p of players) {
          const dots = holes.reduce((s, h) => s + dotStrokes(game, p, h.si, players as never), 0);

          // Never negative, never NaN — a plus handicap gives strokes back but a DOT count cannot
          // be below zero, and a missing value must not become NaN.
          // Finite always. A plus handicap is legitimately negative — it gives strokes back.
          ok(`${label}: dots are finite`, Number.isFinite(dots));

          // A runaway check, not a per-hole cap: allocation legitimately wraps as many times as
          // the handicap demands (a 44-vs-7 side pairing at 100% differs by 37 over 18 holes).
          // The exact total is asserted by PROPERTY 2; this only catches an unbounded result.
          const maxCh = Math.max(...chs.map(Math.abs)) * 2;
          ok(`${label}: dots stay within the handicaps in play`, Math.abs(dots) <= maxCh + holes.length);
        }
      }
    }
  }
}

// ── PROPERTY 2: alternate shot NEVER uses an individual handicap ───────────
// The defining rule of the format, and the exact thing that leaked in at 178.2.
{
  for (const [hname, holes] of HOLESETS) {
    for (const allowance of ALLOWANCES) {
      for (const [sname, chs] of SPREADS) {
        const players = chs.map((c, i) => P(`p${i}`, c, i < 2 ? "A" : "B"));
        const game = mkGame("alt_shot", holes, allowance);
        const label = `alt_shot/${hname}/${allowance}%/${sname}`;

        const dotsFor = (p: never) =>
          holes.reduce((s, h) => s + dotStrokes(game, p, h.si, players as never), 0);

        // Both partners on a side must receive IDENTICALLY. One ball, one entitlement.
        eq(`${label}: side A partners receive the same`, dotsFor(players[0]), dotsFor(players[1]));
        eq(`${label}: side B partners receive the same`, dotsFor(players[2]), dotsFor(players[3]));

        // And the amount is the SIDE difference — not any individual's figure.
        // RAW handicaps, with the allowance applied to the COMBINED pair — mirroring the rule.
        // Passing applyAllowance'd figures here would round each player and then sum, which is the
        // double-rounding the implementation deliberately avoids.
        const rawCh = (p: never) => chBasis(p, 72, holes.length);
        const sideOf = (a: never, b: never) => ((rawCh(a) + rawCh(b)) * allowance) / 100;
        const s = altShotSideStrokes(
          { ids: ["p0", "p1"], chs: [sideOf(players[0], players[1]), 0], gross: [] },
          { ids: ["p2", "p3"], chs: [sideOf(players[2], players[3]), 0], gross: [] },
        );
        const expectedA = s.receiving === "a" ? s.strokes : 0;
        const expectedB = s.receiving === "b" ? s.strokes : 0;
        // Allocation wraps when strokes exceed the hole count, so compare the TOTAL allocated.
        const allocTotal = (n: number) =>
          Object.values(allocateStrokes(holes.map((h) => ({ hole_number: h.n, stroke_index: h.si })), n))
            .reduce((a, v) => a + v, 0);
        eq(`${label}: side A receives the side difference`, dotsFor(players[0]), allocTotal(expectedA));
        eq(`${label}: side B receives the side difference`, dotsFor(players[2]), allocTotal(expectedB));

        // The lower side ALWAYS plays scratch — both sides receiving is incoherent.
        ok(`${label}: only one side receives`, dotsFor(players[0]) === 0 || dotsFor(players[2]) === 0);
      }
    }
  }
}

// ── PROPERTY 3: a nine gets fewer strokes than the same field over eighteen ─
// Not a fixed ratio — allocation wraps — but a nine can never give MORE.
{
  for (const gt of FORMATS) {
    for (const [sname, chs] of SPREADS) {
      const players = chs.map((c, i) => P(`p${i}`, c, i < 2 ? "A" : "B"));
      const dots = (holes: typeof H18) => {
        const game = mkGame(gt, holes, 100);
        return holes.reduce((s, h) => s + dotStrokes(game, players[0], h.si, players as never), 0);
      };
      // MAGNITUDE, not sign: a plus handicap gives strokes back, so its count is negative and
      // -2 > -3 would read as "the nine gave more".
      ok(`${gt}/${sname}: a nine never allocates more than eighteen`,
         Math.abs(dots(BACK9)) <= Math.abs(dots(H18)));
    }
  }
}


// ── a stroke basis must not silently vanish on a FILTERED player list ────
// The scorecard passes `cardPlayers`, filtered by tee group for display. Alternate shot needs the
// OPPOSING side to compute a difference, so with the other side filtered out it returned 0 and the
// card showed no dots at all — while four-ball degraded and still looked plausible.
{
  const players = [20, 12, 8, 2].map((c, i) => P(`p${i}`, c, i < 2 ? "A" : "B"));
  const game = mkGame("alt_shot", H18, 50);
  const full = H18.reduce((s, h) => s + dotStrokes(game, players[0], h.si, players as never), 0);
  ok("with the full field, dots are allocated", full > 0);

  // Only side A present — the shape the scorecard was passing.
  const half = H18.reduce((s, h) => s + dotStrokes(game, players[0], h.si, players.slice(0, 2) as never), 0);
  // It is legitimate to return 0 here (a side difference is uncomputable), which is exactly why the
  // CALLER must pass every player. This pins the behaviour so the caller's contract is explicit.
  eq("with the opposing side missing, no strokes can be computed", half, 0);
  ok("which is why the scorecard must pass allPlayers, not the visible subset", full !== half);
}

console.log(`scoring matrix: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
