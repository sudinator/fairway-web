/**
 * REAL-DATA FIXTURE — Trifecta, Ryder Cup scoring, The Architects Golf Club, Jul 5 2026.
 * game 51a8ed51-d28d-40ec-bfc0-741d57579415, Foursome 1: Karan + Sachin vs Ashutosh + BK.
 *
 * Found on device: Sachin's own card showed him 4 UP over BK at the finish while the Results
 * page and the Cup tally said 5 UP (4 & 2). The two disagreed from the 14th on.
 *
 * Mechanism: computeTrifecta takes a `scoring` argument. Under "match" each single is a 1-v-1 and
 * strokes are the DIFFERENCE BETWEEN THOSE TWO PLAYERS. Under "per_hole" (the default when the
 * argument is omitted) singles use the four-ball basis — everyone relative to the foursome's low.
 * The card path in tournaments.tsx omitted the argument, so it scored the singles as four-ball.
 * Same 3-stroke gap, delivered on different holes: on SI 4 (hole 14) BK receives a stroke under
 * the foursome basis and none under the pair basis. Sachin 3, BK 4: Results scores it a Sachin
 * win (3 v 4); the card scored it a halve (3 v 3).
 *
 * Rules confirmed with Amit (Sep 2026): singles = strokes off the lower of the two, allowance
 * applied first; team leg = strokes off the lowest of the four. Both already what the engine does.
 *
 * Both answers are pinned: the wrong one so a regression is recognised as THIS bug, the right one
 * so the card path can be held to it.
 */
