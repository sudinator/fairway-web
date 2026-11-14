"use client";
import React, { useContext, createContext, useEffect, useState } from "react";
import { Tooltip } from "recharts";
import { C } from "@/lib/golf";

export function ChartTip({ active, payload, nameMap, fmt, heading }: any) {
  if (!active || !payload || !payload.length) return null;
  const p0 = payload[0]?.payload || {};
  const label = heading ? heading(p0) : p0.course ? `${p0.course}${p0.name ? " · " + p0.name : ""}` : "";
  const rows = payload.filter((e: any) => e.value != null);
  return (
    <div style={{ position: "relative", background: C.green, border: `1px solid ${C.gold}`, borderRadius: 10, padding: "9px 12px", paddingRight: 30, minWidth: 132 }}>
      <button aria-label="Close" onClick={(e) => { e.stopPropagation(); if (typeof window !== "undefined") window.dispatchEvent(new Event("bnn-chart-dismiss")); }}
        style={{ position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 12, background: C.greenMid, border: "none", color: C.cream, fontSize: 14, fontWeight: 800, lineHeight: 1, cursor: "pointer", padding: 0 }}>×</button>
      {label && <div style={{ color: C.gold, fontWeight: 700, fontSize: 11.5, marginBottom: 6 }}>{label}</div>}
      {rows.map((e: any, i: number) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "baseline" }}>
          <span style={{ color: C.sage, fontSize: 11 }}>{(nameMap && nameMap[e.dataKey]) || e.name || e.dataKey}</span>
          <span style={{ color: C.cream, fontWeight: 800, fontSize: 12 }}>{fmt ? fmt(e.value, e.dataKey) : (typeof e.value === "number" ? e.value.toFixed(1) : e.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Wraps a chart so its (recharts) tooltip can be dismissed: tapping the tooltip's × fires a global
// "bnn-chart-dismiss", which remounts the chart here (clearing recharts' internal active-tooltip state).
// Also dismisses on a tap anywhere outside the plotted area via the transparent catcher.
export function DismissableChart({ height, marginTop, children, holdDismissed = false }: { height: number | string; marginTop?: number; children: React.ReactNode; holdDismissed?: boolean }) {
  const [nonce, setNonce] = useState(0);
  const [suppressed, setSuppressed] = useState(false);
  const [trigger, setTrigger] = useState<"hover" | "click">("hover");
  useEffect(() => {
    const h = () => { if (holdDismissed) setSuppressed(true); else setNonce((n) => n + 1); };
    window.addEventListener("bnn-chart-dismiss", h);
    return () => window.removeEventListener("bnn-chart-dismiss", h);
  }, [holdDismissed]);
  if (holdDismissed) return <ChartDismissal.Provider value={{ suppressed, trigger }}><div style={{ height, marginTop }}
    onPointerMoveCapture={(event) => {
      const target = event.target as Element;
      if (target.closest?.(".recharts-tooltip-wrapper") || target.closest?.(".recharts-cartesian-axis")) return;
      if (event.pointerType === "mouse") { setTrigger("hover"); if (trigger === "click") setSuppressed(false); }
    }}
    onPointerLeave={(event) => { if (event.pointerType !== "touch") { setSuppressed(false); setTrigger("hover"); } }}
    onPointerDownCapture={(event) => {
      const target = event.target as Element;
      if (target.closest?.(".recharts-tooltip-wrapper") || target.closest?.(".recharts-cartesian-axis")) return;
      setTrigger(event.pointerType === "touch" ? "click" : "hover"); setSuppressed(false);
    }}>{children}</div></ChartDismissal.Provider>;
  return <div key={nonce} style={{ height, marginTop }}>{children}</div>;
}

const ChartDismissal = createContext<{ suppressed: boolean; trigger: "hover" | "click" }>({ suppressed: false, trigger: "hover" });
// New interactive charts hide a dismissed tooltip until the next deliberate
// point interaction or pointer re-entry. Existing dashboard defaults are intact.
export function ChartTooltip(props: any) {
  const { suppressed, trigger } = useContext(ChartDismissal);
  return <Tooltip {...props} trigger={props.trigger ?? trigger} active={suppressed ? false : props.active} />;
}
