// Unit tests for evaluateRound in lib/badges.ts — run with `npm test`.
import { evaluateRound, computeBadgeState, badgeEvidence, PriorBadges } from "./badges";
import type { Round, Hole } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (name: string, cond: boolean) => { if (cond) pass++; else { fail++; fails.push("FAIL " + name); } };
const keys = (aw: { key: string }[]) => aw.map((a) => a.key).sort();
const has = (aw: { key: string }[], k: string) => aw.some((a) => a.key === k);
const val = (aw: { key: string; value?: number }[], k: string) => aw.find((a) => a.key === k)?.value;

// Build a round from a compact per-hole spec: [par, strokes, putts?, fairway?, sand?]
type HS = [number, number, number?, ("hit" | "miss" | "left" | "right" | null)?, boolean?];
const mkRound = (spec: HS[], extra: Partial<Round> = {}): Round => {
  const holes: Hole[] = spec.map((s, i) => ({
    hole_number: i + 1, par: s[0], stroke_index: i + 1, strokes: s[1],
    putts: s[2] ?? null, fairway: (s[3] ?? null) as any, penalties: 0, sand: s[4] ?? null,
  }));
  const par = spec.reduce((a, s) => a + s[0], 0);
  return { id: "r", course: "Test GC", tee_name: "W", rating: 72, slope: 113, course_par: par,
    handicap_index: null, course_handicap: null, played_at: "2026-07-01", holes, ...extra };
};
const emptyPrior = (over: Partial<PriorBadges> = {}): PriorBadges => ({ priorRounds: 0, bests: {}, earned: new Set(), ...over });

// A clean par round on 18 par-4s: gross 72, 0 vs par, all pars.
const parRound = () => mkRound(Array(18).fill([4, 4, 2, "hit"]) as HS[]);

// ---- Milestones ----
{
  const aw = evaluateRound(parRound(), emptyPrior({ priorRounds: 0 }));
  ok("first_round on round 1", has(aw, "first_round"));
  ok("rounds_5 not yet at round 1", !has(aw, "rounds_5"));
}
{
  const aw = evaluateRound(parRound(), emptyPrior({ priorRounds: 4, earned: new Set(["first_round"]) }));
  ok("rounds_5 at round 5", has(aw, "rounds_5"));
  ok("first_round not re-awarded", !has(aw, "first_round"));
}

// ---- Best differential (first time + record) ----
{
  const aw = evaluateRound(parRound(), emptyPrior());
  ok("best_differential first time", has(aw, "best_differential"));
  ok("best_differential not flagged record first time", val(aw, "best_differential") != null && !aw.find((a) => a.key === "best_differential")!.isRecord);
}
{
  // prior best differential 0.0; a +0 round shouldn't beat it
  const aw = evaluateRound(parRound(), emptyPrior({ bests: { best_differential: 0 } }));
  ok("best_differential not re-awarded when not beaten", !has(aw, "best_differential"));
}

// ---- vs par + gross thresholds ----
{
  // shoot 79 (18 holes, par 72): one hole 4->? make total 79 = seven over. Use 11 pars + 7 bogeys.
  const spec: HS[] = [];
  for (let i = 0; i < 11; i++) spec.push([4, 4, 2, "hit"]);
  for (let i = 0; i < 7; i++) spec.push([4, 5, 2, "miss"]);
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("broke_80 at 79", has(aw, "broke_80"));
  ok("broke_90 at 79", has(aw, "broke_90"));
  ok("not broke_par at 79", !has(aw, "broke_par"));
  ok("best_vs_par recorded", val(aw, "best_vs_par") === 7);
}

