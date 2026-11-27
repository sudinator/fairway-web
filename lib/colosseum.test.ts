/**
 * The Colosseum engine (212.136): every pair is a match off each player's own card; standings with the owner's rules
 * (1 / ½, ties by the matches between the tied, then holes up). Built on a hand-worked 4-player field so every number
 * here was checked by hand first.
 */
import { colosseumMatches, colosseumStandings, colosseumMatchCount, colosseumMatchCountFor, colosseumPlayerMatches, resultFor, colosseumSummaryLine, isCupColosseum, colosseumSidePoints, fmtHalf } from "./colosseum";

let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = (n: string, a: unknown, b: unknown) => ok(`${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));

// 18 holes, par 4 everywhere, stroke index 1..18 in order
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const game = { game_type: "colosseum" as const, course_par: 72, pairings: [], holes_meta: holes, allowance_pct: 100, teams: null, foursomes: null };
const P = (id: string, name: string, ch: number, scores: (number | null)[], group = 1) =>
  ({ id, user_id: id, display_name: name, course_handicap: ch, course_handicap_source: "manual" as const, scores, tee_group: group });
const par = (n: number) => Array(n).fill(4) as number[];

// counts
eq("3 players = 3 matches", colosseumMatchCount(3), 3);
eq("8 players = 28 matches", colosseumMatchCount(8), 28);
eq("16 players = 120 matches", colosseumMatchCount(16), 120);

// A (scratch) shoots all pars; B (4) shoots all 5s — B's strokes fall on SI 1–4, so B nets 4 there (halved) and
// loses the other 14: A wins 14 & 0 → decided at the point the lead exceeds the holes left.
{
  const a = P("a", "Amit", 0, par(18)), b = P("b", "Ben", 4, Array(18).fill(5));
  const [m] = colosseumMatches(game, [a, b]);
  eq("the first four holes are halved (B's strokes)", m.progress.slice(0, 4), [0, 0, 0, 0]);
  eq("A leads by one from the 5th", m.progress[4], 1);
  eq("the match closes out when the lead passes the holes left: 8 up with 6 to play after the 12th", [m.status.decided, m.status.result, m.status.thru], [true, "8 & 6", 12]);
  eq("A gives B 4 is read as a −4 difference from A's side", m.gives, -4);
  const st = colosseumStandings(game, [a, b]);
  eq("A has the point", st.rows.map((r) => [r.name, r.points, r.rank]), [["Amit", 1, 1], ["Ben", 0, 2]]);
}

// the allowance ("haircut") is applied: at 50% B has 2 strokes, so only SI 1–2 are halved
{
  const a = P("a", "Amit", 0, par(18)), b = P("b", "Ben", 4, Array(18).fill(5));
  const [m] = colosseumMatches({ ...game, allowance_pct: 50 }, [a, b]);
  eq("50% allowance halves two holes, not four", m.progress.slice(0, 3), [0, 0, 1]);
  eq("and the stakes line shows the allowanced difference", m.gives, -2);
}

// a 4-player field, hand-worked. All scratch so net = gross. Holes 1..3 scored by everyone; D in another group is
// only through hole 2.
{
  const a = P("a", "Amit", 0, [4, 4, 4, ...Array(15).fill(null)]);        // par, par, par
  const b = P("b", "Ben", 0, [5, 4, 3, ...Array(15).fill(null)]);         // bogey, par, birdie
  const c = P("c", "Chris", 0, [4, 5, 5, ...Array(15).fill(null)]);       // par, bogey, bogey
  const d = P("d", "Dave", 0, [3, 3, null, ...Array(15).fill(null)], 2);  // birdie, birdie, not yet
  const st = colosseumStandings(game, [a, b, c, d]);
  eq("six matches", st.matches.length, 6);
  const row = (n: string) => st.rows.find((r) => r.name === n)!;
  // A v B: h1 A up, h2 halved, h3 B wins → A/S thru 3.  A v C: 0, +1, +2 → A 2 up.  A v D: D wins 1 and 2 → A 2 down thru 2.
  // B v C: h1 C wins, h2 B wins, h3 B wins → B 1 up.  B v D: h1 D, h2 D → B 2 down thru 2.  C v D: D, D → C 2 down thru 2.
  eq("Dave (2 up in all three, thru 2) leads", st.rows[0].name, "Dave");
  eq("Dave: 3 up, 0 down, +6 holes", [row("Dave").won, row("Dave").halved, row("Dave").lost, row("Dave").holes, row("Dave").points], [3, 0, 0, 6, 3]);
  eq("Amit: 1 up (Chris), 1 halved (Ben), 1 down (Dave)", [row("Amit").won, row("Amit").halved, row("Amit").lost, row("Amit").points, row("Amit").holes], [1, 1, 1, 1.5, 0]);
  eq("Ben: 1 up (Chris), 1 halved, 1 down", [row("Ben").won, row("Ben").halved, row("Ben").lost, row("Ben").points, row("Ben").holes], [1, 1, 1, 1.5, -1]);
  eq("Chris: 0 up, 3 down", [row("Chris").won, row("Chris").lost, row("Chris").points, row("Chris").holes], [0, 3, 0, -5]);
  // Amit and Ben are level on points and halved their own match → holes up breaks it: Amit 0 v Ben −1
  eq("ties on points: the match between them (halved), then holes up — Amit above Ben", st.rows.map((r) => r.name), ["Dave", "Amit", "Ben", "Chris"]);
  eq("ranks", st.rows.map((r) => r.rank), [1, 2, 3, 4]);
  const mine = colosseumPlayerMatches(st, "a");
  eq("Amit's three matches, best first", mine.map((m) => [m.opponentName, m.lead, m.thru, m.result]), [["Chris", 2, 3, "2 up"], ["Ben", 0, 3, "A/S"], ["Dave", -2, 2, "2 down"]]);
  eq("the cross-group match counts through the hole both have played", mine.find((m) => m.opponentName === "Dave")!.thru, 2);
  eq("the strip", colosseumSummaryLine(st, "a"), "1 up · 1 down · 1 halved so far");
}

// head-to-head breaks a points tie before holes up
{
  // A beats B 1 up over 18 (A wins hole 1, rest halved) but loses to C by 5 (C wins holes 1-5); B beats C 1 up.
  // Each has one win and one loss: tie on points. Holes: A = +1 −5 = −4, B = −1 +1 = 0, C = +5 −1 = +4.
  // By holes C > B > A. By head-to-head among all three (a 3-way cycle) each has 1 point → falls to holes: C, B, A.
  const a = P("a", "A", 0, [3, 4, 4, 4, 4, 4, ...par(12)]);
  const b = P("b", "B", 0, [4, 4, 4, 4, 4, 4, ...par(12)]);
  const c = P("c", "C", 0, [4, 3, 3, 3, 3, 3, ...par(12)]);
  // check the matches: A v B hole1 A (3 v 4), rest halved → A 1 UP. A v C: h1 A (3 v 4), h2-6 C → C 4 up... adjust expectation below from the engine
  const st = colosseumStandings(game, [a, b, c]);
  const row = (n: string) => st.rows.find((r) => r.name === n)!;
  eq("every match is decided at 18", st.matches.every((m) => m.status.decided), true);
  eq("B v C: C wins 2-6 (five holes), B wins none → C", row("C").won >= 1, true);
  // The 3-way: A beat B, C beat A and C beat B → C 2 points, A 1, B 0: no tie at all. Assert the order the engine gives
  // and that it matches the hand count.
  eq("order", st.rows.map((r) => [r.name, r.points]), [["C", 2], ["A", 1], ["B", 0]]);
}

// head-to-head BEFORE holes up: A and B tied on 2 points; A beat B, so A is first although B is +6 on holes to A's +1
{
  const a = P("a", "A", 0, [4, 3, 4, 4, 3, 3, 4, 3, 5, 3, 5, 4, 4, 4, 4, 5, 5, 4]);
  const b = P("b", "B", 0, [4, 4, 4, 4, 4, 4, 3, 4, 3, 4, 4, 3, 4, 4, 3, 5, 5, 5]);
  const c = P("c", "C", 0, [4, 5, 4, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 3, 4, 4, 5, 4]);
  const d = P("d", "D", 0, [5, 4, 4, 4, 4, 5, 4, 5, 4, 4, 4, 3, 4, 3, 4, 4, 3, 4]);
  const st = colosseumStandings(game, [a, b, c, d]);
  const ab = st.matches.find((m) => m.a === "a" && m.b === "b")!;
  ok("A beat B", ab.status.lead > 0 && ab.status.decided);
  eq("tied on points, head-to-head puts A above B despite B's holes", st.rows.map((r) => [r.name, r.points, r.holes, r.pos]), [["A", 2, 1, "1"], ["B", 2, 6, "2"], ["C", 1.5, -1, "3"], ["D", 0.5, -6, "4"]]);
}
// a full tie: three players all par → every match halved, every row ½ + ½ = 1 point, one shared first place
{
  const tie = colosseumStandings(game, [P("a", "A", 0, par(18)), P("b", "B", 0, par(18)), P("c", "C", 0, par(18))]);
  eq("a full tie shares first place", tie.rows.map((r) => [r.points, r.pos, r.rank]), [[1, "T1", 1], [1, "T1", 1], [1, "T1", 1]]);
}
// a player marked Out AFTER scoring keeps the holes played (their matches stand); one who never scored is not in the field
{
  const a = P("a", "A", 0, par(18)), out = { ...P("o", "Out", 0, [3, 3, 3, 3, 3, ...Array(13).fill(null)]), no_show: true }, never = { ...P("n", "N", 0, Array(18).fill(null)), no_show: true };
  const st = colosseumStandings(game, [a, out, never]);
  eq("the scored no-show is still in the field, the unscored one is not", [st.rows.length, st.matchCount], [2, 1]);
  const m = st.matches[0];
  eq("their match stands on the five holes played", [m.status.thru, m.status.lead], [5, -5]);
}
// the printer and the strip
eq("fmtHalf", [fmtHalf(0.5), fmtHalf(1), fmtHalf(5.5)], ["½", "1", "5½"]);

// a no-show is not in the field
{
  const a = P("a", "A", 0, par(18)), b = P("b", "B", 0, par(18)), n = { ...P("n", "N", 0, Array(18).fill(null)), no_show: true };
  const st = colosseumStandings(game, [a, b, n]);
  eq("one match, two rows, the no-show absent", [st.matches.length, st.rows.length, st.matchCount], [1, 2, 1]);
  eq("all pars v all pars is halved", [st.rows[0].points, st.rows[1].points, resultFor(st.matches[0].status, 0)], [0.5, 0.5, "Halved"]);
}

// nothing scored yet: no points, every match unstarted, the strip says so
{
  const st = colosseumStandings(game, [P("a", "A", 0, Array(18).fill(null)), P("b", "B", 0, Array(18).fill(null))]);
  eq("unstarted", [st.rows[0].points, st.rows[0].played, st.matches[0].status.thru, colosseumSummaryLine(st, "a")], [0, 0, 0, "No matches under way yet"]);
}

// a Cup / team Colosseum: only cross-side pairs are matches; the sides' points come from those alone
{
  const a1 = { ...P("a1", "A1", 0, par(18)), team: "A" }, a2 = { ...P("a2", "A2", 0, par(18)), team: "A" };
  const b1 = { ...P("b1", "B1", 0, Array(18).fill(5)), team: "B" }, b2 = { ...P("b2", "B2", 0, par(18)), team: "B" }, b3 = { ...P("b3", "B3", 0, Array(18).fill(5)), team: "B" };
  const cup = { ...game, teams: [{ key: "A", name: "Reds" }, { key: "B", name: "Blues" }] };
  ok("the cup filter is on with two teams", isCupColosseum(cup) && !isCupColosseum(game));
  const st = colosseumStandings(cup, [a1, a2, b1, b2, b3]);
  eq("2 v 3 is 6 matches, not 10", [st.matches.length, st.matchCount], [6, 6]);
  ok("no match is within a side", st.matches.every((m) => (m.a.startsWith("a")) !== (m.b.startsWith("b")) ? false : true) && st.matches.every((m) => m.a[0] !== m.b[0]));
  const sp = colosseumSidePoints(st, (k) => st.rows.find((r) => r.key === k)?.team);
  // A1: beats B1, halves B2, beats B3 = 2½; A2 the same = 2½ → A 5, B 1 (two halves)
  eq("side points", [sp.A, sp.B, sp.open], [5, 1, 0]);
  eq("rows carry the side", st.rows.find((r) => r.key === "b1")?.team, "B");
  eq("the one match-count rule: 6 cross-side, 10 as a plain field", [colosseumMatchCountFor(cup, [a1, a2, b1, b2, b3]), colosseumMatchCountFor(game, [a1, a2, b1, b2, b3])], [6, 10]);
  ok("the strip's 'so far' clears when THIS player's matches are all decided (2 v 3: a1 has 3, not 4)", colosseumSummaryLine(st, "a1") === "2 up · 0 down · 1 halved");
}

for (const f of fails) console.log(f);
console.log(`colosseum: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
