import React from "react";
import { C } from "@/lib/golf";
export function ChartTip({ active, payload, nameMap, fmt }: any) {
  if (!active || !payload || !payload.length) return null;
  const p0 = payload[0]?.payload || {};
  const label = p0.course ? `${p0.course}${p0.name ? " · " + p0.name : ""}` : "";
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

