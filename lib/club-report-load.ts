// Load a club's finished games in a period, with players and alternate-shot scores (210.0). Works with the
// app's client (admin preview) or the server's (publishing).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { ReportGame, ReportPeriod } from "@/lib/club-report";
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";

export async function loadClubGames(db: SupabaseClient, groupId: string, period: ReportPeriod): Promise<ReportGame[]> {
  // Every row, paged (210.2 — review point 8): the games, then their players and alternate-shot scores.
  const games = await fetchAll<Game>((from, to) => db.from("games").select("*").eq("group_id", groupId).eq("status", "ended")
    .gte("played_at", period.from).lte("played_at", `${period.to}T23:59:59`).order("id").range(from, to));
  const ids = games.map((g) => g.id);
  const [players, alt] = await Promise.all([
    fetchAllIn<Player>(db, "game_players", "game_id", ids),
    fetchAllIn<AltShotScoreRow>(db, "game_alt_shot_scores", "game_id", ids),
  ]);
  return games.map((game) => ({ game, players: players.filter((p) => p.game_id === game.id), altScores: alt.filter((x) => x.game_id === game.id) }));
}
