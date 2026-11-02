"use client";
import { createClient } from "./supabase";
import { rememberUpdateGame } from "./update-safety";
import { verifySavedScores, type ScoreReader, type VerifiedRow } from "./saved-score-verification";

export function savedScoreReader(): ScoreReader {
  const db = createClient();
  const games = new Map<string, Promise<VerifiedRow["game"] | null>>();
  return async (gameId, playerId) => {
    if (!games.has(gameId)) games.set(gameId, (async () => {
      const { data, error } = await db.from("games").select("status,scoring_version,name,code,group_id,groups(name)").eq("id", gameId).maybeSingle();
      if (error || !data) return null;
      const game = { ...data, group_name: (data.groups as any)?.name || null } as VerifiedRow["game"];
      rememberUpdateGame(gameId, game);
      return game;
    })());
    const game = await games.get(gameId);
    if (!game) return null;
    const { data, error } = await db.from("game_players").select("scores,putts,fairways,penalties,sand,display_name").eq("game_id", gameId).eq("id", playerId).maybeSingle();
    if (error || !data) return null;
    return { row: data, game, player: data.display_name };
  };
}
export function verifySavedScoresFromServer() { return verifySavedScores(savedScoreReader()); }
