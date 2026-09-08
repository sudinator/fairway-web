/**
 * REAL-DATA FIXTURE — a decided match freezes at its margin, on every surface.
 *
 * Staging 571157 (nine-hole four-ball, Francis Byrne back nine, 85%, best ball), Group 1:
 * DeShawn + Amit vs Christopher + Michael. The app's four-ball card showed **8 UP** at the 9th on a
 * match decided **5 & 3 at the 6th**. Handicaps were correct — 8 was the running count. Cause:
 * components/game/scoring-views.tsx read `lead` from fourballStatus/matchStatus, which counted every
 * played hole, while competition.ts, computeTrifecta and lib/live-scoring used matchCloseoutStatus.
 * After 184.0 the PUBLIC SHARE PAGE was more correct than the app.
 *
 * 184.1 makes matchStatus and fourballStatus delegate thru/lead/result to matchCloseoutStatus, so
 * there is one close-out rule. The running counts are pinned here as a fence.
 */
import { matchStatus, fourballStatus, matchProgress, fourballProgress, type FourballMember } from "./golf";
import { chBasis } from "./game-shape";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

// 571157 — back nine, par 72 course, 85%, best ball.
const H9 = [
  { n: 10, si: 12, par: 4 }, { n: 11, si: 16, par: 4 }, { n: 12, si: 2, par: 4 }, { n: 13, si: 18, par: 3 },
  { n: 14, si: 10, par: 5 }, { n: 15, si: 4, par: 3 }, { n: 16, si: 14, par: 4 }, { n: 17, si: 8, par: 5 },
  { n: 18, si: 6, par: 4 },
];
type Row = { id: string; handicap_index: number; slope: number; rating: number; course_handicap: number; scores: number[] };
const R: Record<string, Row> = {
  DeShawn: { id: "DeShawn", handicap_index: 14.8, slope: 131, rating: 73.5, course_handicap: 19, scores: [5, 5, 6, 4, 6, 5, 5, 6, 5] },
  Amit: { id: "Amit", handicap_index: 14, slope: 131, rating: 73.5, course_handicap: 18, scores: [5, 4, 6, 4, 6, 4, 5, 6, 5] },
  Christopher: { id: "Christopher", handicap_index: 29.7, slope: 131, rating: 73.5, course_handicap: 36, scores: [8, 7, 8, 6, 9, 7, 7, 9, 8] },
  Michael: { id: "Michael", handicap_index: 24.2, slope: 131, rating: 73.5, course_handicap: 30, scores: [7, 6, 7, 5, 8, 6, 6, 8, 7] },
  Chris: { id: "Chris", handicap_index: 5.5, slope: 131, rating: 73.5, course_handicap: 8, scores: [4, 4, 5, 3, 5, 4, 4, 5, 4] },
  Marcus: { id: "Marcus", handicap_index: 10.1, slope: 131, rating: 73.5, course_handicap: 13, scores: [5, 4, 5, 4, 6, 4, 5, 6, 5] },
  BoLi: { id: "BoLi", handicap_index: 0.8, slope: 131, rating: 73.5, course_handicap: 2, scores: [4, 4, 4, 3, 5, 3, 4, 5, 4] },
  Lex: { id: "Lex", handicap_index: 17.3, slope: 131, rating: 73.5, course_handicap: 22, scores: [6, 5, 6, 5, 7, 5, 6, 7, 6] },
};
const mem = (ks: string[]): FourballMember[] => ks.map((k) => ({ id: k, gross: R[k].scores, ch: chBasis(R[k], 72, 9), noShow: false }));
const runningLead = (prog: (number | null)[]) => { const p = prog.filter((x): x is number => x != null); return p.length ? p[p.length - 1] : 0; };

// ── Group 1: decided 5 & 3 at the 6th; the app showed the running 8 UP ──────────────────────────
const g1a = ["DeShawn", "Amit"], g1b = ["Christopher", "Michael"];
const g1 = fourballStatus(H9, mem([...g1a, ...g1b]), g1a, g1b, 85, "best_ball");
eq("571157 G1 result", g1.result, "5 & 3");
eq("571157 G1 lead is FROZEN at the close-out", g1.lead, 5);
eq("571157 G1 thru is FROZEN at the deciding hole", g1.thru, 6);
eq("FENCE the running count the app used to show was 8", runningLead(fourballProgress(H9, mem([...g1a, ...g1b]), g1a, g1b, 85, "best_ball")), 8);
eq("FENCE frozen lead is not the running count", g1.lead !== 8, true);

// ── Group 2: goes the distance, halved — nothing to freeze ───────────────────────────────────────
const g2a = ["Chris", "Marcus"], g2b = ["BoLi", "Lex"];
const g2 = fourballStatus(H9, mem([...g2a, ...g2b]), g2a, g2b, 85, "best_ball");
eq("571157 G2 result", g2.result, "Halved");
eq("571157 G2 thru is the full nine", g2.thru, 9);
eq("571157 G2 lead", g2.lead, 0);

// ── Singles (268834, par 71 course, 85%): same rule via matchStatus ──────────────────────────────
const H9S = [
  { n: 1, si: 9, par: 4 }, { n: 2, si: 1, par: 3 }, { n: 3, si: 11, par: 5 }, { n: 4, si: 13, par: 4 },
  { n: 5, si: 15, par: 4 }, { n: 6, si: 17, par: 3 }, { n: 7, si: 5, par: 5 }, { n: 8, si: 3, par: 4 },
  { n: 9, si: 7, par: 4 },
];
const S: Record<string, Row> = {
  Amit: { id: "Amit", handicap_index: 14, slope: 137, rating: 72.9, course_handicap: 19, scores: [4, 3, 6, 5, 4, 3, 6, 5, 4] },
  DeShawn: { id: "DeShawn", handicap_index: 14.8, slope: 137, rating: 72.9, course_handicap: 20, scores: [5, 4, 6, 5, 5, 3, 6, 6, 5] },
  Christopher: { id: "Christopher", handicap_index: 29.7, slope: 137, rating: 72.9, course_handicap: 38, scores: [7, 6, 9, 8, 7, 6, 9, 8, 7] },
  BoLi: { id: "BoLi", handicap_index: 0.8, slope: 137, rating: 72.9, course_handicap: 3, scores: [4, 3, 5, 4, 4, 3, 5, 4, 4] },
};
const chS = (k: string) => chBasis(S[k], 71, 9);
const m1 = matchStatus(H9S, S.Amit.scores, S.DeShawn.scores, chS("Amit"), chS("DeShawn"), 85);
eq("268834 Amit v DeShawn result", m1.result, "3 & 2");
eq("268834 Amit v DeShawn lead FROZEN", m1.lead, 3);
eq("268834 Amit v DeShawn thru FROZEN", m1.thru, 7);
eq("FENCE running count was 5, not the frozen 3", runningLead(matchProgress(H9S, S.Amit.scores, S.DeShawn.scores, chS("Amit"), chS("DeShawn"), 85)), 5);
// Hole statistics stay full-round counts — they are not match state.
eq("268834 hole wins still counted over all nine", m1.aWins + m1.bWins + m1.halves, 9);

const m2 = matchStatus(H9S, S.Christopher.scores, S.BoLi.scores, chS("Christopher"), chS("BoLi"), 85);
eq("268834 Christopher v BoLi result (B side wins)", m2.result, "5 & 4");
eq("268834 Christopher v BoLi lead FROZEN and negative", m2.lead, -5);
eq("268834 Christopher v BoLi thru FROZEN", m2.thru, 5);

console.log(`close-out freeze (571157 + 268834 fixtures): ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
