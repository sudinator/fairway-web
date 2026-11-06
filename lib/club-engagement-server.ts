// Server-only data access: route authenticates the caller; no raw scorecards are returned to the phone.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll, fetchAllIn } from "./fetch-all";
import { loadClubGames } from "./club-report-load";
import { buildClubEngagement, clubEngagementPeriod, type ClubEngagementRange, type EngagementRound } from "./club-engagement";
export class ClubEngagementDenied extends Error {}
export async function getClubEngagement(db: SupabaseClient, callerId: string, groupId: string, now: number, range: ClubEngagementRange = "30") {
  const { data: profile, error: profileError } = await db.from("profiles").select("account_status,banned").eq("id", callerId).maybeSingle();
  if (profileError) throw profileError;
  if (!profile || (profile.account_status ?? "active") !== "active" || profile.banned) throw new ClubEngagementDenied("Account unavailable");
  const { data: membership, error: membershipError } = await db.from("group_members").select("id").eq("group_id", groupId).eq("user_id", callerId).eq("status", "active").limit(1).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new ClubEngagementDenied("Not an active club member");
  const members = await fetchAll<{ user_id: string | null; status: string; is_support: boolean }>((from, to) => db.from("group_members")
    .select("id,user_id,status,is_support").eq("group_id", groupId).eq("status", "active").eq("is_support", false).order("id").range(from, to));
  const ids = [...new Set(members.filter((r) => r.status === "active" && !r.is_support && r.user_id).map((r) => r.user_id!))];
  const period = clubEngagementPeriod(now, range);
  const input = ids.length ? await loadClubGames(db, groupId, period) : [];
  const rounds: Omit<EngagementRound, "holes">[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    rounds.push(...await fetchAll<Omit<EngagementRound, "holes">>((from, to) => db.from("rounds")
      .select("id,user_id,group_id,course,played_at,game_id,status,deleted_at").eq("group_id", groupId).in("user_id", ids.slice(i, i + 100))
      .is("game_id", null).is("deleted_at", null).or("status.is.null,status.eq.final").gte("played_at", period.from).lte("played_at", `${period.to}T23:59:59.999999`).order("id").range(from, to)));
  }
  const holes = await fetchAllIn<import("./golf").Hole & { round_id: string }>(db, "holes", "round_id", rounds.map((r) => r.id));
  return buildClubEngagement(groupId, period, ids, input, rounds.map((r) => ({ ...r, holes: holes.filter((h) => h.round_id === r.id) })));
}
