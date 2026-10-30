/** Personal bests — loading a member's finished rounds (with holes) the way the dashboard does, for the recap card (the
 *  app) and the round-email sender (the server). Test clubs never post rounds, so none of theirs can be here. */
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { prepareRound } from "@/lib/round-prep";
import { dedupeHoles, type Round, type Hole } from "@/lib/golf";
import { newBestsOf, type Best } from "@/lib/personal-bests";

export async function loadRoundsFor(db: { from: (t: string) => any }, userId: string): Promise<Round[]> {
  const rs = await fetchAll<any>((from, to) => db.from("rounds").select("*").eq("user_id", userId).is("deleted_at", null).order("played_at", { ascending: false }).range(from, to));
  if (!rs.length) return [];
  const hs = await fetchAllIn<any>(db, "holes", "round_id", rs.map((r: any) => r.id));
  const byRound: Record<string, Hole[]> = {};
  hs.forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
  return rs.map((r: any) => prepareRound({ ...r, holes: dedupeHoles(byRound[r.id] || []) }) as Round).filter((r) => (r.status ?? "final") !== "in_progress");
}

/** The bests the member's round from THIS game set (empty when the game posted no round for them, or none were set). */
export async function newBestsForGame(db: { from: (t: string) => any }, userId: string, gameId: string): Promise<Best[]> {
  const rounds = await loadRoundsFor(db, userId);
  const mine = rounds.find((r) => r.game_id === gameId);
  return mine ? newBestsOf(rounds, mine.id) : [];
}
