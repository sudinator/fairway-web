"use client";
import { useEffect } from "react";

// Publishes the live *usable* viewport height as the CSS var --app-h. In a browser tab this
// tracks Safari's toolbar as it grows/shrinks (visualViewport fires on resize + scroll), so the
// bottom nav stays pinned to the visible bottom instead of hiding behind the toolbar. In the
// installed PWA it is ALSO what the shell uses: a standalone rule used to override the shell to
// 100lvh, but on a notched iPhone 100lvh measures the full screen INCLUDING the strip behind the
// status bar, so the shell overran the visible area by exactly safe-area-inset-top and its
// overflow:hidden clipped the bottom nav's labels. Fixed at 177.79 — both contexts now read this
// var, so it is load-bearing everywhere, not just in the browser.

/**
 * The value of 100lvh in pixels.
 *
 * lvh cannot be read from JS, so it is measured with an offscreen probe. Cached because it only
 * changes on rotation, and the cache is cleared on orientationchange below — recreating a node on
 * every keyboard animation frame would be wasteful and would thrash layout.
 */
let lvhCache = 0;
function measureLvh(): number {
  if (lvhCache > 0) return lvhCache;
  if (typeof document === "undefined") return 0;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:100lvh;pointer-events:none;visibility:hidden";
  document.body.appendChild(probe);
  lvhCache = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  // A browser without lvh support measures 0; fall back to the largest height seen, which at first
  // paint is the full viewport.
  if (lvhCache <= 0) lvhCache = Math.round(window.innerHeight || 0);
  return lvhCache;
}

export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      if (h <= 0) return;
      const root = document.documentElement;
      root.style.setProperty("--app-h", `${h}px`);

      // Is a keyboard open? There is no API, so it is inferred — but the reference matters.
      //
      // Comparing against window.innerHeight works in Safari and NOT in an installed PWA: iOS
      // shrinks the LAYOUT viewport there too, so both heights fall together and the delta stays
      // near zero. lvh is the one height that does not move.
      //
      // Measured on this phone at rest: lvh 956, visual viewport 894 — a 62px gap that is just the
      // status-bar strip. With a keyboard the visual viewport drops to ~576, a gap of ~380.
      //
      // The threshold is 180, not 120. At rest the gap is safeTop (47-62 by device); Safari's
      // chrome adds another 50-72 on top, reaching ~123 in the worst combination — which would
      // clear a 120 threshold and hide the nav during ordinary scrolling. A keyboard is never
      // smaller than ~260px on any iPhone, so 180 leaves ~57px of margin above the chrome case and
      // ~80px below the smallest keyboard.
      //
      // An ATTRIBUTE rather than a CSS custom property: a style query would need Safari 18+ and
      // behaves unpredictably when the property is unregistered. This is visible in the inspector
      // and a test can read it.
      const glass = measureLvh();
      if (glass > 0 && glass - h > 180) root.setAttribute("data-kb", "open");
      else root.removeAttribute("data-kb");
    };
    set();
    // rAF-guarded on the noisier events to avoid thrashing during toolbar animation
    let raf = 0;
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(set); };
    // Rotation is the only thing that changes lvh, so the cache is cleared there and nowhere else.
    const onRotate = () => { lvhCache = 0; onChange(); };
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onRotate);
    vv?.addEventListener("resize", onChange);
    vv?.addEventListener("scroll", onChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onRotate);
      vv?.removeEventListener("resize", onChange);
      vv?.removeEventListener("scroll", onChange);
    };
  }, []);
  return null;
}
