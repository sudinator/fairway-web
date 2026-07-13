// Writes the current player's card summary to player_cards so group-mates can
// read it via group_cards (their rounds aren't directly readable). Diff-guarded:
// only writes when the computed stats actually changed. Idempotent; safe on load.
import { computeCardStats } from "./card";
import type { Round } from "./golf";

type MinimalClient = { from: (t: string) => any };

export async function syncPlayerCard(supabase: MinimalClient, userId: string, rounds: Round[]): Promise<{ changed: boolean }> {
  const s = computeCardStats(rounds);
  const { data: cur } = await supabase.from("player_cards").select("idx,idx_trend,form,rounds").eq("user_id", userId).maybeSingle();
  const same =
    cur &&
    (cur.idx == null ? null : Number(cur.idx)) === s.idx &&
    (cur.idx_trend == null ? null : Number(cur.idx_trend)) === s.idx_trend &&
    (cur.rounds ?? 0) === s.rounds &&
    JSON.stringify(cur.form ?? []) === JSON.stringify(s.form);
  if (same) return { changed: false };
  const { error } = await supabase.from("player_cards").upsert(
    { user_id: userId, idx: s.idx, idx_trend: s.idx_trend, form: s.form, rounds: s.rounds, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  return { changed: !error };
}
