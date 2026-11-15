import type { CourseTee } from "./courses";

type SavedTee = { tee_name?: string | null; rating?: number | null; slope?: number | null };

// One option set for Organizer's selector AND save handler. Library data wins by
// exact name; fallback data must describe that same named tee, never an unrelated tee.
export function gameTeeOptions(courseTees: CourseTee[], players: SavedTee[], coursePar: number | null | undefined): CourseTee[] {
  const byName = new Map<string, CourseTee>();
  const valid = (name: unknown, rating: unknown, slope: unknown) =>
    typeof name === "string" && name.trim().length > 0 &&
    typeof rating === "number" && Number.isFinite(rating) && rating > 0 &&
    typeof slope === "number" && Number.isFinite(slope) && slope > 0;
  for (const t of courseTees || []) {
    if (valid(t?.name, t?.rating, t?.slope)) byName.set(t.name, t);
  }
  for (const p of players) {
    if (!valid(p.tee_name, p.rating, p.slope) || byName.has(p.tee_name!)) continue;
    byName.set(p.tee_name!, { name: p.tee_name!, rating: p.rating!, slope: p.slope!, par: coursePar ?? 0 });
  }
  return Array.from(byName.values());
}
