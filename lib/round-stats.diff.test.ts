// DIFFERENTIAL — extracted roundStats vs verbatim baseline, fuzzed over hole arrays. 0 mismatches required.
import { roundStats as NEW } from "./round-stats";
import { roundStats as OLD } from "./round-stats.baseline";
import type { Hole } from "./golf";
let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(hs: Hole[], ctx: string) { comparisons++; const a = JSON.stringify(OLD(hs)), b = JSON.stringify(NEW(hs)); if (a !== b) { mismatches++; if (details.length < 10) details.push(`${ctx}: OLD=${a} NEW=${b}`); } }
function rng(s: number) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(7); const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));
const FW = ["hit", "miss", "left", "right", null] as const;
function h(): Hole { return { hole_number: 1, par: [3, 4, 5][ri(0, 2)], stroke_index: ri(1, 18), strokes: R() < 0.15 ? null : ri(1, 9), putts: R() < 0.2 ? null : ri(0, 4), fairway: FW[ri(0, 4)], penalties: 0 } as Hole; }
for (let i = 0; i < 6000; i++) { const n = ri(0, 18); same(Array.from({ length: n }, h), `fuzz#${i}`); }
console.log(`roundStats DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
