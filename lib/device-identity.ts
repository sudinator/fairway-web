/**
 * 212.135 (owner): a stable, decipherable identity for the phone or computer behind a logged action.
 *
 * Browsers do not expose a computer's name or an iPhone's model, so the name is what the browser does say: the platform
 * ("iPhone", "iPad", "Android", "Mac", "Windows PC"), the browser, and whether the app runs from the home screen — ASCII
 * only, because it also travels as a request header. The id
 * is a random UUID minted once per installation and kept in localStorage; it survives sign-out (lib/sign-out keeps it)
 * so one phone stays one id across accounts, and it names a device, never a person. Nothing here is a fingerprint:
 * clearing site data mints a new id.
 */
export const DEVICE_ID_KEY = "bnn_device_id_v1";
let cachedId = "";
export function deviceId(storage?: Storage): string {
  if (cachedId) return cachedId;
  try {
    const s = storage ?? window.localStorage;
    let id = s.getItem(DEVICE_ID_KEY) || "";
    if (!/^[0-9a-f-]{36}$/.test(id)) { id = globalThis.crypto?.randomUUID?.() || ""; if (id) s.setItem(DEVICE_ID_KEY, id); }
    cachedId = id;
    return id;
  } catch { return ""; }
}
export function deviceName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent, standalone?: boolean): string {
  const platform = /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== "undefined" && (navigator.maxTouchPoints || 0) > 1) ? "iPad"
    : /iPhone/.test(ua) ? "iPhone"
    : /Android/.test(ua) ? "Android"
    : /Macintosh/.test(ua) ? "Mac"
    : /Windows/.test(ua) ? "Windows PC"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Linux/.test(ua) ? "Linux"
    : "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /CriOS\//.test(ua) || (/Chrome\//.test(ua) && !/Edg\//.test(ua)) ? "Chrome" : /FxiOS\//.test(ua) || /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  const home = standalone ?? (typeof window !== "undefined" && (window.matchMedia?.("(display-mode: standalone)")?.matches || (navigator as { standalone?: boolean }).standalone === true));
  return `${platform}${home ? " - home-screen app" : browser ? ` - ${browser}` : ""}`;
}
/** What is sent with every request and stamped into the activity log's details. */
export function deviceIdentity() { return { id: deviceId(), name: deviceName() }; }
