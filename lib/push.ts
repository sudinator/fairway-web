// Web Push client helpers. Detection is capability-based, not browser-name-based:
// we only treat a device as push-capable if the APIs exist AND (on iOS) the app is
// running installed. An iOS home-screen icon added from Chrome typically can't push,
// so we fall back to "install via Safari" guidance whenever a real subscribe fails.
import { createClient } from "@/lib/supabase";

const supabase = createClient();

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as Mac; detect touch to disambiguate.
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    (navigator as any).standalone === true;
}

// APIs present in this context at all?
export function pushApisPresent(): boolean {
  return typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;
}

export function vapidConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0;
}

// What UI to show. "install_ios" = must Add to Home Screen (via Safari) first.
export type PushGate = "ready" | "install_ios" | "unsupported" | "unconfigured";
export function pushGate(): PushGate {
  if (!vapidConfigured()) return "unconfigured";
  if (isIOS() && !isStandalone()) return "install_ios";  // iOS needs an installed PWA
  if (!pushApisPresent()) return isIOS() ? "install_ios" : "unsupported";
  return "ready";
}

export function currentPermission(): NotificationPermission | "unavailable" {
  if (typeof Notification === "undefined") return "unavailable";
  return Notification.permission;
}

function b64ToUint8(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function isSubscribed(): Promise<boolean> {
  try {
    if (!pushApisPresent()) return false;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}

export type SubscribeResult = { ok: boolean; reason?: "denied" | "unsupported" | "unconfigured" | "error" };

// Ask permission, subscribe, and store the subscription for this user. Must be called
// from a user gesture (button tap) — required on iOS.
export async function subscribeToPush(userId: string): Promise<SubscribeResult> {
  try {
    if (!vapidConfigured()) return { ok: false, reason: "unconfigured" };
    if (!pushApisPresent()) return { ok: false, reason: "unsupported" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, reason: "denied" };

    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToUint8(VAPID_PUBLIC_KEY) as unknown as BufferSource,
      });
    }
    const json: any = sub.toJSON();
    const endpoint = json.endpoint as string;
    const p256dh = json.keys?.p256dh as string;
    const auth = json.keys?.auth as string;
    if (!endpoint || !p256dh || !auth) return { ok: false, reason: "error" };

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: userId, endpoint, p256dh, auth,
        platform: isIOS() ? "ios" : (typeof navigator !== "undefined" ? (navigator.platform || null) : null),
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
        disabled: false, fail_count: 0, last_seen: new Date().toISOString(),
      },
      { onConflict: "endpoint" },
    );
    if (error) return { ok: false, reason: "error" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

// Turn off on this device: drop the browser subscription and remove the stored row.
export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    if (!pushApisPresent()) return true;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = (sub.toJSON() as any).endpoint as string;
      try { await sub.unsubscribe(); } catch { /* ignore */ }
      if (endpoint) { try { await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint); } catch { /* ignore */ } }
    }
    return true;
  } catch { return false; }
}
