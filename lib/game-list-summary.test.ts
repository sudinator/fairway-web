/** Games list richer row (212.126): format · players · course · date, the viewer's result, the viewer's own line;
 *  shared-ball formats show the team result only; open games show the code, no result. Fixtures: the recap samples. */
import { ok, report } from "./screen-harness";
import { gameRowSummary, gameResultFor, myRoundLine } from "@/lib/game-list-summary";
import { game as stableford, players, formatGames } from "@/lib/recap-mockups";
import type { Game, Player } from "@/lib/game-types";
import type { Round } from "@/lib/golf";

const ended = (base: Game, extra: Partial<Game> = {}) => ({ ...base, status: "ended", ...extra }) as Game;
const sg = ended(stableford, { played_at: "2026-11-15" } as Partial<Game>);
const probir = players.find((p) => p.display_name === "Probir Das")!;
const s1 = gameRowSummary(sg, players, probir.user_id!, null, null);
ok(s1.meta.startsWith("Stableford · ") && s1.meta.includes(`${players.filter((p) => !p.no_show).length} players`) && s1.meta.includes("Nov 15"), `meta: format · players · course · date (got "${s1.meta}")`);
ok(s1.result === `1st of ${players.length}` || (s1.result ?? "").startsWith("1st") || (s1.result ?? "").startsWith("T1st"), `the sample's Stableford winner is 1st (got ${s1.result})`);
const last = [...players].map((p) => ({ p, r: gameResultFor(sg, players, p.user_id!) })).filter((x) => x.r);
ok(last.length === players.filter((p) => p.user_id).length && last.every((x) => / of \d+$/.test(x.r!)), "every member of an individual game gets 'Nth of N'");
// open game: no result, the row keeps its code (rendered by the list)
const open = gameRowSummary({ ...stableford, status: "active" } as Game, players, probir.user_id!, null, null);
ok(open.result == null && open.stats == null && !open.meta.includes("Nov"), "an open game: no result, no stats, no date (the code shows instead)");
// team formats: the match outcome
const fb = formatGames["fourball"];
const fbMember = (fb.players as Player[]).find((p) => p.user_id)!;
const fr = gameResultFor(ended(fb.game), fb.players as Player[], fbMember.user_id!);
ok(fr === "Won" || fr === "Lost" || fr === "Halved", `best ball: the viewer's match outcome (got ${fr})`);
const tf = formatGames["trifecta"];
const tfr = gameResultFor(ended(tf.game), tf.players as Player[], (tf.players as Player[]).find((p) => p.user_id)!.user_id!);
ok(!!tfr && /^W-L-H \d-\d-\d$|^(Won|Lost|Halved)$/.test(tfr), `trifecta: a record across the viewer's matches (got ${tfr})`);
// skins: no single place
ok(gameResultFor(ended(formatGames["skins"].game), formatGames["skins"].players as Player[], "u1") == null, "skins: no place shown");
// shared ball: the team result, never a personal score
const sc = gameRowSummary(ended({ ...stableford, game_type: "scramble" } as Game), players, probir.user_id!, { id: "r", holes: [] } as unknown as Round,
  { gameId: stableford.id, date: "2026-11-15", course: "Oak Hollow", format: "scramble", team: "Team 2", holes: 18, result: "1st of 3" } as never);
ok(sc.result === "1st of 3" && sc.stats === "Team 2" && !/Gross|Diff/.test(sc.stats || ""), "scramble: team result and team, no personal score or differential");
// the viewer's own line from the posted round
const holes = Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, stroke_index: i + 1, strokes: i === 0 ? 3 : 5, putts: 2 }));
const r = { id: "r1", course: "Oak Hollow", course_par: 72, course_handicap: 10, rating: 71.2, slope: 128, holes, played_at: "2026-11-15" } as unknown as Round;
const line = myRoundLine(r) || "";
ok(/^Gross 88 \(\+16\)/.test(line), `gross and to-par from the round (got "${line}")`);
ok(/\d+ pts/.test(line) && /Diff \d+\.\d/.test(line), `Stableford points and the differential (got "${line}")`);
ok(/1 net birdie\b/.test(line), `net birdies off the round's stroke allocation — the gross birdie on SI 1 with a stroke is a net eagle, counted as birdie-or-better (got "${line}")`);
ok(myRoundLine({ ...r, holes: [] } as unknown as Round) == null, "no scores: no line");
ok(!/\$|won \$|owe/i.test(JSON.stringify([s1, sc, line])), "no money anywhere in the row");
report("game list summary");
