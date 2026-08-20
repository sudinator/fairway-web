"use client";

import React from "react";
import { C } from "@/lib/golf";

export type CreateGameSection = "game" | "players" | "format" | "review";

export type CreateGameSectionStatus = {
  key: CreateGameSection;
  label: string;
  done: boolean;
  note?: string;
};

export function CreateGameWorkspace({
  activeSection,
  onSectionChange,
  sections,
  children,
}: {
  activeSection: CreateGameSection;
  onSectionChange: (section: CreateGameSection) => void;
  sections: CreateGameSectionStatus[];
  children: React.ReactNode;
}) {
  const active = sections.find((s) => s.key === activeSection);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 18, marginBottom: 10 }}>
        {active?.label || "Create game"}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, marginBottom: 14 }}>
        {sections.map((s, i) => {
          const isActive = s.key === activeSection;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => onSectionChange(s.key)}
              title={s.note || s.label}
              style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center" }}
            >
              <div style={{
                width: isActive ? 30 : 26,
                height: isActive ? 30 : 26,
                lineHeight: isActive ? "30px" : "26px",
                margin: "0 auto",
                borderRadius: 999,
                fontWeight: 800,
                fontSize: 12,
                background: s.done ? "#5BD08A" : isActive ? C.gold : "transparent",
                color: s.done ? "#0E241B" : isActive ? "#23303A" : C.sage,
                border: s.done || isActive ? "none" : "1px solid rgba(255,255,255,.25)",
                boxShadow: isActive ? `0 0 0 3px ${C.gold}` : "none",
              }}>
                {s.done ? "✓" : i + 1}
              </div>
              <div style={{ color: isActive ? C.cream : C.sage, fontSize: 11, marginTop: 3, fontWeight: isActive ? 700 : 400, lineHeight: 1.15 }}>
                {s.label}
              </div>
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
