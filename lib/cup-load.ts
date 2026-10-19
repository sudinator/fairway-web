// Load the Cup a game belongs to, with every session's game, players and alternate-shot scores — the same
// queries as the Cup standings page (components/competitions). Works with the app's client or the server's.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Competition, CompetitionSession } from "@/lib/competition";
import type { Game, Player } from "@/lib/game-types";
import type { AltShotScoreRow } from "@/lib/alt-shot-side-scores";
import type { CupSession } from "@/lib/cup-standing";

export async function loadCupForGame(db: SupabaseClient, gameId: string): Promise<{ competition: Competition; sessions: CupSession[] } | null> {
  const { data: link } = await db.from("competition_sessions").select("competition_id").eq("game_id", gameId).maybeSingle();
  if (!link?.competition_id) return null;
  const [cRes, sRes] = await Promise.all([
    db.from("competitions").select("*").eq("id", link.competition_id).maybeSingle(),
    db.from("competition_sessions").select("*").eq("competition_id", link.competition_id).order("session_order"),
  ]);
  if (cRes.error || sRes.error || !cRes.data) return null;
  const raw = (sRes.data || []) as CompetitionSession[];
  const ids = raw.map((s) => s.game_id).filter((x): x is string => !!x);
  let games: Game[] = [], players: Player[] = [], alt: AltShotScoreRow[] = [];
  if (ids.length) {
    const [g, p, a] = await Promise.all([
      db.from("games").select("*").in("id", ids),
      db.from("game_players").select("*").in("game_id", ids),
      db.from("game_alt_shot_scores").select("*").in("game_id", ids),
    ]);
    if (g.error || p.error || a.error) return null;
    games = (g.data || []) as Game[]; players = (p.data || []) as Player[]; alt = (a.data || []) as AltShotScoreRow[];
  }
  return {
    competition: cRes.data as Competition,
    sessions: raw.map((s) => {
      const game = games.find((x) => x.id === s.game_id) || null;
      return { ...s, game, players: game ? players.filter((x) => x.game_id === game.id) : [], altScores: game ? alt.filter((x) => x.game_id === game.id) : [] };
    }),
  };
}