// ---- Bogey-free streaks + round ----
{
  const aw = evaluateRound(parRound(), emptyPrior());
  ok("bogey_free_round on all pars", has(aw, "bogey_free_round"));
  ok("bogey_free_9 on all pars", has(aw, "bogey_free_9"));
  ok("bogey_free_5 on all pars", has(aw, "bogey_free_5"));
  ok("no_blowups on all pars", has(aw, "no_blowups"));
  ok("par_train on 18 pars", has(aw, "par_train"));
}
{
  // one double on hole 1 breaks bogey-free-round + no_blowups; rest pars
  const spec: HS[] = [[4, 6, 2, "miss"], ...Array(17).fill([4, 4, 2, "hit"])] as HS[];
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("no bogey_free_round with a double", !has(aw, "bogey_free_round"));
  ok("no no_blowups with a double", !has(aw, "no_blowups"));
  ok("bogey_free_9 still on clean back nine", has(aw, "bogey_free_9"));
}

// ---- Bounce-back: bogey then birdie ----
{
  const spec: HS[] = [[4, 5, 2, "miss"], [4, 3, 1, "hit"], ...Array(16).fill([4, 4, 2, "hit"])] as HS[];
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("bounce_back counted", val(aw, "bounce_back") === 1);
  ok("first_birdie awarded", has(aw, "first_birdie"));
  ok("birdie count 1", val(aw, "birdie") === 1);
}

// ---- Eagle + par-3 birdie ----
{
  const spec: HS[] = [[3, 2, 1, "hit"], [5, 3, 1, "hit"], ...Array(16).fill([4, 4, 2, "hit"])] as HS[];
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("birdie_par3 for 2 on a par 3", val(aw, "birdie_par3") === 1);
  ok("eagle for 3 on a par 5", val(aw, "eagle") === 1);
  ok("first_eagle awarded", has(aw, "first_eagle"));
}

// ---- Putts: fewest + no 3-putts ----
{
  const aw = evaluateRound(parRound(), emptyPrior());
  ok("fewest_putts = 36 (2/hole)", val(aw, "fewest_putts") === 36);
  ok("no_three_putts on all 2-putts", has(aw, "no_three_putts"));
}
{
  const spec: HS[] = [[4, 4, 3, "hit"], ...Array(17).fill([4, 4, 2, "hit"])] as HS[];
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("no_three_putts blocked by a 3-putt", !has(aw, "no_three_putts"));
}

// ---- Fairways / greens bests ----
{
  const aw = evaluateRound(parRound(), emptyPrior());
  // par-4s only (18 of them) all hit; GIR: strokes-putts=2 <= par-2=2 => all GIR
  ok("best_fairways = 18", val(aw, "best_fairways") === 18);
  ok("best_gir = 18", val(aw, "best_gir") === 18);
}

// ---- Sand save + scramble master ----
{
  // 4 holes: missed green (strokes-putts > par-2) but made par, one from sand
  const spec: HS[] = [];
  for (let i = 0; i < 4; i++) spec.push([4, 4, 1, "miss", i === 0]); // strokes4 putts1 -> GIR? 4-1=3 > 2 => not GIR, made par
  for (let i = 0; i < 14; i++) spec.push([4, 4, 2, "hit"]);
  const aw = evaluateRound(mkRound(spec), emptyPrior());
  ok("scramble_master at 4 up-and-downs", has(aw, "scramble_master"));
  ok("sand_save counted once", val(aw, "sand_save") === 1);
}

// ---- Gross-only round: differential + vs par, no hole badges ----
{
  const r: Round = { id: "g", course: "X", tee_name: null, rating: 72, slope: 113, course_par: 72,
    handicap_index: null, course_handicap: null, played_at: "2026-07-01", gross_score: 85, holes: [] };
  const aw = evaluateRound(r, emptyPrior());
  ok("gross-only: broke_90", has(aw, "broke_90"));
  ok("gross-only: best_vs_par = 13", val(aw, "best_vs_par") === 13);
  ok("gross-only: no hole badges", !has(aw, "bogey_free_3") && !has(aw, "no_three_putts"));
}

