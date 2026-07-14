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
    // Prefer a human display name for the actor. Some call sites pass an email (or nothing) —
    // resolve the profile's display_name from actor_id so the Activity log reads consistently as
    // names, not emails. Best-effort; falls back to whatever was passed, then "Someone".
    let name = entry.actor_name;
    if (entry.actor_id && (!name || name.includes("@"))) {
      try {
        const { data } = await supabase.from("profiles").select("display_name").eq("id", entry.actor_id).maybeSingle();
        if (data?.display_name) name = data.display_name;
      } catch {
        // keep the passed value
      }
    }
    await supabase.from("activity_log").insert({
      actor_id: entry.actor_id,
      actor_name: name || "Someone",
      action: entry.action,
      summary: entry.summary,
      group_id: entry.group_id ?? null,
      target_user_id: entry.target_user_id ?? null,
    });
  } catch {
    // Never let logging break the underlying action.
  }
}
