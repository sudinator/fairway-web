// DIFFERENTIAL — lib/game-utils vs verbatim baseline. makeCode compared under a STUBBED
// deterministic Math.random (same stream to both, outputs must match exactly); todayLocalStr
// re-tried across a midnight rollover; the rest fuzzed. 0 mismatches required.
import * as OLD from "./game-utils.baseline";
import * as NEW from "./game-utils";
import type { Game, Player } from "./game-types";

let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(label: string, a: unknown, b: unknown, ctx: string) {
  comparisons++; const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { mismatches++; if (details.length < 20) details.push(`${label}: OLD=${ja} NEW=${jb} @ ${ctx}`); }
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(20260807); const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));

// makeCode under a deterministic Math.random: identical streams -> identical codes
{
  const orig = Math.random;
  for (let i = 0; i < 2000; i++) {
    const v = R();
    Math.random = () => v; const a = OLD.makeCode();
    Math.random = () => v; const b = NEW.makeCode();
    same("makeCode", a, b, `r=${v}`);
  }
  Math.random = orig;
}

// todayLocalStr — call both; on the (rare) date rollover between calls, retry once
{
  let a = OLD.todayLocalStr(), b = NEW.todayLocalStr();
  if (a !== b) { a = OLD.todayLocalStr(); b = NEW.todayLocalStr(); }
  same("todayLocalStr", a, b, "now");
}

// defaultTeeIdx fuzz — random tee arrays incl. member-named, missing yardages, junk values
const NAMES = ["Blue", "White", "Member", "member tees", "Tips", "Gold", "", null];
for (let i = 0; i < 3000; i++) {
  const n = ri(0, 5);
  const tees = Array.from({ length: n }, () => {
    const withY = R() < 0.7;
    return { name: NAMES[ri(0, NAMES.length - 1)], yardages: withY ? Array.from({ length: ri(0, 18) }, () => (R() < 0.15 ? null : ri(120, 520))) : undefined };
  });
  const smart = R() < 0.7;
  same("defaultTeeIdx", OLD.defaultTeeIdx(tees as any, smart), NEW.defaultTeeIdx(tees as any, smart), `fuzz#${i}`);
}

// normalizeFavoriteCourse fuzz — rows/bare, holes present/absent, tees with/without holes
for (let i = 0; i < 3000; i++) {
  const tee = () => ({ name: "T" + ri(0, 3), rating: R() < 0.8 ? 68 + R() * 8 : undefined, slope: ri(100, 150), par: 72, yardages: [ri(300, 500)], holes: R() < 0.5 ? [{ n: 1, par: 4 }] : undefined, extra: "drop-me" });
  const course: any = { name: "C" + i, holes: R() < 0.4 ? [{ n: 9 }] : (R() < 0.5 ? [] : undefined), tees: R() < 0.8 ? Array.from({ length: ri(0, 3) }, tee) : undefined };
  const row = R() < 0.5 ? { data: course } : course;
  same("normalizeFavoriteCourse", OLD.normalizeFavoriteCourse(row), NEW.normalizeFavoriteCourse(row), `fuzz#${i}`);
}
same("normalize null", OLD.normalizeFavoriteCourse(null), NEW.normalizeFavoriteCourse(null), "null");

// refTee / blankCard fuzz
function genP(): Player { const has = R() < 0.5; return { id: "p", game_id: "g", user_id: "u", display_name: "A", handicap_index: null, rating: has ? 68 + R() * 8 : null, slope: has ? ri(100, 150) : null, tee_name: has ? "T" : (R() < 0.3 ? "X" : null), course_handicap: 0, scores: [], putts: [], fairways: [] } as Player; }
for (let i = 0; i < 2000; i++) {
  const ps = Array.from({ length: ri(0, 5) }, genP);
  same("refTee", OLD.refTee(ps), NEW.refTee(ps), `fuzz#${i}`);
  const g = R() < 0.2 ? null : ({ holes_meta: Array.from({ length: [9, 18][ri(0, 1)] }, (_, k) => ({ n: k + 1, par: 4, si: k + 1 })) } as Game);
  same("blankCard", OLD.blankCard(g), NEW.blankCard(g), `fuzz#${i}`);
}
same("GP_STATE_DEFAULTS", OLD.GP_STATE_DEFAULTS, NEW.GP_STATE_DEFAULTS, "const");

console.log(`game-utils DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
