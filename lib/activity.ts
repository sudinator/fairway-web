import { scoringDeviceToken } from "./scoring-device";
import { deviceIdentity } from "./device-identity";
// Lightweight audit logging. Each call records one "major event" for the admin Activity tab.
// Failures are swallowed so logging never blocks the user's actual action.
export type ActivityEntry = {
  actor_id: string;
  actor_name: string;
  action: string;          // short key, e.g. "round_completed", "handicap_changed"
  summary: string;         // human-readable line shown in the Activity tab
  group_id?: string | null;
  target_user_id?: string | null;
  details?: Record<string, unknown> | null;
};

// 212.135: every client-logged action carries the device that did it, so the activity log can answer "which phone
// deleted this?" (owner, Nov 27): a stable per-installation id, a decipherable name ("iPhone - home-screen app") and
// the scoring-device token of the tab. Each names a device, never a person or a score. Server-side logging
// (admin_delete_game, admin_reopen_game) stamps the same shape from the request headers.
export function loggedDevice(): Record<string, string> {
  try {
    const { id, name } = deviceIdentity(); const token = scoringDeviceToken();
    return { ...(id ? { id } : {}), ...(name ? { name } : {}), ...(token ? { token } : {}) };
  } catch { return {}; }
}

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
      details: { ...(entry.details || {}), ...(Object.keys(loggedDevice()).length ? { device: loggedDevice() } : {}) },
    });
  } catch {
    // Never let logging break the underlying action.
  }
}

/** Allowlisted, idempotent feature observations. No names, scores or free text. */
export async function recordFeatureUse(supabase: any, feature: 'insights_open' | 'ai_dashboard' | 'ai_round' | 'live_share', gameId: string | null = null): Promise<void> {
  try {
    const event = globalThis.crypto?.randomUUID?.();
    if (!event) return;
    await supabase.rpc('record_feature_use', { p_feature: feature, p_event: event, p_game: gameId });
  } catch { /* analytics must never block the member's action */ }
}
