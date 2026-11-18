/** Games list richer row (212.126, cleaned up 212.127): the meta line says only what the title doesn't; places for
 *  individual formats; "Won 3&2" / "Lost 2 up" for a match; trifecta as W-L-H over the record with one line per match;
 *  skins as a count of holes won; scramble the team result; your own line; the code always; never money. */
import { ok, report } from "./screen-harness";
import { gameRowSummary, gameResultFor, myRoundLine, titleMentions } from "@/lib/game-list-summary";
import { compactMargin } from "@/lib/match-outcomes";
import { game as stableford, players, formatGames } from "@/lib/recap-mockups";
import type { Game, Player } from "@/lib/game-types";
import type { Round } from "@/lib/golf";

const ended = (base: Game, extra: Record<string, unknown> = {}) => ({ ...base, status: "ended", played_at: "2026-11-15", ...extra }) as unknown as Game;
const course = stableford.course || "Oak Hollow";
const probir = players.find((p) => p.display_name === "Probir Das")!;
const nPlayers = players.filter((p) => !p.no_show).length;

// --- redundancy: the meta line says only what the title doesn't
const auto = gameRowSummary(ended(stableford, { name: `Stableford / ${course} / Nov 15, 2026` }), players, probir.user_id!, null, null);
ok(auto.meta === `${nPlayers} players`, `an auto-named game ("Format / Course / Date"): only the player count (got "${auto.meta}")`);
const custom = gameRowSummary(ended(stableford, { name: "Saturday Game" }), players, probir.user_id!, null, null);
ok(custom.meta.startsWith("Stableford · ") && custom.meta.includes(course) && custom.meta.includes("Nov 15"), `a custom name: format, course and date added (got "${custom.meta}")`);
const partial = gameRowSummary(ended(stableford, { name: "FB 11/15 Stableford" }), players, probir.user_id!, null, null);
ok(!partial.meta.includes("Stableford") && !partial.meta.includes("Nov 15") && partial.meta.includes(course), `a name with the format and a 11/15 date: only the course is added (got "${partial.meta}")`);
ok(titleMentions(`Weequahic Ryder Cup`, "course", { ...stableford, course: "Weequahic Golf Course" } as Game) && titleMentions("Best Ball Nov 8", "format", { ...stableford, game_type: "fourball" } as Game), "course suffixes and format synonyms recognised");

// --- individual formats: a place
const s1 = gameResultFor(ended(stableford), players, probir.user_id!);
ok(!!s1.result && /^T?1st of \d+$/.test(s1.result) && !s1.caption, `the sample's Stableford winner is 1st (got ${s1.result})`);
ok(players.filter((p) => p.user_id).every((p) => / of \d+$/.test(gameResultFor(ended(stableford), players, p.user_id!).result || "")), "every member of an individual game gets 'Nth of N'");

// --- one match: Won 3&2 / Lost 2 up, and who against
for (const k of ["fourball", "match"]) {
  const fg = formatGames[k]; const ps = fg.players as Player[];
  const results = ps.filter((p) => p.user_id).map((p) => gameResultFor(ended(fg.game), ps, p.user_id!));
  const decided = results.filter((r) => r.result);
  ok(decided.length > 0 && decided.every((r) => /^(Won|Lost) \d+(&\d+| up)$|^Halved$/.test(r.result!) && !r.caption), `${k}: "Won 3&2" / "Lost 2 up" / "Halved" (got ${decided.map((r) => r.result).join(", ")})`);
  ok(decided.every((r) => /^v .+/.test(r.lines[0]?.text || "")), `${k}: a line naming the opponents (got ${decided[0]?.lines.map((l) => l.text).join(" | ")})`);
  ok(decided.some((r) => r.result!.startsWith("Won")) && decided.some((r) => r.result!.startsWith("Lost")) || decided.every((r) => r.result === "Halved"), `${k}: winners and losers both shown`);
}
const fbr = gameResultFor(ended(formatGames["fourball"].game), formatGames["fourball"].players as Player[], (formatGames["fourball"].players as Player[]).find((p) => p.user_id)!.user_id!);
ok(/· with .+/.test(fbr.lines[0]?.text || ""), `best ball names the partner (got ${fbr.lines[0]?.text})`);

