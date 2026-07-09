"use client";

import { useCallback, useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/app-version";

type UpdateReason = "service-worker" | "app-version";

// Registers the service worker AND handles updates.
//
// The old implementation only detected service-worker changes. That misses many
// real app updates because Next.js client bundles can change while sw.js remains
// textually unchanged. This component now checks both:
//   1. a waiting service worker
//   2. /app-version.json, which is generated fresh during every build
export function RegisterSW() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [versionUpdate, setVersionUpdate] = useState(false);

  const hasUpdate = !!waiting || versionUpdate;
  const reason: UpdateReason | null = waiting ? "service-worker" : versionUpdate ? "app-version" : null;

  const checkAppVersion = useCallback(async () => {
    if (typeof window === "undefined") return false;
    try {
      const res = await fetch(`/app-version.json?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!res.ok) return false;
      const data = await res.json();
      const latest = typeof data?.version === "string" ? data.version : "";
      if (latest && latest !== APP_VERSION) {
        setVersionUpdate(true);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let reg: ServiceWorkerRegistration | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let started = false;

    const runChecks = () => {
      reg?.update().catch(() => {});
      checkAppVersion();
    };

    const start = async () => {
      if (started) return;
      started = true;

      try {
        if ("serviceWorker" in navigator) {
          reg = await navigator.serviceWorker.register("/sw.js");

          if (reg.waiting && navigator.serviceWorker.controller) {
            setWaiting(reg.waiting);
          }

          reg.addEventListener("updatefound", () => {
            const sw = reg?.installing;
            if (!sw) return;
            sw.addEventListener("statechange", () => {
              if (sw.state === "installed" && navigator.serviceWorker.controller) {
                setWaiting(sw);
              }
            });
          });
        }
      } catch {
        // Non-fatal — app still works as a normal site.
      }

      runChecks();
      interval = setInterval(runChecks, 30 * 60 * 1000);
    };

    const onVisible = () => { if (document.visibilityState === "visible") runChecks(); };
    const onPageShow = () => runChecks();
    const onFocus = () => runChecks();

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    };

    window.addEventListener("load", start);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    // When a push notification is clicked and an existing tab is focused, the SW asks
    // the page to route to the notification's deep link.
    const onSwMessage = (e: MessageEvent) => {
      if (e.data && e.data.kind === "notif-nav" && typeof e.data.link === "string") {
        try {
          const url = new URL(e.data.link, window.location.origin);
          if (url.origin === window.location.origin && url.pathname + url.search !== window.location.pathname + window.location.search) {
            window.location.assign(url.pathname + url.search);
          }
        } catch { /* ignore bad link */ }
      }
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onSwMessage);

    if (document.readyState === "complete") start();

    return () => {
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
      if (interval) clearInterval(interval);
    };
  }, [checkAppVersion]);

  const applyUpdate = () => {
    if (waiting) {
      waiting.postMessage("SKIP_WAITING");
      setWaiting(null);
      return;
    }

    if (versionUpdate) {
      const url = new URL(window.location.href);
      url.searchParams.set("refresh", Date.now().toString());
      window.location.replace(url.toString());
    }
  };

  if (!hasUpdate) return null;

  return (
    <div style={{
      position: "fixed", left: 12, right: 12,
      bottom: "calc(12px + env(safe-area-inset-bottom))",
      background: "#1E4636", border: "1px solid #C9A227", borderRadius: 12,
      padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, zIndex: 100,
    }}>
      <div style={{ flex: 1, color: "#F3EFE2", fontSize: 13, lineHeight: 1.4 }}>
        A new version of Birdie Num Num is available.
        {reason === "app-version" ? " Refresh to load the latest app." : ""}
      </div>
      <button onClick={applyUpdate} style={{
        background: "#C9A227", color: "#0E3B2E", border: "none", borderRadius: 8,
        padding: "8px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", flexShrink: 0,
      }}>Update</button>
    </div>
  );
}
