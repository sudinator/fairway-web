/** Club-scoped directory reads and count/search rules. App activity is not club participation. */
import { fetchAll } from "./fetch-all";
export type ClubDirectoryRow = {
  id: string; group_id?: string; user_id: string | null; email: string; role: string; status: string; is_support?: boolean;
  avatar_url?: string | null;
  profiles?: { id?: string; display_name?: string | null; handicap_index?: number | null; phone?: string | null; ghin_number?: string | null; avatar_url?: string | null; last_active?: string | null } | null;
};
export type ClubDirectorySummary = { members: number; opened30: number; invited: number; admins: number; unknownActivity: number };
export async function loadClubDirectory(db: { from: (table: string) => any }, groupId: string): Promise<ClubDirectoryRow[]> {
  const rows = await fetchAll<ClubDirectoryRow>((from, to) => db.from("group_members")
    .select("id, group_id, user_id, email, role, status, avatar_url, is_support").eq("group_id", groupId).neq("status", "removed").order("id").range(from, to));
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  const profiles: NonNullable<ClubDirectoryRow["profiles"]>[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    profiles.push(...await fetchAll<NonNullable<ClubDirectoryRow["profiles"]>>((from, to) => db.from("profiles")
      .select("id, display_name, handicap_index, phone, ghin_number, avatar_url, last_active").in("id", ids.slice(i, i + 100)).order("id").range(from, to)));
  }
  const byId = new Map(profiles.map((p) => [p.id, p]));
  return rows.map((r) => ({ ...r, profiles: r.user_id ? byId.get(r.user_id) || null : null,
    avatar_url: r.avatar_url || (r.user_id ? byId.get(r.user_id)?.avatar_url : null) || null }))
    .sort((a, b) => (a.profiles?.display_name || a.email || "").localeCompare(b.profiles?.display_name || b.email || "", undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id));
}
export function clubDirectorySummary(rows: ClubDirectoryRow[], now: number): ClubDirectorySummary {
  const current = new Map<string, ClubDirectoryRow>();
  for (const r of rows) if (!r.is_support && r.status === "active" && r.user_id) current.set(r.user_id, r);
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  let opened30 = 0, admins = 0, unknownActivity = 0;
  for (const r of current.values()) {
    if (r.role === "admin") admins++;
    const last = r.profiles?.last_active ? Date.parse(r.profiles.last_active) : NaN;
    if (!Number.isFinite(last)) unknownActivity++;
    else if (last >= cutoff && last <= now) opened30++;
  }
  return { members: current.size, opened30, admins, unknownActivity,
    invited: new Set(rows.filter((r) => !r.is_support && r.status === "invited").map((r) => r.id)).size };
}
export function filterClubDirectory(rows: ClubDirectoryRow[], query: string, filter: "all" | "admin" | "invited" | "handicap"): ClubDirectoryRow[] {
  const q = query.trim().toLocaleLowerCase();
  return rows.filter((r) => !r.is_support && r.status !== "removed")
    .filter((r) => filter === "all" || (filter === "admin" ? r.role === "admin" && r.status === "active" : filter === "invited" ? r.status === "invited" : r.status === "active" && r.profiles?.handicap_index == null))
    .filter((r) => !q || [r.profiles?.display_name, r.email, r.profiles?.phone, r.profiles?.ghin_number].some((v) => String(v || "").toLocaleLowerCase().includes(q)));
}
