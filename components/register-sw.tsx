"use client";

import { useEffect } from "react";

// Registers the service worker so the installed PWA can open offline. Runs once
// on mount, client-side only. Safe no-op on browsers without service workers.
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const onLoad = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failure is non-fatal — the app still works as a normal site.
      });
    };
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, []);
  return null;
}
