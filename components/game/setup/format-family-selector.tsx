"use client";

import React from "react";
import { C } from "@/lib/golf";

export type FormatFamily = "stroke" | "match";

export function FormatFamilySelector({
  value,
  onChange,
}: {
  value: FormatFamily;
  onChange: (family: FormatFamily) => void;
}) {
  const card = (active: boolean): React.CSSProperties => ({
    flex: 1,
    textAlign: "left",
    background: active ? C.green : C.greenLight,
    border: `1.5px solid ${active ? C.gold : "transparent"}`,
    borderRadius: 12,
    padding: 11,
    cursor: "pointer",
  });

  const icon = (children: React.ReactNode) => (
    <span style={{ width: 34, height: 34, borderRadius: "50%", border: `1.5px solid ${C.gold}`, background: "#fbf6e6", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
      {children}
    </span>
  );

  return (
    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
      <button onClick={() => onChange("stroke")} style={card(value === "stroke")}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {icon(<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M7 21V3" stroke="#0E3B2E" strokeWidth="1.6" strokeLinecap="round"/><path d="M7 4l9 2.5L7 9.5z" fill="#B83A2E"/><circle cx="7" cy="21" r="1.6" fill="#C9A227"/></svg>)}
          <div>
            <div style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 15 }}>Stroke</div>
            <div style={{ color: C.sage, fontSize: 11 }}>The whole field</div>
          </div>
        </div>
      </button>
      <button onClick={() => onChange("match")} style={card(value === "match")}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          {icon(<svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M4 6l7 6-7 6" stroke="#0E3B2E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 6l-7 6 7 6" stroke="#B83A2E" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>)}
          <div>
            <div style={{ color: C.cream, fontWeight: 700, fontFamily: "Georgia, serif", fontSize: 15 }}>Match play</div>
            <div style={{ color: C.sage, fontSize: 11 }}>Head to head</div>
          </div>
        </div>
      </button>
    </div>
  );
}