// ---- computeBadgeState: chronological replay across rounds ----
{
  // Round A (older): shoot 79 (broke 80), best_diff via rating. Round B (newer): shoot 77 (better vs par).
  const early: HS[] = [];
  for (let i = 0; i < 11; i++) early.push([4, 4, 2, "hit"]);
  for (let i = 0; i < 7; i++) early.push([4, 5, 2, "miss"]);   // 79
  const late: HS[] = [];
  for (let i = 0; i < 13; i++) late.push([4, 4, 2, "hit"]);
  for (let i = 0; i < 5; i++) late.push([4, 5, 2, "miss"]);    // 77
  const rA = mkRound(early, { id: "A", played_at: "2026-06-01" });
  const rB = mkRound(late, { id: "B", played_at: "2026-06-15" });
  const state = computeBadgeState([rB, rA]); // pass out of order; fn sorts
  ok("broke_80 earned once", state["broke_80"]?.count === 1);
  ok("broke_80 first date = earlier round", state["broke_80"]?.first_earned_at === "2026-06-01");
  ok("best_vs_par record = 5 (the 77)", Number(state["best_vs_par"]?.best_value) === 5);
  ok("best_vs_par record_round = newer round B", state["best_vs_par"]?.best_round_id === "B");
  ok("best_vs_par last date = later round", state["best_vs_par"]?.last_earned_at === "2026-06-15");
}
{
  // Two rounds each with a bounce-back => count accumulates to 2.
  const spec: HS[] = [[4, 5, 2, "miss"], [4, 3, 1, "hit"], ...Array(16).fill([4, 4, 2, "hit"])] as HS[];
  const r1 = mkRound(spec, { id: "R1", played_at: "2026-05-01" });
  const r2 = mkRound(spec, { id: "R2", played_at: "2026-05-08" });
  const state = computeBadgeState([r1, r2]);
  ok("bounce_back count accumulates across rounds", state["bounce_back"]?.count === 2);
  ok("first_birdie stays a single once-badge", state["first_birdie"]?.count === 1);
  ok("rounds_5 not earned at 2 rounds", !state["rounds_5"]);
}
{
  // 5 minimal rounds => rounds_5 milestone appears exactly once.
  const rs = Array.from({ length: 5 }, (_, i) => mkRound(Array(18).fill([4, 4, 2, "hit"]) as HS[], { id: "M" + i, played_at: `2026-04-0${i + 1}` }));
  const state = computeBadgeState(rs);
  ok("rounds_5 earned at 5 rounds", state["rounds_5"]?.count === 1);
  ok("first_round earned", state["first_round"]?.count === 1);
  ok("rounds_10 not yet", !state["rounds_10"]);
}


// ---- badgeEvidence: explains how a badge was earned ----
{
  // clean back nine (holes 10-18 all par), front mixed
  const spec: HS[] = [];
  for (let i = 0; i < 9; i++) spec.push([4, 5, 2, "miss"]);   // front: bogeys
  for (let i = 0; i < 9; i++) spec.push([4, 4, 2, "hit"]);    // back: pars
  const r = mkRound(spec, { id: "E1" });
  const ev = badgeEvidence("bogey_free_9", r);
  ok("bogey_free_9 identifies back nine", /back nine/i.test(ev.text));
  ok("bogey_free_9 holes are 10-18", JSON.stringify(ev.holes) === JSON.stringify([10, 11, 12, 13, 14, 15, 16, 17, 18]));
}
{
  const spec: HS[] = [[5, 3, 1, "hit"], ...Array(17).fill([4, 4, 2, "hit"])] as HS[];
  const ev = badgeEvidence("eagle", mkRound(spec, { id: "E2" }));
  ok("eagle evidence names the hole", JSON.stringify(ev.holes) === JSON.stringify([1]));
}
{
  const spec: HS[] = [];
  for (let i = 0; i < 13; i++) spec.push([4, 4, 2, "hit"]);
  for (let i = 0; i < 5; i++) spec.push([4, 5, 2, "miss"]); // 77, par 72 => +5
  const ev = badgeEvidence("best_vs_par", mkRound(spec, { id: "E3" }));
  ok("best_vs_par text shows 77 and +5", /77/.test(ev.text) && /\+5/.test(ev.text));
}

console.log(`badges: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