import { computeTrifecta, matchLeadLabel } from "./golf";
import { chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

// games row (verbatim: holes_meta, course_par 71, allowance_pct 90, team_score_mode aggregate, trifecta_scoring match)
const HOLES = [
  { n: 1, si: 11, par: 5 }, { n: 2, si: 13, par: 3 }, { n: 3, si: 5, par: 5 }, { n: 4, si: 7, par: 4 },
  { n: 5, si: 9, par: 4 }, { n: 6, si: 17, par: 3 }, { n: 7, si: 3, par: 4 }, { n: 8, si: 15, par: 3 },
  { n: 9, si: 1, par: 4 }, { n: 10, si: 14, par: 4 }, { n: 11, si: 10, par: 5 }, { n: 12, si: 18, par: 3 },
  { n: 13, si: 6, par: 5 }, { n: 14, si: 4, par: 4 }, { n: 15, si: 2, par: 4 }, { n: 16, si: 8, par: 4 },
  { n: 17, si: 16, par: 3 }, { n: 18, si: 12, par: 4 },
];
const COURSE_PAR = 71;
const ALLOWANCE = 90;
const TEAM_MODE = "aggregate" as const;
const TRIFECTA_SCORING = "match" as const;

// game_players rows (verbatim handicap_index, slope, rating, course_handicap, scores)
type Row = { id: string; name: string; handicap_index: number; slope: number; rating: number; course_handicap: number; scores: number[] };
const KARAN: Row = { id: "bbe388ee-dc27-4272-b450-a9f230563e38", name: "Karan", handicap_index: 9, slope: 129, rating: 71.5, course_handicap: 11, scores: [4, 4, 7, 6, 4, 3, 4, 4, 5, 6, 5, 4, 6, 5, 5, 4, 4, 5] };
const SACHIN: Row = { id: "94916c8a-1913-41aa-bb78-c5c572716dbf", name: "Sachin", handicap_index: 13, slope: 127, rating: 69.6, course_handicap: 13, scores: [7, 3, 7, 7, 4, 4, 6, 4, 5, 5, 6, 3, 5, 3, 4, 5, 3, 4] };
const ASHUTOSH: Row = { id: "a89d81d4-2b9d-4fd3-966b-4bd432354328", name: "Ashutosh", handicap_index: 10, slope: 129, rating: 71.5, course_handicap: 12, scores: [5, 4, 5, 5, 4, 3, 4, 3, 5, 4, 5, 4, 7, 5, 5, 6, 3, 4] };
const BK: Row = { id: "7afdee8d-4361-49da-a3b8-cc2585582426", name: "BK", handicap_index: 16, slope: 127, rating: 69.6, course_handicap: 17, scores: [5, 4, 6, 6, 4, 5, 7, 5, 4, 5, 6, 5, 7, 4, 6, 6, 3, 6] };

const A = [KARAN.id, SACHIN.id];
const B = [ASHUTOSH.id, BK.id];
const members = [KARAN, SACHIN, ASHUTOSH, BK].map((r) => ({
  id: r.id,
  gross: r.scores,
  ch: chBasis(r, COURSE_PAR, HOLES.length),
  noShow: false,
}));

// The card's running strip for the player in single index `i`, exactly as tournaments.tsx derives it.
const runFor = (res: ReturnType<typeof computeTrifecta>, me: string) => {
  const mine = res.contests.find((c) => c.kind === "single" && (c.aIds[0] === me || c.bIds[0] === me))!;
  const iAmA = mine.aIds[0] === me;
  return mine.perHole.map((h) => (h.aNet == null || h.bNet == null) ? "" : matchLeadLabel(iAmA ? h.aRun - h.bRun : h.bRun - h.aRun));
};

// ── The wrong answer, pinned: scoring argument omitted (the card path before the fix) ───────────
const cardBefore = computeTrifecta(HOLES, members, A, B, ALLOWANCE, TEAM_MODE, false);
const sachinBefore = runFor(cardBefore, SACHIN.id);
eq("WRONG (omitted scoring) Sachin thru 14", sachinBefore[13], "1UP");
eq("WRONG (omitted scoring) Sachin final", sachinBefore[17], "4UP");

// ── The right answer: what Results / the Cup tally compute, and what the card must show ────────
const results = computeTrifecta(HOLES, members, A, B, ALLOWANCE, TEAM_MODE, false, TRIFECTA_SCORING);
const sachinAfter = runFor(results, SACHIN.id);
eq("RIGHT Sachin thru 13 (still agrees)", sachinAfter[12], "1UP");
eq("RIGHT Sachin thru 14 (H14 won, not halved)", sachinAfter[13], "2UP");
eq("RIGHT Sachin final", sachinAfter[17], "5UP");
const sb = results.contests.find((c) => c.kind === "single" && c.aIds[0] === SACHIN.id)!;
eq("RIGHT match result label", sb.result, "4 & 2");
eq("RIGHT hole 14 won by Sachin", sb.perHole[13].r, 1);
eq("RIGHT hole 14 nets 3 v 4 (BK gets no stroke on SI 4 off Sachin)", `${sb.perHole[13].aNet}-${sb.perHole[13].bNet}`, "3-4");
const wrongSb = cardBefore.contests.find((c) => c.kind === "single" && c.aIds[0] === SACHIN.id)!;
eq("WRONG hole 14 halved on the card (BK stroked off Karan's low)", wrongSb.perHole[13].r, 0);
eq("WRONG hole 14 nets 3 v 3 on the card", `${wrongSb.perHole[13].aNet}-${wrongSb.perHole[13].bNet}`, "3-3");

// The divergence is exactly holes 14-18 — so a future change that moves it is visible.
const differing = HOLES.map((h, i) => (sachinBefore[i] !== sachinAfter[i] ? h.n : null)).filter((n): n is number => n != null);
eq("divergence holes", differing.join(","), "14,15,16,17,18");

// Foursome-immune control: Karan v Ashutosh (Karan is the low both ways) agrees under both bases.
eq("control Karan v Ashutosh identical under both bases",
  runFor(cardBefore, KARAN.id).join("|"), runFor(results, KARAN.id).join("|"));

// ── Report ─────────────────────────────────────────────────────────────────────────────────────
console.log(`trifecta-card-scoring (Architects Jul 5 fixture): ${pass} passed, ${fail} failed`);
if (fail) { for (const f of fails) console.log(f); process.exit(1); }
