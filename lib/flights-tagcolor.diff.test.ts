// DIFFERENTIAL — extracted flightTagColor vs verbatim baseline. Pure key->color; exhaustive over the
// keyspace that matters plus fuzzed junk. 0 mismatches required.
import { flightTagColor as NEW } from "./flights";
import { flightTagColor as OLD } from "./flights-tagcolor.baseline";
let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(k: string) { comparisons++; if (OLD(k) !== NEW(k)) { mismatches++; if (details.length < 10) details.push(`${JSON.stringify(k)}: OLD=${OLD(k)} NEW=${NEW(k)}`); } }
for (const k of ["A", "B", "C", "D", "E", "", "a", "AA", "Z", "1", " ", "null"]) same(k);
function rng(s: number) { return () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(99); const chars = "ABCDEFabcdef0123 ";
for (let i = 0; i < 5000; i++) { let k = ""; const n = Math.floor(R() * 4); for (let j = 0; j < n; j++) k += chars[Math.floor(R() * chars.length)]; same(k); }
console.log(`flightTagColor DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
