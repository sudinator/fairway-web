// Unit tests for lib/game-shape.ts — run with `npm test`.
// Covers the full format matrix, adversarial stray/leftover structure, malformed
// inputs, and dotBasis<->scoring alignment against the real golf.ts functions.
import { shapeOf, dotStrokes, fullStrokes } from "./game-shape";
import type { ShapeGame, ShapePlayer, DotGame, GameShape } from "./game-shape";
import { applyAllowance, matchAllowance, matchStrokesFor, strokesReceived,
         computeSkins, computeHeadToHeadSkins } from "./golf";

const TA = [{ key: "A", name: "Team 1" }, { key: "B", name: "Team 2" }];
const FS = [{ id: "f1", name: "F1", a: ["p1", "p2"], b: ["p3", "p4"] }];
const G = (o: Partial<DotGame>): DotGame => ({ game_type: "stableford", course_par: 72, pairings: [], teams: null, foursomes: null, ...o });

let pass = 0, fail = 0; const fails: string[] = [];
const check = (name: string, got: any, exp: any) => {
  const a = JSON.stringify(got), b = JSON.stringify(exp);
  if (a === b) pass++; else { fail++; fails.push(`FAIL ${name}\n   got ${a}\n   exp ${b}`); }
};
const expectShape = (name: string, g: ShapeGame, exp: Partial<GameShape>) => {
  const s = shapeOf(g);
  for (const k of Object.keys(exp) as (keyof GameShape)[]) check(`${name}.${k}`, s[k], exp[k]);
};

// 1) Canonical matrix
expectShape("stableford", G({ game_type: "stableford" }), { skinsStyle: null, usesTeams: false, usesMatchups: false, usesFoursomes: false, dotBasis: "absolute", view: "stableford" });
expectShape("stroke", G({ game_type: "stroke" }), { skinsStyle: null, usesTeams: false, usesMatchups: false, usesFoursomes: false, dotBasis: "absolute", view: "stroke" });
expectShape("match.singles", G({ game_type: "match", pairings: [{ a: "p1", b: "p2" }] }), { usesTeams: false, usesMatchups: true, usesFoursomes: false, dotBasis: "relative_pair", view: "match" });
expectShape("match.team", G({ game_type: "match", teams: TA, pairings: [{ a: "p1", b: "p2" }] }), { usesTeams: true, usesMatchups: true, usesFoursomes: false, dotBasis: "relative_pair", view: "match" });
expectShape("fourball.plain", G({ game_type: "fourball", foursomes: FS }), { usesTeams: false, usesMatchups: true, usesFoursomes: true, dotBasis: "relative_foursome", view: "fourball" });
expectShape("fourball.team", G({ game_type: "fourball", teams: TA, foursomes: FS }), { usesTeams: true, usesMatchups: true, usesFoursomes: true, dotBasis: "relative_foursome", view: "fourball" });
expectShape("trifecta", G({ game_type: "trifecta", teams: TA, foursomes: FS }), { usesTeams: true, usesMatchups: true, usesFoursomes: true, dotBasis: "relative_foursome", view: "trifecta" });
expectShape("skins.individual", G({ game_type: "skins" }), { skinsStyle: "individual", usesTeams: false, usesMatchups: false, usesFoursomes: false, dotBasis: "absolute", view: "skins_individual" });
expectShape("skins.team_11", G({ game_type: "skins", teams: TA, pairings: [{ a: "p1", b: "p2" }] }), { skinsStyle: "team_11", usesTeams: true, usesMatchups: true, usesFoursomes: false, dotBasis: "relative_pair", view: "skins_team_11" });
expectShape("skins.team_2v2", G({ game_type: "skins", teams: TA, foursomes: FS }), { skinsStyle: "team_2v2", usesTeams: true, usesMatchups: true, usesFoursomes: true, dotBasis: "relative_foursome", view: "skins_team_2v2" });

// 2) Adversarial — stray/leftover structure must NOT change the mode
expectShape("ADV skins.indiv + stray pairings", G({ game_type: "skins", pairings: [{ a: "p1", b: "p2" }] }), { skinsStyle: "individual", usesMatchups: false, view: "skins_individual" });
expectShape("ADV skins.indiv + stray foursomes(null teams)", G({ game_type: "skins", foursomes: FS }), { skinsStyle: "individual", usesFoursomes: false, view: "skins_individual" });
expectShape("ADV stableford + stray teams+foursomes", G({ game_type: "stableford", teams: TA, foursomes: FS }), { usesTeams: false, usesMatchups: false, usesFoursomes: false, view: "stableford" });
expectShape("ADV stroke + stray pairings", G({ game_type: "stroke", pairings: [{ a: "p1", b: "p2" }] }), { usesMatchups: false, view: "stroke" });
expectShape("ADV match.singles + stray foursomes", G({ game_type: "match", pairings: [{ a: "p1", b: "p2" }], foursomes: FS }), { usesTeams: false, usesFoursomes: false, view: "match" });

