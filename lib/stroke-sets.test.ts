/**
 * REAL-DATA FIXTURE — every stroke DRAWN is a stroke the engine actually SCORES.
 *
 * A dot is a promise: "you get a shot here, in this contest". Before 185.0 the Trifecta card drew
 * the team-leg basis and the course handicap and drew the singles basis NOWHERE — even though the
 * singles decide two of the three points. Worse, orange meant different things by format (the full
 * course handicap in Stableford, the match basis in a four-ball).
 *
 * strokeSets() is now the ONE source for every dot on every surface. This holds it to the engines:
 * for each basis the dots must equal what the scorer uses for that same contest.
 *
 * Data: Architects Jul 5 Foursome 1 (Karan + Sachin v Ashutosh + BK, 90%, aggregate).
 */
import { strokeSets, chBasis, fullStrokes, dotStrokes } from "./game-shape";
import { matchAllowance, matchStrokesFor, computeTrifecta } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const HOLES = [
  { n: 1, si: 11, par: 5 }, { n: 2, si: 13, par: 3 }, { n: 3, si: 5, par: 5 }, { n: 4, si: 7, par: 4 },
  { n: 5, si: 9, par: 4 }, { n: 6, si: 17, par: 3 }, { n: 7, si: 3, par: 4 }, { n: 8, si: 15, par: 3 },
  { n: 9, si: 1, par: 4 }, { n: 10, si: 14, par: 4 }, { n: 11, si: 10, par: 5 }, { n: 12, si: 18, par: 3 },
  { n: 13, si: 6, par: 5 }, { n: 14, si: 4, par: 4 }, { n: 15, si: 2, par: 4 }, { n: 16, si: 8, par: 4 },
  { n: 17, si: 16, par: 3 }, { n: 18, si: 12, par: 4 },
];
const mk = (id: string, name: string, hi: number, sl: number, rt: number, ch: number, sc: number[]) =>
  ({ id, user_id: id, display_name: name, handicap_index: hi, slope: sl, rating: rt, course_handicap: ch, no_show: false, scores: sc }) as never;
const KARAN = mk("k", "Karan Sarin", 9, 129, 71.5, 11, [4,4,7,6,4,3,4,4,5,6,5,4,6,5,5,4,4,5]);
const SACHIN = mk("s", "Sachin Manchanda", 13, 127, 69.6, 13, [7,3,7,7,4,4,6,4,5,5,6,3,5,3,4,5,3,4]);
const ASH = mk("a", "Ashutosh Rathore", 10, 129, 71.5, 12, [5,4,5,5,4,3,4,3,5,4,5,4,7,5,5,6,3,4]);
const BK = mk("b", "BK Jain", 16, 127, 69.6, 17, [5,4,6,6,4,5,7,5,4,5,6,5,7,4,6,6,3,6]);
const ALL = [KARAN, SACHIN, ASH, BK];
const tri = { game_type: "trifecta", course_par: 71, allowance_pct: 90, team_score_mode: "aggregate",
  holes_meta: HOLES, pairings: [], teams: [{ key: "A" }, { key: "B" }],
  foursomes: [{ id: "f1", name: "F1", swap: false, a: ["k", "s"], b: ["a", "b"] }] } as never;

const setFor = (g: unknown, p: unknown, si: number, key: string) =>
  strokeSets(g as never, p as never, si, ALL as never).find((r) => r.key === key);

// ── Trifecta has THREE bases; each must match its own scorer ────────────────────────────────────
eq("trifecta returns three bases", strokeSets(tri, BK as never, 1, ALL as never).map((r) => r.key).join(","), "opponent,group_low,course");
eq("labels name the basis", strokeSets(tri, BK as never, 1, ALL as never).map((r) => r.label).join(" | "), "v Sachin | off Karan | course hcp");

const allocHoles = HOLES.map((h) => ({ hole_number: h.n, stroke_index: h.si }));
for (const h of HOLES) {
  // 1. the SINGLES dot equals the pair allocation the engine scores that single on
  const pair = matchAllowance(chBasis(BK as never, 71, 18), chBasis(SACHIN as never, 71, 18), 90);
  eq(`h${h.n} BK singles dot == pair basis`, setFor(tri, BK, h.si!, "opponent")!.strokes, matchStrokesFor(pair.a, h.si, allocHoles));
  // 2. the TEAM-LEG dot equals dotStrokes, which is what fourballNets scores the team leg on
  eq(`h${h.n} BK team dot == four-ball basis`, setFor(tri, BK, h.si!, "group_low")!.strokes, dotStrokes(tri, BK as never, h.si, ALL as never));
  // 3. the COURSE dot equals the full playing handicap used for side games and posting
  eq(`h${h.n} BK course dot == full handicap`, setFor(tri, BK, h.si!, "course")!.strokes, fullStrokes(tri, BK as never, h.si));
}

// ── The specific hole that produced the original bug ────────────────────────────────────────────
// H14 is SI 4: BK receives in the TEAM leg (off Karan) but NOT in his single against Sachin.
eq("H14 BK team leg gives a stroke", setFor(tri, BK, 4, "group_low")!.strokes, 1);
eq("H14 BK single gives none", setFor(tri, BK, 4, "opponent")!.strokes, 0);
eq("H14 Sachin gives none and gets none in the single", `${setFor(tri, SACHIN, 4, "opponent")!.strokes}/${setFor(tri, SACHIN, 4, "opponent")!.gives}`, "0/0");
// H9 is SI 1: Sachin GIVES BK a stroke in the single while RECEIVING one in the team leg.
eq("H9 Sachin gives in the single", setFor(tri, SACHIN, 1, "opponent")!.gives, 1);
eq("H9 Sachin receives in the team leg", setFor(tri, SACHIN, 1, "group_low")!.strokes, 1);

// The singles dots must agree with computeTrifecta's own singles nets, hole for hole.
const members = ALL.map((p) => ({ id: (p as { id: string }).id, gross: (p as { scores: number[] }).scores, ch: chBasis(p as never, 71, 18), noShow: false }));
const res = computeTrifecta(HOLES, members, ["k", "s"], ["a", "b"], 90, "aggregate", false);
const sb = res.contests.find((c) => c.kind === "single" && c.aIds[0] === "s")!;
for (let i = 0; i < HOLES.length; i++) {
  const gross = (BK as unknown as { scores: number[] }).scores[i];
  eq(`h${HOLES[i].n} BK singles net == dots imply`, sb.perHole[i].bNet, gross - setFor(tri, BK, HOLES[i].si!, "opponent")!.strokes);
}

// ── Individual formats: ONE basis, and it is the course handicap ────────────────────────────────
const stableford = { ...(tri as object), game_type: "stableford", foursomes: [] } as never;
eq("stableford has one basis", strokeSets(stableford, BK as never, 1, ALL as never).map((r) => r.key).join(","), "course");
eq("stableford basis is named", strokeSets(stableford, BK as never, 1, ALL as never)[0].label, "course hcp");

console.log(`stroke sets (Architects Jul 5 fixture): ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.slice(0, 8).join("\n")); process.exit(1); }
