function eq(a: unknown, b: unknown, m: string) { const x = JSON.stringify(a), y = JSON.stringify(b); if (x !== y) throw new Error(`${m}: expected ${y}, got ${x}`); }
import { summarizeWatch } from "./standout-watch";
import { fieldComparison } from "./game-highlights";
// 209.1: "worth a look" needs ALL THREE: 5+ rounds, 3+ standouts, 1.5+ better on average.
const g = (i: number, rows: [string | null, string, number][]) => ({ gameId: `g${i}`, date: `2026-0${(i % 9) + 1}-01`, course: "Oak", fieldRows: rows.map(([userId, name, better]) => ({ userId, name, better })) });
const games = [
  g(1, [["a", "Pattern Pat", 3.0], ["b", "One-Day Dan", 6.5], ["c", "Close Cal", 2.2], ["d", "Few Fran", 3.0], [null, "Guest Gus", 9.0]]),
  g(2, [["a", "Pattern Pat", 2.5], ["b", "One-Day Dan", -1.0], ["c", "Close Cal", 2.1], ["d", "Few Fran", 3.0]]),
  g(3, [["a", "Pattern Pat", 2.1], ["b", "One-Day Dan", -0.5], ["c", "Close Cal", 2.0], ["d", "Few Fran", 3.0]]),
  g(4, [["a", "Pattern Pat", 1.0], ["b", "One-Day Dan", 0.0], ["c", "Close Cal", -1.0], ["d", "Few Fran", 3.0]]),
  g(5, [["a", "Pattern Pat", 1.4], ["b", "One-Day Dan", 0.5], ["c", "Close Cal", 0.7]]),
];
const rows = summarizeWatch(games);
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
eq([by["Pattern Pat"].rounds, by["Pattern Pat"].standouts, by["Pattern Pat"].avgBetter, by["Pattern Pat"].worthALook], [5, 3, 2, true], "a pattern over 5 rounds is worth a look");
eq(by["One-Day Dan"].worthALook, false, "one great day is not a pattern");
eq([by["Close Cal"].standouts, by["Close Cal"].avgBetter, by["Close Cal"].worthALook], [3, 1.2, false], "3 standouts but 1.2 average: not flagged");
eq([by["Few Fran"].rounds, by["Few Fran"].worthALook], [4, false], "4 rounds is too few to flag");
eq(rows.some((r) => r.name === "Guest Gus"), false, "guests are never listed");
eq(rows[0].name, "Pattern Pat", "flagged members first");
// The field comparison is empty below 8 players and centred on the field above it.
eq(fieldComparison(Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, index: 10, differential: 13 }))), [], "under 8 players: no field");
const f = fieldComparison(Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, userId: `u${i}`, index: 10, differential: i === 0 ? 9 : 13 })));
eq(f[0].better, 3.5, "a round 4 better than everyone else is 3.5 better than the field average");
console.log("standout-watch tests passed");
