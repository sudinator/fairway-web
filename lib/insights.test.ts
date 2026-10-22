// 212.18 — Insights and Your courses: messy rounds, known answers, the window, the course record.
import { ok, report } from "./screen-harness";
import { computeInsights, isInsightRound, INSIGHT_MIN_ROUNDS } from "./insights";
import { yourCourses } from "./your-courses";
import { messyRounds, round, PARS, SIS } from "./test-fixtures/messy-rounds";

// messy rounds: exactly the right ones count, and nothing throws
const messy = messyRounds();
for (const m of messy) ok(isInsightRound(m.round) === m.counts, `${m.note}: ${m.counts ? "counts" : "doesn't count"}`);
const mi = computeInsights(messy.map((m) => m.round));
ok(mi.roundsUsed === messy.filter((m) => m.counts).length && mi.ready, `messy: ${mi.roundsUsed} rounds used, ready`);
ok(mi.byDifficulty.every((b) => b.avgToPar == null || Number.isFinite(b.avgToPar)) && Number.isFinite(mi.overall!), "messy: every figure is a real number");
ok(mi.byDifficulty[0].holes < mi.byPar.reduce((n, b) => n + b.holes, 0), "holes without a stroke index are left out of the difficulty split only");

// fewer than 5 rounds: nothing
const few = computeInsights([0, 1, 2, 3].map((k) => round(`f${k}`, `2026-09-0${k + 1}`, PARS.map((p) => p + 1))));
ok(!few.ready && few.findings.length === 0 && INSIGHT_MIN_ROUNDS === 5, "4 rounds: not ready, no findings");

// a constructed season with known answers: par on every hole except the six hardest (SI 1–6), double bogey there;
// three-putts on two holes a round; course handicap 14
const season = Array.from({ length: 8 }, (_, k) => round(`s${k}`, `2026-08-${String(10 + k).padStart(2, "0")}`,
  PARS.map((p, i) => (SIS[i] <= 6 ? p + 2 : p)), {}, (i) => ({ putts: i < 2 ? 3 : 2 })));
const si = computeInsights(season);
const hard = si.byDifficulty[0];
ok(hard.avgToPar === 2 && si.byDifficulty[1].avgToPar === 0 && si.byDifficulty[2].avgToPar === 0, `hardest six: +2.0 a hole; the rest par (got ${hard.avgToPar})`);
ok(Math.abs(si.overall! - 12 / 18) < 1e-9, "overall: +12 over 18 holes");
// against expectation. The course handicap comes from the ONE rule (chBasis): index 12 × slope 128 / 113 + (71.2 − 72)
// = 12.79 → 13 (the stored 14 isn't manual, so it's re-derived). +12 a round spread over 13 stroke holes = 12/13 a hole
// on SI 1–13 → hardest six +2 − 12/13 = +1.08, middle six −12/13; the expectations add up to the score, average 0.
ok(Math.abs(si.byDifficulty[0].netAvg! - 14 / 13) < 1e-9 && Math.abs(si.byDifficulty[1].netAvg! + 12 / 13) < 1e-9 && Math.abs(si.overallNet!) < 1e-9, `v expected: hardest +1.08, middle −0.92, average 0 (got ${si.byDifficulty[0].netAvg}, ${si.byDifficulty[1].netAvg}, ${si.overallNet})`);
const leak = si.findings.find((f) => f.key === "leak")!, strength = si.findings.find((f) => f.key === "strength")!;
ok(leak.title === "The six hardest holes cost you most" && leak.detail === "1.1 a hole more than your game predicts · about 6.5 shots a round", `the leak, v expected (got ${leak.title} / ${leak.detail})`);
ok(strength.title === "The middle six are your strength" && strength.detail.includes("about 5.5 shots a round"), `the strength (got ${strength.title} / ${strength.detail})`);
ok(Math.abs((si.blowUpCost ?? 0) - 6) < 1e-9 && si.findings.some((f) => f.title === "Blow-up holes" && f.detail === "double bogey or worse costs you 6.0 shots a round beyond bogey"), `blow-ups: 6 doubles × 1 shot beyond bogey = 6.0 (got ${si.blowUpCost})`);
ok(si.threePutts === 2 && si.findings.some((f) => f.title === "Three-putts" && f.detail === "2.0 a round"), "three-putts: 2.0 a round");
ok(si.withinHandicap?.rounds === 8 && si.withinHandicap.within === 8, "84 gross − 14 handicap − 72 par = −2: within 3 every round");
const quiet = computeInsights(Array.from({ length: 6 }, (_, k) => round(`q${k}`, `2026-07-0${k + 1}`, PARS.map((p) => p))));
ok(!quiet.findings.some((f) => f.key === "leak" || f.key === "strength" || f.key === "blowups"), "an even card all season: no leak, no strength, no blow-ups invented");

// the window: 25 rounds → the latest 20
const many = Array.from({ length: 25 }, (_, k) => round(`w${k}`, `2026-${String(1 + Math.floor(k / 3)).padStart(2, "0")}-${String(1 + (k % 3) * 9).padStart(2, "0")}`, PARS.map((p) => p + (k < 5 ? 3 : 0))));
const wi = computeInsights(many);
ok(wi.roundsUsed === 20 && wi.overall === 0, `25 rounds: the latest 20 used (the five oldest +3s left out; overall ${wi.overall})`);

// Your courses
const yc = yourCourses([
  ...season.slice(0, 3),
  round("nine-oak", "2026-08-30", PARS.slice(0, 9).map((p) => p), { course: " oak hollow " }),
  round("elm1", "2026-06-01", PARS.map((p) => p + 1), { course: "Elm Ridge" }),
  round("draftc", "2026-06-02", PARS.map((p) => p), { course: "Elm Ridge", status: "draft" }),
]);
const oak = yc.find((c) => c.key === "oak hollow")!;
ok(yc.length === 2 && oak.rounds === 4, `spellings grouped; the draft left out (got ${yc.map((c) => `${c.course}:${c.rounds}`)})`);
ok(oak.bestGross === 84 && oak.full18 === 3, "best gross from complete 18-hole rounds only (the 9-hole round isn't a best)");
ok(oak.nemesis != null && SIS[oak.nemesis.hole - 1] <= 6 && oak.nemesis.avgToPar > 1.4 && oak.best != null && oak.best.avgToPar === 0, `nemesis among the hardest holes; best hole at par (got ${JSON.stringify(oak.nemesis)})`);
ok(yc[0].key === "oak hollow", "most-played course first");
// no handicap: no net findings invented — the gross figures still show
const noHcp = computeInsights(season.map((r) => ({ ...r, course_handicap: null, handicap_index: null })));   // neither a course handicap nor an index
ok(noHcp.overallNet == null && !noHcp.findings.some((f) => f.key === "leak" || f.key === "strength") && noHcp.byDifficulty[0].avgToPar === 2, "without a handicap: gross figures, no after-handicap findings");
// a MANUAL course handicap is used as entered (0153): 14 stroke holes → hardest six 2 − 12/14 = +1.14
const manual = computeInsights(season.map((r) => ({ ...r, course_handicap_source: "manual" as const })));
ok(Math.abs(manual.byDifficulty[0].netAvg! - 8 / 7) < 1e-9, `a manual course handicap (14) is used as entered (got ${manual.byDifficulty[0].netAvg})`);
report("insights");
