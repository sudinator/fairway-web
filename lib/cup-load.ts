// Load the Cup a game belongs to, with every session's game, players and alternate-shot scores — the same
// queries as the Cup standings page (components/competitions). Works with the app's client or the server's.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Competition, CompetitionSession } from "@/lib/competition";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { CupSession } from "@/lib/cup-standing";
import { fetchAllIn } from "@/lib/fetch-all";

export async function loadCupForGame(db: SupabaseClient, gameId: string): Promise<{ competition: Competition; sessions: CupSession[] } | null> {
  const { data: link } = await db.from("competition_sessions").select("competition_id").eq("game_id", gameId).maybeSingle();
  if (!link?.competition_id) return null;
  const [cRes, sRes] = await Promise.all([
    db.from("competitions").select("*").eq("id", link.competition_id).maybeSingle(),
    // bounded: one Cup's sessions
    db.from("competition_sessions").select("*").eq("competition_id", link.competition_id).order("session_order"),
  ]);
  if (cRes.error || sRes.error || !cRes.data) return null;
  const raw = (sRes.data || []) as CompetitionSession[];
  const ids = raw.map((s) => s.game_id).filter((x): x is string => !!x);
  // Every row, paged (210.2 — review point 8).
  const [games, players, alt] = ids.length ? await Promise.all([
    fetchAllIn<Game>(db, "games", "id", ids),
    fetchAllIn<Player>(db, "game_players", "game_id", ids),
    fetchAllIn<AltShotScoreRow>(db, "game_alt_shot_scores", "game_id", ids),
  ]) : [[], [], []] as [Game[], Player[], AltShotScoreRow[]];
  return {
    competition: cRes.data as Competition,
    sessions: raw.map((s) => {
      const game = games.find((x) => x.id === s.game_id) || null;
      return { ...s, game, players: game ? players.filter((x) => x.game_id === game.id) : [], altScores: game ? alt.filter((x) => x.game_id === game.id) : [] };
    }),
  };
}
