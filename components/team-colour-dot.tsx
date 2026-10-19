"use client";
// A team's colour dot, right beside its name (209.4, owner-approved mock): tap to choose from five colours;
// picking the other team's colour SWAPS them (nothing greyed out), with Undo; automatic colours say so; a team
// named after a colour keeps it. Used in the create-game form and in Setup → Teams.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { TEAM_PALETTE, teamColour, nameColour, isAutomaticColour, pickTeamColour } from "@/lib/game-colors";

type T = { name?: string | null; color?: string | null };
export type TeamColours = [string | null, string | null];

export function TeamColourDot({ teams, index, onChange, children }: {
  teams: [T, T]; index: 0 | 1; onChange: (colors: TeamColours) => void | Promise<void>; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [swap, setSwap] = useState<{ prev: TeamColours } | null>(null);
  const me = teams[index], other = teams[1 - index], o = (1 - index) as 0 | 1;
  const hex = teamColour(me, index);
  const fromName = !!nameColour(me?.name);
  const label = TEAM_PALETTE.find((p) => p.hex === hex)?.label ?? "";
  const nameOf = (t: T, i: number) => (t?.name || "").trim() || `Team ${i + 1}`;

  const pick = async (key: string) => {
    const r = pickTeamColour(teams, index, key);
    if (!r) return;
    const prev: TeamColours = [teams[0]?.color ?? null, teams[1]?.color ?? null];
    setOpen(false);
    setSwap(r.swapped ? { prev } : null);
    await onChange(r.colors);
  };

  return (
    <div data-team-colour={index}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button type="button" aria-label={fromName ? `${nameOf(me, index)}: colour from the name` : `Choose ${nameOf(me, index)}'s colour`}
          aria-expanded={open} disabled={fromName} onClick={() => setOpen((v) => !v)}
          style={{ width: 30, height: 30, borderRadius: 999, flexShrink: 0, background: hex, cursor: fromName ? "default" : "pointer", padding: 0,
            border: `2px ${fromName ? "dashed" : "solid"} ${open ? C.cream : "rgba(255,255,255,0.25)"}` }} />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
      <div style={{ color: C.sage, fontSize: 11.5, marginLeft: 40, marginTop: 3 }}>
        {fromName ? "Colour from the name" : isAutomaticColour(me) ? `${label} · automatic — tap the dot to choose` : label}
      </div>
      {open && !fromName ? (
        <div data-colour-picker style={{ marginLeft: 40, marginTop: 6, background: C.greenMid, borderRadius: 12, padding: "8px 12px" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {TEAM_PALETTE.map((c) => {
              const theirs = teamColour(other, o) === c.hex;
              const blocked = theirs && !!nameColour(other?.name);
              const mine = c.hex === hex;
              return (
                <button key={c.key} type="button" disabled={blocked} onClick={() => void pick(c.key)}
                  aria-label={`${c.label}${theirs ? ` — belongs to ${nameOf(other, o)}${blocked ? " (from its name)" : "; picking it swaps"}` : ""}`} aria-pressed={mine}
                  style={{ width: 32, height: 32, borderRadius: 999, background: c.hex, padding: 0, cursor: blocked ? "default" : "pointer",
                    border: `2px solid ${mine ? C.cream : "transparent"}`, color: "#1a1a1a", fontSize: 11, fontWeight: 800, opacity: blocked ? 0.35 : 1 }}>
                  {theirs ? nameOf(other, o).charAt(0).toUpperCase() : ""}
                </button>
              );
            })}
          </div>
          {TEAM_PALETTE.some((c) => teamColour(other, o) === c.hex) ? (
            <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6 }}>
              {nameColour(other?.name) ? `${TEAM_PALETTE.find((c) => c.hex === teamColour(other, o))?.label} belongs to ${nameOf(other, o)} — it comes from the team's name.`
                : `${TEAM_PALETTE.find((c) => c.hex === teamColour(other, o))?.label} belongs to ${nameOf(other, o)} — picking it swaps the two teams' colours.`}
            </div>
          ) : null}
        </div>
      ) : null}
      {swap ? (
        <div data-colour-swapped style={{ marginLeft: 40, marginTop: 6, background: C.greenMid, borderLeft: `3px solid ${C.gold}`, borderRadius: 8, padding: "8px 12px", fontSize: 12.5, color: C.cream }}>
          {nameOf(teams[0], 0)} and {nameOf(teams[1], 1)} swapped colours.{" "}
          <button type="button" onClick={() => { const p = swap.prev; setSwap(null); void onChange(p); }}
            style={{ background: "transparent", border: "none", padding: 0, color: C.gold, fontWeight: 800, cursor: "pointer", fontSize: 12.5 }}>Undo</button>
        </div>
      ) : null}
    </div>
  );
}
