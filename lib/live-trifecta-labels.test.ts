/**
 * REAL-DATA FIXTURE — public live share page, Trifecta contest labels.
 * Staging game 641032 (Francis Byrne, Sep 6 2026), Group 1: Chris + Amit vs Christopher + Michael,
 * carrying the FB 6/21 production scores. Screenshot of the share page on 183.0 showed:
 *
 *     Single  Chris O'Neal   vs  Michael Van Der Meer     won 4 UP
 *     Single  Amit Sud       vs  Christopher Reed        lost 5 UP
 *     Team point (better ball)                        Wildcats 1 up
 *
 * while the in-game Results for the same game read 4 & 2 and 4 & 3. Cause: the share page called
 * matchStatus() on the raw pair and discarded the singles computeTrifecta had already returned.
 * matchStatus is count-based, so a match decided on the 16th kept counting the last two holes.
 * The team leg was passed a hardcoded "" for its result, so it never showed a close-out either.
 *
 * 183.1 labels every leg from the engine's own contest through the shared trifectaRowState.
 * Both numbers are pinned: the old ones as a regression fence, the correct ones as the contract.
 */
import { computeTrifecta, matchStatus, trifectaRowState } from "./golf";
import { chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const HOLES = [
  { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 }, { n: 4, si: 13, par: 4 },
  { n: 5, si: 17, par: 3 }, { n: 6, si: 1, par: 4 }, { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 },
  { n: 9, si: 3, par: 4 }, { n: 10, si: 10, par: 4 }, { n: 11, si: 8, par: 4 }, { n: 12, si: 2, par: 4 },
  { n: 13, si: 6, par: 4 }, { n: 14, si: 18, par: 3 }, { n: 15, si: 16, par: 5 }, { n: 16, si: 4, par: 4 },
  { n: 17, si: 12, par: 3 }, { n: 18, si: 14, par: 5 },
];
type Row = { id: string; handicap_index: number; slope: number; rating: number; course_handicap: number; scores: number[] };
const CHRIS: Row = { id: "chris", handicap_index: 9, slope: 137, rating: 72.9, course_handicap: 14, scores: [4, 5, 5, 4, 4, 5, 5, 5, 4, 5, 5, 4, 6, 3, 6, 4, 4, 5] };
const AMIT: Row = { id: "amit", handicap_index: 23, slope: 135, rating: 70.9, course_handicap: 28, scores: [6, 6, 5, 7, 4, 6, 5, 5, 6, 6, 6, 8, 6, 5, 7, 6, 5, 7] };
const CHRISTOPHER: Row = { id: "christopher", handicap_index: 13, slope: 137, rating: 72.9, course_handicap: 19, scores: [4, 4, 6, 6, 4, 6, 5, 7, 4, 6, 6, 6, 4, 3, 6, 7, 4, 6] };
const MICHAEL: Row = { id: "michael", handicap_index: 11, slope: 137, rating: 72.9, course_handicap: 16, scores: [5, 4, 5, 6, 5, 6, 5, 5, 5, 5, 5, 5, 5, 4, 6, 6, 4, 5] };

const A = [CHRIS.id, AMIT.id], B = [CHRISTOPHER.id, MICHAEL.id];
const members = [CHRIS, AMIT, CHRISTOPHER, MICHAEL].map((r) => ({ id: r.id, gross: r.scores, ch: chBasis(r, 70, 18), noShow: false }));
const ch = (id: string) => members.find((m) => m.id === id)!.ch;
const gross = (id: string) => [CHRIS, AMIT, CHRISTOPHER, MICHAEL].find((r) => r.id === id)!.scores;

// swap: true — a[1] plays b[0], matching the staging foursome.
const tri = computeTrifecta(HOLES, members, A, B, 85, "best_ball", true);
const singles = tri.contests.filter((c) => c.kind === "single");
const team = tri.contests.find((c) => c.kind === "team")!;

// ── The contract: labels come from the engine's contests ─────────────────────────────────────────
const label = (c: { thru: number; lead: number; settled: boolean; result: string }) => {
  const st = trifectaRowState(c);
  if (!c.thru) return "not started";
  if (st.aSide === "level") return c.settled ? "halved" : "all square";
  const aAhead = st.aSide === "won" || st.aSide === "leads";
  return c.settled ? `${aAhead ? "won" : "lost"} ${st.label}` : `${st.label.replace(" UP", "")} ${aAhead ? "up" : "dn"}`;
};
const chrisSingle = singles.find((c) => c.aIds[0] === CHRIS.id)!;
const amitSingle = singles.find((c) => c.aIds[0] === AMIT.id)!;
eq("Chris single label", label(chrisSingle), "won 4 & 2");
eq("Amit single label", label(amitSingle), "lost 4 & 3");
eq("Chris single settled on the 16th", chrisSingle.thru, 16);
eq("Amit single settled on the 15th", amitSingle.thru, 15);
eq("Chris side emphasis", `${trifectaRowState(chrisSingle).aSide}/${trifectaRowState(chrisSingle).bSide}`, "won/lost");
eq("Amit side emphasis", `${trifectaRowState(amitSingle).aSide}/${trifectaRowState(amitSingle).bSide}`, "lost/won");
eq("team leg settled", team.settled, true);
eq("team leg has a close-out result (was hardcoded \"\" before 183.1)", team.result !== "", true);

// ── Regression fence: the 183.0 share page recomputed the singles with matchStatus ───────────────
const oldChris = matchStatus(HOLES, gross(CHRIS.id), gross(MICHAEL.id), ch(CHRIS.id), ch(MICHAEL.id), 85);
const oldAmit = matchStatus(HOLES, gross(AMIT.id), gross(CHRISTOPHER.id), ch(AMIT.id), ch(CHRISTOPHER.id), 85);
eq("FENCE old Chris label was the screenshot's 'won 4 UP'", `won ${oldChris.result}`, "won 4 UP");
eq("FENCE old Amit label was the screenshot's 'lost 5 UP'", `lost ${oldAmit.result}`, "lost 5 UP");
eq("FENCE old computation ran to 18, ignoring close-out", `${oldChris.thru}/${oldAmit.thru}`, "18/18");
eq("engine and the old path disagree — that is the bug", label(chrisSingle) !== `won ${oldChris.result}`, true);

// In-progress rendering: after 9 holes nothing is settled, so labels read as a running margin.
const mid = computeTrifecta(HOLES, members.map((m) => ({ ...m, gross: m.gross.map((g, i) => (i < 9 ? g : null)) as number[] })), A, B, 85, "best_ball", true);
const midChris = mid.contests.filter((c) => c.kind === "single").find((c) => c.aIds[0] === CHRIS.id)!;
eq("in-progress label is a running margin, not a close-out", label(midChris), "3 up");
eq("in-progress emphasis is leads/trails, not won/lost", `${trifectaRowState(midChris).aSide}/${trifectaRowState(midChris).bSide}`, "leads/trails");

console.log(`live trifecta labels (641032 fixture): ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
