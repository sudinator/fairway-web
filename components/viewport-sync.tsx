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
export function ViewportSync() {
  useEffect(() => {
    const vv = window.visualViewport;
    const set = () => {
      const h = Math.round(vv?.height ?? window.innerHeight);
      if (h > 0) document.documentElement.style.setProperty("--app-h", `${h}px`);
    };
    set();
    // rAF-guarded on the noisier events to avoid thrashing during toolbar animation
    let raf = 0;
    const onChange = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(set); };
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    vv?.addEventListener("resize", onChange);
    vv?.addEventListener("scroll", onChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
      vv?.removeEventListener("resize", onChange);
      vv?.removeEventListener("scroll", onChange);
    };
  }, []);
  return null;
}
