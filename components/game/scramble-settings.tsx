"use client";
// A scramble's own settings in Setup → Format (211.7): team size, how teams compete, handicaps, the drive requirement
// — the choices offered at creation, editable until scoring starts. Changing the team size or how teams compete
// clears the teams (they no longer fit); handicaps and drives keep them. A scramble isn't switched to another format
// here (its teams would be left behind) — a different format is a new game.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import type { Game } from "@/lib/game-types";
import { SCRAMBLE_METHOD_LABEL, scrambleMethodText, OFFERED_METHODS, type ScrambleMethod } from "@/lib/scramble-method";
import { scrambleMethodOf } from "@/lib/game-shape";
import { ScrambleAllowanceEditor } from "@/components/game/scramble-allowance-editor";

export type ScramblePatch = { scramble_team_size?: 1 | null; scramble_mode?: "field" | "match"; scramble_handicap?: "usga" | "gross" | "agreed"; scramble_min_drives?: number | null; scramble_allowance?: Record<string, number[]> | null };

export function ScrambleSettings({ game, locked, onSave }: { game: Game; locked: boolean; onSave: (patch: ScramblePatch, clearTeams: boolean) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const captains = game.scramble_team_size === 1;   // 212.0: the only team-size setting left
  const size = captains ? 1 : 4;
  const mode = game.scramble_mode === "match" ? "match" : "field";
  const hcp = scrambleMethodOf(game) as ScrambleMethod;
  const drives = game.scramble_min_drives ?? null;
  const hasTeams = Array.isArray(game.foursomes) && game.foursomes.length > 0;
  const save = async (patch: ScramblePatch, clears: boolean) => {
    if (locked || busy) return;
    if (clears && hasTeams && typeof window !== "undefined" && !window.confirm("This clears the teams — you'll make them again in Setup → Teams. Continue?")) return;
    setBusy(true); try { await onSave(patch, clears && hasTeams); } finally { setBusy(false); }
  };
  const label: React.CSSProperties = { color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 };
  return (
    <div data-scramble-settings style={{ marginTop: 12 }}>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>Scramble</div>
      {locked ? <div style={{ color: C.sage, fontSize: 11.5, marginTop: 4 }}>Scoring has started — these settings are fixed for this game.</div> : null}
      <div style={label}>WHO&apos;S ON THE APP</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button disabled={locked || busy} onClick={() => captains && save({ scramble_team_size: null }, true)} style={{ ...btn(!captains), flex: 1, fontSize: 13 }}>Every player</button>
        <button disabled={locked || busy} onClick={() => !captains && save({ scramble_team_size: 1, scramble_handicap: "agreed" }, true)} style={{ ...btn(captains), flex: 1, fontSize: 13 }}>Captains only</button>
      </div>
      <div style={label}>HOW TEAMS COMPETE</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <button disabled={locked || busy} onClick={() => mode !== "field" && save({ scramble_mode: "field" }, true)} style={{ ...btn(mode === "field"), flex: 1, fontSize: 13 }}>One leaderboard</button>
        <button disabled={locked || busy} onClick={() => mode !== "match" && save({ scramble_mode: "match" }, true)} style={{ ...btn(mode === "match"), flex: 1, fontSize: 13 }}>Team v team</button>
      </div>
      <div style={label}>HANDICAPS</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {OFFERED_METHODS.map((m) => <button key={m} disabled={locked || busy || (m === "usga" && captains)} onClick={() => hcp !== m && save({ scramble_handicap: m }, false)} style={{ ...btn(hcp === m), flex: 1, minWidth: 100, fontSize: 13, opacity: m === "usga" && captains ? 0.5 : 1 }}>{SCRAMBLE_METHOD_LABEL[m]}</button>)}
      </div>
      <div data-scramble-method style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>{scrambleMethodText(hcp, size)}</div>
      {hcp === "usga" && !captains ? <ScrambleAllowanceEditor value={game.scramble_allowance} disabled={locked || busy} onChange={(next) => save({ scramble_allowance: next }, false)} /> : null}
      <div style={label}>DRIVE REQUIREMENT</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {([null, 2, 3, 4] as const).map((n) => <button key={String(n)} disabled={locked || busy} onClick={() => n !== drives && save({ scramble_min_drives: n }, false)} style={{ ...btn(drives === n), flex: 1, minWidth: 70, fontSize: 13 }}>{n ? `Each ×${n}` : "None"}</button>)}
      </div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 10 }}>Switching between every player and captains only, or how teams compete, clears the teams. To play a different format, create a new game.</div>
    </div>
  );
}
