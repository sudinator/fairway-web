/**
 * Manual course handicaps (0153).
 *
 * The organizer enters a player's COURSE HANDICAP for a game — from GHIN, the source of truth —
 * instead of it being derived from index/slope/rating. Rules decided with the organizer:
 *
 *   * used AS GIVEN: no re-derivation from index/slope/rating;
 *   * NOT halved on a nine — the number entered IS the nine-hole figure;
 *   * allowance STILL applies, because allowance belongs to the format, not the player;
 *   * feeds EVERY basis (match, team leg, side games, posting), not just the match.
 *
 * The nine-hole rule is the one worth guarding hardest: a halving error does not look like an
 * error. The match simply plays a stroke or two light and the result is plausible.
 */
import { chBasis, dotStrokes, fullStrokes, strokeSets } from "./game-shape";
import { applyAllowance, matchAllowance, matchStrokesFor } from "./golf";

let pass = 0, fail = 0; const fails: string[] = [];
const eq = <T,>(n: string, a: T, b: T) => {
  if (Object.is(a, b)) pass++; else { fail++; fails.push(`FAIL ${n}\n     expected ${String(b)}\n     actual   ${String(a)}`); }
};

const H18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, si: i + 1, par: 4 }));
const H9 = Array.from({ length: 9 }, (_, i) => ({ n: i + 1, si: i * 2 + 1, par: 4 }));

// Same player, two ways: derived from a real index, or entered manually.
const derived = { handicap_index: 14, slope: 137, rating: 72.9, course_handicap: 19, course_handicap_source: "derived" as const };
const manual = { handicap_index: 14, slope: 137, rating: 72.9, course_handicap: 12, course_handicap_source: "manual" as const };

// ── Used as given: the index/slope/rating chain is skipped entirely ──────────────────────────────
eq("manual value is used verbatim on 18", chBasis(manual, 70, 18), 12);
eq("derived ignores course_handicap when it can compute", Math.round(chBasis(derived, 70, 18) * 100) / 100, Math.round((14 * 137 / 113 + 72.9 - 70) * 100) / 100);
eq("manual short-circuits even though index/slope/rating are present", chBasis(manual, 70, 18) !== chBasis(derived, 70, 18), true);

// ── THE NINE-HOLE RULE: manual is NOT halved; derived IS ─────────────────────────────────────────
eq("manual on a NINE is used as entered, not halved", chBasis(manual, 70, 9), 12);
eq("derived on a nine is halved", chBasis(derived, 70, 9), chBasis(derived, 70, 18) / 2);
eq("FENCE manual on a nine is not half the entered figure", chBasis(manual, 70, 9) !== 6, true);
// Entered without a source marker, the old behaviour must be untouched.
const legacy = { handicap_index: null, slope: null, rating: null, course_handicap: 12 };
eq("no source marker still halves on a nine (unchanged)", chBasis(legacy, 70, 9), 6);
eq("no source marker unchanged on 18", chBasis(legacy, 70, 18), 12);

// ── Allowance still applies ──────────────────────────────────────────────────────────────────────
eq("manual is allowanced at 85%", applyAllowance(chBasis(manual, 70, 18), 85), applyAllowance(12, 85));
eq("manual on a nine is allowanced from the ENTERED figure", applyAllowance(chBasis(manual, 70, 9), 85), applyAllowance(12, 85));

// ── It feeds every basis, not just the match ─────────────────────────────────────────────────────
const P = (id: string, ch: number, src: "derived" | "manual", team: "A" | "B") =>
  ({ id, user_id: id, display_name: id, handicap_index: 14, slope: 137, rating: 72.9, course_handicap: ch, course_handicap_source: src, team, no_show: false }) as never;
const four = [P("a1", 12, "manual", "A"), P("a2", 20, "manual", "A"), P("b1", 6, "manual", "B"), P("b2", 24, "manual", "B")];
const fb = { game_type: "fourball", course_par: 70, allowance_pct: 85, team_score_mode: "best_ball", holes_meta: H18, pairings: [],
  teams: [{ key: "A" }, { key: "B" }], foursomes: [{ id: "f", name: "F", swap: false, a: ["a1", "a2"], b: ["b1", "b2"] }] } as never;
// Four-ball plays off the group's lowest: b1 at 6 after 85% is the low, so a2 at 20 receives the most.
eq("four-ball team basis uses the manual figures", dotStrokes(fb, four[1] as never, 1, four as never) > 0, true);
eq("the manual LOW plays scratch", dotStrokes(fb, four[2] as never, 1, four as never), 0);
eq("side-game / posting basis is the manual figure too", fullStrokes(fb, four[0] as never, 1), matchStrokesFor(applyAllowance(12, 85), 1, H18.map((h) => ({ hole_number: h.n, stroke_index: h.si }))));

// A singles match off manual figures: strokes are the difference, allowance applied first.
const m = { game_type: "match", course_par: 70, allowance_pct: 100, holes_meta: H9, teams: [],
  pairings: [{ a: "a1", b: "b1" }], foursomes: [] } as never;
const pair = matchAllowance(chBasis(manual, 70, 9), chBasis({ ...manual, course_handicap: 6 }, 70, 9), 100);
eq("singles: the higher manual figure receives the difference", pair.a, 6);
eq("singles: the lower manual figure plays scratch", pair.b, 0);
const sets = strokeSets(m, P("a1", 12, "manual", "A") as never, 1, [P("a1", 12, "manual", "A"), P("b1", 6, "manual", "B")] as never);
eq("stroke dots read the manual figure", sets.find((x) => x.key === "opponent")!.strokes, 1);
// 12 strokes over NINE holes is one per hole plus extras on the hardest three, so SI 1 gets two.
// That it is 2 and not 1 is itself the proof the manual figure was not halved to 6.
eq("course-handicap dots read the full manual figure", sets.find((x) => x.key === "course")!.strokes, 2);

console.log(`manual course handicap: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
