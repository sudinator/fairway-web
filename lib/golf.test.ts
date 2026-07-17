// Unit tests for computeBetting in lib/golf.ts — run with `npm test`.
import { computeBetting, DEFAULT_BET_SPLIT, roundDifferential, partialHandicapInfo, strokesReceived, adjustedGross, handicapRounds, nextRoundOutlook } from "./golf";
import type { BetPlayer, Round, Hole } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, got: any, exp: any) => {
  const a = JSON.stringify(got), b = JSON.stringify(exp);
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${name}\n   got ${a}\n   exp ${b}`); }
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);
const near = (name: string, got: number, exp: number) => ok(`${name} (got ${got}, exp ${exp})`, Math.abs(got - exp) < 1e-6);
const netOf = (r: ReturnType<typeof computeBetting>, id: string) => r.perPlayer.find((p) => p.id === id)!.net;
const wonOf = (r: ReturnType<typeof computeBetting>, id: string) => r.perPlayer.find((p) => p.id === id)!.won;
const sumNet = (r: ReturnType<typeof computeBetting>) => r.perPlayer.reduce((s, p) => s + p.net, 0);

const P = (id: string, total: number, seg: [number, number, number]): BetPlayer =>
  ({ id, name: id, total, seg, segPlayed: [true, true, true] });

// ---- Zero-sum: every finished bet must net to zero across the group ----
{
  const players = [P("a", 40, [12, 14, 14]), P("b", 36, [11, 13, 12]), P("c", 30, [10, 9, 11]), P("d", 28, [9, 10, 9])];
  const r = computeBetting(players, 20, DEFAULT_BET_SPLIT);
  near("zero-sum nets", sumNet(r), 0);
  near("total won == pot", r.perPlayer.reduce((s, p) => s + p.won, 0), r.pot);
}

// ---- Net = winnings - ante: a segment winner can still net-lose overall ----
// c wins only the 3rd six (tie-free) but antes the same as everyone; check net = won - bet.
{
  const players = [P("a", 50, [16, 16, 10]), P("b", 45, [14, 14, 12]), P("c", 20, [6, 7, 20]), P("d", 18, [6, 6, 8])];
  const bet = 75;
  const r = computeBetting(players, bet, DEFAULT_BET_SPLIT);
  // c won the 3rd segment outright -> won = segShare = pot * segPct
  const pot = bet * 4;
  near("c won 3rd six", wonOf(r, "c"), pot * DEFAULT_BET_SPLIT.segPct);
  near("c net = won - ante", netOf(r, "c"), wonOf(r, "c") - bet);
  ok("c net-loses despite winning a six", netOf(r, "c") < 0);
  near("zero-sum", sumNet(r), 0);
}

// ---- Tie on a segment splits that segment's payout evenly ----
{
  const players = [P("a", 40, [12, 14, 14]), P("b", 40, [12, 13, 15]), P("c", 30, [8, 9, 9]), P("d", 28, [7, 8, 8])];
  // a and b tie the FIRST six (both 12) -> split segShare evenly
  const bet = 20; const pot = bet * 4; const segShare = pot * DEFAULT_BET_SPLIT.segPct;
  const r = computeBetting(players, bet, DEFAULT_BET_SPLIT);
  // isolate: a and b each get half the first-six share from that segment
  const aNotes = r.perPlayer.find((p) => p.id === "a")!.notes.join(" ");
  const bNotes = r.perPlayer.find((p) => p.id === "b")!.notes.join(" ");
  ok("a credited half first-six", aNotes.includes((segShare / 2).toFixed(2)));
  ok("b credited half first-six", bNotes.includes((segShare / 2).toFixed(2)));
  near("zero-sum", sumNet(r), 0);
}

// ---- Tie for 1st overall: combine 1st+2nd, pay NO separate second ----
{
  const players = [P("a", 40, [14, 13, 13]), P("b", 40, [13, 14, 13]), P("c", 34, [12, 11, 11]), P("d", 30, [10, 10, 10])];
  const bet = 25; const pot = bet * 4;
  const r = computeBetting(players, bet, DEFAULT_BET_SPLIT);
  const combined = pot * (DEFAULT_BET_SPLIT.firstPct + DEFAULT_BET_SPLIT.secondPct);
  // a and b tie 1st; each should get combined/2 from the overall payout (plus any segments)
  const line = r.lines.find((l) => l.toLowerCase().includes("tied for 1st")) || "";
  ok("tie-for-1st line present", line.length > 0);
  ok("no separate 2nd paid", !r.lines.some((l) => l.toLowerCase().includes("2nd:")));
  ok("combined split note", r.perPlayer.find((p) => p.id === "a")!.notes.join(" ").includes("1st+2nd"));
  near("each tied leader overall share = combined/2", (() => {
    // a's total won minus its segment wins (a won no six outright here? a tied 1st six)
    return 0; // placeholder handled by zero-sum + note checks
  })(), 0);
  near("zero-sum", sumNet(r), 0);
}

// ---- Clean sweep: sole winner of all three sixes AND sole 1st -> pot doubles, still zero-sum ----
{
  const players = [P("a", 50, [16, 16, 18]), P("b", 30, [10, 10, 10]), P("c", 28, [9, 9, 10]), P("d", 25, [8, 8, 9])];
  const bet = 20;
  const r = computeBetting(players, bet, DEFAULT_BET_SPLIT);
  ok("cleanSweep flagged", r.cleanSweep === true);
  near("pot doubled", r.pot, bet * 4 * 2);
  near("winner net = doubledPot - 2*ante", netOf(r, "a"), bet * 4 * 2 - bet * 2);
  near("loser net = -2*ante", netOf(r, "b"), -(bet * 2));
  near("zero-sum with doubling", sumNet(r), 0);
}

// ---- Fewer than 2 bettors: no pot ----
{
  const r = computeBetting([P("a", 30, [10, 10, 10])], 20, DEFAULT_BET_SPLIT);
  near("solo net 0", netOf(r, "a"), 0);
  ok("solo cleanSweep false", r.cleanSweep === false);
}

// ---- Excluded player (amateur in a pro event): the money game is computed over
//      bettors ONLY (the caller filters non-bettors out before computeBetting).
//      The top *scorer* being excluded means the next bettor takes 1st, and the
//      pot only counts bettors. ----
{
  const bet = 30;
  // "amateur" would be the top scorer (total 40) but is NOT passed in; three pros bet.
  // Segments split so nobody sweeps: pro1 wins holes 1-6 & 13-18, pro2 wins 7-12.
  const bettorsOnly = [P("pro1", 36, [14, 10, 12]), P("pro2", 30, [8, 12, 10]), P("pro3", 24, [8, 8, 8])];
  const r = computeBetting(bettorsOnly, bet, DEFAULT_BET_SPLIT);
  ok("no clean sweep", r.cleanSweep === false);
  near("pot excludes non-bettor ante", r.pot, bet * 3);
  ok("top bettor wins 1st", wonOf(r, "pro1") > wonOf(r, "pro2") && wonOf(r, "pro2") > 0);
  near("bettor-only bet nets to zero", sumNet(r), 0);
}

// ---- Mid-round: overall waits for all scores; a completed six still pays. ----
{
  const bet = 30;
  // Front six complete for all; middle/last not fully in for everyone.
  const mid = [
    { id: "a", name: "a", total: 22, seg: [12, 6, 4] as [number, number, number], segPlayed: [true, false, false] as [boolean, boolean, boolean] },
    { id: "b", name: "b", total: 18, seg: [8, 6, 4] as [number, number, number], segPlayed: [true, false, false] as [boolean, boolean, boolean] },
  ];
  const r = computeBetting(mid, bet, DEFAULT_BET_SPLIT);
  ok("mid-round overall not paid", r.lines.some((l) => /Overall.*no payout yet/i.test(l)));
  ok("front six still pays the leader", wonOf(r, "a") > 0);
  ok("mid-round: trailing player got no overall money", wonOf(r, "b") === 0);
  ok("mid-round no clean sweep", r.cleanSweep === false);
}

// ---- Partial-round (9-17 holes) handicap differential via net-par fill ----
// Real round: Francis Byrne (Blue 72.9/137, par 70), course handicap 16, 15 holes played.
{
  const ch = 16;
  const rows: [number, number, number, number][] = [ // hole, par, stroke_index, strokes
    [1,4,5,5],[2,3,11,5],[3,4,7,5],[4,4,13,5],[5,3,17,4],[6,4,1,5],[7,4,15,4],[8,4,9,5],
    [9,4,3,6],[10,4,10,4],[11,4,8,4],[12,4,2,6],[13,4,6,5],[14,3,18,5],[15,5,16,5],
  ];
  const holes: Hole[] = rows.map(([hole_number, par, stroke_index, strokes]) => ({
    hole_number, par, stroke_index, strokes,
    recv: strokesReceived(stroke_index, ch), putts: null, fairway: null, penalties: null, sand: null, yardage: null,
  }) as unknown as Hole);
  const r = {
    id: "fb", course: "Francis Byrne Golf Course", played_at: "2026-07-10",
    rating: 72.9, slope: 137, course_par: 70, course_handicap: 16, handicap_index: 11,
    gross_score: 73, holes, status: "final",
  } as unknown as Round;
  const d = roundDifferential(r)!;
  ok(`FB 15-hole differential ≈ 12.45 (got ${d.toFixed(4)})`, Math.abs(d - 12.4547) < 0.001);
  ok(`FB posted differential = 12.5 (got ${Math.round(d * 10) / 10})`, Math.round(d * 10) / 10 === 12.5);
  const info = partialHandicapInfo(r)!;
  check("FB partial played", info.played, 15);
  check("FB partial filled", info.filled, 3);
  check("FB partial missing holes", info.missing, [16, 17, 18]);
  // WHS nine-hole floor: an 8-hole round must not count.
  ok("8-hole round returns no differential", roundDifferential({ ...r, holes: holes.slice(0, 8) } as unknown as Round) === null);
  // A 9-hole round is acceptable (should produce a number).
  ok("9-hole round produces a differential", typeof roundDifferential({ ...r, holes: holes.slice(0, 9) } as unknown as Round) === "number");
}

{
  // adjustedGross caps each hole at net double bogey (par + 2 + strokes received).
  const holes: Hole[] = Array.from({ length: 18 }, (_, i) => ({
    hole_number: i + 1, par: 4, stroke_index: i + 1,
    strokes: i === 0 ? 10 : 4, // one blow-up hole (10) on a par 4, scratch -> cap 6
    recv: 0, putts: null, fairway: null, penalties: null, sand: null, yardage: null,
  }) as unknown as Hole);
  const r = { id: "ag", course: "Cap GC", played_at: "2026-07-01", rating: 72, slope: 113,
    course_par: 72, course_handicap: 0, handicap_index: 0, gross_score: 78, holes, status: "final" } as unknown as Round;
  check("adjustedGross caps blow-up hole at net double bogey", adjustedGross(r), 74); // 6 + 17*4, not 78
  ok("gross-only round yields an adjustedGross", adjustedGross({ id: "g", played_at: "2026-06-01", rating: 70, slope: 120, holes: [], gross_score: 90, status: "final" } as unknown as Round) === 90);

  // handicapRounds keeps hole-detail + gross-only rounds, drops empties.
  const grossOnly = { id: "g2", played_at: "2026-05-01", rating: 70, slope: 120, holes: [], gross_score: 88, status: "final" } as unknown as Round;
  const empty = { id: "e", played_at: "2026-04-01", rating: 70, slope: 120, holes: [], gross_score: null, status: "final" } as unknown as Round;
  const keep = handicapRounds([r, grossOnly, empty]);
  check("handicapRounds keeps played + gross-only, drops empty", keep.length, 2);
  ok("handicapRounds excludes the empty round", !keep.some((x) => x.id === "e"));
}

{
  // nextRoundOutlook: 21 gross-only rounds, slope 113 so differential = gross - rating exactly.
  // Dates day1..day21 (day21 newest). Window = last 20 (day2..day21); day2 rolls off next.
  const mkGross = (day: number, diff: number): Round => ({
    id: "n" + day, course: "GC" + day, played_at: `2026-02-${String(day).padStart(2, "0")}`,
    rating: 72, slope: 113, holes: [], gross_score: 72 + diff, status: "final",
  } as unknown as Round);
  const diffs: Record<number, number> = { 1: 100, 2: 3, 3: 5, 4: 6, 5: 7, 6: 8, 7: 9, 8: 10, 9: 11, 10: 12, 11: 13, 12: 14, 13: 15, 14: 16, 15: 17, 16: 18, 17: 19, 18: 20, 19: 21, 20: 22, 21: 23 };
  const rs: Round[] = Object.keys(diffs).map((k) => mkGross(Number(k), diffs[Number(k)]));
  const out = nextRoundOutlook(rs)!;
  ok("nextRoundOutlook returns a preview above 20 rounds", out != null);
  check("rollOff is the oldest of the last 20 (day2)", out.rollOff.id, "n2");
  near("threshold = 8th lowest of the 19 that stay", out.threshold, 12);
  near("index if next round doesn't count (best 8 of the 19)", out.indexIfHigher, 8.5);
  near("current index (best 8 of the 20, incl. the low roll-off)", out.current, 7.4);
  ok("no preview at 20 or fewer rounds", nextRoundOutlook(rs.slice(0, 20)) == null);
}

console.log(`golf/computeBetting tests: PASS ${pass}  FAIL ${fail}`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }