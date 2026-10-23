// 212.7 — TEAM ROUNDS (owner, Oct 22): scramble and alternate shot record one score per team / side, never a personal
// round — so they were invisible in Season Wrapped, round history and the round email. A team round is: a player
// (member or guest) in a FINISHED one-ball game whose team / side scored 9+ holes (older alternate-shot games kept the
// scores on the players' own cards — those count too). It counts as PLAYED (rounds, holes, courses) and feeds no
// personal statistic. The database's twin is public.team_rounds_in_year (0213) — the same rule.
import type { Game, Player } from "./game-types";
import type { AltShotScoreRow } from "./alt-shot-side-scores";
import { canonicalAltShotGross } from "./alt-shot-side-scores";
import { pkey } from "./game-shape";
import { scrambleResults } from "./scramble-game";
import { scrambleTeamsOf, cupSideNames, type ScrambleGroup } from "./scramble-teams";

export type TeamRound = {
  gameId: string; date: string; course: string; format: "scramble" | "alt_shot";
  /** "Team 2", a Cup side, or the partner's name for alternate shot */
  team: string;
  holes: number;
  /** a plain result where the format gives one ("1st of 4", "Reds won 2&1"), else null */
  result: string | null;
};

const ONE_BALL = new Set(["scramble", "alt_shot"]);
const ord = (n: number) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);

/** The member's team rounds from their games (any year — the caller filters). Pure. */
export function teamRoundsFrom(games: { game: Game; players: Player[]; rows: AltShotScoreRow[] }[], userId: string): TeamRound[] {
  const out: TeamRound[] = [];
  for (const { game, players, rows } of games) {
    if (!ONE_BALL.has(game.game_type) || game.status !== "ended") continue;
    const me = players.find((p) => p.user_id === userId && !p.no_show);
    if (!me) continue;
    const key = pkey(me);
    const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
    const f = groups.find((g) => g.a.includes(key) || g.b.includes(key));
    if (!f) continue;
    const side: "a" | "b" = f.a.includes(key) ? "a" : "b";
    const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
    const canonical = canonicalAltShotGross(rows, f.id, side, nh, null);
    const card = canonical.some((x) => x != null) ? canonical : ((me.scores || []) as (number | null)[]);
    const holes = card.slice(0, nh).filter((x) => x != null && x > 0).length;
    if (holes < 9) continue;
    let team = "", result: string | null = null;
    if (game.game_type === "scramble") {
      const r = scrambleResults(game, players, rows);
      const t = scrambleTeamsOf(groups, cupSideNames(game)).find((x) => x.groupId === f.id && x.side === side);
      team = t?.name ?? "Team";
      if (r.mode === "match") result = r.matches.find((m) => m.groupId === f.id)?.line ?? null;
      else { const b = r.board.find((x) => x.key === `${f.id}:${side}`); if (b && b.thru) result = `${b.pos.startsWith("T") ? "tied " : ""}${ord(b.rank)} of ${r.board.filter((x) => x.thru).length}`; }
    } else {
      const partner = (f[side] as string[]).filter((k) => k !== key).map((k) => players.find((p) => pkey(p) === k)?.display_name).filter(Boolean);
      team = partner.length ? `with ${partner.join(" & ")}` : "Alternate shot";
    }
    out.push({ gameId: game.id, date: String((game as { played_at?: string }).played_at || "").slice(0, 10), course: game.course || "", format: game.game_type as TeamRound["format"], team, holes, result });
  }
  return out.sort((x, y) => y.date.localeCompare(x.date));
}

type Db = { from: (t: string) => any };

/** Load the member's team rounds (paged reads — lib/fetch-all — as every list read). */
export async function loadTeamRounds(db: Db, userId: string): Promise<TeamRound[]> {
  const { fetchAll, fetchAllIn } = await import("./fetch-all");
  const mine = await fetchAll<any>((from, to) => db.from("game_players").select("game_id").eq("user_id", userId).order("game_id").range(from, to));
  const ids = Array.from(new Set(mine.map((r: any) => r.game_id as string)));
  if (!ids.length) return [];
  const games = (await fetchAllIn<any>(db, "games", "id", ids)).filter((g: any) => ONE_BALL.has(g.game_type) && g.status === "ended");
  if (!games.length) return [];
  const gIds = games.map((g: any) => g.id as string);
  const [players, rows] = await Promise.all([fetchAllIn<any>(db, "game_players", "game_id", gIds), fetchAllIn<any>(db, "game_alt_shot_scores", "game_id", gIds)]);
  return teamRoundsFrom(games.map((g: any) => ({ game: g as Game, players: players.filter((p: any) => p.game_id === g.id) as Player[], rows: rows.filter((r: any) => r.game_id === g.id) as AltShotScoreRow[] })), userId);
}
