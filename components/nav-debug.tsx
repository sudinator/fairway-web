"use client";
import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/app-version";

// TEMPORARY diagnostic overlay (owner-only). Reports the loaded build + live readings
// on the fixed bottom <nav>: its computed position/bottom, its viewport rect, whether
// it's actually stuck to the viewport bottom (Δvp≈0), and any ancestor that creates a
// containing block for fixed elements (transform/filter/backdrop/perspective/contain/
// will-change). Remove once the nav bug is resolved.
export function NavDebug({ show }: { show: boolean }) {
  const [txt, setTxt] = useState("sampling…");
  useEffect(() => {
    if (!show) return;
    const sample = () => {
      const L: string[] = [];
      const vv = (window as any).visualViewport;
      L.push(`build ${APP_VERSION}`);
      L.push(`scrollY ${Math.round(window.scrollY)}  innerH ${window.innerHeight}`);
      if (vv) L.push(`vv h ${Math.round(vv.height)} offTop ${Math.round(vv.offsetTop)}`);
      const nav = document.querySelector("[data-debug-nav]") as HTMLElement | null;
      if (!nav) {
        L.push("NAV: element not found");
      } else {
        const r = nav.getBoundingClientRect();
        const cs = getComputedStyle(nav);
        const dvp = Math.round(window.innerHeight - r.bottom);
        L.push(`NAV ${cs.position} bottom:${cs.bottom}`);
        L.push(`  rectTop:${Math.round(r.top)} rectBot:${Math.round(r.bottom)} Δvp:${dvp} ${Math.abs(dvp) <= 3 ? "STUCK ✓" : "MOVING ✗"}`);
        if (cs.transform && cs.transform !== "none") L.push(`  NAV.transform:${cs.transform}`);
        if (cs.marginBottom !== "0px") L.push(`  NAV.marginBottom:${cs.marginBottom}`);
        const bad: string[] = [];
        let el: HTMLElement | null = nav.parentElement;
        let d = 0;
        while (el && d < 50) {
          const s = getComputedStyle(el);
          const hits: string[] = [];
          if (s.transform && s.transform !== "none") hits.push("transform");
          if (s.filter && s.filter !== "none") hits.push("filter");
          const bf = (s as any).backdropFilter || (s as any).webkitBackdropFilter;
          if (bf && bf !== "none") hits.push("backdrop");
          if (s.perspective && s.perspective !== "none") hits.push("perspective");
          if (s.willChange && /transform|filter|perspective/.test(s.willChange)) hits.push("wc:" + s.willChange);
          if (s.contain && /paint|layout|strict|content/.test(s.contain)) hits.push("contain:" + s.contain);
          if (hits.length) bad.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}{${hits.join(",")}}`);
          el = el.parentElement;
          d++;
        }
        L.push(`ancestorsCB: ${bad.length ? bad.join("  ") : "NONE"}`);
      }
      const self = document.querySelector("[data-debug-self]") as HTMLElement | null;
      if (self) L.push(`panel rectTop:${Math.round(self.getBoundingClientRect().top)}`);
      setTxt(L.join("\n"));
    };
    sample();
    const on = () => sample();
    window.addEventListener("scroll", on, { passive: true });
    const iv = window.setInterval(sample, 300);
    const vv = (window as any).visualViewport;
    vv?.addEventListener("resize", sample);
    vv?.addEventListener("scroll", sample);
    return () => {
      window.removeEventListener("scroll", on);
      clearInterval(iv);
      vv?.removeEventListener("resize", sample);
      vv?.removeEventListener("scroll", sample);
    };
  }, [show]);
  if (!show) return null;
  return (
    <div data-debug-self style={{
      position: "fixed", top: "calc(env(safe-area-inset-top) + 4px)", left: 6, right: 6, zIndex: 999999,
      background: "rgba(0,0,0,0.88)", color: "#8FE0B0", fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 10.5, lineHeight: 1.45, padding: "8px 10px", borderRadius: 8, whiteSpace: "pre-wrap",
      border: "1px solid #4ADE80", boxShadow: "0 6px 20px -8px #000",
    }}>
      <div>{txt}</div>
      <button onClick={() => { try { (navigator as any).clipboard?.writeText(txt); } catch { /* no-op */ } }}
        style={{ marginTop: 6, background: "#4ADE80", color: "#04140d", border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 800 }}>
        Copy readings
      </button>
    </div>
  );
}
