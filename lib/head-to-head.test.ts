/** 212.137 — the head-to-head card's numbers: rows, the running state, what is needed, strokes to come, the swing. */
import { headToHead, h2hStateLabel, h2hNeededLine } from "./head-to-head";
let pass = 0, fail = 0; const fails: string[] = [];
const ok = (n: string, c: boolean) => { if (c) pass++; else { fail++; fails.push("FAIL " + n); } };
const eq = (n: string, a: unknown, b: unknown) => ok(`${n} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`, JSON.stringify(a) === JSON.stringify(b));
const holes = Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
const z = Array(18).fill(0) as number[];
const nil = Array(18).fill(null) as (number | null)[];

// the mock-up's match: A (9) v B (18), thru 11, A 5 up
{
  const aG = [5, 3, 4, 4, 5, 4, 5, 4, 4, 4, 2, ...nil.slice(11)], bG = [6, 4, 6, 5, 5, 3, 7, 5, 5, 5, 4, ...nil.slice(11)];
  const aS = [1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0], bS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const h = headToHead(holes, { name: "Amit", gross: aG, strokes: aS }, { name: "Mike", gross: bG, strokes: bS });
  eq("hole 1: A 5-1=4 v B 6-1=5 → A wins, 1 up", [h.rows[0].aNet, h.rows[0].bNet, h.rows[0].result, h.rows[0].lead], [4, 5, "a", 1]);
  eq("hole 2: halved on net", [h.rows[1].result, h.rows[1].lead], ["half", 1]);
  eq("hole 6: B's birdie wins it", [h.rows[5].result, h.rows[5].lead], ["b", 1]);
  eq("thru 11, 5 up, not decided", [h.status.thru, h.status.lead, h.status.decided], [11, 5, false]);
  eq("state label", h2hStateLabel(h), "5 up");
  eq("hole 12 unplayed: no result, no lead", [h.rows[11].result, h.rows[11].lead, h.rows[11].aNet], [null, null, null]);
  // 7 to play, 5 up: A wins with 2 wins (5+2−5 = 2 > 0) or 3 halves (5−4 = 1); B needs 7 of 7 (−5+7 = 2)
  eq("needed", [h.needed.remaining, h.needed.aWins, h.needed.aHalves, h.needed.bWins, h.needed.dormie], [7, 2, 3, 7, null]);
  eq("the to-win line", h2hNeededLine(h, "Mike"), { mine: "Win 2 of the last 7, or halve 3", theirs: "Mike needs 7 of the last 7" });
  eq("strokes to come", h.strokesToCome, { a: [14, 17], b: [12, 13, 14, 15, 16, 17, 18] });
  eq("the swing: A's best 5 up after 11; B never led", [h.swing.aBest, h.swing.bBest], [{ lead: 5, after: 11 }, null]);
}
// dormie: 3 up with 3 to play
{
  const aG = [...Array(15).fill(4), null, null, null], bG = [5, 5, 5, ...Array(12).fill(4), null, null, null];
  const h = headToHead(holes, { name: "A", gross: aG, strokes: z }, { name: "B", gross: bG, strokes: z });
  eq("dormie for A", [h.status.lead, h.needed.remaining, h.needed.dormie], [3, 3, "a"]);
  ok("the line says dormie", h2hNeededLine(h, "B").mine.startsWith("Dormie"));
  const hb = headToHead(holes, { name: "B", gross: bG, strokes: z }, { name: "A", gross: aG, strokes: z });
  eq("from B's side: dormie against", hb.needed.dormie, "b");
  ok("B must win every hole to halve", /win every hole left/.test(h2hNeededLine(hb, "A").mine));
}
// decided: 4 & 3 — no 'needed', state frozen, later holes still shown but not counted
{
  const aG = Array(18).fill(4), bG = [5, 5, 5, 5, ...Array(14).fill(4)];
  const h = headToHead(holes, { name: "A", gross: aG, strokes: z }, { name: "B", gross: bG, strokes: z });
  eq("4 up after 4 with 14 left is not over; after 15: 4 up, 3 left → 4 & 3", [h.status.decided, h.status.result, h.status.thru], [true, "4 & 3", 15]);
  eq("nothing needed once decided", [h.needed.aWins, h.needed.dormie], [null, null]);
  eq("label", h2hStateLabel(h), "Won 4 & 3");
  eq("from the loser's side", h2hStateLabel(headToHead(holes, { name: "B", gross: bG, strokes: z }, { name: "A", gross: aG, strokes: z })), "Lost 4 & 3");
}
// after closeout the later holes carry no result or state (184.1: 5 & 3 never reads 8 up further down) and the swing stops there
{
  const aG = Array(18).fill(3), bG = Array(18).fill(4);   // A wins every hole: 10 & 8 at the 10th
  const h = headToHead(holes, { name: "A", gross: aG, strokes: z }, { name: "B", gross: bG, strokes: z });
  eq("decided 10 & 8 at the 10th", [h.status.result, h.status.thru], ["10 & 8", 10]);
  eq("holes after the closeout show no result and no state", [h.rows[10].result, h.rows[10].lead, h.rows[17].lead], [null, null, null]);
  eq("the swing stops at the closeout", h.swing.aBest, { lead: 10, after: 10 });
  eq("no strokes to come once decided", h.strokesToCome, { a: [], b: [] });
}
// strokes to come are the holes not yet played by both — a skipped hole with a stroke is still to come
{
  const aG = [4, 4, 4, 4, null, 4, 4, 4, 4, 4, ...nil.slice(10)], bG = [...Array(10).fill(4), ...nil.slice(10)];
  const aS = holes.map((h) => ([5, 10, 11].includes(h.n) ? 1 : 0));
  const h = headToHead(holes, { name: "A", gross: aG, strokes: aS }, { name: "B", gross: bG, strokes: z });
  eq("thru 9 (nine holes both played), hole 5 skipped", h.status.thru, 9);
  eq("to come: 5 (skipped) and 11; not 10 (played)", h.strokesToCome.a, [5, 11]);
}
// behind and cannot win but can halve: 3 down with 3 to play (dormie against) vs 4 down with 3 to play (gone)
{
  const bG = Array(18).fill(4), aG = [5, 5, 5, 5, ...Array(11).fill(4), null, null, null];
  const h = headToHead(holes, { name: "A", gross: aG, strokes: z }, { name: "B", gross: bG, strokes: z });
  eq("4 down after the 4th is decided the moment the lead passes the holes left — 4 & 3 at the 15th", [h.status.decided, h.status.result, h.status.thru], [true, "4 & 3", 15]);
}
// a skipped hole mid-round counts neither way; the match still reads thru the holes both played
{
  const aG = [4, null, 4, ...nil.slice(3)], bG = [5, 4, 5, ...nil.slice(3)];
  const h = headToHead(holes, { name: "A", gross: aG, strokes: z }, { name: "B", gross: bG, strokes: z });
  eq("holes 1 and 3 count, hole 2 does not", [h.rows[1].result, h.status.thru, h.status.lead], [null, 2, 2]);
}
for (const f of fails) console.log(f);
console.log(`head-to-head: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
