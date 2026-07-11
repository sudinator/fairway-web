"use client";

import { useEffect, useRef, useState } from "react";

// Pull-to-refresh for the installed PWA (iOS disables the browser's native one in
// standalone mode). Detects a downward drag that STARTS at the top of the page and
// calls onRefresh (which re-pulls the current screen's data — not a full reload).
// Renders a small spinner that follows the pull.
export function PullToRefresh({ onRefresh, children }: {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
}) {
  const [pull, setPull] = useState(0);     // current pull distance in px
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const active = useRef(false);
  const THRESHOLD = 70; // px to trigger
  const MAX = 110;      // visual cap

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      // Only arm if we're at the very top of the page and not already refreshing.
      if (refreshing) return;
      if (window.scrollY > 0) { active.current = false; return; }
      startY.current = e.touches[0].clientY;
      active.current = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active.current || startY.current == null || refreshing) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0) { setPull(0); return; }
      // Resistance: pull feels heavier as it stretches.
      const dist = Math.min(MAX, dy * 0.5);
      setPull(dist);
    };
    const onEnd = async () => {
      if (!active.current) return;
      active.current = false;
      const shouldRefresh = pull >= THRESHOLD;
      if (shouldRefresh) {
        setRefreshing(true);
        setPull(THRESHOLD);
        try { await onRefresh(); } finally {
          setRefreshing(false);
          setPull(0);
        }
      } else {
        setPull(0);
      }
      startY.current = null;
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: true });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, [pull, refreshing, onRefresh]);

  const show = pull > 0 || refreshing;
  return (
    <>
      <div style={{
        position: "fixed", top: "env(safe-area-inset-top)", left: 0, right: 0,
        height: show ? Math.max(pull, refreshing ? THRESHOLD : 0) : 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#C9A227", fontSize: 13, fontWeight: 700, zIndex: 40,
        transition: active.current ? "none" : "height 0.2s ease",
        pointerEvents: "none", overflow: "hidden",
      }}>
        {show && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{
              width: 16, height: 16, borderRadius: "50%",
              border: "2px solid #C9A227", borderTopColor: "transparent",
              display: "inline-block",
              animation: refreshing ? "bnnspin 0.7s linear infinite" : "none",
              transform: refreshing ? "none" : `rotate(${pull * 3}deg)`,
            }} />
            {refreshing ? "Refreshing…" : pull >= THRESHOLD ? "Release to refresh" : "Pull to refresh"}
          </span>
        )}
      </div>
      <div style={{
        marginTop: show ? `${refreshing ? THRESHOLD : pull}px` : 0,
        transition: active.current ? "none" : "margin-top 0.2s ease",
      }}>
        {children}
      </div>
      <style>{`@keyframes bnnspin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
