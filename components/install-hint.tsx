"use client";

import { useEffect, useState } from "react";

// A small, dismissible "install this app" hint. On Android/desktop Chrome it uses
// the native install prompt; on iOS (which has no prompt) it shows the manual
// Share -> Add to Home Screen instruction. Hidden automatically when already
// running as an installed app, and remembers dismissal for the session.

export function InstallHint() {
  const [show, setShow] = useState(false);
  const [deferred, setDeferred] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Already installed / running standalone? Don't nag.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      (window.navigator as any).standalone === true;
    if (standalone) return;
    if (sessionStorage.getItem("bnn_install_dismissed")) return;

    const ua = window.navigator.userAgent || "";
    const iOS = /iphone|ipad|ipod/i.test(ua) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Android/desktop: capture the install prompt event.
    const onBIP = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS has no event — show the manual hint after a short delay.
    let t: any;
    if (iOS) t = setTimeout(() => setShow(true), 1500);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      if (t) clearTimeout(t);
    };
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try { sessionStorage.setItem("bnn_install_dismissed", "1"); } catch {}
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    try { await deferred.userChoice; } catch {}
    setDeferred(null);
    dismiss();
  };

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 50,
      background: "#1E4636", borderBottom: "1px solid #2A5A45",
      padding: "10px 14px", display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: 7, background: "#0E3B2E",
        border: "1px solid #C9A227", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#F7F3E8", fontFamily: "Georgia, serif", fontSize: 13, fontWeight: 700,
      }}>B</div>
      <div style={{ flex: 1, color: "#F3EFE2", fontSize: 12.5, lineHeight: 1.45 }}>
        {isIOS ? (
          <>Install Birdie Num Num: tap <span style={{ fontWeight: 700 }}>Share</span>, then <span style={{ fontWeight: 700 }}>Add to Home Screen</span>.</>
        ) : (
          <>Add Birdie Num Num to your home screen for a full-screen, app-like experience.</>
        )}
      </div>
      {!isIOS && deferred && (
        <button onClick={install} style={{
          background: "#C9A227", color: "#0E3B2E", border: "none", borderRadius: 8,
          padding: "7px 12px", fontWeight: 800, fontSize: 12, cursor: "pointer", flexShrink: 0,
        }}>Install</button>
      )}
      <button onClick={dismiss} aria-label="Dismiss" style={{
        background: "none", border: "none", color: "#93A99B", fontSize: 18,
        cursor: "pointer", flexShrink: 0, lineHeight: 1, padding: "0 2px",
      }}>×</button>
    </div>
  );
}
