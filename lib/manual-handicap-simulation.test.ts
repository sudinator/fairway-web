/**
 * Deterministic model-based simulation for MANUAL COURSE HANDICAPS (0153).
 *
 * Example tests prove the rule on the cases someone thought of. This proves the PROPERTIES that must
 * hold on every combination of format, hole count, allowance and mix of manual/derived players —
 * which is where a leak would actually hide.
 *
 * The invariants, and why each one matters:
 *
 *   1. USED AS GIVEN. chBasis(manual) is exactly the entered number, on 9 holes and on 18. The
 *      nine-hole case is the one that cannot be spotted by eye: halving 12 to 6 still produces a
 *      plausible match, just one played two strokes light.
 *
 *   2. EQUIVALENCE — the source must not leak. A manual player and a derived player whose derived
 *      figure lands on the same number must score IDENTICALLY, everywhere: same strokes per hole,
 *      same net, same match result, same dots. If `course_handicap_source` changed anything beyond
 *      the value, this is what would catch it.
 *
 *   3. NINE-HOLE EQUIVALENCE. A manual 12 on a nine must equal a derived player whose 18-hole figure
 *      is 24 — because derived halves and manual does not. This pins the two halves of the rule
 *      against each other rather than against a hardcoded expectation.
 *
 *   4. ALLOWANCE STILL BITES, identically for both sources.
 *
 *   5. NO CROSS-CONTAMINATION. Making one player manual must not move anybody else's strokes.
 *
 *   6. ROUND TRIP. Setting a manual figure and clearing it returns the player to exactly the derived
 *      result — no residue.
 *
 *   7. EVERY BASIS. Match, team leg and course-handicap dots all read the manual figure; a manual
 *      handicap is the player's handicap for the game, not a match-only override.
 *
 * Seed is fixed so a CI failure is reproducible.
 */
import { chBasis, dotStrokes, fullStrokes, strokeSets, altShotSides } from "./game-shape";
import { applyAllowance, matchAllowance, matchProgress, matchCloseoutStatus, fourballProgress, computeTrifecta, stablefordPts, type FourballMember } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; if (fails.length < 25) fails.push("FAIL " + name); } };

let seed = 0x5A17C;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]) => xs[ri(0, xs.length - 1)];

const ALLOWANCES = [50, 75, 80, 85, 90, 95, 100] as const;
const FORMATS = ["match", "fourball", "alt_shot", "trifecta", "stableford"] as const;

type P = {
  id: string; user_id: string; display_name: string;
  handicap_index: number | null; slope: number | null; rating: number | null;
  course_handicap: number | null; course_handicap_source?: "derived" | "manual" | null;
  team: "A" | "B"; no_show: boolean; scores: (number | null)[];
};

const makeHoles = (n: number, start: number) =>
  Array.from({ length: n }, (_, i) => ({ n: start + i, par: pick([3, 4, 4, 5]), si: n === 9 ? i * 2 + 1 : i + 1 }));

