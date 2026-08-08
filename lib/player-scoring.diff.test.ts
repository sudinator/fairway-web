// DIFFERENTIAL TEST — proves the extracted lib/player-scoring produces byte-identical results to
// the pre-change inline logic (lib/player-scoring.baseline) across the structured edge cases AND a
// large deterministic fuzz. If OLD(input) !== NEW(input) anywhere, it reports the exact input and
// both outputs and fails. This is the standard verification for a behavior-preserving extraction.
import * as OLD from "./player-scoring.baseline";
import * as NEW from "./player-scoring";
import type { Game, Player } from "./game-types";

let comparisons = 0, mismatches = 0; const details: string[] = [];
function same(label: string, a: unknown, b: unknown, ctx: string) {
  comparisons++;
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) { mismatches++; if (details.length < 20) details.push(`${label}: OLD=${ja} NEW=${jb}  @ ${ctx}`); }
}

function compareAll(p: Player, game: Game | null, ctx: string) {
  same("playerHoles", OLD.playerHoles(p, game), NEW.playerHoles(p, game), ctx);
  same("playerPoints", OLD.playerPoints(p, game), NEW.playerPoints(p, game), ctx);
  same("playerThru", OLD.playerThru(p), NEW.playerThru(p), ctx);
  same("playerGross", OLD.playerGross(p, game), NEW.playerGross(p, game), ctx);
  same("playerNet", OLD.playerNet(p, game), NEW.playerNet(p, game), ctx);
  same("relToParStr", OLD.relToParStr(p, game), NEW.relToParStr(p, game), ctx);
  same("parThru", OLD.parThru(p, game), NEW.parThru(p, game), ctx);
  if (game) {
    same("ouVal", OLD.ouVal(p, game), NEW.ouVal(p, game), ctx);
    same("strokeTotal", OLD.strokeTotal(p, game), NEW.strokeTotal(p, game), ctx);
    same("rankVal", OLD.rankVal(p, game), NEW.rankVal(p, game), ctx);
  }
}

// deterministic PRNG (mulberry32) so runs are reproducible
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const R = rng(1234567);
const ri = (lo: number, hi: number) => lo + Math.floor(R() * (hi - lo + 1));

function genGame(): Game {
  const n = [9, 18, 18, 18][ri(0, 3)];
  const sis = Array.from({ length: n }, (_, i) => i + 1);
  for (let i = sis.length - 1; i > 0; i--) { const j = ri(0, i); [sis[i], sis[j]] = [sis[j], sis[i]]; } // shuffle SIs
  const holes_meta = Array.from({ length: n }, (_, i) => ({ n: i + 1, par: [3, 4, 4, 4, 5][ri(0, 4)], si: sis[i] }));
  const allowance = [50, 75, 90, 100, 100, 110][ri(0, 5)];
  return {
    id: "g", code: "AAA", name: "T", course: "C",
    course_par: holes_meta.reduce((s, m) => s + m.par, 0),
    holes_meta,
    game_type: (["stableford", "stroke", "match", "skins", "fourball"] as const)[ri(0, 4)],
    stroke_basis: ([null, "gross", "net"] as const)[ri(0, 2)],
    pairings: [], allowance_pct: allowance, created_by: "u", created_at: "2026-01-01T00:00:00Z",
  } as Game;
}
function genPlayer(n: number): Player {
  const scores: (number | null)[] = Array.from({ length: n }, () => { const r = ri(0, 3); return r === 0 ? null : r === 1 ? 0 : ri(1, 10); });
  // exercise BOTH chBasis branches: sometimes a raw course_handicap, sometimes index/slope/rating
  const useIndex = R() < 0.5;
  return {
    id: "p", game_id: "g", user_id: "u", display_name: "A",
    handicap_index: useIndex ? ri(-4, 40) + (R() < 0.5 ? 0.5 : 0) : null,
    rating: useIndex ? 68 + R() * 8 : null,
    slope: useIndex ? ri(105, 145) : null,
    tee_name: "W", course_handicap: ri(-6, 45),
    scores, putts: [], fairways: [],
  } as Player;
}

// ---- structured edge cases (the same paths the 45-assertion suite exercises) ----
const holes18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const G = (o: Partial<Game> = {}) => ({ id: "g", code: "A", name: "T", course: "C", course_par: (o.holes_meta ?? holes18).reduce((s, m) => s + m.par, 0), holes_meta: o.holes_meta ?? holes18, game_type: "stableford", pairings: [], allowance_pct: 100, created_by: "u", created_at: "x", ...o }) as Game;
const P = (scores: (number | null)[], o: Partial<Player> = {}) => ({ id: "p", game_id: "g", user_id: "u", display_name: "A", handicap_index: null, rating: null, slope: null, tee_name: "W", course_handicap: 0, scores, putts: [], fairways: [], ...o }) as Player;

compareAll(P([4]), null, "null game");
compareAll(P([4, 3, null], { course_handicap: 0 }), G(), "ch0 partial");
compareAll(P([], { course_handicap: 2 }), G(), "ch2 no scores");
compareAll(P([], { course_handicap: 10 }), G({ allowance_pct: 50 }), "ch10 allow50");
compareAll(P([], { course_handicap: 20 }), G(), "ch20");
compareAll(P([5, 5], { course_handicap: 2 }), G(), "ch2 played");
compareAll(P([null, null, 5], { course_handicap: 2 }), G(), "stroke on unplayed");
compareAll(P([4, 3, 5], { course_handicap: 0 }), G(), "par/birdie/bogey");
compareAll(P([6], { course_handicap: 0 }), G(), "double");
compareAll(P([2], { course_handicap: 0 }), G(), "eagle");
compareAll(P([5], { course_handicap: 1 }), G(), "net par via stroke");
compareAll(P([4, 3, null], { course_handicap: 0 }), G({ holes_meta: [{ n: 1, par: 4, si: 1 }, { n: 2, par: 3, si: 2 }, { n: 3, par: 5, si: 3 }] }), "mixed pars");
compareAll(P([]), G(), "empty scores");

// ---- fuzz: 4000 random (player, game) pairs ----
for (let i = 0; i < 4000; i++) {
  const g = genGame();
  compareAll(genPlayer(g.holes_meta.length), g, `fuzz#${i}`);
  if (R() < 0.05) compareAll(genPlayer(g.holes_meta.length), null, `fuzz#${i} null`);
}

// ---- leaderName fuzz (random strings incl. spaces / long / unicode-ish) ----
const chars = "abc DEF  ghijklmnopqrstuvwxyz-'.".split("");
for (let i = 0; i < 3000; i++) {
  const len = ri(0, 30);
  let s = ""; for (let k = 0; k < len; k++) s += chars[ri(0, chars.length - 1)];
  same("leaderName", OLD.leaderName(s), NEW.leaderName(s), `name "${s}"`);
}

console.log(`player-scoring DIFF (old vs new): ${comparisons} comparisons, ${mismatches} mismatches`);
if (mismatches) { console.error("DISCREPANCIES:\n" + details.join("\n")); process.exit(1); }
console.log("OLD and NEW are IDENTICAL across every path.");
