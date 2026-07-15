"use client";
import React, { useEffect, useRef, useState } from "react";
import { C } from "@/lib/golf";

/**
 * HScroll — the standard wrapper for any horizontally-scrollable content box.
 * Renders an overflowX:auto scroller with the native scrollbar hidden, and — ONLY when the content
 * actually overflows — a slim custom scroll-position bar placed BELOW the content in normal flow, so
 * it never overlaps any text or data. The thumb shows both position and how much is off-screen, and
 * can be dragged (or the content scrolled) to move. Hidden entirely when everything already fits.
 *
 * Pass `maxHeight` for a long table that can exceed the phone height: the box then also scrolls
 * VERTICALLY, and a thead marked `position:sticky; top:0` (with a matching bg) stays frozen at the top
 * while the rows scroll under it. Any new horizontally-scrollable box uses <HScroll>. See APP_RULES.md
 * rule 1.
 */
export function HScroll({
  children,
  style,
  maxHeight,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  maxHeight?: number | string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [show, setShow] = useState(false);
  const [thumb, setThumb] = useState({ w: 30, l: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      const overflow = max > 4;
      setShow(overflow);
      if (overflow) {
        const w = Math.max(12, (el.clientWidth / el.scrollWidth) * 100);
        const l = (el.scrollLeft / max) * (100 - w);
        setThumb({ w, l });
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
    };
  }, [children]);

  // Map a pointer x on the bar to a scroll position.
  const seek = (clientX: number) => {
    const el = ref.current, bar = barRef.current;
    if (!el || !bar) return;
    const rect = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    el.scrollLeft = f * (el.scrollWidth - el.clientWidth);
  };

  return (
    <div>
      <style>{`.hscroll-x::-webkit-scrollbar{display:none}`}</style>
      <div ref={ref} className="hscroll-x" style={{ overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none", ...style, ...(maxHeight != null ? { maxHeight, overflowY: "auto" } : {}) } as React.CSSProperties}>
        {children}
      </div>
      {show && (
        <div
          ref={barRef}
          aria-hidden
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seek(e.clientX); }}
          onPointerMove={(e) => { if (dragging.current) seek(e.clientX); }}
          onPointerUp={() => { dragging.current = false; }}
          onPointerCancel={() => { dragging.current = false; }}
          style={{ position: "relative", height: 6, marginTop: 6, background: C.greenMid, borderRadius: 999, cursor: "pointer", touchAction: "none" }}
        >
          <div style={{ position: "absolute", top: 0, height: 6, borderRadius: 999, background: C.gold, width: `${thumb.w}%`, left: `${thumb.l}%` }} />
        </div>
      )}
    </div>
  );
}
