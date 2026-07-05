// Unit tests for lib/legs.ts — run with `npm test`.
import { buildLegs, legResult, teamTally, fmtPt, legPoints, DEFAULT_LEG_CONFIG } from "./legs";
import type { LegScore, LegConfig } from "./legs";

let pass = 0, fail = 0; const fails: string[] = [];
const canon = (v: any): string => JSON.stringify(v, (_k, val) =>
  (val && typeof val === "object" && !Array.isArray(val))
    ? Object.fromEntries(Object.keys(val).sort().map((k) => [k, val[k]]))
    : val);
const check = (name: string, got: any, exp: any) => {
  const a = canon(got), b = canon(exp);
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${name}\n   got ${a}\n   exp ${b}`); }
};
const ok = (name: string, cond: boolean) => check(name, !!cond, true);

// --- buildLegs ---
check("sixes/18 count", buildLegs("sixes", 18).map((l) => l.k), ["1\u20136", "7\u201312", "13\u201318", "Total"]);
check("sixesNoTot/18", buildLegs("sixesNoTot", 18).map((l) => l.k), ["1\u20136", "7\u201312", "13\u201318"]);
check("nines/18", buildLegs("nines", 18).map((l) => l.k), ["Front 9", "Back 9", "Total"]);
check("total/18", buildLegs("total", 18).map((l) => l.k), ["Total"]);
// 9-hole game: Front 9 == Total (same range) -> deduped to one leg
check("nines/9 dedupe", buildLegs("nines", 9).map((l) => l.k), ["Total"]);
// 9-hole sixes: 1-6, 7-9, then Total(1-9) — no collision
check("sixes/9 count", buildLegs("sixes", 9).length, 3);

// --- legResult (pts: high wins) ---
const S = (arr: [string, string, number | null][]): LegScore[] => arr.map(([pid, team, val]) => ({ pid, team, val }));
// solo winner
check("solo A", legResult(S([["amit", "A", 15], ["dev", "A", 11], ["ravi", "B", 12], ["sam", "B", 10]]), "pts").winnerTeams, ["A"]);
// cross-team tie -> both teams
check("cross tie both", legResult(S([["amit", "A", 13], ["dev", "A", 10], ["ravi", "B", 13], ["sam", "B", 9]]), "pts").winnerTeams.sort(), ["A", "B"]);
// same-team tie -> team once
check("same tie once", legResult(S([["amit", "A", 9], ["dev", "A", 8], ["ravi", "B", 12], ["sam", "B", 12]]), "pts").winnerTeams, ["B"]);
check("same tie two pids", legResult(S([["ravi", "B", 12], ["sam", "B", 12], ["amit", "A", 9]]), "pts").winnerPids.sort(), ["ravi", "sam"]);
// net: low wins
check("net low wins", legResult(S([["amit", "A", 3], ["ravi", "B", 5]]), "net").winnerTeams, ["A"]);
// no scores yet
check("empty", legResult(S([["amit", "A", null], ["ravi", "B", null]]), "pts").best, null);

// --- teamTally with tie rules + fractional points ---
// legs: A solo (½), cross-tie A&B (½), same-tie B (½), cross-tie A&B (1) => A: ½+½+1=2 ; B: ½+½+1=2
check("tally 2-2", teamTally([
  { teams: ["A"], points: 0.5 },
  { teams: ["A", "B"], points: 0.5 },
  { teams: ["B"], points: 0.5 },
  { teams: ["A", "B"], points: 1 },
]), { A: 2, B: 2 });
check("tally fractional lead", teamTally([
  { teams: ["A"], points: 0.5 },
  { teams: ["A"], points: 1 },
  { teams: ["B"], points: 1 },
]), { A: 1.5, B: 1 });
// same-team tie does not double: teams:["A"] once even if 2 players tied
check("tally same-team once", teamTally([{ teams: ["A"], points: 1 }]), { A: 1 });

// --- fmtPt ---
check("fmt 0", fmtPt(0), "0");
check("fmt half", fmtPt(0.5), "\u00bd");
check("fmt one", fmtPt(1), "1");
check("fmt 1.5", fmtPt(1.5), "1\u00bd");
check("fmt 2", fmtPt(2), "2");

// --- legPoints ---
const cfg: LegConfig = { scheme: "sixes", metric: "pts", points: { "1\u20136": 0.5, "Total": 1 } };
check("legPoints set", legPoints(cfg, { k: "1\u20136", from: 0, to: 6 }), 0.5);
check("legPoints unset -> 0", legPoints(cfg, { k: "7\u201312", from: 6, to: 12 }), 0);
check("legPoints default cfg", legPoints(DEFAULT_LEG_CONFIG, { k: "Total", from: 0, to: 18, tot: true }), 0);

console.log(`legs: PASS ${pass}  FAIL ${fail}`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
