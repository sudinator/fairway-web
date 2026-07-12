// Persists computed badges to member_badges. Idempotent and diff-based: it
// recomputes the full desired state from the finished-rounds list, compares to
// what's stored, and writes only the differences (plus removes badges that no
// longer apply — e.g. after a round that held a record is deleted). Safe to call
// on every load; a no-op when nothing changed.
import { computeBadgeState } from "./badges";
import type { Round } from "./golf";

type MinimalClient = {
  from: (t: string) => any;
};

export async function syncBadges(
  supabase: MinimalClient,
  userId: string,
  finished: Round[],
): Promise<{ changed: number; removed: number }> {
  const desired = computeBadgeState(finished);

  const { data: cur, error } = await supabase
    .from("member_badges")
    .select("badge_key,count,best_value,best_round_id")
    .eq("user_id", userId);
  if (error) return { changed: 0, removed: 0 };

  const curMap: Record<string, any> = {};
  (cur || []).forEach((r: any) => { curMap[r.badge_key] = r; });

  const num = (v: any) => (v == null ? null : Number(v));
  const upserts: any[] = [];
  for (const key of Object.keys(desired)) {
    const d = desired[key];
    const c = curMap[key];
    const changed =
      !c ||
      c.count !== d.count ||
      num(c.best_value) !== num(d.best_value) ||
      (c.best_round_id || null) !== (d.best_round_id || null);
    if (changed) {
      upserts.push({
        user_id: userId,
        badge_key: key,
        count: d.count,
        best_value: d.best_value,
        best_round_id: d.best_round_id,
        first_earned_at: d.first_earned_at,
        last_earned_at: d.last_earned_at,
      });
    }
  }

  // Badges that are stored but no longer earned (e.g. their only qualifying round
  // was deleted) get removed so the wall/card stay truthful.
  const toDelete = Object.keys(curMap).filter((k) => !desired[k]);

  let changed = 0, removed = 0;
  if (upserts.length) {
    const { error: uerr } = await supabase
      .from("member_badges")
      .upsert(upserts, { onConflict: "user_id,badge_key" });
    if (!uerr) changed = upserts.length;
  }
  if (toDelete.length) {
    const { error: derr } = await supabase
      .from("member_badges")
      .delete()
      .eq("user_id", userId)
      .in("badge_key", toDelete);
    if (!derr) removed = toDelete.length;
  }
  return { changed, removed };
}
