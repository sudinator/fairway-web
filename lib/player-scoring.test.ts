import {
  playerHoles, playerPoints, playerThru, playerGross, playerNet, relToParStr, parThru, leaderName,
  ouVal, strokeTotal, rankVal, sortLeaderboard, posWithin, tiedWithin,
} from "./player-scoring";
import type { Game, Player } from "./game-types";

let pass = 0, fail = 0; const fails: string[] = [];
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; fails.push(`${name}  (got ${g}, want ${w})`); }
}

const holes18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
function mkGame(over: Partial<Game> = {}): Game {
  const holes_meta = over.holes_meta ?? holes18;
  return {
    id: "g1", code: "AAA", name: "T", course: "C",
    course_par: holes_meta.reduce((s, m) => s + m.par, 0),
    holes_meta, game_type: "stableford", pairings: [],
    allowance_pct: 100, created_by: "u", created_at: "2026-01-01T00:00:00Z", ...over,
  } as Game;
}
// index/slope/rating null → chBasis returns course_handicap, so we control allocation directly.
function mkPlayer(scores: (number | null)[], over: Partial<Player> = {}): Player {
  return {
    id: "p1", game_id: "g1", user_id: "u1", display_name: "A",
    handicap_index: null, rating: null, slope: null, tee_name: "W",
    course_handicap: 0, scores, putts: [], fairways: [], ...over,
  } as Player;
}

// ---- playerHoles: guard, mapping, allocation, allowance ----
eq("holes: null game -> []", playerHoles(mkPlayer([4]), null), []);
{
  const hs = playerHoles(mkPlayer([4, 3, null], { course_handicap: 0 }), mkGame());
  eq("holes: length 18", hs.length, 18);
  eq("holes: hole1 strokes", hs[0].strokes, 4);
  eq("holes: hole2 strokes", hs[1].strokes, 3);
  eq("holes: hole3 null", hs[2].strokes, null);
  eq("holes: par carried", hs[0].par, 4);
  eq("holes: ch0 -> all recv 0", hs.every((h) => h.recv === 0), true);
}
{
  const hs = playerHoles(mkPlayer([], { course_handicap: 2 }), mkGame());
  eq("holes: ch2 hole1 recv 1", hs[0].recv, 1);
  eq("holes: ch2 hole2 recv 1", hs[1].recv, 1);
  eq("holes: ch2 hole3 recv 0", hs[2].recv, 0);
}
{
  const hs = playerHoles(mkPlayer([], { course_handicap: 10 }), mkGame({ allowance_pct: 50 }));
  eq("holes: allowance50 -> 5 strokes", hs.filter((h) => h.recv === 1).length, 5);
  eq("holes: allowance50 hole5 recv 1", hs[4].recv, 1);
  eq("holes: allowance50 hole6 recv 0", hs[5].recv, 0);
}
{
  const hs = playerHoles(mkPlayer([], { course_handicap: 20 }), mkGame());
  eq("holes: ch20 hole1 recv 2", hs[0].recv, 2);
  eq("holes: ch20 hole2 recv 2", hs[1].recv, 2);
  eq("holes: ch20 hole3 recv 1", hs[2].recv, 1);
}

// ---- playerThru ----
eq("thru: empty", playerThru(mkPlayer([])), 0);
eq("thru: nulls/zeros ignored", playerThru(mkPlayer([4, null, 0, 5, null])), 2);
eq("thru: all", playerThru(mkPlayer([4, 4, 4])), 3);

// ---- playerGross ----
{
  const g = mkGame();
  eq("gross: partial", playerGross(mkPlayer([4, 3, 5], { course_handicap: 0 }), g), 12);
  eq("gross: nulls/zeros ignored", playerGross(mkPlayer([4, null, 0, 5], { course_handicap: 0 }), g), 9);
  eq("gross: none -> 0", playerGross(mkPlayer([], { course_handicap: 0 }), g), 0);
  eq("gross: null game -> 0", playerGross(mkPlayer([4, 4]), null), 0);
}

// ---- playerNet ----
{
  const g = mkGame();
  eq("net: ch0 == gross", playerNet(mkPlayer([4, 3, 5], { course_handicap: 0 }), g), 12);
  eq("net: ch2 two strokes on played", playerNet(mkPlayer([5, 5], { course_handicap: 2 }), g), 8);
  eq("net: stroke on unplayed hole not counted", playerNet(mkPlayer([null, null, 5], { course_handicap: 2 }), g), 5);
}

// ---- playerPoints (Stableford: par 2, birdie 3, bogey 1, double 0) ----
{
  const g = mkGame();
  eq("pts: par+birdie+bogey", playerPoints(mkPlayer([4, 3, 5], { course_handicap: 0 }), g), 6);
  eq("pts: double -> 0", playerPoints(mkPlayer([6], { course_handicap: 0 }), g), 0);
  eq("pts: bogey with a stroke = net par = 2", playerPoints(mkPlayer([5], { course_handicap: 1 }), g), 2);
  eq("pts: none -> 0", playerPoints(mkPlayer([], { course_handicap: 0 }), g), 0);
  eq("pts: eagle -> 4", playerPoints(mkPlayer([2], { course_handicap: 0 }), g), 4);
}

