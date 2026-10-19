// Load a club's finished games in a period, with players and alternate-shot scores (210.0). Works with the
// app's client (admin preview) or the server's (publishing).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { ReportGame, ReportPeriod } from "@/lib/club-report";

export async function loadClubGames(db: SupabaseClient, groupId: string, period: ReportPeriod): Promise<ReportGame[]> {
  const { data: gs, error } = await db.from("games").select("*").eq("group_id", groupId).eq("status", "ended")
    .gte("played_at", period.from).lte("played_at", `${period.to}T23:59:59`);
  if (error) throw new Error(error.message);
  const games = (gs || []) as Game[];
  const ids = games.map((g) => g.id);
  const players: Player[] = [], alt: AltShotScoreRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const [p, a] = await Promise.all([
      db.from("game_players").select("*").in("game_id", chunk),
      db.from("game_alt_shot_scores").select("*").in("game_id", chunk),
    ]);
    if (p.error || a.error) throw new Error((p.error || a.error)!.message);
    players.push(...((p.data || []) as Player[])); alt.push(...((a.data || []) as AltShotScoreRow[]));
  }
  return games.map((game) => ({ game, players: players.filter((p) => p.game_id === game.id), altScores: alt.filter((x) => x.game_id === game.id) }));
}
