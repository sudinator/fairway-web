// DIFFERENTIAL — extracted finish-gaps vs the verbatim baseline (pre-extraction code). Structured
// cases + fuzz; asserts OLD(input) === NEW(input) everywhere. 0 mismatches required.
import * as OLD from "./finish-gaps.baseline";
import * as NEW from "./finish-gaps";
import type { Player, Game } from "./game-types";

let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(label: string, a: unknown, b: unknown, ctx: string) {
  comparisons++; const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb && details.length < 20) { mismatches++; details.push(`${label}: OLD=${ja} NEW=${jb} @ ${ctx}`); }
  else if (ja !== jb) mismatches++;
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(987654);
const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const FWS = ["hit", "miss", "left", "right", null] as const;

function genMeta(): Game["holes_meta"] { const n = [3, 6, 9, 18][ri(0, 3)]; return Array.from({ length: n }, (_, i) => ({ n: i + 1, par: [3, 4, 4, 5][ri(0, 3)], si: i + 1 })); }
function genPlayer(n: number): Player {
  const arr = <T,>(f: () => T) => Array.from({ length: ri(0, n) }, f);
  return {
    id: "p", game_id: "g", user_id: "u", display_name: "N" + ri(0, 9), no_show: R() < 0.1,
    handicap_index: null, rating: null, slope: null, tee_name: "W", course_handicap: 0,
    scores: arr(() => { const r = ri(0, 3); return r === 0 ? null : r === 1 ? 0 : ri(1, 9); }),
    putts: arr(() => (R() < 0.4 ? null : ri(1, 4))),
    fairways: arr(() => FWS[ri(0, FWS.length - 1)]),
  } as Player;
}

// fuzz: 5000 random (scope, course) combos
for (let i = 0; i < 5000; i++) {
  const meta = genMeta();
  const scope = Array.from({ length: ri(0, 4) }, () => genPlayer(meta.length));
  same("computeFinishGaps", OLD.computeFinishGaps(scope, meta), NEW.computeFinishGaps(scope, meta), `fuzz#${i}`);
  if (R() < 0.1) same("computeFinishGaps(emptyMeta)", OLD.computeFinishGaps(scope, [] as Game["holes_meta"]), NEW.computeFinishGaps(scope, [] as Game["holes_meta"]), `fuzz#${i} empty`);
}
// finishListFmt fuzz
for (let i = 0; i < 2000; i++) { const a = Array.from({ length: ri(0, 20) }, () => ri(1, 18)); same("finishListFmt", OLD.finishListFmt(a), NEW.finishListFmt(a), `list#${i}`); }

console.log(`finish-gaps DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
