"use client";
/**
 * 212.44 (owner, Oct 26: "lets see mock ups of the compact version") — a compact team editor: one row per player
 * (name, playing handicap, the two team buttons) under a summary of each side (players and total playing handicap).
 * The same actions as the full editor (organizer-panel section "teams"): assign, clear, balance, rename, and the
 * team colours (the app's own picker) — owner: "want the ability to name the teams … and to pick colors".
 */
import React from "react";
import { C, applyAllowance } from "@/lib/golf";
import { chBasis } from "@/lib/game-shape";
import { teamColour, readableInk } from "@/lib/game-colors";
import { TeamColourDot, type TeamColours } from "@/components/team-colour-dot";
import { inputStyle } from "@/components/ui";
import type { Game, Player } from "@/lib/game-types";

export function CompactTeamEditor({ game, players, onSetTeam, onBalanceTeams, onRenameTeams, onSetTeamColours, onStartOver, isBlocked }: {
  game: Game; players: Player[];
  onSetTeam: (p: Player, team: string | null) => Promise<void>;
  onBalanceTeams?: () => Promise<{ changed: number; summary: string; unrated: string[] } | null>;
  onRenameTeams?: (names: [string, string]) => Promise<void>;
  onSetTeamColours?: (colors: TeamColours) => void | Promise<void>;
  /** Clear every team choice (owner, Oct 26: "if I select balance and don't like it, we need a start over"). */
  onStartOver?: () => Promise<void>;
  isBlocked?: (p: Player) => string | null;
}) {
  const teams = (Array.isArray(game.teams) ? game.teams : []).slice(0, 2);
  const [msg, setMsg] = React.useState<string | null>(null), [busy, setBusy] = React.useState(false);
  const [names, setNames] = React.useState<[string, string] | null>(null);   // being edited (null = not editing)
  const pill = (primary: boolean): React.CSSProperties => ({ background: primary ? C.gold : "none", color: primary ? C.green : C.cream,
    border: `1px solid ${primary ? C.gold : C.borderGreen}`, borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" });
  const plays = (p: Player) => applyAllowance(chBasis(p, game.course_par, game.holes_meta?.length), game.allowance_pct ?? 100);
  const live = players.filter((p) => !p.no_show);
  const sorted = [...live].sort((a, b) => Number(!!a.team) - Number(!!b.team) || plays(a) - plays(b));
  return (
    <div data-compact-teams style={{ background: C.greenLight, borderRadius: 14, padding: 16 }}>
      {/* the two sides: each one's colour (tap the dot — the app's own picker; picking the other side's colour swaps them),
          its name, and its strength. Names change through "Edit names" → Save (owner, Oct 26): typing straight into the
          live name re-labelled every button as you typed, and an emptied name snapped back to "Team 1". */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {teams.map((t, ti) => {
          const mine = live.filter((p) => p.team === t.key), col = teamColour(t, ti);
          const both: [{ name: string; color: string | null }, { name: string; color: string | null }] = [
            { name: teams[0]?.name ?? "Team 1", color: (teams[0] as { color?: string | null })?.color ?? null },
            { name: teams[1]?.name ?? "Team 2", color: (teams[1] as { color?: string | null })?.color ?? null }];
          return (
            <div key={t.key} data-team-summary={t.name} style={{ flex: 1, minWidth: 150, background: C.green, borderRadius: 10, padding: "8px 12px", borderLeft: `4px solid ${col}` }}>
              {names ? (
                <input aria-label={`New name for ${t.name}`} value={names[ti]} placeholder={`Team ${ti + 1}`}
                  onChange={(e) => { const v = e.target.value; setNames((n) => (n ? (ti === 0 ? [v, n[1]] : [n[0], v]) : n)); }}
                  style={{ ...inputStyle, fontWeight: 800 }} />
              ) : onSetTeamColours ? (
                <TeamColourDot index={ti as 0 | 1} teams={both} onChange={onSetTeamColours}>
                  <div style={{ color: C.cream, fontWeight: 800, fontSize: 15, paddingTop: 6 }}>{t.name}</div>
                </TeamColourDot>
              ) : <div style={{ color: C.cream, fontWeight: 800, fontSize: 15 }}>{t.name}</div>}
              <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>{mine.length} player{mine.length === 1 ? "" : "s"} · plays {mine.reduce((s2, p) => s2 + plays(p), 0)}</div>
            </div>
          );
        })}
      </div>
      {onRenameTeams ? (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {names ? (
            <>
              <button data-save-names onClick={async () => {
                const fallback: [string, string] = [teams[0]?.name ?? "Team 1", teams[1]?.name ?? "Team 2"];
                const next: [string, string] = [names[0].trim() || fallback[0], names[1].trim() || fallback[1]];
                setNames(null); await onRenameTeams(next);
              }} style={{ ...pill(true) }}>Save names</button>
              <button onClick={() => setNames(null)} style={{ ...pill(false) }}>Cancel</button>
            </>
          ) : (
            <button data-edit-names onClick={() => setNames([teams[0]?.name ?? "", teams[1]?.name ?? ""])} style={{ ...pill(false) }}>✎ Edit names</button>
          )}
        </div>
      ) : null}
      {onBalanceTeams || onStartOver ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {onBalanceTeams ? <button disabled={busy} onClick={async () => { setBusy(true); setMsg(null); try { const r = await onBalanceTeams(); if (r) setMsg(r.unrated.length ? `Set a course handicap for ${r.unrated.join(", ")} first.` : r.changed ? r.summary : "Already balanced."); } finally { setBusy(false); } }}
            style={{ background: "none", border: `1px solid ${C.gold}`, color: C.gold, borderRadius: 999, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }}>
            {busy ? "Balancing…" : "⚖️ Balance by handicap"}
          </button> : null}
          {onStartOver && live.some((p) => p.team) ? (
            <button data-teams-start-over onClick={async () => { setMsg(null); await onStartOver(); }} style={{ ...pill(false), flexShrink: 0 }}>Start over</button>
          ) : null}
          {msg ? <span style={{ color: C.sage, fontSize: 11 }}>{msg}</span> : <span style={{ color: C.sage, fontSize: 11 }}>Tap a team to put someone on it; tap again to clear.</span>}
        </div>
      ) : null}
      <div style={{ marginTop: 10 }}>
        {sorted.map((p) => {
          const why = isBlocked?.(p) ?? null;
          return (
            <div key={p.id} data-compact-player={p.display_name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", margin: "0 -12px", borderTop: "1px solid rgba(255,255,255,.07)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.cream, fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.display_name}</div>
                <div style={{ color: p.team ? C.sage : C.gold, fontSize: 11 }}>{p.team ? `plays ${plays(p)}` : `plays ${plays(p)} · no team yet`}</div>
              </div>
              {teams.map((t, ti) => {
                const on = p.team === t.key, col = teamColour(t, ti);
                return (
                  <button key={t.key} title={why ?? undefined} disabled={!!why} onClick={() => onSetTeam(p, on ? null : t.key)}
                    // 14px bold (large text) in the ink that reads on THIS team's colour — every team colour reaches 3:1 (test)
                    style={{ minWidth: 76, borderRadius: 999, padding: "8px 12px", fontSize: 14, fontWeight: 800, cursor: why ? "not-allowed" : "pointer",
                      background: on ? col : "transparent", color: on ? readableInk(col) : C.sage, border: `1px solid ${on ? col : C.borderGreen}`, opacity: why ? 0.5 : 1 }}>
                    {t.name}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
