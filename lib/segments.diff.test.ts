// DIFFERENTIAL — extracted segments vs verbatim baseline. Fuzzed (player, game) sets; asserts
// segOf and segLeadersFrom are identical OLD vs NEW. 0 mismatches required.
import * as OLD from "./segments.baseline";
import * as NEW from "./segments";
import type { Game, Player } from "./game-types";

let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(label: string, a: unknown, b: unknown, ctx: string) {
  comparisons++; const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { mismatches++; if (details.length < 20) details.push(`${label}: OLD=${ja} NEW=${jb} @ ${ctx}`); }
}
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(424242); const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));

function genGame(): Game {
  const holes_meta = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: [3, 4, 4, 5][ri(0, 3)], si: i + 1 }));
  return { id: "g", code: "A", name: "T", course: "C", course_par: holes_meta.reduce((s, m) => s + m.par, 0), holes_meta, game_type: (["stableford", "stroke"] as const)[ri(0, 1)], stroke_basis: ([null, "gross", "net"] as const)[ri(0, 2)], pairings: [], allowance_pct: [90, 100, 100, 110][ri(0, 3)], created_by: "u", created_at: "x" } as Game;
}
function genPlayer(name: string): Player {
  const scores = Array.from({ length: 18 }, () => { const r = ri(0, 4); return r <= 1 ? null : ri(1, 9); });
  return { id: name, game_id: "g", user_id: name, display_name: name, handicap_index: null, rating: null, slope: null, tee_name: "W", course_handicap: ri(-4, 36), scores, putts: [], fairways: [] } as Player;
}

for (let i = 0; i < 4000; i++) {
  const g = genGame();
  const scope = Array.from({ length: ri(1, 4) }, (_, k) => genPlayer("P" + k));
  for (const p of scope) same("segOf", OLD.segOf(p, g), NEW.segOf(p, g), `fuzz#${i}`);
  const rows = scope.map((p) => ({ p, seg: NEW.segOf(p, g) }));
  same("segLeadersFrom", OLD.segLeadersFrom(rows, g), NEW.segLeadersFrom(rows, g), `fuzz#${i}`);
}

console.log(`segments DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
