/** Season standings (owner, Nov 17): the engine on a synthetic season — the recap's sample field through 5 Stableford
 *  games, a best-ball and a trifecta. Rules: own-ball formats only, ended games, members only, 5-game floor, ties share. */
import { ok, report } from "./screen-harness";
import { seasonStandings, rankBy, METRICS } from "@/lib/season-standings";
import { game as stableford, players, formatGames } from "@/lib/recap-mockups";
import type { Game, Player } from "@/lib/game-types";

const g = (id: string, base: Game, extra: Partial<Game> = {}) => ({ ...base, id, status: "ended", ...extra }) as Game;
const season: Game[] = [
  ...[1, 2, 3, 4, 5].map((i) => g(`s${i}`, stableford)),
  g("fb", formatGames["fourball"].game), g("tf", formatGames["trifecta"].game),
  g("skins", formatGames["skins"].game),                                   // must not count
  g("open", stableford, { status: "active" }),                             // must not count
];
const pb: Record<string, Player[]> = Object.fromEntries(season.map((x) => [x.id, x.game_type === "fourball" || x.game_type === "trifecta" ? formatGames[x.game_type].players : x.game_type === "skins" ? formatGames["skins"].players : players]));
const rows = seasonStandings(season, pb, [{ gameId: "s1", userId: "u4", name: "Amit Sud" }]);
const by = Object.fromEntries(rows.map((r) => [r.name, r]));
ok(rows.length === 8 && rows.every((r) => r.games === 7), `every member played the 7 counted games — skins and the open game don't count (got ${rows.map((r) => r.games).join(",")})`);
ok(by["Probir Das"].wins >= 5 && by["Probir Das"].top3 >= 5, `Probir wins the five Stableford games (wins ${by["Probir Das"].wins}, top-3s ${by["Probir Das"].top3})`);
ok(by["Raj Mehta"].bestGross === 74 && by["Probir Das"].bestGross === 75, `best gross from the hole scores (Raj ${by["Raj Mehta"].bestGross}, Probir ${by["Probir Das"].bestGross})`);
ok(rows.every((r) => r.eligible && r.avgPts != null && r.avgPts > 20 && r.avgPts < 50), "7 games clears the floor; average Stableford points computed for everyone");
const matches = rows.reduce((s, r) => s + r.matchW + r.matchL + r.matchH, 0);
ok(matches > 0 && rows.every((r) => r.matchW + r.matchL + r.matchH === 3), `best ball (one match) + trifecta (a single and a four-ball): three matches a head (got ${rows.map((r) => r.matchW + r.matchL + r.matchH).join(",")})`);
ok(rows.some((r) => r.wins > r.top3), "a won match counts as a win (aggregated), so wins can exceed individual top-3s");
ok(by["Amit Sud"].contests === 1 && rows.filter((r) => r.contests).length === 1, "a contest win credited to its winner only");
ok(rows.some((r) => r.segments > 0), "segments won credited (the sample Stableford has sixes)");
ok(by["Probir Das"].standouts >= 1, "a standout round counted");
ok(by["Probir Das"].birdies >= 5, `net birdies summed over the season (Probir ${by["Probir Das"].birdies})`);
// ranking: ties share the place; the floor
const r1 = rankBy(rows, "wins");
ok(r1[0].row.name === "Probir Das" && r1[0].place === 1, "sorted by wins: Probir first");
const tied = rankBy([{ ...rows[0], name: "A", wins: 3 }, { ...rows[0], name: "B", wins: 3 }, { ...rows[0], name: "C", wins: 1 }], "wins");
ok(tied.map((x) => x.place).join(",") === "1,1,3", `ties share the place: 1,1,3 (got ${tied.map((x) => x.place).join(",")})`);
const few = seasonStandings(season.slice(0, 3), pb);
ok(few.every((r) => !r.eligible && r.avgPts == null) && rankBy(few, "avgPts").every((x) => x.place === null), "below 5 games: listed but unranked, no average");
const bg = rankBy(rows, "bestGross");
ok(bg[0].row.name === "Raj Mehta", "best gross sorts low first");
ok(METRICS.length === 9, "nine ways to slice");
report("season standings");
