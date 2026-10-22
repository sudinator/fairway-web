// 211.6 — a member's badges and player card are worked out on the SERVER, from their rounds as the database holds
// them (owner, Oct 21 2026: "have the database do the math"). Before this the phone computed both and wrote the
// results, so a member could overwrite them by a direct request — e.g. set their card's calculated index to match
// the index they entered, hiding them from the admin sandbagger check. Now the phone only asks for a refresh; the
// server loads the member's rounds EXACTLY as the home screen does (same query, lib/round-prep, finished rounds
// only) and runs the SAME code (lib/badge-sync, lib/card-sync) — so the numbers are identical to what the member
// sees, and members can no longer write either table (0207, 0208).
import { fetchAll, fetchAllIn } from "@/lib/fetch-all";
import { prepareRound } from "@/lib/round-prep";
import { dedupeHoles, type Hole, type Round } from "@/lib/golf";
import { syncBadges } from "@/lib/badge-sync";
import { syncPlayerCard } from "@/lib/card-sync";

type Db = { from: (t: string) => any };

/** The member's finished rounds, prepared exactly as components/home.tsx prepares them. */
export async function loadFinishedRounds(db: Db, userId: string): Promise<Round[]> {
  const rs = await fetchAll<any>((from, to) => db.from("rounds").select("*, groups(name)").eq("user_id", userId).is("deleted_at", null)
    .order("played_at", { ascending: false }).order("id").range(from, to));
  const hs = rs.length ? await fetchAllIn<any>(db, "holes", "round_id", rs.map((r: any) => r.id)) : [];
  const byRound: Record<string, Hole[]> = {};
  hs.forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
  return rs.map((r: any) => prepareRound({ ...r, group_name: r.groups?.name || null, holes: dedupeHoles(byRound[r.id] || []) }) as Round)
    .filter((r: any) => (r.status ?? "final") !== "in_progress");
}

/** Recompute and store the member's badges and player card. No rounds → nothing to do (as on the phone). */
export async function refreshMemberStats(db: Db, userId: string): Promise<{ badgesChanged: number; badgesRemoved: number; cardChanged: boolean }> {
  const finished = await loadFinishedRounds(db, userId);
  if (!finished.length) return { badgesChanged: 0, badgesRemoved: 0, cardChanged: false };
  const b = await syncBadges(db, userId, finished);
  const c = await syncPlayerCard(db, userId, finished);
  return { badgesChanged: b.changed, badgesRemoved: b.removed, cardChanged: c.changed };
}