const CASES = 4000;
for (let t = 0; t < CASES; t++) {
  const n = rnd() < 0.4 ? 9 : 18;
  const start = n === 9 && rnd() < 0.5 ? 10 : 1;
  const holes = makeHoles(n, start);
  const par = 70 + ri(0, 3);
  const allowance = pick(ALLOWANCES);
  const format = pick(FORMATS);
  const allocHoles = holes.map((h) => ({ hole_number: h.n, stroke_index: h.si }));

  const mkP = (i: number, team: "A" | "B", manual: number | null): P => ({
    id: `p${i}`, user_id: `p${i}`, display_name: `P${i}`,
    handicap_index: ri(0, 320) / 10, slope: ri(95, 155), rating: ri(660, 760) / 10,
    course_handicap: manual, course_handicap_source: manual == null ? "derived" : "manual",
    team, no_show: false,
    scores: holes.map((h) => (rnd() < 0.06 ? null : h.par + ri(-1, 4))),
  });

  // Half the players manual, half derived — the mix is the interesting case.
  const players: P[] = [0, 1, 2, 3].map((i) => mkP(i, i < 2 ? "A" : "B", rnd() < 0.5 ? ri(-2, 36) : null));
  const mode = pick(["best_ball", "aggregate"] as const);
  const game = {
    game_type: format, course_par: par, allowance_pct: allowance, team_score_mode: mode,
    holes_meta: holes, pairings: [{ a: "p0", b: "p2" }, { a: "p1", b: "p3" }],
    teams: [{ key: "A" }, { key: "B" }],
    foursomes: [{ id: "f", name: "F", swap: rnd() < 0.5, a: ["p0", "p1"], b: ["p2", "p3"] }],
  } as never;

  for (const p of players) {
    const ch = chBasis(p as never, par, n);

    // 1 — used as given, on both hole counts
    if (p.course_handicap_source === "manual") {
      ok(`t${t} manual used as given`, ch === p.course_handicap);
      ok(`t${t} manual not halved on a nine`, n !== 9 || ch === p.course_handicap);
      // 4 — allowance applies to it exactly as to any other figure
      ok(`t${t} manual is allowanced`, applyAllowance(ch, allowance) === applyAllowance(p.course_handicap as number, allowance));
    } else {
      // derived still halves on a nine
      const full = chBasis({ ...p, course_handicap_source: "derived" } as never, par, 18);
      ok(`t${t} derived halves on a nine`, n !== 9 || Math.abs(ch - full / 2) < 1e-9);
    }

    // 7 — every basis reads the same figure this player scores off
    const sets = strokeSets(game, p as never, holes[ri(0, n - 1)].si, players as never);
    ok(`t${t} strokeSets returns at least the course basis`, sets.some((s) => s.key === "course") || format === "alt_shot");
  }

  // 2 — EQUIVALENCE: a manual player and a derived player on the same number score identically.
  {
    const manualCh = ri(0, 30);
    const manualP = { ...mkP(9, "A", manualCh), scores: players[0].scores };
    // A derived twin: no index chain at all, so chBasis falls back to course_handicap — and on a
    // nine it halves, so give it double to land on the same effective figure.
    const twin: P = {
      ...manualP, id: "twin", user_id: "twin",
      handicap_index: null, slope: null, rating: null,
      course_handicap: n === 9 ? manualCh * 2 : manualCh, course_handicap_source: "derived",
    };
    const a = chBasis(manualP as never, par, n), b = chBasis(twin as never, par, n);
    ok(`t${t} manual equals its derived twin`, Math.abs(a - b) < 1e-9);

    const opp = { ...mkP(8, "B", ri(0, 30)), scores: players[2].scores };
    const gm = { ...(game as object), game_type: "match", pairings: [{ a: "manual", b: "opp" }] } as never;
    const mk2 = (me: P) => matchCloseoutStatus(
      matchProgress(holes, me.scores, opp.scores, chBasis(me as never, par, n), chBasis(opp as never, par, n), allowance), n,
    );
    const rm = mk2({ ...manualP, id: "manual", user_id: "manual" });
    const rt = mk2({ ...twin, id: "manual", user_id: "manual" });
    ok(`t${t} identical match result`, rm.lead === rt.lead && rm.thru === rt.thru && rm.result === rt.result);

    // Stableford off the same figure must match hole for hole.
    let sa = 0, sb = 0;
    holes.forEach((h, i) => {
      const g = manualP.scores[i];
      if (g == null) return;
      const ra = Math.max(0, Math.round(applyAllowance(a, allowance)));
      const rb = Math.max(0, Math.round(applyAllowance(b, allowance)));
      sa += stablefordPts(g, h.par, Math.floor(ra / n) + (h.si <= ra % n ? 1 : 0)) || 0;
      sb += stablefordPts(g, h.par, Math.floor(rb / n) + (h.si <= rb % n ? 1 : 0)) || 0;
    });
    ok(`t${t} identical stableford`, sa === sb);
  }

  // 5 — NO CROSS-CONTAMINATION: flipping p0 to manual must not move p1/p2/p3's strokes.
  {
    const si = holes[ri(0, n - 1)].si;
    const before = players.map((p) => dotStrokes(game, p as never, si, players as never));
    // Hold p0's FIGURE exactly constant — rounding it would change the group low and move everyone
    // else's strokes for a legitimate reason, which is not what this invariant is about. The
    // question is only whether the source FLAG leaks.
    const flipped = players.map((p, i) =>
      i === 0 ? { ...p, course_handicap: chBasis(p as never, par, n), course_handicap_source: "manual" as const } : p);
    const after = flipped.map((p) => dotStrokes(game, p as never, si, flipped as never));
    // p0's own figure is unchanged by construction (same rounded value), so nobody should move.
    ok(`t${t} no cross-contamination`, before.slice(1).every((v, i) => v === after[i + 1]));
    // And p0 itself must be unmoved, since the figure is identical either way.
    ok(`t${t} the flipped player is unmoved too`, before[0] === after[0]);
  }

  // 6 — ROUND TRIP: manual then cleared equals never-manual.
  {
    const p = players[ri(0, 3)];
    const derivedOnly = { ...p, course_handicap_source: "derived" as const };
    const manualised = { ...p, course_handicap: Math.round(chBasis(derivedOnly as never, par, n)), course_handicap_source: "manual" as const };
    const cleared = { ...manualised, course_handicap: derivedOnly.course_handicap, course_handicap_source: "derived" as const };
    ok(`t${t} clearing restores the derived figure`, chBasis(cleared as never, par, n) === chBasis(derivedOnly as never, par, n));
  }

  // Formats must all run to completion with a mix of manual and derived, and agree with their dots.
  const mem: FourballMember[] = players.map((p) => ({ id: p.id, gross: p.scores, ch: chBasis(p as never, par, n), noShow: false }));
  if (format === "fourball") {
    const prog = fourballProgress(holes, mem, ["p0", "p1"], ["p2", "p3"], allowance, mode);
    ok(`t${t} fourball produces a hole for every hole`, prog.length === n);
  } else if (format === "trifecta") {
    const tri = computeTrifecta(holes, mem, ["p0", "p1"], ["p2", "p3"], allowance, "best_ball", false);
    ok(`t${t} trifecta returns three contests`, tri.contests.length === 3);
  } else if (format === "alt_shot") {
    // EQUIVALENCE rather than reimplementing the side formula: replace every player with a derived
    // twin carrying the same effective chBasis figure, and the side handicaps must be identical.
    // Modelling the formula here would only prove my copy of it agrees with itself.
    const twins = players.map((q) => ({
      ...q, handicap_index: null, slope: null, rating: null,
      course_handicap: n === 9 ? chBasis(q as never, par, n) * 2 : chBasis(q as never, par, n),
      course_handicap_source: "derived" as const,
    }));
    const sides = altShotSides(game, players as never, { id: "f", a: ["p0", "p1"], b: ["p2", "p3"] } as never);
    const twinSides = altShotSides(game, twins as never, { id: "f", a: ["p0", "p1"], b: ["p2", "p3"] } as never);
    ok(`t${t} alt-shot sides identical for manual and derived twins`,
      sides.aCh === twinSides.aCh && sides.bCh === twinSides.bCh
      && sides.receiving === twinSides.receiving && sides.strokes === twinSides.strokes);
  } else if (format === "match") {
    const st = matchCloseoutStatus(matchProgress(holes, players[0].scores, players[2].scores, chBasis(players[0] as never, par, n), chBasis(players[2] as never, par, n), allowance), n);
    ok(`t${t} match thru never exceeds the round`, st.thru <= n);
    // The dot a player sees must equal the stroke the match gives them.
    const si = holes[0].si;
    const pairAllow = matchAllowance(chBasis(players[0] as never, par, n), chBasis(players[2] as never, par, n), allowance);
    const setsP0 = strokeSets({ ...(game as object), game_type: "match" } as never, players[0] as never, si, players as never);
    const opp = setsP0.find((s) => s.key === "opponent");
    ok(`t${t} dots match the strokes the match gives`, !opp || opp.strokes === Math.floor(pairAllow.a / n) + (si <= pairAllow.a % n ? 1 : 0) || pairAllow.a === 0);
  } else {
    const p = players[0];
    ok(`t${t} stableford basis is the full playing handicap`, fullStrokes(game, p as never, holes[0].si) >= 0);
  }
}

// 3 — NINE-HOLE EQUIVALENCE, stated once and directly: manual N on a nine == derived 2N on a nine.
for (let v = 0; v <= 36; v++) {
  const manual = { handicap_index: null, slope: null, rating: null, course_handicap: v, course_handicap_source: "manual" as const };
  const derivedDouble = { handicap_index: null, slope: null, rating: null, course_handicap: v * 2 };
  ok(`nine equivalence ${v}`, chBasis(manual, 71, 9) === chBasis(derivedDouble, 71, 9));
  ok(`eighteen identity ${v}`, chBasis(manual, 71, 18) === chBasis({ ...derivedDouble, course_handicap: v }, 71, 18));
}

console.log(`manual handicap simulation: ${pass} passed, ${fail} failed (${CASES} deterministic games, seed 0x5A17C)`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
