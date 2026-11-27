/**
 * Server side of "Email me my data" (212.133). Loads ONE member's own rows with the service client, after the route has
 * verified the signed-in caller is that member; builds the files (lib/my-data-export); the route mails them. Test clubs'
 * games are left out, as everywhere else in stats (212.70). The ledger (my_data_exports, 0241) makes it once a day.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { fetchTestClubIds, withoutTestClubs } from "@/lib/test-clubs";
import { dedupeHoles, type Round, type Hole } from "@/lib/golf";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import { buildMyDataFiles, type ExportFile } from "@/lib/my-data-export";
import { loadTeamRounds } from "@/lib/team-rounds";

export const EXPORT_INTERVAL_HOURS = 24;

export type MyData = { files: ExportFile[]; counts: { rounds: number; holes: number; games: number } };

export async function loadMyData(db: SupabaseClient, userId: string): Promise<MyData> {
  // every row, paged (210.4): a request stops at 1,000 rows and holes reach that at ~55 rounds
  const rs = await fetchAll<Round & { groups?: { name?: string } | null }>((f, t) => db.from("rounds").select("*, groups(name)").eq("user_id", userId).is("deleted_at", null).order("played_at", { ascending: false }).order("id").range(f, t));
  const hs = rs.length ? await fetchAllIn<Hole & { round_id: string }>(db, "holes", "round_id", rs.map((r) => r.id)) : [];
  const byRound: Record<string, Hole[]> = {};
  for (const h of hs) (byRound[h.round_id] ||= []).push(h);
  const rounds: Round[] = rs.map((r) => ({ ...r, group_name: r.groups?.name || null, holes: dedupeHoles(byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number) }));
  const mine = await fetchAll<{ game_id: string }>((f, t) => db.from("game_players").select("game_id, id").eq("user_id", userId).order("id").range(f, t));
  const ids = [...new Set(mine.map((m) => m.game_id))];
  const [gamesAll, players, alt] = ids.length ? await Promise.all([
    fetchAllIn<Game>(db, "games", "id", ids),
    fetchAllIn<Player>(db, "game_players", "game_id", ids),
    fetchAllIn<AltShotScoreRow>(db, "game_alt_shot_scores", "game_id", ids),
  ]) : [[], [], []] as [Game[], Player[], AltShotScoreRow[]];
  const games = withoutTestClubs(gamesAll, await fetchTestClubIds(db));
  const teamRounds = ids.length ? await loadTeamRounds(db, userId) : [];   // scramble / alternate shot: the team result
  const files = buildMyDataFiles(userId, rounds, games, players, alt, teamRounds);
  return { files, counts: { rounds: rounds.length, holes: rounds.reduce((n, r) => n + (r.holes?.length || 0), 0), games: games.length } };
}

/** The once-a-day rule, read from the ledger's own function (0241) so the route and the Profile agree. */
export async function nextExportAllowedAt(db: SupabaseClient, userId: string): Promise<Date> {
  const { data, error } = await db.rpc("my_data_export_next_allowed", { p_user: userId });
  if (error) throw new Error(error.message);
  return new Date(data as string);
}

export const exportSubject = (counts: MyData["counts"]) => `Your Birdie Num Num data — ${counts.rounds} round${counts.rounds === 1 ? "" : "s"}, ${counts.games} game${counts.games === 1 ? "" : "s"}`;
export function exportEmailText(firstName: string | null, counts: MyData["counts"]): string {
  return [`Hi${firstName ? ` ${firstName}` : ""},`, "",
    `Attached are your rounds, holes and club games from Birdie Num Num, as three CSV files that open in Excel or Google Sheets:`, "",
    `  rounds.csv — one row per round (${counts.rounds}): date, course, tee, rating and slope, gross, net, differential, Stableford points, putts, penalties, greens and fairways.`,
    `  holes.csv — one row per hole you scored (${counts.holes}): par, stroke index, strokes, strokes received, putts, fairway, penalties.`,
    `  games.csv — one row per club game you played in (${counts.games}): format, date, course, your result and your match results.`, "",
    `Only your own data is here. Names of opponents and partners appear in match results; nothing from Money does. Your profile details, badges and notifications are in the app.`, "",
    `You asked for this from Profile → Your data. If you didn't, reply to this email.`].join("\n");
}