// 3) Malformed team arrays
expectShape("MAL teams length 1 (skins)", G({ game_type: "skins", teams: [{ key: "A", name: "x" }] }), { skinsStyle: "individual", usesTeams: false });
expectShape("MAL teams length 3 (match)", G({ game_type: "match", teams: [{ key: "A", name: "x" }, { key: "B", name: "y" }, { key: "C", name: "z" }], pairings: [{ a: "p1", b: "p2" }] }), { usesTeams: false, view: "match" });
expectShape("MAL foursomes=[] (skins+teams) => team_2v2", G({ game_type: "skins", teams: TA, foursomes: [] }), { skinsStyle: "team_2v2", usesFoursomes: true });

// 4) dotBasis <-> scoring alignment
const par4si1 = [{ n: 1, par: 4, si: 1 }];
const mk = (id: string, ch: number): ShapePlayer => ({ id, user_id: id, course_handicap: ch });
{ // 4a individual skins -> absolute
  const A = mk("A", 18), B = mk("B", 0);
  const dotA = dotStrokes(G({ game_type: "skins" }), A, 1, [A, B]);
  check("4a indiv dot==absolute", dotA, strokesReceived(1, applyAllowance(18, 100)));
  const r = computeSkins(par4si1 as any, [{ id: "A", name: "A", gross: [5], ch: 18 }, { id: "B", name: "B", gross: [5], ch: 0 }], 100, "carryover");
  check("4a indiv scoring winner=A", r.skinsByPlayer["A"] >= 1 && r.skinsByPlayer["B"] === 0, true);
  check("4a indiv dot==net swing", 5 - dotA, 4);
}
{ // 4b 1:1 team skins -> relative_pair (the 1.61.0 fix)
  const A = mk("A", 10), B = mk("B", 4); (A as any).team = "A"; (B as any).team = "B";
  const g = G({ game_type: "skins", teams: TA, pairings: [{ a: "A", b: "B" }] });
  const dotA = dotStrokes(g, A, 1, [A, B]);
  const allow = matchAllowance(10, 4, 100);
  check("4b 1:1 dot==relative_pair", dotA, matchStrokesFor(allow.a, 1));
  const r = computeHeadToHeadSkins(par4si1 as any, { id: "A", name: "A", gross: [5], ch: 10 }, { id: "B", name: "B", gross: [5], ch: 4 }, 100);
  check("4b 1:1 scoring winner=A (dot drives it)", r.skinsBySide["A"] >= 1, true);
  check("4b 1:1 dot is the SWING stroke (not absolute 0)", dotA, matchStrokesFor(allow.a, 1));
}
{ // 4c 2v2 best-ball skins -> relative_foursome
  const A = mk("A", 12), B = mk("B", 12), C = mk("C", 4), D = mk("D", 4);
  const fs = [{ id: "f1", name: "F1", a: ["A", "B"], b: ["C", "D"] }];
  const g = G({ game_type: "skins", teams: TA, foursomes: fs });
  const dotA = dotStrokes(g, A, 1, [A, B, C, D]);
  const low = Math.min(applyAllowance(12, 100), applyAllowance(4, 100));
  check("4c 2v2 dot==relative_foursome", dotA, matchStrokesFor(Math.max(0, applyAllowance(12, 100) - low), 1));
}

{ // fullStrokes: individual side game uses FULL playing handicap, ignoring the match-relative basis
  const A = mk("A", 14), B = mk("B", 14), C = mk("C", 4), D = mk("D", 4);
  const fs = [{ id: "f1", name: "F1", a: ["A", "B"], b: ["C", "D"] }];
  const g = G({ game_type: "trifecta", teams: TA, foursomes: fs });
  const dotA = dotStrokes(g, A, 12, [A, B, C, D]);   // relative_foursome: 14 - low(4) = 10 -> si12 gets 0
  const fullA = fullStrokes(g, A, 12);               // full playing handicap: 14 -> si12 gets 1
  check("fullStrokes == full playing hcp", fullA, strokesReceived(12, applyAllowance(14, 100)));
  check("fullStrokes ignores relative subtraction (si12: 1 vs 0)", fullA > dotA, true);
}

console.log(`\n=== game-shape.test ===\nPASS ${pass}  FAIL ${fail}`);
if (fails.length) { console.log("\n" + fails.join("\n\n")); process.exit(1); }
console.log("All assertions passed.");
