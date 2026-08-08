import { segOf, segLeadersFrom, SEG_LABELS } from "./segments";
import type { Game, Player } from "./game-types";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) { const g = JSON.stringify(got), w = JSON.stringify(want); if (g === w) pass++; else { fail++; fails.push(`${name} (got ${g}, want ${w})`); } }

const holes18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
function mkGame(over: Partial<Game> = {}): Game {
  const hm = over.holes_meta ?? holes18;
  return { id: "g", code: "A", name: "T", course: "C", course_par: hm.reduce((s, m) => s + m.par, 0), holes_meta: hm, game_type: "stableford", pairings: [], allowance_pct: 100, created_by: "u", created_at: "x", ...over } as Game;
}
function mkP(name: string, scores: (number | null)[], over: Partial<Player> = {}): Player {
  return { id: name, game_id: "g", user_id: name, display_name: name, handicap_index: null, rating: null, slope: null, tee_name: "W", course_handicap: 0, scores, putts: [], fairways: [], ...over } as Player;
}
const f6 = (v: number) => [v, v, v, v, v, v] as (number | null)[];

// segOf
eq("segOf stableford pars", segOf(mkP("A", f6(4)), mkGame()), [12, 0, 0]);
eq("segOf stableford birdies", segOf(mkP("A", f6(3)), mkGame()), [18, 0, 0]);
eq("segOf stroke gross ch0", segOf(mkP("A", f6(4)), mkGame({ game_type: "stroke" })), [24, 0, 0]);
eq("segOf stroke recv ch6", segOf(mkP("A", f6(4), { course_handicap: 6 }), mkGame({ game_type: "stroke" })), [18, 0, 0]);
eq("SEG_LABELS length", SEG_LABELS.length, 3);

// segLeadersFrom — stableford, one leader
{
  const g = mkGame(); const A = mkP("A", f6(4)), B = mkP("B", f6(3));
  const r = segLeadersFrom([{ p: A, seg: segOf(A, g) }, { p: B, seg: segOf(B, g) }], g);
  eq("stbl seg0 winner", r[0].who, ["B"]);
  eq("stbl seg0 val", r[0].val, 18);
  eq("stbl seg0 complete", r[0].complete, true);
  eq("stbl seg1 not started", r[1].started, false);
  eq("stbl seg1 val null", r[1].val, null);
}
// tie
{
  const g = mkGame(); const A = mkP("A", f6(4)), C = mkP("C", f6(4));
  const r = segLeadersFrom([{ p: A, seg: segOf(A, g) }, { p: C, seg: segOf(C, g) }], g);
  eq("tie seg0 both", r[0].who, ["A", "C"]);
  eq("tie seg0 val", r[0].val, 12);
}
// stroke — lowest net leads
{
  const g = mkGame({ game_type: "stroke" }); const A = mkP("A", f6(4)), B = mkP("B", f6(3));
  const r = segLeadersFrom([{ p: A, seg: segOf(A, g) }, { p: B, seg: segOf(B, g) }], g);
  eq("stroke seg0 winner", r[0].who, ["B"]);
  eq("stroke seg0 val", r[0].val, 18);
}
// partial segment
{
  const g = mkGame(); const A = mkP("A", [4, 4, 4, null, null, null]);
  const r = segLeadersFrom([{ p: A, seg: segOf(A, g) }], g);
  eq("partial started", r[0].started, true);
  eq("partial not complete", r[0].complete, false);
  eq("partial val", r[0].val, 6);
  eq("partial leaderThru", r[0].leaderThru, 3);
  eq("partial maxPlayed", r[0].maxPlayed, 3);
}
// empty
eq("empty rows -> none started", segLeadersFrom([], mkGame()).map((x) => x.started), [false, false, false]);

console.log(`segments: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
