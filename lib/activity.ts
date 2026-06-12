// Lightweight audit logging. Each call records one "major event" for the admin Activity tab.
// Failures are swallowed so logging never blocks the user's actual action.
export type ActivityEntry = {
  actor_id: string;
  actor_name: string;
  action: string;          // short key, e.g. "round_completed", "handicap_changed"
  summary: string;         // human-readable line shown in the Activity tab
  group_id?: string | null;
  target_user_id?: string | null;
};

export async function logActivity(supabase: any, entry: ActivityEntry): Promise<void> {
  try {
    await supabase.from("activity_log").insert({
      actor_id: entry.actor_id,
      actor_name: entry.actor_name || "Someone",
      action: entry.action,
      summary: entry.summary,
      group_id: entry.group_id ?? null,
      target_user_id: entry.target_user_id ?? null,
    });
  } catch {
    // Never let logging break the underlying action.
  }
}
