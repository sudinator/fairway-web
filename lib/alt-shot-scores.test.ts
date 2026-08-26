/**
 * Score fan-out: one number entered for a side, written to both partners' rows.
 *
 * The cases that matter are the disagreements — a row edited outside the alternate-shot flow, or
 * an outbox still catching up. Preferring one partner silently would show a score nobody entered.
 */
import { altShotScoreWrites, sideScore, altShotStatsOwner } from "./alt-shot-scores";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = <T,>(n: string, a: T, b: T) => {
  if (JSON.stringify(a) === JSON.stringify(b)) pass++;
  else { fail++; fails.push(`FAIL ${n}\n     expected ${JSON.stringify(b)}\n     actual   ${JSON.stringify(a)}`); }
};

// ── writing ────────────────────────────────────────────────────────────────
{
  const w = altShotScoreWrites(["amit", "bryan"], 3, 5);
  eq("writes to both partners", w.length, 2);
  eq("same hole for both", w.map((x) => x.holeIndex), [3, 3]);
  eq("SAME value for both", w.map((x) => x.strokes), [5, 5]);
  eq("both partners named", w.map((x) => x.playerId), ["amit", "bryan"]);
}
{
  // Clearing a hole must clear BOTH rows, or the side keeps a score it no longer has.
  const w = altShotScoreWrites(["amit", "bryan"], 0, null);
  eq("clearing writes null to both", w.map((x) => x.strokes), [null, null]);
  eq("clearing still touches both rows", w.length, 2);
}

// ── reading ────────────────────────────────────────────────────────────────
eq("both agree", sideScore([4, 5], [4, 5], 0), { strokes: 4, conflict: false });
eq("hole not yet played", sideScore([null], [null], 0), { strokes: null, conflict: false });

// A missing value on one row is NOT a conflict: the outbox may still be catching up, or a partner
// joined after scoring began. Take the value that exists.
eq("only the first row has it", sideScore([6], [null], 0), { strokes: 6, conflict: false });
eq("only the second row has it", sideScore([null], [6], 0), { strokes: 6, conflict: false });

// Two DIFFERENT numbers is a real disagreement — only reachable if a row was edited outside this
// flow. Reported rather than resolved.
eq("rows disagree", sideScore([4], [5], 0), { strokes: 4, conflict: true });

// Missing arrays entirely (a player row with no scores yet) must not throw.
eq("no arrays at all", sideScore(null, undefined, 2), { strokes: null, conflict: false });
eq("index beyond the array", sideScore([4], [4], 9), { strokes: null, conflict: false });

// Zero is a real score, not an absence. `?? null` rather than `|| null` is what makes this pass.
eq("zero is a value, not a blank", sideScore([0], [0], 0), { strokes: 0, conflict: false });

// ── stats are NOT fanned out ───────────────────────────────────────────────
// Whose putt was it? The question has no player-level answer in alternate shot, and duplicating a
// putt count would double the side's putts in any aggregate.
eq("stats belong to one row only", altShotStatsOwner(["amit", "bryan"]), "amit");
ok("stats owner is stable across calls", altShotStatsOwner(["amit", "bryan"]) === altShotStatsOwner(["amit", "bryan"]));

console.log(`alt shot scores: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
