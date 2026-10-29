/**
 * 212.70 (owner, Oct 29): "exclude all matches played by the app testing group — that is literally meant for testing
 * only, all stats in that club must be excluded like they don't exist." Test clubs (groups.is_test, release 106) never
 * post rounds, so everything built on the Rounds table already leaves them out. Anything built on the GAMES themselves
 * must drop them here: head-to-head records, Season Wrapped, and whatever comes next (personal bests, streaks).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** The ids of every test club (readable by any signed-in member). */
export async function fetchTestClubIds(supabase: SupabaseClient): Promise<Set<string>> {
  // bounded: test clubs — a handful of rows, ever
  const { data } = await supabase.from("groups").select("id").eq("is_test", true);
  return new Set((data ?? []).map((g: { id: string }) => g.id));
}

/** Drop every game that belongs to a test club. */
export function withoutTestClubs<T extends { group_id?: string | null }>(games: T[], testClubs: Set<string>): T[] {
  return testClubs.size ? games.filter((g) => !g.group_id || !testClubs.has(g.group_id)) : games;
}
