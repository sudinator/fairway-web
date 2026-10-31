import { fetchAll } from "./fetch-all";

/** Uses existing profile read permissions. Inaccessible/deleted profiles keep their saved name. */
export async function loadReportNames(db: { from: (table: string) => any }, userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const names: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += 100) {
    const rows = await fetchAll<{ id: string; display_name: string | null }>((from, to) =>
      db.from("profiles").select("id,display_name").in("id", ids.slice(i, i + 100)).order("id").range(from, to));
    for (const row of rows) if (row.display_name?.trim()) names[row.id] = row.display_name;
  }
  return names;
}

/** Only registered identities resolve to a profile; guests never merge by name. */
export function reportPlayerNames<T extends { user_id?: string | null; display_name: string }>(players: T[], names: Record<string, string>): T[] {
  return players.map((p) => ({ ...p, display_name: p.user_id ? names[p.user_id] ?? p.display_name : p.display_name }));
}
