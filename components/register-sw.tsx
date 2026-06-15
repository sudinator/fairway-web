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

        // Surface a worker that's already waiting (update downloaded on a prior visit).
        if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);

        // Detect a new worker installing, then reaching "installed" while a
        // controller already exists (= an update, not a first install).
        reg.addEventListener("updatefound", () => {
          const sw = reg!.installing;
          if (!sw) return;
          sw.addEventListener("statechange", () => {
            if (sw.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(sw);
            }
          });
        });

        // Proactively ask the browser to check for a new sw.js right now, so a
        // freshly-deployed version is noticed on this load rather than later.
        reg.update().catch(() => {});

        // Check again on foreground return, on bfcache restore, on focus, and hourly.
        const check = () => reg && reg.update().catch(() => {});
        const onVis = () => { if (document.visibilityState === "visible") check(); };
        const onShow = () => check();
        const onFocus = () => check();
        document.addEventListener("visibilitychange", onVis);
        window.addEventListener("pageshow", onShow);
        window.addEventListener("focus", onFocus);
        const t = setInterval(check, 30 * 60 * 1000); // every 30 min

        // When the controller changes (the new SW took over after the user taps
        // Update), reload once to load fresh code.
        let reloaded = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloaded) return;
          reloaded = true;
          window.location.reload();
        });

        return () => {
          document.removeEventListener("visibilitychange", onVis);
          window.removeEventListener("pageshow", onShow);
          window.removeEventListener("focus", onFocus);
          clearInterval(t);
        };
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
