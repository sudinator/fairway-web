/** "Email me my data" (212.133): the three CSV files — one row per round, per scored hole, per game; the figures the app
 *  shows (gross, net, differential, points, received strokes); Excel-safe (BOM, quoting, YYYY-MM-DD); nothing from Money;
 *  only the member's own rows. */
import { ok, report } from "./screen-harness";
import { buildMyDataFiles, csvCell, toCsv } from "@/lib/my-data-export";
import { game as stableford, players, formatGames } from "@/lib/recap-mockups";
import type { Game } from "@/lib/game-types";
import type { Round } from "@/lib/golf";

// CSV mechanics
ok(csvCell('O"Neil, Pat') === '"O""Neil, Pat"' && csvCell(null) === "" && csvCell(7) === "7", "cells are quoted and escaped only when needed");
ok(toCsv(["a", "b"], [[1, "x"]]).startsWith("﻿") && toCsv(["a"], [[1]]).includes("\r\n"), "files carry the Excel byte-order mark and CRLF line ends");

// a member with two rounds (one a club game's posted round) and a game
const par = (i: number) => (i % 3 === 0 ? 3 : i % 5 === 0 ? 5 : 4);
const round = (id: string, date: string, rel: (i: number) => number, extra: Partial<Round> = {}): Round => ({
  id, course: "Francis Byrne", tee_name: "White", rating: 69.8, slope: 123, course_par: 68, handicap_index: 14.6, course_handicap: 16, course_handicap_source: "derived", group_id: null, group_name: "Main",
  played_at: date, status: "final", gross_score: null,
  holes: Array.from({ length: 18 }, (_, k) => { const i = k + 1; return { hole_number: i, par: par(i), stroke_index: i, strokes: par(i) + rel(i), putts: 2, fairway: i % 2 ? "hit" : "miss", penalties: i === 7 ? 1 : 0, sand: i === 9, yardage: 380 }; }),
  ...extra,
} as unknown as Round);
const r1 = round("r1", "2026-11-22", (i) => (i === 1 ? -1 : 1));           // 17 bogeys and a birdie: gross 84
const r2 = round("r2", "2026-11-15", () => 0, { game_id: "g1" });           // level par, posted from a game
const me = players.find((p) => p.display_name === "Probir Das")!;
const g1 = { ...stableford, id: "g1", code: "481207", status: "ended", played_at: "2026-11-15", course: "Francis Byrne" } as unknown as Game;
const mp = formatGames["match"];
const g2 = { ...mp.game, id: "g2", code: "330871", status: "ended", played_at: "2026-11-01", course: "Weequahic" } as unknown as Game;
const files = buildMyDataFiles(me.user_id!, [r1, r2], [g1, g2], [...players.map((p) => ({ ...p, game_id: "g1" })), ...mp.players.map((p) => ({ ...p, game_id: "g2" }))]);
const byName = Object.fromEntries(files.map((f) => [f.filename, f.content]));
ok(files.length === 3 && byName["rounds.csv"] && byName["holes.csv"] && byName["games.csv"], "three files: rounds, holes, games");
const lines = (f: string) => byName[f].replace("﻿", "").trim().split("\r\n");
const rows = lines("rounds.csv");
ok(rows.length === 3 && rows[0].startsWith("round_id,date,course,tee,rating,slope,par,holes_played,gross,to_par,course_handicap,net,stableford_points,differential,adjusted_gross,putts,penalties"), `rounds.csv: a header and two rows (got ${rows.length - 1})`);
const r1row = rows.find((l) => l.startsWith("r1,"))!.split(",");
// the course handicap is the round's BASIS through chBasis (index 14.6 on 69.8/123, par 68 → 18), the same figure holes.csv's received strokes use — not the stored column (16)
ok(r1row[1] === "2026-11-22" && r1row[2] === "Francis Byrne" && r1row[3] === "White" && r1row[8] === "84" && r1row[9] === "16" && r1row[10] === "18" && r1row[11] === "66", `round 1: date, course, tee, gross 84, +16, ch 18 (one rule), net 66 (got ${r1row.slice(1, 12).join(" ")})`);
ok(r1row[15] === "36" && r1row[16] === "1" && r1row[17] === "1" && r1row[18] === "9", `round 1: 36 putts, 1 penalty, GIR 1 (the birdie), fairways 9 (got ${r1row.slice(15, 19).join(" ")})`);
ok(Number(r1row[12]) > 0 && r1row[13] !== "" && r1row[14] !== "", "round 1 carries Stableford points, a differential and an adjusted gross");
const r2row = rows.find((l) => l.startsWith("r2,"))!.split(",");
ok(r2row[19] === "club game" && r2row[20] === "481207" && r1row[19] === "personal round", "a posted round names its game code; a personal round says so");
const holes = lines("holes.csv");
ok(holes.length === 37, `holes.csv: 36 scored holes (got ${holes.length - 1})`);
const h1 = holes.find((l) => l.startsWith("r1,2026-11-22,Francis Byrne,1,"))!.split(",");
ok(h1[4] === "4" && h1[5] === "1" && h1[7] === "3" && h1[8] === "-1" && h1[9] === "1" && h1[10] === "-2", `hole 1 of round 1: par 4, SI 1, 3 strokes, -1, one received, net -2 (got ${h1.slice(4, 11).join(" ")})`);
ok(holes.find((l) => l.startsWith("r1,2026-11-22,Francis Byrne,7,"))!.endsWith(",1,") && holes.find((l) => l.startsWith("r1,2026-11-22,Francis Byrne,9,"))!.endsWith(",yes"), "penalties and the greenside bunker are per hole");
const games = lines("games.csv");
ok(games.length === 3 && games[0] === "game_id,code,name,date,course,format,players,status,your_result,your_gross,your_team,matches", `games.csv: a header and two games (got ${games.length - 1})`);
ok(games[1].startsWith("g1,481207,") && games[1].includes(",2026-11-15,Francis Byrne,Stableford,") && /,(T?\d+(st|nd|rd|th) of \d+),/.test(games[1]), `the Stableford game carries the member's place (got ${games[1]})`);
const g2row = games.find((l) => l.startsWith("g2,"))!;
ok(g2row.includes(",Match play,") && /(Won|Lost|Halved)[^,]* v /.test(g2row), `the match-play game lists the member's match result (got ${g2row.slice(0, 160)})`);
// shared-ball formats: the TEAM result, never a personal gross (APP_RULES: one ball per side); an active game has no match lines
const sc = { ...stableford, game_type: "scramble", id: "g3", code: "774402", status: "ended", played_at: "2026-10-29", course: "Oak Hollow" } as unknown as Game;
const scPlayers = players.map((p) => ({ ...p, game_id: "g3" }));
const scMe = scPlayers[0].user_id!;
const teamFiles = buildMyDataFiles(scMe, [], [sc, { ...g2, id: "g4", status: "active" } as Game], [...scPlayers, ...mp.players.map((p) => ({ ...p, game_id: "g4" }))], [], [{ gameId: "g3", date: "2026-10-29", course: "Oak Hollow", format: "scramble", team: "Team 2", holes: 18, result: "2nd of 4" }]);
const teamRows = teamFiles[2].content.replace("\ufeff", "").trim().split("\r\n");
const scRow = teamRows.find((l) => l.startsWith("g3,"))!, activeRow = teamRows.find((l) => l.startsWith("g4,"))!;
ok(scRow.includes(",Scramble,") && scRow.includes(",ended,2nd of 4,,Team 2,"), `a scramble row carries the team result and team, no personal gross (got ${scRow})`);
ok(/,active,,\d*,,$/.test(activeRow), `an active game has no result and no match lines yet (its gross so far may show) (got ${activeRow})`);
ok(!JSON.stringify(files).toLowerCase().includes("venmo") && !JSON.stringify(files).includes("$"), "nothing from Money in any file");
report("my data export");
