function eq(a: unknown, b: unknown, m: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(c: unknown, m: string) { if (!c) throw new Error(m); }
import { buildHighlights, rankTies, standoutsFrom } from "./game-highlights";
const H = (n: number) => Array.from({ length: n }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const pl = (id: string, name: string, scores: (number | null)[], ch = 0, extra: any = {}) => ({ id, user_id: id, display_name: name, scores, course_handicap: ch, no_show: false, ...extra });
const game = (holes = H(18)) => ({ id: "g", holes_meta: holes, course_par: holes.length * 4, game_type: "stroke" }) as any;
const fill = (n: number, v: number) => Array(n).fill(v);
// Golf-style ties.
eq(rankTies([{ s: 70 }, { s: 72 }, { s: 72 }, { s: 75 }], (x) => x.s, 3).map((r) => r.pos), ["1", "T2", "T2"], "T2 shared; 4th not shown");
eq(rankTies([{ s: 70 }, { s: 71 }, { s: 72 }, { s: 72 }], (x) => x.s, 3).map((r) => r.pos), ["1", "2", "T3", "T3"], "a tie at 3rd shows both");
// Net birdies with the app's allocation; eagles counted separately; eagles break ties.
{
  // CH 18 = one stroke per hole. A par (4) is a net birdie; a birdie (3) a net eagle.
  const a = pl("a", "Ann", [3, 4, 4, 5, ...fill(14, 6)], 18);   // net eagle, 2 net birdies
  const b = pl("b", "Bob", [4, 4, 4, ...fill(15, 6)], 18);      // 3 net birdies
  const h = buildHighlights(game(), [a, b] as any);
  eq(h.netBirdies.all.map((r) => [r.name, r.birdies, r.eagles]), [["Ann", 2, 1], ["Bob", 3, 0]], "3 under-par holes each; the eagle breaks the tie");
  eq(h.netBirdies.top.map((r) => r.pos), ["1", "2"], "not tied — the eagle separates them");
}
// Best net hole: best net, then best ACTUAL score, then the harder hole (owner's rule).
{
  const par = pl("p", "ParWithTwo", [4, ...fill(17, 7)], 36);                 // gross par on SI 1 with 2 strokes = net eagle
  const bird = pl("q", "BirdieWithOne", [7, 7, 7, 3, ...fill(14, 7)], 18);    // gross birdie on SI 4 with 1 stroke = net eagle
  const h = buildHighlights(game(), [par, bird] as any);
  eq([h.bestNetHole?.name, h.bestNetHole?.n], ["BirdieWithOne", 4], "a real birdie beats a par with two strokes, even on an easier hole");
}
// Field average with 2+ finishers (212.72, owner: the total shows whenever the nines do; it was 8+); front v back only on 18 holes.
{
  const seven = Array.from({ length: 7 }, (_, i) => pl(`s${i}`, `P${i}`, fill(18, 5)));
  eq(buildHighlights(game(), seven as any).fieldNet, 90, "7 players: field average (2+ finishers)");
  eq(buildHighlights(game(), seven.slice(0, 1) as any).fieldNet, null, "1 player: no field average");
  ok(buildHighlights(game(), [...seven, pl("s7", "P7", fill(18, 5))] as any).fieldNet === 90, "8 players: field average");
  eq(buildHighlights(game(H(9)), seven as any).frontBack, null, "nine holes: no front v back");
}
// Unfinished cards are not ranked.
{
  const h = buildHighlights(game(), [pl("a", "Done", fill(18, 4)), pl("b", "Quit", [...fill(9, 3), ...fill(9, null as any)])] as any);
  eq(h.topGross.map((r) => r.item.name), ["Done"], "an unfinished card is not in the top 3");
}
// Toughest / easiest by average against par (par matters, not the raw average).
{
  const holes = [{ n: 1, par: 3, si: 1 }, { n: 2, par: 5, si: 2 }];
  const h = buildHighlights(game(holes as any), [pl("a", "A", [5, 6]), pl("b", "B", [5, 6])] as any);
  eq([h.toughest?.n, h.easiest?.n], [1, 2], "a 5 on a par 3 is tougher than a 6 on a par 5");
}
// A net-eagle cluster is shown only when one hole stands out (3+, at least half of them).
{
  const players = ["a", "b", "c", "d"].map((k) => pl(k, k.toUpperCase(), [7, 3, ...fill(16, 7)], 18));
  eq(buildHighlights(game(), players as any).netEagleHole?.n, 2, "4 net eagles, all on hole 2");
  eq(buildHighlights(game(), players.slice(0, 2) as any).netEagleHole, null, "2 is not a cluster");
}
// Standout rounds (209.0). The REAL Bowling Green differentials and indexes (production query, Oct 17), names
// replaced by labels: field gap 5.1; standouts 3.9, 2.9, 2.9, 2.2 — what the owner approved in the mock.
{
  const bg: [number, number][] = [[26.4, 27.6], [9, 11.2], [22, 24.2], [4.9, 7.8], [14, 17.3], [30, 33.7], [6.4, 10.4], [23, 27.6], [23.8, 28.5], [16, 20.7],
                                  [23.1, 28.5], [23, 28.5], [16, 21.6], [20, 25.9], [16.4, 22.4], [19, 25.9], [21, 28.5], [19, 26.8], [16.8, 25.0], [15, 24.2]];
  const s = standoutsFrom(bg.map(([index, differential], i) => ({ name: `P${i + 1}`, index, differential })))!;
  eq(s.basis, "field", "20 players: measured against the field");
  eq(s.fieldGap, 5.1, "field averaged 5.1 over its handicaps");
  eq(s.rows.map((r) => `${r.name} ${r.better}`), ["P1 3.9", "P2 2.9", "P3 2.9", "P4 2.2"], "the four standouts, best first");
  eq(s.rows.some((r) => r.exceptional), false, "no exceptional round that day");
}
// Small group: against the player's own index; 7+ below it is "exceptional".
{
  const s = standoutsFrom([{ name: "A", index: 20, differential: 17.5 }, { name: "B", index: 10, differential: 2.5 }, { name: "C", index: 15, differential: 18 }])!;
  eq(s.basis, "own", "under 8 players: own handicap");
  eq(s.rows.map((r) => [r.name, r.better, r.exceptional]), [["B", 7.5, true], ["A", 2.5, false]], "2+ below own index is a standout; 7+ is exceptional");
}
// The differential itself, end to end: adjusted gross capped at net double bogey; 113/slope × (AGS − rating).
{
  const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
  const p = { id: "x", user_id: "x", display_name: "Cap Test", scores: [12, ...Array(17).fill(4)], course_handicap: 0, course_handicap_source: "manual", handicap_index: 0, rating: 72, slope: 113, no_show: false };
  const h = buildHighlights({ id: "g", holes_meta: holes, course_par: 72, game_type: "stroke" } as any, [p] as any);
  eq(h.standouts?.rows.length, 0, "a blow-up hole is capped (12 → net double bogey 6): differential 2.0, not 8.0 — no standout");
}
console.log("game-highlights tests passed");
