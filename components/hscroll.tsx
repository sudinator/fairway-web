"use client";
import React, { useEffect, useRef, useState } from "react";
import { C } from "@/lib/golf";

/**
 * HScroll — the standard wrapper for any horizontally-scrollable content box.
 * Renders an overflowX:auto scroller and, ONLY when the content actually overflows and the user
 * hasn't yet scrolled to the end, a small "Swipe →" cue in the top corner for discoverability
 * (mobile auto-hides native scrollbars). Placed at the top so it never covers the last row of
 * content. The cue disappears once scrolled to the end and never shows when everything already fits.
 * See APP_RULES.md rule 1.
 */
export function HScroll({
  children,
  style,
  cueLabel = "Swipe →",
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  cueLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const overflow = el.scrollWidth > el.clientWidth + 4;
      const atEnd = el.scrollLeft >= el.scrollWidth - el.clientWidth - 4;
      setShow(overflow && !atEnd);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [children]);

  return (
    <div style={{ position: "relative" }}>
      <div ref={ref} style={{ overflowX: "auto", ...style }}>
        {children}
      </div>
      {show && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: 6,
            top: 6,
            pointerEvents: "none",
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: 0.3,
            color: "#0e3a2c",
            background: C.gold,
            borderRadius: 999,
            padding: "2px 8px",
            boxShadow: "0 2px 6px rgba(0,0,0,.35)",
            opacity: 0.95,
          }}
        >
          {cueLabel}
        </div>
      )}
    </div>
  );
}
