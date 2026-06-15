"use client";

import { useEffect, useState } from "react";

// Registers the service worker AND handles updates. When a new version is
// deployed, the browser fetches the new sw.js; this detects the waiting worker
// and shows a small "Update available" bar. Tapping it activates the new version
// and reloads — so users get fresh code without manually clearing anything.
export function RegisterSW() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | null = null;

    const onLoad = async () => {
      try {
        reg = await navigator.serviceWorker.register("/sw.js");

        // If there's already a waiting worker (update downloaded earlier), surface it.
        if (reg.waiting) setWaiting(reg.waiting);

        // Detect a new worker installing, then waiting.
        reg.addEventListener("updatefound", () => {
          const sw = reg!.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            // "installed" + an existing controller means an UPDATE (not first install).
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(sw);
            }
          });
        });

        // Check for updates periodically and when the app regains focus, so a
        // long-open installed app still notices new deploys.
        const check = () => reg && reg.update().catch(() => {});
        const onVis = () => { if (document.visibilityState === "visible") check(); };
        document.addEventListener("visibilitychange", onVis);
        const t = setInterval(check, 60 * 60 * 1000); // hourly

        // When the controller changes (new SW took over), reload once to get fresh code.
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });

        return () => { document.removeEventListener("visibilitychange", onVis); clearInterval(t); };
      } catch {
        // Non-fatal — app still works as a normal site.
      }
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);

  const applyUpdate = () => {
    if (!waiting) return;
    waiting.postMessage("SKIP_WAITING"); // triggers controllerchange -> reload
    setWaiting(null);
  };

  if (!waiting) return null;
  return (
    <div style={{
      position: "fixed", left: 12, right: 12,
      bottom: "calc(12px + env(safe-area-inset-bottom))",
      background: "#1E4636", border: "1px solid #C9A227", borderRadius: 12,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, zIndex: 100,
    }}>
      <div style={{ flex: 1, color: "#F3EFE2", fontSize: 13, lineHeight: 1.4 }}>
        A new version of Birdie Num Num is available.
      </div>
      <button onClick={applyUpdate} style={{
        background: "#C9A227", color: "#0E3B2E", border: "none", borderRadius: 8,
        padding: "8px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", flexShrink: 0,
      }}>Update</button>
    </div>
  );
}
