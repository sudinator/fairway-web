"use client";
import { useEffect } from "react";

// Publishes the live *usable* viewport height as the CSS var --app-h. In a browser tab this
// tracks Safari's toolbar as it grows/shrinks (visualViewport fires on resize + scroll), so the
// bottom nav stays pinned to the visible bottom instead of hiding behind the toolbar. In the
// installed PWA a display-mode:standalone CSS rule overrides the shell to 100lvh (full glass),
// so this var is only consulted in the browser — but we keep it updated everywhere anyway.
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