// --- trifecta: W-L-H over the record, one line per match saying what was won and lost
const tf = formatGames["trifecta"]; const tps = tf.players as Player[];
const tr = gameResultFor(ended(tf.game), tps, tps.find((p) => p.user_id)!.user_id!);
ok(tr.caption === "W-L-H" && /^\d-\d-\d$/.test(tr.result || ""), `trifecta: caption W-L-H over the record (got ${tr.caption} / ${tr.result})`);
const [w, l, h] = (tr.result || "0-0-0").split("-").map(Number);
const ml = tr.lines.filter((x) => /^(Singles|Four-ball) v /.test(x.text));
ok(ml.length === w + l + h && ml.every((x) => /^(Won \d+(&\d+| up)|Lost \d+(&\d+| up)|Halved)$/.test(x.value || "")), `one line per match — kind and opponent on the left, the outcome with its margin in the results column (got ${tr.lines.map((x) => x.text + " => " + x.value).join(" | ")})`);

// --- two-team games: how your team did overall
const fbT = formatGames["fourball"]; const fbps = fbT.players as Player[];
ok((fbT.game.teams || []).length === 2, "fixture: the sample best ball has two teams");
const tl = fbps.filter((p) => p.user_id).map((p) => gameResultFor(ended(fbT.game), fbps, p.user_id!).lines.find((l) => l.text.startsWith("Team · ")));
ok(tl.every((l) => !!l && /^(Won|Lost|Tied) \d*½?–\d*½?$|^(Won|Lost|Tied) \d+–\d+$/.test(l.value || "")), `best ball with two teams: a team line with the score (got ${tl.map((l) => l?.value).join(", ")})`);
const tvals = new Set(tl.map((l) => l!.value!.split(" ")[0]));
ok(tvals.has("Tied") || (tvals.has("Won") && tvals.has("Lost")), "one team won and the other lost (or a tie)");
const tfT = gameResultFor(ended(tf.game), tps, tps.find((p) => p.user_id)!.user_id!).lines.find((l) => l.text.startsWith("Team · "));
ok(!!tfT && /^(Won|Lost|Tied) /.test(tfT.value || ""), `trifecta with two teams: a team line (got ${tfT?.value})`);

// --- skins: a count of holes won, never money
const sk = formatGames["skins"]; const sps = sk.players as Player[];
const skr = gameResultFor(ended(sk.game), sps, sps.find((p) => p.user_id)!.user_id!);
ok(/^(Team )?\d+ skins?$/.test(skr.result || ""), `skins: the viewer's skins (got ${skr.result})`);

// --- an incomplete card says why there's no place
const short = players.map((p) => (p.user_id === probir.user_id ? { ...p, scores: (p.scores || []).slice(0, 12) } : p)) as Player[];
const inc = gameResultFor(ended(stableford), short, probir.user_id!);
ok(inc.result == null && /wasn't completed/.test(inc.lines[0]?.text || ""), `an incomplete card: no place, and the reason (got ${JSON.stringify(inc)})`);
const ns = gameResultFor(ended(stableford), players.map((p) => (p.user_id === probir.user_id ? { ...p, no_show: true } : p)) as Player[], probir.user_id!);
ok(ns.result == null && ns.lines[0]?.text === "Marked as a no-show", "a no-show is told so, not 'card wasn't completed'");

// --- open game; shared ball
const open = gameRowSummary({ ...stableford, status: "active", name: "Thanksgiving" } as Game, players, probir.user_id!, null, null);
ok(open.result == null && open.lines.length === 0 && !open.meta.includes("Nov"), "an open game: no result, no lines, no date");
const sc = gameRowSummary(ended(stableford, { game_type: "scramble", name: "Scramble day" }), players, probir.user_id!, null,
  { gameId: stableford.id, date: "2026-11-15", course, format: "scramble", team: "Team 2", holes: 18, result: "1st of 3" } as never);
ok(sc.result === "1st of 3" && sc.lines.map((l) => l.text).join() === "Team 2", "scramble: the team result and team, no personal score");

// --- your own line from the posted round
const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, strokes: i === 0 ? 3 : 5, putts: 2 }));
const r = { id: "r1", course, course_par: 72, course_handicap: 10, rating: 71.2, slope: 128, holes, played_at: "2026-11-15" } as unknown as Round;
const line = myRoundLine(r) || "";
ok(/^Gross 88 \(\+16\)/.test(line) && /\d+ pts/.test(line) && /Diff \d+\.\d/.test(line) && /1 net birdie\b/.test(line), `your line: gross, points, differential, net birdies (got "${line}")`);
const withLine = gameRowSummary(ended(stableford, { name: "Saturday Game" }), players, probir.user_id!, r, null);
ok(withLine.lines[withLine.lines.length - 1]?.text === line, "your line comes last, after any match lines");
ok(compactMargin("3 & 2") === "3&2" && compactMargin("2 UP") === "2 up" && compactMargin("Halved") === "", "margins compacted from the scorecard's wording");
ok(!/\$|owe/i.test(JSON.stringify([custom, tr, skr, sc, withLine])), "no money anywhere in the row");
report("game list summary");
