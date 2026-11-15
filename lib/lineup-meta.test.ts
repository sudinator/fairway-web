function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { lineupTitle, lineupDescription, fmtMatchDate, liveTitle, liveDescription, nameCarriesDate } from "./lineup-meta";
eq(lineupTitle({ name: "Saturday Trifecta", played_on: "2026-10-10" }), `Line-up · Saturday Trifecta · ${fmtMatchDate("2026-10-10")}`, "title names the game and the MATCH date");
eq(fmtMatchDate("2026-10-10")!.includes("Oct 10, 2026") && fmtMatchDate("2026-10-10")!.includes("Sat"), true, "weekday, month, day and year, built as a local date");
eq(lineupTitle({ name: "Saturday Trifecta", played_at: "Sat Oct 11" }), "Line-up · Saturday Trifecta · Sat Oct 11", "pre-0176 payload still titles");
eq(lineupTitle({ name: "Saturday Trifecta", ended: true }), "Saturday Trifecta · finished · Birdie Num Num", "ended title");
eq(lineupTitle(null), "Line-up · Birdie Num Num", "unknown token title");
eq(lineupDescription({ course: "Essex County Country Club", players: [1, 2, 3, 4, 5, 6, 7, 8], game_type: "trifecta", allowance_pct: 90 }),
   "Essex County Country Club · 8 players · Trifecta · 90% allowance — tees, playing handicaps, opponents and strokes. Live until the game ends.", "description");
eq(lineupDescription({ course: "X", players: [1], game_type: "stableford", allowance_pct: 100 }), "X · 1 player · Stableford — tees, playing handicaps, opponents and strokes. Live until the game ends.", "100% omits allowance");
console.log("lineup-meta tests passed");

// 212.109 (owner, Nov 14): an AUTOMATIC name already ends with the date — never the date twice
eq(lineupTitle({ name: "Stableford / Oak Hollow / Nov 14, 2026", played_on: "2026-11-14" }), "Line-up · Stableford / Oak Hollow / Nov 14, 2026", "automatic name: the title does not add the date again");
eq(lineupTitle({ name: "Stableford / Oak Hollow / 11/14/2026", played_on: "2026-11-14" }), "Line-up · Stableford / Oak Hollow / 11/14/2026", "a numeric date in the name counts too");
eq(lineupTitle({ name: "Saturday Trifecta", played_on: "2026-11-14" }), `Line-up · Saturday Trifecta · ${fmtMatchDate("2026-11-14")}`, "a typed name without a date still gets the date");
eq(nameCarriesDate("May Day Classic"), false, "a month word alone is not a date");
eq(nameCarriesDate("May 3 Classic"), true, "a month word followed by a day is");
eq(nameCarriesDate("Oak Hollow Open"), false, "no date in the name");
// the live scores link: the same shape as the line-up's
eq(liveTitle({ name: "Stableford / Oak Hollow / Nov 14, 2026", played_on: "2026-11-14" }), "Live scores · Stableford / Oak Hollow / Nov 14, 2026", "live title, no second date");
eq(liveTitle({ name: "Saturday Trifecta", ended: true }), "Saturday Trifecta · final · Birdie Num Num", "live title after the end");
eq(liveDescription({ course: "Oak Hollow", players: [1, 2, 3, 4], game_type: "stableford" }), "Oak Hollow · 4 players · Stableford — the scorecard and leaderboard as they happen.", "live description");
console.log("lineup meta (212.109): title never carries the date twice; live link titled and described");
