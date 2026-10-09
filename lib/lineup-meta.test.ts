function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { lineupTitle, lineupDescription, fmtMatchDate } from "./lineup-meta";
eq(lineupTitle({ name: "Saturday Trifecta", played_on: "2026-10-10" }), `Line-up · Saturday Trifecta · ${fmtMatchDate("2026-10-10")}`, "title names the game and the MATCH date");
eq(fmtMatchDate("2026-10-10")!.includes("Oct 10, 2026") && fmtMatchDate("2026-10-10")!.includes("Sat"), true, "weekday, month, day and year, built as a local date");
eq(lineupTitle({ name: "Saturday Trifecta", played_at: "Sat Oct 11" }), "Line-up · Saturday Trifecta · Sat Oct 11", "pre-0176 payload still titles");
eq(lineupTitle({ name: "Saturday Trifecta", ended: true }), "Saturday Trifecta · finished · Birdie Num Num", "ended title");
eq(lineupTitle(null), "Line-up · Birdie Num Num", "unknown token title");
eq(lineupDescription({ course: "Essex County Country Club", players: [1, 2, 3, 4, 5, 6, 7, 8], game_type: "trifecta", allowance_pct: 90 }),
   "Essex County Country Club · 8 players · trifecta · 90% allowance — tees, playing handicaps, opponents and strokes. Live until the game ends.", "description");
eq(lineupDescription({ course: "X", players: [1], game_type: "stableford", allowance_pct: 100 }), "X · 1 player · stableford — tees, playing handicaps, opponents and strokes. Live until the game ends.", "100% omits allowance");
console.log("lineup-meta tests passed");