// ---- relToParStr ----
{
  const g = mkGame();
  eq("rel: even", relToParStr(mkPlayer([4], { course_handicap: 0 }), g), "E");
  eq("rel: under", relToParStr(mkPlayer([3], { course_handicap: 0 }), g), "-1");
  eq("rel: over", relToParStr(mkPlayer([6], { course_handicap: 0 }), g), "+2");
  eq("rel: none -> E", relToParStr(mkPlayer([], { course_handicap: 0 }), g), "E");
}

// ---- parThru (mixed pars, played holes only) ----
{
  const g = mkGame({ holes_meta: [{ n: 1, par: 4, si: 1 }, { n: 2, par: 3, si: 2 }, { n: 3, par: 5, si: 3 }] });
  eq("parThru: played only", parThru(mkPlayer([4, 3, null], { course_handicap: 0 }), g), 7);
  eq("parThru: none", parThru(mkPlayer([null, null, null]), g), 0);
  eq("parThru: all", parThru(mkPlayer([4, 3, 6], { course_handicap: 0 }), g), 12);
}

// ---- leaderName (every branch) ----
eq("name: short", leaderName("Bob"), "Bob");
eq("name: empty", leaderName(""), "");
eq("name: exactly 15", leaderName("Abcdefghijklmno"), "Abcdefghijklmno");
eq("name: long two-part -> First L", leaderName("Jonathan Livingston"), "Jonathan L");
eq("name: three parts -> First + last initial", leaderName("First Middle Lastname"), "First L");
eq("name: long single word sliced to 15", leaderName("Supercalifragilistic"), "Supercalifragil");
eq("name: trims whitespace", leaderName("  Bob  "), "Bob");

// ---- ranking: ouVal / strokeTotal / rankVal (reuse the scoring fns) ----
{
  const g = mkGame();
  eq("ouVal: thru0 -> Infinity", ouVal(mkPlayer([], { course_handicap: 0 }), g) === Infinity, true);
  eq("ouVal: par -> 0", ouVal(mkPlayer([4], { course_handicap: 0 }), g), 0);
  eq("ouVal: birdie -> -1", ouVal(mkPlayer([3], { course_handicap: 0 }), g), -1);
  eq("strokeTotal: gross basis", strokeTotal(mkPlayer([5, 5], { course_handicap: 2 }), mkGame({ stroke_basis: "gross" })), 10);
  eq("strokeTotal: net basis", strokeTotal(mkPlayer([5, 5], { course_handicap: 2 }), mkGame({ stroke_basis: "net" })), 8);
  eq("strokeTotal: default null -> net", strokeTotal(mkPlayer([5, 5], { course_handicap: 2 }), mkGame({ stroke_basis: null as unknown as "net" })), 8);
  eq("rankVal: stroke+gross -> gross total", rankVal(mkPlayer([5, 5], { course_handicap: 0 }), mkGame({ game_type: "stroke", stroke_basis: "gross" })), 10);
  eq("rankVal: stroke thru0 -> Infinity", rankVal(mkPlayer([], { course_handicap: 0 }), mkGame({ game_type: "stroke" })) === Infinity, true);
  eq("rankVal: stableford -> ouVal", rankVal(mkPlayer([4], { course_handicap: 0 }), mkGame({ game_type: "stableford" })), 0);
}

// ---- leaderboard ordering: sortLeaderboard / posWithin / tiedWithin ----
{
  const g = mkGame();
  const A = mkPlayer([4], { id: "A", display_name: "A" });          // par -> ou 0
  const B = mkPlayer([3], { id: "B", display_name: "B" });          // birdie -> ou -1
  const C = mkPlayer([5], { id: "C", display_name: "C" });          // bogey -> ou +1
  const N = mkPlayer([], { id: "N", display_name: "N" });           // not started -> Infinity
  const lb = sortLeaderboard([A, C, B, N], g);
  eq("sort: order B,A,C,N", lb.map((p) => p.id), ["B", "A", "C", "N"]);
  eq("sort: input not mutated", [A, C, B, N].map((p) => p.id), ["A", "C", "B", "N"]);
  eq("pos: B first", posWithin(B, [A, B, C], g), 1);
  eq("pos: C third", posWithin(C, [A, B, C], g), 3);
  eq("tie: A vs A2", tiedWithin(A, [A, mkPlayer([4], { id: "A2" }), B], g), true);
  eq("tie: B alone", tiedWithin(B, [A, B, C], g), false);
  // stableford tiebreaker: same ouVal (-1), different raw points — D (5 pts thru 2) before B (3 pts thru 1)
  const D = mkPlayer([3, 4], { id: "D" });                          // birdie+par: 5 pts, ou 4-5 = -1
  const lb2 = sortLeaderboard([B, D], g);
  eq("sort: stbl tiebreak by points", lb2.map((p) => p.id), ["D", "B"]);
  // stroke: no points tiebreak (order preserved among equals)
  const gs = mkGame({ game_type: "stroke" });
  const E = mkPlayer([4], { id: "E" }), F = mkPlayer([4], { id: "F" });
  eq("sort: stroke equal keeps order", sortLeaderboard([E, F], gs).map((p) => p.id), ["E", "F"]);
  // two not-started players: both Infinity (comparator NaN) — document stable order
  const N2 = mkPlayer([], { id: "N2" });
  eq("sort: two Infinity stable", sortLeaderboard([N, N2], g).map((p) => p.id), ["N", "N2"]);
}

console.log(`player-scoring: ${pass} passed, ${fail} failed`);
if (fail) { console.error(fails.join("\n")); process.exit(1); }
